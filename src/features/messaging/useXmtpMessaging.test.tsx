import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ActiveConversation,
  ConversationSummary,
  MessageItem,
} from './types'
import { useXmtpMessaging } from './useXmtpMessaging'

const mocks = vi.hoisted(() => ({
  acquireXmtpLease: vi.fn(),
  connectHostWallet: vi.fn(),
  createSession: vi.fn(),
  prepareStorage: vi.fn(),
}))

vi.mock('../../lib/xmtp/lease', () => ({
  acquireXmtpLease: mocks.acquireXmtpLease,
}))

vi.mock('../../lib/xmtp/signer', () => ({
  connectHostWallet: mocks.connectHostWallet,
}))

vi.mock('../../lib/xmtp/storage', () => ({
  prepareXmtpStorage: mocks.prepareStorage,
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
const cachedConversation: ConversationSummary = {
  id: 'conversation-1',
  isOwnLastMessage: false,
  peerAddress: '0x2222222222222222222222222222222222222222',
  peerInboxId: 'peer-inbox-1',
  preview: 'Saved locally',
  updatedAt: new Date('2026-07-14T12:00:00Z'),
}
const activeConversation: ActiveConversation = {
  id: cachedConversation.id,
  peerAddress: cachedConversation.peerAddress,
  peerInboxId: cachedConversation.peerInboxId,
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

function message(id: string, text: string, sentAt: string): MessageItem {
  const date = new Date(sentAt)
  return {
    canRetry: false,
    conversationId: activeConversation.id,
    delivery: 'sent',
    id,
    isOwn: false,
    sentAt: date,
    sentAtNs: BigInt(date.getTime()) * 1_000_000n,
    text,
    unsupported: false,
  }
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    address,
    close: vi.fn().mockResolvedValue(undefined),
    createDm: vi.fn(),
    environment: 'dev',
    isNewInstallation: false,
    loadConversation: vi.fn(),
    loadInbox: vi.fn().mockResolvedValue([cachedConversation]),
    loadOlderMessages: vi.fn(),
    readInbox: vi.fn().mockResolvedValue([cachedConversation]),
    requestHistorySync: vi.fn().mockResolvedValue(false),
    startMessageStream: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useXmtpMessaging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    provider.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_accounts') return Promise.resolve([address])
      if (method === 'eth_chainId') return Promise.resolve('0xa')
      return Promise.resolve(null)
    })
    mocks.acquireXmtpLease.mockResolvedValue({
      release: vi.fn().mockResolvedValue(undefined),
    })
    mocks.prepareStorage.mockResolvedValue('persistent')
    mocks.connectHostWallet.mockResolvedValue({
      address,
      chainId: 10n,
      kind: 'EOA',
      provider,
      signer: {},
    })
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

  it('lets a newly opened conversation page while an older view is still loading', async () => {
    const secondSummary: ConversationSummary = {
      ...cachedConversation,
      id: 'conversation-2',
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

  it.each(['focus', 'pageshow'])('refreshes visible state on window %s', async (eventName) => {
    const session = createSession()
    mocks.createSession.mockResolvedValue(session)
    const { result } = renderHook(() => useXmtpMessaging())
    await act(async () => result.current.connect())

    act(() => window.dispatchEvent(new Event(eventName)))

    await waitFor(() => expect(session.loadInbox).toHaveBeenCalledTimes(2))
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_accounts' })
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_chainId' })
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

    act(() => window.dispatchEvent(new Event('focus')))

    await waitFor(() => expect(result.current.connection.phase).toBe('error'))
    expect(result.current.connection.error).toMatch(/account changed while the app was away/)
    await waitFor(() => expect(session.close).toHaveBeenCalledOnce())
  })
})
