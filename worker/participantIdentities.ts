import {
  createPublicClient,
  fallback,
  getAddress,
  http,
  isAddress,
  parseAbi,
  toCoinType,
  type Address,
} from 'viem'
import { base, mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

const BASE_VERIFICATIONS_ADDRESS =
  '0xdB1eCF22d195dF9e03688C33707b19C68BdEd142' as const
const BASE_VERIFICATIONS_ABI = parseAbi([
  'function getFids(address[] verifiers) view returns (uint256[] fids)',
])
const BASE_COIN_TYPE = toCoinType(base.id)
const ETHEREUM_COIN_TYPE = 60n
const ENS_GATEWAY_URLS = ['https://ccip-v3.ens.xyz']
const FNAME_ENDPOINT = 'https://fnames.farcaster.xyz/transfers/current'
const FNAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,15}$/

export type ParticipantIdentity = {
  address: Address
  ensName: string | null
  basename: string | null
  /** Registry label only; this is not a canonical or selected Farcaster username. */
  registeredFname: string | null
  farcasterFid: number | null
}

export type ParticipantIdentityBatchStatus = 'complete' | 'partial' | 'unavailable'

export type ParticipantIdentityBatch = {
  identities: ParticipantIdentity[]
  status: ParticipantIdentityBatchStatus
}

export type ParticipantIdentityResolver = {
  getEnsName?: (address: Address, coinType: bigint) => Promise<string | null>
  getFids?: (addresses: readonly Address[]) => Promise<readonly bigint[]>
}

export type ResolveParticipantIdentitiesOptions = {
  baseRpcUrl?: string
  fetcher?: typeof fetch
  resolver?: ParticipantIdentityResolver
  signal?: AbortSignal
}

type ResolvedNames = Pick<ParticipantIdentity, 'ensName' | 'basename'>
type SourceStatus = ParticipantIdentityBatchStatus | 'disabled'

type NameBatchResult = {
  names: ResolvedNames[]
  status: ParticipantIdentityBatchStatus
}

type RegisteredFnameBatchResult = {
  fids: Array<number | null>
  names: Array<string | null>
  status: SourceStatus
}

export async function resolveParticipantIdentities(
  inputAddresses: readonly string[],
  mainnetRpcUrls?: string,
  options: ResolveParticipantIdentitiesOptions = {},
): Promise<ParticipantIdentityBatch> {
  const addresses = normalizeAddresses(inputAddresses)
  const identities = addresses.map(emptyIdentity)
  if (!addresses.length) return { identities, status: 'complete' }

  const resolver = options.resolver ?? createParticipantIdentityResolver(
    mainnetRpcUrls,
    options.baseRpcUrl,
  )
  const namePromise = resolveNameBatch(addresses, resolver.getEnsName)
  const registeredFnamePromise = resolveRegisteredFnameBatch(
    addresses,
    resolver.getFids,
    options.fetcher ?? fetch,
    Boolean(resolver.getFids || options.baseRpcUrl),
    options.signal,
  )
  const [nameBatch, registeredFnameBatch] = await Promise.all([
    namePromise,
    registeredFnamePromise,
  ])

  for (const [index, identity] of identities.entries()) {
    const resolvedNames = nameBatch.names[index]
    if (resolvedNames) {
      identity.ensName = resolvedNames.ensName
      identity.basename = resolvedNames.basename
    }
    identity.farcasterFid = registeredFnameBatch.fids[index] ?? null
    identity.registeredFname = registeredFnameBatch.names[index] ?? null
  }

  return {
    identities,
    status: combinedStatus([nameBatch.status, registeredFnameBatch.status]),
  }
}

