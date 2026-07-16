import {
  IdentifierKind,
  createSCWSigner,
  type Signer,
} from '@xmtp/browser-sdk'
import {
  createWalletClient,
  custom,
  getAddress,
  hexToBytes,
  type Address,
} from 'viem'

export type Eip1193WalletEventMap = {
  accountsChanged: [accounts: readonly Address[]]
  chainChanged: [chainId: string]
  connect: [connection: { chainId: string }]
  disconnect: [error: unknown]
  message: [message: unknown]
}

export type Eip1193Provider = {
  request: (request: {
    method: string
    params?: readonly unknown[] | Record<string, unknown>
  }) => Promise<unknown>
  on: <event extends keyof Eip1193WalletEventMap>(
    event: event,
    listener: (...args: Eip1193WalletEventMap[event]) => void,
  ) => void
  removeListener: <event extends keyof Eip1193WalletEventMap>(
    event: event,
    listener: (...args: Eip1193WalletEventMap[event]) => void,
  ) => void
}

export type WalletConnection = {
  address: Address
  chainId: bigint
  kind: 'EOA' | 'SCW'
  provider: Eip1193Provider
  signer: Signer
}

// Keep the host-specific names available while call sites migrate to the
// connector-agnostic wallet boundary.
export type HostWalletEventMap = Eip1193WalletEventMap
export type HostWalletProvider = Eip1193Provider
export type HostWalletConnection = WalletConnection

export type ConnectEip1193WalletOptions = {
  targetAddress?: Address
  expectedPreferredAddress?: Address
  accountRequestMethod?: 'eth_requestAccounts' | 'eth_accounts'
}

export type HostWalletSource = {
  address: Address
  provider: Eip1193Provider
}

export class WalletTargetUnavailableError extends Error {
  readonly code = 'wallet-target-unavailable'
  readonly targetAddress: Address

  constructor(targetAddress: Address) {
    super('The connected wallet does not expose the requested Ethereum account.')
    this.name = 'WalletTargetUnavailableError'
    this.targetAddress = targetAddress
  }
}

export class WalletPreferredAccountMismatchError extends Error {
  readonly code = 'wallet-preferred-account-mismatch'
  readonly expectedAddress: Address

  constructor(expectedAddress: Address) {
    super('The connected wallet preferred account does not match the expected account.')
    this.name = 'WalletPreferredAccountMismatchError'
    this.expectedAddress = expectedAddress
  }
}

export class HostWalletTargetUnavailableError extends Error {
  readonly code = 'host-wallet-target-unavailable'
  readonly targetAddress: Address

  constructor(targetAddress: Address, options?: ErrorOptions) {
    super(
      'The Farcaster wallet does not expose the requested Ethereum account.',
      options,
    )
    this.name = 'HostWalletTargetUnavailableError'
    this.targetAddress = targetAddress
  }
}

export class HostWalletSourceMismatchError extends Error {
  readonly code = 'host-wallet-source-mismatch'
  readonly sourceAddress: Address

  constructor(sourceAddress: Address, options?: ErrorOptions) {
    super(
      'The Farcaster wallet preferred account does not match the saved inbox source.',
      options,
    )
    this.name = 'HostWalletSourceMismatchError'
    this.sourceAddress = sourceAddress
  }
}

function asHostWalletProvider(value: unknown): HostWalletProvider {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('request' in value) ||
    typeof value.request !== 'function' ||
    !('on' in value) ||
    typeof value.on !== 'function' ||
    !('removeListener' in value) ||
    typeof value.removeListener !== 'function'
  ) {
    throw new Error('The Farcaster host did not provide a usable EIP-1193 wallet.')
  }

  return value as HostWalletProvider
}

function readAddress(accounts: unknown, targetAddress?: Address): Address {
  if (!Array.isArray(accounts)) {
    throw new Error('The connected wallet did not return an Ethereum account.')
  }

  const selected = targetAddress
    ? accounts.find((account) => (
        typeof account === 'string' &&
        account.toLowerCase() === targetAddress.toLowerCase()
      ))
    : accounts[0]

  if (targetAddress && selected === undefined) {
    throw new WalletTargetUnavailableError(targetAddress)
  }
  if (typeof selected !== 'string') {
    throw new Error('The connected wallet did not return an Ethereum account.')
  }

  try {
    return getAddress(selected)
  } catch {
    throw new Error('The connected wallet returned an invalid Ethereum account.')
  }
}

function requirePreferredAddress(accounts: unknown, expectedAddress: Address): Address {
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') {
    throw new Error('The connected wallet did not return an Ethereum account.')
  }

  let preferredAddress: Address
  try {
    preferredAddress = getAddress(accounts[0])
  } catch {
    throw new Error('The connected wallet returned an invalid Ethereum account.')
  }
  if (preferredAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new WalletPreferredAccountMismatchError(expectedAddress)
  }

  return preferredAddress
}

export function parseEip1193ChainId(value: unknown): bigint {
  let chainId: bigint
  if (typeof value === 'bigint') {
    chainId = value
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    chainId = BigInt(value)
  } else if (
    typeof value === 'string' &&
    /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)
  ) {
    chainId = BigInt(value)
  } else {
    throw new Error('The connected wallet returned an invalid chain ID.')
  }

  if (chainId <= 0n) {
    throw new Error('The connected wallet returned an invalid chain ID.')
  }

  return chainId
}

