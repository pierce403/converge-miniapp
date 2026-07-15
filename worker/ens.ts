import {
  createPublicClient,
  fallback,
  getAddress,
  http,
  isAddress,
} from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

export type EnsCandidate = {
  address: `0x${string}`
  name: string
}

export type EnsDiscovery = {
  candidate: EnsCandidate | null
  status: 'available' | 'none' | 'unavailable'
}

type EnsResolver = {
  getEnsAddress: (name: string) => Promise<`0x${string}` | null>
  getEnsName: (address: `0x${string}`) => Promise<string | null>
}

type DiscoverEnsOptions = {
  fetcher?: typeof fetch
  resolver?: EnsResolver
}

export async function discoverEnsIdentity(
  fid: number,
  rpcUrls: string,
  options: DiscoverEnsOptions = {},
): Promise<EnsDiscovery> {
  try {
    const fetcher = options.fetcher ?? fetch
    const response = await fetcher(
      `https://api.farcaster.xyz/fc/primary-address?fid=${fid}&protocol=ethereum`,
      {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      },
    )
    if (response.status === 404) return { candidate: null, status: 'none' }
    if (!response.ok) return { candidate: null, status: 'unavailable' }

    const body: unknown = await response.json()
    const record = primaryAddressRecord(body)
    if (!record) return { candidate: null, status: 'none' }
    if (record.fid !== fid || record.protocol !== 'ethereum' || !isAddress(record.address)) {
      return { candidate: null, status: 'unavailable' }
    }

    const address = getAddress(record.address)
    const resolver = options.resolver ?? createEnsResolver(rpcUrls)
    const reverseName = await resolver.getEnsName(address)
    if (!reverseName) return { candidate: null, status: 'none' }

    const name = normalize(reverseName)
    const forwardAddress = await resolver.getEnsAddress(name)
    if (!forwardAddress || forwardAddress.toLowerCase() !== address.toLowerCase()) {
      return { candidate: null, status: 'none' }
    }

    return {
      candidate: { address, name },
      status: 'available',
    }
  } catch {
    return { candidate: null, status: 'unavailable' }
  }
}

function primaryAddressRecord(value: unknown): {
  address: string
  fid: number
  protocol: string
} | null {
  if (!value || typeof value !== 'object' || !('result' in value)) return null
  const result = value.result
  if (!result || typeof result !== 'object' || !('address' in result)) return null
  const address = result.address
  if (!address || typeof address !== 'object') return null
  if (!('address' in address) || typeof address.address !== 'string') return null
  if (!('fid' in address) || typeof address.fid !== 'number') return null
  if (!('protocol' in address) || typeof address.protocol !== 'string') return null
  return {
    address: address.address,
    fid: address.fid,
    protocol: address.protocol,
  }
}

function createEnsResolver(configuredUrls: string): EnsResolver {
  const urls = configuredUrls
    .split(',')
    .map((value) => value.trim())
    .filter((value) => {
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    })
    .slice(0, 3)
  if (!urls.length) throw new Error('No HTTPS ENS RPC is configured.')

  const transports = urls.map((url) => http(url, { timeout: 6_000 }))
  const transport = transports.length === 1 ? transports[0]! : fallback(transports)
  const client = createPublicClient({ chain: mainnet, transport })
  return {
    getEnsAddress: (name) => client.getEnsAddress({ name }),
    getEnsName: (address) => client.getEnsName({ address }),
  }
}
