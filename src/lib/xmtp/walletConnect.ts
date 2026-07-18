import { getAddress, type Address } from 'viem'

import {
  connectEip1193Wallet,
  WalletTargetUnavailableError,
  type Eip1193Provider,
  type WalletConnection,
} from './signer'

const WALLETCONNECT_CHAINS = [1, 10, 137, 8453, 42161] as const
const WALLETCONNECT_METHODS = [
  'eth_accounts',
  'eth_requestAccounts',
  'personal_sign',
] as const
const WALLETCONNECT_EVENTS = ['accountsChanged', 'chainChanged'] as const

type WalletConnectProvider = Omit<
  Eip1193Provider,
  'on' | 'removeListener'
> & {
  accounts: string[]
  readonly session?: unknown
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  on: Eip1193Provider['on'] & (
    (event: 'display_uri', listener: (uri: string) => void) => unknown
  )
  removeListener: Eip1193Provider['removeListener'] & (
    (event: 'display_uri', listener: (uri: string) => void) => unknown
  )
}

export type WalletConnectErrorCode =
  | 'walletconnect-not-configured'
  | 'walletconnect-session-unavailable'
  | 'walletconnect-target-unavailable'
  | 'walletconnect-cancelled'
  | 'walletconnect-connection-failed'

export type WalletConnectWalletOptions = {
  /** Open the one-time WalletConnect pairing needed for ENS identity binding. */
  prompt?: boolean | undefined
  /** Receives the ephemeral URI while a new pairing is pending. */
  onDisplayUri?: ((uri: string) => void) | undefined
  signal?: AbortSignal | undefined
}

export class WalletConnectNotConfiguredError extends Error {
  readonly code = 'walletconnect-not-configured'

  constructor() {
    super('WalletConnect is not configured for this deployment.')
    this.name = 'WalletConnectNotConfiguredError'
  }
}

export class WalletConnectSessionUnavailableError extends Error {
  readonly code = 'walletconnect-session-unavailable'

  constructor() {
    super('The saved external-wallet session is no longer available.')
    this.name = 'WalletConnectSessionUnavailableError'
  }
}

export class WalletConnectTargetUnavailableError extends Error {
  readonly code = 'walletconnect-target-unavailable'
  readonly targetAddress: Address

  constructor(targetAddress: Address, options?: ErrorOptions) {
    super(
      'The connected external wallet does not expose the requested Ethereum account.',
      options,
    )
    this.name = 'WalletConnectTargetUnavailableError'
    this.targetAddress = targetAddress
  }
}

export class WalletConnectCancelledError extends Error {
  readonly code = 'walletconnect-cancelled'

  constructor(options?: ErrorOptions) {
    super('The external-wallet connection was cancelled.', options)
    this.name = 'WalletConnectCancelledError'
  }
}

export class WalletConnectConnectionFailedError extends Error {
  readonly code = 'walletconnect-connection-failed'

  constructor(options?: ErrorOptions) {
    super('Converge Mini could not connect to the external wallet.', options)
    this.name = 'WalletConnectConnectionFailedError'
  }
}

let providerPromise: Promise<WalletConnectProvider> | undefined
let operationSequence = 0
let newestOperation = 0
let lastClaimedOperation = 0
const activeOperations = new Set<number>()
const pendingCleanups = new Map<number, WalletConnectProvider>()

function configuredProjectId(): string {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim()
  if (!projectId) throw new WalletConnectNotConfiguredError()
  return projectId
}

export function isWalletConnectConfigured(): boolean {
  return Boolean(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim())
}

function appMetadata() {
  const origin = window.location.origin

  return {
    name: 'Converge Mini',
    description: 'Authorize a one-time ENS inbox binding.',
    url: origin,
    icons: [`${origin}/icon-1024.png`],
  }
}

async function initializeProvider(): Promise<WalletConnectProvider> {
  const projectId = configuredProjectId()
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider')
  const provider = await EthereumProvider.init({
    projectId,
    optionalChains: [...WALLETCONNECT_CHAINS],
    optionalMethods: [...WALLETCONNECT_METHODS],
    optionalEvents: [...WALLETCONNECT_EVENTS],
    showQrModal: false,
    telemetryEnabled: false,
    metadata: appMetadata(),
  })

  return provider as unknown as WalletConnectProvider
}

function getProvider(): Promise<WalletConnectProvider> {
  if (providerPromise) return providerPromise

  const pending = initializeProvider().catch((error: unknown) => {
    if (providerPromise === pending) providerPromise = undefined
    throw error
  })
  providerPromise = pending
  return pending
}

function isTargetAccount(accounts: readonly string[], targetAddress: Address): boolean {
  return accounts.some(
    (account) => account.toLowerCase() === targetAddress.toLowerCase(),
  )
}

function isOperationCurrent(operation: number, signal?: AbortSignal): boolean {
  return operation === newestOperation && !signal?.aborted
}

function requireCurrentOperation(operation: number, signal?: AbortSignal): void {
  if (!isOperationCurrent(operation, signal)) {
    throw new WalletConnectCancelledError()
  }
}

