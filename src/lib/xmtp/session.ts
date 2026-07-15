import {
  Client,
  ConsentState,
  ContentType,
  DeliveryStatus,
  Dm,
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
  type DecodedMessage,
  type Identifier,
  type InboxState,
  type Signer,
  type XmtpEnv,
} from '@xmtp/browser-sdk'

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

type LatestDisplayableMessage = {
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

type IncomingMessage = DecodedMessage

export type SendResult = {
  error: string | null
  message: MessageItem
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

export class XmtpGatewayConfigurationError extends Error {
  constructor(environment: XmtpEnv) {
    super(`XMTP ${environment} requires an authenticated payer Gateway.`)
    this.name = 'XmtpGatewayConfigurationError'
  }
}

export class XmtpMessagingSession {
  readonly address: `0x${string}`
  readonly client: Client
  readonly isNewInstallation: boolean
  #messageStream: AsyncStreamProxy<IncomingMessage> | null = null
  #messageStreamStart: Promise<void> | null = null
  #reactionRefreshVersions = new Map<string, number>()
  #streamGeneration = 0

  private constructor(
    client: Client,
    address: `0x${string}`,
    isNewInstallation: boolean,
  ) {
    this.client = client
    this.address = address
    this.isNewInstallation = isNewInstallation
  }

  static async create(signer: Signer, address: `0x${string}`) {
    const options = clientOptions()
    let client: Client
    let clientPromise: Promise<Client> | null = null

    try {
      clientPromise = Client.create(signer, {
        ...options,
        disableAutoRegister: true,
      })
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

  async inspectIdentityRelationship(
    address: `0x${string}`,
  ): Promise<XmtpIdentityRelationship> {
    if (address.toLowerCase() === this.address.toLowerCase()) {
      return 'active-address'
    }

    const targetInboxId = await this.client.fetchInboxIdByIdentifier(
      ethereumIdentifier(address),
    )
    if (!targetInboxId) return 'no-inbox'
    return targetInboxId === this.inboxId ? 'same-inbox' : 'different-inbox'
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
    await this.client.conversations.syncAll(VISIBLE_CONSENT_STATES)

    return this.readInbox()
  }

  async readInbox(): Promise<ConversationSummary[]> {
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
        const lastMessage = latest.message

        return {
          id: conversation.id,
          isOwnLastMessage: lastMessage?.senderInboxId === this.inboxId,
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

    return summaries.sort(compareConversationActivity)
  }

  async loadConversation(
    conversationId: string,
    onCached?: (loaded: ConversationLoad) => void,
    messageLimit = Number(MESSAGE_PAGE_SIZE),
  ): Promise<ConversationLoad> {
    const conversation = await this.getDm(conversationId)
    const peerInboxId = await conversation.peerInboxId()
    const [state] = await this.client.preferences.getInboxStates([peerInboxId])
    const peerAddress = displayAddress(state)

    const activeConversation = {
      id: conversation.id,
      peerAddress,
      peerInboxId,
    }
    const cached = await this.messageWindow(conversation, messageLimit)
    onCached?.({ conversation: activeConversation, ...cached })

    await conversation.sync()
    return {
      conversation: activeConversation,
      ...(await this.messageWindow(conversation, messageLimit)),
    }
  }

  async loadOlderMessages(
    conversationId: string,
    scannedMessageCount: number,
  ): Promise<Pick<ConversationLoad, 'hasOlder' | 'messages' | 'scannedMessageCount'>> {
    return this.messageWindow(
      await this.getDm(conversationId),
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

  async sendText(
    conversationId: string,
    text: string,
    onOptimistic?: (message: MessageItem) => void,
  ): Promise<SendResult> {
    const conversation = await this.getDm(conversationId)
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
    const conversation = await this.getDm(conversationId)
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
  ): Promise<void> {
    if (this.#messageStream) return
    if (this.#messageStreamStart) return this.#messageStreamStart

    const generation = ++this.#streamGeneration
    const start = this.#openMessageStream(generation, onMessage, onHealth)
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
  ): Promise<void> {
    let startupDegraded = false
    const stream = await this.client.conversations.streamAllDmMessages({
      consentStates: VISIBLE_CONSENT_STATES,
      onError: () => {
        if (generation !== this.#streamGeneration) return
        startupDegraded = true
        onHealth('retrying')
      },
      onFail: () => {
        if (generation !== this.#streamGeneration) return
        // browser-sdk@7 reports an underlying stream failure here and then
        // retries through the same proxy when retryOnFail is enabled. Retain
        // ownership so a manual refresh cannot create an orphaned duplicate.
        startupDegraded = true
        onHealth('retrying')
      },
      onRestart: () => {
        if (generation === this.#streamGeneration) onHealth('live')
      },
      onRetry: () => {
        if (generation === this.#streamGeneration) onHealth('retrying')
      },
      onValue: (message) => {
        if (generation !== this.#streamGeneration) return

        if (isReaction(message)) {
          if (!message.content) return
          const reference = message.content.reference
          const refreshVersion = (this.#reactionRefreshVersions.get(reference) ?? 0) + 1
          this.#reactionRefreshVersions.set(reference, refreshVersion)
          // Browser SDK v7's onValue callback is synchronous and does not
          // observe returned promises. Keep this callback synchronous and
          // explicitly contain best-effort parent refresh failures (including
          // the expected race with client shutdown).
          void this.#emitReactionParent(
            reference,
            refreshVersion,
            generation,
            onMessage,
          ).catch(() => undefined)
          return
        }

        const item = toMessageItem(message, this.inboxId)
        if (item) onMessage(item)
      },
      retryAttempts: 6,
      retryDelay: 10_000,
      retryOnFail: true,
    })
    if (generation !== this.#streamGeneration) {
      if (!stream.isDone) await stream.end()
      return
    }
    this.#messageStream = stream
    if (!startupDegraded) onHealth('live')
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
    this.#messageStream = null
    const starting = this.#messageStreamStart
    this.#messageStreamStart = null
    // A start can be waiting indefinitely for the SDK's pre-stream sync. Do
    // not hold the origin-wide OPFS lease hostage to that promise. Closing the
    // client terminates its Worker; the generation guard suppresses any late
    // callbacks, and a late returned proxy is ended by #openMessageStream.
    if (starting) void starting.catch(() => undefined)
    try {
      if (stream && !stream.isDone) void stream.end().catch(() => undefined)
    } finally {
      // Worker termination, not successful stream cleanup, is the boundary
      // that makes it safe for the caller to release the origin-wide lease.
      this.client.close()
    }
  }

  private async getDm(conversationId: string): Promise<Dm> {
    const conversation = await this.client.conversations.getConversationById(conversationId)
    if (!(conversation instanceof Dm)) {
      throw new Error('The selected XMTP conversation is not a direct message.')
    }
    return conversation
  }

  private async latestDisplayableMessage(
    conversation: Dm,
  ): Promise<LatestDisplayableMessage> {
    const [latestCandidate] = await conversation.messages({
      direction: SortDirection.Descending,
      excludeContentTypes: NON_TIMELINE_CONTENT_TYPES,
      kind: GroupMessageKind.Application,
      limit: 1n,
    })
    if (!latestCandidate || displayContentFor(latestCandidate) !== null) {
      return { hiddenActivityAt: null, message: latestCandidate }
    }

    const messages = await conversation.messages({
      direction: SortDirection.Descending,
      excludeContentTypes: NON_TIMELINE_CONTENT_TYPES,
      kind: GroupMessageKind.Application,
      limit: INBOX_PREVIEW_SCAN_SIZE,
    })
    return {
      hiddenActivityAt: latestCandidate.sentAt,
      message: messages.find((message) => displayContentFor(message) !== null),
    }
  }

  private async messageWindow(
    conversation: Dm,
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

async function withInitializationTimeout(clientPromise: Promise<Client>): Promise<Client> {
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
