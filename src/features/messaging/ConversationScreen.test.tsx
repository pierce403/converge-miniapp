import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageItem } from './types'
import { ConversationScreen } from './ConversationScreen'

function message(id: string): MessageItem {
  return {
    canRetry: false,
    conversationId: 'conversation-1',
    delivery: 'sent',
    id,
    isOwn: false,
    senderInboxId: 'peer-inbox',
    sentAt: new Date('2026-07-14T12:00:00Z'),
    sentAtNs: 1_784_030_400_000_000_000n,
    text: id,
    unsupported: false,
  }
}

function renderConversation(overrides: Partial<Parameters<typeof ConversationScreen>[0]> = {}) {
  return render(
    <ConversationScreen
      conversation={{ id: 'conversation-1', kind: 'dm', peerAddress: null, peerInboxId: 'peer-inbox' }}
      hasOlder={false}
      loading={false}
      loadingOlder={false}
      messages={[message('hello')]}
      onBack={vi.fn()}
      onLoadOlder={vi.fn()}
      onRetry={vi.fn()}
      onRetryLiveUpdates={vi.fn()}
      onSend={vi.fn()}
      sending={false}
      streamHealth="live"
      {...overrides}
    />,
  )
}

describe('ConversationScreen', () => {
  it('shows resolved peer identity while retaining the wallet address', () => {
    renderConversation({
      conversation: {
        id: 'conversation-1',
        kind: 'dm',
        peerAddress: '0x2222222222222222222222222222222222222222',
        peerInboxId: 'peer-inbox',
      },
      participantIdentity: {
        address: '0x2222222222222222222222222222222222222222',
        basename: 'alice.base.eth',
        ensName: 'alice.eth',
        registeredFname: 'alice',
      },
    })

    expect(screen.getByRole('heading', { name: 'alice.eth' })).toBeVisible()
    expect(screen.getByText(/registered fname @alice.*alice\.base\.eth.*0x2222…2222/ui)).toBeVisible()
  })

  it('does not announce initial history as newly arrived content', () => {
    const { rerender } = renderConversation({ loading: true })
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off')

    rerender(
      <ConversationScreen
        conversation={{ id: 'conversation-1', kind: 'dm', peerAddress: null, peerInboxId: 'peer-inbox' }}
        hasOlder={false}
        loading={false}
        loadingOlder={false}
        messages={[message('hello')]}
        onBack={vi.fn()}
        onLoadOlder={vi.fn()}
        onRetry={vi.fn()}
        onRetryLiveUpdates={vi.fn()}
        onSend={vi.fn()}
        sending={false}
        streamHealth="live"
      />,
    )
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite')
  })

  it('guards repeated older-page requests while the first is pending', async () => {
    let resolvePage: (() => void) | undefined
    const onLoadOlder = vi.fn(() => new Promise<void>((resolve) => {
      resolvePage = resolve
    }))
    renderConversation({ hasOlder: true, onLoadOlder })

    const button = screen.getByRole('button', { name: 'Load earlier messages' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onLoadOlder).toHaveBeenCalledTimes(1)

    await act(async () => resolvePage?.())
  })

  it('offers a manual refresh while live updates are degraded', () => {
    const onRetryLiveUpdates = vi.fn()
    renderConversation({ onRetryLiveUpdates, streamHealth: 'retrying' })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }))
    expect(onRetryLiveUpdates).toHaveBeenCalledOnce()
  })

  it('keeps saved messages readable and disables network actions while offline', () => {
    const failed = {
      ...message('saved failed message'),
      canRetry: true,
      delivery: 'failed' as const,
      isOwn: true,
    }
    renderConversation({
      messages: [message('saved offline message'), failed],
      streamHealth: 'offline',
    })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline. Showing messages saved on this device.',
    )
    expect(screen.getByText('saved offline message')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Refresh now' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retry failed message' })).toBeDisabled()
  })

  it('does not claim an empty offline cache is the start of the conversation', () => {
    renderConversation({ messages: [], streamHealth: 'offline' })

    expect(screen.getByText('No messages are saved on this device.')).toBeVisible()
    expect(screen.getByText('Reconnect to check for conversation history.')).toBeVisible()
    expect(screen.queryByText(
      'This is the beginning of your private conversation.',
    )).not.toBeInTheDocument()
  })

  it('presents a Convos group as a group and keeps the shared message controls', () => {
    renderConversation({
      conversation: {
        creatorInboxId: 'creator-inbox',
        emoji: '🌱',
        id: 'group-1',
        kind: 'convos-group',
        peerAddress: null,
        peerInboxId: null,
        title: 'Garden chat',
      },
      messages: [{
        ...message('Hello group'),
        conversationId: 'group-1',
        senderInboxId: 'abcdef1234567890',
      }],
    })

    expect(screen.getByRole('heading', { name: 'Garden chat' })).toBeVisible()
    expect(screen.getByText('Convos group · XMTP')).toBeVisible()
    expect(screen.queryByText(/direct message/i)).not.toBeInTheDocument()
    expect(screen.getByText('abcdef…7890')).toBeVisible()
    expect(screen.getByLabelText(/abcdef…7890/)).toBeVisible()
    expect(screen.getByLabelText('Message')).toBeEnabled()
    expect(screen.getByLabelText('Message')).toHaveAttribute(
      'placeholder',
      'Message this group…',
    )
    expect(screen.getByRole('heading', { name: 'Garden chat' })).toHaveFocus()
  })
})
