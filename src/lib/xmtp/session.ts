import {
  Client,
  ConsentState,
  ContentType,
  DeliveryStatus,
  Dm,
  Group,
  GroupMessageKind,
  IdentifierKind,
  ListConversationsOrderBy,
  LogLevel,
  ReactionAction,
  SortDirection,
  isActions,
  isAttachment,
  isGroupUpdated,
  isIntent,
  isLeaveRequest,
  isMarkdown,
  isMultiRemoteAttachment,
  isReaction,
  isReadReceipt,
  isRemoteAttachment,
  isReply,
  isText,
  isTextReply,
  isTransactionReference,
  isWalletSendCalls,
  type AsyncStreamProxy,
  type BuiltInContentTypes,
  type DecodedMessage,
  type EnrichedReply,
  type Identifier,
  type InboxState,
  type Signer,
  type XmtpEnv,
} from '@xmtp/browser-sdk'
import type { ContentCodec } from '@xmtp/content-type-primitives'
import {
  convosJoinRequestCodec,
  type ConvosJoinRequest,
} from '../convos/joinRequestCodec'
import type { ParsedConvosInvite } from '../convos/invite'
import { parseConvosGroupAppData } from '../convos/appData'
import { sanitizeConvosPreviewText } from '../convos/presentation'
import {
  convosInviteJoinErrorCodec,
  convosInviteJoinHandledCodec,
  convosJoinErrorMessage,
  type ConvosInviteJoinError,
  type ConvosInviteJoinHandled,
} from '../convos/controlCodec'

import {
  MAX_MESSAGE_REACTIONS,
  type ActiveConversation,
  type ConversationSummary,
  type MessageItem,
  type StreamHealth,
} from '../../features/messaging/types'

/*
 * Keep the inbox lookup bounded. If the window contains only silent control
 * traffic, the row reports that honestly and the conversation's manual
 * pagination can continue through older history.
 */
const INBOX_PREVIEW_SCAN_SIZE = 200n
const CONVOS_TRANSPORT_DM_LIMIT = 100n
const CONVOS_TRANSPORT_MESSAGE_LIMIT = 20n
const CONVOS_REQUEST_LIMIT = 100

type LatestDisplayableMessage = {
  hideConversation: boolean
  hiddenActivityAt: Date | null
  message: DecodedMessage | undefined
}

const VISIBLE_CONSENT_STATES = [ConsentState.Allowed]
const INBOX_LIMIT = 50n
const MESSAGE_PAGE_SIZE = 50n
const CLIENT_INITIALIZATION_TIMEOUT_MS = 30_000
const NON_TIMELINE_CONTENT_TYPES = [ContentType.Reaction, ContentType.ReadReceipt]
const SUPPORTED_ENVS: readonly XmtpEnv[] = [
  'local',
  'dev',
  'production',
  'testnet-staging',
  'testnet-dev',
  'testnet',
  'mainnet',
]
const GATEWAY_REQUIRED_ENVS: readonly XmtpEnv[] = [
  'testnet-staging',
  'testnet-dev',
  'testnet',
  'mainnet',
]

type AppContentTypes =
  | ConvosInviteJoinError
  | ConvosInviteJoinHandled
  | ConvosJoinRequest
  | BuiltInContentTypes
  | EnrichedReply<
    ConvosJoinRequest | BuiltInContentTypes,
    ConvosJoinRequest | BuiltInContentTypes
  >
/*
 * browser-sdk@7's ContentCodec[] constraint is invariant under strict function
 * types even though Client.create accepts and registers typed codecs at runtime.
 * Keep the cast at this single SDK boundary; the codec itself remains strongly
 * typed and independently tested.
 */
const APP_CODECS = [
  convosJoinRequestCodec as unknown as ContentCodec,
  convosInviteJoinHandledCodec as unknown as ContentCodec,
  convosInviteJoinErrorCodec as unknown as ContentCodec,
]
type AppClient = Client<AppContentTypes>
type AppDm = Dm<AppContentTypes>
type AppGroup = Group<AppContentTypes>
type AppConversation = AppDm | AppGroup
type IncomingMessage = DecodedMessage<AppContentTypes>

type RecoveredConvosRequest = {
  conversationId: string
  invite: ParsedConvosInvite
  messageId: string
  sentAtNs: bigint
  controls: IncomingMessage[]
}

type TrustedConvosGroup = {
  creatorInboxId: string
  emoji: string | null
  group: AppGroup
  invite: ParsedConvosInvite | null
  title: string
}

export type SendResult = {
  error: string | null
  message: MessageItem
}

export type ConvosAccessRequestResult = {
  conversationId: string
  messageId: string
}

export type ConvosAccessSnapshot = {
  conversationId: string
  error: string | null
  groupId: string | null
  invite: ParsedConvosInvite
  messageId: string
  retryMode: 'fresh' | 'reset' | 'none'
  status: 'waiting' | 'handled' | 'joined' | 'failed'
}

export type ConversationLoad = {
  conversation: ActiveConversation
  hasOlder: boolean
  messages: MessageItem[]
  scannedMessageCount: number
}

export type XmtpIdentityRelationship =
  | 'active-address'
  | 'same-inbox'
  | 'different-inbox'
  | 'no-inbox'

export class XmtpClientInitializationError extends Error {
  constructor(cause: unknown) {
    super('XMTP could not initialize its local browser client.', { cause })
    this.name = 'XmtpClientInitializationError'
  }
}

export class XmtpClientInitializationTimeoutError extends Error {
  constructor() {
    super('XMTP client initialization timed out.')
    this.name = 'XmtpClientInitializationTimeoutError'
  }
}

export class XmtpInboxTargetMismatchError extends Error {
  constructor() {
    super('XMTP opened a different inbox than the verified target.')
    this.name = 'XmtpInboxTargetMismatchError'
  }
}

export class XmtpGatewayConfigurationError extends Error {
  constructor(environment: XmtpEnv) {
    super(`XMTP ${environment} requires an authenticated payer Gateway.`)
    this.name = 'XmtpGatewayConfigurationError'
  }
}

