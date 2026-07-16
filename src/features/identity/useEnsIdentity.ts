import { useCallback, useEffect, useRef, useState } from 'react'
import { getAddress, isAddress } from 'viem'

import type { XmtpIdentityRelationship } from '../../lib/xmtp/session'

export type EnsCandidate = {
  address: `0x${string}`
  name: string
}

export type EnsPreference = 'accepted' | 'dismissed' | null
export type EnsRelationship = XmtpIdentityRelationship | 'unavailable'

export type EnsIdentityState = {
  candidate: EnsCandidate | null
  preference: EnsPreference
  relationship: EnsRelationship | null
  status: 'idle' | 'checking' | 'ready' | 'none' | 'unavailable'
}

export type EnsIdentityRefreshResult = EnsIdentityState | null

type UseEnsIdentityOptions = {
  enabled: boolean
  fid: number
  inspectRelationship: (
    address: `0x${string}`,
  ) => Promise<XmtpIdentityRelationship>
}

const initialState: EnsIdentityState = {
  candidate: null,
  preference: null,
  relationship: null,
  status: 'idle',
}

export function useEnsIdentity({
  enabled,
  fid,
  inspectRelationship,
}: UseEnsIdentityOptions) {
  const requestRef = useRef(0)
  const fidRef = useRef(fid)
  const [initiallySuppressed] = useState(() => readLocalDismissal(fid))
  const suppressAutomaticLookupRef = useRef(initiallySuppressed)
  const [state, setState] = useState<EnsIdentityState>(() => (
    initiallySuppressed
      ? { ...initialState, preference: 'dismissed' }
      : initialState
  ))
  const stateRef = useRef(state)

  const commitState = useCallback((next: EnsIdentityState) => {
    stateRef.current = next
    setState(next)
    return next
  }, [])

  const updateState = useCallback((
    update: (current: EnsIdentityState) => EnsIdentityState,
  ) => commitState(update(stateRef.current)), [commitState])

  const load = useCallback(async (): Promise<EnsIdentityRefreshResult> => {
    if (!enabled) return null
    const request = ++requestRef.current
    const requestFid = fid
    const isStale = () => requestRef.current !== request || fidRef.current !== requestFid
    updateState((current) => ({ ...current, status: 'checking' }))

    try {
      const { sdk } = await import('@farcaster/miniapp-sdk')
      const response = await sdk.quickAuth.fetch('/api/me/ens', {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('ENS identity lookup is unavailable.')
      const result = parseIdentityResponse(await response.json())
      if (isStale()) return null

      if (result.status !== 'available' || !result.candidate) {
        return commitState({
          candidate: null,
          preference: result.preference,
          relationship: null,
          status: result.status === 'none' ? 'none' : 'unavailable',
        })
      }

      let relationship: EnsRelationship
      try {
        relationship = await inspectRelationship(result.candidate.address)
      } catch {
        relationship = 'unavailable'
      }
      if (isStale()) return null
      return commitState({
        candidate: result.candidate,
        preference: result.preference,
        relationship,
        status: 'ready',
      })
    } catch {
      if (isStale()) return null
      return updateState((current) => ({
        ...current,
        candidate: null,
        relationship: null,
        status: 'unavailable',
      }))
    }
  }, [commitState, enabled, fid, inspectRelationship, updateState])

  useEffect(() => {
    if (fidRef.current === fid) return
    fidRef.current = fid
    requestRef.current += 1
    const dismissed = readLocalDismissal(fid)
    suppressAutomaticLookupRef.current = dismissed
    commitState(dismissed
      ? { ...initialState, preference: 'dismissed' }
      : initialState)
  }, [commitState, fid])

  useEffect(() => {
    if (!enabled) {
      requestRef.current += 1
      const resetTimer = window.setTimeout(() => commitState(
        suppressAutomaticLookupRef.current
          ? { ...initialState, preference: 'dismissed' }
          : initialState,
      ), 0)
      return () => window.clearTimeout(resetTimer)
    }
    if (suppressAutomaticLookupRef.current) return

    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      requestRef.current += 1
    }
  }, [commitState, enabled, load])

  const setPreference = useCallback(async (
    choice: Exclude<EnsPreference, null>,
  ) => {
    if (!state.candidate) throw new Error('No ENS identity is available.')

    const { sdk } = await import('@farcaster/miniapp-sdk')
    const response = await sdk.quickAuth.fetch('/api/me/ens-preference', {
      body: JSON.stringify({ choice }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    if (!response.ok) {
      throw new Error('The ENS preference could not be saved for your Farcaster account.')
    }
    if (choice === 'dismissed') {
      suppressAutomaticLookupRef.current = true
      writeLocalDismissal(fid, true)
    } else {
      suppressAutomaticLookupRef.current = false
      writeLocalDismissal(fid, false)
    }
    updateState((current) => ({ ...current, preference: choice }))
  }, [fid, state.candidate, updateState])

  const clearPreference = useCallback(async () => {
    const { sdk } = await import('@farcaster/miniapp-sdk')
    const response = await sdk.quickAuth.fetch('/api/me', {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error('The saved ENS preference could not be deleted.')
    }
    suppressAutomaticLookupRef.current = false
    writeLocalDismissal(fid, false)
    updateState((current) => ({ ...current, preference: null }))
  }, [fid, updateState])

  return {
    ...state,
    clearPreference,
    refresh: load,
    setPreference,
  }
}

function localDismissalKey(fid: number): string | null {
  return Number.isSafeInteger(fid) && fid > 0
    ? `converge-miniapp:ens-offer-dismissed:${fid}`
    : null
}

function readLocalDismissal(fid: number): boolean {
  const key = localDismissalKey(fid)
  if (!key) return false
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeLocalDismissal(fid: number, dismissed: boolean): void {
  const key = localDismissalKey(fid)
  if (!key) return
  try {
    if (dismissed) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    // D1 remains authoritative if this browser disables local storage.
  }
}

export function allowAutomaticEnsDiscovery(fid: number): void {
  writeLocalDismissal(fid, false)
}

function parseIdentityResponse(value: unknown): {
  candidate: EnsCandidate | null
  preference: EnsPreference
  status: 'available' | 'none' | 'unavailable'
} {
  if (!value || typeof value !== 'object') throw new Error('Invalid ENS response.')
  if (!('status' in value) || !['available', 'none', 'unavailable'].includes(
    String(value.status),
  )) throw new Error('Invalid ENS response.')
  const status = value.status as 'available' | 'none' | 'unavailable'
  const preference = 'preference' in value && (
    value.preference === 'accepted' || value.preference === 'dismissed'
  ) ? value.preference : null

  if (status !== 'available') return { candidate: null, preference, status }
  if (!('ens' in value) || !value.ens || typeof value.ens !== 'object') {
    throw new Error('Invalid ENS response.')
  }
  if (!('address' in value.ens) || typeof value.ens.address !== 'string') {
    throw new Error('Invalid ENS response.')
  }
  if (!isAddress(value.ens.address)) throw new Error('Invalid ENS response.')
  if (!('name' in value.ens) || typeof value.ens.name !== 'string') {
    throw new Error('Invalid ENS response.')
  }
  const name = value.ens.name.trim()
  if (!name || name.length > 255) throw new Error('Invalid ENS response.')

  return {
    candidate: { address: getAddress(value.ens.address), name },
    preference,
    status,
  }
}
