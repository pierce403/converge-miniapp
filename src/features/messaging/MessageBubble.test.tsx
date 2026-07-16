import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageItem } from './types'
import { MessageBubble } from './MessageBubble'

const message: MessageItem = {
  canRetry: false,
  conversationId: 'conversation-1',
  delivery: 'sent',
  id: 'message-1',
  isOwn: false,
  senderInboxId: 'peer-inbox-1234567890',
  reactions: [{ content: '😁', count: 2 }],
  replyTo: 'The earlier message',
  sentAt: new Date('2026-07-15T20:00:00Z'),
  sentAtNs: 1_752_606_400_000_000_000n,
  text: 'The reply',
  unsupported: false,
}

describe('MessageBubble', () => {
  it('renders reply context and aggregate reactions on the parent bubble', () => {
    render(<MessageBubble message={message} onRetry={vi.fn()} />)

    expect(screen.getByText('The earlier message')).toBeVisible()
    expect(screen.getByText('The reply')).toBeVisible()
    expect(screen.getByRole('list', { name: 'Reactions' })).toHaveTextContent('😁2')
  })

  it('caps the visible reaction chip list', () => {
    render(<MessageBubble
      message={{
        ...message,
        reactions: Array.from({ length: 30 }, (_, index) => ({
          content: `:${index}:`,
          count: 1,
        })),
      }}
      onRetry={vi.fn()}
    />)

    expect(screen.getAllByRole('listitem')).toHaveLength(24)
  })

  it('identifies a peer sender in a group without exposing it in direct messages', () => {
    const { rerender } = render(
      <MessageBubble message={message} onRetry={vi.fn()} showSender />,
    )

    expect(screen.getByText('peer-i…7890')).toBeVisible()
    expect(screen.getByLabelText(/peer-i…7890/)).toBeVisible()

    rerender(<MessageBubble message={message} onRetry={vi.fn()} />)
    expect(screen.queryByText('peer-i…7890')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Recipient/)).toBeVisible()
  })
})
