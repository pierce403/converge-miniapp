import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAddress, isAddress } from 'viem'

export type ParticipantIdentity = {
  address: `0x${string}`
  basename: string | null
  ensName: string | null
  registeredFname: string | null
}

export type ParticipantPresentation = {
  addressLabel: string
  fnameHint: string | null
  label: string
  secondary: string
  title: string
}

type UseParticipantIdentitiesOptions = {
  addresses: Array<string | null | undefined>
  enabled: boolean
}

type LookupStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

const CACHE_TTL_MS = 10 * 60_000
const NEGATIVE_CACHE_TTL_MS = 2 * 60_000
const RETRY_DELAY_MS = 60_000
const MAX_ADDRESSES = 50
const LOOKUP_BATCH_SIZE = 12
const cache = new Map<string, {
  expiresAt: number
  identity: ParticipantIdentity | null
}>()
type ParticipantBatchResult = {
  identities: Map<string, ParticipantIdentity | null>
  partial: boolean
}

const inFlight = new Map<string, Promise<ParticipantBatchResult>>()

export function useParticipantIdentities({
  addresses,
  enabled,
}: UseParticipantIdentitiesOptions) {
  const addressKey = normalizeAddresses(addresses)
    .map((address) => address.toLowerCase())
    .sort()
    .join(',')
  const normalizedAddresses = useMemo(
    () => addressKey ? addressKey.split(',') as `0x${string}`[] : [],
    [addressKey],
  )
  const requestRef = useRef(0)
  const [identities, setIdentities] = useState<Map<string, ParticipantIdentity>>(
    () => new Map(),
  )
  const [status, setStatus] = useState<LookupStatus>('idle')
  const [refreshAt, setRefreshAt] = useState<number | null>(null)

  const load = useCallback(async (force = false) => {
    if (!enabled || normalizedAddresses.length === 0) return
    const request = ++requestRef.current
    const now = Date.now()
    const resolved = new Map<string, ParticipantIdentity>()
    const missing: `0x${string}`[] = []
    let nextExpiry = Number.POSITIVE_INFINITY

    for (const address of normalizedAddresses) {
      const cached = force ? undefined : cache.get(address)
      if (cached && cached.expiresAt > now) {
        nextExpiry = Math.min(nextExpiry, cached.expiresAt)
        if (cached.identity) resolved.set(address, cached.identity)
      } else {
        if (cached) cache.delete(address)
        missing.push(address)
      }
    }

    if (missing.length === 0) {
      if (requestRef.current === request) {
        setIdentities(resolved)
        setStatus('ready')
        setRefreshAt(Number.isFinite(nextExpiry) ? nextExpiry : now + CACHE_TTL_MS)
      }
      return
    }

    setStatus('loading')
    try {
      const fetched = await fetchParticipantIdentities(missing)
      for (const [address, identity] of fetched.identities) {
        if (identity || !fetched.partial) {
          const expiresAt = cacheIdentity(
            address,
            identity,
            fetched.partial ? RETRY_DELAY_MS : undefined,
          )
          nextExpiry = Math.min(nextExpiry, expiresAt)
        }
        if (identity) resolved.set(address, identity)
      }
      if (requestRef.current === request) {
        setIdentities(resolved)
        setStatus('ready')
        setRefreshAt(fetched.partial
          ? Date.now() + RETRY_DELAY_MS
          : Number.isFinite(nextExpiry)
            ? nextExpiry
            : Date.now() + CACHE_TTL_MS)
      }
    } catch {
      if (requestRef.current === request) {
        setIdentities(resolved)
        setStatus(resolved.size ? 'ready' : 'unavailable')
        setRefreshAt(Date.now() + RETRY_DELAY_MS)
      }
    }
  }, [enabled, normalizedAddresses])

  useEffect(() => {
    if (!enabled || normalizedAddresses.length === 0) {
      requestRef.current += 1
      const timer = window.setTimeout(() => {
        setIdentities(new Map())
        setStatus('idle')
        setRefreshAt(null)
      }, 0)
      return () => window.clearTimeout(timer)
    }

    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      requestRef.current += 1
    }
  }, [enabled, load, normalizedAddresses.length])

  useEffect(() => {
    if (!enabled || normalizedAddresses.length === 0 || refreshAt === null) return
    const timer = window.setTimeout(
      () => void load(),
      Math.max(0, refreshAt - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [enabled, load, normalizedAddresses.length, refreshAt])

  const identityFor = useCallback((address: string | null | undefined) => {
    if (!address || !isAddress(address)) return null
    return identities.get(address.toLowerCase()) ?? null
  }, [identities])

  return {
    identityFor,
    refresh: () => load(true),
    status,
  }
}

export function participantPresentation(
  fallbackIdentifier: string,
  identity: ParticipantIdentity | null,
): ParticipantPresentation {
  const identifier = identity?.address ?? fallbackIdentifier
  const addressLabel = shortIdentifier(identifier)
  const names = [
    identity?.ensName ?? null,
    identity?.basename ?? null,
  ].filter((value): value is string => Boolean(value))
  const labels = dedupeLabels([...names, addressLabel])
  const label = labels[0] ?? addressLabel
  const fnameHint = identity?.registeredFname
    ? `Registered fname @${identity.registeredFname}`
    : null
  const secondary = [
    fnameHint,
    ...labels.slice(1),
  ].filter((value): value is string => Boolean(value)).join(' · ') || addressLabel
  const title = dedupeLabels([
    ...names,
    ...(fnameHint ? [fnameHint] : []),
    identifier,
  ]).join(' · ')
  return { addressLabel, fnameHint, label, secondary, title }
}

async function fetchParticipantIdentities(
  addresses: `0x${string}`[],
): Promise<ParticipantBatchResult> {
  const { sdk } = await import('@farcaster/miniapp-sdk')
  const batches = Array.from(
    { length: Math.ceil(addresses.length / LOOKUP_BATCH_SIZE) },
    (_, index) => addresses.slice(
      index * LOOKUP_BATCH_SIZE,
      (index + 1) * LOOKUP_BATCH_SIZE,
    ),
  )
  const results = await Promise.allSettled(
    batches.map((batch) => fetchParticipantIdentityBatch(
      batch,
      (input, init) => sdk.quickAuth.fetch(input, init),
    )),
  )
  const identities = new Map<string, ParticipantIdentity | null>()
  let partial = false
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      partial = true
      continue
    }
    partial ||= result.value.partial
    for (const [address, identity] of result.value.identities) {
      identities.set(address, identity)
    }
  }
  if (results.length && !results.some((result) => result.status === 'fulfilled')) {
    throw new Error('Participant identity lookup is unavailable.')
  }
  return { identities, partial }
}

