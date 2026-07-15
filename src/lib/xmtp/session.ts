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
const MESSAGE_LIMIT = 50n
const SUPPORTED_ENVS: readonly XmtpEnv[] = [
  'local',
  'dev',
  'production',
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

export class XmtpClientInitializationError extends Error {
  constructor(cause: unknown) {
    super('XMTP could not initialize its local browser client.', { cause })
    this.name = 'XmtpClientInitializationError'
  }
}

export class XmtpMessagingSession {
  readonly address: `0x${string}`
  readonly client: Client
  #messageStream: AsyncStreamProxy<IncomingMessage> | null = null

  private constructor(client: Client, address: `0x${string}`) {
    this.client = client
    this.address = address
  }

  static async create(signer: Signer, address: `0x${string}`) {
    const options = clientOptions()
    let client: Client

    try {
      client = await Client.create(signer, {
        ...options,
        disableAutoRegister: true,
      })
    } catch (error) {
      // browser-sdk@7.0.0 creates its Worker before init and does not expose the
      // Client on rejection, so the caller must require a document restart.
      throw new XmtpClientInitializationError(error)
    }

    try {
      await client.register()
      return new XmtpMessagingSession(client, address)
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

  async loadInbox(): Promise<ConversationSummary[]> {
    await this.client.conversations.syncAll(VISIBLE_CONSENT_STATES)

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

  async loadConversation(conversationId: string): Promise<{
    conversation: ActiveConversation
    messages: MessageItem[]
  }> {
    const conversation = await this.getDm(conversationId)
    await conversation.sync()

    const [messages, peerInboxId] = await Promise.all([
      conversation.messages({
        direction: SortDirection.Descending,
        kind: GroupMessageKind.Application,
        limit: MESSAGE_LIMIT,
      }),
      conversation.peerInboxId(),
    ])
    const [state] = await this.client.preferences.getInboxStates([peerInboxId])
    const peerAddress =
      state?.accountIdentifiers.find(
        (identifier) => identifier.identifierKind === IdentifierKind.Ethereum,
      )?.identifier ?? null

    return {
      conversation: {
        id: conversation.id,
        peerAddress,
        peerInboxId,
      },
      messages: messages
        .reverse()
        .map((message) => toMessageItem(message, this.inboxId, true)),
    }
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

    let startupFailed = false
    this.#messageStream = await this.client.conversations.streamAllDmMessages({
      consentStates: VISIBLE_CONSENT_STATES,
      onError: () => {
        startupFailed = true
        onHealth('retrying')
      },
      onFail: () => onHealth('retrying'),
      onRestart: () => onHealth('live'),
      onRetry: () => onHealth('retrying'),
      onValue: (message) => onMessage(toMessageItem(message, this.inboxId)),
      retryAttempts: 6,
      retryDelay: 10_000,
      retryOnFail: true,
    })
    if (!startupFailed) onHealth('live')
  }

  async close(): Promise<void> {
    const stream = this.#messageStream
    this.#messageStream = null
    if (stream && !stream.isDone) await stream.end()
    this.client.close()
  }

  private async getDm(conversationId: string): Promise<Dm> {
    const conversation = await this.client.conversations.getConversationById(conversationId)
    if (!(conversation instanceof Dm)) {
      throw new Error('The selected XMTP conversation is not a direct message.')
    }
    return conversation
  }
}

function clientOptions(): {
  appVersion: string
  env: XmtpEnv
  gatewayHost?: string
  loggingLevel: LogLevel
} {
  const gatewayHost = import.meta.env.VITE_XMTP_GATEWAY_HOST?.trim()
  const env = configuredEnvironment()
  if ((env === 'production' || env === 'mainnet') && !gatewayHost) {
    throw new Error(
      'Production XMTP messaging is disabled until an authenticated payer Gateway is configured.',
    )
  }

  return {
    appVersion: 'converge-miniapp/0.1.0',
    env,
    loggingLevel: LogLevel.Off,
    ...(gatewayHost ? { gatewayHost } : {}),
  }
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