export class XmtpMessagingSession {
  readonly address: `0x${string}`
  readonly client: AppClient
  readonly isNewInstallation: boolean
  #messageStream: AsyncStreamProxy<IncomingMessage> | null = null
  #groupStream: AsyncStreamProxy<AppGroup> | null = null
  #messageStreamHealth: Extract<StreamHealth, 'live' | 'retrying'> = 'retrying'
  #groupStreamHealth: Extract<StreamHealth, 'live' | 'retrying'> = 'retrying'
  #messageStreamStart: Promise<void> | null = null
  #reactionRefreshVersions = new Map<string, number>()
  #dismissedConvosRequestIds = new Set<string>()
  #dismissedConvosRequestCutoffNs: bigint | null = null
  #trustedConvosGroups = new Map<string, TrustedConvosGroup>()
  #recoveredConvosRequests: RecoveredConvosRequest[] | null = null
  #convosAccessSnapshot: ConvosAccessSnapshot | null = null
  #convosAccessSnapshotSentAtNs: bigint | null = null
  #convosReconcile: Promise<void> | null = null
  #streamGeneration = 0

  private constructor(
    client: AppClient,
    address: `0x${string}`,
    isNewInstallation: boolean,
  ) {
    this.client = client
    this.address = address
    this.isNewInstallation = isNewInstallation
  }

  static async create(
    signer: Signer,
    address: `0x${string}`,
    expectedInboxId?: string,
  ) {
    const options = clientOptions()
    let client: AppClient
    let clientPromise: Promise<AppClient> | null = null

    try {
      clientPromise = Client.create(signer, {
        ...options,
        codecs: APP_CODECS,
        disableAutoRegister: true,
      }) as Promise<AppClient>
      client = await withInitializationTimeout(clientPromise)
    } catch (error) {
      if (error instanceof XmtpClientInitializationTimeoutError && clientPromise) {
        // WorkerBridge does not reject outstanding actions after a fatal Worker
        // error. If initialization eventually returns, close that late client;
        // until then the caller keeps the origin lease and requires a reload.
        void clientPromise.then((lateClient) => lateClient.close()).catch(() => undefined)
      }
      // browser-sdk@7.0.0 creates its Worker before init and does not expose the
      // Client on rejection, so the caller must require a document restart.
      throw new XmtpClientInitializationError(error)
    }

    try {
      if (expectedInboxId && client.inboxId !== expectedInboxId) {
        throw new XmtpInboxTargetMismatchError()
      }
      const isNewInstallation = !(await client.isRegistered())
      await client.register()
      return new XmtpMessagingSession(client, address, isNewInstallation)
    } catch (error) {
      client.close()
      throw error
    }
  }

  get inboxId(): string {
    if (!this.client.inboxId) throw new Error('XMTP did not return an inbox ID.')
    return this.client.inboxId
  }

  get environment(): XmtpEnv {
    return this.client.env ?? configuredEnvironment()
  }

  get convosAccessSnapshot(): ConvosAccessSnapshot | null {
    return this.#convosAccessSnapshot
  }

