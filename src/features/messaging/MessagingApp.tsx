import {
  AlertTriangle,
  PanelsTopLeft,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '../../components/Button'
import { StatePanel } from '../../components/StatePanel'
import { useMiniAppBack } from '../../app/useMiniAppBack'
import {
  allowAutomaticEnsDiscovery,
  useEnsIdentity,
  type EnsCandidate,
  type EnsIdentityState,
  type EnsPreference,
} from '../identity/useEnsIdentity'
import {
  clearInboxTarget,
  readInboxTarget,
  writeInboxTarget,
  type InboxTarget,
} from '../identity/inboxTarget'
import { useParticipantIdentities } from '../identity/useParticipantIdentities'
import { useRecipientResolution } from '../identity/useRecipientResolution'
import { useFarcasterAlerts } from '../notifications/useFarcasterAlerts'
import { ConversationScreen } from './ConversationScreen'
import { EnsInboxSwitchDialog } from './EnsInboxSwitchDialog'
import { shortIdentity } from './format'
import { InboxScreen } from './InboxScreen'
import { JoinConvosScreen } from './JoinConvosScreen'
import { NewDmScreen } from './NewDmScreen'
import { useXmtpMessaging, type ConnectionPhase } from './useXmtpMessaging'

type MessagingAppProps = {
  canAddMiniApp?: boolean
  canUseBack: boolean
  canUseWallet: boolean
  initiallyMiniAppAdded?: boolean
  initiallyNotificationsEnabled?: boolean
  reloadDocument?: () => void
  user: {
    displayName?: string
    fid: number
    pfpUrl?: string
    username?: string
  }
}

const reloadCurrentDocument = () => window.location.reload()

// The local nested-view back buttons are always present. Keep routine Farcaster
// native back toggles disabled until canonical hosts prove that changing their
// visibility does not disturb the webview. ENS binding is the exception: its
// irreversible boundary needs the host back callback to keep the dialog alive.
const ROUTINE_NATIVE_HOST_BACK_ENABLED = false

class EnsInboxSwitchFailure extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'EnsInboxSwitchFailure'
    this.code = code
  }
}

const STORAGE_WARNING_DISMISSAL_KEY =
  'converge-miniapp:storage-warning-dismissed:v1'

function storageWarningWasDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_WARNING_DISMISSAL_KEY) === '1'
  } catch {
    return false
  }
}

function freshTargetName(
  target: InboxTarget | null,
  identity: EnsIdentityState,
  activeAddress: `0x${string}`,
): string | undefined {
  if (
    !target ||
    target.sourceAddress.toLowerCase() !== activeAddress.toLowerCase() ||
    identity.status !== 'ready' ||
    !identity.candidate ||
    identity.candidate.name !== target.name ||
    identity.candidate.address.toLowerCase() !== target.address.toLowerCase() ||
    identity.relationship !== 'same-inbox'
  ) return undefined
  return target.name
}

const connectionCopy: Partial<Record<ConnectionPhase, {
  description: string
  eyebrow: string
  title: string
}>> = {
  storage: {
    description: 'XMTP needs secure browser storage, WebAssembly, a Worker, and a single-owner database lock before any wallet signature is requested.',
    eyebrow: 'Browser capability check',
    title: 'Checking local message storage',
  },
  locking: {
    description: 'Only one Converge Mini window can use the local XMTP database at a time.',
    eyebrow: 'Local safety check',
    title: 'Securing message storage',
  },
  wallet: {
    description: 'Farcaster may ask you to approve wallet access. This does not send a transaction.',
    eyebrow: 'Host wallet',
    title: 'Connecting your Farcaster wallet',
  },
  xmtp: {
    description: 'XMTP may request wallet signatures to create or resume your encrypted messaging installation. No gas is charged.',
    eyebrow: 'XMTP identity',
    title: 'Confirm inbox access in your wallet',
  },
  history: {
    description: 'A new Mini App installation can ask another compatible online installation for a re-encrypted archive. Recovery is best-effort and may return no older history.',
    eyebrow: 'Optional history recovery',
    title: 'Requesting available message history',
  },
  syncing: {
    description: 'Conversations and message content are decrypted locally in this browser.',
    eyebrow: 'Private inbox',
    title: 'Syncing your allowed messages',
  },
}

