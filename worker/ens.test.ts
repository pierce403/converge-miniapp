// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { discoverEnsIdentity } from './ens.js'

const fid = 8531
const address = '0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3' as const

function primaryAddressResponse(value: string = address) {
  return Response.json({
    result: {
      address: {
        address: value,
        fid,
        protocol: 'ethereum',
      },
    },
  })
}

describe('Farcaster primary-address ENS discovery', () => {
  it('returns a normalized ENS name only after forward verification', async () => {
    const fetcher = vi.fn().mockResolvedValue(primaryAddressResponse())
    const resolver = {
      getEnsAddress: vi.fn().mockResolvedValue(address),
      getEnsName: vi.fn().mockResolvedValue('deanpierce.eth'),
    }

    await expect(discoverEnsIdentity(fid, 'https://rpc.example', {
      fetcher,
      resolver,
    })).resolves.toEqual({
      candidate: { address, name: 'deanpierce.eth' },
      status: 'available',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.farcaster.xyz/fc/primary-address?fid=8531&protocol=ethereum',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
    expect(resolver.getEnsAddress).toHaveBeenCalledWith('deanpierce.eth')
  })

  it('does not accept a reverse name that resolves to another address', async () => {
    const resolver = {
      getEnsAddress: vi.fn().mockResolvedValue(
        '0x1111111111111111111111111111111111111111',
      ),
      getEnsName: vi.fn().mockResolvedValue('spoofed.eth'),
    }

    await expect(discoverEnsIdentity(fid, 'https://rpc.example', {
      fetcher: vi.fn().mockResolvedValue(primaryAddressResponse()),
      resolver,
    })).resolves.toEqual({ candidate: null, status: 'none' })
  })

  it('fails closed when Farcaster or ENS resolution is unavailable', async () => {
    await expect(discoverEnsIdentity(fid, 'https://rpc.example', {
      fetcher: vi.fn().mockRejectedValue(new Error('offline')),
    })).resolves.toEqual({ candidate: null, status: 'unavailable' })

    await expect(discoverEnsIdentity(fid, 'https://rpc.example', {
      fetcher: vi.fn().mockResolvedValue(primaryAddressResponse('invalid-address')),
    })).resolves.toEqual({ candidate: null, status: 'unavailable' })
  })
})
