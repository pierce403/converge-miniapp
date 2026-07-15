import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRecipientResolution } from './useRecipientResolution'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@farcaster/miniapp-sdk', () => ({
  sdk: { quickAuth: { fetch: mocks.fetch } },
}))

const address = '0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3'

describe('useRecipientResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetch.mockReset()
  })

  it('resolves only when invoked and returns a normalized name and checksummed address', async () => {
    mocks.fetch.mockResolvedValue(Response.json({
      ens: {
        address: address.toLowerCase(),
        name: 'DeanPierce.eth',
      },
      status: 'resolved',
    }))
    const { result } = renderHook(() => useRecipientResolution())

    expect(mocks.fetch).not.toHaveBeenCalled()
    let resolved = null
    await act(async () => {
      resolved = await result.current.resolve('  DeanPierce.eth  ')
    })

    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/resolve', {
      body: JSON.stringify({ query: 'deanpierce.eth' }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: expect.any(AbortSignal),
    })
    expect(resolved).toEqual({ address, name: 'deanpierce.eth' })
    expect(result.current).toMatchObject({
      error: null,
      errorCode: null,
      query: 'deanpierce.eth',
      result: { address, name: 'deanpierce.eth' },
      status: 'resolved',
    })
  })

  it.each([
    ['', 'invalid-query'],
    ['alice', 'invalid-query'],
    ['alice..eth', 'invalid-query'],
    [`${'a'.repeat(252)}.eth`, 'invalid-query'],
    [`${'é'.repeat(126)}.eth`, 'invalid-query'],
    ['alice.\neth', 'invalid-query'],
  ] as const)('rejects invalid bounded input %j without a request', async (query, code) => {
    const { result } = renderHook(() => useRecipientResolution())

    await act(async () => {
      expect(await result.current.resolve(query)).toBeNull()
    })

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({
      error: 'Enter a complete ENS name, like alice.eth.',
      errorCode: code,
      status: 'error',
    })
  })

  it('reports a valid unresolved response without accepting an address', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ ens: null, status: 'none' }))
    const { result } = renderHook(() => useRecipientResolution())

    await act(async () => {
      expect(await result.current.resolve('nobody.eth')).toBeNull()
    })

    expect(result.current).toMatchObject({
      error: 'That ENS name does not resolve to an Ethereum address.',
      errorCode: 'unresolved',
      query: 'nobody.eth',
      result: null,
      status: 'none',
    })
  })

  it.each([
    [400, 'invalid-query', 'Enter a complete ENS name, like alice.eth.'],
    [401, 'unauthorized', 'Farcaster authorization expired. Try again.'],
    [429, 'rate-limited', 'Too many ENS lookups. Wait a moment and try again.'],
    [503, 'unavailable', 'ENS lookup is temporarily unavailable. Try again.'],
  ] as const)('maps HTTP %s to a user-facing error', async (status, code, message) => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: code }), {
      status,
    }))
    const { result } = renderHook(() => useRecipientResolution())

    await act(async () => {
      expect(await result.current.resolve('alice.eth')).toBeNull()
    })

    expect(result.current).toMatchObject({ error: message, errorCode: code, status: 'error' })
  })

  it('maps network failure to a concise error', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('private network detail'))
    const { result } = renderHook(() => useRecipientResolution())

    await act(async () => {
      expect(await result.current.resolve('alice.eth')).toBeNull()
    })

    expect(result.current).toMatchObject({
      error: 'Could not reach ENS lookup. Check your connection and try again.',
      errorCode: 'network',
      status: 'error',
    })
  })

  it.each([
    { ens: null, status: 'resolved' },
    { ens: { address, name: 'other.eth' }, status: 'resolved' },
    { ens: { address: 'not-an-address', name: 'alice.eth' }, status: 'resolved' },
    { ens: { address, name: 'alice.eth' }, status: 'unexpected' },
    { status: 'none' },
  ])('rejects an invalid or mismatched response %#', async (response) => {
    mocks.fetch.mockResolvedValue(Response.json(response))
    const { result } = renderHook(() => useRecipientResolution())

    await act(async () => {
      expect(await result.current.resolve('alice.eth')).toBeNull()
    })

    expect(result.current).toMatchObject({
      error: 'ENS lookup returned an invalid response. Try again.',
      errorCode: 'invalid-response',
      result: null,
      status: 'error',
    })
  })

  it('deduplicates the same normalized query while it is in flight', async () => {
    let finish!: (response: Response) => void
    mocks.fetch.mockReturnValue(new Promise<Response>((resolve) => {
      finish = resolve
    }))
    const { result } = renderHook(() => useRecipientResolution())

    let first!: Promise<unknown>
    let second!: Promise<unknown>
    act(() => {
      first = result.current.resolve('Alice.eth')
      second = result.current.resolve(' alice.eth ')
    })

    expect(first).toBe(second)
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())

    await act(async () => {
      finish(Response.json({ ens: { address, name: 'alice.eth' }, status: 'resolved' }))
      await first
    })
    expect(result.current.status).toBe('resolved')
  })

  it('suppresses a stale response after a newer query resolves', async () => {
    const requests = new Map<string, (response: Response) => void>()
    mocks.fetch.mockImplementation((_input: string, init: RequestInit) => (
      new Promise<Response>((resolve) => {
        const query = (JSON.parse(String(init.body)) as { query: string }).query
        requests.set(query, resolve)
      })
    ))
    const { result } = renderHook(() => useRecipientResolution())

    let stale!: Promise<unknown>
    let current!: Promise<unknown>
    act(() => {
      stale = result.current.resolve('first.eth')
    })
    await waitFor(() => expect(requests.has('first.eth')).toBe(true))
    act(() => {
      current = result.current.resolve('second.eth')
    })
    await waitFor(() => expect(requests.has('second.eth')).toBe(true))

    await act(async () => {
      requests.get('second.eth')!(Response.json({
        ens: { address, name: 'second.eth' },
        status: 'resolved',
      }))
      await current
    })
    await act(async () => {
      requests.get('first.eth')!(Response.json({ ens: null, status: 'none' }))
      await stale
    })

    expect(result.current).toMatchObject({
      error: null,
      query: 'second.eth',
      result: { address, name: 'second.eth' },
      status: 'resolved',
    })
  })

  it('reset cancels an active request and clears its state', async () => {
    let finish!: (response: Response) => void
    mocks.fetch.mockReturnValue(new Promise<Response>((resolve) => {
      finish = resolve
    }))
    const { result } = renderHook(() => useRecipientResolution())

    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.resolve('alice.eth')
    })
    await waitFor(() => expect(result.current.status).toBe('resolving'))
    act(() => result.current.reset())

    expect(result.current).toMatchObject(initialPublicState())
    await act(async () => {
      finish(Response.json({ ens: { address, name: 'alice.eth' }, status: 'resolved' }))
      await pending
    })
    expect(result.current).toMatchObject(initialPublicState())
  })
})

function initialPublicState() {
  return {
    error: null,
    errorCode: null,
    query: null,
    result: null,
    status: 'idle',
  }
}
