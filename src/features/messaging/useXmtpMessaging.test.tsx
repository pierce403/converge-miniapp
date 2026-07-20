import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ActiveConversation,
  ConversationSummary,
  MessageItem,
} from './types'
import type { ParsedConvosInvite } from '../../lib/convos/invite'
import { ConvosInviteError } from '../../lib/convos/error'
import {
  XmtpClientInitializationError,
  type ConvosAccessSnapshot,
} from '../../lib/xmtp/session'
import { useXmtpMessaging } from './useXmtpMessaging'

const mocks = vi.hoisted(() => ({
  acquireXmtpLease: vi.fn(),
  connectHostWallet: vi.fn(),
  connectWalletConnectWallet: vi.fn(),
  createSession: vi.fn(),
  disconnectWalletConnect: vi.fn(),
  disableAlert: vi.fn(),
  parseConvosInvite: vi.fn(),
  prepareStorage: vi.fn(),
  syncAlert: vi.fn(),
  verifyHostWalletSource: vi.fn(),
}))

vi.mock('../../lib/xmtp/lease', () => ({
  acquireXmtpLease: mocks.acquireXmtpLease,
}))

vi.mock('../../lib/xmtp/signer', () => ({
  connectHostWallet: mocks.connectHostWallet,
  HostWalletSourceMismatchError: class HostWalletSourceMismatchError extends Error {
    readonly code = 'host-wallet-source-mismatch'

    constructor(sourceAddress: string, options?: ErrorOptions) {
      super(`Farcaster source mismatch: ${sourceAddress}`, options)
      this.name = 'HostWalletSourceMismatchError'
    }
  },
  parseEip1193ChainId: (value: string | number | bigint) => BigInt(value),
  verifyHostWalletSource: mocks.verifyHostWalletSource,
}))

vi.mock('../../lib/xmtp/walletConnect', () => ({
  connectWalletConnectWallet: mocks.connectWalletConnectWallet,
  disconnectWalletConnect: mocks.disconnectWalletConnect,
}))

vi.mock('../../lib/xmtp/storage', () => ({
  prepareXmtpStorage: mocks.prepareStorage,
}))

vi.mock('../../lib/convos/invite', () => ({
  parseConvosInvite: mocks.parseConvosInvite,
}))

vi.mock('../../lib/xmtp/alertRegistration', () => ({
  disableXmtpAlertRegistration: mocks.disableAlert,
  syncXmtpAlertRegistration: mocks.syncAlert,
}))

vi.mock('../../lib/xmtp/session', () => {
  class XmtpClientInitializationError extends Error {}

  return {
    XmtpClientInitializationError,
    XmtpMessagingSession: class {
      static create(...args: unknown[]) {
        return mocks.createSession(...args)
      }
    },
  }
})

const address = '0x1111111111111111111111111111111111111111' as const
const provider = {
  on: vi.fn(),
  removeListener: vi.fn(),
  request: vi.fn(),
}
const externalProvider = {
  on: vi.fn(),
  removeListener: vi.fn(),
  request: vi.fn(),
}
const sourceProvider = {
  on: vi.fn(),
  removeListener: vi.fn(),
  request: vi.fn(),
}
const cachedConversation: ConversationSummary = {
  id: 'conversation-1',
  isOwnLastMessage: false,
  kind: 'dm',
  peerAddress: '0x2222222222222222222222222222222222222222',
  peerInboxId: 'peer-inbox-1',
  preview: 'Saved locally',
  updatedAt: new Date('2026-07-14T12:00:00Z'),
}
const activeConversation: ActiveConversation = {
  id: cachedConversation.id,
  kind: 'dm',
  peerAddress: cachedConversation.peerAddress,
  peerInboxId: cachedConversation.peerInboxId,
}
const groupSummary: ConversationSummary = {
  creatorInboxId: 'creator-inbox',
  emoji: '🌱',
  id: 'verified-group',
  isOwnLastMessage: false,
  kind: 'convos-group',
  peerAddress: null,
  peerInboxId: null,
  preview: 'Welcome to the garden',
  title: 'Garden chat',
  updatedAt: new Date('2026-07-14T12:01:00Z'),
}
const activeGroup: ActiveConversation = {
  creatorInboxId: groupSummary.creatorInboxId,
  emoji: groupSummary.emoji,
  id: groupSummary.id,
  kind: 'convos-group',
  peerAddress: null,
  peerInboxId: null,
  title: groupSummary.title,
}

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason: unknown) => void
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function storageValues(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => (
    storage.getItem(storage.key(index) ?? '') ?? ''
  ))
}

