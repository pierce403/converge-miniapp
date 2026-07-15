import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DeliveryStatus,
  Dm,
  GroupMessageKind,
  IdentifierKind,
  SortDirection,
  type DecodedMessage,
  type Signer,
} from '@xmtp/browser-sdk'

const sdkMocks = vi.hoisted(() => ({
  create: vi.fn(),
}))

vi.mock('@xmtp/browser-sdk', () => {
  class MockDm {}

  return {
    Client: { create: sdkMocks.create },
    ConsentState: { Allowed: 1 },
    DeliveryStatus: { Failed: 2, Published: 1, Unpublished: 0 },
    Dm: MockDm,
    GroupMessageKind: { Application: 1 },
    IdentifierKind: { Ethereum: 0 },
    ListConversationsOrderBy: { LastActivity: 1 },
    LogLevel: { Off: 0 },
    SortDirection: { Ascending: 0, Descending: 1 },
  }
})

import {
  XmtpClientInitializationError,
  XmtpMessagingSession,
} from './session'

const address = '0x52908400098527886E0F7030069857D2E4169EE7'
const signer = {
  type: 'EOA',
  getIdentifier: () => ({
    identifier: address.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  }),
  signMessage: vi.fn(),
} satisfies Signer

function message(options: {
  id: string
  sentAt: string
  status: DeliveryStatus
}): DecodedMessage {
  const sentAt = new Date(options.sentAt)
  return {
    content: options.id,
    conversationId: 'conversation-1',
    deliveryStatus: options.status,
    fallback: undefined,
    id: options.id,
    senderInboxId: 'own-inbox',
    sentAt,
    sentAtNs: BigInt(sentAt.getTime()) * 1_000_000n,
  } as unknown as DecodedMessage
}

function dm(methods: Record<string, unknown> = {}) {
  return Object.assign(Object.create(Dm.prototype) as Dm, {
    id: 'conversation-1',
    messages: vi.fn(),
    peerInboxId: vi.fn().mockResolvedValue('peer-inbox'),
    publishMessages: vi.fn(),
    sendText: vi.fn(),
    sync: vi.fn(),
    ...methods,
  })
}

function client(conversation: Dm) {
  return {
    close: vi.fn(),
    conversations: {
      getConversationById: vi.fn().mockResolvedValue(conversation),
      getMessageById: vi.fn(),
      listDms: vi.fn().mockResolvedValue([]),
      streamAllDmMessages: vi.fn(),
      syncAll: vi.fn(),
    },
    env: 'dev',
    fetchInboxIdByIdentifier: vi.fn(),
    inboxId: 'own-inbox',
    preferences: {
      getInboxStates: vi.fn().mockResolvedValue([{
        accountIdentifiers: [{
          identifier: '0xde709f2102306220921060314715629080e2fb77',
          identifierKind: IdentifierKind.Ethereum,
        }],
        inboxId: 'peer-inbox',
      }]),
    },
    isRegistered: vi.fn().mockResolvedValue(false),
    register: vi.fn(),
    sendSyncRequest: vi.fn(),
  }
}

