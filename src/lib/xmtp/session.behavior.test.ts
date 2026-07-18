import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from 'viem'
import {
  ConsentState,
  DeliveryStatus,
  Dm,
  Group,
  GroupMessageKind,
  IdentifierKind,
  SortDirection,
  type DecodedMessage,
  type Signer,
} from '@xmtp/browser-sdk'

const sdkMocks = vi.hoisted(() => ({
  create: vi.fn(),
  toSafeSigner: vi.fn(),
}))

vi.mock('@xmtp/browser-sdk', () => {
  class MockDm {}
  class MockGroup {}

  return {
    Client: { create: sdkMocks.create },
    ConsentState: { Allowed: 1, Denied: 2, Unknown: 0 },
    ContentType: { Reaction: 9, ReadReceipt: 10 },
    DeliveryStatus: { Failed: 2, Published: 1, Unpublished: 0 },
    Dm: MockDm,
    Group: MockGroup,
    GroupMessageKind: { Application: 1 },
    IdentifierKind: { Ethereum: 0 },
    ListConversationsOrderBy: { LastActivity: 1 },
    LogLevel: { Off: 0 },
    ReactionAction: { Added: 1, Removed: 2 },
    SortDirection: { Ascending: 0, Descending: 1 },
    toSafeSigner: sdkMocks.toSafeSigner,
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
import {
  convosInviteJoinErrorCodec,
  convosInviteJoinHandledCodec,
} from '../convos/controlCodec'
import { parseConvosInvite, type ParsedConvosInvite } from '../convos/invite'

const address = '0x52908400098527886E0F7030069857D2E4169EE7'
const CONVOS_TEST_SCAN_LIMIT = 20n
const CONVOS_CREATOR_BYTES = new Uint8Array(32).fill(0xab)
const CONVOS_CREATOR_INBOX_ID = 'ab'.repeat(32)
const CONVOS_OTHER_INBOX_ID = 'cd'.repeat(32)
const CONVOS_SIGNING_KEY = new Uint8Array(32).fill(0x42)
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
  senderInboxId?: string
  sentAt?: string
  status?: DeliveryStatus
  typeId: string
  versionMajor?: number
  versionMinor?: number
}): DecodedMessage {
  const sentAt = new Date(options.sentAt ?? '2026-07-14T12:00:00Z')
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
    senderInboxId: options.senderInboxId ?? 'peer-inbox',
    sentAt,
    sentAtNs: BigInt(sentAt.getTime()) * 1_000_000n,
  } as unknown as DecodedMessage
}

function concatBytes(...values: Uint8Array<ArrayBufferLike>[]) {
  const output = new Uint8Array(values.reduce((total, value) => total + value.length, 0))
  let offset = 0
  for (const value of values) {
    output.set(value, offset)
    offset += value.length
  }
  return output
}

function encodeVarint(value: bigint | number) {
  let remaining = BigInt(value)
  const bytes: number[] = []
  do {
    let byte = Number(remaining & 0x7fn)
    remaining >>= 7n
    if (remaining) byte |= 0x80
    bytes.push(byte)
  } while (remaining)
  return new Uint8Array(bytes)
}

function protobufBytesField(field: number, value: Uint8Array<ArrayBufferLike>) {
  return concatBytes(
    encodeVarint((field << 3) | 2),
    encodeVarint(value.length),
    value,
  )
}

function protobufStringField(field: number, value: string) {
  return protobufBytesField(field, new TextEncoder().encode(value))
}

function protobufFixed64Field(field: number, value: number) {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true)
  return concatBytes(encodeVarint((field << 3) | 1), bytes)
}

function base64Url(bytes: Uint8Array<ArrayBufferLike>) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let output = ''
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!
    const second = bytes[offset + 1]
    const third = bytes[offset + 2]
    output += alphabet[first >> 2]!
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]!
    if (second !== undefined) {
      output += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]!
    }
    if (third !== undefined) output += alphabet[third & 63]!
  }
  return output
}

function signedConvosInvite(options: {
  creatorInbox?: Uint8Array
  emoji?: string
  expiresAtUnix?: number
  name?: string
  tag?: string
} = {}) {
  const fields: Uint8Array<ArrayBufferLike>[] = [
    protobufBytesField(
      1,
      concatBytes(new Uint8Array([1]), new Uint8Array(31).fill(7)),
    ),
    protobufBytesField(2, options.creatorInbox ?? CONVOS_CREATOR_BYTES),
    protobufStringField(3, options.tag ?? 'signed-convos-tag'),
    protobufStringField(4, options.name ?? 'Signed garden group'),
    protobufStringField(10, options.emoji ?? '🌿'),
  ]
  if (options.expiresAtUnix !== undefined) {
    fields.push(protobufFixed64Field(8, options.expiresAtUnix))
  }
  const payload = concatBytes(...fields)
  const signature = secp256k1.sign(sha256(payload, 'bytes'), CONVOS_SIGNING_KEY, {
    prehash: false,
  })
  const slug = base64Url(concatBytes(
    protobufBytesField(1, payload),
    protobufBytesField(
      2,
      concatBytes(signature.toBytes('compact'), new Uint8Array([signature.recovery])),
    ),
  ))
  return parseConvosInvite(slug, { allowExpired: true })
}

