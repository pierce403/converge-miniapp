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

export type HostWalletEventMap = {
  accountsChanged: [accounts: readonly Address[]]
  chainChanged: [chainId: string]
  connect: [connection: { chainId: string }]
  disconnect: [error: unknown]
  message: [message: unknown]
}

export type HostWalletProvider = {
  request: (request: {
    method: string
    params?: readonly unknown[] | Record<string, unknown>
  }) => Promise<unknown>
  on: <event extends keyof HostWalletEventMap>(
    event: event,
    listener: (...args: HostWalletEventMap[event]) => void,
  ) => void
  removeListener: <event extends keyof HostWalletEventMap>(
    event: event,
    listener: (...args: HostWalletEventMap[event]) => void,
  ) => void
}

export type HostWalletConnection = {
  address: Address
  chainId: bigint
  kind: 'EOA' | 'SCW'
  provider: HostWalletProvider
  signer: Signer
}

export class HostWalletTargetUnavailableError extends Error {
  readonly code = 'host-wallet-target-unavailable'
  readonly targetAddress: Address

  constructor(targetAddress: Address) {
    super('The Farcaster wallet does not expose the requested Ethereum account.')
    this.name = 'HostWalletTargetUnavailableError'
    this.targetAddress = targetAddress
  }
}

export class HostWalletSourceMismatchError extends Error {
  readonly code = 'host-wallet-source-mismatch'
  readonly sourceAddress: Address

  constructor(sourceAddress: Address) {
    super('The Farcaster wallet preferred account does not match the saved inbox source.')
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
    throw new Error('The Farcaster wallet did not return an Ethereum account.')
  }

  const selected = targetAddress
    ? accounts.find((account) => (
        typeof account === 'string' &&
        account.toLowerCase() === targetAddress.toLowerCase()
      ))
    : accounts[0]

  if (targetAddress && selected === undefined) {
    throw new HostWalletTargetUnavailableError(targetAddress)
  }
  if (typeof selected !== 'string') {
    throw new Error('The Farcaster wallet did not return an Ethereum account.')
  }

  try {
    return getAddress(selected)
  } catch {
    throw new Error('The Farcaster wallet returned an invalid Ethereum account.')
  }
}

function requirePreferredAddress(accounts: unknown, sourceAddress: Address): void {
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') {
    throw new Error('The Farcaster wallet did not return an Ethereum account.')
  }

  let preferredAddress: Address
  try {
    preferredAddress = getAddress(accounts[0])
  } catch {
    throw new Error('The Farcaster wallet returned an invalid Ethereum account.')
  }
  if (preferredAddress.toLowerCase() !== sourceAddress.toLowerCase()) {
    throw new HostWalletSourceMismatchError(sourceAddress)
  }
}

function readChainId(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error('The Farcaster wallet returned an invalid chain ID.')
  }

  const chainId = BigInt(value)
  if (chainId <= 0n) {
    throw new Error('The Farcaster wallet returned an invalid chain ID.')
  }

  return chainId
}

function hasContractCode(value: unknown): boolean {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(value)) {
    throw new Error('The Farcaster wallet returned invalid account bytecode.')
  }

  return !/^0x(?:00)*$/i.test(value)
}

/**
 * Connects the Farcaster host wallet and creates the matching XMTP v7 signer.
 * This deliberately has no generated-key fallback.
 */
export async function connectHostWallet(
  targetAddress?: Address,
  expectedSourceAddress?: Address,
): Promise<HostWalletConnection> {
  let requestedAddress: Address | undefined
  let sourceAddress: Address | undefined
  if (targetAddress) {
    try {
      requestedAddress = getAddress(targetAddress)
    } catch {
      throw new Error('The requested Ethereum account is invalid.')
    }
  }
  if (expectedSourceAddress) {
    try {
      sourceAddress = getAddress(expectedSourceAddress)
    } catch {
      throw new Error('The expected Farcaster source account is invalid.')
    }
  }

  const { sdk } = await import('@farcaster/miniapp-sdk')
  const hostProvider = await sdk.wallet.getEthereumProvider()

  if (!hostProvider) {
    throw new Error('The Farcaster host does not expose an Ethereum wallet.')
  }

  const provider = asHostWalletProvider(hostProvider)
  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  if (sourceAddress) requirePreferredAddress(accounts, sourceAddress)
  const address = readAddress(
    accounts,
    requestedAddress,
  )
  const chainId = readChainId(
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