  dismissConvosAccessRequest(messageId: string): void {
    if (!messageId) return
    const dismissedAtNs = this.#convosAccessSnapshot?.messageId === messageId
      ? this.#convosAccessSnapshotSentAtNs
      : this.#recoveredConvosRequests?.find(
        (request) => request.messageId === messageId,
      )?.sentAtNs ?? null
    this.#dismissedConvosRequestIds.add(messageId)
    if (
      dismissedAtNs !== null &&
      (
        this.#dismissedConvosRequestCutoffNs === null ||
        dismissedAtNs > this.#dismissedConvosRequestCutoffNs
      )
    ) {
      this.#dismissedConvosRequestCutoffNs = dismissedAtNs
    }
    if (this.#convosAccessSnapshot?.messageId === messageId) {
      this.#convosAccessSnapshot = null
      this.#convosAccessSnapshotSentAtNs = null
    }
    if (this.#recoveredConvosRequests) {
      this.#recoveredConvosRequests = this.#recoveredConvosRequests.filter(
        (request) => (
          !this.#dismissedConvosRequestIds.has(request.messageId) &&
          (
            this.#dismissedConvosRequestCutoffNs === null ||
            request.sentAtNs > this.#dismissedConvosRequestCutoffNs
          )
        ),
      )
    }
  }

  async inspectIdentityRelationship(
    address: `0x${string}`,
  ): Promise<XmtpIdentityRelationship> {
    if (address.toLowerCase() === this.address.toLowerCase()) {
      return 'active-address'
    }

    const targetInboxId = await this.findInboxId(address)
    if (!targetInboxId) return 'no-inbox'
    return targetInboxId === this.inboxId ? 'same-inbox' : 'different-inbox'
  }

  /**
   * Resolves an address to its existing inbox without changing either inbox.
   * The explicit ENS session-switch preflight uses the returned ID as the
   * target that must still match after the document restarts.
   */
  async findInboxId(address: `0x${string}`): Promise<string | null> {
    if (address.toLowerCase() === this.address.toLowerCase()) return this.inboxId

    return await this.client.fetchInboxIdByIdentifier(
      ethereumIdentifier(address),
    ) ?? null
  }

  async requestHistorySync(): Promise<boolean> {
    if (!this.isNewInstallation) return false
    await this.client.sendSyncRequest()
    return true
  }

  async loadInbox(
    onCached?: (conversations: ConversationSummary[]) => void,
  ): Promise<ConversationSummary[]> {
    if (onCached) onCached(await this.readInbox())
    await this.client.conversations.sync()
    await this.#reconcileConvosGroups(true, true)
    await this.client.conversations.syncAll(VISIBLE_CONSENT_STATES)

    return this.readInbox()
  }

  async readInbox(): Promise<ConversationSummary[]> {
    await this.#reconcileConvosGroups(false, false)
    const conversations = await this.client.conversations.listDms({
      consentStates: VISIBLE_CONSENT_STATES,
      includeDuplicateDms: false,
      limit: INBOX_LIMIT,
      orderBy: ListConversationsOrderBy.LastActivity,
    })
    const peerInboxIds = await Promise.all(
      conversations.map((conversation) => conversation.peerInboxId()),
    )
    const uniquePeerInboxIds = [...new Set(peerInboxIds)]
    const states = uniquePeerInboxIds.length
      ? await this.client.preferences.getInboxStates(uniquePeerInboxIds)
      : []
    const addresses = new Map(
      states.map((state) => [
        state.inboxId,
        displayAddress(state),
      ]),
    )

    const summaries = await Promise.all(
      conversations.map(async (conversation, index) => {
        const peerInboxId = peerInboxIds[index]
        if (!peerInboxId) throw new Error('XMTP returned a DM without a peer inbox.')
        const latest = await this.latestDisplayableMessage(conversation)
        if (latest.hideConversation) return null
        const lastMessage = latest.message

        return {
          id: conversation.id,
          isOwnLastMessage: lastMessage?.senderInboxId === this.inboxId,
          kind: 'dm' as const,
          lastSenderInboxId: lastMessage?.senderInboxId ?? null,
          peerAddress: addresses.get(peerInboxId) ?? null,
          peerInboxId,
          preview: previewFor(lastMessage) ?? (
            latest.hiddenActivityAt ? 'Recent non-message activity' : 'No messages yet'
          ),
          updatedAt: lastMessage?.sentAt ?? latest.hiddenActivityAt ??
            conversation.createdAt ?? null,
        }
      }),
    )

    const groupSummaries = await Promise.all(
      [...this.#trustedConvosGroups.values()].map(async ({
        creatorInboxId,
        emoji,
        group,
        title,
      }) => {
        const latest = await this.latestDisplayableMessage(group)
        const lastMessage = latest.message
        return {
          creatorInboxId,
          emoji,
          id: group.id,
          isOwnLastMessage: lastMessage?.senderInboxId === this.inboxId,
          kind: 'convos-group' as const,
          lastSenderInboxId: lastMessage?.senderInboxId ?? null,
          peerAddress: null,
          peerInboxId: null,
          preview: previewFor(lastMessage) ?? (
            latest.hiddenActivityAt ? 'Recent non-message activity' : 'No messages yet'
          ),
          title,
          updatedAt: lastMessage?.sentAt ?? latest.hiddenActivityAt ??
            group.createdAt ?? null,
        }
      }),
    )

    const dmSummaries = summaries.filter(
      (summary): summary is NonNullable<typeof summary> => summary !== null,
    )
    const combined: ConversationSummary[] = [...dmSummaries, ...groupSummaries]
    return combined
      .sort(compareConversationActivity)
      .slice(0, Number(INBOX_LIMIT))
  }

  async loadConversation(
    conversationId: string,
    onCached?: (loaded: ConversationLoad) => void,
    messageLimit = Number(MESSAGE_PAGE_SIZE),
  ): Promise<ConversationLoad> {
    const cached = await this.readConversation(conversationId, messageLimit)
    onCached?.(cached)

    const conversation = await this.getConversation(conversationId)
    await conversation.sync()
    return this.readConversation(conversationId, messageLimit)
  }

  /** Reads one conversation only from the already-open local XMTP database. */
  async readConversation(
    conversationId: string,
    messageLimit = Number(MESSAGE_PAGE_SIZE),
  ): Promise<ConversationLoad> {
    const conversation = await this.getConversation(conversationId)
    let activeConversation: ActiveConversation
    if (conversation instanceof Dm) {
      const peerInboxId = await conversation.peerInboxId()
      const [state] = await this.client.preferences.getInboxStates([peerInboxId])
      activeConversation = {
        id: conversation.id,
        kind: 'dm',
        peerAddress: displayAddress(state),
        peerInboxId,
      }
    } else {
      const trusted = this.#trustedConvosGroups.get(conversation.id)
      if (!trusted) throw new Error('This Convos group has not been verified for this inbox.')
      activeConversation = {
        creatorInboxId: trusted.creatorInboxId,
        emoji: trusted.emoji,
        id: conversation.id,
        kind: 'convos-group',
        peerAddress: null,
        peerInboxId: null,
        title: trusted.title,
      }
    }
    const cached = await this.messageWindow(conversation, messageLimit)
    return {
      conversation: activeConversation,
      ...cached,
    }
  }

  async loadOlderMessages(
    conversationId: string,
    scannedMessageCount: number,
  ): Promise<Pick<ConversationLoad, 'hasOlder' | 'messages' | 'scannedMessageCount'>> {
    return this.messageWindow(
      await this.getConversation(conversationId),
      normalizeMessageLimit(scannedMessageCount) + Number(MESSAGE_PAGE_SIZE),
    )
  }

  async createDm(address: `0x${string}`): Promise<ActiveConversation> {
    const identifier = ethereumIdentifier(address)
    if (!(await this.canMessageAddress(address))) {
      throw new Error('That address does not have a reachable XMTP inbox yet.')
    }

    const conversation =
      (await this.client.conversations.fetchDmByIdentifier(identifier)) ??
      (await this.client.conversations.createDmWithIdentifier(identifier))
    await conversation.updateConsentState(ConsentState.Allowed)

    return {
      id: conversation.id,
      kind: 'dm',
      peerAddress: address,
      peerInboxId: await conversation.peerInboxId(),
    }
  }

  async canMessageAddress(address: `0x${string}`): Promise<boolean> {
    const reachability = await this.client.canMessage([
      ethereumIdentifier(address),
    ])
    return reachability.get(address.toLowerCase()) === true
  }

  async requestConvosAccess(
    invite: ParsedConvosInvite,
  ): Promise<ConvosAccessRequestResult> {
    if (invite.creatorInboxId.toLowerCase() === this.inboxId.toLowerCase()) {
      throw new Error('This Convos invite points back to the inbox already open here.')
    }
    await this.client.conversations.sync()
    const existing = await this.client.conversations.getDmByInboxId(
      invite.creatorInboxId,
    ) as AppDm | undefined
    const conversation =
      existing ??
      (await this.client.conversations.createDm(invite.creatorInboxId))
    const encoded = convosJoinRequestCodec.encode({ inviteSlug: invite.slug })
    const messageId = await conversation.send(encoded, {
      shouldPush: true,
    })
    this.#recoveredConvosRequests = null
    // A resolved non-optimistic send is the published boundary. Do not turn a
    // lagging local read-back into a duplicate request; retain the stable ID
    // returned by the SDK and let the normal sync path observe it.
    return { conversationId: conversation.id, messageId }
  }

  async sendText(
    conversationId: string,
    text: string,
    onOptimistic?: (message: MessageItem) => void,
  ): Promise<SendResult> {
    const conversation = await this.getConversation(conversationId)
    const messageId = await conversation.sendText(text, true)
    const optimistic = await this.client.conversations.getMessageById(messageId)

    if (!optimistic) throw new Error('XMTP did not persist the outgoing message.')
    onOptimistic?.(toRequiredMessageItem(optimistic, this.inboxId))

    try {
      await conversation.publishMessages()
      const published = await this.client.conversations.getMessageById(messageId)

      if (!published || published.deliveryStatus !== DeliveryStatus.Published) {
        throw new Error('XMTP did not confirm that the message was published.')
      }

      return {
        error: null,
        message: toRequiredMessageItem(published, this.inboxId),
      }
    } catch (error) {
      const current =
        (await this.client.conversations.getMessageById(messageId)) ?? optimistic
      if (current.deliveryStatus === DeliveryStatus.Published) {
        return {
          error: null,
          message: toRequiredMessageItem(current, this.inboxId),
        }
      }

      return {
        error: readableError(error),
        message: {
          ...toRequiredMessageItem(current, this.inboxId),
          delivery: 'failed',
        },
      }
    }
  }

  async retryMessage(conversationId: string, messageId: string): Promise<SendResult> {
    const conversation = await this.getConversation(conversationId)
    const existing = await this.client.conversations.getMessageById(messageId)

    if (!existing) throw new Error('The local XMTP draft is no longer available.')
    if (existing.deliveryStatus === DeliveryStatus.Published) {
      return {
        error: null,
        message: toRequiredMessageItem(existing, this.inboxId),
      }
    }
    if (existing.deliveryStatus === DeliveryStatus.Failed) {
      return {
        error: 'XMTP marked this draft as permanently failed. Copy its text into a new message to try again.',
        message: toRequiredMessageItem(existing, this.inboxId),
      }
    }

    try {
      await conversation.publishMessages()
      const published = await this.client.conversations.getMessageById(messageId)
      if (!published || published.deliveryStatus !== DeliveryStatus.Published) {
        throw new Error('XMTP did not confirm that the message was published.')
      }

      return {
        error: null,
        message: toRequiredMessageItem(published, this.inboxId),
      }
    } catch (error) {
      const current = await this.client.conversations.getMessageById(messageId)
      if (!current) throw error
      if (current.deliveryStatus === DeliveryStatus.Published) {
        return {
          error: null,
          message: toRequiredMessageItem(current, this.inboxId),
        }
      }

      return {
        error: readableError(error),
        message: {
          ...toRequiredMessageItem(current, this.inboxId),
          delivery: 'failed',
        },
      }
    }
  }

  async startMessageStream(
    onMessage: (message: MessageItem) => void,
    onHealth: (health: StreamHealth) => void,
    onInboxChanged: () => void = () => undefined,
  ): Promise<void> {
    if (
      this.#messageStream && !this.#messageStream.isDone &&
      this.#groupStream && !this.#groupStream.isDone
    ) {
      onHealth(this.#combinedStreamHealth())
      return
    }
    if (this.#messageStream?.isDone) this.#messageStream = null
    if (this.#groupStream?.isDone) this.#groupStream = null
    if (this.#messageStream && !this.#messageStream.isDone) {
      await this.#messageStream.end()
      this.#messageStream = null
    }
    if (this.#groupStream && !this.#groupStream.isDone) {
      await this.#groupStream.end()
      this.#groupStream = null
    }
    if (this.#messageStreamStart) {
      await this.#messageStreamStart
      return this.startMessageStream(onMessage, onHealth, onInboxChanged)
    }

    const generation = ++this.#streamGeneration
    const start = this.#openMessageStream(
      generation,
      onMessage,
      onHealth,
      onInboxChanged,
    )
    this.#messageStreamStart = start
    try {
      await start
    } finally {
      if (this.#messageStreamStart === start) this.#messageStreamStart = null
    }
  }

  async #openMessageStream(
    generation: number,
    onMessage: (message: MessageItem) => void,
    onHealth: (health: StreamHealth) => void,
    onInboxChanged: () => void,
  ): Promise<void> {
    type StreamKind = 'messages' | 'groups'
    const startupDegraded = new Set<StreamKind>()
    this.#messageStreamHealth = 'retrying'
    this.#groupStreamHealth = 'retrying'
    const setStreamHealth = (
      kind: StreamKind,
      health: Extract<StreamHealth, 'live' | 'retrying'>,
    ) => {
      if (generation !== this.#streamGeneration) return
      if (kind === 'messages') this.#messageStreamHealth = health
      else this.#groupStreamHealth = health
      onHealth(this.#combinedStreamHealth())
    }
    const streamOptions = (kind: StreamKind) => {
      const onDegraded = () => {
        startupDegraded.add(kind)
        setStreamHealth(kind, 'retrying')
      }
      return {
        onError: onDegraded,
        onFail: onDegraded,
        onRestart: () => {
          startupDegraded.delete(kind)
          setStreamHealth(kind, 'live')
        },
        onRetry: onDegraded,
        retryAttempts: 6,
        retryDelay: 10_000,
        retryOnFail: true,
      }
    }
    const stream = await this.client.conversations.streamAllMessages({
      consentStates: [ConsentState.Allowed, ConsentState.Unknown],
      ...streamOptions('messages'),
      onValue: (message) => {
        if (generation !== this.#streamGeneration) return

        if (isConvosControlMessage(message)) {
          this.#recoveredConvosRequests = null
          onInboxChanged()
          return
        }

        void this.#emitAllowedStreamMessage(
          message,
          generation,
          onMessage,
        ).catch(() => undefined)
      },
    })
    let groupStream: AsyncStreamProxy<AppGroup>
    try {
      groupStream = await this.client.conversations.streamGroups({
        ...streamOptions('groups'),
        onValue: () => {
          if (generation !== this.#streamGeneration) return
          void this.#reconcileConvosGroups(false, true).then(() => {
            if (generation === this.#streamGeneration) onInboxChanged()
          }).catch(() => undefined)
        },
      }) as AsyncStreamProxy<AppGroup>
    } catch (error) {
      if (!stream.isDone) await stream.end().catch(() => undefined)
      throw error
    }
    if (generation !== this.#streamGeneration) {
      if (!stream.isDone) await stream.end()
      if (!groupStream.isDone) await groupStream.end()
      return
    }
    this.#messageStream = stream
    this.#groupStream = groupStream
    if (!startupDegraded.has('messages')) this.#messageStreamHealth = 'live'
    if (!startupDegraded.has('groups')) this.#groupStreamHealth = 'live'
    onHealth(this.#combinedStreamHealth())
  }

  #combinedStreamHealth(): Extract<StreamHealth, 'live' | 'retrying'> {
    return this.#messageStreamHealth === 'live' && this.#groupStreamHealth === 'live'
      ? 'live'
      : 'retrying'
  }

  async #emitAllowedStreamMessage(
    message: IncomingMessage,
    generation: number,
    onMessage: (message: MessageItem) => void,
  ) {
    const conversation = await this.client.conversations.getConversationById(
      message.conversationId,
    )
    if (!conversation || await conversation.consentState() !== ConsentState.Allowed) return
    if (conversation instanceof Group) {
      if (!this.#trustedConvosGroups.has(conversation.id)) {
        await this.#reconcileConvosGroups(false, false)
      }
      if (!this.#trustedConvosGroups.has(conversation.id)) return
    }
    if (generation !== this.#streamGeneration) return

    if (isReaction(message)) {
      if (!message.content) return
      const reference = message.content.reference
      const refreshVersion = (this.#reactionRefreshVersions.get(reference) ?? 0) + 1
      this.#reactionRefreshVersions.set(reference, refreshVersion)
      await this.#emitReactionParent(
        reference,
        refreshVersion,
        generation,
        onMessage,
      )
      return
    }

    const item = toMessageItem(message, this.inboxId)
    if (item) onMessage(item)
  }

  async #emitReactionParent(
    reference: string,
    refreshVersion: number,
    generation: number,
    onMessage: (message: MessageItem) => void,
  ): Promise<void> {
    try {
      const parent = await this.client.conversations.getMessageById(reference)
      if (
        generation !== this.#streamGeneration ||
        this.#reactionRefreshVersions.get(reference) !== refreshVersion ||
        !parent
      ) return
      const updated = toMessageItem(parent, this.inboxId)
      if (updated) onMessage(updated)
    } finally {
      if (this.#reactionRefreshVersions.get(reference) === refreshVersion) {
        this.#reactionRefreshVersions.delete(reference)
      }
    }
  }

  async close(): Promise<void> {
    this.#streamGeneration += 1
    this.#reactionRefreshVersions.clear()
    const stream = this.#messageStream
    const groupStream = this.#groupStream
    this.#messageStream = null
    this.#groupStream = null
    this.#messageStreamHealth = 'retrying'
    this.#groupStreamHealth = 'retrying'
    const starting = this.#messageStreamStart
    this.#messageStreamStart = null
    // A start can be waiting indefinitely for the SDK's pre-stream sync. Do
    // not hold the origin-wide OPFS lease hostage to that promise. Closing the
    // client terminates its Worker; the generation guard suppresses any late
    // callbacks, and a late returned proxy is ended by #openMessageStream.
    if (starting) void starting.catch(() => undefined)
    try {
      if (stream && !stream.isDone) void stream.end().catch(() => undefined)
      if (groupStream && !groupStream.isDone) {
        void groupStream.end().catch(() => undefined)
      }
    } finally {
      // Worker termination, not successful stream cleanup, is the boundary
      // that makes it safe for the caller to release the origin-wide lease.
      this.client.close()
    }
  }

  async #reconcileConvosGroups(
    syncGroups: boolean,
    promoteUnknown: boolean,
  ): Promise<void> {
    const previous = this.#convosReconcile ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(() => this.#performConvosReconciliation(syncGroups, promoteUnknown))
    this.#convosReconcile = current
    try {
      await current
    } finally {
      if (this.#convosReconcile === current) this.#convosReconcile = null
    }
  }

  async #performConvosReconciliation(
    syncGroups: boolean,
    promoteUnknown: boolean,
  ) {
    const requests = await this.#recoverConvosRequests(syncGroups)
    const groups = await this.client.conversations.listGroups({
      consentStates: [ConsentState.Allowed, ConsentState.Unknown],
      limit: CONVOS_TRANSPORT_DM_LIMIT,
      orderBy: ListConversationsOrderBy.LastActivity,
    }) as AppGroup[]
    const trusted = new Map<string, TrustedConvosGroup>()

    for (const group of groups) {
      if (syncGroups) {
        try {
          await group.sync()
        } catch {
          continue
        }
      }

      let consent: ConsentState
      try {
        consent = await group.consentState()
      } catch {
        continue
      }
      if (consent !== ConsentState.Allowed && consent !== ConsentState.Unknown) continue

      const appData = parseConvosGroupAppData(group.appData ?? '')
      if (!appData) continue

      let active: boolean
      let memberInboxIds: string[]
      try {
        active = await group.isActive()
        memberInboxIds = (await group.members()).map((member) => member.inboxId.toLowerCase())
      } catch {
        continue
      }
      if (!active || !memberInboxIds.includes(this.inboxId.toLowerCase())) continue

      const addedByInboxId = group.addedByInboxId?.toLowerCase() ?? ''
      if (!addedByInboxId) continue
      const matchingRequest = requests.find((request) => (
        request.invite.tag === appData.tag &&
        request.invite.creatorInboxId.toLowerCase() === addedByInboxId
      )) ?? null

      if (consent === ConsentState.Unknown) {
        if (!matchingRequest || !promoteUnknown) continue
        try {
          await group.updateConsentState(ConsentState.Allowed)
          consent = await group.consentState()
        } catch {
          continue
        }
        if (consent !== ConsentState.Allowed) continue
      }

      trusted.set(group.id, {
        creatorInboxId: addedByInboxId,
        emoji: boundedGroupEmoji(appData.emoji),
        group,
        invite: matchingRequest?.invite ?? null,
        title: boundedGroupTitle(group.name),
      })
    }

    this.#trustedConvosGroups = trusted
    const snapshotRequest = requests[0] ?? null
    this.#convosAccessSnapshot = recoveredConvosSnapshot(
      snapshotRequest,
      trusted,
    )
    this.#convosAccessSnapshotSentAtNs = snapshotRequest?.sentAtNs ?? null
  }

  async #recoverConvosRequests(syncTransportDms: boolean): Promise<RecoveredConvosRequest[]> {
    if (!syncTransportDms && this.#recoveredConvosRequests !== null) {
      return this.#recoveredConvosRequests
    }
    const dms = await this.client.conversations.listDms({
      consentStates: [ConsentState.Allowed, ConsentState.Unknown],
      includeDuplicateDms: false,
      limit: CONVOS_TRANSPORT_DM_LIMIT,
      orderBy: ListConversationsOrderBy.LastActivity,
    }) as AppDm[]
    const candidates: Array<{
      controls: IncomingMessage[]
      dm: AppDm
      message: IncomingMessage
      peerInboxId: string
    }> = []

    for (const dm of dms) {
      let peerInboxId: string
      let messages: IncomingMessage[]
      try {
        if (syncTransportDms) await dm.sync()
        peerInboxId = (await dm.peerInboxId()).toLowerCase()
        messages = await dm.messages({
          direction: SortDirection.Descending,
          excludeContentTypes: NON_TIMELINE_CONTENT_TYPES,
          kind: GroupMessageKind.Application,
          limit: CONVOS_TRANSPORT_MESSAGE_LIMIT,
        }) as IncomingMessage[]
      } catch {
        continue
      }

      const controls = messages.filter(isConvosStatusControl)
      for (const message of messages) {
        if (
          candidates.length >= CONVOS_REQUEST_LIMIT ||
          this.#dismissedConvosRequestIds.has(message.id) ||
          (
            this.#dismissedConvosRequestCutoffNs !== null &&
            message.sentAtNs <= this.#dismissedConvosRequestCutoffNs
          ) ||
          message.senderInboxId.toLowerCase() !== this.inboxId.toLowerCase() ||
          !isConvosJoinRequest(message) ||
          !isConvosJoinRequestContent(message.content)
        ) continue

        candidates.push({ controls, dm, message, peerInboxId })
      }
    }

    if (!candidates.length) {
      this.#recoveredConvosRequests = []
      return this.#recoveredConvosRequests
    }
    const recovered: RecoveredConvosRequest[] = []
    let parseConvosInvite: typeof import('../convos/invite')['parseConvosInvite']
    try {
      ({ parseConvosInvite } = await import('../convos/invite'))
    } catch {
      // A first offline visit may not have the parser chunk cached yet. Keep
      // the ordinary local inbox readable and retry recovery on an online sync.
      this.#recoveredConvosRequests = []
      return this.#recoveredConvosRequests
    }
    for (const { controls, dm, message, peerInboxId } of candidates) {
      if (!isConvosJoinRequestContent(message.content)) continue
      let invite: ParsedConvosInvite
      try {
        invite = parseConvosInvite(message.content.inviteSlug, { allowExpired: true })
      } catch {
        continue
      }
      if (invite.creatorInboxId.toLowerCase() !== peerInboxId) continue
      recovered.push({
        conversationId: dm.id,
        controls,
        invite,
        messageId: message.id,
        sentAtNs: message.sentAtNs,
      })
    }

    this.#recoveredConvosRequests = recovered
      .sort((left, right) => left.sentAtNs > right.sentAtNs
        ? -1
        : left.sentAtNs < right.sentAtNs ? 1 : left.messageId.localeCompare(right.messageId))
      .slice(0, CONVOS_REQUEST_LIMIT)
    return this.#recoveredConvosRequests
  }

  private async getConversation(conversationId: string): Promise<AppConversation> {
    const conversation = await this.client.conversations.getConversationById(conversationId)
    if (conversation instanceof Dm) {
      if (await conversation.consentState() !== ConsentState.Allowed) {
        throw new Error('The selected XMTP direct message is not allowed.')
      }
      return conversation as AppDm
    }
    if (conversation instanceof Group) {
      if (!this.#trustedConvosGroups.has(conversation.id)) {
        await this.#reconcileConvosGroups(false, false)
      }
      if (!this.#trustedConvosGroups.has(conversation.id)) {
        throw new Error('This Convos group has not been verified for this inbox.')
      }
      return conversation as AppGroup
    }
    throw new Error('The selected XMTP conversation is unavailable.')
  }

  private async latestDisplayableMessage(
    conversation: AppConversation,
  ): Promise<LatestDisplayableMessage> {
    const [latestCandidate] = await conversation.messages({
      direction: SortDirection.Descending,
      excludeContentTypes: NON_TIMELINE_CONTENT_TYPES,
      kind: GroupMessageKind.Application,
      limit: 1n,
    })
    if (!latestCandidate || displayContentFor(latestCandidate) !== null) {
      return {
        hideConversation: false,
        hiddenActivityAt: null,
        message: latestCandidate,
      }
    }

    const messages = await conversation.messages({
      direction: SortDirection.Descending,
      excludeContentTypes: NON_TIMELINE_CONTENT_TYPES,
      kind: GroupMessageKind.Application,
      limit: INBOX_PREVIEW_SCAN_SIZE,
    })
    const message = messages.find((candidate) => displayContentFor(candidate) !== null)
    return {
      hideConversation:
        !message &&
        messages.length < Number(INBOX_PREVIEW_SCAN_SIZE) &&
        messages.length > 0 &&
        messages.every(isConvosControlMessage),
      hiddenActivityAt: latestCandidate.sentAt,
      message,
    }
  }

  private async messageWindow(
    conversation: AppConversation,
    requestedLimit: number,
  ): Promise<Pick<ConversationLoad, 'hasOlder' | 'messages' | 'scannedMessageCount'>> {
    const messageLimit = BigInt(normalizeMessageLimit(requestedLimit))
    const messages = await conversation.messages({
      direction: SortDirection.Descending,
      excludeContentTypes: NON_TIMELINE_CONTENT_TYPES,
      kind: GroupMessageKind.Application,
      limit: messageLimit + 1n,
    })
    const rawPage = messages.slice(0, Number(messageLimit))
    const displayable = rawPage
      .map((message) => toMessageItem(message, this.inboxId, true))
      .filter((message): message is MessageItem => message !== null)

    return {
      hasOlder: messages.length > Number(messageLimit),
      messages: displayable.reverse(),
      scannedMessageCount: rawPage.length,
    }
  }
}