function message(id: string, text: string, sentAt: string): MessageItem {
  const date = new Date(sentAt)
  return {
    canRetry: false,
    conversationId: activeConversation.id,
    delivery: 'sent',
    id,
    isOwn: false,
    senderInboxId: 'peer-inbox-1',
    sentAt: date,
    sentAtNs: BigInt(date.getTime()) * 1_000_000n,
    text,
    unsupported: false,
  }
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    address,
    bindIdentity: vi.fn().mockResolvedValue(undefined),
    canMessageAddress: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    convosAccessSnapshot: null,
    createDm: vi.fn(),
    dismissConvosAccessRequest: vi.fn(),
    environment: 'dev',
    findInboxId: vi.fn().mockResolvedValue('target-inbox'),
    inboxId: 'own-inbox',
    isNewInstallation: false,
    loadConversation: vi.fn(),
    loadInbox: vi.fn().mockResolvedValue([cachedConversation]),
    loadOlderMessages: vi.fn(),
    readConversation: vi.fn(),
    readInbox: vi.fn().mockResolvedValue([cachedConversation]),
    requestConvosAccess: vi.fn(),
    requestHistorySync: vi.fn().mockResolvedValue(false),
    startMessageStream: vi.fn().mockResolvedValue(undefined),
    startPushTopicStream: vi.fn().mockResolvedValue(undefined),
    stopPushTopicStream: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useXmtpMessaging', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.parseConvosInvite.mockImplementation((slug: string) => ({
      ...convosInvite(),
      slug,
    }))
    localStorage.clear()
    sessionStorage.clear()
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    provider.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_accounts') return Promise.resolve([address])
      if (method === 'eth_chainId') return Promise.resolve('0xa')
      return Promise.resolve(null)
    })
    externalProvider.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_accounts') {
        return Promise.resolve(['0x2222222222222222222222222222222222222222'])
      }
      if (method === 'eth_chainId') return Promise.resolve(1)
      return Promise.resolve(null)
    })
    sourceProvider.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_accounts') return Promise.resolve([address])
      if (method === 'eth_chainId') return Promise.resolve('0xa')
      return Promise.resolve(null)
    })
    mocks.acquireXmtpLease.mockResolvedValue({
      release: vi.fn().mockResolvedValue(undefined),
    })
    mocks.prepareStorage.mockResolvedValue('persistent')
    mocks.verifyHostWalletSource.mockResolvedValue({
      address,
      provider: sourceProvider,
    })
    mocks.connectHostWallet.mockResolvedValue({
      address,
      chainId: 10n,
      kind: 'EOA',
      provider,
      signer: {},
    })
  })

  it('runs one follow-up registration when push keys change during a sync', async () => {
    const firstSync = deferred<void>()
    let onPushChange: (() => void) | undefined
    const session = createSession({
      environment: 'production',
      startPushTopicStream: vi.fn(async (onChange: () => void) => {
        onPushChange = onChange
      }),
    })
    mocks.createSession.mockResolvedValue(session)
    mocks.syncAlert
      .mockImplementationOnce(() => firstSync.promise)
      .mockResolvedValue(undefined)
    const { result } = renderHook(() => useXmtpMessaging({ notificationFid: 403 }))
    await act(async () => result.current.connect())

    let registration!: Promise<void>
    act(() => {
      registration = result.current.syncAlerts()
    })
    await waitFor(() => expect(mocks.syncAlert).toHaveBeenCalledOnce())

    act(() => {
      onPushChange?.()
      onPushChange?.()
    })
    firstSync.resolve()
    await act(async () => registration)

    expect(mocks.syncAlert).toHaveBeenCalledTimes(2)
    expect(mocks.syncAlert).toHaveBeenLastCalledWith(session, 403)
  })

  it('automatically opens one host-wallet session through Strict Mode replay', async () => {
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(
      () => useXmtpMessaging({ autoConnect: true }),
      { wrapper: StrictMode },
    )

    await waitFor(() => expect(result.current.connection).toEqual({
      error: null,
      phase: 'ready',
    }))

    expect(mocks.connectHostWallet).toHaveBeenCalledOnce()
    expect(mocks.createSession).toHaveBeenCalledOnce()
  })

  it('opens a bound ENS inbox with only the Farcaster source signer', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const target = {
      address: targetAddress,
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: address,
      walletKind: 'EOA' as const,
      chainId: '10',
    }
    const session = createSession({
      address,
      inboxId: target.inboxId,
    })
    mocks.connectHostWallet.mockResolvedValueOnce({
      address,
      chainId: 10n,
      kind: 'EOA',
      provider,
      signer: { farcaster: true },
    })
    mocks.createSession.mockResolvedValue(session)

    const { result } = renderHook(() => useXmtpMessaging({
      autoConnect: true,
      inboxTarget: target,
    }))

    await waitFor(() => expect(result.current.connection.phase).toBe('ready'))
    expect(mocks.connectHostWallet).toHaveBeenCalledOnce()
    expect(mocks.connectHostWallet).toHaveBeenCalledWith(address, address)
    expect(mocks.createSession).toHaveBeenCalledWith(
      { farcaster: true },
      address,
      target.inboxId,
      expect.any(Function),
    )
    expect(result.current.address).toBe(address)
    expect(mocks.connectWalletConnectWallet).not.toHaveBeenCalled()
  })

  it('never restores WalletConnect for a confirmed binding', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const target = {
      address: targetAddress,
      chainId: '10',
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: address,
      walletKind: 'EOA' as const,
    }
    const session = createSession({
      address,
      inboxId: target.inboxId,
    })
    mocks.createSession.mockResolvedValue(session)

    const { result } = renderHook(() => useXmtpMessaging({ inboxTarget: target }))
    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('ready')
    expect(mocks.connectHostWallet).toHaveBeenCalledWith(address, address)
    expect(mocks.connectWalletConnectWallet).not.toHaveBeenCalled()
    expect(mocks.createSession).toHaveBeenCalledWith(
      {},
      address,
      target.inboxId,
      expect.any(Function),
    )
  })

  it('does not lock an EOA binding to the chain used during setup', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const target = {
      address: targetAddress,
      chainId: '8453',
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: address,
      walletKind: 'EOA' as const,
    }
    const session = createSession({ address, inboxId: target.inboxId })
    mocks.createSession.mockResolvedValueOnce(session)
    const { result } = renderHook(() => useXmtpMessaging({ inboxTarget: target }))
    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('ready')
    expect(mocks.createSession).toHaveBeenCalledOnce()
  })

  it('fails closed when the bound Farcaster smart-wallet chain changes', async () => {
    const target = {
      address: '0x2222222222222222222222222222222222222222' as const,
      chainId: '8453',
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: address,
      walletKind: 'SCW' as const,
    }
    mocks.connectHostWallet.mockResolvedValueOnce({
      address,
      chainId: 10n,
      kind: 'SCW',
      provider,
      signer: { farcaster: true },
    })
    const { result } = renderHook(() => useXmtpMessaging({ inboxTarget: target }))
    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('target-source-mismatch')
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('rejects Farcaster wallet-kind metadata that changed since binding', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const target = {
      address: targetAddress,
      chainId: '10',
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: address,
      walletKind: 'EOA' as const,
    }
    mocks.connectHostWallet.mockResolvedValueOnce({
      address,
      chainId: 10n,
      kind: 'SCW',
      provider,
      signer: { farcaster: true },
    })

    const { result } = renderHook(() => useXmtpMessaging({ inboxTarget: target }))
    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('target-source-mismatch')
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('closes a bound inbox if the Farcaster source account changes', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const target = {
      address: targetAddress,
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: address,
      walletKind: 'EOA' as const,
      chainId: '10',
    }
    const session = createSession({ address, inboxId: target.inboxId })
    const lease = { release: vi.fn().mockResolvedValue(undefined) }
    mocks.acquireXmtpLease.mockResolvedValue(lease)
    mocks.connectHostWallet.mockResolvedValueOnce({
      address,
      chainId: 10n,
      kind: 'EOA',
      provider,
      signer: { farcaster: true },
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging({ inboxTarget: target }))

    await act(async () => result.current.connect())
    const accountsChanged = provider.on.mock.calls.find(
      ([event]) => event === 'accountsChanged',
    )?.[1] as ((accounts: readonly string[]) => void) | undefined
    act(() => accountsChanged?.([
      '0x3333333333333333333333333333333333333333',
      targetAddress,
    ]))

    await waitFor(() => expect(result.current.connection.phase).toBe('error'))
    expect(session.close).toHaveBeenCalledOnce()
    expect(lease.release).toHaveBeenCalledOnce()
  })

  it('keeps a ready source session untouched when switch preflight lacks the exact signer', async () => {
    const session = createSession()
    const lease = { release: vi.fn().mockResolvedValue(undefined) }
    mocks.acquireXmtpLease.mockResolvedValue(lease)
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    expect(result.current.connection.phase).toBe('ready')

    const unavailable = Object.assign(new Error('not exposed'), {
      code: 'walletconnect-target-unavailable',
    })
    mocks.connectWalletConnectWallet.mockRejectedValueOnce(unavailable)

    await expect(result.current.bindEnsInbox(
      '0x2222222222222222222222222222222222222222',
    )).rejects.toBe(unavailable)

    expect(session.findInboxId).toHaveBeenCalledWith(
      '0x2222222222222222222222222222222222222222',
    )
    expect(mocks.connectWalletConnectWallet).toHaveBeenLastCalledWith(
      '0x2222222222222222222222222222222222222222',
      expect.objectContaining({ prompt: true }),
    )
    expect(session.close).not.toHaveBeenCalled()
    expect(lease.release).not.toHaveBeenCalled()
    expect(result.current.connection.phase).toBe('ready')
    expect(result.current.conversations).toEqual([cachedConversation])
  })

  it('binds the Farcaster signer once, then closes the external target session', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const sourceSession = createSession()
    const targetSession = createSession({
      address: targetAddress,
      inboxId: 'target-inbox',
    })
    const sourceLease = { release: vi.fn().mockResolvedValue(undefined) }
    const targetLease = { release: vi.fn().mockResolvedValue(undefined) }
    mocks.acquireXmtpLease
      .mockResolvedValueOnce(sourceLease)
      .mockResolvedValueOnce(targetLease)
    mocks.createSession
      .mockResolvedValueOnce(sourceSession)
      .mockResolvedValueOnce(targetSession)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    const onPairingUri = vi.fn()
    const onCommitting = vi.fn()
    const controller = new AbortController()
    mocks.connectWalletConnectWallet.mockResolvedValueOnce({
      address: targetAddress,
      chainId: 8453n,
      kind: 'SCW',
      provider: externalProvider,
      signer: { external: true },
    })

    await expect(result.current.bindEnsInbox(targetAddress, {
      onCommitting,
      onPairingUri,
      signal: controller.signal,
    })).resolves.toEqual({
      address: targetAddress,
      chainId: '10',
      inboxId: 'target-inbox',
      walletKind: 'EOA',
    })

    expect(mocks.connectWalletConnectWallet).toHaveBeenCalledWith(
      targetAddress,
      {
        onDisplayUri: onPairingUri,
        prompt: true,
        signal: controller.signal,
      },
    )
    expect(sourceSession.close).toHaveBeenCalledOnce()
    expect(onCommitting).toHaveBeenCalledOnce()
    expect(onCommitting.mock.invocationCallOrder[0]).toBeLessThan(
      sourceSession.close.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(sourceLease.release).toHaveBeenCalledOnce()
    expect(targetSession.bindIdentity).toHaveBeenCalledWith({}, address)
    expect(targetSession.close).toHaveBeenCalledOnce()
    expect(targetLease.release).toHaveBeenCalledOnce()
    expect(mocks.disconnectWalletConnect).toHaveBeenCalledOnce()
    expect(result.current.connection.phase).toBe('ready')
  })

  it('disconnects a paired ENS wallet if it returns the wrong account', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const sourceSession = createSession()
    const sourceLease = { release: vi.fn().mockResolvedValue(undefined) }
    mocks.acquireXmtpLease.mockResolvedValueOnce(sourceLease)
    mocks.createSession.mockResolvedValueOnce(sourceSession)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    mocks.connectWalletConnectWallet.mockResolvedValueOnce({
      address: '0x3333333333333333333333333333333333333333',
      chainId: 1n,
      kind: 'EOA',
      provider: externalProvider,
      signer: { external: true },
    })

    await expect(result.current.bindEnsInbox(targetAddress)).rejects.toThrow(
      'different Ethereum account',
    )

    expect(mocks.disconnectWalletConnect).toHaveBeenCalledOnce()
    expect(sourceSession.close).not.toHaveBeenCalled()
    expect(sourceLease.release).not.toHaveBeenCalled()
    expect(result.current.connection.phase).toBe('ready')
  })

  it('fails closed and cleans up when XMTP cannot verify the binding', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const sourceSession = createSession()
    const verificationError = new Error('not confirmed')
    verificationError.name = 'XmtpIdentityBindingVerificationError'
    const targetSession = createSession({
      address: targetAddress,
      bindIdentity: vi.fn().mockRejectedValue(verificationError),
      inboxId: 'target-inbox',
    })
    const sourceLease = { release: vi.fn().mockResolvedValue(undefined) }
    const targetLease = { release: vi.fn().mockResolvedValue(undefined) }
    mocks.acquireXmtpLease
      .mockResolvedValueOnce(sourceLease)
      .mockResolvedValueOnce(targetLease)
    mocks.createSession
      .mockResolvedValueOnce(sourceSession)
      .mockResolvedValueOnce(targetSession)
    mocks.connectWalletConnectWallet.mockResolvedValueOnce({
      address: targetAddress,
      chainId: 1n,
      kind: 'EOA',
      provider: externalProvider,
      signer: { external: true },
    })
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    await expect(result.current.bindEnsInbox(targetAddress, {
      onCommitting: vi.fn(),
    })).rejects.toMatchObject({ code: 'ens-binding-ambiguous' })

    expect(sourceSession.close).toHaveBeenCalledOnce()
    expect(sourceLease.release).toHaveBeenCalledOnce()
    expect(targetSession.close).toHaveBeenCalledOnce()
    expect(targetLease.release).toHaveBeenCalledOnce()
    expect(mocks.disconnectWalletConnect).toHaveBeenCalledOnce()
    expect(result.current.connection.phase).toBe('ready')
  })

  it('does not silently fall back when a remembered target signer is unavailable', async () => {
    const target = {
      address: '0x2222222222222222222222222222222222222222' as const,
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: address,
      walletKind: 'EOA' as const,
      chainId: '10',
    }
    mocks.connectHostWallet.mockRejectedValueOnce(Object.assign(
      new Error('The Farcaster wallet does not expose the requested Ethereum account.'),
      { code: 'host-wallet-target-unavailable' },
    ))
    const { result } = renderHook(() => useXmtpMessaging({ inboxTarget: target }))

    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('target-unavailable')
    expect(mocks.connectHostWallet).toHaveBeenCalledOnce()
    expect(mocks.connectHostWallet).toHaveBeenCalledWith(
      target.sourceAddress,
      target.sourceAddress,
    )
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('does not apply a saved target to a different preferred Farcaster account', async () => {
    const target = {
      address: '0x2222222222222222222222222222222222222222' as const,
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: '0x3333333333333333333333333333333333333333' as const,
      walletKind: 'EOA' as const,
      chainId: '10',
    }
    mocks.connectHostWallet.mockRejectedValueOnce(Object.assign(
      new Error('private provider account details'),
      { code: 'host-wallet-source-mismatch' },
    ))
    const { result } = renderHook(() => useXmtpMessaging({ inboxTarget: target }))

    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('target-source-mismatch')
    expect(mocks.connectHostWallet).toHaveBeenCalledOnce()
    expect(mocks.connectHostWallet).toHaveBeenCalledWith(
      target.sourceAddress,
      target.sourceAddress,
    )
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('maps a changed saved inbox ID to target recovery without rendering it', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const target = {
      address: targetAddress,
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: address,
      walletKind: 'EOA' as const,
      chainId: '10',
    }
    mocks.connectHostWallet.mockResolvedValueOnce({
      address,
      chainId: 10n,
      kind: 'EOA',
      provider,
      signer: { farcaster: true },
    })
    const mismatch = new Error('private inbox IDs must not be shown')
    mismatch.name = 'XmtpInboxTargetMismatchError'
    mocks.createSession.mockRejectedValue(mismatch)
    const { result } = renderHook(() => useXmtpMessaging({ inboxTarget: target }))

    await act(async () => result.current.connect())

    expect(result.current.connection).toEqual({
      error: 'XMTP opened a different inbox than the verified target.',
      phase: 'target-mismatch',
    })
    expect(result.current.conversations).toEqual([])
  })

  it('retains the OPFS lease when wallet invalidation races unsafe initialization', async () => {
    const lease = { release: vi.fn().mockResolvedValue(undefined) }
    const creating = deferred<ReturnType<typeof createSession>>()
    mocks.acquireXmtpLease.mockResolvedValue(lease)
    mocks.createSession.mockReturnValue(creating.promise)
    const { result, unmount } = renderHook(() => useXmtpMessaging())

    let connection!: Promise<void>
    await act(async () => {
      connection = result.current.connect()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.connection.phase).toBe('xmtp'))
    const accountsChanged = provider.on.mock.calls.find(
      ([event]) => event === 'accountsChanged',
    )?.[1] as ((accounts: readonly string[]) => void) | undefined
    expect(accountsChanged).toBeTypeOf('function')

    act(() => accountsChanged?.([]))
    expect(result.current.connection.phase).toBe('restart-required')

    const unsafe = new Error('worker init failed')
    unsafe.name = 'XmtpClientInitializationError'
    await act(async () => {
      creating.reject(unsafe)
      await connection
    })

    expect(result.current.connection.phase).toBe('restart-required')
    expect(lease.release).not.toHaveBeenCalled()
    unmount()
    await act(async () => Promise.resolve())
    expect(lease.release).not.toHaveBeenCalled()
  })

  it('never releases a poisoned lease after direct client initialization failure', async () => {
    const lease = { release: vi.fn().mockResolvedValue(undefined) }
    mocks.acquireXmtpLease.mockResolvedValue(lease)
    mocks.createSession.mockRejectedValue(
      new XmtpClientInitializationError(new Error('worker init failed')),
    )
    const { result, unmount } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    expect(result.current.connection.phase).toBe('restart-required')
    expect(lease.release).not.toHaveBeenCalled()

    unmount()
    await act(async () => Promise.resolve())
    expect(lease.release).not.toHaveBeenCalled()
  })

  it('retains the OPFS lease when unsafe initialization rejects after a React unmount', async () => {
    const lease = { release: vi.fn().mockResolvedValue(undefined) }
    const creating = deferred<ReturnType<typeof createSession>>()
    mocks.acquireXmtpLease.mockResolvedValue(lease)
    mocks.createSession.mockReturnValue(creating.promise)
    const { result, unmount } = renderHook(() => useXmtpMessaging())

    let connection!: Promise<void>
    await act(async () => {
      connection = result.current.connect()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.connection.phase).toBe('xmtp'))
    unmount()

    const unsafe = new Error('worker init failed')
    unsafe.name = 'XmtpClientInitializationError'
    await act(async () => {
      creating.reject(unsafe)
      await connection
    })

    expect(lease.release).not.toHaveBeenCalled()
  })

  it('stops automatic setup after rejection and retries only on request', async () => {
    const session = createSession()
    mocks.connectHostWallet
      .mockRejectedValueOnce({ code: 4001, message: 'User rejected the request.' })
      .mockResolvedValueOnce({
        address,
        chainId: 10n,
        kind: 'EOA',
        provider,
        signer: {},
      })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging({ autoConnect: true }))

    await waitFor(() => expect(result.current.connection.phase).toBe('error'))
    expect(result.current.connection.error).toMatch(/wallet request was cancelled/i)
    expect(mocks.connectHostWallet).toHaveBeenCalledOnce()

    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('ready')
    expect(mocks.connectHostWallet).toHaveBeenCalledTimes(2)
    expect(mocks.createSession).toHaveBeenCalledOnce()
  })

  it('stops before wallet access when secure browser storage is unsupported', async () => {
    mocks.prepareStorage.mockRejectedValue({
      message: 'This browser does not provide the secure local storage XMTP requires.',
      name: 'XmtpStorageUnsupportedError',
    })
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('unsupported-browser')
    expect(result.current.connection.error).toMatch(/secure local storage features/)
    expect(mocks.acquireXmtpLease).not.toHaveBeenCalled()
    expect(mocks.connectHostWallet).not.toHaveBeenCalled()
  })

  it('continues with a persistent warning when durability is best effort', async () => {
    const session = createSession()
    mocks.prepareStorage.mockResolvedValue('best-effort')
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('ready')
    expect(result.current.storageDurability).toBe('best-effort')
  })

  it('tears down a session that reports a terminal synchronization timeout', async () => {
    const session = createSession()
    let reportTerminal: ((error: Error) => void) | undefined
    mocks.createSession.mockImplementation((
      _signer: unknown,
      _address: unknown,
      _inboxId: unknown,
      onTerminal?: (error: Error) => void,
    ) => {
      reportTerminal = onTerminal
      return Promise.resolve(session)
    })
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    act(() => reportTerminal?.(new Error('XMTP synchronization timed out.')))

    await waitFor(() => expect(session.close).toHaveBeenCalledOnce())
    expect(result.current.connection.phase).toBe('error')
    expect(result.current.connection.error).toMatch(/stopped responding/i)
    expect(result.current.address).toBeNull()
    expect(result.current.conversations).toEqual([])
  })

  it('releases the lease and stops on the active-installation limit', async () => {
    const lease = { release: vi.fn().mockResolvedValue(undefined) }
    mocks.acquireXmtpLease.mockResolvedValue(lease)
    mocks.createSession.mockRejectedValue(new Error(
      'Cannot register a new installation because the InboxID private-id has already registered 10 installations. Please revoke existing installations first.',
    ))
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('installation-limit')
    expect(result.current.connection.error).toMatch(/maximum number of active installations/)
    expect(result.current.connection.error).not.toContain('private-id')
    expect(mocks.createSession).toHaveBeenCalledOnce()
    expect(lease.release).toHaveBeenCalledOnce()
  })

  it('presents a missing payer Gateway as non-retryable configuration', async () => {
    const lease = { release: vi.fn().mockResolvedValue(undefined) }
    const error = new Error('XMTP mainnet requires an authenticated payer Gateway.')
    error.name = 'XmtpGatewayConfigurationError'
    mocks.acquireXmtpLease.mockResolvedValue(lease)
    mocks.createSession.mockRejectedValue(error)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('configuration-error')
    expect(result.current.connection.error).toMatch(/not configured for this XMTP network/)
    expect(lease.release).toHaveBeenCalledOnce()
  })

  it('shows the cached inbox before sync settles and retains it when sync fails', async () => {
    const sync = deferred<ConversationSummary[]>()
    const cachedRead = deferred<void>()
    const session = createSession({
      loadInbox: vi.fn(async (onCached?: (items: ConversationSummary[]) => void) => {
        onCached?.([cachedConversation])
        cachedRead.resolve()
        return sync.promise
      }),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    let connectPromise!: Promise<void>
    await act(async () => {
      connectPromise = result.current.connect()
      await cachedRead.promise
    })

    expect(result.current.connection.phase).toBe('ready')
    expect(result.current.refreshing).toBe(true)
    expect(result.current.conversations).toEqual([cachedConversation])

    await act(async () => {
      sync.reject(new Error('Network sync is unavailable.'))
      await connectPromise
    })

    expect(result.current.connection.phase).toBe('ready')
    expect(result.current.refreshing).toBe(false)
    expect(result.current.conversations).toEqual([cachedConversation])
    expect(result.current.notice).toMatch(/temporarily unreachable/)
    expect(result.current.streamHealth).toBe('failed')
    expect(session.startMessageStream).toHaveBeenCalledOnce()
  })

  it('opens saved messages without sync while offline and refreshes once online', async () => {
    const sentinel = 'OFFLINE_SENTINEL_DO_NOT_COPY_TO_WEB_STORAGE'
    const savedMessage = message('saved-offline', sentinel, '2026-07-14T12:00:00Z')
    const refreshedMessage = message(
      'refreshed-online',
      'Arrived after reconnecting',
      '2026-07-14T12:01:00Z',
    )
    const startMessageStream = vi.fn(async (
      _onMessage: unknown,
      onHealth: (health: 'live') => void,
    ) => onHealth('live'))
    const session = createSession({
      loadConversation: vi.fn().mockResolvedValue({
        conversation: activeConversation,
        hasOlder: false,
        messages: [savedMessage, refreshedMessage],
        scannedMessageCount: 2,
      }),
      readConversation: vi.fn().mockResolvedValue({
        conversation: activeConversation,
        hasOlder: false,
        messages: [savedMessage],
        scannedMessageCount: 1,
      }),
      startMessageStream,
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    expect(session.loadInbox).toHaveBeenCalledOnce()

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    act(() => window.dispatchEvent(new Event('offline')))
    expect(result.current.streamHealth).toBe('offline')

    await act(async () => result.current.refresh())
    expect(session.readInbox).toHaveBeenCalledOnce()
    expect(session.loadInbox).toHaveBeenCalledOnce()

    await act(async () => result.current.openConversation(activeConversation.id))

    expect(result.current.loadingConversation).toBe(false)
    expect(result.current.messages).toEqual([savedMessage])
    expect(session.readConversation).toHaveBeenCalledOnce()
    expect(session.loadConversation).not.toHaveBeenCalled()
    expect(session.startMessageStream).toHaveBeenCalledOnce()
    expect([...storageValues(localStorage), ...storageValues(sessionStorage)].join('\n'))
      .not.toContain(sentinel)

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    act(() => window.dispatchEvent(new Event('online')))

    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(session.loadConversation).toHaveBeenCalledOnce())
    await waitFor(() => expect(result.current.streamHealth).toBe('live'))
    expect(result.current.messages.map(({ id }) => id)).toEqual([
      'saved-offline',
      'refreshed-online',
    ])
  })

  it('does not treat the first webview focus as a resume while opening a conversation', async () => {
    const initialInbox = deferred<ConversationSummary[]>()
    const cachedInboxRead = deferred<void>()
    const savedMessage = message('message-1', 'Saved message', '2026-07-14T12:00:00Z')
    const session = createSession({
      loadInbox: vi.fn((onCached?: (items: ConversationSummary[]) => void) => {
        onCached?.([cachedConversation])
        cachedInboxRead.resolve()
        return initialInbox.promise
      }),
      loadConversation: vi.fn().mockResolvedValue({
        conversation: activeConversation,
        hasOlder: false,
        messages: [savedMessage],
        scannedMessageCount: 1,
      }),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    let connection!: Promise<void>
    await act(async () => {
      connection = result.current.connect()
      await cachedInboxRead.promise
    })
    expect(result.current.connection.phase).toBe('ready')

    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    await act(async () => result.current.openConversation(activeConversation.id))

    expect(result.current.view).toBe('conversation')
    expect(result.current.messages).toEqual([savedMessage])
    expect(session.loadInbox).toHaveBeenCalledOnce()
    expect(session.loadConversation).toHaveBeenCalledOnce()
    expect(provider.request).not.toHaveBeenCalledWith({ method: 'eth_accounts' })
    expect(mocks.connectHostWallet).toHaveBeenCalledOnce()
    expect(mocks.createSession).toHaveBeenCalledOnce()
    expect(session.close).not.toHaveBeenCalled()

    await act(async () => {
      initialInbox.resolve([cachedConversation])
      await connection
    })
    expect(result.current.view).toBe('conversation')
    expect(result.current.messages).toEqual([savedMessage])
  })

  it('keeps the first conversation open while a resume inbox refresh settles', async () => {
    const resumeInbox = deferred<ConversationSummary[]>()
    const savedMessage = message('message-1', 'Saved message', '2026-07-14T12:00:00Z')
    const session = createSession({
      loadConversation: vi.fn().mockResolvedValue({
        conversation: activeConversation,
        hasOlder: false,
        messages: [savedMessage],
        scannedMessageCount: 1,
      }),
    })
    session.loadInbox
      .mockResolvedValueOnce([cachedConversation])
      .mockReturnValueOnce(resumeInbox.promise)
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))

    await act(async () => result.current.openConversation(activeConversation.id))
    expect(result.current.view).toBe('conversation')
    expect(result.current.messages).toEqual([savedMessage])

    await act(async () => resumeInbox.resolve([cachedConversation]))

    expect(result.current.view).toBe('conversation')
    expect(result.current.activeConversation).toEqual(activeConversation)
    expect(result.current.messages).toEqual([savedMessage])
    expect(session.loadConversation).toHaveBeenCalledOnce()
    expect(session.close).not.toHaveBeenCalled()
  })

  it('keeps the selected conversation open when its first sync fails', async () => {
    const session = createSession({
      loadConversation: vi.fn().mockRejectedValue(new Error('temporary sync conflict')),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    await act(async () => result.current.openConversation(activeConversation.id))

    expect(result.current.view).toBe('conversation')
    expect(result.current.activeConversation).toEqual(activeConversation)
    expect(result.current.loadingConversation).toBe(false)
    expect(result.current.streamHealth).toBe('failed')
    expect(result.current.notice).toMatch(/saved inbox entry remains open/i)
    expect(session.close).not.toHaveBeenCalled()
  })

  it('uses only the local inbox when an already-created session begins offline', async () => {
    const session = createSession({ isNewInstallation: true })
    mocks.createSession.mockResolvedValue(session)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())

    expect(result.current.connection.phase).toBe('ready')
    expect(result.current.streamHealth).toBe('offline')
    expect(session.readInbox).toHaveBeenCalledOnce()
    expect(session.requestHistorySync).not.toHaveBeenCalled()
    expect(session.loadInbox).not.toHaveBeenCalled()
    expect(session.startMessageStream).not.toHaveBeenCalled()
  })

  it('stops waiting for online refresh work when connectivity drops', async () => {
    const sync = deferred<ConversationSummary[]>()
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    session.loadInbox.mockReturnValueOnce(sync.promise)

    let refresh!: Promise<void>
    act(() => {
      refresh = result.current.retryLiveUpdates()
    })
    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    act(() => window.dispatchEvent(new Event('offline')))
    await act(async () => refresh)

    expect(result.current.streamHealth).toBe('offline')
    expect(session.readInbox).toHaveBeenCalledOnce()
    expect(session.startMessageStream).toHaveBeenCalledOnce()

    await act(async () => sync.resolve([cachedConversation]))
    expect(session.startMessageStream).toHaveBeenCalledOnce()
  })

  it('finishes opening from saved messages when conversation sync loses connectivity', async () => {
    const sync = deferred<{
      conversation: ActiveConversation
      hasOlder: boolean
      messages: MessageItem[]
      scannedMessageCount: number
    }>()
    const savedMessage = message('saved-during-drop', 'Still readable', '2026-07-14T12:00:00Z')
    const savedLoad = {
      conversation: activeConversation,
      hasOlder: false,
      messages: [savedMessage],
      scannedMessageCount: 1,
    }
    const session = createSession({
      loadConversation: vi.fn((
        _conversationId: string,
        onCached?: (loaded: typeof savedLoad) => void,
      ) => {
        onCached?.(savedLoad)
        return sync.promise
      }),
      readConversation: vi.fn().mockResolvedValue(savedLoad),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    let opening!: Promise<void>
    act(() => {
      opening = result.current.openConversation(activeConversation.id)
    })
    await waitFor(() => expect(result.current.messages).toEqual([savedMessage]))
    expect(result.current.loadingConversation).toBe(true)

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    act(() => window.dispatchEvent(new Event('offline')))
    await act(async () => opening)

    expect(result.current.loadingConversation).toBe(false)
    expect(result.current.view).toBe('conversation')
    expect(result.current.messages).toEqual([savedMessage])
    expect(session.readConversation).toHaveBeenCalledOnce()

    await act(async () => sync.resolve(savedLoad))
    expect(result.current.messages).toEqual([savedMessage])
  })

  it('does not lose an online recovery that arrives during an offline cache read', async () => {
    const offlineRead = deferred<ConversationSummary[]>()
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    session.readInbox.mockReturnValueOnce(offlineRead.promise)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    act(() => window.dispatchEvent(new Event('offline')))

    let offlineRefresh!: Promise<void>
    act(() => {
      offlineRefresh = result.current.retryLiveUpdates()
    })
    await waitFor(() => expect(session.readInbox).toHaveBeenCalledOnce())

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    act(() => window.dispatchEvent(new Event('online')))
    await act(async () => {
      offlineRead.resolve([cachedConversation])
      await offlineRefresh
    })

    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(session.startMessageStream).toHaveBeenCalledTimes(2))
  })

  it('does not leave a conversation or overwrite its notice when initial sync finishes', async () => {
    const sync = deferred<ConversationSummary[]>()
    const cachedRead = deferred<void>()
    const savedMessage = message('message-1', 'Saved message', '2026-07-14T12:00:00Z')
    const session = createSession({
      loadConversation: vi.fn().mockResolvedValue({
        conversation: activeConversation,
        hasOlder: false,
        messages: [savedMessage],
      }),
      loadInbox: vi.fn(async (onCached?: (items: ConversationSummary[]) => void) => {
        onCached?.([cachedConversation])
        cachedRead.resolve()
        return sync.promise
      }),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    let connectPromise!: Promise<void>
    await act(async () => {
      connectPromise = result.current.connect()
      await cachedRead.promise
    })
    await act(async () => {
      await result.current.openConversation(activeConversation.id)
      result.current.setNotice('Conversation notice')
    })

    await act(async () => {
      sync.resolve([cachedConversation])
      await connectPromise
    })

    expect(result.current.view).toBe('conversation')
    expect(result.current.activeConversation).toEqual(activeConversation)
    expect(result.current.messages).toEqual([savedMessage])
    expect(result.current.notice).toBe('Conversation notice')
  })

  it('lets synchronized delivery state replace a stale cached failure', async () => {
    const cached = {
      ...message('message-1', 'Hello', '2026-07-14T12:00:00Z'),
      canRetry: true,
      delivery: 'failed' as const,
    }
    const synchronized = {
      ...cached,
      canRetry: false,
      delivery: 'sent' as const,
    }
    const session = createSession({
      loadConversation: vi.fn(async (
        _conversationId: string,
        onCached?: (loaded: {
          conversation: ActiveConversation
          hasOlder: boolean
          messages: MessageItem[]
        }) => void,
      ) => {
        onCached?.({
          conversation: activeConversation,
          hasOlder: false,
          messages: [cached],
        })
        return {
          conversation: activeConversation,
          hasOlder: false,
          messages: [synchronized],
        }
      }),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    await act(async () => result.current.openConversation(activeConversation.id))

    expect(result.current.messages).toEqual([synchronized])
  })

  it('orders same-millisecond messages by their exact nanosecond timestamps', async () => {
    const later = {
      ...message('a', 'Later', '2026-07-14T12:00:00Z'),
      sentAtNs: 1_784_030_400_000_000_002n,
    }
    const earlier = {
      ...message('z', 'Earlier', '2026-07-14T12:00:00Z'),
      sentAtNs: 1_784_030_400_000_000_001n,
    }
    const session = createSession({
      loadConversation: vi.fn().mockResolvedValue({
        conversation: activeConversation,
        hasOlder: false,
        messages: [later, earlier],
      }),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    await act(async () => result.current.openConversation(activeConversation.id))

    expect(result.current.messages.map(({ id }) => id)).toEqual(['z', 'a'])
  })

  it('pages by scanned controls even when no displayable messages were added', async () => {
    const olderVisible = message(
      'older-visible',
      'Visible after controls',
      '2026-07-14T11:00:00Z',
    )
    const loadOlderMessages = vi.fn((
      _conversationId: string,
      scannedMessageCount: number,
    ) => Promise.resolve(scannedMessageCount === 50
      ? {
          hasOlder: true,
          messages: [],
          scannedMessageCount: 100,
        }
      : {
          hasOlder: false,
          messages: [olderVisible],
          scannedMessageCount: 121,
        }))
    const session = createSession({
      loadConversation: vi.fn().mockResolvedValue({
        conversation: activeConversation,
        hasOlder: true,
        messages: [],
        scannedMessageCount: 50,
      }),
      loadOlderMessages,
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    await act(async () => result.current.openConversation(activeConversation.id))
    await act(async () => result.current.loadOlderMessages())
    await act(async () => result.current.loadOlderMessages())

    expect(loadOlderMessages).toHaveBeenNthCalledWith(
      1,
      activeConversation.id,
      50,
    )
    expect(loadOlderMessages).toHaveBeenNthCalledWith(
      2,
      activeConversation.id,
      100,
    )
    expect(result.current.messages.map(({ id }) => id)).toEqual(['older-visible'])
    expect(result.current.hasOlderMessages).toBe(false)
  })

  it('lets a newly opened conversation page while an older view is still loading', async () => {
    const secondSummary: ConversationSummary = {
      ...cachedConversation,
      id: 'conversation-2',
      kind: 'dm',
      peerInboxId: 'peer-inbox-2',
    }
    const firstPage = deferred<{ hasOlder: boolean; messages: MessageItem[] }>()
    const firstMessage = message('first', 'First conversation', '2026-07-14T12:00:00Z')
    const secondMessage = {
      ...message('second', 'Second conversation', '2026-07-14T12:01:00Z'),
      conversationId: secondSummary.id,
    }
    const secondOlder = {
      ...message('second-older', 'Earlier second message', '2026-07-14T11:59:00Z'),
      conversationId: secondSummary.id,
    }
    const loadOlderMessages = vi.fn((conversationId: string) => (
      conversationId === cachedConversation.id
        ? firstPage.promise
        : Promise.resolve({ hasOlder: false, messages: [secondOlder, secondMessage] })
    ))
    const session = createSession({
      loadConversation: vi.fn((conversationId: string) => Promise.resolve({
        conversation: conversationId === cachedConversation.id
          ? activeConversation
          : {
              id: secondSummary.id,
              peerAddress: secondSummary.peerAddress,
              peerInboxId: secondSummary.peerInboxId,
            },
        hasOlder: true,
        messages: [conversationId === cachedConversation.id ? firstMessage : secondMessage],
      })),
      loadInbox: vi.fn().mockResolvedValue([cachedConversation, secondSummary]),
      loadOlderMessages,
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    await act(async () => result.current.openConversation(cachedConversation.id))

    let staleLoad!: Promise<void>
    act(() => {
      staleLoad = result.current.loadOlderMessages()
    })
    await waitFor(() => expect(result.current.loadingOlder).toBe(true))

    await act(async () => {
      result.current.backToInbox()
      await result.current.openConversation(secondSummary.id)
    })
    await act(async () => result.current.loadOlderMessages())

    expect(loadOlderMessages).toHaveBeenCalledTimes(2)
    expect(result.current.activeConversation?.id).toBe(secondSummary.id)
    expect(result.current.messages.map(({ id }) => id)).toEqual(['second-older', 'second'])

    await act(async () => {
      firstPage.resolve({ hasOlder: false, messages: [firstMessage] })
      await staleLoad
    })
    expect(result.current.activeConversation?.id).toBe(secondSummary.id)
    expect(result.current.messages.map(({ id }) => id)).toEqual(['second-older', 'second'])
  })

  it('does not restart stale work after disconnecting from a cached-ready inbox', async () => {
    const sync = deferred<ConversationSummary[]>()
    const cachedRead = deferred<void>()
    const session = createSession({
      loadInbox: vi.fn(async (onCached?: (items: ConversationSummary[]) => void) => {
        onCached?.([cachedConversation])
        cachedRead.resolve()
        return sync.promise
      }),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    let connectPromise!: Promise<void>
    await act(async () => {
      connectPromise = result.current.connect()
      await cachedRead.promise
    })
    await act(async () => result.current.disconnect())
    await act(async () => {
      sync.resolve([cachedConversation])
      await connectPromise
    })

    expect(result.current.connection.phase).toBe('idle')
    expect(result.current.streamHealth).toBe('live')
    expect(session.startMessageStream).not.toHaveBeenCalled()
  })

  it('does not reopen a DM that finishes creating after the user goes back', async () => {
    const creation = deferred<ActiveConversation>()
    const session = createSession({
      createDm: vi.fn().mockReturnValue(creation.promise),
      loadConversation: vi.fn(),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    act(() => result.current.setView('new-dm'))

    let createPromise!: Promise<void>
    act(() => {
      createPromise = result.current.createDm(
        '0x2222222222222222222222222222222222222222',
      )
    })
    act(() => result.current.backToInbox())
    await act(async () => {
      creation.resolve(activeConversation)
      await createPromise
    })

    expect(result.current.view).toBe('inbox')
    expect(result.current.activeConversation).toBeNull()
    expect(session.loadConversation).not.toHaveBeenCalled()
  })

  it('sends one Convos request per in-flight deliberate attempt without Web Storage', async () => {
    const sending = deferred<{
      conversationId: string
      messageId: string
    }>()
    const requestConvosAccess = vi.fn().mockReturnValue(sending.promise)
    const session = createSession({ requestConvosAccess })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    const invite = convosInvite()
    let first!: Promise<void>
    let duplicate!: Promise<void>
    act(() => {
      first = result.current.requestConvosAccess(invite)
      duplicate = result.current.requestConvosAccess(invite)
    })

    expect(result.current.convosAccessRequest).toMatchObject({
      invite,
      status: 'sending',
    })
    expect(requestConvosAccess).toHaveBeenCalledOnce()
    await duplicate
    await act(async () => {
      sending.resolve({
        conversationId: 'creator-transport-dm',
        messageId: 'join-request-message',
      })
      await first
    })

    expect(result.current.convosAccessRequest).toMatchObject({
      conversationId: 'creator-transport-dm',
      error: null,
      messageId: 'join-request-message',
      status: 'waiting',
    })
    expect(storageValues(localStorage).join(' ')).not.toContain(invite.slug)
    expect(storageValues(sessionStorage).join(' ')).not.toContain(invite.slug)
  })

  it('revalidates before every deliberate fresh Convos retry', async () => {
    const requestConvosAccess = vi.fn()
      .mockRejectedValueOnce(new Error('database path and bearer-secret-slug'))
      .mockResolvedValueOnce({
        conversationId: 'creator-transport-dm',
        messageId: 'join-request-message',
      })
    const session = createSession({ requestConvosAccess })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    await act(async () => result.current.requestConvosAccess(convosInvite()))
    expect(result.current.convosAccessRequest).toMatchObject({
      conversationId: null,
      error: 'XMTP could not send the Convos access request.',
      messageId: null,
      status: 'failed',
    })
    expect(result.current.convosAccessRequest?.error).not.toContain('bearer-secret')

    await act(async () => result.current.retryConvosAccess())
    expect(requestConvosAccess).toHaveBeenCalledTimes(2)
    expect(mocks.parseConvosInvite).toHaveBeenCalledWith('bearer-secret-slug')
    expect(result.current.convosAccessRequest?.status).toBe('waiting')
  })

  it('lets an ordinary failed Convos attempt be abandoned safely', async () => {
    const session = createSession({
      requestConvosAccess: vi.fn().mockRejectedValue(new Error('send failed')),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    await act(async () => result.current.requestConvosAccess(convosInvite()))

    expect(result.current.convosAccessRequest).toMatchObject({
      retryMode: 'fresh',
      status: 'failed',
    })
    act(() => result.current.resetConvosAccessRequest())
    expect(result.current.convosAccessRequest).toBeNull()
  })

  it.each([
    ['invite_expired', 'That Convos invite has expired.'],
    ['conversation_expired', 'That Convos conversation has expired.'],
  ] as const)('blocks Convos retry after %s revalidation', async (code, message) => {
    const requestConvosAccess = vi.fn().mockRejectedValue(
      new Error('network send failed'),
    )
    const session = createSession({ requestConvosAccess })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    await act(async () => result.current.requestConvosAccess(convosInvite()))
    mocks.parseConvosInvite.mockImplementationOnce(() => {
      throw new ConvosInviteError(code)
    })

    await act(async () => result.current.retryConvosAccess())

    expect(requestConvosAccess).toHaveBeenCalledOnce()
    expect(result.current.convosAccessRequest).toMatchObject({
      error: message,
      retryMode: 'reset',
      status: 'failed',
    })
    act(() => result.current.resetConvosAccessRequest())
    expect(result.current.convosAccessRequest).toBeNull()
  })

  it('preserves a pending Convos request on back and clears it on disconnect', async () => {
    const session = createSession({
      requestConvosAccess: vi.fn().mockResolvedValue({
        conversationId: 'creator-transport-dm',
        messageId: 'join-request-message',
      }),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    act(() => result.current.setView('join-convos'))
    await act(async () => result.current.requestConvosAccess(convosInvite()))

    act(() => result.current.backToInbox())
    expect(result.current.convosAccessRequest?.status).toBe('waiting')
    await act(async () => result.current.disconnect())
    expect(result.current.convosAccessRequest).toBeNull()
  })

  it('restores an authenticated Convos request status from local XMTP history', async () => {
    const invite = convosInvite()
    const session = createSession({
      convosAccessSnapshot: {
        conversationId: 'creator-transport-dm',
        error: null,
        groupId: null,
        invite,
        messageId: 'join-request-message',
        retryMode: 'none',
        status: 'handled',
      },
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())

    expect(result.current.convosAccessRequest).toEqual({
      conversationId: 'creator-transport-dm',
      error: null,
      groupId: null,
      invite,
      messageId: 'join-request-message',
      retryMode: 'none',
      status: 'handled',
    })
  })

  it('dismisses a recovered failed request in the session so refresh cannot resurrect it', async () => {
    let snapshot: ConvosAccessSnapshot | null = {
      conversationId: 'creator-transport-dm',
      error: 'That Convos invite has expired.',
      groupId: null,
      invite: convosInvite(),
      messageId: 'expired-request-message',
      retryMode: 'reset',
      status: 'failed',
    }
    const dismissConvosAccessRequest = vi.fn(() => {
      snapshot = null
    })
    const session = createSession({ dismissConvosAccessRequest })
    Object.defineProperty(session, 'convosAccessSnapshot', {
      configurable: true,
      get: () => snapshot,
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    expect(result.current.convosAccessRequest?.status).toBe('failed')

    act(() => result.current.resetConvosAccessRequest())
    expect(dismissConvosAccessRequest).toHaveBeenCalledWith('expired-request-message')
    expect(result.current.convosAccessRequest).toBeNull()

    await act(async () => result.current.refresh())
    expect(result.current.convosAccessRequest).toBeNull()
  })

  it('applies a matching joined snapshot that arrived while request publication was pending', async () => {
    const publishing = deferred<{ conversationId: string; messageId: string }>()
    let snapshot: ConvosAccessSnapshot | null = null
    const session = createSession({
      requestConvosAccess: vi.fn().mockReturnValue(publishing.promise),
    })
    Object.defineProperty(session, 'convosAccessSnapshot', {
      configurable: true,
      get: () => snapshot,
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    let requesting!: Promise<void>
    act(() => {
      requesting = result.current.requestConvosAccess(convosInvite())
    })
    snapshot = {
      conversationId: 'creator-transport-dm',
      error: null,
      groupId: 'verified-group',
      invite: convosInvite(),
      messageId: 'join-request-message',
      retryMode: 'none',
      status: 'joined',
    }
    await act(async () => {
      publishing.resolve({
        conversationId: 'creator-transport-dm',
        messageId: 'join-request-message',
      })
      await requesting
    })

    expect(result.current.convosAccessRequest).toMatchObject({
      groupId: 'verified-group',
      status: 'joined',
    })
  })

  it('reconciles a newly delivered verified group and opens its shared timeline', async () => {
    let onInboxChanged: (() => void) | undefined
    let snapshot: Record<string, unknown> | null = null
    const groupLoad = {
      conversation: activeGroup,
      hasOlder: false,
      messages: [
        {
          ...message('group-message', 'Welcome to the garden', '2026-07-14T12:01:00Z'),
          conversationId: activeGroup.id,
        },
      ],
      scannedMessageCount: 1,
    }
    const session = createSession({
      loadConversation: vi.fn().mockResolvedValue(groupLoad),
      readInbox: vi.fn().mockResolvedValue([groupSummary]),
      startMessageStream: vi.fn(async (
        _onMessage: unknown,
        _onHealth: unknown,
        nextOnInboxChanged: () => void,
      ) => {
        onInboxChanged = nextOnInboxChanged
      }),
    })
    Object.defineProperty(session, 'convosAccessSnapshot', {
      configurable: true,
      get: () => snapshot,
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    snapshot = {
      conversationId: 'creator-transport-dm',
      error: null,
      groupId: activeGroup.id,
      invite: convosInvite(),
      messageId: 'join-request-message',
      retryMode: 'none',
      status: 'joined',
    }
    act(() => onInboxChanged?.())

    await waitFor(() => expect(result.current.convosAccessRequest?.status).toBe('joined'))
    expect(result.current.conversations).toEqual([groupSummary])

    await act(async () => result.current.openConversation(activeGroup.id))
    expect(result.current.activeConversation).toEqual(activeGroup)
    expect(result.current.messages).toEqual(groupLoad.messages)
  })

  it('does not expose raw XMTP errors in recipient validation', async () => {
    const session = createSession({
      createDm: vi.fn().mockRejectedValue(
        new Error('opaque database detail for private-inbox-id'),
      ),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    await expect(result.current.createDm(
      '0x2222222222222222222222222222222222222222',
    )).rejects.toThrow('XMTP could not check that address.')
  })

  it('checks recipient reachability without creating a conversation', async () => {
    const canMessageAddress = vi.fn().mockResolvedValue(true)
    const session = createSession({ canMessageAddress })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    await expect(result.current.canMessageAddress(
      '0x2222222222222222222222222222222222222222',
    )).resolves.toBe(true)
    expect(canMessageAddress).toHaveBeenCalledOnce()
    expect(session.createDm).not.toHaveBeenCalled()
  })

  it('redacts raw recipient reachability errors', async () => {
    const session = createSession({
      canMessageAddress: vi.fn().mockRejectedValue(
        new Error('private inbox-id and database path'),
      ),
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    await expect(result.current.canMessageAddress(
      '0x2222222222222222222222222222222222222222',
    )).rejects.toThrow('XMTP could not check that recipient right now.')
  })

  it('refreshes an open conversation when the app comes back online', async () => {
    const savedMessage = message('message-1', 'Saved message', '2026-07-14T12:00:00Z')
    const networkMessage = message('message-2', 'New message', '2026-07-14T12:01:00Z')
    const loadConversation = vi.fn().mockResolvedValue({
      conversation: activeConversation,
      hasOlder: false,
      messages: [savedMessage],
    })
    const session = createSession({ loadConversation })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => {
      await result.current.connect()
    })
    await act(async () => {
      await result.current.openConversation(activeConversation.id)
    })
    expect(result.current.messages).toEqual([savedMessage])

    loadConversation.mockResolvedValueOnce({
      conversation: activeConversation,
      hasOlder: true,
      messages: [networkMessage],
    })
    act(() => window.dispatchEvent(new Event('online')))

    await waitFor(() => {
      expect(loadConversation).toHaveBeenCalledTimes(2)
      expect(result.current.messages.map(({ id }) => id)).toEqual([
        savedMessage.id,
        networkMessage.id,
      ])
      expect(result.current.hasOlderMessages).toBe(true)
      expect(session.startMessageStream).toHaveBeenCalledTimes(2)
    })
  })

  it('does not refresh on window focus until the webview was backgrounded', async () => {
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () => Promise.resolve())

    expect(session.loadInbox).toHaveBeenCalledOnce()
    expect(provider.request).not.toHaveBeenCalledWith({ method: 'eth_accounts' })
  })

  it('preserves a real background event while the XMTP client is still opening', async () => {
    const creating = deferred<ReturnType<typeof createSession>>()
    const session = createSession()
    mocks.createSession.mockReturnValue(creating.promise)
    const { result } = renderHook(() => useXmtpMessaging())

    let connection!: Promise<void>
    act(() => {
      connection = result.current.connect()
    })
    await waitFor(() => expect(result.current.connection.phase).toBe('xmtp'))

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => {
      creating.resolve(session)
      await connection
    })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    act(() => document.dispatchEvent(new Event('visibilitychange')))

    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_accounts' })
    expect(result.current.connection.phase).toBe('ready')
    expect(session.close).not.toHaveBeenCalled()
  })

  it('revalidates a hidden and visible cycle that completes during setup', async () => {
    const creating = deferred<ReturnType<typeof createSession>>()
    const session = createSession()
    mocks.createSession.mockReturnValue(creating.promise)
    const { result } = renderHook(() => useXmtpMessaging())

    let connection!: Promise<void>
    act(() => {
      connection = result.current.connect()
    })
    await waitFor(() => expect(result.current.connection.phase).toBe('xmtp'))

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    act(() => document.dispatchEvent(new Event('visibilitychange')))

    await act(async () => {
      creating.resolve(session)
      await connection
    })

    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_accounts' })
    expect(result.current.connection.phase).toBe('ready')
    expect(session.close).not.toHaveBeenCalled()
  })

  it('drains an online recovery that arrives while offline setup is pending', async () => {
    const savedInbox = deferred<ConversationSummary[]>()
    const session = createSession({
      readInbox: vi.fn().mockReturnValueOnce(savedInbox.promise),
    })
    mocks.createSession.mockResolvedValue(session)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const { result } = renderHook(() => useXmtpMessaging())

    let connection!: Promise<void>
    act(() => {
      connection = result.current.connect()
    })
    await waitFor(() => expect(session.readInbox).toHaveBeenCalledOnce())

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    act(() => window.dispatchEvent(new Event('online')))
    await act(async () => {
      savedInbox.resolve([cachedConversation])
      await connection
    })

    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledOnce())
    await waitFor(() => expect(session.startMessageStream).toHaveBeenCalledOnce())
    expect(result.current.connection.phase).toBe('ready')
    expect(provider.request).not.toHaveBeenCalledWith({ method: 'eth_accounts' })
  })

  it.each([
    ['blur and focus', () => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    }],
    ['persisted pageshow', () => {
      const event = new Event('pageshow')
      Object.defineProperty(event, 'persisted', { value: true })
      window.dispatchEvent(event)
    }],
  ] as const)('refreshes visible state after window %s', async (_name, resume) => {
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    act(() => resume())

    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_accounts' })
    expect(provider.request).not.toHaveBeenCalledWith({ method: 'eth_chainId' })
  })

  it('ignores a non-persisted pageshow from initial navigation', async () => {
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    const event = new Event('pageshow')
    Object.defineProperty(event, 'persisted', { value: false })
    act(() => window.dispatchEvent(event))
    await act(async () => Promise.resolve())

    expect(session.loadInbox).toHaveBeenCalledOnce()
    expect(provider.request).not.toHaveBeenCalledWith({ method: 'eth_accounts' })
  })

  it('retries a transient Farcaster provider failure after a real resume', async () => {
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    provider.request
      .mockRejectedValueOnce(new Error('host overlay still closing'))
      .mockResolvedValueOnce([address])

    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))
    expect(provider.request).toHaveBeenCalledTimes(2)
    expect(result.current.connection.phase).toBe('ready')
    expect(session.close).not.toHaveBeenCalled()
    expect(mocks.createSession).toHaveBeenCalledOnce()
  })

  it('times out a stalled Farcaster provider instead of locking resume recovery', async () => {
    vi.useFakeTimers()
    try {
      const session = createSession()
      mocks.createSession.mockResolvedValue(session)
      const { result } = renderHook(() => useXmtpMessaging())
      await act(async () => result.current.connect())
      provider.request.mockReturnValue(new Promise<never>(() => undefined))

      act(() => {
        window.dispatchEvent(new Event('blur'))
        window.dispatchEvent(new Event('focus'))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(provider.request).toHaveBeenCalledTimes(3)
      expect(result.current.connection.phase).toBe('error')
      expect(result.current.connection.error).toMatch(/could not reverify/i)
      expect(session.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drains a second resume that arrives during wallet validation', async () => {
    const firstValidation = deferred<unknown>()
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    provider.request
      .mockReturnValueOnce(firstValidation.promise)
      .mockResolvedValue([address])

    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(provider.request).toHaveBeenCalledOnce())

    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    await act(async () => firstValidation.resolve([address]))

    await waitFor(() => expect(provider.request).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))
    expect(result.current.connection.phase).toBe('ready')
    expect(session.close).not.toHaveBeenCalled()
  })

  it('waits for a new foreground event when the app blurs during validation', async () => {
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    vi.useFakeTimers()
    try {
      provider.request
        .mockReturnValueOnce(new Promise<never>(() => undefined))
        .mockResolvedValue([address])
      act(() => {
        window.dispatchEvent(new Event('blur'))
        window.dispatchEvent(new Event('focus'))
      })
      expect(provider.request).toHaveBeenCalledOnce()

      act(() => window.dispatchEvent(new Event('blur')))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(provider.request).toHaveBeenCalledOnce()
      expect(session.loadInbox).toHaveBeenCalledOnce()
      expect(result.current.connection.phase).toBe('ready')
      expect(session.close).not.toHaveBeenCalled()

      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(provider.request).toHaveBeenCalledTimes(2)
      expect(session.loadInbox).toHaveBeenCalledTimes(2)
      expect(result.current.connection.phase).toBe('ready')
      expect(session.close).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a queued resume drain when another blur arrives first', async () => {
    const firstValidation = deferred<unknown>()
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    vi.useFakeTimers()
    try {
      provider.request
        .mockReturnValueOnce(firstValidation.promise)
        .mockResolvedValue([address])
      act(() => {
        window.dispatchEvent(new Event('blur'))
        window.dispatchEvent(new Event('focus'))
      })
      expect(provider.request).toHaveBeenCalledOnce()

      act(() => {
        window.dispatchEvent(new Event('blur'))
        window.dispatchEvent(new Event('focus'))
      })
      await act(async () => firstValidation.resolve([address]))

      act(() => window.dispatchEvent(new Event('blur')))
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      expect(provider.request).toHaveBeenCalledOnce()
      expect(session.loadInbox).toHaveBeenCalledOnce()
      expect(session.close).not.toHaveBeenCalled()

      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(provider.request).toHaveBeenCalledTimes(2)
      expect(session.loadInbox).toHaveBeenCalledTimes(2)
      expect(result.current.connection.phase).toBe('ready')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores an old wallet validation after a new session reconnects', async () => {
    const oldValidation = deferred<unknown>()
    const firstSession = createSession()
    const secondSession = createSession()
    const firstWallet = {
      address,
      chainId: 10n,
      kind: 'EOA' as const,
      provider,
      signer: {},
    }
    const secondWallet = { ...firstWallet, signer: {} }
    mocks.connectHostWallet
      .mockResolvedValueOnce(firstWallet)
      .mockResolvedValueOnce(secondWallet)
    mocks.createSession
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession)
    const { result } = renderHook(() => useXmtpMessaging())

    await act(async () => result.current.connect())
    provider.request
      .mockReturnValueOnce(oldValidation.promise)
      .mockResolvedValue([address])
    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(provider.request).toHaveBeenCalledOnce())

    await act(async () => result.current.disconnect())
    await act(async () => result.current.connect())
    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(secondSession.loadInbox).toHaveBeenCalledTimes(2))

    await act(async () => oldValidation.resolve([address]))

    expect(provider.request).toHaveBeenCalledTimes(2)
    expect(secondSession.loadInbox).toHaveBeenCalledTimes(2)
    expect(result.current.connection.phase).toBe('ready')
    expect(secondSession.close).not.toHaveBeenCalled()
  })

  it('defers online recovery while the document is hidden', async () => {
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })

    act(() => window.dispatchEvent(new Event('online')))
    await act(async () => Promise.resolve())

    expect(session.loadInbox).toHaveBeenCalledOnce()
    expect(provider.request).not.toHaveBeenCalledWith({ method: 'eth_accounts' })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  it('reverifies only the Farcaster signer for a bound ENS inbox', async () => {
    const targetAddress = '0x2222222222222222222222222222222222222222' as const
    const target = {
      address: targetAddress,
      chainId: '10',
      inboxId: 'target-inbox',
      name: 'deanpierce.eth',
      sourceAddress: address,
      walletKind: 'EOA' as const,
    }
    const session = createSession({
      address,
      inboxId: target.inboxId,
    })
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging({ inboxTarget: target }))
    await act(async () => result.current.connect())
    expect(result.current.connection.phase).toBe('ready')
    provider.request.mockRejectedValue(new Error('host unavailable'))

    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(result.current.connection.phase).toBe('error'))
    expect(result.current.connection.error).toMatch(/could not reverify/i)
    await waitFor(() => expect(session.close).toHaveBeenCalledOnce())
    expect(provider.request).toHaveBeenCalledTimes(3)
    expect(mocks.connectWalletConnectWallet).not.toHaveBeenCalled()
  })

  it('closes the old inbox when the wallet changed while the app was suspended', async () => {
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())
    provider.request.mockImplementation(({ method }: { method: string }) => (
      Promise.resolve(method === 'eth_accounts'
        ? ['0x3333333333333333333333333333333333333333']
        : '0xa')
    ))

    act(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(result.current.connection.phase).toBe('error'))
    expect(result.current.connection.error).toMatch(/account changed while the app was away/)
    await waitFor(() => expect(session.close).toHaveBeenCalledOnce())
    expect(provider.request).toHaveBeenCalledOnce()
  })
})

function convosInvite(): ParsedConvosInvite {
  return {
    creatorInboxId: 'creator-inbox',
    emoji: '🌱',
    expiresAfterUse: false,
    name: 'Garden chat',
    reusable: true,
    slug: 'bearer-secret-slug',
    tag: 'secret-conversation-tag',
  }
}