async function resolveNameBatch(
  addresses: readonly Address[],
  getEnsName: ParticipantIdentityResolver['getEnsName'],
): Promise<NameBatchResult> {
  const names = addresses.map(emptyNames)
  if (!getEnsName) return { names, status: 'unavailable' }

  const results = await Promise.all(
    addresses.map((address) => resolveNames(address, getEnsName)),
  )
  let successes = 0
  let failures = 0
  for (const [index, result] of results.entries()) {
    const resolved = names[index]
    if (resolved) {
      resolved.ensName = result.names.ensName
      resolved.basename = result.names.basename
    }
    successes += result.successes
    failures += result.failures
  }
  return { names, status: sourceStatus(successes, failures) }
}

async function resolveNames(
  address: Address,
  getEnsName: NonNullable<ParticipantIdentityResolver['getEnsName']>,
): Promise<{ failures: number; names: ResolvedNames; successes: number }> {
  const [defaultResult, baseResult] = await Promise.allSettled([
    Promise.resolve().then(
      () => getEnsName(address, ETHEREUM_COIN_TYPE),
    ),
    Promise.resolve().then(
      () => getEnsName(address, BASE_COIN_TYPE),
    ),
  ] as const)
  const defaultName = settledName(defaultResult)
  const baseName = settledName(baseResult)
  const results = [defaultResult, baseResult]

  return {
    failures: results.filter((result) => result.status === 'rejected').length,
    names: {
      ensName: [defaultName, baseName].find(
        (name) => name !== null && !isBasename(name),
      ) ?? null,
      basename: [baseName, defaultName].find(
        (name) => name !== null && isBasename(name),
      ) ?? null,
    },
    successes: results.filter((result) => result.status === 'fulfilled').length,
  }
}

async function resolveRegisteredFnameBatch(
  addresses: readonly Address[],
  getFids: ParticipantIdentityResolver['getFids'],
  fetcher: typeof fetch,
  configured: boolean,
  signal?: AbortSignal,
): Promise<RegisteredFnameBatchResult> {
  const emptyResult = {
    fids: addresses.map(() => null),
    names: addresses.map(() => null),
    status: 'unavailable' as const,
  }
  if (!getFids) {
    return { ...emptyResult, status: configured ? 'unavailable' : 'disabled' }
  }

  let values: readonly bigint[]
  try {
    values = await Promise.resolve().then(() => getFids(addresses))
  } catch {
    return emptyResult
  }

  const fids = addresses.map((_, index) => validFid(values[index]))
  const uniqueFids = [...new Set(
    fids.filter((fid): fid is number => fid !== null),
  )]
  const results = await Promise.allSettled(
    uniqueFids.map((fid) => resolveRegisteredFname(fid, fetcher, signal)),
  )
  const fnameByFid = new Map<number, string | null>()
  for (const [index, result] of results.entries()) {
    const fid = uniqueFids[index]
    if (fid === undefined || result.status !== 'fulfilled') continue
    fnameByFid.set(fid, result.value)
  }

  const incompleteFidBatch = values.length !== addresses.length
  const failedFnameCount = results.filter(
    (result) => result.status === 'rejected',
  ).length
  const status = uniqueFids.length > 0 && failedFnameCount === uniqueFids.length
    ? 'unavailable'
    : incompleteFidBatch || failedFnameCount > 0 ? 'partial' : 'complete'
  return {
    fids,
    names: fids.map((fid) => fid === null ? null : fnameByFid.get(fid) ?? null),
    status,
  }
}

