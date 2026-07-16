export type MessageDelivery = 'sending' | 'sent' | 'failed'

export const MAX_MESSAGE_REACTIONS = 24

export type MessageReaction = {
  content: string
  count: number
}

export type MessageItem = {
  canRetry: boolean
  conversationId: string
  delivery: MessageDelivery
  id: string
  isOwn: boolean
  sentAt: Date
  sentAtNs: bigint
  reactions?: MessageReaction[]
  replyTo?: string
  text: string
  unsupported: boolean
}

export type ConversationSummary = {
  id: string
  isOwnLastMessage: boolean
  peerAddress: string | null
  peerInboxId: string
  preview: string
  updatedAt: Date | null
}

export type ActiveConversation = {
  id: string
  peerAddress: string | null
  peerInboxId: string
}

export type StreamHealth = 'live' | 'retrying' | 'failed' | 'offline'
