import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEnsIdentity } from './useEnsIdentity'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@farcaster/miniapp-sdk', () => ({
  sdk: { quickAuth: { fetch: mocks.fetch } },
}))

const address = '0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3' as const
const availableResponse = {
  ens: { address, name: 'deanpierce.eth' },
  preference: null,
  status: 'available',
}

describe('useEnsIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetch.mockReset()
    window.localStorage.clear()
  })

  it('discovers and inspects the ENS identity once through Strict Mode', async () => {
    mocks.fetch.mockResolvedValue(Response.json(availableResponse))
    const inspectRelationship = vi.fn().mockResolvedValue('active-address')
    const { result } = renderHook(() => useEnsIdentity({
      enabled: true,
      fid: 8531,
      inspectRelationship,
    }), { wrapper: StrictMode })

    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/me/ens', expect.any(Object))
    expect(inspectRelationship).toHaveBeenCalledWith(address)
    expect(result.current).toMatchObject({
      candidate: availableResponse.ens,
      preference: null,
      relationship: 'active-address',
    })
  })

  it('stores a decline for the authenticated Farcaster account', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(availableResponse))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const inspectRelationship = vi.fn().mockResolvedValue('same-inbox')
    const { result } = renderHook(() => useEnsIdentity({
      enabled: true,
      fid: 8531,
      inspectRelationship,
    }))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => result.current.setPreference('dismissed'))

    expect(result.current.preference).toBe('dismissed')
    expect(mocks.fetch).toHaveBeenLastCalledWith('/api/me/ens-preference', {
      body: JSON.stringify({ choice: 'dismissed' }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
  })

  it('deletes the account-wide preference through the authenticated API', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({
        ...availableResponse,
        preference: 'dismissed',
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const inspectRelationship = vi.fn().mockResolvedValue('active-address')
    const { result } = renderHook(() => useEnsIdentity({
      enabled: true,
      fid: 8531,
      inspectRelationship,
    }))
    await waitFor(() => expect(result.current.preference).toBe('dismissed'))

    await act(async () => result.current.clearPreference())

    expect(result.current.preference).toBeNull()
    expect(mocks.fetch).toHaveBeenLastCalledWith('/api/me', {
      method: 'DELETE',
    })
  })

  it('keeps the offer visible when the account-wide preference write fails', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(availableResponse))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const inspectRelationship = vi.fn().mockResolvedValue('active-address')
    const { result } = renderHook(() => useEnsIdentity({
      enabled: true,
      fid: 8531,
      inspectRelationship,
    }))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await expect(act(async () => result.current.setPreference('dismissed')))
      .rejects.toThrow(/could not be saved/)

    expect(result.current.preference).toBeNull()
  })

  it('skips repeat background Quick Auth after a decline on this device', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(availableResponse))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const inspectRelationship = vi.fn().mockResolvedValue('active-address')
    const first = renderHook(() => useEnsIdentity({
      enabled: true,
      fid: 8531,
      inspectRelationship,
    }))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    await act(async () => first.result.current.setPreference('dismissed'))
    first.unmount()
    mocks.fetch.mockClear()

    const second = renderHook(({ enabled }) => useEnsIdentity({
      enabled,
      fid: 8531,
      inspectRelationship,
    }), { initialProps: { enabled: false } })
    await act(async () => Promise.resolve())
    second.rerender({ enabled: true })
    await act(async () => Promise.resolve())

    expect(second.result.current.preference).toBe('dismissed')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not block the inbox when authenticated discovery fails', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }))
    const inspectRelationship = vi.fn()
    const { result } = renderHook(() => useEnsIdentity({
      enabled: true,
      fid: 8531,
      inspectRelationship,
    }))

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.candidate).toBeNull()
  })
})