function convosAppData(tag: string, emoji = '🌿') {
  return base64Url(concatBytes(
    protobufStringField(1, tag),
    protobufStringField(6, emoji),
  ))
}

function dm(methods: Record<string, unknown> = {}) {
  return Object.assign(Object.create(Dm.prototype) as Dm, {
    id: 'conversation-1',
    consentState: vi.fn().mockResolvedValue(ConsentState.Allowed),
    messages: vi.fn().mockResolvedValue([]),
    peerInboxId: vi.fn().mockResolvedValue('peer-inbox'),
    publishMessages: vi.fn(),
    send: vi.fn(),
    sendText: vi.fn(),
    sync: vi.fn(),
    updateConsentState: vi.fn(),
    ...methods,
  })
}

function group(options: {
  active?: boolean
  addedByInboxId?: string
  appData?: string
  consent?: ConsentState
  id?: string
  members?: string[]
  methods?: Record<string, unknown>
  name?: string
} = {}) {
  let consent = options.consent ?? ConsentState.Allowed
  const consentState = vi.fn(async () => consent)
  const updateConsentState = vi.fn(async (next: ConsentState) => {
    consent = next
  })
  return Object.assign(Object.create(Group.prototype) as Group, {
    addedByInboxId: options.addedByInboxId ?? CONVOS_CREATOR_INBOX_ID,
    appData: options.appData ?? convosAppData('signed-convos-tag'),
    consentState,
    createdAt: new Date('2026-07-14T12:00:00Z'),
    id: options.id ?? 'convos-group-1',
    isActive: vi.fn().mockResolvedValue(options.active ?? true),
    members: vi.fn().mockResolvedValue(
      (options.members ?? ['own-inbox', CONVOS_CREATOR_INBOX_ID]).map((inboxId) => ({
        inboxId,
      })),
    ),
    messages: vi.fn().mockResolvedValue([]),
    name: options.name ?? 'Signed garden group',
    publishMessages: vi.fn(),
    sendText: vi.fn(),
    sync: vi.fn(),
    updateConsentState,
    ...options.methods,
  })
}

function client(conversation: Dm) {
  const streamAllMessages = vi.fn()
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
      listGroups: vi.fn().mockResolvedValue([]),
      streamAllMessages,
      streamGroups: vi.fn().mockResolvedValue({
        end: vi.fn().mockResolvedValue(undefined),
        isDone: false,
      }),
      sync: vi.fn(),
      syncAll: vi.fn(),
    },
    env: 'dev',
    fetchInboxIdByIdentifier: vi.fn(),
    inboxId: 'own-inbox',
    preferences: {
      fetchInboxState: vi.fn(),
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
    unsafe_addAccountSignatureText: vi.fn(),
    unsafe_applySignatureRequest: vi.fn(),
  }
}

function convosJoinRequestMessage(
  invite: ParsedConvosInvite,
  overrides: {
    id?: string
    senderInboxId?: string
    sentAt?: string
  } = {},
) {
  return typedMessage({
    authorityId: 'convos.org',
    content: { inviteSlug: invite.slug },
    conversationId: 'creator-transport-dm',
    fallback: invite.slug,
    id: overrides.id ?? 'signed-join-request',
    senderInboxId: overrides.senderInboxId ?? 'own-inbox',
    sentAt: overrides.sentAt ?? '2026-07-14T12:00:00Z',
    typeId: 'join_request',
  })
}

function convosTransportDm(
  invite: ParsedConvosInvite,
  messages: DecodedMessage[] = [convosJoinRequestMessage(invite)],
  peerInboxId = invite.creatorInboxId,
) {
  return dm({
    id: 'creator-transport-dm',
    messages: vi.fn().mockResolvedValue(messages),
    peerInboxId: vi.fn().mockResolvedValue(peerInboxId),
  })
}

function convosHandledMessage(
  invite: ParsedConvosInvite,
  options: {
    id?: string
    inviteTag?: string
    senderInboxId?: string
    sentAt?: string
  } = {},
) {
  const sentAt = options.sentAt ?? '2026-07-14T12:01:00Z'
  return typedMessage({
    authorityId: 'convos.org',
    content: {
      handledMessageId: 'signed-join-request',
      inviteTag: options.inviteTag ?? invite.tag,
      timestamp: sentAt,
    },
    conversationId: 'creator-transport-dm',
    id: options.id ?? 'join-handled',
    senderInboxId: options.senderInboxId ?? invite.creatorInboxId,
    sentAt,
    typeId: 'invite_join_handled',
  })
}