function hasContractCode(value: unknown): boolean {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(value)) {
    throw new Error('The connected wallet returned invalid account bytecode.')
  }

  return !/^0x(?:00)*$/i.test(value)
}

function normalizeAddress(
  value: Address | undefined,
  invalidMessage: string,
): Address | undefined {
  if (!value) return undefined

  try {
    return getAddress(value)
  } catch {
    throw new Error(invalidMessage)
  }
}

/**
 * Creates the matching XMTP v7 signer for an account exposed by any EIP-1193
 * provider. Callers can select an exact account and can opt into the
 * non-interactive `eth_accounts` method when restoring an existing session.
 */
export async function connectEip1193Wallet(
  provider: Eip1193Provider,
  options: ConnectEip1193WalletOptions = {},
): Promise<WalletConnection> {
  const targetAddress = normalizeAddress(
    options.targetAddress,
    'The requested Ethereum account is invalid.',
  )
  const expectedPreferredAddress = normalizeAddress(
    options.expectedPreferredAddress,
    'The expected preferred Ethereum account is invalid.',
  )
  const accountRequestMethod = options.accountRequestMethod ?? 'eth_requestAccounts'
  const accounts = await provider.request({ method: accountRequestMethod })

  if (expectedPreferredAddress) {
    requirePreferredAddress(accounts, expectedPreferredAddress)
  }
  const address = readAddress(accounts, targetAddress)
  const chainId = parseEip1193ChainId(
    await provider.request({ method: 'eth_chainId' }),
  )
  const contractCode = await provider.request({
    method: 'eth_getCode',
    params: [address, 'latest'],
  })

  const walletClient = createWalletClient({
    account: address,
    transport: custom(provider),
  })
  const signMessage = (message: string) =>
    walletClient.signMessage({ account: address, message })

  if (hasContractCode(contractCode)) {
    return {
      address,
      chainId,
      kind: 'SCW',
      provider,
      signer: createSCWSigner(address, signMessage, chainId),
    }
  }

  const signer: Signer = {
    type: 'EOA',
    getIdentifier: () => ({
      identifier: address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message) => hexToBytes(await signMessage(message)),
  }

  return {
    address,
    chainId,
    kind: 'EOA',
    provider,
    signer,
  }
}

/** Returns the Farcaster EIP-1193 provider without selecting an XMTP signer. */
export async function getHostWalletProvider(): Promise<HostWalletProvider> {
  const { sdk } = await import('@farcaster/miniapp-sdk')
  const hostProvider = await sdk.wallet.getEthereumProvider()

  if (!hostProvider) {
    throw new Error('The Farcaster host does not expose an Ethereum wallet.')
  }

  return asHostWalletProvider(hostProvider)
}

/**
 * Verifies that the currently preferred Farcaster account is still the saved
 * source inbox without requiring an external target to be exposed by it.
 */
export async function verifyHostWalletSource(
  expectedSourceAddress: Address,
): Promise<HostWalletSource> {
  const sourceAddress = normalizeAddress(
    expectedSourceAddress,
    'The expected Farcaster source account is invalid.',
  )
  if (!sourceAddress) {
    throw new Error('The expected Farcaster source account is invalid.')
  }

  const provider = await getHostWalletProvider()
  const accounts = await provider.request({ method: 'eth_requestAccounts' })

  try {
    return {
      address: requirePreferredAddress(accounts, sourceAddress),
      provider,
    }
  } catch (error) {
    if (error instanceof WalletPreferredAccountMismatchError) {
      throw new HostWalletSourceMismatchError(sourceAddress, { cause: error })
    }
    if (error instanceof Error) {
      throw new Error(
        error.message.replace('connected wallet', 'Farcaster wallet'),
        { cause: error },
      )
    }
    throw error
  }
}

/**
 * Connects the Farcaster host wallet and creates the matching XMTP v7 signer.
 * This deliberately has no generated-key fallback.
 */
export async function connectHostWallet(
  targetAddress?: Address,
  expectedSourceAddress?: Address,
): Promise<HostWalletConnection> {
  const requestedAddress = normalizeAddress(
    targetAddress,
    'The requested Ethereum account is invalid.',
  )
  const sourceAddress = normalizeAddress(
    expectedSourceAddress,
    'The expected Farcaster source account is invalid.',
  )
  const provider = await getHostWalletProvider()

  try {
    return await connectEip1193Wallet(provider, {
      ...(requestedAddress ? { targetAddress: requestedAddress } : {}),
      ...(sourceAddress ? { expectedPreferredAddress: sourceAddress } : {}),
    })
  } catch (error) {
    if (error instanceof WalletTargetUnavailableError) {
      throw new HostWalletTargetUnavailableError(error.targetAddress, { cause: error })
    }
    if (error instanceof WalletPreferredAccountMismatchError) {
      throw new HostWalletSourceMismatchError(error.expectedAddress, { cause: error })
    }
    if (error instanceof Error) {
      throw new Error(
        error.message.replace('connected wallet', 'Farcaster wallet'),
        { cause: error },
      )
    }
    throw error
  }
}
