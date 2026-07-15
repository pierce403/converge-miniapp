// @vitest-environment node
import { getAddress, toCoinType, type Address } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, it, vi } from 'vitest'

import { resolveParticipantIdentities } from './participantIdentities.js'

const address = getAddress('0x7ab874eeef0169ada0d225e9801a3ffffa26aac3')
const secondAddress = getAddress('0x1111111111111111111111111111111111111111')
const baseCoinType = toCoinType(base.id)

describe('participant identity resolution', () => {
  it('resolves ENS, Basename, and a noncanonical registered fname', async () => {
    const resolver = {
      getEnsName: vi.fn(async (_address: Address, coinType: bigint) => (
        coinType === baseCoinType ? 'alice.base.eth' : 'Alice.eth'
      )),
      getFids: vi.fn().mockResolvedValue([8531n]),
    }
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      transfer: {
        from: 0,
        owner: address,
        to: 8531,
        username: 'alice',
      },
    }))

    await expect(resolveParticipantIdentities(
      [address],
      'https://rpc.example',
      { fetcher, resolver },
    )).resolves.toEqual({
      identities: [{
        address,
        ensName: 'alice.eth',
        basename: 'alice.base.eth',
        registeredFname: 'alice',
        farcasterFid: 8531,
      }],
      status: 'complete',
    })
    expect(resolver.getEnsName).toHaveBeenCalledWith(address, 60n)
    expect(resolver.getEnsName).toHaveBeenCalledWith(address, baseCoinType)
    expect(resolver.getFids).toHaveBeenCalledWith([address])
    expect(fetcher).toHaveBeenCalledWith(
      'https://fnames.farcaster.xyz/transfers/current?fid=8531',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('returns ENS and Basename results when the optional Base source is absent', async () => {
    const resolver = {
      getEnsName: vi.fn(async (_address: Address, coinType: bigint) => (
        coinType === baseCoinType ? 'alice.base.eth' : 'alice.eth'
      )),
    }

    await expect(resolveParticipantIdentities(
      [address],
      'https://rpc.example',
      { resolver },
    )).resolves.toEqual({
      identities: [{
        address,
        ensName: 'alice.eth',
        basename: 'alice.base.eth',
        registeredFname: null,
        farcasterFid: null,
      }],
      status: 'complete',
    })
  })

  it('reports unavailable when no identity source is configured', async () => {
    await expect(resolveParticipantIdentities(
      [address],
      undefined,
      { resolver: {} },
    )).resolves.toEqual({
      identities: [{
        address,
        ensName: null,
        basename: null,
        registeredFname: null,
        farcasterFid: null,
      }],
      status: 'unavailable',
    })
  })

  it('classifies Base fallback names without inventing a Basename', async () => {
    const resolver = {
      getEnsName: vi.fn().mockResolvedValue('fallback.eth'),
      getFids: vi.fn().mockRejectedValue(new Error('Base unavailable')),
    }

    await expect(resolveParticipantIdentities(
      [address],
      'https://rpc.example',
      { resolver },
    )).resolves.toEqual({
      identities: [{
        address,
        ensName: 'fallback.eth',
        basename: null,
        registeredFname: null,
        farcasterFid: null,
      }],
      status: 'partial',
    })
  })

  it('contains individual resolver failures and reports a partial batch', async () => {
    const resolver = {
      getEnsName: vi.fn(async (candidate: Address, coinType: bigint) => {
        if (candidate === address && coinType === 60n) {
          throw new Error('ENS unavailable')
        }
        if (candidate === address) return 'alice.base.eth'
        if (coinType === 60n) return 'not a valid ENS name'
        throw new Error('Base reverse unavailable')
      }),
      getFids: vi.fn().mockResolvedValue([0n, 44n]),
    }
    const fetcher = vi.fn().mockRejectedValue(new Error('FName unavailable'))

    await expect(resolveParticipantIdentities(
      [address, secondAddress],
      'https://rpc.example',
      { fetcher, resolver },
    )).resolves.toEqual({
      identities: [
        {
          address,
          ensName: null,
          basename: 'alice.base.eth',
          registeredFname: null,
          farcasterFid: null,
        },
        {
          address: secondAddress,
          ensName: null,
          basename: null,
          registeredFname: null,
          farcasterFid: 44,
        },
      ],
      status: 'partial',
    })
  })

  it('strictly validates registered fname responses while retaining resolved FIDs', async () => {
    const resolver = {
      getEnsName: vi.fn().mockResolvedValue(null),
      getFids: vi.fn().mockResolvedValue([5n, 6n]),
    }
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const fid = new URL(input.toString()).searchParams.get('fid')
      if (fid === '5') {
        return Response.json({ transfer: { to: 999, username: 'wrong-owner' } })
      }
      return Response.json({ transfer: { to: 6, username: 'Invalid Name' } })
    }) as typeof fetch

    await expect(resolveParticipantIdentities(
      [address, secondAddress],
      'https://rpc.example',
      { fetcher, resolver },
    )).resolves.toEqual({
      identities: [
        expect.objectContaining({
          address,
          registeredFname: null,
          farcasterFid: 5,
        }),
        expect.objectContaining({
          address: secondAddress,
          registeredFname: null,
          farcasterFid: 6,
        }),
      ],
      status: 'partial',
    })
  })

  it('reports unavailable only when every configured source fails', async () => {
    const resolver = {
      getEnsName: vi.fn().mockRejectedValue(new Error('ENS unavailable')),
      getFids: vi.fn().mockRejectedValue(new Error('Base unavailable')),
    }

    await expect(resolveParticipantIdentities(
      [address],
      'https://rpc.example',
      { resolver },
    )).resolves.toEqual({
      identities: [{
        address,
        ensName: null,
        basename: null,
        registeredFname: null,
        farcasterFid: null,
      }],
      status: 'unavailable',
    })
  })

  it('starts FID and fname work without waiting for ENS resolution', async () => {
    let releaseEns!: () => void
    const ensGate = new Promise<void>((resolve) => {
      releaseEns = resolve
    })
    const resolver = {
      getEnsName: vi.fn(async () => {
        await ensGate
        return null
      }),
      getFids: vi.fn().mockResolvedValue([8531n]),
    }
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      transfer: { to: 8531, username: 'alice' },
    }))

    const resolution = resolveParticipantIdentities(
      [address],
      'https://rpc.example',
      { fetcher, resolver },
    )
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    releaseEns()

    await expect(resolution).resolves.toMatchObject({
      identities: [{ registeredFname: 'alice' }],
      status: 'complete',
    })
  })

  it('normalizes and deduplicates addresses before resolving them', async () => {
    const resolver = {
      getEnsName: vi.fn().mockResolvedValue(null),
      getFids: vi.fn().mockResolvedValue([
        BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      ]),
    }

    await expect(resolveParticipantIdentities(
      [address.toLowerCase(), address, 'not-an-address'],
      'https://rpc.example',
      { resolver },
    )).resolves.toEqual({
      identities: [{
        address,
        ensName: null,
        basename: null,
        registeredFname: null,
        farcasterFid: null,
      }],
      status: 'complete',
    })
    expect(resolver.getFids).toHaveBeenCalledWith([address])
  })
})