async function withInitializationTimeout(
  clientPromise: Promise<AppClient>,
): Promise<AppClient> {
  let timeoutId: number | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new XmtpClientInitializationTimeoutError())
    }, CLIENT_INITIALIZATION_TIMEOUT_MS)
  })

  try {
    return await Promise.race([clientPromise, timeout])
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}

function normalizeMessageLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('XMTP message window size must be a non-negative safe integer.')
  }
  return Math.max(Number(MESSAGE_PAGE_SIZE), limit)
}

export function xmtpClientOptions(
  env: XmtpEnv,
  configuredGatewayHost?: string,
): {
  appVersion: string
  env: XmtpEnv
  gatewayHost?: string
  loggingLevel: LogLevel
} {
  const gatewayHost = configuredGatewayHost?.trim()
  if (GATEWAY_REQUIRED_ENVS.includes(env) && !gatewayHost) {
    throw new XmtpGatewayConfigurationError(env)
  }

  return {
    appVersion: 'converge-miniapp/0.1.0',
    env,
    loggingLevel: LogLevel.Off,
    ...(gatewayHost ? { gatewayHost } : {}),
  }
}

function clientOptions(): ReturnType<typeof xmtpClientOptions> {
  return xmtpClientOptions(
    configuredEnvironment(),
    import.meta.env.VITE_XMTP_GATEWAY_HOST,
  )
}

