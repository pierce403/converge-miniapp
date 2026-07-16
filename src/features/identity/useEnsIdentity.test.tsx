import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEnsIdentity } from './useEnsIdentity'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@farcaster/miniapp-sdk', () => ({
  sdk: { quickAuth: { fetch: mocks.fetch } },
}))

const address = '0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3' as const
const secondAddress = '0x1111111111111111111111111111111111111111' as const
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

  it('resets discovery state when the mounted Farcaster FID changes', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(availableResponse))
      .mockResolvedValueOnce(Response.json({
        ens: { address: secondAddress, name: 'second.eth' },
        preference: null,
        status: 'available',
      }))
    const inspectRelationship = vi.fn()
      .mockResolvedValueOnce('active-address')
      .mockResolvedValueOnce('different-inbox')
    const hook = renderHook(({ fid }) => useEnsIdentity({
      enabled: true,
      fid,
      inspectRelationship,
    }), { initialProps: { fid: 8531 } })
    await waitFor(() => expect(hook.result.current.candidate?.name).toBe(
      'deanpierce.eth',
    ))

    hook.rerender({ fid: 8532 })

    await waitFor(() => expect(hook.result.current.candidate).toEqual({
      address: secondAddress,
      name: 'second.eth',
    }))
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('returns the exact different-inbox state committed by a fresh refresh', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(availableResponse))
      .mockResolvedValueOnce(Response.json({
        ens: { address: secondAddress, name: 'second.eth' },
        preference: 'accepted',
        status: 'available',
      }))
    const inspectRelationship = vi.fn()
      .mockResolvedValueOnce('active-address')
      .mockResolvedValueOnce('different-inbox')
    const { result } = renderHook(() => useEnsIdentity({
      enabled: true,
      fid: 8531,
      inspectRelationship,
    }))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let refreshed: Awaited<ReturnType<typeof result.current.refresh>> | undefined
    await act(async () => {
      refreshed = await result.current.refresh()
    })

    expect(refreshed).toEqual({
      candidate: { address: secondAddress, name: 'second.eth' },
      preference: 'accepted',
      relationship: 'different-inbox',
      status: 'ready',
    })
    expect(result.current).toMatchObject(refreshed!)
  })

  it('returns null when an overlapping refresh supersedes an older result', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(availableResponse))
    const inspectRelationship = vi.fn()
      .mockResolvedValueOnce('active-address')
      .mockResolvedValueOnce('different-inbox')
    const { result } = renderHook(() => useEnsIdentity({
      enabled: true,
      fid: 8531,
      inspectRelationship,
    }))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    const older = deferred<Response>()
    const newer = deferred<Response>()
    mocks.fetch
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    let olderRefresh!: ReturnType<typeof result.current.refresh>
    let newerRefresh!: ReturnType<typeof result.current.refresh>
    await act(async () => {
      olderRefresh = result.current.refresh()
      await Promise.resolve()
    })
    await act(async () => {
      newerRefresh = result.current.refresh()
      await Promise.resolve()
    })

    newer.resolve(Response.json({
      ens: { address: secondAddress, name: 'current.eth' },
      preference: null,
      status: 'available',
    }))
    let newerResult!: Awaited<typeof newerRefresh>
    await act(async () => {
      newerResult = await newerRefresh
    })

    older.resolve(Response.json({
      ens: { address, name: 'stale.eth' },
      preference: null,
      status: 'available',
    }))
    let olderResult!: Awaited<typeof olderRefresh>
    await act(async () => {
      olderResult = await olderRefresh
    })

    expect(olderResult).toBeNull()
    expect(newerResult).toEqual({
      candidate: { address: secondAddress, name: 'current.eth' },
      preference: null,
      relationship: 'different-inbox',
      status: 'ready',
    })
    expect(result.current.candidate).toEqual({
      address: secondAddress,
      name: 'current.eth',
    })
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
