import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessagingApp } from './MessagingApp'

const mocks = vi.hoisted(() => ({
  alerts: vi.fn(),
  ens: vi.fn(),
  miniAppBack: vi.fn(),
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
  useMiniAppBack: mocks.miniAppBack,
}))

vi.mock('../notifications/useFarcasterAlerts', () => ({
  useFarcasterAlerts: mocks.alerts,
}))

const user = { fid: 403, username: 'pierce' }

describe('MessagingApp storage and installation states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mocks.alerts.mockReturnValue(readyAlerts())
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
      notificationFid: user.fid,
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
      notificationFid: user.fid,
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

  it('passes only host alert booleans into one-time inbox assistance', () => {
    mocks.alerts.mockReturnValue(readyAlerts({
      added: true,
      available: true,
      promptVisible: true,
      supported: true,
    }))

    render(
      <MessagingApp
        canAddMiniApp
        canUseBack={false}
        canUseWallet
        initiallyMiniAppAdded
        initiallyNotificationsEnabled={false}
        user={user}
      />,
    )

    expect(mocks.alerts).toHaveBeenCalledWith({
      canAddMiniApp: true,
      canPrompt: true,
      fid: user.fid,
      initiallyAdded: true,
      initiallyNotificationsEnabled: false,
    })
    expect(screen.getByRole('button', { name: 'How to enable' })).toBeVisible()
    expect(screen.queryByText(/token|delivery url/i)).not.toBeInTheDocument()
  })

  it('registers the open XMTP installation only after native alerts are enabled', async () => {
    const syncAlerts = vi.fn().mockResolvedValue(undefined)
    mocks.alerts.mockReturnValue(readyAlerts({
      available: true,
      notificationsEnabled: true,
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      syncAlerts,
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    await waitFor(() => expect(syncAlerts).toHaveBeenCalledOnce())
  })

  it('does not invoke authenticated cleanup merely because alerts start off', async () => {
    const disableAlerts = vi.fn().mockResolvedValue(undefined)
    const syncAlerts = vi.fn().mockResolvedValue(undefined)
    mocks.alerts.mockReturnValue(readyAlerts({
      available: true,
      notificationsEnabled: false,
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      disableAlerts,
      syncAlerts,
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    await waitFor(() => expect(disableAlerts).not.toHaveBeenCalled())
    expect(syncAlerts).not.toHaveBeenCalled()
  })

  it('revokes XMTP alert material after host permission changes from on to off', async () => {
    const disableAlerts = vi.fn().mockResolvedValue(undefined)
    const syncAlerts = vi.fn().mockResolvedValue(undefined)
    let notificationsEnabled = true
    mocks.alerts.mockImplementation(() => readyAlerts({
      available: true,
      notificationsEnabled,
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      disableAlerts,
      syncAlerts,
    })

    const view = render(<MessagingApp canUseBack={false} canUseWallet user={user} />)
    await waitFor(() => expect(syncAlerts).toHaveBeenCalledOnce())

    notificationsEnabled = false
    view.rerender(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    await waitFor(() => expect(disableAlerts).toHaveBeenCalledOnce())
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

  it('opens the first conversation without remounting the app or reloading the document', async () => {
    const lifecycle = { cleanups: 0, mounts: 0 }
    const reloadDocument = vi.fn()
    const conversation = {
      id: 'conversation-1',
      kind: 'dm' as const,
      peerAddress: '0x2222222222222222222222222222222222222222' as const,
      peerInboxId: 'peer-inbox',
    }
    const summary = {
      ...conversation,
      isOwnLastMessage: false,
      preview: 'Saved locally',
      updatedAt: new Date('2026-07-15T20:00:00Z'),
    }
    mocks.messaging.mockImplementation(function useStatefulMessagingMock() {
      const [activeConversation, setActiveConversation] = useState<
        typeof conversation | null
      >(null)
      useEffect(() => {
        lifecycle.mounts += 1
        return () => {
          lifecycle.cleanups += 1
        }
      }, [])

      return {
        ...readyMessaging(),
        activeConversation,
        conversations: [summary],
        openConversation: async () => setActiveConversation(conversation),
        view: activeConversation ? 'conversation' as const : 'inbox' as const,
      }
    })

    const rendered = render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )
    const originalAppNode = rendered.container.querySelector('.messaging-app')

    fireEvent.click(screen.getByRole('button', {
      name: /0x2222222222222222222222222222222222222222/i,
    }))
    expect(await screen.findByRole('heading', {
      name: '0x2222222222222222222222222222222222222222',
    })).toBeVisible()

    expect(rendered.container.querySelector('.messaging-app')).toBe(originalAppNode)
    expect(lifecycle).toEqual({ cleanups: 0, mounts: 1 })
    expect(reloadDocument).not.toHaveBeenCalled()

    rendered.unmount()
    expect(lifecycle.cleanups).toBe(1)
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

  it('freshly verifies and remembers a one-time ENS identity binding', async () => {
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
    const bindEnsInbox = vi.fn().mockResolvedValue({
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
      bindEnsInbox,
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
    fireEvent.click(screen.getByRole('button', { name: 'Review identity binding' }))

    expect(screen.getByRole('dialog', {
      name: 'Bind your Farcaster wallet to deanpierce.eth?',
    })).toBeVisible()
    expect(screen.getByText(/permanently reassigns your Farcaster wallet key/i)).toBeVisible()
    expect(screen.getByText(/inboxes do not merge/i)).toBeVisible()
    expect(screen.getByText(/future launches will not reconnect/i)).toBeVisible()
    expect(screen.getAllByText(candidate.address)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', {
      name: 'Bind Farcaster wallet to deanpierce.eth',
    }))

    await screen.findByText(/Binding confirmed/i)
    expect(refresh).toHaveBeenCalledOnce()
    expect(bindEnsInbox).toHaveBeenCalledWith(
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
      sourceAddress: '0x1111111111111111111111111111111111111111',
      version: 4,
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
    const bindEnsInbox = vi.fn().mockRejectedValue(unavailable)
    const reloadDocument = vi.fn()
    mocks.ens.mockReturnValue(readyEns({
      ...fresh,
      refresh: vi.fn().mockResolvedValue(fresh),
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      bindEnsInbox,
    })

    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review identity binding' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Bind Farcaster wallet to deanpierce.eth',
    }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /connected wallet is not exposing 0x2222/i,
    )
    expect(reloadDocument).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).toBeNull()
  })

  it('allows cancellation while the identity and wallet checks are reversible', async () => {
    const candidate = {
      address: '0x2222222222222222222222222222222222222222' as const,
      name: 'deanpierce.eth',
    }
    const fresh = deferred<ReturnType<typeof readyEns>>()
    const refresh = vi.fn().mockReturnValue(fresh.promise)
    const bindEnsInbox = vi.fn()
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
      bindEnsInbox,
    })
    render(
      <MessagingApp
        canUseBack={false}
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review identity binding' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Bind Farcaster wallet to deanpierce.eth',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel connection' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => fresh.resolve(readyEns({
      candidate,
      preference: null,
      relationship: 'different-inbox',
      status: 'ready',
    })))

    expect(bindEnsInbox).not.toHaveBeenCalled()
    expect(reloadDocument).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).toBeNull()
  })

  it('keeps the dialog mounted after the irreversible binding boundary', async () => {
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
    const binding = deferred<{
      address: typeof candidate.address
      chainId: string
      inboxId: string
      walletKind: 'EOA'
    }>()
    const bindEnsInbox = vi.fn((
      _address: typeof candidate.address,
      options: { onCommitting?: (() => void) | undefined },
    ) => {
      options.onCommitting?.()
      return binding.promise
    })
    const reloadDocument = vi.fn()
    mocks.ens.mockReturnValue(readyEns({
      ...fresh,
      refresh: vi.fn().mockResolvedValue(fresh),
    }))
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      bindEnsInbox,
    })
    render(
      <MessagingApp
        canUseBack
        canUseWallet
        reloadDocument={reloadDocument}
        user={user}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review identity binding' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Bind Farcaster wallet to deanpierce.eth',
    }))

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(
      /Binding the Farcaster wallet.*Keep this window open/i,
    ))
    expect(screen.queryByRole('button', { name: /cancel|keep this inbox/i }))
      .not.toBeInTheDocument()
    const hostBack = mocks.miniAppBack.mock.calls.at(-1)?.[2] as (() => void)
    act(() => hostBack())
    expect(screen.getByRole('dialog')).toBeVisible()
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    )
    expect(screen.getByRole('dialog')).toBeVisible()

    await act(async () => binding.resolve({
      address: candidate.address,
      chainId: '1',
      inboxId: 'target-inbox',
      walletKind: 'EOA',
    }))
    await waitFor(() => expect(reloadDocument).toHaveBeenCalledOnce())
    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).not.toBeNull()
  })

  it('still reloads after a confirmed network binding when its label cannot be saved', async () => {
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
      bindEnsInbox: vi.fn().mockResolvedValue({
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
    fireEvent.click(screen.getByRole('button', { name: 'Review identity binding' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Bind Farcaster wallet to deanpierce.eth',
    }))

    await waitFor(() => expect(reloadDocument).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    setItem.mockRestore()
    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).toBeNull()
  })

  it('requires explicit recovery for a legacy selector that never proved binding', () => {
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
      notificationFid: user.fid,
    })
    expect(screen.getByRole('heading', {
      name: 'Choose how to recover safely',
    })).toBeVisible()
    expect(screen.getByText(/unsupported version/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Use Farcaster inbox' }))

    expect(window.localStorage.getItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
    )).toBeNull()
    expect(reloadDocument).toHaveBeenCalledOnce()
  })

  it('opens a confirmed binding without offering an external-wallet reconnect', () => {
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: '0x2222222222222222222222222222222222222222',
        chainId: '1',
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 4,
        walletKind: 'EOA',
      }),
    )
    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(mocks.messaging).toHaveBeenCalledWith({
      autoConnect: true,
      inboxTarget: expect.objectContaining({
        name: 'deanpierce.eth',
        sourceAddress: '0x1111111111111111111111111111111111111111',
      }),
      notificationFid: user.fid,
    })
    fireEvent.click(screen.getByLabelText('Identity and privacy'))
    expect(screen.getByRole('heading', { name: 'Farcaster wallet' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Reconnect external wallet/i })).not.toBeInTheDocument()
  })

  it('never shows WalletConnect recovery during routine bound-inbox startup', () => {
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: '0x2222222222222222222222222222222222222222',
        chainId: '1',
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 4,
        walletKind: 'EOA',
      }),
    )
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: null,
      connection: { error: null, phase: 'wallet' },
    })

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('heading', {
      name: 'Connecting your Farcaster wallet',
    })).toBeVisible()
    expect(screen.queryByRole('img', { name: /WalletConnect QR/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open MetaMask' })).not.toBeInTheDocument()
  })

  it('uses the Farcaster address until the bound ENS name is freshly verified', () => {
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: '0x2222222222222222222222222222222222222222',
        chainId: '10',
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 4,
        walletKind: 'EOA',
      }),
    )
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: '0x1111111111111111111111111111111111111111',
    })
    mocks.ens.mockReturnValue(readyEns({ status: 'unavailable' }))

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('heading', { name: '0x1111…1111' })).toBeVisible()
    expect(screen.queryByText('deanpierce.eth')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'pierce' })).not.toBeInTheDocument()
  })

  it('shows a freshly reverified target name without another automatic decision', () => {
    const targetAddress = '0x2222222222222222222222222222222222222222'
    window.localStorage.setItem(
      `converge-miniapp:ens-inbox-target:${user.fid}`,
      JSON.stringify({
        address: targetAddress,
        chainId: '10',
        inboxId: 'target-inbox',
        name: 'deanpierce.eth',
        sourceAddress: '0x1111111111111111111111111111111111111111',
        version: 4,
        walletKind: 'EOA',
      }),
    )
    mocks.messaging.mockReturnValue({
      ...readyMessaging(),
      address: '0x1111111111111111111111111111111111111111',
    })
    mocks.ens.mockReturnValue(readyEns({
      candidate: { address: targetAddress, name: 'deanpierce.eth' },
      preference: null,
      relationship: 'same-inbox',
      status: 'ready',
    }))

    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    expect(screen.getByRole('heading', { name: 'deanpierce.eth' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Identity and privacy'))
    expect(screen.queryByRole('button', { name: 'Use ENS name' })).not.toBeInTheDocument()
    expect(screen.getByText('ENS name verified for this inbox')).toBeVisible()
  })

  it('honors explicit legacy recovery for this session when the selector cannot be cleared', () => {
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

    expect(mocks.messaging).toHaveBeenLastCalledWith({
      autoConnect: true,
      inboxTarget: null,
      notificationFid: user.fid,
    })
    expect(screen.getByRole('heading', { name: 'pierce' })).toBeVisible()
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
      notificationFid: user.fid,
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
      notificationFid: user.fid,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use Farcaster inbox' }))

    expect(mocks.messaging).toHaveBeenLastCalledWith({
      autoConnect: true,
      inboxTarget: null,
      notificationFid: user.fid,
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
    const bindEnsInbox = vi.fn()
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
      bindEnsInbox,
    })
    render(<MessagingApp canUseBack={false} canUseWallet user={user} />)

    fireEvent.click(screen.getByRole('button', { name: 'Review identity binding' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Bind Farcaster wallet to deanpierce.eth',
    }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /ENS name or XMTP inbox changed/i,
    )
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: 'Review updated identity',
    })).toBeVisible()
    expect(bindEnsInbox).not.toHaveBeenCalled()
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
    connection: { error: null, phase: 'ready' },
    conversations: [],
    createDm: vi.fn(),
    disableAlerts: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    environment: 'dev',
    hasOlderMessages: false,
    inspectIdentityRelationship: vi.fn(),
    bindEnsInbox: vi.fn(),
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
    syncAlerts: vi.fn().mockResolvedValue(undefined),
    view: 'inbox',
    walletKind: 'EOA',
  }
}

function readyAlerts(overrides: Record<string, unknown> = {}) {
  return {
    added: false,
    available: false,
    dismissPrompt: vi.fn(),
    error: null,
    notificationsEnabled: false,
    pending: false,
    promptVisible: false,
    requestAlerts: vi.fn(),
    settingsHelpVisible: false,
    showSettingsHelp: vi.fn(),
    supported: false,
    ...overrides,
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
