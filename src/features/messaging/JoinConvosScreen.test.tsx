import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConvosInviteError } from '../../lib/convos/error'
import type { ParsedConvosInvite } from '../../lib/convos/invite'
import { JoinConvosScreen } from './JoinConvosScreen'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
}))

vi.mock('../../lib/convos/invite', () => ({
  parseConvosInvite: mocks.parse,
}))

const invite: ParsedConvosInvite = {
  creatorInboxId: 'creator-inbox-secret-0123456789',
  emoji: '🌱',
  expiresAfterUse: false,
  name: 'Garden chat',
  reusable: true,
  slug: 'bearer-secret-slug',
  tag: 'secret-conversation-tag',
}

describe('JoinConvosScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    mocks.parse.mockReturnValue(invite)
  })

  it('parses locally, shows only safe preview fields, and waits for an explicit request', async () => {
    const onRequestAccess = vi.fn().mockResolvedValue(undefined)
    renderJoin({ onRequestAccess })

    fireEvent.change(screen.getByLabelText('Convos invite link or code'), {
      target: { value: 'https://popup.convos.org/v2?i=bearer-secret-slug' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check invite' }))

    expect(await screen.findByRole('heading', { name: 'Garden chat' })).toBeVisible()
    expect(screen.getByText('🌱')).toBeVisible()
    expect(screen.getByText(/preview from the link, not a verified identity/i)).toBeVisible()
    expect(onRequestAccess).not.toHaveBeenCalled()
    expect(screen.queryByText(/bearer-secret-slug/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/creator-inbox-secret/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/secret-conversation-tag/i)).not.toBeInTheDocument()
    expect([...localStorageKeys(window.localStorage)]).toEqual([])
    expect([...localStorageKeys(window.sessionStorage)]).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Request access' }))
    await waitFor(() => expect(onRequestAccess).toHaveBeenCalledOnce())
    expect(mocks.parse).toHaveBeenNthCalledWith(2, invite.slug)
    expect(onRequestAccess).toHaveBeenCalledWith(invite)
  })

  it('checks expiry again at the request tap and never sends a newly expired invite', async () => {
    const onRequestAccess = vi.fn().mockResolvedValue(undefined)
    mocks.parse
      .mockReturnValueOnce(invite)
      .mockImplementationOnce(() => {
        throw new ConvosInviteError('invite_expired')
      })
    renderJoin({ onRequestAccess })

    fireEvent.change(screen.getByLabelText('Convos invite link or code'), {
      target: { value: 'signed-invite' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check invite' }))
    await screen.findByRole('heading', { name: 'Garden chat' })
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That Convos invite has expired.',
    )
    expect(onRequestAccess).not.toHaveBeenCalled()
  })

  it('redacts unexpected parser failures', async () => {
    mocks.parse.mockImplementation(() => {
      throw new Error('chunk failed for bearer-secret-slug')
    })
    renderJoin()

    fireEvent.change(screen.getByLabelText('Convos invite link or code'), {
      target: { value: 'bearer-secret-slug' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check invite' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That Convos invite could not be opened safely.',
    )
    expect(screen.queryByText(/chunk failed/i)).not.toBeInTheDocument()
  })

  it('discards a stale parse when the pasted value changes during loading', async () => {
    renderJoin()
    const input = screen.getByLabelText('Convos invite link or code')

    fireEvent.change(input, { target: { value: 'invite-a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check invite' }))
    fireEvent.change(input, { target: { value: 'invite-b' } })

    await waitFor(() => expect(mocks.parse).toHaveBeenCalledWith('invite-a'))
    expect(screen.queryByRole('heading', { name: 'Garden chat' })).not.toBeInTheDocument()
    expect(input).toHaveValue('invite-b')

    fireEvent.click(screen.getByRole('button', { name: 'Check invite' }))
    expect(await screen.findByRole('heading', { name: 'Garden chat' })).toBeVisible()
    expect(mocks.parse).toHaveBeenLastCalledWith('invite-b')
  })

  it('deduplicates an in-flight request tap', async () => {
    let finish!: () => void
    const onRequestAccess = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      finish = resolve
    }))
    renderJoin({ onRequestAccess })

    fireEvent.change(screen.getByLabelText('Convos invite link or code'), {
      target: { value: 'signed-invite' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check invite' }))
    await screen.findByRole('heading', { name: 'Garden chat' })
    const requestButton = screen.getByRole('button', { name: 'Request access' })
    fireEvent.click(requestButton)
    fireEvent.click(requestButton)

    await waitFor(() => expect(onRequestAccess).toHaveBeenCalledOnce())
    finish()
  })

  it('shows the exact honest waiting state without a joined or replacement claim', () => {
    renderJoin({
      request: {
        conversationId: 'transport-dm',
        error: null,
        groupId: null,
        invite,
        messageId: 'request-message',
        retryMode: 'none',
        status: 'waiting',
      },
    })

    expect(screen.getByText("Request sent. Waiting for the inviter's device…")).toBeVisible()
    expect(screen.queryByText(/joined/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /import another/i })).not.toBeInTheDocument()
  })

  it('keeps a handled marker in the waiting state instead of claiming membership', () => {
    renderJoin({
      request: {
        conversationId: 'transport-dm',
        error: null,
        groupId: null,
        invite,
        messageId: 'request-message',
        retryMode: 'none',
        status: 'handled',
      },
    })

    expect(screen.getByRole('heading', { name: 'Request handled' })).toBeVisible()
    expect(screen.getByText(/inviter responded to your request/i)).toBeVisible()
    expect(screen.getByText(/waiting for this device to receive the group/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Open conversation' })).not.toBeInTheDocument()
  })

  it('moves focus only when the request meaningfully changes', () => {
    const request = {
      conversationId: 'transport-dm',
      error: null,
      groupId: null,
      invite,
      messageId: 'request-message',
      retryMode: 'none' as const,
      status: 'waiting' as const,
    }
    const props: Parameters<typeof JoinConvosScreen>[0] = {
      onBack: vi.fn(),
      onOpenConversation: vi.fn(),
      onRequestAccess: vi.fn().mockResolvedValue(undefined),
      onReset: vi.fn(),
      onRetry: vi.fn().mockResolvedValue(undefined),
      request,
    }
    const { rerender } = render(<JoinConvosScreen {...props} />)
    const backButton = screen.getByRole('button', { name: 'Back to inbox' })
    backButton.focus()

    rerender(<JoinConvosScreen {...props} request={{ ...request }} />)
    expect(backButton).toHaveFocus()

    rerender(
      <JoinConvosScreen
        {...props}
        request={{ ...request, status: 'handled' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Request handled' })).toHaveFocus()
  })

  it('opens only a verified joined group', () => {
    const onOpenConversation = vi.fn()
    renderJoin({
      onOpenConversation,
      request: {
        conversationId: 'transport-dm',
        error: null,
        groupId: 'verified-group',
        invite,
        messageId: 'request-message',
        retryMode: 'none',
        status: 'joined',
      },
    })

    expect(screen.getByRole('heading', { name: 'Conversation joined' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    expect(onOpenConversation).toHaveBeenCalledWith('verified-group')
  })

  it('offers a fresh deliberate retry and blocks it offline', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined)
    const request = {
      conversationId: 'transport-dm',
      error: 'XMTP could not confirm the access request.',
      groupId: null,
      invite,
      messageId: 'request-message',
      retryMode: 'fresh' as const,
      status: 'failed' as const,
    }
    const { rerender } = renderJoin({ onRetry, request })

    fireEvent.click(screen.getByRole('button', { name: 'Send fresh request' }))
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(
      <JoinConvosScreen
        offline
        onBack={vi.fn()}
        onOpenConversation={vi.fn()}
        onRequestAccess={vi.fn()}
        onReset={vi.fn()}
        onRetry={onRetry}
        request={request}
      />,
    )
    expect(screen.getByRole('button', { name: 'Send fresh request' })).toBeDisabled()
  })

  it('checks an invite locally while offline but keeps the network request disabled', async () => {
    renderJoin({ offline: true })

    const input = screen.getByLabelText('Convos invite link or code')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'signed-invite' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check invite' }))

    expect(await screen.findByRole('heading', { name: 'Garden chat' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Request access' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/check an invite offline/i)
  })

  it('lets a terminal expired invite be discarded without retrying it', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined)
    const onReset = vi.fn()
    const baseRequest = {
      conversationId: 'transport-dm',
      error: 'XMTP marked this access request as permanently failed.',
      groupId: null,
      invite,
      messageId: 'request-message',
      status: 'failed' as const,
    }
    const { rerender } = renderJoin({
      onReset,
      onRetry,
      request: { ...baseRequest, retryMode: 'fresh' },
    })

    expect(screen.getByRole('button', { name: 'Use a different invite' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Send fresh request' }))
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(
      <JoinConvosScreen
        onBack={vi.fn()}
        onOpenConversation={vi.fn()}
        onRequestAccess={vi.fn()}
        onReset={onReset}
        onRetry={onRetry}
        request={{
          ...baseRequest,
          error: 'That Convos invite has expired.',
          retryMode: 'reset',
        }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Send fresh request' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use a different invite' }))
    expect(onReset).toHaveBeenCalledOnce()
  })
})

function renderJoin(overrides: Partial<Parameters<typeof JoinConvosScreen>[0]> = {}) {
  const props: Parameters<typeof JoinConvosScreen>[0] = {
    onBack: vi.fn(),
    onOpenConversation: vi.fn(),
    onRequestAccess: vi.fn().mockResolvedValue(undefined),
    onReset: vi.fn(),
    onRetry: vi.fn().mockResolvedValue(undefined),
    request: null,
    ...overrides,
  }
  return render(<JoinConvosScreen {...props} />)
}

function *localStorageKeys(storage: Storage) {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key !== null) yield [key, storage.getItem(key)]
  }
}