function configuredEnvironment(): XmtpEnv {
  const configured = import.meta.env.VITE_XMTP_ENV?.trim()
  if (configured && SUPPORTED_ENVS.includes(configured as XmtpEnv)) {
    return configured as XmtpEnv
  }
  return import.meta.env.PROD ? 'production' : 'dev'
}

function displayAddress(state: InboxState | undefined): string | null {
  if (!state) return null
  const ethereumIdentifiers = state.accountIdentifiers.filter(
    (identifier) => identifier.identifierKind === IdentifierKind.Ethereum,
  )
  if (!ethereumIdentifiers.length) return null
  if (ethereumIdentifiers.length === 1) return ethereumIdentifiers[0]?.identifier ?? null

  // A DM identifies an XMTP inbox, not the particular linked wallet that sent
  // each message. Prefer the inbox's stable recovery identity when it is an
  // Ethereum address; otherwise use a deterministic linked-address fallback.
  if (state.recoveryIdentifier.identifierKind === IdentifierKind.Ethereum) {
    const recoveryAddress = state.recoveryIdentifier.identifier.toLowerCase()
    const linkedRecovery = ethereumIdentifiers.find(
      (identifier) => identifier.identifier.toLowerCase() === recoveryAddress,
    )
    if (linkedRecovery) return linkedRecovery.identifier
  }

  return [...ethereumIdentifiers].sort((left, right) => (
    left.identifier.toLowerCase().localeCompare(right.identifier.toLowerCase())
  ))[0]?.identifier ?? null
}