export function MessagingApp({
  canAddMiniApp = false,
  canUseBack,
  canUseWallet,
  initiallyMiniAppAdded = false,
  initiallyNotificationsEnabled = false,
  reloadDocument = reloadCurrentDocument,
  user,
}: MessagingAppProps) {
  const [ensPromptSuppressed, setEnsPromptSuppressed] = useState(false)
  const [ensSwitchCandidate, setEnsSwitchCandidate] = useState<EnsCandidate | null>(null)
  const [ignoreInboxSelection, setIgnoreInboxSelection] = useState(false)
  const [storageWarningDismissed, setStorageWarningDismissed] = useState(
    storageWarningWasDismissed,
  )
  const [targetRecoveryError, setTargetRecoveryError] = useState<string | null>(null)
  const [conversationReturnFocusId, setConversationReturnFocusId] = useState<string | null>(null)
  const switchReturnFocusRef = useRef<HTMLElement | null>(null)
  const switchCommittedRef = useRef(false)
  const inboxTargetState = useMemo(() => readInboxTarget(user.fid), [user.fid])
  const selectionBlocked = !ignoreInboxSelection && (
    inboxTargetState.status === 'invalid' ||
    inboxTargetState.status === 'unavailable'
  )
  const inboxTarget = !ignoreInboxSelection && inboxTargetState.status === 'valid'
    ? inboxTargetState.target
    : null
  const messaging = useXmtpMessaging({
    autoConnect: canUseWallet && !selectionBlocked,
    inboxTarget,
    notificationFid: user.fid,
  })
  const alerts = useFarcasterAlerts({
    canAddMiniApp,
    canPrompt: messaging.connection.phase === 'ready' &&
      messaging.view === 'inbox' &&
      messaging.streamHealth !== 'offline',
    fid: user.fid,
    initiallyAdded: initiallyMiniAppAdded,
    initiallyNotificationsEnabled,
  })
  const messagingPhase = messaging.connection.phase
  const disableMessagingAlerts = messaging.disableAlerts
  const setMessagingNotice = messaging.setNotice
  const syncMessagingAlerts = messaging.syncAlerts
  const previousNotificationsEnabledRef = useRef(alerts.notificationsEnabled)
  useEffect(() => {
    if (
      !alerts.available ||
      messagingPhase !== 'ready'
    ) return

    let cancelled = false
    const wasEnabled = previousNotificationsEnabledRef.current
    previousNotificationsEnabledRef.current = alerts.notificationsEnabled
    if (!alerts.notificationsEnabled && !wasEnabled) return

    const update = alerts.notificationsEnabled ? syncMessagingAlerts : disableMessagingAlerts
    void update().catch(() => {
      if (cancelled) return
      setMessagingNotice(
        alerts.notificationsEnabled
          ? 'Farcaster alerts are on, but this inbox could not finish alert registration. Reopen Converge Mini while online to retry.'
          : 'Farcaster notifications are off, but alert cleanup could not reach the relay. Converge Mini will retry while it is open.',
      )
    })

    return () => {
      cancelled = true
    }
  }, [
    alerts.available,
    alerts.notificationsEnabled,
    disableMessagingAlerts,
    messagingPhase,
    setMessagingNotice,
    syncMessagingAlerts,
  ])
  const recipientResolution = useRecipientResolution()
  const ensIdentity = useEnsIdentity({
    enabled: messaging.connection.phase === 'ready' && messaging.address !== null,
    fid: user.fid,
    inspectRelationship: messaging.inspectIdentityRelationship,
  })
  const participantAddresses = useMemo(() => [
    messaging.activeConversation?.peerAddress,
    ...messaging.conversations.map((conversation) => conversation.peerAddress),
  ], [messaging.activeConversation?.peerAddress, messaging.conversations])
  const participantIdentities = useParticipantIdentities({
    addresses: participantAddresses,
    enabled: messaging.connection.phase === 'ready',
  })
  const messagingBackToInbox = messaging.backToInbox
  const resetRecipientResolution = recipientResolution.reset
  const backToInbox = useCallback(() => {
    resetRecipientResolution()
    messagingBackToInbox()
  }, [messagingBackToInbox, resetRecipientResolution])
  const backFromConvos = useCallback(() => {
    setConversationReturnFocusId(null)
    backToInbox()
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-join-convos]')?.focus()
    })
  }, [backToInbox])
  const backFromConversation = useCallback(() => {
    setConversationReturnFocusId(messaging.activeConversation?.id ?? null)
    messagingBackToInbox()
  }, [messaging.activeConversation?.id, messagingBackToInbox])
  const closeEnsSwitch = useCallback(() => {
    if (switchCommittedRef.current) return
    setEnsSwitchCandidate(null)
    window.requestAnimationFrame(() => switchReturnFocusRef.current?.focus())
  }, [])
  const reviewEnsSwitch = useCallback((returnFocus: HTMLElement | null) => {
    if (
      !ensIdentity.candidate ||
      ensIdentity.relationship !== 'different-inbox'
    ) return
    switchReturnFocusRef.current = returnFocus
    switchCommittedRef.current = false
    setEnsSwitchCandidate({ ...ensIdentity.candidate })
  }, [ensIdentity.candidate, ensIdentity.relationship])
  const confirmEnsSwitch = useCallback(async (
    candidate: EnsCandidate,
    signal: AbortSignal,
    onPairingUri: (uri: string) => void,
    onCommitting: () => void,
  ) => {
    const sourceAddress = messaging.address
    if (!sourceAddress) {
      throw new EnsInboxSwitchFailure(
        'ens-switch-preflight-failed',
        'Converge Mini could not verify the current Farcaster inbox. Your current inbox is unchanged.',
      )
    }

    const fresh = await ensIdentity.refresh()
    if (signal.aborted) return
    if (
      !fresh ||
      fresh.status !== 'ready' ||
      fresh.relationship !== 'different-inbox' ||
      !fresh.candidate ||
      fresh.candidate.name !== candidate.name ||
      fresh.candidate.address.toLowerCase() !== candidate.address.toLowerCase()
    ) {
      throw new EnsInboxSwitchFailure(
        'ens-switch-candidate-changed',
        'That ENS name or XMTP inbox changed during the safety check. Your current inbox is unchanged; review the updated identity before trying again.',
      )
    }

    let binding: Awaited<ReturnType<typeof messaging.bindEnsInbox>>
    try {
      binding = await messaging.bindEnsInbox(candidate.address, {
        onCommitting: () => {
          switchCommittedRef.current = true
          onCommitting()
        },
        onPairingUri,
        signal,
      })
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string' &&
        (error.code.startsWith('walletconnect-') ||
          error.code.startsWith('ens-binding-'))
      ) throw error
      throw new EnsInboxSwitchFailure(
        'ens-switch-preflight-failed',
        'Converge Mini could not verify the exact ENS inbox and signer. Your current inbox is unchanged.',
      )
    }
    if (signal.aborted) return
    if (binding.address.toLowerCase() !== candidate.address.toLowerCase()) {
      throw new EnsInboxSwitchFailure(
        'ens-switch-preflight-failed',
        'XMTP returned a different ENS identity after binding. Reload before continuing.',
      )
    }

    writeInboxTarget(user.fid, {
      address: binding.address,
      inboxId: binding.inboxId,
      name: candidate.name,
      sourceAddress,
      walletKind: binding.walletKind,
      chainId: binding.chainId,
    })
    allowAutomaticEnsDiscovery(user.fid)
  }, [ensIdentity, messaging, user.fid])
  const useFarcasterInbox = useCallback(() => {
    setTargetRecoveryError(null)
    if (!clearInboxTarget(user.fid)) {
      if (selectionBlocked) {
        // The user explicitly chose the host-preferred inbox. If Web Storage
        // cannot be mutated, honor that choice for this mounted session only.
        setIgnoreInboxSelection(true)
        return
      }
      setTargetRecoveryError(
        'The saved inbox could not be cleared from this browser. No inbox was changed.',
      )
      return
    }
    reloadDocument()
  }, [reloadDocument, selectionBlocked, user.fid])
  const describeRecovery = useCallback((description: string) => (
    targetRecoveryError ? `${description} ${targetRecoveryError}` : description
  ), [targetRecoveryError])
  const handleHostBack = ensSwitchCandidate ? closeEnsSwitch : backToInbox
  const requiresEnsSwitchBackGuard = ensSwitchCandidate !== null
  useMiniAppBack(
    canUseBack && (
      requiresEnsSwitchBackGuard || ROUTINE_NATIVE_HOST_BACK_ENABLED
    ),
    messaging.connection.phase === 'ready' && (
      requiresEnsSwitchBackGuard || messaging.view !== 'inbox'
    ),
    handleHostBack,
  )

  if (selectionBlocked) {
    return (
      <StatePanel
        actions={(
          <>
            <Button onClick={reloadDocument}>Check storage again</Button>
            <Button variant="ghost" onClick={useFarcasterInbox}>
              Use Farcaster inbox
            </Button>
          </>
        )}
        description={inboxTargetState.status === 'invalid'
          ? 'A saved inbox selection is damaged or from an unsupported version. Converge Mini will not guess which inbox to open. Clear it only if you want the account Farcaster currently provides.'
          : 'Converge Mini cannot read the saved inbox selection in this browser. It will not guess which inbox to open. You can retry or explicitly use the account Farcaster currently provides for this session.'}
        eyebrow="Inbox selection recovery"
        icon={<AlertTriangle aria-hidden="true" />}
        title="Choose how to recover safely"
      />
    )
  }

  if (messaging.connection.phase === 'idle') {
    if (!canUseWallet) {
      return (
        <StatePanel
          description="This Farcaster client does not expose the host wallet access XMTP needs. Converge Mini will not substitute another wallet or generate a private key."
          eyebrow="Host wallet unavailable"
          icon={<AlertTriangle aria-hidden="true" />}
          title="This Farcaster client cannot open XMTP"
        />
      )
    }

    return (
      <StatePanel
        busy
        description={inboxTarget
          ? `Converge Mini is opening ${inboxTarget.name} with the Farcaster wallet bound to that XMTP inbox. The external ENS wallet is not used for normal sign-in.`
          : 'Converge Mini is preparing the XMTP inbox for the account supplied by Farcaster. Approve only the XMTP signature request shown by your host; it is not a transaction.'}
        eyebrow="Private inbox"
        title={inboxTarget ? 'Opening saved ENS inbox' : 'Opening your inbox'}
      />
    )
  }

  const progress = connectionCopy[messaging.connection.phase]
  if (progress) {
    return (
      <StatePanel
        busy
        description={progress.description}
        eyebrow={progress.eyebrow}
        title={progress.title}
      />
    )
  }

  if (messaging.connection.phase === 'locked') {
    return (
      <StatePanel
        actions={<Button onClick={messaging.connect}>Try again</Button>}
        description={messaging.connection.error ?? 'Close the other Converge Mini window, then retry.'}
        eyebrow="Already open"
        icon={<PanelsTopLeft aria-hidden="true" />}
        title="XMTP is active in another window"
      />
    )
  }

  if (messaging.connection.phase === 'restart-required') {
    return (
      <StatePanel
        actions={<Button onClick={reloadDocument}>Reload Mini App</Button>}
        description={describeRecovery(`${messaging.connection.error ?? 'XMTP setup stopped.'} Reload this Mini App before trying again so the local message database stays safe.`)}
        eyebrow="Safe restart needed"
        icon={<AlertTriangle aria-hidden="true" />}
        title="Reload before reconnecting"
      />
    )
  }

  if (messaging.connection.phase === 'unsupported-browser') {
    return (
      <StatePanel
        description={messaging.connection.error ?? 'This browser cannot safely open XMTP local storage.'}
        eyebrow="Unsupported browser storage"
        icon={<AlertTriangle aria-hidden="true" />}
        title="XMTP cannot open safely here"
      />
    )
  }

  if (messaging.connection.phase === 'storage-error') {
    return (
      <StatePanel
        actions={<Button onClick={reloadDocument}>Reload Mini App</Button>}
        description={describeRecovery(messaging.connection.error ?? 'The local XMTP database could not open safely.')}
        eyebrow="Local message storage"
        icon={<AlertTriangle aria-hidden="true" />}
        title="Browser storage needs attention"
      />
    )
  }

  if (messaging.connection.phase === 'installation-limit') {
    return (
      <StatePanel
        description={describeRecovery(messaging.connection.error ?? 'Revoke an old installation in another XMTP client before returning.')}
        eyebrow="XMTP installation limit"
        icon={<AlertTriangle aria-hidden="true" />}
        title="This inbox has no installation slot"
      />
    )
  }

  if (messaging.connection.phase === 'inbox-update-limit') {
    return (
      <StatePanel
        description={describeRecovery(messaging.connection.error ?? 'This inbox cannot accept more identity updates.')}
        eyebrow="Permanent XMTP inbox limit"
        icon={<AlertTriangle aria-hidden="true" />}
        title="This inbox cannot add another installation"
      />
    )
  }

  if (messaging.connection.phase === 'configuration-error') {
    return (
      <StatePanel
        description={describeRecovery(messaging.connection.error ?? 'Converge Mini is not configured for this XMTP network yet.')}
        eyebrow="XMTP network configuration"
        icon={<AlertTriangle aria-hidden="true" />}
        title="Messaging is not available yet"
      />
    )
  }

  if (messaging.connection.phase === 'target-unavailable' && inboxTarget) {
    return (
      <StatePanel
        actions={(
          <>
            <Button onClick={messaging.connect}>Check again</Button>
          </>
        )}
        description={describeRecovery(`Farcaster is not exposing the bound wallet ${inboxTarget.sourceAddress}. The ENS owner wallet is intentionally not used for routine sign-in.`)}
        eyebrow="Exact signer unavailable"
        icon={<AlertTriangle aria-hidden="true" />}
        title="The bound Farcaster wallet isn’t available"
      />
    )
  }

  if (messaging.connection.phase === 'target-mismatch' && inboxTarget) {
    return (
      <StatePanel
        description={describeRecovery('XMTP no longer opens the inbox verified for the saved ENS address. Converge Mini closed the unexpected client without rendering its messages.')}
        eyebrow="Saved inbox changed"
        icon={<AlertTriangle aria-hidden="true" />}
        title="The saved ENS inbox did not open safely"
      />
    )
  }

  if (messaging.connection.phase === 'target-source-mismatch' && inboxTarget) {
    return (
      <StatePanel
        description={describeRecovery('This ENS inbox was bound to a different Farcaster wallet. Converge Mini did not request an XMTP signature or open another inbox.')}
        eyebrow="Farcaster account changed"
        icon={<AlertTriangle aria-hidden="true" />}
        title="Saved inbox selection does not match"
      />
    )
  }

  if (messaging.connection.phase === 'error') {
    return (
      <StatePanel
        actions={<Button onClick={messaging.connect}>Try again</Button>}
        description={describeRecovery(messaging.connection.error ?? 'Close this view and try opening the inbox again.')}
        eyebrow="Connection stopped"
        icon={<AlertTriangle aria-hidden="true" />}
        title="The inbox did not open"
      />
    )
  }

  if (messaging.connection.phase !== 'ready' || !messaging.address) return null

  const setEnsPreference = async (choice: Exclude<EnsPreference, null>) => {
    try {
      await ensIdentity.setPreference(choice)
    } catch (error) {
      messaging.setNotice(error instanceof Error
        ? error.message
        : 'The ENS preference could not be saved.')
    }
  }
  const clearEnsPreference = async () => {
    setEnsPromptSuppressed(true)
    try {
      await ensIdentity.clearPreference()
    } catch (error) {
      messaging.setNotice(error instanceof Error
        ? error.message
        : 'The saved ENS preference could not be deleted.')
    }
  }
  const dismissStorageWarning = () => {
    setStorageWarningDismissed(true)
    try {
      window.localStorage.setItem(STORAGE_WARNING_DISMISSAL_KEY, '1')
    } catch {
      // The warning still stays dismissed for this mounted app when site
      // storage is unavailable.
    }
  }
  const verifiedTargetName = freshTargetName(
    inboxTarget,
    ensIdentity,
    messaging.address,
  )
  const canOfferEns = !inboxTarget && ensIdentity.candidate &&
    ensIdentity.preference === null &&
    !ensPromptSuppressed &&
    (ensIdentity.relationship === 'active-address' ||
      ensIdentity.relationship === 'same-inbox')
  const offline = messaging.streamHealth === 'offline'

  return (
    <div className={`messaging-app ${messaging.notice ? 'messaging-app--notice' : ''}`}>
      {ensSwitchCandidate && !offline ? (
        <EnsInboxSwitchDialog
          candidate={ensSwitchCandidate}
          onCancel={closeEnsSwitch}
          onConfirm={confirmEnsSwitch}
          onRestarting={() => {
            switchCommittedRef.current = true
            reloadDocument()
          }}
        />
      ) : null}
      {canOfferEns && ensIdentity.candidate && messaging.view === 'inbox' && !offline ? (
        <EnsIdentityOffer
          candidate={ensIdentity.candidate}
          onAccept={() => setEnsPreference('accepted')}
          onDecline={() => setEnsPreference('dismissed')}
        />
      ) : null}
      {messaging.storageDurability === 'best-effort' && !storageWarningDismissed ? (
        <div className="storage-warning">
          <AlertTriangle aria-hidden="true" />
          <span role="status">This browser may clear local message history.</span>
          <button
            aria-label="Dismiss local history warning"
            onClick={dismissStorageWarning}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {messaging.notice ? (
        <div className="app-notice" role="alert">
          <span>{messaging.notice}</span>
          <button type="button" onClick={() => messaging.setNotice(null)} aria-label="Dismiss message">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {messaging.view === 'inbox' ? (
        <InboxScreen
          activeInboxName={verifiedTargetName ?? (
            inboxTarget ? shortIdentity(messaging.address) : undefined
          )}
          address={messaging.address}
          alerts={alerts}
          conversations={messaging.conversations}
          ensIdentity={ensIdentity}
          ensTargetNameVerified={verifiedTargetName !== undefined}
          environment={`${messaging.environment} · ${messaging.walletKind ?? 'wallet'}`}
          onClearEnsPreference={() => void clearEnsPreference()}
          onJoinConvos={() => {
            setConversationReturnFocusId(null)
            messaging.setView('join-convos')
          }}
          onNewDm={() => {
            setConversationReturnFocusId(null)
            resetRecipientResolution()
            messaging.setView('new-dm')
          }}
          onOpen={messaging.openConversation}
          onRefresh={messaging.refresh}
          onRefreshEns={ensIdentity.refresh}
          onReviewEnsSwitch={inboxTarget || offline ? undefined : reviewEnsSwitch}
          onRetryLiveUpdates={messaging.retryLiveUpdates}
          onUseEns={() => void setEnsPreference('accepted')}
          participantIdentityFor={participantIdentities.identityFor}
          profile={user}
          recoveryError={targetRecoveryError}
          refreshing={messaging.refreshing}
          returnFocusConversationId={conversationReturnFocusId}
          streamHealth={messaging.streamHealth}
        />
      ) : null}

      {messaging.view === 'new-dm' ? (
        <NewDmScreen
          offline={offline}
          ownAddress={messaging.address}
          onBack={backToInbox}
          onCheckReachability={messaging.canMessageAddress}
          onCreate={messaging.createDm}
          onInspectIdentity={messaging.inspectIdentityRelationship}
          onResetResolution={recipientResolution.reset}
          onResolveEns={recipientResolution.resolve}
          resolutionError={recipientResolution.error}
        />
      ) : null}

      {messaging.view === 'join-convos' ? (
        <JoinConvosScreen
          offline={offline}
          onBack={backFromConvos}
          onOpenConversation={(conversationId) => void messaging.openConversation(conversationId)}
          onRequestAccess={messaging.requestConvosAccess}
          onReset={messaging.resetConvosAccessRequest}
          onRetry={messaging.retryConvosAccess}
          request={messaging.convosAccessRequest}
        />
      ) : null}

      {messaging.view === 'conversation' && messaging.activeConversation ? (
        <ConversationScreen
          conversation={messaging.activeConversation}
          hasOlder={messaging.hasOlderMessages}
          loading={messaging.loadingConversation}
          loadingOlder={messaging.loadingOlder}
          messages={messaging.messages}
          onBack={backFromConversation}
          onLoadOlder={messaging.loadOlderMessages}
          onRetry={messaging.retryMessage}
          onRetryLiveUpdates={messaging.retryLiveUpdates}
          onSend={messaging.sendMessage}
          participantIdentity={participantIdentities.identityFor(
            messaging.activeConversation.peerAddress,
          )}
          sending={messaging.sending}
          streamHealth={messaging.streamHealth}
        />
      ) : null}
    </div>
  )
}

type EnsIdentityOfferProps = {
  candidate: EnsCandidate
  onAccept: () => Promise<void>
  onDecline: () => Promise<void>
}

function EnsIdentityOffer({ candidate, onAccept, onDecline }: EnsIdentityOfferProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [saving, setSaving] = useState(false)

  const save = async (action: () => Promise<void>) => {
    if (saving) return
    setSaving(true)
    try {
      await action()
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')

    return () => {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [])

  return (
    <dialog
      aria-describedby="ens-offer-description"
      aria-labelledby="ens-offer-title"
      className="ens-offer"
      onCancel={(event) => {
        event.preventDefault()
        void save(onDecline)
      }}
      ref={dialogRef}
    >
      <section
        className="ens-offer__card"
      >
        <p className="eyebrow">ENS identity found</p>
        <h2 id="ens-offer-title">Use {candidate.name} for this inbox?</h2>
        <p id="ens-offer-description">
          This forward-verified ENS primary name resolves to an address already in this XMTP inbox. Using it changes the label only; no key or message history moves.
        </p>
        <div className="ens-offer__actions">
          <Button
            autoFocus
            busy={saving}
            onClick={() => void save(onAccept)}
          >
            Use ENS name
          </Button>
          <Button
            disabled={saving}
            variant="ghost"
            onClick={() => void save(onDecline)}
          >
            No thanks
          </Button>
        </div>
      </section>
    </dialog>
  )
}
