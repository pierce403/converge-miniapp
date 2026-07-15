import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessagingApp } from './MessagingApp'

const mocks = vi.hoisted(() => ({
  ens: vi.fn(),
  messaging: vi.fn(),
}))

vi.mock('./useXmtpMessaging', () => ({
  useXmtpMessaging: mocks.messaging,
}))

vi.mock('../identity/useEnsIdentity', () => ({
  useEnsIdentity: mocks.ens,
}))

vi.mock('../../app/useMiniAppBack', () => ({
  useMiniAppBack: vi.fn(),
}))

const user = { fid: 403, username: 'pierce' }

describe('MessagingApp storage and installation states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.messaging.mockReturnValue(readyMessaging())
    mocks.ens.mockReturnValue(readyEns())
  })

  it('starts host-wallet setup without presenting an onboarding choice', () => {
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connection: { error: null, phase: 'idle' },
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(mocks.messaging).toHaveBeenCalledWith({ autoConnect: true })
    expect(screen.getByRole('heading', { name: 'Opening your inbox' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /open private inbox/i })).not.toBeInTheDocument()
  })

  it('does not start setup or invent a key without the host wallet capability', () => {
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connection: { error: null, phase: 'idle' },
    })

    render(<MessagingApp canUseBack={false} canUseWallet={false} user={user} />)

    expect(mocks.messaging).toHaveBeenCalledWith({ autoConnect: false })
    expect(screen.getByRole('heading', {
      name: 'This Farcaster client cannot open XMTP',
    })).toBeVisible()
    expect(screen.getByText(/will not substitute another wallet or generate a private key/i)).toBeVisible()
  })

  it('leaves one explicit retry after a rejected connection', () => {
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connection: {
        error: 'The wallet request was cancelled. Nothing was sent, registered, or changed.',
        phase: 'error',
      },
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /reset|back/i })).not.toBeInTheDocument()
  })

  it('does not offer a blind retry at the active-installation limit', () => {
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      connection: {
        error: 'This XMTP inbox already has the maximum number of active installations. Converge Mini did not revoke anything automatically.',
        phase: 'installation-limit',
      },
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('heading', { name: 'This inbox has no installation slot' })).toBeVisible()
    expect(screen.getByText(/did not revoke anything automatically/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('distinguishes the permanent inbox-update limit from installation cleanup', () => {
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      connection: {
        error: 'This XMTP inbox has reached its permanent identity-update limit.',
        phase: 'inbox-update-limit',
      },
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByText('Permanent XMTP inbox limit')).toBeVisible()
    expect(screen.getByRole('heading', {
      name: 'This inbox cannot add another installation',
    })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('keeps best-effort storage risk visible throughout the ready inbox', () => {
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      storageDurability: 'best-effort',
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'browser may clear local message history under storage pressure',
    )
  })

  it('does not offer a disconnect that would reopen automatic onboarding', () => {
    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.queryByRole('button', { name: 'Disconnect XMTP inbox' })).not.toBeInTheDocument()
    expect(screen.getByText('Local message privacy')).toBeInTheDocument()
    expect(screen.getByText(/browser message storage is local but not encrypted at rest/i)).toBeInTheDocument()
  })

  it('offers a forward-verified ENS name only when it is already this inbox', () => {
    const setPreference = vi.fn().mockResolvedValue(undefined)
    mocks.ens.mockReturnValue(readyEns({
      candidate: {
        address: '0x1111111111111111111111111111111111111111',
        name: 'pierce.eth',
      },
      relationship: 'same-inbox',
      setPreference,
    }))

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('dialog', {
      name: 'Use pierce.eth for this inbox?',
    })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(setPreference).toHaveBeenCalledWith('dismissed')
  })

  it('keeps separate ENS inboxes out of the automatic offer and explains the menu action', () => {
    mocks.ens.mockReturnValue(readyEns({
      candidate: {
        address: '0x1111111111111111111111111111111111111111',
        name: 'separate.eth',
      },
      preference: 'dismissed',
      relationship: 'different-inbox',
    }))

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect ENS inbox' }))
    expect(screen.getByText(/separate XMTP inbox/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot be merged/i)).toBeInTheDocument()
  })
})

function readyMessaging() {
  return {
    activeConversation: null,
    address: '0x1111111111111111111111111111111111111111',
    backToInbox: vi.fn(),
    connect: vi.fn(),
    connection: { error: null, phase: 'ready' },
    conversations: [],
    createDm: vi.fn(),
    disconnect: vi.fn(),
    environment: 'dev',
    hasOlderMessages: false,
    inspectIdentityRelationship: vi.fn(),
    loadOlderMessages: vi.fn(),
    loadingConversation: false,
    loadingOlder: false,
    messages: [],
    notice: null,
    openConversation: vi.fn(),
    refresh: vi.fn(),
    refreshing: false,
    retryLiveUpdates: vi.fn(),
    retryMessage: vi.fn(),
    sendMessage: vi.fn(),
    sending: false,
    setNotice: vi.fn(),
    setView: vi.fn(),
    storageDurability: 'persistent',
    streamHealth: 'live',
    view: 'inbox',
    walletKind: 'EOA',
  }
}

function readyEns(overrides: Record<string, unknown> = {}) {
  return {
    candidate: null,
    clearPreference: vi.fn().mockResolvedValue(undefined),
    preference: null,
    refresh: vi.fn(),
    relationship: null,
    setPreference: vi.fn().mockResolvedValue(undefined),
    status: 'none',
    ...overrides,
  }
}