function compareConversationActivity(
  left: ConversationSummary,
  right: ConversationSummary,
): number {
  if (!left.updatedAt) return right.updatedAt ? 1 : 0
  if (!right.updatedAt) return -1
  return right.updatedAt.getTime() - left.updatedAt.getTime()
}

function recoveredConvosSnapshot(
  request: RecoveredConvosRequest | null,
  trustedGroups: Map<string, TrustedConvosGroup>,
): ConvosAccessSnapshot | null {
  if (!request) return null
  const joined = [...trustedGroups.entries()].find(([, trusted]) => (
    trusted.invite?.slug === request.invite.slug
  ))
  if (joined) {
    return {
      conversationId: request.conversationId,
      error: null,
      groupId: joined[0],
      invite: request.invite,
      messageId: request.messageId,
      retryMode: 'none',
      status: 'joined',
    }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (
    request.invite.conversationExpiresAtUnix !== undefined &&
    request.invite.conversationExpiresAtUnix <= nowSeconds
  ) {
    return {
      conversationId: request.conversationId,
      error: 'That Convos conversation has expired.',
      groupId: null,
      invite: request.invite,
      messageId: request.messageId,
      retryMode: 'reset',
      status: 'failed',
    }
  }
  if (
    request.invite.expiresAtUnix !== undefined &&
    request.invite.expiresAtUnix <= nowSeconds
  ) {
    return {
      conversationId: request.conversationId,
      error: 'That Convos invite has expired.',
      groupId: null,
      invite: request.invite,
      messageId: request.messageId,
      retryMode: 'reset',
      status: 'failed',
    }
  }

  const creatorInboxId = request.invite.creatorInboxId.toLowerCase()
  const control = request.controls
    .filter((message) => (
      message.sentAtNs >= request.sentAtNs &&
      message.senderInboxId.toLowerCase() === creatorInboxId &&
      isConvosStatusControl(message) &&
      isMatchingConvosControl(message.content, request.invite.tag)
    ))
    .sort((left, right) => left.sentAtNs > right.sentAtNs
      ? -1
      : left.sentAtNs < right.sentAtNs ? 1 : left.id.localeCompare(right.id))[0]

  if (control && isConvosInviteJoinErrorContent(control.content)) {
    return {
      conversationId: request.conversationId,
      error: convosJoinErrorMessage(control.content),
      groupId: null,
      invite: request.invite,
      messageId: request.messageId,
      retryMode: control.content.errorType === 'generic_failure' ? 'fresh' : 'reset',
      status: 'failed',
    }
  }
  if (control && isConvosInviteJoinHandledContent(control.content)) {
    return {
      conversationId: request.conversationId,
      error: null,
      groupId: null,
      invite: request.invite,
      messageId: request.messageId,
      retryMode: 'none',
      status: 'handled',
    }
  }

  return {
    conversationId: request.conversationId,
    error: null,
    groupId: null,
    invite: request.invite,
    messageId: request.messageId,
    retryMode: 'none',
    status: 'waiting',
  }
}

function boundedGroupTitle(value: string | undefined) {
  return value
    ? sanitizeConvosPreviewText(value, 80) ?? 'Convos conversation'
    : 'Convos conversation'
}

function boundedGroupEmoji(value: string | null) {
  return value ? sanitizeConvosPreviewText(value, 8, true) ?? null : null
}

function ethereumIdentifier(address: `0x${string}`): Identifier {
  return {
    identifier: address.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  }
}

function previewFor(message: DecodedMessage | undefined): string | null {
  if (!message) return null
  return displayContentFor(message)?.text ?? null
}

function toMessageItem(
  message: DecodedMessage,
  ownInboxId: string,
  recoverUnpublished = false,
): MessageItem | null {
  const display = displayContentFor(message)
  if (!display) return null
  const reactions = reactionsFor(message)

  return {
    canRetry: message.deliveryStatus === DeliveryStatus.Unpublished,
    conversationId: message.conversationId,
    delivery: deliveryFor(message.deliveryStatus, recoverUnpublished),
    id: message.id,
    isOwn: message.senderInboxId === ownInboxId,
    ...(reactions.length ? { reactions } : {}),
    ...(display.replyTo ? { replyTo: display.replyTo } : {}),
    sentAt: message.sentAt,
    sentAtNs: message.sentAtNs,
    senderInboxId: message.senderInboxId,
    text: display.text,
    unsupported: display.unsupported,
  }
}

function toRequiredMessageItem(
  message: DecodedMessage,
  ownInboxId: string,
  recoverUnpublished = false,
): MessageItem {
  const item = toMessageItem(message, ownInboxId, recoverUnpublished)
  if (!item) throw new Error('XMTP returned a text message without displayable content.')
  return item
}

type DisplayContent = {
  replyTo?: string
  text: string
  unsupported: boolean
}

function displayContentFor(message: DecodedMessage): DisplayContent | null {
  if (isConvosControlMessage(message)) return null

  if (isText(message) || isMarkdown(message)) {
    return typeof message.content === 'string'
      ? { text: message.content, unsupported: false }
      : fallbackContent(message)
  }

  if (isTextReply(message)) {
    const content = message.content
    if (!content) return fallbackContent(message)
    const replyTo = compactPreview(previewFor(content.inReplyTo ?? undefined))
    return {
      ...(replyTo ? { replyTo } : {}),
      text: content.content,
      unsupported: false,
    }
  }

  if (
    isReaction(message) ||
    isReadReceipt(message) ||
    isGroupUpdated(message) ||
    isLeaveRequest(message)
  ) return null

  if (isAttachment(message)) {
    const content = message.content
    if (!content) return fallbackContent(message)
    return {
      text: attachmentLabel(content.filename, content.mimeType),
      unsupported: false,
    }
  }

  if (isRemoteAttachment(message)) {
    const content = message.content
    if (!content) return fallbackContent(message)
    return {
      text: attachmentLabel(content.filename),
      unsupported: false,
    }
  }

  if (isMultiRemoteAttachment(message)) {
    const content = message.content
    if (!content) return fallbackContent(message)
    const count = content.attachments.length
    return {
      text: count === 1 ? '1 attachment' : `${count} attachments`,
      unsupported: false,
    }
  }

  if (isTransactionReference(message)) {
    const content = message.content
    if (!content) return fallbackContent(message)
    return {
      text: `Transaction on ${content.networkId}: ${shortValue(content.reference)}`,
      unsupported: false,
    }
  }

  if (isWalletSendCalls(message)) {
    const content = message.content
    if (!content) return fallbackContent(message)
    return {
      text: `Transaction request on ${content.chainId}`,
      unsupported: false,
    }
  }

  if (isReply(message) || isActions(message) || isIntent(message)) {
    return fallbackContent(message)
  }

  return fallbackContent(message)
}

function isConvosJoinRequest(message: DecodedMessage) {
  return isConvosContentType(message, 'join_request')
}

function isConvosJoinRequestContent(value: unknown): value is ConvosJoinRequest {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'inviteSlug' in value &&
    typeof value.inviteSlug === 'string',
  )
}

