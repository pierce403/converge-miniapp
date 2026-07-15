import {
  AlertTriangle,
  LockKeyhole,
  PanelsTopLeft,
  ShieldCheck,
  X,
} from 'lucide-react'

import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { StatePanel } from '../../components/StatePanel'
import { ConversationScreen } from './ConversationScreen'
import { InboxScreen } from './InboxScreen'
import { NewDmScreen } from './NewDmScreen'
import { useXmtpMessaging, type ConnectionPhase } from './useXmtpMessaging'

type MessagingAppProps = {
  canUseWallet: boolean
  user: {
    displayName?: string
    fid: number
    pfpUrl?: string
    username?: string
  }
}

const connectionCopy: Partial<Record<ConnectionPhase, {
  description: string
  eyebrow: string
  title: string
}>> = {
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

export function MessagingApp({ canUseWallet, user }: MessagingAppProps) {
  const messaging = useXmtpMessaging()

  if (messaging.connection.phase === 'idle') {
    return (
      <IdentityWelcome
        canUseWallet={canUseWallet}
        connecting={false}
        onConnect={messaging.connect}
        user={user}
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
        actions={<Button onClick={() => window.location.reload()}>Reload Mini App</Button>}
        description={`${messaging.connection.error ?? 'XMTP setup stopped.'} Reload this Mini App before trying again so the local message database stays safe.`}
        eyebrow="Safe restart needed"
        icon={<AlertTriangle aria-hidden="true" />}
        title="Reload before reconnecting"
      />
    )
  }

  if (messaging.connection.phase === 'error') {
    return (
      <StatePanel
        actions={(
          <>
            <Button onClick={messaging.connect}>Try again</Button>
            <Button variant="ghost" onClick={messaging.disconnect}>Reset connection</Button>
          </>
        )}
        description={messaging.connection.error ?? 'Close this view and try opening the inbox again.'}
        eyebrow="Connection stopped"
        icon={<AlertTriangle aria-hidden="true" />}
        title="The inbox did not open"
      />
    )
  }

  if (messaging.connection.phase !== 'ready' || !messaging.address) return null

  return (
    <div className={`messaging-app ${messaging.notice ? 'messaging-app--notice' : ''}`}>
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
          address={messaging.address}
          conversations={messaging.conversations}
          environment={`${messaging.environment} · ${messaging.walletKind ?? 'wallet'}`}
          onDisconnect={messaging.disconnect}
          onNewDm={() => messaging.setView('new-dm')}
          onOpen={messaging.openConversation}
          onRefresh={messaging.refresh}
          onRetryLiveUpdates={messaging.retryLiveUpdates}
          profile={user}
          refreshing={messaging.refreshing}
          streamHealth={messaging.streamHealth}
        />
      ) : null}

      {messaging.view === 'new-dm' ? (
        <NewDmScreen
          ownAddress={messaging.address}
          onBack={messaging.backToInbox}
          onCreate={messaging.createDm}
        />
      ) : null}

      {messaging.view === 'conversation' && messaging.activeConversation ? (
        <ConversationScreen
          conversation={messaging.activeConversation}
          hasOlder={messaging.hasOlderMessages}
          loading={messaging.loadingConversation}
          loadingOlder={messaging.loadingOlder}
          messages={messaging.messages}
          onBack={messaging.backToInbox}
          onLoadOlder={messaging.loadOlderMessages}
          onRetry={messaging.retryMessage}
          onRetryLiveUpdates={messaging.retryLiveUpdates}
          onSend={messaging.sendMessage}
          sending={messaging.sending}
          streamHealth={messaging.streamHealth}
        />
      ) : null}
    </div>
  )
}

type IdentityWelcomeProps = MessagingAppProps & {
  connecting: boolean
  onConnect: () => void
}

function IdentityWelcome({ canUseWallet, connecting, onConnect, user }: IdentityWelcomeProps) {
  const name = user.displayName ?? user.username ?? `Farcaster user ${user.fid}`

  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome__glow" aria-hidden="true" />
      <div className="welcome__identity">
        <Avatar name={name} src={user.pfpUrl} size="large" />
        <div>
          <p className="eyebrow">Farcaster host profile</p>
          <h1 id="welcome-title">Hi, {name}</h1>
          {user.username ? <p className="welcome__username">@{user.username}</p> : null}
        </div>
      </div>

      <p className="welcome__lead">Your private XMTP inbox, without leaving Farcaster.</p>

      <div className="trust-list" aria-label="Connection details">
        <div className="trust-row">
          <span className="trust-row__icon"><LockKeyhole aria-hidden="true" /></span>
          <div>
            <strong>Wallet signatures, clearly explained</strong>
            <span>We explain XMTP setup before your wallet opens. Setup can require more than one approval.</span>
          </div>
        </div>
        <div className="trust-row">
          <span className="trust-row__icon"><ShieldCheck aria-hidden="true" /></span>
          <div>
            <strong>Your messages stay yours</strong>
            <span>Keys and decrypted message content remain in this browser.</span>
          </div>
        </div>
      </div>

      <Button
        busy={connecting}
        className="welcome__button"
        disabled={!canUseWallet}
        onClick={onConnect}
      >
        <LockKeyhole aria-hidden="true" />
        Open private inbox
      </Button>

      <div className={`capability-note ${canUseWallet ? 'capability-note--ready' : ''}`}>
        <span className="status-dot" aria-hidden="true" />
        {canUseWallet
          ? 'Farcaster wallet support is ready.'
          : 'This Farcaster client does not expose the wallet access XMTP needs.'}
      </div>
      <p className="storage-disclosure">
        Host profile details are unverified display hints; your wallet selects the XMTP identity. Browser message storage is local but not encrypted at rest. XMTP device history sync can re-encrypt and upload history for recovery by your other installations. Use a device and browser profile you trust.
      </p>
    </section>
  )
}
