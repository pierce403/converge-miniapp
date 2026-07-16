import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessagingApp } from './MessagingApp'

const mocks = vi.hoisted(() => ({
  ens: vi.fn(),
  messaging: vi.fn(),
  participants: vi.fn(),
  recipientResolution: vi.fn(),
}))

vi.mock('./useXmtpMessaging', () => ({
  useXmtpMessaging: mocks.messaging,
}))

vi.mock('../identity/useEnsIdentity', () => ({
  allowAutomaticEnsDiscovery: vi.fn(),
  useEnsIdentity: mocks.ens,
}))

vi.mock('../identity/useParticipantIdentities', () => ({
  useParticipantIdentities: mocks.participants,
  participantPresentation: (value: string) => ({
    addressLabel: value,
    fnameHint: null,
    label: value,
    secondary: value,
    title: value,
  }),
}))

vi.mock('../identity/useRecipientResolution', () => ({
  useRecipientResolution: mocks.recipientResolution,
}))

vi.mock('../../app/useMiniAppBack', () => ({
  useMiniAppBack: vi.fn(),
}))

const user = { fid: 403, username: 'pierce' }

describe('MessagingApp storage and installation states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mocks.messaging.mockReturnValue(readyMessaging())
    mocks.ens.mockReturnValue(readyEns())
    mocks.recipientResolution.mockReturnValue(readyRecipientResolution())
    mocks.participants.mockReturnValue({
      identityFor: vi.fn().mockReturnValue(null),
      refresh: vi.fn(),
      status: 'ready',
    })
  })

  it('starts host-wallet setup without presenting an onboarding choice', () => {
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connection: { error: null, phase: 'idle' },
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(mocks.messaging).toHaveBeenCalledWith({
      autoConnect: true,
      inboxTarget: null,
    })
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

    expect(mocks.messaging).toHaveBeenCalledWith({
      autoConnect: false,
      inboxTarget: null,
    })
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

  it('does not ask the user to retry missing XMTP network configuration', () => {
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connection: {
        error: 'Converge Mini is not configured for this XMTP network yet. No XMTP signature was requested and no inbox was changed.',
        phase: 'configuration-error',
      },
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('heading', { name: 'Messaging is not available yet' })).toBeVisible()
    expect(screen.getByText(/no XMTP signature was requested/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
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

  it('remembers dismissal of the best-effort storage warning locally', () => {
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      storageDurability: 'best-effort',
    })

    const firstRender = render(
      <MessagingApp canUseBack={false} canUseWallet user={user} />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'browser may clear local message history',
    )
    fireEvent.click(screen.getByRole('button', {
      name: 'Dismiss local history warning',
    }))
    expect(screen.queryByText(/browser may clear local message history/i)).not.toBeInTheDocument()

    firstRender.unmount()
    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.queryByText(/browser may clear local message history/i)).not.toBeInTheDocument()
  })

  it('does not offer a disconnect that would reopen automatic onboarding', () => {
    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.queryByRole('button', { name: 'Disconnect XMTP inbox' })).not.toBeInTheDocument()
    expect(screen.getByText('Local message privacy')).toBeInTheDocument()
    expect(screen.getByText(/browser message storage is local but not encrypted at rest/i)).toBeInTheDocument()
  })

  it('opens the dedicated Convos invite surface from the inbox', () => {
    const setView = vi.fn()
    mocks.messaging.mockReturnValue({ ...readyMessaging(), setView })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'Join Convos' }))

    expect(setView).toHaveBeenCalledWith('join-convos')
  })

  it('restores focus to the originating inbox row after leaving a conversation', async () => {
    const backToInbox = vi.fn()
    const conversation = {
      creatorInboxId: 'creator-inbox',
      emoji: '🌱',
      id: 'group-1',
      kind: 'convos-group' as const,
      peerAddress: null,
      peerInboxId: null,
      title: 'Garden chat',
    }
    const summary = {
      ...conversation,
      isOwnLastMessage: false,
      preview: 'Welcome',
      updatedAt: new Date('2026-07-15T20:00:00Z'),
    }
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      activeConversation: conversation,
      backToInbox,
      conversations: [summary],
      view: 'conversation',
    })
    const view = render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }))
    expect(backToInbox).toHaveBeenCalledOnce()

    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      conversations: [summary],
      view: 'inbox',
    })
    view.rerender(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Garden chat/i })).toHaveFocus()
    })
  })

  it('renders a retained Convos waiting state without claiming membership', () => {
    const backToInbox = vi.fn()
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      backToInbox,
      convosAccessRequest: {
        conversationId: 'creator-transport-dm',
        error: null,
        invite: {
          creatorInboxId: 'creator-inbox',
          emoji: '🌱',
          expiresAfterUse: false,
          name: 'Garden chat',
          reusable: true,
          slug: 'bearer-secret-slug',
          tag: 'secret-conversation-tag',
        },
        messageId: 'join-request-message',
        retryMode: 'none',
        status: 'waiting',
      },
      view: 'join-convos',
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByText("Request sent. Waiting for the inviter's device…")).toBeVisible()
    expect(screen.queryByText(/joined/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }))
    expect(backToInbox).toHaveBeenCalledOnce()
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

  it('freshly verifies and remembers an explicit separate ENS inbox switch', async () => {
    const candidate = {
      address: '0x2222222222222222222222222222222222222222' as const,
      name: 'deanpierce.eth',
    }
    const fresh = {
      candidate,
      preference: 'dismissed' as const,
      relationship: 'different-inbox' as const,
      status: 'ready' as const,
    }
    const refresh = vi.fn().mockResolvedValue(fresh)
    const setPreference = vi.fn().mockResolvedValue(undefined)
    const prepareInboxSwitch = vi.fn().mockResolvedValue({
      address: candidate.address,
      chainId: '1',
      inboxId: 'deanpierce-inbox',
      walletKind: 'EOA',
    })
    const reloadDocument = vi.fn()
    mocks.ens.mockReturnValue(readyEns({
      ...fresh,
      refresh,
      setPreference,
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      prepareInboxSwitch,
    })

    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review inbox switch' }))

    expect(screen.getByRole('dialog', {
      name: 'Leave this inbox and join deanpierce.eth?',
    })).toBeVisible()
    expect(screen.getByText(/you’re abandoning this inbox/i)).toBeVisible()
    expect(screen.getByText(/nothing moves or merges/i)).toBeVisible()
    expect(screen.getAllByText(candidate.address)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', {
      name: 'Connect wallet and join deanpierce.eth',
    }))

    await screen.findByText(/restarting Converge Mini/i)
    expect(refresh).toHaveBeenCalledOnce()
    expect(prepareInboxSwitch).toHaveBeenCalledWith(
      candidate.address,
      expect.objectContaining({
        onPairingUri: expect.any(Function),
        signal: expect.any(AbortSignal),
      }),
    )
    expect(setPreference).not.toHaveBeenCalled()
    expect(JSON.parse(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )!)).toMatchObject({
      address: candidate.address,
      inboxId: 'deanpierce-inbox',
      name: candidate.name,
      chainId: '1',
      signerSource: 'walletconnect',
      sourceAddress: '0x1111111111111111111111111111111111111111',
      version: 3,
      walletKind: 'EOA',
    })
    expect(reloadDocument).toHaveBeenCalledOnce()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('keeps the current inbox open when the exact ENS signer is unavailable', async () => {
    const candidate = {
      address: '0x2222222222222222222222222222222222222222' as const,
      name: 'deanpierce.eth',
    }
    const fresh = {
      candidate,
      preference: null,
      relationship: 'different-inbox' as const,
      status: 'ready' as const,
    }
    const unavailable = Object.assign(new Error('not exposed'), {
      code: 'walletconnect-target-unavailable',
    })
    const prepareInboxSwitch = vi.fn().mockRejectedValue(unavailable)
    const reloadDocument = vi.fn()
    mocks.ens.mockReturnValue(readyEns({
      ...fresh,
      refresh: vi.fn().mockResolvedValue(fresh),
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      prepareInboxSwitch,
    })

    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review inbox switch' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Connect wallet and join deanpierce.eth',
    }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /connected wallet is not exposing 0x2222/i,
    )
    expect(reloadDocument).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).toBeNull()
  })

  it('cancels an in-flight inbox-switch check without saving or restarting', async () => {
    const candidate = {
      address: '0x2222222222222222222222222222222222222222' as const,
      name: 'deanpierce.eth',
    }
    const fresh = deferred<ReturnType<typeof readyEns>>()
    const refresh = vi.fn().mockReturnValue(fresh.promise)
    const prepareInboxSwitch = vi.fn()
    const reloadDocument = vi.fn()
    mocks.ens.mockReturnValue(readyEns({
      candidate,
      preference: null,
      refresh,
      relationship: 'different-inbox',
      status: 'ready',
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      prepareInboxSwitch,
    })
    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review inbox switch' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Connect wallet and join deanpierce.eth',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep this inbox' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => fresh.resolve(readyEns({
      candidate,
      preference: null,
      relationship: 'different-inbox',
      status: 'ready',
    })))

    expect(prepareInboxSwitch).not.toHaveBeenCalled()
    expect(reloadDocument).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).toBeNull()
  })

  it('keeps the current inbox open when the verified target cannot be saved', async () => {
    const candidate = {
      address: '0x2222222222222222222222222222222222222222' as const,
      name: 'deanpierce.eth',
    }
    const fresh = {
      candidate,
      preference: null,
      relationship: 'different-inbox' as const,
      status: 'ready' as const,
    }
    const reloadDocument = vi.fn()
    mocks.ens.mockReturnValue(readyEns({
      ...fresh,
      refresh: vi.fn().mockResolvedValue(fresh),
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      prepareInboxSwitch: vi.fn().mockResolvedValue({
        address: candidate.address,
        chainId: '1',
        inboxId: 'target-inbox',
        walletKind: 'EOA',
      }),
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full')
    })

    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review inbox switch' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Connect wallet and join deanpierce.eth',
    }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not remember the verified inbox safely/i,
    )
    expect(reloadDocument).not.toHaveBeenCalled()
    setItem.mockRestore()
    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).toBeNull()
  })

  it('never falls back silently when a remembered ENS target cannot sign', () => {
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: '0x2222222222222222222222222222222222222222',
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 2,
      }),
    )
    const reloadDocument = vi.fn()
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connection: {
        error: 'The requested account is unavailable.',
        phase: 'target-unavailable',
      },
    })

    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )

    expect(mocks.messaging).toHaveBeenCalledWith({
      autoConnect: true,
      inboxTarget: expect.objectContaining({ name: 'deanpierce.eth' }),
    })
    expect(screen.getByRole('heading', {
      name: 'The saved ENS address can’t sign in this Farcaster client',
    })).toBeVisible()
    expect(screen.getByText(/No XMTP signature was requested/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Use Farcaster inbox' }))

    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).toBeNull()
    expect(reloadDocument).toHaveBeenCalledOnce()
  })

  it('offers an explicit external-wallet reconnect without opening another inbox', () => {
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: '0x2222222222222222222222222222222222222222',
        chainId: '1',
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        signerSource: 'walletconnect',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 3,
        walletKind: 'EOA',
      }),
    )
    const connectExternalWallet = vi.fn()
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connectExternalWallet,
      connection: {
        error: 'The saved external-wallet session is unavailable.',
        phase: 'external-wallet-unavailable',
      },
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('heading', {
      name: 'Reconnect the wallet for deanpierce.eth',
    })).toBeVisible()
    expect(screen.getByText(/will require 0x2222/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', {
      name: 'Reconnect external wallet',
    }))
    expect(connectExternalWallet).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('shows QR, MetaMask, and raw-URI options during external-wallet recovery', () => {
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: '0x2222222222222222222222222222222222222222',
        chainId: '1',
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        signerSource: 'walletconnect',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 3,
        walletKind: 'EOA',
      }),
    )
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connection: { error: null, phase: 'wallet' },
      externalWalletPairingUri: 'wc:ephemeral-recovery',
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('img', {
      name: 'WalletConnect QR code for deanpierce.eth',
    })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open MetaMask' })).toBeVisible()
    expect(screen.getByRole('textbox', {
      name: 'WalletConnect URI for deanpierce.eth',
    })).toHaveValue('wc:ephemeral-recovery')
    expect(screen.getByRole('button', {
      name: 'Copy WalletConnect URI',
    })).toBeVisible()
    expect(screen.getByRole('button', {
      name: 'Cancel and use Farcaster inbox',
    })).toBeVisible()
  })

  it('uses the target address until the remembered ENS name is freshly verified', () => {
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: '0x2222222222222222222222222222222222222222',
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 2,
      }),
    )
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: '0x2222222222222222222222222222222222222222',
    })
    mocks.ens.mockReturnValue(readyEns({ status: 'unavailable' }))

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('heading', { name: '0x2222…2222' })).toBeVisible()
    expect(screen.queryByText('deanpierce.eth')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'pierce' })).not.toBeInTheDocument()
  })

  it('shows a freshly reverified target name without another automatic decision', () => {
    const targetAddress = '0x2222222222222222222222222222222222222222'
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: targetAddress,
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 2,
      }),
    )
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: targetAddress,
    })
    mocks.ens.mockReturnValue(readyEns({
      candidate: { address: targetAddress, name: 'deanpierce.eth' },
      preference: null,
      relationship: 'active-address',
      status: 'ready',
    }))

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('heading', { name: 'deanpierce.eth' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Identity and privacy'))
    expect(screen.queryByRole('button', { name: 'Use ENS name' })).not.toBeInTheDocument()
    expect(screen.getByText('ENS name verified for this inbox')).toBeVisible()
  })

  it('keeps the saved target active and reports a failed menu recovery clear', () => {
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: '0x2222222222222222222222222222222222222222',
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 2,
      }),
    )
    const reloadDocument = vi.fn()
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use Farcaster inbox' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      /saved inbox could not be cleared/i,
    )
    expect(reloadDocument).not.toHaveBeenCalled()
    removeItem.mockRestore()
    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).not.toBeNull()
  })

  it('blocks wallet setup until a corrupt saved selector is explicitly cleared', () => {
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      '{',
    )
    const reloadDocument = vi.fn()
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connection: { error: null, phase: 'idle' },
    })

    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )

    expect(mocks.messaging).toHaveBeenCalledWith({
      autoConnect: false,
      inboxTarget: null,
    })
    expect(screen.getByRole('heading', {
      name: 'Choose how to recover safely',
    })).toBeVisible()
    expect(screen.getByText(/will not guess which inbox to open/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Use Farcaster inbox' }))
    expect(reloadDocument).toHaveBeenCalledOnce()
  })

  it('uses an unreadable selector recovery choice for this mounted session only', () => {
    const reloadDocument = vi.fn()
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )
    expect(mocks.messaging).toHaveBeenLastCalledWith({
      autoConnect: false,
      inboxTarget: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use Farcaster inbox' }))

    expect(mocks.messaging).toHaveBeenLastCalledWith({
      autoConnect: true,
      inboxTarget: null,
    })
    expect(screen.getByRole('heading', { name: 'pierce' })).toBeVisible()
    expect(reloadDocument).not.toHaveBeenCalled()
    getItem.mockRestore()
    removeItem.mockRestore()
  })

  it('closes stale ENS review instead of retrying a changed mapping forever', async () => {
    const candidate = {
      address: '0x2222222222222222222222222222222222222222' as const,
      name: 'deanpierce.eth',
    }
    const prepareInboxSwitch = vi.fn()
    mocks.ens.mockReturnValue(readyEns({
      candidate,
      preference: null,
      refresh: vi.fn().mockResolvedValue({
        candidate: {
          address: '0x3333333333333333333333333333333333333333',
          name: 'updated.eth',
        },
        preference: null,
        relationship: 'different-inbox',
        status: 'ready',
      }),
      relationship: 'different-inbox',
      status: 'ready',
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      prepareInboxSwitch,
    })
    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    fireEvent.click(screen.getByRole('button', { name: 'Review inbox switch' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Connect wallet and join deanpierce.eth',
    }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /ENS name or XMTP inbox changed/i,
    )
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: 'Review updated identity',
    })).toBeVisible()
    expect(prepareInboxSwitch).not.toHaveBeenCalled()
  })

  it('wires ENS recipient resolution through reachability before opening a DM', async () => {
    const target = '0xde709f2102306220921060314715629080e2fb77'
    const resolve = vi.fn().mockResolvedValue({
      address: target,
      name: 'deanpierce.eth',
    })
    const inspectIdentityRelationship = vi.fn().mockResolvedValue('different-inbox')
    const canMessageAddress = vi.fn().mockResolvedValue(true)
    const createDm = vi.fn().mockResolvedValue(undefined)
    mocks.recipientResolution.mockReturnValue({
      ...readyRecipientResolution(),
      resolve,
    })
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      canMessageAddress,
      createDm,
      inspectIdentityRelationship,
      view: 'new-dm',
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)
    fireEvent.change(screen.getByLabelText('Ethereum address or ENS name'), {
      target: { value: 'DeanPierce.ETH' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check recipient' }))

    expect(await screen.findByText('deanpierce.eth')).toBeVisible()
    expect(resolve).toHaveBeenCalledWith('DeanPierce.ETH')
    expect(inspectIdentityRelationship).toHaveBeenCalledWith(target)
    expect(canMessageAddress).toHaveBeenCalledWith(target)
    expect(createDm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open DM' }))
    expect(createDm).toHaveBeenCalledWith(target)
  })

  it('clears recipient-resolution state when entering and leaving New Message', () => {
    const reset = vi.fn()
    const setView = vi.fn()
    const backToInbox = vi.fn()
    mocks.recipientResolution.mockReturnValue({
      ...readyRecipientResolution(),
      error: 'An old ENS error',
      reset,
    })
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      backToInbox,
      setView,
    })

    const inbox = render(
      <MessagingApp canUseBack={false} canUseWallet user={user} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'New DM' }))
    expect(reset).toHaveBeenCalledOnce()
    expect(setView).toHaveBeenCalledWith('new-dm')
    expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
      setView.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )

    inbox.unmount()
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      backToInbox,
      view: 'new-dm',
    })
    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)
    expect(screen.getByRole('alert')).toHaveTextContent('An old ENS error')
    fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }))

    expect(reset).toHaveBeenCalledTimes(2)
    expect(backToInbox).toHaveBeenCalledOnce()
    expect(reset.mock.invocationCallOrder[1]).toBeLessThan(
      backToInbox.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })
})