function isConvosInviteJoinHandledContent(
  value: unknown,
): value is ConvosInviteJoinHandled {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'inviteTag' in value &&
    'handledMessageId' in value &&
    typeof value.inviteTag === 'string' &&
    typeof value.handledMessageId === 'string',
  )
}

function isConvosInviteJoinErrorContent(
  value: unknown,
): value is ConvosInviteJoinError {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'inviteTag' in value &&
    'errorType' in value &&
    typeof value.inviteTag === 'string' &&
    typeof value.errorType === 'string',
  )
}

function isMatchingConvosControl(value: unknown, tag: string) {
  return (
    isConvosInviteJoinHandledContent(value) ||
    isConvosInviteJoinErrorContent(value)
  ) && value.inviteTag === tag
}

function isConvosStatusControl(message: DecodedMessage) {
  return isConvosContentType(message, 'invite_join_error') ||
    isConvosContentType(message, 'invite_join_handled')
}

function isConvosControlMessage(message: DecodedMessage) {
  return isConvosJoinRequest(message) ||
    isConvosContentType(message, 'invite_join_error') ||
    isConvosContentType(message, 'invite_join_handled')
}

function isConvosContentType(message: DecodedMessage, typeId: string) {
  return message.contentType.authorityId === 'convos.org' &&
    message.contentType.typeId === typeId &&
    message.contentType.versionMajor === 1 &&
    message.contentType.versionMinor === 0
}

