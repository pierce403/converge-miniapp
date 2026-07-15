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
    sentAt: new Date('2026-07-14T12:00:00Z'),
    sentAtNs: 1_784_030_400_000_000_000n,
    text: id,
    unsupported: false,
  }
}

function renderConversation(overrides: Partial<Parameters<typeof ConversationScreen>[0]> = {}) {
  return render(
    <ConversationScreen
      conversation={{ id: 'conversation-1', peerAddress: null, peerInboxId: 'peer-inbox' }}
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
        conversation={{ id: 'conversation-1', peerAddress: null, peerInboxId: 'peer-inbox' }}
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
})