async function resolveRegisteredFname(
  fid: number,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<string | null> {
  const timeoutSignal = AbortSignal.timeout(5_000)
  const response = await fetcher(`${FNAME_ENDPOINT}?fid=${fid}`, {
    headers: { accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('FName Registry is unavailable.')
  const body: unknown = await response.json()
  return currentRegisteredFname(body, fid)
}

function currentRegisteredFname(value: unknown, fid: number): string | null {
  if (!value || typeof value !== 'object' || !('transfer' in value)) {
    throw new Error('Invalid FName Registry response.')
  }
  const transfer = value.transfer
  if (transfer === null) return null
  if (!transfer || typeof transfer !== 'object' ||
    !('to' in transfer) || transfer.to !== fid ||
    !('username' in transfer) || typeof transfer.username !== 'string' ||
    !FNAME_PATTERN.test(transfer.username)) {
    throw new Error('Invalid FName Registry response.')
  }
  return transfer.username
}

function settledName(
  result: PromiseSettledResult<string | null>,
): string | null {
  if (result.status !== 'fulfilled' || !result.value) return null
  try {
    return normalize(result.value)
  } catch {
    return null
  }
}

function isBasename(name: string): boolean {
  return name.endsWith('.base.eth')
}

function validFid(value: unknown): number | null {
  if (
    typeof value !== 'bigint' ||
    value <= 0n ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null
  }
  return Number(value)
}

function normalizeAddresses(values: readonly string[]): Address[] {
  const addresses: Address[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!isAddress(value)) continue
    let address: Address
    try {
      address = getAddress(value)
    } catch {
      continue
    }
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    addresses.push(address)
  }
  return addresses
}

function emptyIdentity(address: Address): ParticipantIdentity {
  return {
    address,
    ensName: null,
    basename: null,
    registeredFname: null,
    farcasterFid: null,
  }
}

function emptyNames(): ResolvedNames {
  return { basename: null, ensName: null }
}

function sourceStatus(
  successes: number,
  failures: number,
): ParticipantIdentityBatchStatus {
  if (failures === 0) return 'complete'
  return successes === 0 ? 'unavailable' : 'partial'
}

function combinedStatus(
  statuses: readonly SourceStatus[],
): ParticipantIdentityBatchStatus {
  const attempted = statuses.filter((status) => status !== 'disabled')
  if (!attempted.length) return 'unavailable'
  if (attempted.every((status) => status === 'complete')) return 'complete'
  if (attempted.every((status) => status === 'unavailable')) return 'unavailable'
  return 'partial'
}

function createParticipantIdentityResolver(
  mainnetRpcUrls?: string,
  configuredBaseRpcUrl?: string,
): ParticipantIdentityResolver {
  const resolver: ParticipantIdentityResolver = {}
  const getEnsName = createEnsNameResolver(mainnetRpcUrls)
  const getFids = createFidResolver(configuredBaseRpcUrl)
  if (getEnsName) resolver.getEnsName = getEnsName
  if (getFids) resolver.getFids = getFids
  return resolver
}

function createEnsNameResolver(
  configuredUrls?: string,
): ParticipantIdentityResolver['getEnsName'] {
  const mainnetUrls = httpsRpcUrls(configuredUrls)
  if (!mainnetUrls.length) return undefined
  const mainnetTransports = mainnetUrls.map(
    (url) => http(url, { timeout: 6_000 }),
  )
  const mainnetTransport = mainnetTransports.length === 1
    ? mainnetTransports[0]!
    : fallback(mainnetTransports)
  const mainnetClient = createPublicClient({
    batch: { multicall: { wait: 8 } },
    chain: mainnet,
    transport: mainnetTransport,
  })
  return (address, coinType) => mainnetClient.getEnsName({
    address,
    coinType,
    gatewayUrls: ENS_GATEWAY_URLS,
  })
}

function createFidResolver(
  configuredBaseRpcUrl?: string,
): ParticipantIdentityResolver['getFids'] {
  if (!configuredBaseRpcUrl || !isHttpsUrl(configuredBaseRpcUrl)) return undefined
  const baseClient = createPublicClient({
    chain: base,
    transport: http(configuredBaseRpcUrl, { timeout: 6_000 }),
  })
  return (addresses) => baseClient.readContract({
    abi: BASE_VERIFICATIONS_ABI,
    address: BASE_VERIFICATIONS_ADDRESS,
    functionName: 'getFids',
    args: [[...addresses]],
  })
}

function httpsRpcUrls(configuredUrls?: string): string[] {
  return (configuredUrls ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(isHttpsUrl)
    .slice(0, 3)
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
