import type { ParsedConvosInvite } from '../../lib/convos/invite'

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
  senderInboxId: string
  reactions?: MessageReaction[]
  replyTo?: string
  text: string
  unsupported: boolean
}

type ConversationSummaryBase = {
  id: string
  isOwnLastMessage: boolean
  lastSenderInboxId?: string | null
  preview: string
  updatedAt: Date | null
}

export type ConversationSummary = ConversationSummaryBase & (
  | {
    kind: 'dm'
    peerAddress: string | null
    peerInboxId: string
  }
  | {
    creatorInboxId: string
    emoji: string | null
    kind: 'convos-group'
    peerAddress: null
    peerInboxId: null
    title: string
  }
)

export type ActiveConversation = (
  | {
    kind: 'dm'
    peerAddress: string | null
    peerInboxId: string
  }
  | {
    creatorInboxId: string
    emoji: string | null
    kind: 'convos-group'
    peerAddress: null
    peerInboxId: null
    title: string
  }
) & {
  id: string
}

export type StreamHealth = 'live' | 'retrying' | 'failed' | 'offline'

export type ConvosAccessRequest = {
  conversationId: string | null
  error: string | null
  groupId: string | null
  invite: ParsedConvosInvite
  messageId: string | null
  retryMode: 'fresh' | 'reset' | 'none'
  status: 'sending' | 'waiting' | 'handled' | 'joined' | 'failed'
}
