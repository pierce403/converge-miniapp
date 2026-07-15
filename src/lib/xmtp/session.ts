import {
  Client,
  ConsentState,
  DeliveryStatus,
  Dm,
  GroupMessageKind,
  IdentifierKind,
  ListConversationsOrderBy,
  LogLevel,
  SortDirection,
  type AsyncStreamProxy,
  type DecodedMessage,
  type Identifier,
  type Signer,
  type XmtpEnv,
} from '@xmtp/browser-sdk'

import type {
  ActiveConversation,
  ConversationSummary,
  MessageItem,
  StreamHealth,
} from '../../features/messaging/types'

const VISIBLE_CONSENT_STATES = [ConsentState.Allowed]
const INBOX_LIMIT = 50n
const MESSAGE_PAGE_SIZE = 50n
const CLIENT_INITIALIZATION_TIMEOUT_MS = 30_000
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
        state.accountIdentifiers.find(
          (identifier) => identifier.identifierKind === IdentifierKind.Ethereum,
        )?.identifier ?? null,
      ]),
    )

    return Promise.all(
      conversations.map(async (conversation, index) => {
        const peerInboxId = peerInboxIds[index]
        if (!peerInboxId) throw new Error('XMTP returned a DM without a peer inbox.')
        const lastMessage = await conversation.lastMessage()

        return {
          id: conversation.id,
          isOwnLastMessage: lastMessage?.senderInboxId === this.inboxId,
          peerAddress: addresses.get(peerInboxId) ?? null,
          peerInboxId,
          preview: previewFor(lastMessage),
          updatedAt: lastMessage?.sentAt ?? conversation.createdAt ?? null,
        }
      }),
    )
  }

  async loadConversation(
    conversationId: string,
    onCached?: (loaded: ConversationLoad) => void,
    messageLimit = Number(MESSAGE_PAGE_SIZE),
  ): Promise<ConversationLoad> {
    const conversation = await this.getDm(conversationId)
    const peerInboxId = await conversation.peerInboxId()
    const [state] = await this.client.preferences.getInboxStates([peerInboxId])
    const peerAddress =
      state?.accountIdentifiers.find(
        (identifier) => identifier.identifierKind === IdentifierKind.Ethereum,
      )?.identifier ?? null

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
    loadedMessageCount: number,
  ): Promise<Pick<ConversationLoad, 'hasOlder' | 'messages'>> {
    return this.messageWindow(
      await this.getDm(conversationId),
      normalizeMessageLimit(loadedMessageCount) + Number(MESSAGE_PAGE_SIZE),
    )
  }

  async createDm(address: `0x${string}`): Promise<ActiveConversation> {
    const identifier = ethereumIdentifier(address)
    const reachability = await this.client.canMessage([identifier])
    if (!reachability.get(address.toLowerCase())) {
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

  async sendText(
    conversationId: string,
    text: string,
    onOptimistic?: (message: MessageItem) => void,
  ): Promise<SendResult> {
    const conversation = await this.getDm(conversationId)
    const messageId = await conversation.sendText(text, true)
    const optimistic = await this.client.conversations.getMessageById(messageId)

    if (!optimistic) throw new Error('XMTP did not persist the outgoing message.')
    onOptimistic?.(toMessageItem(optimistic, this.inboxId))

    try {
      await conversation.publishMessages()
      const published = await this.client.conversations.getMessageById(messageId)

      if (!published || published.deliveryStatus !== DeliveryStatus.Published) {
        throw new Error('XMTP did not confirm that the message was published.')
      }

      return {
        error: null,
        message: toMessageItem(published, this.inboxId),
      }
    } catch (error) {
      const current =
        (await this.client.conversations.getMessageById(messageId)) ?? optimistic
      if (current.deliveryStatus === DeliveryStatus.Published) {
        return {
          error: null,
          message: toMessageItem(current, this.inboxId),
        }
      }

      return {
        error: readableError(error),
        message: {
          ...toMessageItem(current, this.inboxId),
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
        message: toMessageItem(existing, this.inboxId),
      }
    }
    if (existing.deliveryStatus === DeliveryStatus.Failed) {
      return {
        error: 'XMTP marked this draft as permanently failed. Copy its text into a new message to try again.',
        message: toMessageItem(existing, this.inboxId),
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
        message: toMessageItem(published, this.inboxId),
      }
    } catch (error) {
      const current = await this.client.conversations.getMessageById(messageId)
      if (!current) throw error
      if (current.deliveryStatus === DeliveryStatus.Published) {
        return {
          error: null,
          message: toMessageItem(current, this.inboxId),
        }
      }

      return {
        error: readableError(error),
        message: {
          ...toMessageItem(current, this.inboxId),
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
        if (generation === this.#streamGeneration) {
          onMessage(toMessageItem(message, this.inboxId))
        }
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

  async close(): Promise<void> {
    this.#streamGeneration += 1
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

  private async messageWindow(
    conversation: Dm,
    requestedLimit: number,
  ): Promise<Pick<ConversationLoad, 'hasOlder' | 'messages'>> {
    const messageLimit = BigInt(normalizeMessageLimit(requestedLimit))
    const messages = await conversation.messages({
      direction: SortDirection.Descending,
      kind: GroupMessageKind.Application,
      limit: messageLimit + 1n,
    })
    const page = messages.slice(0, Number(messageLimit))

    return {
      hasOlder: messages.length > Number(messageLimit),
      messages: page
        .reverse()
        .map((message) => toMessageItem(message, this.inboxId, true)),
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

function ethereumIdentifier(address: `0x${string}`): Identifier {
  return {
    identifier: address.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  }
}

function previewFor(message: DecodedMessage | undefined): string {
  if (!message) return 'No messages yet'
  if (typeof message.content === 'string') return message.content
  return message.fallback?.trim() || 'Unsupported message'
}

function toMessageItem(
  message: DecodedMessage,
  ownInboxId: string,
  recoverUnpublished = false,
): MessageItem {
  const content = message.content
  const supported = typeof content === 'string'

  return {
    canRetry: message.deliveryStatus === DeliveryStatus.Unpublished,
    conversationId: message.conversationId,
    delivery: deliveryFor(message.deliveryStatus, recoverUnpublished),
    id: message.id,
    isOwn: message.senderInboxId === ownInboxId,
    sentAt: message.sentAt,
    sentAtNs: message.sentAtNs,
    text: supported
      ? content
      : message.fallback?.trim() || 'This message type is not supported yet.',
    unsupported: !supported,
  }
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