function readyMessaging() {
  return {
    activeConversation: null,
    address: '0x1111111111111111111111111111111111111111',
    backToInbox: vi.fn(),
    connect: vi.fn(),
    connectExternalWallet: vi.fn(),
    connection: { error: null, phase: 'ready' },
    conversations: [],
    createDm: vi.fn(),
    disconnect: vi.fn(),
    environment: 'dev',
    externalWalletPairingUri: null,
    hasOlderMessages: false,
    inspectIdentityRelationship: vi.fn(),
    prepareInboxSwitch: vi.fn(),
    canMessageAddress: vi.fn(),
    convosAccessRequest: null,
    loadOlderMessages: vi.fn(),
    loadingConversation: false,
    loadingOlder: false,
    messages: [],
    notice: null,
    openConversation: vi.fn(),
    refresh: vi.fn().mockResolvedValue(null),
    requestConvosAccess: vi.fn(),
    resetConvosAccessRequest: vi.fn(),
    refreshing: false,
    retryLiveUpdates: vi.fn(),
    retryConvosAccess: vi.fn(),
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

function readyRecipientResolution() {
  return {
    error: null,
    errorCode: null,
    query: null,
    reset: vi.fn(),
    resolve: vi.fn(),
    result: null,
    status: 'idle',
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
