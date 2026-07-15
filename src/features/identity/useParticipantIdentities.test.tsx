import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  participantPresentation,
  useParticipantIdentities,
} from './useParticipantIdentities'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@farcaster/miniapp-sdk', () => ({
  sdk: { quickAuth: { fetch: mocks.fetch } },
}))

const first = '0x1111111111111111111111111111111111111111'
const second = '0x2222222222222222222222222222222222222222'

describe('useParticipantIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetch.mockReset()
  })

  it('batches and deduplicates authenticated participant lookups', async () => {
    mocks.fetch.mockResolvedValue(Response.json({
      identities: [{
        address: first,
        basename: 'alice.base.eth',
        ensName: 'alice.eth',
        registeredFname: 'alice',
      }],
      partial: false,
    }))
    const { result } = renderHook(() => useParticipantIdentities({
      addresses: [first, first.toUpperCase(), second, 'not-an-address'],
      enabled: true,
    }))

    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/identities', expect.objectContaining({
      body: JSON.stringify({ addresses: [first, second] }),
      method: 'POST',
    }))
    expect(result.current.identityFor(first)).toMatchObject({
      ensName: 'alice.eth',
      registeredFname: 'alice',
    })
    expect(result.current.identityFor(second)).toBeNull()
  })

  it('keeps address-only UI available when lookup data is malformed', async () => {
    const third = '0x3333333333333333333333333333333333333333'
    mocks.fetch.mockResolvedValue(Response.json({ identities: 'bad', partial: false }))
    const { result } = renderHook(() => useParticipantIdentities({
      addresses: [third],
      enabled: true,
    }))

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.identityFor(third)).toBeNull()
  })

  it('can force a refresh after a cached result', async () => {
    const fourth = '0x4444444444444444444444444444444444444444'
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ identities: [], partial: false }))
      .mockResolvedValueOnce(Response.json({
        identities: [{
          address: fourth,
          basename: null,
          ensName: 'fresh.eth',
          registeredFname: null,
        }],
        partial: false,
      }))
    const { result } = renderHook(() => useParticipantIdentities({
      addresses: [fourth],
      enabled: true,
    }))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => result.current.refresh())

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(result.current.identityFor(fourth)?.ensName).toBe('fresh.eth')
  })

  it('keeps each first-party resolver request within its bounded batch', async () => {
    const addresses = Array.from({ length: 13 }, (_, index) => (
      `0x${(index + 80).toString(16).padStart(40, '0')}`
    ))
    mocks.fetch.mockImplementation(async () => Response.json({
      identities: [],
      partial: false,
    }))
    const { result } = renderHook(() => useParticipantIdentities({
      addresses,
      enabled: true,
    }))

    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    const batchSizes = mocks.fetch.mock.calls.map((call) => {
      const init = call[1] as RequestInit
      return (JSON.parse(String(init.body)) as { addresses: string[] }).addresses.length
    })
    expect(batchSizes).toEqual([12, 1])
  })

  it('does not negative-cache a partial resolver outage', async () => {
    const fifth = '0x5555555555555555555555555555555555555555'
    mocks.fetch
      .mockResolvedValueOnce(Response.json({
        identities: [{
          address: fifth,
          basename: null,
          ensName: null,
          registeredFname: null,
        }],
        partial: true,
      }))
      .mockResolvedValueOnce(Response.json({
        identities: [{
          address: fifth,
          basename: null,
          ensName: 'recovered.eth',
          registeredFname: null,
        }],
        partial: false,
      }))
    const firstLookup = renderHook(() => useParticipantIdentities({
      addresses: [fifth],
      enabled: true,
    }))
    await waitFor(() => expect(firstLookup.result.current.status).toBe('ready'))
    firstLookup.unmount()

    const secondLookup = renderHook(() => useParticipantIdentities({
      addresses: [fifth],
      enabled: true,
    }))
    await waitFor(() => expect(
      secondLookup.result.current.identityFor(fifth)?.ensName,
    ).toBe('recovered.eth'))

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('retries positive partial metadata after one minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const sixth = '0x6666666666666666666666666666666666666666'
    try {
      mocks.fetch
        .mockResolvedValueOnce(Response.json({
          identities: [{
            address: sixth,
            basename: null,
            ensName: 'partial.eth',
            registeredFname: null,
          }],
          partial: true,
        }))
        .mockResolvedValueOnce(Response.json({
          identities: [{
            address: sixth,
            basename: null,
            ensName: 'partial.eth',
            registeredFname: 'recovered',
          }],
          partial: false,
        }))
      const { result } = renderHook(() => useParticipantIdentities({
        addresses: [sixth],
        enabled: true,
      }))
      await waitFor(() => expect(
        result.current.identityFor(sixth)?.ensName,
      ).toBe('partial.eth'))

      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      await waitFor(() => expect(
        result.current.identityFor(sixth)?.registeredFname,
      ).toBe('recovered'))

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('participantPresentation', () => {
  it('uses verified names first and keeps a registered fname as a hint', () => {
    expect(participantPresentation(first, {
      address: first,
      basename: 'alice.base.eth',
      ensName: 'alice.eth',
      registeredFname: 'alice',
    })).toEqual({
      addressLabel: '0x1111…1111',
      fnameHint: 'Registered fname @alice',
      label: 'alice.eth',
      secondary: 'Registered fname @alice · alice.base.eth · 0x1111…1111',
      title: 'alice.eth · alice.base.eth · Registered fname @alice · 0x1111111111111111111111111111111111111111',
    })
  })

  it('does not promote a registered fname over the wallet identity', () => {
    const presentation = participantPresentation(first, {
      address: first,
      basename: null,
      ensName: 'alice.eth',
      registeredFname: 'alice',
    })

    expect(presentation.label).toBe('alice.eth')
    expect(presentation.secondary).toBe('Registered fname @alice · 0x1111…1111')
  })
})
