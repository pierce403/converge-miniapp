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
  const [initiallyDismissed] = useState(() => readLocalDismissal(fid))
  const suppressAutomaticLookupRef = useRef(initiallyDismissed)
  const [state, setState] = useState<EnsIdentityState>(() => (
    initiallyDismissed
      ? { ...initialState, preference: 'dismissed' }
      : initialState
  ))

  const load = useCallback(async () => {
    if (!enabled) return
    const request = ++requestRef.current
    setState((current) => ({ ...current, status: 'checking' }))

    try {
      const { sdk } = await import('@farcaster/miniapp-sdk')
      const response = await sdk.quickAuth.fetch('/api/me/ens', {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('ENS identity lookup is unavailable.')
      const result = parseIdentityResponse(await response.json())
      if (requestRef.current !== request) return

      if (result.status !== 'available' || !result.candidate) {
        setState({
          candidate: null,
          preference: result.preference,
          relationship: null,
          status: result.status === 'none' ? 'none' : 'unavailable',
        })
        return
      }

      let relationship: EnsRelationship
      try {
        relationship = await inspectRelationship(result.candidate.address)
      } catch {
        relationship = 'unavailable'
      }
      if (requestRef.current === request) {
        setState({
          candidate: result.candidate,
          preference: result.preference,
          relationship,
          status: 'ready',
        })
      }
    } catch {
      if (requestRef.current === request) {
        setState((current) => ({
          ...current,
          candidate: null,
          relationship: null,
          status: 'unavailable',
        }))
      }
    }
  }, [enabled, inspectRelationship])

  useEffect(() => {
    if (!enabled) {
      requestRef.current += 1
      const resetTimer = window.setTimeout(() => setState(
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
  }, [enabled, load])

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
    setState((current) => ({ ...current, preference: choice }))
  }, [fid, state.candidate])

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
    setState((current) => ({ ...current, preference: null }))
  }, [fid])

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