describe('XmtpMessagingSession behavior', () => {
  beforeEach(() => {
    sdkMocks.create.mockReset()
  })

  it('owns registration cleanup after client initialization', async () => {
    const fakeClient = client(dm())
    fakeClient.register.mockRejectedValue(new Error('wallet rejected'))
    sdkMocks.create.mockResolvedValue(fakeClient)

    await expect(XmtpMessagingSession.create(signer, address)).rejects.toThrow(
      'wallet rejected',
    )
    expect(sdkMocks.create).toHaveBeenCalledWith(
      signer,
      expect.objectContaining({ disableAutoRegister: true, env: 'dev' }),
    )
    expect(fakeClient.close).toHaveBeenCalledOnce()
  })

  it('bounds a stalled client initialization and closes a late client', async () => {
    vi.useFakeTimers()
    const fakeClient = client(dm())
    let resolveClient!: (value: typeof fakeClient) => void
    sdkMocks.create.mockReturnValue(new Promise((resolve) => {
      resolveClient = resolve
    }))

    try {
      const creating = XmtpMessagingSession.create(signer, address)
      const rejection = expect(creating).rejects.toBeInstanceOf(
        XmtpClientInitializationError,
      )
      await vi.advanceTimersByTimeAsync(30_000)
      await rejection

      resolveClient(fakeClient)
      await vi.waitFor(() => expect(fakeClient.close).toHaveBeenCalledOnce())
      expect(fakeClient.register).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads the newest page chronologically and recovers persisted drafts', async () => {
    const newer = message({
      id: 'newer',
      sentAt: '2026-07-14T12:01:00Z',
      status: DeliveryStatus.Unpublished,
    })
    const older = message({
      id: 'older',
      sentAt: '2026-07-14T12:00:00Z',
      status: DeliveryStatus.Published,
    })
    const conversation = dm({
      messages: vi.fn().mockResolvedValue([newer, older]),
    })
    const fakeClient = client(conversation)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onCached = vi.fn()
    const loaded = await session.loadConversation('conversation-1', onCached)

    expect(conversation.messages).toHaveBeenCalledWith(expect.objectContaining({
      direction: SortDirection.Descending,
      kind: GroupMessageKind.Application,
      limit: 51n,
    }))
    expect(onCached).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ id: 'older' }), expect.objectContaining({ id: 'newer' })],
    }))
    expect(conversation.messages).toHaveBeenCalledTimes(2)
    expect(conversation.messages.mock.invocationCallOrder[0]).toBeLessThan(
      conversation.sync.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(loaded.messages.map((item) => item.id)).toEqual(['older', 'newer'])
    expect(loaded.messages[1]).toMatchObject({
      canRetry: true,
      delivery: 'failed',
    })
  })

  it('requests best-effort history only for a new installation', async () => {
    const newClient = client(dm())
    sdkMocks.create.mockResolvedValueOnce(newClient)

    const newSession = await XmtpMessagingSession.create(signer, address)
    await expect(newSession.requestHistorySync()).resolves.toBe(true)
    expect(newClient.sendSyncRequest).toHaveBeenCalledOnce()

    const resumedClient = client(dm())
    resumedClient.isRegistered.mockResolvedValue(true)
    sdkMocks.create.mockResolvedValueOnce(resumedClient)

    const resumedSession = await XmtpMessagingSession.create(signer, address)
    await expect(resumedSession.requestHistorySync()).resolves.toBe(false)
    expect(resumedClient.sendSyncRequest).not.toHaveBeenCalled()
  })

  it('classifies ENS addresses without mutating either XMTP inbox', async () => {
    const fakeClient = client(dm())
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)

    await expect(session.inspectIdentityRelationship(address)).resolves.toBe(
      'active-address',
    )
    expect(fakeClient.fetchInboxIdByIdentifier).not.toHaveBeenCalled()

    fakeClient.fetchInboxIdByIdentifier
      .mockResolvedValueOnce('own-inbox')
      .mockResolvedValueOnce('another-inbox')
      .mockResolvedValueOnce(undefined)
    const candidate = '0x1111111111111111111111111111111111111111'

    await expect(session.inspectIdentityRelationship(candidate)).resolves.toBe('same-inbox')
    await expect(session.inspectIdentityRelationship(candidate)).resolves.toBe('different-inbox')
    await expect(session.inspectIdentityRelationship(candidate)).resolves.toBe('no-inbox')
  })

  it('reads the cached inbox before synchronizing and rereads afterward', async () => {
    const fakeClient = client(dm())
    fakeClient.conversations.listDms
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onCached = vi.fn()
    await session.loadInbox(onCached)

    expect(onCached).toHaveBeenCalledWith([])
    expect(fakeClient.conversations.listDms).toHaveBeenCalledTimes(2)
    expect(fakeClient.conversations.listDms.mock.invocationCallOrder[0]).toBeLessThan(
      fakeClient.conversations.syncAll.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(fakeClient.conversations.syncAll.mock.invocationCallOrder[0]).toBeLessThan(
      fakeClient.conversations.listDms.mock.invocationCallOrder[1] ?? 0,
    )
  })

  it('pages older messages by expanding a contiguous newest-message window', async () => {
    const older = message({
      id: 'older',
      sentAt: '2026-07-14T11:59:00Z',
      status: DeliveryStatus.Published,
    })
    const conversation = dm({ messages: vi.fn().mockResolvedValue([older]) })
    const fakeClient = client(conversation)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const page = await session.loadOlderMessages('conversation-1', 50)

    expect(conversation.messages).toHaveBeenCalledWith(expect.objectContaining({
      direction: SortDirection.Descending,
      limit: 101n,
    }))
    expect(conversation.messages).not.toHaveBeenCalledWith(expect.objectContaining({
      sentBeforeNs: expect.anything(),
    }))
    expect(page).toMatchObject({ hasOlder: false })
    expect(page.messages.map((item) => item.id)).toEqual(['older'])
  })

  it('marks a full page when another older page exists', async () => {
    const messages = Array.from({ length: 101 }, (_, index) => message({
      id: `message-${index}`,
      sentAt: new Date(Date.UTC(2026, 6, 14, 12, 2, 101 - index)).toISOString(),
      status: DeliveryStatus.Published,
    }))
    const conversation = dm({ messages: vi.fn().mockResolvedValue(messages) })
    const fakeClient = client(conversation)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const page = await session.loadOlderMessages('conversation-1', 50)

    expect(page.hasOlder).toBe(true)
    expect(page.messages).toHaveLength(100)
    expect(page.messages[0]?.id).toBe('message-99')
    expect(page.messages.at(-1)?.id).toBe('message-0')
  })

  it('retains one stream proxy while the SDK retries an underlying failure', async () => {
    const conversation = dm()
    const fakeClient = client(conversation)
    const stream = { end: vi.fn(), isDone: false }
    let callbacks: Record<string, (...args: never[]) => void> | undefined
    fakeClient.conversations.streamAllDmMessages.mockImplementation(async (options) => {
      callbacks = options
      return stream
    })
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onHealth = vi.fn()
    await session.startMessageStream(vi.fn(), onHealth)
    expect(onHealth).toHaveBeenLastCalledWith('live')

    callbacks?.onRetry?.()
    expect(onHealth).toHaveBeenLastCalledWith('retrying')
    callbacks?.onFail?.()
    expect(onHealth).toHaveBeenLastCalledWith('retrying')

    await session.startMessageStream(vi.fn(), onHealth)
    expect(fakeClient.conversations.streamAllDmMessages).toHaveBeenCalledOnce()
    callbacks?.onRestart?.()
    expect(onHealth).toHaveBeenLastCalledWith('live')
  })

  it('closes the client without waiting for a stalled stream start', async () => {
    const conversation = dm()
    const fakeClient = client(conversation)
    const stream = { end: vi.fn().mockResolvedValue(undefined), isDone: false }
    let resolveStream!: (value: typeof stream) => void
    fakeClient.conversations.streamAllDmMessages.mockReturnValue(new Promise((resolve) => {
      resolveStream = resolve
    }))
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const starting = session.startMessageStream(vi.fn(), vi.fn())

    await expect(session.close()).resolves.toBeUndefined()
    expect(fakeClient.close).toHaveBeenCalledOnce()

    resolveStream(stream)
    await starting
    expect(stream.end).toHaveBeenCalledOnce()
  })

  it.each([
    ['rejects', () => Promise.reject(new Error('end failed'))],
    ['never settles', () => new Promise<never>(() => undefined)],
  ])('terminates the client when stream cleanup %s', async (_label, endResult) => {
    const conversation = dm()
    const fakeClient = client(conversation)
    const stream = { end: vi.fn(endResult), isDone: false }
    fakeClient.conversations.streamAllDmMessages.mockResolvedValue(stream)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    await session.startMessageStream(vi.fn(), vi.fn())

    await expect(session.close()).resolves.toBeUndefined()
    expect(stream.end).toHaveBeenCalledOnce()
    expect(fakeClient.close).toHaveBeenCalledOnce()
  })

  it('treats a true XMTP failure as terminal instead of fake-retrying it', async () => {
    const failed = message({
      id: 'failed',
      sentAt: '2026-07-14T12:00:00Z',
      status: DeliveryStatus.Failed,
    })
    const conversation = dm()
    const fakeClient = client(conversation)
    fakeClient.conversations.getMessageById.mockResolvedValue(failed)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const result = await session.retryMessage('conversation-1', 'failed')

    expect(result.message).toMatchObject({ canRetry: false, delivery: 'failed' })
    expect(result.error).toMatch(/permanently failed/)
    expect(conversation.publishMessages).not.toHaveBeenCalled()
  })

  it('honors a published target even when batch publication reports an error', async () => {
    const optimistic = message({
      id: 'message-1',
      sentAt: '2026-07-14T12:00:00Z',
      status: DeliveryStatus.Unpublished,
    })
    const published = { ...optimistic, deliveryStatus: DeliveryStatus.Published }
    const conversation = dm({
      publishMessages: vi.fn().mockRejectedValue(new Error('another draft failed')),
      sendText: vi.fn().mockResolvedValue('message-1'),
    })
    const fakeClient = client(conversation)
    fakeClient.conversations.getMessageById
      .mockResolvedValueOnce(optimistic)
      .mockResolvedValueOnce(published)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onOptimistic = vi.fn()
    const result = await session.sendText('conversation-1', 'hello', onOptimistic)

    expect(onOptimistic).toHaveBeenCalledWith(expect.objectContaining({
      delivery: 'sending',
      id: 'message-1',
    }))
    expect(result).toMatchObject({
      error: null,
      message: { delivery: 'sent', id: 'message-1' },
    })
  })
})
