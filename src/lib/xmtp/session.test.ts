import { describe, expect, it } from 'vitest'

import type { ConversationSummary, MessageItem } from '../../features/messaging/types'

describe('messaging models', () => {
  it('preserves one message identity while delivery changes', () => {
    const pending: MessageItem = {
      canRetry: true,
      conversationId: 'conversation-1',
      delivery: 'sending',
      id: 'message-1',
      isOwn: true,
      senderInboxId: 'own-inbox',
      sentAt: new Date('2026-07-14T12:00:00Z'),
      sentAtNs: 1_784_030_400_000_000_000n,
      text: 'hello',
      unsupported: false,
    }
    const failed = { ...pending, delivery: 'failed' as const }
    const retried = { ...failed, delivery: 'sent' as const }

    expect(new Set([pending.id, failed.id, retried.id])).toEqual(
      new Set(['message-1']),
    )
  })

  it('allows an inbox row to fall back to its peer inbox ID', () => {
    const summary: ConversationSummary = {
      id: 'conversation-1',
      isOwnLastMessage: false,
      kind: 'dm',
      peerAddress: null,
      peerInboxId: 'peer-inbox',
      preview: 'No messages yet',
      updatedAt: null,
    }

    expect(summary.peerAddress ?? summary.peerInboxId).toBe('peer-inbox')
  })
})
