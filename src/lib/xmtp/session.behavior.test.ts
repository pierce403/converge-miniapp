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

import { XmtpMessagingSession } from './session'

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
  return {
    content: options.id,
    conversationId: 'conversation-1',
    deliveryStatus: options.status,
    fallback: undefined,
    id: options.id,
    senderInboxId: 'own-inbox',
    sentAt: new Date(options.sentAt),
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
    },
    env: 'dev',
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
    register: vi.fn(),
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
    const loaded = await session.loadConversation('conversation-1')

    expect(conversation.messages).toHaveBeenCalledWith(expect.objectContaining({
      direction: SortDirection.Descending,
      kind: GroupMessageKind.Application,
      limit: 50n,
    }))
    expect(loaded.messages.map((item) => item.id)).toEqual(['older', 'newer'])
    expect(loaded.messages[1]).toMatchObject({
      canRetry: true,
      delivery: 'failed',
    })
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
