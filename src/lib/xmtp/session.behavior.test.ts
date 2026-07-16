import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConsentState,
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
    ContentType: { Reaction: 9, ReadReceipt: 10 },
    DeliveryStatus: { Failed: 2, Published: 1, Unpublished: 0 },
    Dm: MockDm,
    GroupMessageKind: { Application: 1 },
    IdentifierKind: { Ethereum: 0 },
    ListConversationsOrderBy: { LastActivity: 1 },
    LogLevel: { Off: 0 },
    ReactionAction: { Added: 1, Removed: 2 },
    SortDirection: { Ascending: 0, Descending: 1 },
    isActions: (message: DecodedMessage) => message.contentType?.typeId === 'actions',
    isAttachment: (message: DecodedMessage) => message.contentType?.typeId === 'attachment',
    isGroupUpdated: (message: DecodedMessage) => message.contentType?.typeId === 'group_updated',
    isIntent: (message: DecodedMessage) => message.contentType?.typeId === 'intent',
    isLeaveRequest: (message: DecodedMessage) => message.contentType?.typeId === 'leave_request',
    isMarkdown: (message: DecodedMessage) => message.contentType?.typeId === 'markdown',
    isMultiRemoteAttachment: (message: DecodedMessage) =>
      message.contentType?.typeId === 'multiRemoteStaticAttachment',
    isReaction: (message: DecodedMessage) => message.contentType?.typeId === 'reaction',
    isReadReceipt: (message: DecodedMessage) => message.contentType?.typeId === 'readReceipt',
    isRemoteAttachment: (message: DecodedMessage) =>
      message.contentType?.typeId === 'remoteStaticAttachment',
    isReply: (message: DecodedMessage) => message.contentType?.typeId === 'reply',
    isText: (message: DecodedMessage) => message.contentType?.typeId === 'text',
    isTextReply: (message: DecodedMessage) =>
      message.contentType?.typeId === 'reply' &&
      typeof (message.content as { content?: unknown } | undefined)?.content === 'string',
    isTransactionReference: (message: DecodedMessage) =>
      message.contentType?.typeId === 'transactionReference',
    isWalletSendCalls: (message: DecodedMessage) =>
      message.contentType?.typeId === 'walletSendCalls',
  }
})

import {
  XmtpClientInitializationError,
  XmtpGatewayConfigurationError,
  XmtpMessagingSession,
  xmtpClientOptions,
} from './session'
import { convosJoinRequestCodec } from '../convos/joinRequestCodec'
import type { ParsedConvosInvite } from '../convos/invite'

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
    contentType: {
      authorityId: 'xmtp.org',
      typeId: 'text',
      versionMajor: 1,
      versionMinor: 0,
    },
    conversationId: 'conversation-1',
    deliveryStatus: options.status,
    fallback: undefined,
    id: options.id,
    reactions: [],
    senderInboxId: 'own-inbox',
    sentAt,
    sentAtNs: BigInt(sentAt.getTime()) * 1_000_000n,
  } as unknown as DecodedMessage
}

function typedMessage(options: {
  authorityId?: string
  content: unknown
  conversationId?: string
  fallback?: string
  id: string
  reactions?: DecodedMessage[]
  status?: DeliveryStatus
  typeId: string
  versionMajor?: number
  versionMinor?: number
}): DecodedMessage {
  const sentAt = new Date('2026-07-14T12:00:00Z')
  return {
    content: options.content,
    contentType: {
      authorityId: options.authorityId ?? 'xmtp.org',
      typeId: options.typeId,
      versionMajor: options.versionMajor ?? 1,
      versionMinor: options.versionMinor ?? 0,
    },
    conversationId: options.conversationId ?? 'conversation-1',
    deliveryStatus: options.status ?? DeliveryStatus.Published,
    fallback: options.fallback,
    id: options.id,
    reactions: options.reactions ?? [],
    senderInboxId: 'peer-inbox',
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
    send: vi.fn(),
    sendText: vi.fn(),
    sync: vi.fn(),
    updateConsentState: vi.fn(),
    ...methods,
  })
}

