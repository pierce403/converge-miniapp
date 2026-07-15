import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessagingApp } from './MessagingApp'

const mocks = vi.hoisted(() => ({
  messaging: vi.fn(),
}))

vi.mock('./useXmtpMessaging', () => ({
  useXmtpMessaging: mocks.messaging,
}))

vi.mock('../../app/useMiniAppBack', () => ({
  useMiniAppBack: vi.fn(),
}))

const user = { fid: 403, username: 'pierce' }

describe('MessagingApp storage and installation states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.messaging.mockReturnValue(readyMessaging())
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
    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible()
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
