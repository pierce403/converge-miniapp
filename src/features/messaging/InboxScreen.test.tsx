import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { InboxScreen } from './InboxScreen'
import type { ConversationSummary } from './types'

const address = '0x1111111111111111111111111111111111111111' as const

function renderInbox(
  conversations: ConversationSummary[],
  participantIdentityFor = vi.fn(() => null),
) {
  return render(
    <InboxScreen
      address={address}
      conversations={conversations}
      ensIdentity={{
        candidate: null,
        preference: null,
        relationship: null,
        status: 'none',
      }}
      environment="dev · EOA"
      onClearEnsPreference={vi.fn()}
      onJoinConvos={vi.fn()}
      onNewDm={vi.fn()}
      onOpen={vi.fn()}
      onRefresh={vi.fn()}
      onRefreshEns={vi.fn()}
      onRetryLiveUpdates={vi.fn()}
      onUseEns={vi.fn()}
      participantIdentityFor={participantIdentityFor}
      profile={{ displayName: 'Dean' }}
      refreshing={false}
      streamHealth="offline"
    />,
  )
}

describe('InboxScreen', () => {
  it('keeps saved conversations readable and disables network actions while offline', () => {
    renderInbox([{
      id: 'conversation-1',
      isOwnLastMessage: false,
      kind: 'dm',
      peerAddress: '0x2222222222222222222222222222222222222222',
      peerInboxId: 'peer-inbox',
      preview: 'Saved offline preview',
      updatedAt: new Date('2026-07-14T12:00:00Z'),
    }])

    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline. Showing conversations saved on this device.',
    )
    expect(screen.getByText('Saved offline preview')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Refresh now' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh inbox' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New DM' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Join Convos' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Check ENS identity' })).toBeDisabled()
  })

  it('does not claim an offline empty cache is the beginning of the network inbox', () => {
    renderInbox([])

    expect(screen.getByRole('heading', {
      name: 'No conversations saved on this device',
    })).toBeVisible()
    expect(screen.getByText('Reconnect to check this inbox for conversations.')).toBeVisible()
    expect(screen.queryByText('No allowed conversations yet')).not.toBeInTheDocument()
  })

  it('labels a verified Convos group without treating its creator as a DM peer', () => {
    const participantIdentityFor = vi.fn(() => null)
    renderInbox([{
      creatorInboxId: 'creator-inbox',
      emoji: '🌱',
      id: 'group-1',
      isOwnLastMessage: true,
      kind: 'convos-group',
      peerAddress: null,
      peerInboxId: null,
      preview: 'Welcome to the garden',
      title: 'Garden chat',
      updatedAt: new Date('2026-07-14T12:00:00Z'),
    }], participantIdentityFor)

    expect(screen.getByText('Garden chat')).toBeVisible()
    expect(screen.getByText('Convos group')).toBeVisible()
    expect(screen.getByText('You: Welcome to the garden')).toBeVisible()
    expect(participantIdentityFor).not.toHaveBeenCalled()
  })

  it('attributes a group preview to a stable shortened sender inbox', () => {
    renderInbox([{
      creatorInboxId: 'creator-inbox',
      emoji: '🌱',
      id: 'group-1',
      isOwnLastMessage: false,
      kind: 'convos-group',
      lastSenderInboxId: 'abcdef1234567890',
      peerAddress: null,
      peerInboxId: null,
      preview: 'Welcome',
      title: 'Garden chat',
      updatedAt: new Date('2026-07-14T12:00:00Z'),
    }])

    expect(screen.getByText('abcdef…7890: Welcome')).toBeVisible()
  })
})