function client(conversation: Dm) {
  return {
    canMessage: vi.fn(),
    close: vi.fn(),
    conversations: {
      createDm: vi.fn().mockResolvedValue(conversation),
      createDmWithIdentifier: vi.fn().mockResolvedValue(conversation),
      fetchDmByIdentifier: vi.fn().mockResolvedValue(null),
      getConversationById: vi.fn().mockResolvedValue(conversation),
      getDmByInboxId: vi.fn().mockResolvedValue(undefined),
      getMessageById: vi.fn(),
      listDms: vi.fn().mockResolvedValue([]),
      streamAllDmMessages: vi.fn(),
      sync: vi.fn(),
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

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(['local', 'dev', 'production'] as const)(
    'allows the legacy %s environment without a payer Gateway',
    (environment) => {
      expect(xmtpClientOptions(environment)).toEqual(expect.objectContaining({
        env: environment,
      }))
      expect(xmtpClientOptions(environment)).not.toHaveProperty('gatewayHost')
    },
  )

  it.each([
    'testnet-staging',
    'testnet-dev',
    'testnet',
    'mainnet',
  ] as const)(
    'requires a payer Gateway for the decentralized %s environment',
    (environment) => {
      expect(() => xmtpClientOptions(environment)).toThrow(
        XmtpGatewayConfigurationError,
      )
    },
  )

  it('passes a normalized Gateway hostname to a decentralized environment', () => {
    expect(xmtpClientOptions('mainnet', ' gateway.example.com ')).toEqual(
      expect.objectContaining({
        env: 'mainnet',
        gatewayHost: 'gateway.example.com',
      }),
    )
  })

  it('reaches SDK client creation on legacy production without a Gateway', async () => {
    vi.stubEnv('VITE_XMTP_ENV', 'production')
    vi.stubEnv('VITE_XMTP_GATEWAY_HOST', '')
    const fakeClient = client(dm())
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)

    expect(sdkMocks.create).toHaveBeenCalledWith(
      signer,
      expect.objectContaining({
        codecs: [convosJoinRequestCodec],
        disableAutoRegister: true,
        env: 'production',
      }),
    )
    expect(sdkMocks.create.mock.calls[0]?.[1]).not.toHaveProperty('gatewayHost')
    expect(fakeClient.register).toHaveBeenCalledOnce()
    await session.close()
  })

  it('sends one typed Convos request to the exact creator inbox with push intent', async () => {
    const requestMessage = typedMessage({
      authorityId: 'convos.org',
      content: { inviteSlug: 'bearer-secret-slug' },
      conversationId: 'creator-transport-dm',
      fallback: 'bearer-secret-slug',
      id: 'join-request-message',
      typeId: 'join_request',
    })
    const conversation = dm({
      id: 'creator-transport-dm',
      send: vi.fn().mockResolvedValue('join-request-message'),
    })
    const fakeClient = client(conversation)
    fakeClient.conversations.getMessageById.mockResolvedValue(requestMessage)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const result = await session.requestConvosAccess(convosInvite())

    expect(fakeClient.conversations.sync).toHaveBeenCalledOnce()
    expect(fakeClient.conversations.getDmByInboxId).toHaveBeenCalledWith(
      'creator-inbox',
    )
    expect(fakeClient.conversations.createDm).toHaveBeenCalledWith('creator-inbox')
    expect(fakeClient.conversations.sync.mock.invocationCallOrder[0]).toBeLessThan(
      fakeClient.conversations.getDmByInboxId.mock.invocationCallOrder[0] ?? Infinity,
    )
    expect(conversation.send).toHaveBeenCalledWith(
      expect.objectContaining({
        fallback: 'bearer-secret-slug',
        type: expect.objectContaining({
          authorityId: 'convos.org',
          typeId: 'join_request',
          versionMajor: 1,
          versionMinor: 0,
        }),
      }),
      { shouldPush: true },
    )
    expect(conversation.publishMessages).not.toHaveBeenCalled()
    expect(fakeClient.conversations.getMessageById).not.toHaveBeenCalled()
    expect(conversation.updateConsentState).not.toHaveBeenCalled()
    expect(result).toEqual({
      conversationId: 'creator-transport-dm',
      messageId: 'join-request-message',
    })
  })

  it('reuses an existing creator DM without creating a duplicate transport', async () => {
    const requestMessage = typedMessage({
      authorityId: 'convos.org',
      content: { inviteSlug: 'bearer-secret-slug' },
      conversationId: 'existing-transport-dm',
      fallback: 'bearer-secret-slug',
      id: 'join-request-message',
      typeId: 'join_request',
    })
    const existing = dm({
      id: 'existing-transport-dm',
      send: vi.fn().mockResolvedValue('join-request-message'),
    })
    const fakeClient = client(existing)
    fakeClient.conversations.getDmByInboxId.mockResolvedValue(existing)
    fakeClient.conversations.getMessageById.mockResolvedValue(requestMessage)
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)

    await session.requestConvosAccess(convosInvite())

    expect(fakeClient.conversations.getDmByInboxId).toHaveBeenCalledWith(
      'creator-inbox',
    )
    expect(fakeClient.conversations.createDm).not.toHaveBeenCalled()
    expect(existing.send).toHaveBeenCalledOnce()
  })

  it('rejects a self-invite before syncing or creating a transport DM', async () => {
    const existing = dm({ id: 'existing-transport-dm' })
    const fakeClient = client(existing)
    fakeClient.conversations.getDmByInboxId.mockResolvedValue(existing)
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)

    await expect(session.requestConvosAccess({
      ...convosInvite(),
      creatorInboxId: 'OWN-INBOX',
    })).rejects.toThrow(/points back to the inbox/i)

    expect(fakeClient.conversations.sync).not.toHaveBeenCalled()
    expect(fakeClient.conversations.createDm).not.toHaveBeenCalled()
    expect(existing.send).not.toHaveBeenCalled()
  })

  it('does not create an optimistic draft when the Convos request send rejects', async () => {
    const conversation = dm({
      send: vi.fn().mockRejectedValue(
        new Error('network failure for bearer-secret-slug and private-inbox'),
      ),
    })
    const fakeClient = client(conversation)
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)

    await expect(session.requestConvosAccess(convosInvite())).rejects.toThrow(
      /network failure/,
    )

    expect(conversation.send).toHaveBeenCalledWith(
      expect.anything(),
      { shouldPush: true },
    )
    expect(conversation.publishMessages).not.toHaveBeenCalled()
    expect(fakeClient.conversations.getMessageById).not.toHaveBeenCalled()
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

  it('reads a saved conversation without starting a network sync', async () => {
    const saved = message({
      id: 'saved-offline',
      sentAt: '2026-07-14T12:00:00Z',
      status: DeliveryStatus.Published,
    })
    const conversation = dm({
      messages: vi.fn().mockResolvedValue([saved]),
    })
    const fakeClient = client(conversation)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const loaded = await session.readConversation('conversation-1')

    expect(loaded.messages).toEqual([
      expect.objectContaining({ id: 'saved-offline', text: 'saved-offline' }),
    ])
    expect(conversation.sync).not.toHaveBeenCalled()
    expect(fakeClient.conversations.syncAll).not.toHaveBeenCalled()
  })

  it('uses the stable recovery Ethereum identity as the peer display address', async () => {
    const conversation = dm({ messages: vi.fn().mockResolvedValue([]) })
    const fakeClient = client(conversation)
    fakeClient.preferences.getInboxStates.mockResolvedValue([{
      accountIdentifiers: [
        {
          identifier: '0x1111111111111111111111111111111111111111',
          identifierKind: IdentifierKind.Ethereum,
        },
        {
          identifier: '0x2222222222222222222222222222222222222222',
          identifierKind: IdentifierKind.Ethereum,
        },
      ],
      inboxId: 'peer-inbox',
      recoveryIdentifier: {
        identifier: '0x1111111111111111111111111111111111111111',
        identifierKind: IdentifierKind.Ethereum,
      },
    }])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const loaded = await session.loadConversation('conversation-1')

    expect(loaded.conversation.peerAddress).toBe(
      '0x1111111111111111111111111111111111111111',
    )
  })

  it('drops silent control payloads instead of rendering unsupported bubbles', async () => {
    const silentCustom = typedMessage({
      content: 'typing',
      id: 'typing-style-control',
      typeId: 'typingIndicator',
    })
    const readReceipt = typedMessage({
      content: {},
      id: 'receipt',
      typeId: 'readReceipt',
    })
    const visibleFallback = typedMessage({
      content: undefined,
      fallback: 'Open this message in a compatible client.',
      id: 'fallback',
      typeId: 'futureContent',
    })
    const conversation = dm({
      messages: vi.fn().mockResolvedValue([
        silentCustom,
        readReceipt,
        visibleFallback,
      ]),
    })
    const fakeClient = client(conversation)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const loaded = await session.loadConversation('conversation-1')

    expect(loaded.messages).toEqual([
      expect.objectContaining({
        id: 'fallback',
        text: 'Open this message in a compatible client.',
        unsupported: true,
      }),
    ])
  })

  it('suppresses exact Convos controls before fallback while preserving near misses', async () => {
    const controls = [
      'join_request',
      'invite_join_error',
      'invite_join_handled',
    ].map((typeId) => typedMessage({
      authorityId: 'convos.org',
      content: { inviteSlug: 'bearer-secret-slug' },
      fallback: `secret fallback for ${typeId}`,
      id: typeId,
      typeId,
    }))
    const nearMiss = typedMessage({
      authorityId: 'convos.org',
      content: undefined,
      fallback: 'Visible future-version fallback',
      id: 'future-join-request',
      typeId: 'join_request',
      versionMinor: 1,
    })
    const conversation = dm({
      messages: vi.fn().mockResolvedValue([...controls, nearMiss]),
    })
    const fakeClient = client(conversation)
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)

    const loaded = await session.loadConversation('conversation-1')

    expect(loaded.messages).toEqual([
      expect.objectContaining({
        id: 'future-join-request',
        text: 'Visible future-version fallback',
      }),
    ])
    expect(loaded.messages.map(({ text }) => text).join(' ')).not.toContain(
      'bearer-secret-slug',
    )
    expect(loaded.messages.map(({ text }) => text).join(' ')).not.toContain(
      'secret fallback',
    )
  })

  it('does not emit exact Convos control fallbacks from the live DM stream', async () => {
    const conversation = dm()
    const fakeClient = client(conversation)
    let onValue: ((message: DecodedMessage) => void) | undefined
    fakeClient.conversations.streamAllDmMessages.mockImplementation(async (options) => {
      onValue = options.onValue
      return { end: vi.fn(), isDone: false }
    })
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)
    const onMessage = vi.fn()
    await session.startMessageStream(onMessage, vi.fn())

    onValue?.(typedMessage({
      authorityId: 'convos.org',
      content: { inviteSlug: 'bearer-secret-slug' },
      fallback: 'bearer-secret-slug',
      id: 'join-request',
      typeId: 'join_request',
    }))
    onValue?.(typedMessage({
      authorityId: 'convos.org',
      content: undefined,
      fallback: 'Compatible-client fallback',
      id: 'near-miss',
      typeId: 'join_request',
      versionMajor: 2,
    }))

    expect(onMessage).toHaveBeenCalledOnce()
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'near-miss',
      text: 'Compatible-client fallback',
    }))
  })

  it('projects text replies, attachment metadata, and parent reactions', async () => {
    const reaction = typedMessage({
      content: {
        action: 1,
        content: '😁',
        reference: 'parent',
        referenceInboxId: 'peer-inbox',
        schema: 1,
      },
      id: 'reaction',
      typeId: 'reaction',
    })
    const parent = typedMessage({
      content: 'Original message',
      id: 'parent',
      reactions: [reaction],
      typeId: 'text',
    })
    const reply = typedMessage({
      content: {
        content: 'A reply',
        inReplyTo: parent,
        referenceId: 'parent',
      },
      id: 'reply',
      typeId: 'reply',
    })
    const attachment = typedMessage({
      content: {
        content: new Uint8Array(),
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
      },
      id: 'attachment',
      typeId: 'attachment',
    })
    const conversation = dm({
      messages: vi.fn().mockResolvedValue([attachment, reply, parent]),
    })
    const fakeClient = client(conversation)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const loaded = await session.loadConversation('conversation-1')

    expect(loaded.messages).toEqual([
      expect.objectContaining({
        id: 'parent',
        reactions: [{ content: '😁', count: 1 }],
      }),
      expect.objectContaining({
        id: 'reply',
        replyTo: 'Original message',
        text: 'A reply',
      }),
      expect.objectContaining({
        id: 'attachment',
        text: 'Attachment: photo.jpg',
        unsupported: false,
      }),
    ])
  })

  it('caps distinct reaction summaries on an enriched parent', async () => {
    const reactions = Array.from({ length: 30 }, (_, index) => typedMessage({
      content: {
        action: 1,
        content: `:${index}:`,
        reference: 'parent',
        referenceInboxId: `peer-${index}`,
        schema: 2,
      },
      id: `reaction-${index}`,
      typeId: 'reaction',
    }))
    reactions.forEach((reaction, index) => {
      reaction.senderInboxId = `peer-${index}`
    })
    const parent = typedMessage({
      content: 'Original message',
      id: 'parent',
      reactions,
      typeId: 'text',
    })
    const fakeClient = client(dm({
      messages: vi.fn().mockResolvedValue([parent]),
    }))
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const loaded = await session.loadConversation('conversation-1')

    expect(loaded.messages[0]?.reactions).toHaveLength(24)
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

  it('closes before registration when an explicit inbox target changed', async () => {
    const fakeClient = client(dm())
    sdkMocks.create.mockResolvedValue(fakeClient)

    await expect(XmtpMessagingSession.create(
      signer,
      address,
      'expected-inbox',
    )).rejects.toMatchObject({ name: 'XmtpInboxTargetMismatchError' })

    expect(fakeClient.register).not.toHaveBeenCalled()
    expect(fakeClient.close).toHaveBeenCalledOnce()
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

  it('returns the exact existing inbox ID for a session-switch preflight', async () => {
    const fakeClient = client(dm())
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)
    const candidate = '0x1111111111111111111111111111111111111111'
    fakeClient.fetchInboxIdByIdentifier.mockResolvedValueOnce('target-inbox')

    await expect(session.findInboxId(candidate)).resolves.toBe('target-inbox')
    await expect(session.findInboxId(address)).resolves.toBe('own-inbox')
    expect(fakeClient.fetchInboxIdByIdentifier).toHaveBeenCalledOnce()
  })

  it('checks recipient reachability without creating a DM and rechecks on creation', async () => {
    const conversation = dm()
    const fakeClient = client(conversation)
    const candidate = '0x1111111111111111111111111111111111111111'
    fakeClient.canMessage.mockResolvedValue(new Map([
      [candidate.toLowerCase(), true],
    ]))
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)

    await expect(session.canMessageAddress(candidate)).resolves.toBe(true)
    expect(fakeClient.conversations.fetchDmByIdentifier).not.toHaveBeenCalled()

    await expect(session.createDm(candidate)).resolves.toEqual({
      id: 'conversation-1',
      peerAddress: candidate,
      peerInboxId: 'peer-inbox',
    })
    expect(fakeClient.canMessage).toHaveBeenCalledTimes(2)
    expect(fakeClient.conversations.createDmWithIdentifier).toHaveBeenCalledOnce()
    expect(conversation.updateConsentState).toHaveBeenCalledWith(ConsentState.Allowed)
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

  it('reads one preview candidate per row and sorts by displayable activity', async () => {
    const silentControl = typedMessage({
      content: undefined,
      id: 'silent-control',
      typeId: 'typingIndicator',
    })
    const silentSentAt = new Date('2026-07-14T13:00:00Z')
    silentControl.sentAt = silentSentAt
    silentControl.sentAtNs = BigInt(silentSentAt.getTime()) * 1_000_000n

    const olderVisible = message({
      id: 'older-visible',
      sentAt: '2026-07-14T10:00:00Z',
      status: DeliveryStatus.Published,
    })
    const newerVisible = message({
      id: 'newer-visible',
      sentAt: '2026-07-14T12:00:00Z',
      status: DeliveryStatus.Published,
    })
    const noisyMessages = vi.fn()
      .mockResolvedValueOnce([silentControl])
      .mockResolvedValueOnce([silentControl, olderVisible])
    const recentMessages = vi.fn().mockResolvedValue([newerVisible])
    const noisy = dm({
      id: 'noisy-conversation',
      messages: noisyMessages,
      peerInboxId: vi.fn().mockResolvedValue('noisy-peer'),
    })
    const recent = dm({
      id: 'recent-conversation',
      messages: recentMessages,
      peerInboxId: vi.fn().mockResolvedValue('recent-peer'),
    })
    const fakeClient = client(noisy)
    fakeClient.conversations.listDms.mockResolvedValue([noisy, recent])
    fakeClient.preferences.getInboxStates.mockResolvedValue([
      {
        accountIdentifiers: [{
          identifier: '0x1111111111111111111111111111111111111111',
          identifierKind: IdentifierKind.Ethereum,
        }],
        inboxId: 'noisy-peer',
      },
      {
        accountIdentifiers: [{
          identifier: '0x2222222222222222222222222222222222222222',
          identifierKind: IdentifierKind.Ethereum,
        }],
        inboxId: 'recent-peer',
      },
    ])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const summaries = await session.readInbox()

    expect(summaries.map(({ id }) => id)).toEqual([
      'recent-conversation',
      'noisy-conversation',
    ])
    expect(noisyMessages).toHaveBeenNthCalledWith(1, expect.objectContaining({
      limit: 1n,
    }))
    expect(noisyMessages).toHaveBeenNthCalledWith(2, expect.objectContaining({
      limit: 200n,
    }))
    expect(recentMessages).toHaveBeenCalledOnce()
    expect(recentMessages).toHaveBeenCalledWith(expect.objectContaining({ limit: 1n }))
  })

  it('hides a transport DM only when a complete local scan contains Convos controls', async () => {
    const control = typedMessage({
      authorityId: 'convos.org',
      content: { inviteSlug: 'bearer-secret-slug' },
      fallback: 'bearer-secret-slug',
      id: 'join-request',
      typeId: 'join_request',
    })
    const messages = vi.fn()
      .mockResolvedValueOnce([control])
      .mockResolvedValueOnce([control])
    const conversation = dm({ messages })
    const fakeClient = client(conversation)
    fakeClient.conversations.listDms.mockResolvedValue([conversation])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)

    await expect(session.readInbox()).resolves.toEqual([])
    expect(messages).toHaveBeenNthCalledWith(2, expect.objectContaining({
      limit: 200n,
    }))
  })

  it('keeps an older real DM visible behind newer Convos control traffic', async () => {
    const control = typedMessage({
      authorityId: 'convos.org',
      content: { inviteSlug: 'bearer-secret-slug' },
      fallback: 'bearer-secret-slug',
      id: 'join-request',
      typeId: 'join_request',
    })
    const olderVisible = message({
      id: 'older-real-message',
      sentAt: '2026-07-14T10:00:00Z',
      status: DeliveryStatus.Published,
    })
    const conversation = dm({
      messages: vi.fn()
        .mockResolvedValueOnce([control])
        .mockResolvedValueOnce([control, olderVisible]),
    })
    const fakeClient = client(conversation)
    fakeClient.conversations.listDms.mockResolvedValue([conversation])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const [summary] = await session.readInbox()

    expect(summary).toMatchObject({
      id: 'conversation-1',
      preview: 'older-real-message',
    })
    expect(summary?.preview).not.toContain('bearer-secret-slug')
  })

  it('keeps a generic row when 200 Convos controls leave older history uncertain', async () => {
    const control = typedMessage({
      authorityId: 'convos.org',
      content: { inviteSlug: 'bearer-secret-slug' },
      fallback: 'bearer-secret-slug',
      id: 'join-request',
      typeId: 'join_request',
    })
    const conversation = dm({
      messages: vi.fn()
        .mockResolvedValueOnce([control])
        .mockResolvedValueOnce(Array.from({ length: 200 }, () => control)),
    })
    const fakeClient = client(conversation)
    fakeClient.conversations.listDms.mockResolvedValue([conversation])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const [summary] = await session.readInbox()

    expect(summary).toMatchObject({ preview: 'Recent non-message activity' })
    expect(summary?.preview).not.toContain('bearer-secret-slug')
  })

  it('reports hidden control activity when the bounded inbox preview scan is exhausted', async () => {
    const latestControl = typedMessage({
      content: undefined,
      id: 'latest-control',
      typeId: 'typingIndicator',
    })
    const latestSentAt = new Date('2026-07-14T13:00:00Z')
    latestControl.sentAt = latestSentAt
    latestControl.sentAtNs = BigInt(latestSentAt.getTime()) * 1_000_000n
    const messages = vi.fn()
      .mockResolvedValueOnce([latestControl])
      .mockResolvedValueOnce(Array.from({ length: 200 }, () => latestControl))
    const conversation = dm({ messages })
    const fakeClient = client(conversation)
    fakeClient.conversations.listDms.mockResolvedValue([conversation])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const [summary] = await session.readInbox()

    expect(summary).toMatchObject({
      preview: 'Recent non-message activity',
      updatedAt: latestSentAt,
    })
    expect(messages).toHaveBeenNthCalledWith(2, expect.objectContaining({
      limit: 200n,
    }))
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

  it('advances the raw message window when silent controls span multiple pages', async () => {
    const silentControls = Array.from({ length: 120 }, (_, index) => typedMessage({
      content: undefined,
      id: `silent-${index}`,
      typeId: 'typingIndicator',
    }))
    const olderVisible = message({
      id: 'older-visible',
      sentAt: '2026-07-14T11:00:00Z',
      status: DeliveryStatus.Published,
    })
    const storedMessages = [...silentControls, olderVisible]
    const messages = vi.fn().mockImplementation((options?: { limit?: bigint }) => (
      Promise.resolve(storedMessages.slice(0, Number(options?.limit ?? 0n)))
    ))
    const conversation = dm({ messages })
    const fakeClient = client(conversation)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const initial = await session.loadConversation('conversation-1')

    expect(initial).toMatchObject({
      hasOlder: true,
      messages: [],
      scannedMessageCount: 50,
    })

    const secondPage = await session.loadOlderMessages(
      'conversation-1',
      initial.scannedMessageCount,
    )
    expect(secondPage).toMatchObject({
      hasOlder: true,
      messages: [],
      scannedMessageCount: 100,
    })

    const finalPage = await session.loadOlderMessages(
      'conversation-1',
      secondPage.scannedMessageCount,
    )
    expect(finalPage.hasOlder).toBe(false)
    expect(finalPage.scannedMessageCount).toBe(121)
    expect(finalPage.messages.map(({ id }) => id)).toEqual(['older-visible'])
    expect(messages.mock.calls.map(([options]) => options.limit)).toEqual([
      51n,
      51n,
      101n,
      151n,
    ])
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

  it('replaces an exhausted stream proxy during foreground recovery', async () => {
    const conversation = dm()
    const fakeClient = client(conversation)
    const first = { end: vi.fn(), isDone: false }
    const replacement = { end: vi.fn(), isDone: false }
    fakeClient.conversations.streamAllDmMessages
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(replacement)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onHealth = vi.fn()
    await session.startMessageStream(vi.fn(), onHealth)
    first.isDone = true

    await session.startMessageStream(vi.fn(), onHealth)

    expect(fakeClient.conversations.streamAllDmMessages).toHaveBeenCalledTimes(2)
    expect(onHealth).toHaveBeenLastCalledWith('live')
  })

  it('refreshes reaction parents without leaking rejected callback promises', async () => {
    const reaction = typedMessage({
      content: {
        action: 1,
        content: '😁',
        reference: 'parent',
        referenceInboxId: 'peer-inbox',
        schema: 1,
      },
      id: 'reaction',
      typeId: 'reaction',
    })
    const parent = typedMessage({
      content: 'Parent message',
      id: 'parent',
      reactions: [reaction],
      typeId: 'text',
    })
    const conversation = dm()
    const fakeClient = client(conversation)
    const stream = { end: vi.fn().mockResolvedValue(undefined), isDone: false }
    let onValue: ((message: DecodedMessage) => void) | undefined
    let resolveLateParent!: (message: DecodedMessage | undefined) => void
    fakeClient.conversations.streamAllDmMessages.mockImplementation(async (options) => {
      onValue = options.onValue
      return stream
    })
    fakeClient.conversations.getMessageById
      .mockResolvedValueOnce(parent)
      .mockRejectedValueOnce(new Error('worker closed'))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveLateParent = resolve
      }))
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onMessage = vi.fn()
    await session.startMessageStream(onMessage, vi.fn())

    onValue?.(reaction)
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'parent',
        reactions: [{ content: '😁', count: 1 }],
      }),
    ))

    onValue?.(reaction)
    await vi.waitFor(() => {
      expect(fakeClient.conversations.getMessageById).toHaveBeenCalledTimes(2)
    })
    await Promise.resolve()
    expect(onMessage).toHaveBeenCalledOnce()

    onValue?.(reaction)
    await vi.waitFor(() => {
      expect(fakeClient.conversations.getMessageById).toHaveBeenCalledTimes(3)
    })
    await session.close()
    resolveLateParent(parent)
    await Promise.resolve()
    expect(onMessage).toHaveBeenCalledOnce()
  })

  it('ignores an out-of-order stale reaction-parent refresh', async () => {
    const added = typedMessage({
      content: {
        action: 1,
        content: '👍',
        reference: 'parent',
        referenceInboxId: 'peer-inbox',
        schema: 1,
      },
      id: 'reaction-added',
      typeId: 'reaction',
    })
    const removed = typedMessage({
      content: {
        action: 2,
        content: '👍',
        reference: 'parent',
        referenceInboxId: 'peer-inbox',
        schema: 1,
      },
      id: 'reaction-removed',
      typeId: 'reaction',
    })
    const staleParent = typedMessage({
      content: 'Parent message',
      id: 'parent',
      reactions: [added],
      typeId: 'text',
    })
    const latestParent = typedMessage({
      content: 'Parent message',
      id: 'parent',
      reactions: [],
      typeId: 'text',
    })
    const fakeClient = client(dm())
    let onValue: ((message: DecodedMessage) => void) | undefined
    let resolveFirst!: (message: DecodedMessage | undefined) => void
    let resolveSecond!: (message: DecodedMessage | undefined) => void
    fakeClient.conversations.streamAllDmMessages.mockImplementation(async (options) => {
      onValue = options.onValue
      return { end: vi.fn(), isDone: false }
    })
    fakeClient.conversations.getMessageById
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve
      }))
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onMessage = vi.fn()
    await session.startMessageStream(onMessage, vi.fn())

    onValue?.(added)
    onValue?.(removed)
    await vi.waitFor(() => {
      expect(fakeClient.conversations.getMessageById).toHaveBeenCalledTimes(2)
    })

    resolveSecond(latestParent)
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledOnce())
    expect(onMessage).toHaveBeenLastCalledWith(expect.not.objectContaining({
      reactions: expect.anything(),
    }))

    resolveFirst(staleParent)
    await Promise.resolve()
    expect(onMessage).toHaveBeenCalledOnce()
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