async function disconnectIfUnclaimed(
  provider: WalletConnectProvider,
  operation: number,
): Promise<void> {
  if ([...activeOperations].some((active) => active > operation)) {
    pendingCleanups.set(operation, provider)
    return
  }
  pendingCleanups.delete(operation)
  if (!provider.session || lastClaimedOperation > operation) return

  try {
    await provider.disconnect()
  } catch {
    // Explicit and stale-session cleanup is intentionally best effort.
  }
}

async function flushPendingCleanups(): Promise<void> {
  for (const [operation, provider] of [...pendingCleanups]) {
    await disconnectIfUnclaimed(provider, operation)
  }
}

async function waitForPairing(
  pairing: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await pairing
    return
  }
  if (signal.aborted) throw new WalletConnectCancelledError()

  let rejectAbort: ((reason: WalletConnectCancelledError) => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const abort = () => rejectAbort?.(new WalletConnectCancelledError())
  signal.addEventListener('abort', abort, { once: true })
  try {
    await Promise.race([pairing, aborted])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

async function pairProvider(
  provider: WalletConnectProvider,
  operation: number,
  options: WalletConnectWalletOptions,
): Promise<void> {
  const displayUri = (uri: string) => {
    try {
      options.onDisplayUri?.(uri)
    } catch {
      // A rendering callback must not interrupt the WalletConnect handshake.
    }
  }

  if (options.onDisplayUri) provider.on('display_uri', displayUri)
  const pairing = provider.connect()

  try {
    await waitForPairing(pairing, options.signal)
    requireCurrentOperation(operation, options.signal)
  } catch (error) {
    if (error instanceof WalletConnectCancelledError) {
      void pairing
        .then(() => disconnectIfUnclaimed(provider, operation))
        .catch(() => undefined)
    }
    throw error
  } finally {
    if (options.onDisplayUri) {
      provider.removeListener('display_uri', displayUri)
    }
  }
}

function isUserCancellation(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (code === 4001 || code === '4001') return true
  }
  if (!(error instanceof Error)) return false

  return /cancel(?:led)?|closed|connection request reset|user rejected/i.test(
    error.message,
  )
}

function normalizeFailure(error: unknown, targetAddress: Address): Error {
  if (
    error instanceof WalletConnectNotConfiguredError ||
    error instanceof WalletConnectSessionUnavailableError ||
    error instanceof WalletConnectTargetUnavailableError ||
    error instanceof WalletConnectCancelledError ||
    error instanceof WalletConnectConnectionFailedError
  ) {
    return error
  }
  if (error instanceof WalletTargetUnavailableError) {
    return new WalletConnectTargetUnavailableError(targetAddress, { cause: error })
  }
  if (isUserCancellation(error)) {
    return new WalletConnectCancelledError({ cause: error })
  }

  return new WalletConnectConnectionFailedError({ cause: error })
}

/**
 * Pairs the external wallet that exposes an exact ENS-resolved account, then
 * creates the one-time signer used during identity binding. WalletConnect may
 * retain a provider session transiently; callers disconnect it after binding.
 */
export async function connectWalletConnectWallet(
  requestedAddress: Address,
  options: WalletConnectWalletOptions = {},
): Promise<WalletConnection> {
  let targetAddress: Address
  try {
    targetAddress = getAddress(requestedAddress)
  } catch (error) {
    throw new WalletConnectTargetUnavailableError(requestedAddress, {
      cause: error,
    })
  }

  const operation = ++operationSequence
  newestOperation = operation
  activeOperations.add(operation)
  let provider: WalletConnectProvider | undefined
  let createdSession = false

  try {
    requireCurrentOperation(operation, options.signal)
    provider = await getProvider()
    requireCurrentOperation(operation, options.signal)

    if (!provider.session) {
      if (!options.prompt) throw new WalletConnectSessionUnavailableError()
      createdSession = true
      await pairProvider(provider, operation, options)
    } else if (!isTargetAccount(provider.accounts, targetAddress)) {
      if (!options.prompt) {
        throw new WalletConnectTargetUnavailableError(targetAddress)
      }

      await provider.disconnect()
      requireCurrentOperation(operation, options.signal)
      createdSession = true
      await pairProvider(provider, operation, options)
    }

    requireCurrentOperation(operation, options.signal)
    const connection = await connectEip1193Wallet(
      provider as Eip1193Provider,
      {
        targetAddress,
        accountRequestMethod: 'eth_accounts',
      },
    )
    requireCurrentOperation(operation, options.signal)
    lastClaimedOperation = Math.max(lastClaimedOperation, operation)
    return connection
  } catch (error) {
    if (createdSession && provider) {
      void disconnectIfUnclaimed(provider, operation)
    }
    throw normalizeFailure(error, targetAddress)
  } finally {
    activeOperations.delete(operation)
    void flushPendingCleanups()
  }
}

/** Disconnects the transient external-wallet session without initializing one. */
export async function disconnectWalletConnect(): Promise<void> {
  newestOperation = ++operationSequence
  if (!providerPromise) return

  try {
    const provider = await providerPromise
    if (provider.session) await provider.disconnect()
  } catch {
    // This is used during an explicit inbox reset and must remain best effort.
  }
}