async function fetchParticipantIdentityBatch(
  addresses: `0x${string}`[],
  authenticatedFetch: typeof fetch,
): Promise<ParticipantBatchResult> {
  const key = addresses.join(',')
  const pending = inFlight.get(key)
  if (pending) return pending

  const request = (async () => {
    const response = await authenticatedFetch('/api/identities', {
      body: JSON.stringify({ addresses }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    if (!response.ok) throw new Error('Participant identity lookup is unavailable.')

    const parsed = parseParticipantResponse(await response.json(), addresses)
    const result = new Map<string, ParticipantIdentity | null>()
    for (const address of addresses) {
      result.set(address, parsed.identities.get(address) ?? null)
    }
    return { identities: result, partial: parsed.partial }
  })()
  inFlight.set(key, request)
  try {
    return await request
  } finally {
    inFlight.delete(key)
  }
}

function parseParticipantResponse(
  value: unknown,
  requestedAddresses: `0x${string}`[],
): { identities: Map<string, ParticipantIdentity>; partial: boolean } {
  if (!value || typeof value !== 'object' || !('identities' in value) ||
    !Array.isArray(value.identities) || !('partial' in value) ||
    typeof value.partial !== 'boolean') {
    throw new Error('Invalid participant identity response.')
  }

  const requested = new Set(requestedAddresses)
  const identities = new Map<string, ParticipantIdentity>()
  for (const candidate of value.identities) {
    if (!candidate || typeof candidate !== 'object' ||
      !('address' in candidate) || typeof candidate.address !== 'string' ||
      !isAddress(candidate.address)) continue
    const address = getAddress(candidate.address).toLowerCase() as `0x${string}`
    if (!requested.has(address)) continue

    const ensName = optionalName(candidate, 'ensName')
    const basename = optionalName(candidate, 'basename')
    const registeredFname = optionalName(candidate, 'registeredFname', 64)
    if (basename && !basename.toLowerCase().endsWith('.base.eth')) continue
    if (registeredFname && !isSafeDisplayName(registeredFname)) continue

    // The API returns one row per requested address so callers can preserve
    // ordering. An address-only row is not positive metadata: keeping it out
    // of this map lets complete responses become short-lived negative cache
    // entries while partial responses remain eligible for retry.
    if (!ensName && !basename && !registeredFname) continue

    identities.set(address, {
      address: getAddress(candidate.address),
      basename,
      ensName,
      registeredFname,
    })
  }
  return { identities, partial: value.partial }
}

function normalizeAddresses(
  values: Array<string | null | undefined>,
): `0x${string}`[] {
  const result = new Set<`0x${string}`>()
  for (const value of values) {
    if (!value || !isAddress(value)) continue
    result.add(getAddress(value).toLowerCase() as `0x${string}`)
    if (result.size === MAX_ADDRESSES) break
  }
  return [...result]
}

function optionalName(
  value: object,
  key: 'basename' | 'ensName' | 'registeredFname',
  maxLength = 255,
): string | null {
  const candidate = (value as Record<string, unknown>)[key]
  if (candidate === undefined || candidate === null) return null
  if (typeof candidate !== 'string') throw new Error('Invalid participant name.')
  const name = candidate.trim()
  if (!name || name.length > maxLength || hasControlCharacters(name)) {
    throw new Error('Invalid participant name.')
  }
  return name
}

function isSafeDisplayName(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u.test(value)
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

function cacheIdentity(
  address: string,
  identity: ParticipantIdentity | null,
  ttlMs = identity ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS,
): number {
  const expiresAt = Date.now() + ttlMs
  const entry = { expiresAt, identity }
  cache.set(address, entry)
  window.setTimeout(() => {
    if (cache.get(address) === entry) cache.delete(address)
  }, expiresAt - Date.now())
  return expiresAt
}

function dedupeLabels(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.replace(/^@/u, '').toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function shortIdentifier(value: string, left = 6, right = 4): string {
  if (value.length <= left + right + 1) return value
  return `${value.slice(0, left)}…${value.slice(-right)}`
}