function convosErrorMessage(
  invite: ParsedConvosInvite,
  options: {
    errorType?: 'conversation_expired' | 'conversation_not_found' |
      'consent_not_allowed' | 'generic_failure'
    id?: string
    inviteTag?: string
    reason?: string
    senderInboxId?: string
    sentAt?: string
  } = {},
) {
  const sentAt = options.sentAt ?? '2026-07-14T12:01:00Z'
  return typedMessage({
    authorityId: 'convos.org',
    content: {
      errorType: options.errorType ?? 'generic_failure',
      inviteTag: options.inviteTag ?? invite.tag,
      ...(options.reason ? { reason: options.reason } : {}),
      timestamp: sentAt,
    },
    conversationId: 'creator-transport-dm',
    id: options.id ?? 'join-error',
    senderInboxId: options.senderInboxId ?? invite.creatorInboxId,
    sentAt,
    typeId: 'invite_join_error',
  })
}

describe('XmtpMessagingSession behavior', () => {
  beforeEach(() => {
    sdkMocks.create.mockReset()
    sdkMocks.toSafeSigner.mockReset()
    signer.signMessage.mockReset()
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
        codecs: [
          convosJoinRequestCodec,
          convosInviteJoinHandledCodec,
          convosInviteJoinErrorCodec,
        ],
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

  it('promotes only a verified requested Unknown group and records a joined snapshot', async () => {
    const invite = signedConvosInvite()
    const request = convosJoinRequestMessage(invite)
    const transport = convosTransportDm(invite, [request])
    const imported = group({
      appData: convosAppData(invite.tag, '🌿'),
      consent: ConsentState.Unknown,
    })
    const fakeClient = client(transport)
    fakeClient.conversations.listDms.mockResolvedValue([transport])
    fakeClient.conversations.listGroups.mockResolvedValue([imported])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const inbox = await session.loadInbox()

    expect(imported.sync).toHaveBeenCalledOnce()
    expect(imported.updateConsentState).toHaveBeenCalledOnce()
    expect(imported.updateConsentState).toHaveBeenCalledWith(ConsentState.Allowed)
    expect(inbox).toEqual([
      expect.objectContaining({
        creatorInboxId: CONVOS_CREATOR_INBOX_ID,
        emoji: '🌿',
        id: 'convos-group-1',
        kind: 'convos-group',
        title: 'Signed garden group',
      }),
    ])
    expect(session.convosAccessSnapshot).toMatchObject({
      conversationId: 'creator-transport-dm',
      error: null,
      groupId: 'convos-group-1',
      messageId: 'signed-join-request',
      retryMode: 'none',
      status: 'joined',
    })
  })

  it.each([
    {
      buildGroup: (invite: ParsedConvosInvite) => group({
        appData: convosAppData(`${invite.tag}-wrong`),
        consent: ConsentState.Unknown,
      }),
      name: 'wrong tag',
    },
    {
      buildGroup: (invite: ParsedConvosInvite) => group({
        addedByInboxId: CONVOS_OTHER_INBOX_ID,
        appData: convosAppData(invite.tag),
        consent: ConsentState.Unknown,
      }),
      name: 'wrong addedBy inbox',
    },
    {
      buildGroup: (invite: ParsedConvosInvite) => group({
        addedByInboxId: '',
        appData: convosAppData(invite.tag),
        consent: ConsentState.Unknown,
      }),
      name: 'missing addedBy inbox',
    },
    {
      buildGroup: () => group({
        appData: 'not-valid-convos-app-data!',
        consent: ConsentState.Unknown,
      }),
      name: 'malformed appData',
    },
    {
      buildGroup: (invite: ParsedConvosInvite) => group({
        active: false,
        appData: convosAppData(invite.tag),
        consent: ConsentState.Unknown,
      }),
      name: 'inactive group',
    },
    {
      buildGroup: (invite: ParsedConvosInvite) => group({
        appData: convosAppData(invite.tag),
        consent: ConsentState.Unknown,
        members: [CONVOS_CREATOR_INBOX_ID],
      }),
      name: 'current inbox absent from members',
    },
    {
      buildGroup: (invite: ParsedConvosInvite) => group({
        appData: convosAppData(invite.tag),
        consent: ConsentState.Denied,
      }),
      name: 'denied group',
    },
    {
      buildGroup: (invite: ParsedConvosInvite) => group({
        appData: convosAppData(invite.tag),
        consent: ConsentState.Unknown,
      }),
      name: 'request not authored by this inbox',
      requestSenderInboxId: 'attacker-inbox',
    },
    {
      buildGroup: (invite: ParsedConvosInvite) => group({
        appData: convosAppData(invite.tag),
        consent: ConsentState.Unknown,
      }),
      name: 'request DM peer does not match the signed creator',
      transportPeerInboxId: CONVOS_OTHER_INBOX_ID,
    },
  ])('rejects a near-match import: $name', async ({
    buildGroup,
    requestSenderInboxId,
    transportPeerInboxId,
  }) => {
    const invite = signedConvosInvite()
    const request = convosJoinRequestMessage(invite, {
      ...(requestSenderInboxId ? { senderInboxId: requestSenderInboxId } : {}),
    })
    const transport = convosTransportDm(
      invite,
      [request],
      transportPeerInboxId ?? invite.creatorInboxId,
    )
    const candidate = buildGroup(invite)
    const fakeClient = client(transport)
    fakeClient.conversations.listDms.mockResolvedValue([transport])
    fakeClient.conversations.listGroups.mockResolvedValue([candidate])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const inbox = await session.loadInbox()

    expect(candidate.updateConsentState).not.toHaveBeenCalled()
    expect(inbox.filter(({ kind }) => kind === 'convos-group')).toEqual([])
    expect(session.convosAccessSnapshot?.status).not.toBe('joined')
  })

  it('keeps an explicitly Allowed valid Convos group visible without a recoverable request', async () => {
    const invite = signedConvosInvite()
    const allowed = group({
      appData: convosAppData(invite.tag, '💬'),
      consent: ConsentState.Allowed,
      name: '\u202eAlready\u202c allowed group',
    })
    const fakeClient = client(dm())
    fakeClient.conversations.listDms.mockResolvedValue([])
    fakeClient.conversations.listGroups.mockResolvedValue([allowed])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const inbox = await session.readInbox()

    expect(allowed.updateConsentState).not.toHaveBeenCalled()
    expect(inbox).toEqual([
      expect.objectContaining({
        emoji: '💬',
        id: 'convos-group-1',
        kind: 'convos-group',
        title: 'Already allowed group',
      }),
    ])
    expect(session.convosAccessSnapshot).toBeNull()
  })

  it('globally orders mixed DM and group activity before applying one 50-row cap', async () => {
    const groupRanks = new Set([0, 2, 25, 51])
    const expectedIds: string[] = []
    const dms: Dm[] = []
    const groups: Group[] = []
    const newestAt = Date.parse('2026-07-14T18:00:00Z')

    for (let rank = 0; rank < 52; rank += 1) {
      const isGroup = groupRanks.has(rank)
      const id = `${isGroup ? 'group' : 'dm'}-rank-${rank}`
      const activity = typedMessage({
        content: `Activity ${rank}`,
        conversationId: id,
        id: `message-rank-${rank}`,
        sentAt: new Date(newestAt - rank * 60_000).toISOString(),
        typeId: 'text',
      })
      expectedIds.push(id)
      if (isGroup) {
        groups.push(group({
          appData: convosAppData(`allowed-group-tag-${rank}`),
          id,
          methods: { messages: vi.fn().mockResolvedValue([activity]) },
          name: `Group ${rank}`,
        }))
      } else {
        dms.push(dm({
          id,
          messages: vi.fn().mockResolvedValue([activity]),
          peerInboxId: vi.fn().mockResolvedValue(`peer-${rank}`),
        }))
      }
    }

    const fakeClient = client(dms[0]!)
    fakeClient.conversations.listDms.mockResolvedValue(dms)
    fakeClient.conversations.listGroups.mockResolvedValue(groups)
    fakeClient.preferences.getInboxStates.mockResolvedValue([])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const inbox = await session.readInbox()

    expect(inbox).toHaveLength(50)
    expect(inbox.map(({ id }) => id)).toEqual(expectedIds.slice(0, 50))
    expect(inbox.slice(0, 3).map(({ kind }) => kind)).toEqual([
      'convos-group',
      'dm',
      'convos-group',
    ])
    expect(inbox.map(({ id }) => id)).not.toContain('dm-rank-50')
    expect(inbox.map(({ id }) => id)).not.toContain('group-rank-51')
  })

  it('treats an authenticated handled marker as waiting, not joined', async () => {
    const invite = signedConvosInvite()
    const request = convosJoinRequestMessage(invite)
    const handled = convosHandledMessage(invite)
    const transport = convosTransportDm(invite, [handled, request])
    const fakeClient = client(transport)
    fakeClient.conversations.listDms.mockResolvedValue([transport])
    fakeClient.conversations.listGroups.mockResolvedValue([])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    await session.readInbox()

    expect(session.convosAccessSnapshot).toMatchObject({
      error: null,
      groupId: null,
      retryMode: 'none',
      status: 'handled',
    })
  })

  it('makes a handled request discardable once its signed invite expires', async () => {
    const invite = signedConvosInvite({
      expiresAtUnix: Math.floor(Date.now() / 1000) - 1,
    })
    const request = convosJoinRequestMessage(invite)
    const handled = convosHandledMessage(invite)
    const transport = convosTransportDm(invite, [handled, request])
    const fakeClient = client(transport)
    fakeClient.conversations.listDms.mockResolvedValue([transport])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    await session.readInbox()

    expect(session.convosAccessSnapshot).toMatchObject({
      error: 'That Convos invite has expired.',
      retryMode: 'reset',
      status: 'failed',
    })
  })

  it('does not recover a failed request again after it is dismissed in this session', async () => {
    const invite = signedConvosInvite()
    const request = convosJoinRequestMessage(invite)
    const error = convosErrorMessage(invite)
    const transport = convosTransportDm(invite, [error, request])
    const fakeClient = client(transport)
    fakeClient.conversations.listDms.mockResolvedValue([transport])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    await session.readInbox()
    expect(session.convosAccessSnapshot?.status).toBe('failed')

    session.dismissConvosAccessRequest(request.id)
    await session.readInbox()

    expect(session.convosAccessSnapshot).toBeNull()
  })

  it('does not fall back to an older attempt after the newest retry is dismissed', async () => {
    const invite = signedConvosInvite()
    const olderRequest = convosJoinRequestMessage(invite, {
      id: 'older-join-request',
      sentAt: '2026-07-14T12:00:00Z',
    })
    const newerRequest = convosJoinRequestMessage(invite, {
      id: 'newer-join-request',
      sentAt: '2026-07-14T12:02:00Z',
    })
    const error = convosErrorMessage(invite, {
      sentAt: '2026-07-14T12:03:00Z',
    })
    const transport = convosTransportDm(invite, [
      error,
      newerRequest,
      olderRequest,
    ])
    const fakeClient = client(transport)
    fakeClient.conversations.listDms.mockResolvedValue([transport])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    await session.readInbox()
    expect(session.convosAccessSnapshot).toMatchObject({
      messageId: newerRequest.id,
      status: 'failed',
    })

    session.dismissConvosAccessRequest(newerRequest.id)
    await session.loadInbox()

    expect(session.convosAccessSnapshot).toBeNull()
  })

  it('uses only the newest authenticated post-request control and redacts its reason', async () => {
    const invite = signedConvosInvite()
    const request = convosJoinRequestMessage(invite)
    const authenticatedHandled = convosHandledMessage(invite, {
      id: 'older-authenticated-handled',
      sentAt: '2026-07-14T12:02:00Z',
    })
    const authenticatedError = convosErrorMessage(invite, {
      id: 'newer-authenticated-error',
      reason: `raw SDK failure for ${invite.slug} and private-inbox`,
      sentAt: '2026-07-14T12:03:00Z',
    })
    const staleError = convosErrorMessage(invite, {
      id: 'stale-before-request',
      sentAt: '2026-07-14T11:59:00Z',
    })
    const wrongSender = convosHandledMessage(invite, {
      id: 'newer-wrong-sender',
      senderInboxId: 'attacker-inbox',
      sentAt: '2026-07-14T12:05:00Z',
    })
    const wrongTag = convosHandledMessage(invite, {
      id: 'newer-wrong-tag',
      inviteTag: `${invite.tag}-wrong`,
      sentAt: '2026-07-14T12:06:00Z',
    })
    const transport = convosTransportDm(invite, [
      wrongTag,
      wrongSender,
      authenticatedError,
      authenticatedHandled,
      request,
      staleError,
    ])
    const fakeClient = client(transport)
    fakeClient.conversations.listDms.mockResolvedValue([transport])
    fakeClient.conversations.listGroups.mockResolvedValue([])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    await session.readInbox()

    expect(session.convosAccessSnapshot).toMatchObject({
      error: 'The inviter could not add this inbox. You can send a fresh request.',
      groupId: null,
      retryMode: 'fresh',
      status: 'failed',
    })
    expect(session.convosAccessSnapshot?.error).not.toContain(invite.slug)
    expect(session.convosAccessSnapshot?.error).not.toContain('private-inbox')
    expect(session.convosAccessSnapshot?.error).not.toContain('raw SDK')
  })

  it('reads and sends through the shared verified group conversation path', async () => {
    const invite = signedConvosInvite()
    const saved = typedMessage({
      content: 'Saved group message',
      conversationId: 'convos-group-1',
      id: 'saved-group-message',
      senderInboxId: CONVOS_CREATOR_INBOX_ID,
      typeId: 'text',
    })
    const optimistic = typedMessage({
      content: 'hello group',
      conversationId: 'convos-group-1',
      id: 'outgoing-group-message',
      senderInboxId: 'own-inbox',
      status: DeliveryStatus.Unpublished,
      typeId: 'text',
    })
    const published = typedMessage({
      content: 'hello group',
      conversationId: 'convos-group-1',
      id: 'outgoing-group-message',
      senderInboxId: 'own-inbox',
      status: DeliveryStatus.Published,
      typeId: 'text',
    })
    const allowed = group({
      appData: convosAppData(invite.tag, '🤝'),
      methods: {
        messages: vi.fn().mockResolvedValue([saved]),
        sendText: vi.fn().mockResolvedValue('outgoing-group-message'),
      },
      name: 'Verified group',
    })
    const fakeClient = client(dm())
    fakeClient.conversations.getConversationById.mockResolvedValue(allowed)
    fakeClient.conversations.getMessageById
      .mockResolvedValueOnce(optimistic)
      .mockResolvedValueOnce(published)
    fakeClient.conversations.listDms.mockResolvedValue([])
    fakeClient.conversations.listGroups.mockResolvedValue([allowed])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    await session.readInbox()
    const loaded = await session.readConversation('convos-group-1')
    const sent = await session.sendText('convos-group-1', 'hello group')

    expect(loaded.conversation).toMatchObject({
      creatorInboxId: CONVOS_CREATOR_INBOX_ID,
      emoji: '🤝',
      id: 'convos-group-1',
      kind: 'convos-group',
      title: 'Verified group',
    })
    expect(loaded.messages).toEqual([
      expect.objectContaining({
        id: 'saved-group-message',
        text: 'Saved group message',
      }),
    ])
    expect(allowed.sendText).toHaveBeenCalledWith('hello group', true)
    expect(allowed.publishMessages).toHaveBeenCalledOnce()
    expect(sent).toMatchObject({
      error: null,
      message: {
        delivery: 'sent',
        id: 'outgoing-group-message',
      },
    })
  })

  it('paginates and retries a verified group without creating a second send or draft', async () => {
    const invite = signedConvosInvite()
    const newestAt = Date.parse('2026-07-14T18:00:00Z')
    const history = Array.from({ length: 101 }, (_, index) => typedMessage({
      content: `Group history ${index}`,
      conversationId: 'convos-group-1',
      id: `group-history-${index}`,
      sentAt: new Date(newestAt - index * 60_000).toISOString(),
      typeId: 'text',
    }))
    const draft = typedMessage({
      content: 'retry this group message',
      conversationId: 'convos-group-1',
      id: 'group-draft',
      senderInboxId: 'own-inbox',
      status: DeliveryStatus.Unpublished,
      typeId: 'text',
    })
    const published = typedMessage({
      content: 'retry this group message',
      conversationId: 'convos-group-1',
      id: 'group-draft',
      senderInboxId: 'own-inbox',
      status: DeliveryStatus.Published,
      typeId: 'text',
    })
    const send = vi.fn()
    const sendText = vi.fn()
    const allowed = group({
      appData: convosAppData(invite.tag),
      methods: {
        messages: vi.fn().mockResolvedValue(history),
        send,
        sendText,
      },
    })
    const fakeClient = client(dm())
    fakeClient.conversations.getConversationById.mockResolvedValue(allowed)
    fakeClient.conversations.getMessageById
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(published)
    fakeClient.conversations.listDms.mockResolvedValue([])
    fakeClient.conversations.listGroups.mockResolvedValue([allowed])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    await session.readInbox()
    const older = await session.loadOlderMessages('convos-group-1', 50)
    const retried = await session.retryMessage('convos-group-1', 'group-draft')

    expect(allowed.messages).toHaveBeenCalledWith(expect.objectContaining({
      direction: SortDirection.Descending,
      kind: GroupMessageKind.Application,
      limit: 101n,
    }))
    expect(older).toMatchObject({
      hasOlder: true,
      scannedMessageCount: 100,
    })
    expect(older.messages).toHaveLength(100)
    expect(older.messages[0]?.id).toBe('group-history-99')
    expect(older.messages.at(-1)?.id).toBe('group-history-0')
    expect(send).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(allowed.publishMessages).toHaveBeenCalledOnce()
    expect(fakeClient.conversations.getMessageById).toHaveBeenCalledTimes(2)
    expect(retried).toMatchObject({
      error: null,
      message: {
        delivery: 'sent',
        id: 'group-draft',
      },
    })
  })

  it('filters live Unknown group messages while emitting trusted Allowed group messages', async () => {
    const invite = signedConvosInvite()
    const allowed = group({
      appData: convosAppData(invite.tag),
      id: 'allowed-convos-group',
    })
    const unknown = group({
      appData: convosAppData('unrequested-tag'),
      consent: ConsentState.Unknown,
      id: 'unknown-convos-group',
    })
    const fakeClient = client(dm())
    let onValue: ((message: DecodedMessage) => void) | undefined
    fakeClient.conversations.getConversationById.mockImplementation(async (id) => (
      id === allowed.id ? allowed : id === unknown.id ? unknown : undefined
    ))
    fakeClient.conversations.listDms.mockResolvedValue([])
    fakeClient.conversations.listGroups.mockResolvedValue([allowed, unknown])
    fakeClient.conversations.streamAllMessages.mockImplementation(async (options) => {
      onValue = options.onValue
      return { end: vi.fn().mockResolvedValue(undefined), isDone: false }
    })
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    await session.readInbox()
    const onMessage = vi.fn()
    await session.startMessageStream(onMessage, vi.fn())

    onValue?.(typedMessage({
      content: 'Untrusted message',
      conversationId: unknown.id,
      id: 'unknown-group-message',
      typeId: 'text',
    }))
    onValue?.(typedMessage({
      content: 'Trusted message',
      conversationId: allowed.id,
      id: 'allowed-group-message',
      typeId: 'text',
    }))

    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledOnce())
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'allowed-group-message',
      text: 'Trusted message',
    }))
    expect(fakeClient.conversations.streamAllMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        consentStates: [ConsentState.Allowed, ConsentState.Unknown],
      }),
    )
  })

  it('reconciles a matching Unknown streamGroups arrival without admitting an unrelated group', async () => {
    const invite = signedConvosInvite()
    const request = convosJoinRequestMessage(invite)
    const transport = convosTransportDm(invite, [request])
    const unrelated = group({
      appData: convosAppData('unrelated-stream-tag'),
      consent: ConsentState.Unknown,
      id: 'unrelated-stream-group',
    })
    const matching = group({
      appData: convosAppData(invite.tag),
      consent: ConsentState.Unknown,
      id: 'matching-stream-group',
    })
    const fakeClient = client(transport)
    let arrivals: Group[] = []
    let onGroup: ((group: Group) => void) | undefined
    fakeClient.conversations.listDms.mockResolvedValue([transport])
    fakeClient.conversations.listGroups.mockImplementation(async () => arrivals)
    fakeClient.conversations.streamAllMessages.mockResolvedValue({
      end: vi.fn().mockResolvedValue(undefined),
      isDone: false,
    })
    fakeClient.conversations.streamGroups.mockImplementation(async (options) => {
      onGroup = options.onValue
      return { end: vi.fn().mockResolvedValue(undefined), isDone: false }
    })
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onInboxChanged = vi.fn()
    await session.startMessageStream(vi.fn(), vi.fn(), onInboxChanged)

    arrivals = [unrelated]
    onGroup?.(unrelated)
    await vi.waitFor(() => expect(onInboxChanged).toHaveBeenCalledOnce())
    const unrelatedInbox = await session.readInbox()
    expect(unrelated.updateConsentState).not.toHaveBeenCalled()
    expect(unrelatedInbox.filter(({ kind }) => kind === 'convos-group')).toEqual([])

    arrivals = [unrelated, matching]
    onGroup?.(matching)
    await vi.waitFor(() => {
      expect(matching.updateConsentState).toHaveBeenCalledWith(ConsentState.Allowed)
      expect(onInboxChanged).toHaveBeenCalledTimes(2)
    })
    const joinedInbox = await session.readInbox()

    expect(unrelated.updateConsentState).not.toHaveBeenCalled()
    expect(joinedInbox.filter(({ kind }) => kind === 'convos-group')).toEqual([
      expect.objectContaining({
        id: 'matching-stream-group',
        kind: 'convos-group',
      }),
    ])
    expect(session.convosAccessSnapshot).toMatchObject({
      groupId: 'matching-stream-group',
      status: 'joined',
    })
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
    fakeClient.conversations.streamAllMessages.mockImplementation(async (options) => {
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

    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledOnce())
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

  it('binds an already-associated Farcaster identity through the low-level SDK flow', async () => {
    const fakeClient = client(dm())
    const signature = new Uint8Array([1, 2, 3])
    const safeSigner = { identifier: 'safe-source' }
    fakeClient.unsafe_addAccountSignatureText.mockResolvedValue({
      signatureRequestId: 'request-1',
      signatureText: 'Bind this Farcaster identity',
    })
    fakeClient.fetchInboxIdByIdentifier.mockResolvedValue('own-inbox')
    fakeClient.preferences.fetchInboxState.mockResolvedValue({
      accountIdentifiers: [await signer.getIdentifier()],
      inboxId: 'own-inbox',
      installations: [],
      recoveryIdentifier: await signer.getIdentifier(),
    })
    signer.signMessage.mockResolvedValueOnce(signature)
    sdkMocks.toSafeSigner.mockResolvedValueOnce(safeSigner)
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)

    await expect(session.bindIdentity(signer, address)).resolves.toBeUndefined()

    const identifier = await signer.getIdentifier()
    expect(fakeClient.unsafe_addAccountSignatureText).toHaveBeenCalledWith(
      identifier,
      true,
    )
    expect(signer.signMessage).toHaveBeenCalledWith('Bind this Farcaster identity')
    expect(sdkMocks.toSafeSigner).toHaveBeenCalledWith(signer, signature)
    expect(fakeClient.unsafe_applySignatureRequest).toHaveBeenCalledWith(
      safeSigner,
      'request-1',
    )
    expect(fakeClient.fetchInboxIdByIdentifier).toHaveBeenCalledWith(identifier)
    expect(fakeClient.preferences.fetchInboxState).toHaveBeenCalledOnce()
  })

  it('fails closed when the network cannot verify an applied identity binding', async () => {
    const fakeClient = client(dm())
    fakeClient.unsafe_addAccountSignatureText.mockResolvedValue({
      signatureRequestId: 'request-2',
      signatureText: 'Bind this Farcaster identity',
    })
    fakeClient.fetchInboxIdByIdentifier.mockResolvedValue('another-inbox')
    fakeClient.preferences.fetchInboxState.mockResolvedValue({
      accountIdentifiers: [],
      inboxId: 'own-inbox',
      installations: [],
      recoveryIdentifier: await signer.getIdentifier(),
    })
    signer.signMessage.mockResolvedValueOnce(new Uint8Array([4, 5, 6]))
    sdkMocks.toSafeSigner.mockResolvedValueOnce({ identifier: 'safe-source' })
    sdkMocks.create.mockResolvedValue(fakeClient)
    const session = await XmtpMessagingSession.create(signer, address)

    await expect(session.bindIdentity(signer, address)).rejects.toMatchObject({
      name: 'XmtpIdentityBindingVerificationError',
    })
    expect(fakeClient.unsafe_applySignatureRequest).toHaveBeenCalledOnce()
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
      kind: 'dm',
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
    expect(fakeClient.conversations.listDms).toHaveBeenCalledTimes(4)
    expect(fakeClient.conversations.listDms.mock.invocationCallOrder[0]).toBeLessThan(
      fakeClient.conversations.syncAll.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(fakeClient.conversations.syncAll.mock.invocationCallOrder[0]).toBeLessThan(
      fakeClient.conversations.listDms.mock.invocationCallOrder[3] ?? 0,
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
    const noisyMessages = vi.fn().mockImplementation(async (options) => {
      if (options.limit === CONVOS_TEST_SCAN_LIMIT) return []
      return options.limit === 1n
        ? [silentControl]
        : [silentControl, olderVisible]
    })
    const recentMessages = vi.fn().mockImplementation(async (options) => (
      options.limit === CONVOS_TEST_SCAN_LIMIT ? [] : [newerVisible]
    ))
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
    expect(noisyMessages).toHaveBeenCalledWith(expect.objectContaining({
      limit: 1n,
    }))
    expect(noisyMessages).toHaveBeenCalledWith(expect.objectContaining({
      limit: 200n,
    }))
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
    const messages = vi.fn().mockImplementation(async (options) => (
      options.limit === CONVOS_TEST_SCAN_LIMIT ? [] : [control]
    ))
    const conversation = dm({ messages })
    const fakeClient = client(conversation)
    fakeClient.conversations.listDms.mockResolvedValue([conversation])
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)

    await expect(session.readInbox()).resolves.toEqual([])
    expect(messages).toHaveBeenCalledWith(expect.objectContaining({
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
      messages: vi.fn().mockImplementation(async (options) => {
        if (options.limit === CONVOS_TEST_SCAN_LIMIT) return []
        return options.limit === 1n ? [control] : [control, olderVisible]
      }),
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
      messages: vi.fn().mockImplementation(async (options) => {
        if (options.limit === CONVOS_TEST_SCAN_LIMIT) return []
        return options.limit === 1n
          ? [control]
          : Array.from({ length: 200 }, () => control)
      }),
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
    const messages = vi.fn().mockImplementation(async (options) => {
      if (options.limit === CONVOS_TEST_SCAN_LIMIT) return []
      return options.limit === 1n
        ? [latestControl]
        : Array.from({ length: 200 }, () => latestControl)
    })
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
    expect(messages).toHaveBeenCalledWith(expect.objectContaining({
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
    fakeClient.conversations.streamAllMessages.mockImplementation(async (options) => {
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
    expect(fakeClient.conversations.streamAllMessages).toHaveBeenCalledOnce()
    callbacks?.onRestart?.()
    expect(onHealth).toHaveBeenLastCalledWith('live')
  })

  it('reports live only after both message and group streams have recovered', async () => {
    const fakeClient = client(dm())
    let messageCallbacks: Record<string, (...args: never[]) => void> | undefined
    let groupCallbacks: Record<string, (...args: never[]) => void> | undefined
    fakeClient.conversations.streamAllMessages.mockImplementation(async (options) => {
      messageCallbacks = options
      return { end: vi.fn(), isDone: false }
    })
    fakeClient.conversations.streamGroups.mockImplementation(async (options) => {
      groupCallbacks = options
      return { end: vi.fn(), isDone: false }
    })
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onHealth = vi.fn()
    await session.startMessageStream(vi.fn(), onHealth)
    expect(onHealth).toHaveBeenLastCalledWith('live')

    messageCallbacks?.onRetry?.()
    groupCallbacks?.onRestart?.()
    expect(onHealth).toHaveBeenLastCalledWith('retrying')

    messageCallbacks?.onRestart?.()
    expect(onHealth).toHaveBeenLastCalledWith('live')

    groupCallbacks?.onFail?.()
    messageCallbacks?.onRestart?.()
    expect(onHealth).toHaveBeenLastCalledWith('retrying')

    groupCallbacks?.onRestart?.()
    expect(onHealth).toHaveBeenLastCalledWith('live')
  })

  it('replaces an exhausted stream proxy during foreground recovery', async () => {
    const conversation = dm()
    const fakeClient = client(conversation)
    const first = { end: vi.fn(), isDone: false }
    const replacement = { end: vi.fn(), isDone: false }
    fakeClient.conversations.streamAllMessages
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(replacement)
    sdkMocks.create.mockResolvedValue(fakeClient)

    const session = await XmtpMessagingSession.create(signer, address)
    const onHealth = vi.fn()
    await session.startMessageStream(vi.fn(), onHealth)
    first.isDone = true

    await session.startMessageStream(vi.fn(), onHealth)

    expect(fakeClient.conversations.streamAllMessages).toHaveBeenCalledTimes(2)
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
    fakeClient.conversations.streamAllMessages.mockImplementation(async (options) => {
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
    fakeClient.conversations.streamAllMessages.mockImplementation(async (options) => {
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
    fakeClient.conversations.streamAllMessages.mockReturnValue(new Promise((resolve) => {
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
    fakeClient.conversations.streamAllMessages.mockResolvedValue(stream)
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