function fallbackContent(message: DecodedMessage): DisplayContent | null {
  const fallback = message.fallback?.trim()
  return fallback ? { text: fallback, unsupported: true } : null
}

function attachmentLabel(filename?: string, mimeType?: string): string {
  const safeFilename = filename?.trim()
  if (safeFilename) return `Attachment: ${safeFilename}`
  const safeMimeType = mimeType?.trim()
  return safeMimeType ? `Attachment (${safeMimeType})` : 'Attachment'
}

function compactPreview(value: string | null, maxLength = 120): string | undefined {
  if (!value) return undefined
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, maxLength - 1)}…`
}

function shortValue(value: string, left = 10, right = 8): string {
  if (value.length <= left + right + 1) return value
  return `${value.slice(0, left)}…${value.slice(-right)}`
}

function reactionsFor(message: DecodedMessage): NonNullable<MessageItem['reactions']> {
  const active = new Map<string, string>()
  const reactions = [...(message.reactions ?? [])]
    .filter(isReaction)
    .sort((left, right) => left.sentAtNs < right.sentAtNs
      ? -1
      : left.sentAtNs > right.sentAtNs ? 1 : left.id.localeCompare(right.id))

  for (const reaction of reactions) {
    const reactionContent = reaction.content
    if (!reactionContent) continue
    const content = reactionContent.content.trim()
    if (!content || content.length > 64) continue
    const key = `${reaction.senderInboxId}\u0000${content}`
    if (reactionContent.action === ReactionAction.Added) active.set(key, content)
    if (reactionContent.action === ReactionAction.Removed) active.delete(key)
  }

  const counts = new Map<string, number>()
  for (const content of active.values()) {
    counts.set(content, (counts.get(content) ?? 0) + 1)
  }
  return [...counts]
    .map(([content, count]) => ({ content, count }))
    .sort((left, right) => right.count - left.count ||
      left.content.localeCompare(right.content))
    .slice(0, MAX_MESSAGE_REACTIONS)
}

function deliveryFor(
  status: DeliveryStatus,
  recoverUnpublished: boolean,
): MessageItem['delivery'] {
  switch (status) {
    case DeliveryStatus.Unpublished:
      return recoverUnpublished ? 'failed' : 'sending'
    case DeliveryStatus.Failed:
      return 'failed'
    case DeliveryStatus.Published:
      return 'sent'
  }
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'XMTP could not publish the message.'
}
