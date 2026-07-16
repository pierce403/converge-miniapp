import { useCallback, useEffect, useRef, useState } from 'react'
import { getAddress, isAddress } from 'viem'
import { normalize } from 'viem/ens'

export type RecipientResolution = {
  address: `0x${string}`
  name: string
}

export type RecipientResolutionErrorCode =
  | 'invalid-query'
  | 'unresolved'
  | 'unauthorized'
  | 'rate-limited'
  | 'unavailable'
  | 'network'
  | 'invalid-response'

export type RecipientResolutionStatus =
  | 'idle'
  | 'resolving'
  | 'resolved'
  | 'none'
  | 'error'

type RecipientResolutionState = {
  error: string | null
  errorCode: RecipientResolutionErrorCode | null
  query: string | null
  result: RecipientResolution | null
  status: RecipientResolutionStatus
}

const initialState: RecipientResolutionState = {
  error: null,
  errorCode: null,
  query: null,
  result: null,
  status: 'idle',
}

const errorMessages: Record<RecipientResolutionErrorCode, string> = {
  'invalid-query': 'Enter a complete ENS name, like alice.eth.',
  'invalid-response': 'ENS lookup returned an invalid response. Try again.',
  network: 'Could not reach ENS lookup. Check your connection and try again.',
  'rate-limited': 'Too many ENS lookups. Wait a moment and try again.',
  unauthorized: 'Farcaster authorization could not be verified. Try again.',
  unavailable: 'ENS lookup is temporarily unavailable. Try again.',
  unresolved: 'That ENS name does not resolve to an Ethereum address.',
}

class ResolutionFailure extends Error {
  readonly code: RecipientResolutionErrorCode

  constructor(code: RecipientResolutionErrorCode) {
    super(errorMessages[code])
    this.code = code
  }
}

export function useRecipientResolution() {
  const abortRef = useRef<AbortController | null>(null)
  const requestRef = useRef(0)
  const inFlightRef = useRef<{
    promise: Promise<RecipientResolution | null>
    query: string
  } | null>(null)
  const [state, setState] = useState<RecipientResolutionState>(initialState)

  useEffect(() => () => {
    requestRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = null
  }, [])

  const reset = useCallback(() => {
    requestRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = null
    setState(initialState)
  }, [])

  const resolve = useCallback((input: string): Promise<RecipientResolution | null> => {
    let query: string
    try {
      query = normalizeRecipientQuery(input)
    } catch {
      requestRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
      inFlightRef.current = null
      setFailure(setState, 'invalid-query', null)
      return Promise.resolve(null)
    }

    const existing = inFlightRef.current
    if (existing?.query === query) return existing.promise

    const request = ++requestRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({
      error: null,
      errorCode: null,
      query,
      result: null,
      status: 'resolving',
    })

    const promise = (async () => {
      try {
        const { sdk } = await import('@farcaster/miniapp-sdk')
        if (requestRef.current !== request) return null

        const response = await sdk.quickAuth.fetch('/api/resolve', {
          body: JSON.stringify({ query }),
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          method: 'POST',
          signal: controller.signal,
        })
        if (requestRef.current !== request) return null
        if (!response.ok) throw failureForStatus(response.status)

        let value: unknown
        try {
          value = await response.json()
        } catch {
          throw new ResolutionFailure('invalid-response')
        }
        const parsed = parseResolutionResponse(value, query)
        if (requestRef.current !== request) return null

        if (parsed.status === 'none') {
          setFailure(setState, 'unresolved', query, 'none')
          return null
        }

        setState({
          error: null,
          errorCode: null,
          query,
          result: parsed.ens,
          status: 'resolved',
        })
        return parsed.ens
      } catch (error) {
        if (requestRef.current !== request || controller.signal.aborted) return null
        const code = error instanceof ResolutionFailure ? error.code : 'network'
        setFailure(setState, code, query)
        return null
      } finally {
        if (requestRef.current === request) {
          abortRef.current = null
          inFlightRef.current = null
        }
      }
    })()

    inFlightRef.current = { promise, query }
    return promise
  }, [])

  return {
    ...state,
    reset,
    resolve,
  }
}

function normalizeRecipientQuery(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || utf8Length(trimmed) > 255 || hasControlCharacters(trimmed)) {
    throw new ResolutionFailure('invalid-query')
  }

  const normalized = normalize(trimmed)
  if (utf8Length(normalized) > 255 || !normalized.includes('.') ||
    normalized.startsWith('.') || normalized.endsWith('.')) {
    throw new ResolutionFailure('invalid-query')
  }
  return normalized
}

function parseResolutionResponse(
  value: unknown,
  query: string,
): { status: 'none'; ens: null } | { status: 'resolved'; ens: RecipientResolution } {
  if (!value || typeof value !== 'object' || !('status' in value) ||
    !('ens' in value)) {
    throw new ResolutionFailure('invalid-response')
  }

  if (value.status === 'none') {
    if (value.ens !== null) throw new ResolutionFailure('invalid-response')
    return { ens: null, status: 'none' }
  }

  if (value.status !== 'resolved' || !value.ens || typeof value.ens !== 'object' ||
    !('name' in value.ens) || typeof value.ens.name !== 'string' ||
    !('address' in value.ens) || typeof value.ens.address !== 'string') {
    throw new ResolutionFailure('invalid-response')
  }

  let name: string
  try {
    name = normalizeRecipientQuery(value.ens.name)
  } catch {
    throw new ResolutionFailure('invalid-response')
  }
  if (name !== query || !isAddress(value.ens.address)) {
    throw new ResolutionFailure('invalid-response')
  }

  return {
    ens: {
      address: getAddress(value.ens.address),
      name,
    },
    status: 'resolved',
  }
}

function failureForStatus(status: number): ResolutionFailure {
  if (status === 400) return new ResolutionFailure('invalid-query')
  if (status === 401) return new ResolutionFailure('unauthorized')
  if (status === 429) return new ResolutionFailure('rate-limited')
  return new ResolutionFailure('unavailable')
}

function setFailure(
  setState: (state: RecipientResolutionState) => void,
  code: RecipientResolutionErrorCode,
  query: string | null,
  status: 'none' | 'error' = 'error',
): void {
  setState({
    error: errorMessages[code],
    errorCode: code,
    query,
    result: null,
    status,
  })
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
  })
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
