import {
  ArrowDownUp,
  CircleUserRound,
  MessageCircleMore,
  Plus,
  RefreshCw,
  WifiOff,
} from 'lucide-react'
import { useState } from 'react'

import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import type { EnsIdentityState } from '../identity/useEnsIdentity'
import type { ConversationSummary, StreamHealth } from './types'
import { conversationTime, shortIdentity } from './format'

type InboxScreenProps = {
  address: `0x${string}`
  conversations: ConversationSummary[]
  ensIdentity: EnsIdentityState
  environment: string
  onNewDm: () => void
  onOpen: (conversationId: string) => void
  onClearEnsPreference: () => void
  onRefresh: () => void
  onRefreshEns: () => void
  onRetryLiveUpdates: () => void
  onUseEns: () => void
  profile: {
    displayName?: string
    pfpUrl?: string
    username?: string
  }
  refreshing: boolean
  streamHealth: StreamHealth
}

export function InboxScreen({
  address,
  conversations,
  ensIdentity,
  environment,
  onNewDm,
  onOpen,
  onClearEnsPreference,
  onRefresh,
  onRefreshEns,
  onRetryLiveUpdates,
  onUseEns,
  profile,
  refreshing,
  streamHealth,
}: InboxScreenProps) {
  const [reviewingEns, setReviewingEns] = useState(false)
  const ensConnected = ensIdentity.preference === 'accepted' && (
    ensIdentity.relationship === 'active-address' ||
    ensIdentity.relationship === 'same-inbox'
  )
  const name = ensConnected && ensIdentity.candidate
    ? ensIdentity.candidate.name
    : profile.displayName ?? profile.username ?? shortIdentity(address)

  return (
    <section className="messaging-screen inbox-screen" aria-labelledby="inbox-title">
      <header className="screen-header">
        <div className="screen-identity">
          <Avatar name={name} src={profile.pfpUrl} />
          <div>
            <p className="eyebrow">Private inbox</p>
            <h1 id="inbox-title">{name}</h1>
            <span>{shortIdentity(address)} · {environment}</span>
          </div>
        </div>
        <details className="identity-menu">
          <summary className="icon-button" aria-label="Identity and privacy">
            <CircleUserRound aria-hidden="true" />
          </summary>
          <section className="identity-menu__panel" aria-labelledby="identity-menu-title">
            <p className="eyebrow">Connected identity</p>
            <h2 id="identity-menu-title">Farcaster wallet</h2>
            <code>{address}</code>
            <p>{environment}</p>
            <EnsMenuIdentity
              identity={ensIdentity}
              onClearPreference={onClearEnsPreference}
              onRefresh={onRefreshEns}
              onReview={() => setReviewingEns((current) => !current)}
              onUse={onUseEns}
              reviewing={reviewingEns}
            />
            <div className="identity-menu__privacy">
              <strong>Local message privacy</strong>
              <span>
                Host profile details are unverified display hints; this wallet selects the XMTP identity. Browser message storage is local but not encrypted at rest. XMTP history recovery is best effort. Use a device and browser profile you trust.
              </span>
            </div>
          </section>
        </details>
      </header>

      {streamHealth !== 'live' ? (
        <div className={`connection-banner connection-banner--${streamHealth}`} role="status">
          {streamHealth === 'retrying' ? <ArrowDownUp aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
          <span>
            {streamHealth === 'retrying'
              ? 'Live updates are reconnecting. Your local inbox is still available.'
              : 'Live updates paused. Pull a fresh sync when your connection returns.'}
          </span>
          <button type="button" onClick={onRetryLiveUpdates}>Refresh now</button>
        </div>
      ) : null}

      <div className="inbox-actions">
        <div>
          <h2>Messages</h2>
          <span>{conversations.length} conversation{conversations.length === 1 ? '' : 's'}</span>
        </div>
        <div className="inbox-actions__buttons">
          <button
            className="icon-button"
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh inbox"
          >
            <RefreshCw className={refreshing ? 'is-spinning' : ''} aria-hidden="true" />
          </button>
          <Button onClick={onNewDm}>
            <Plus aria-hidden="true" />
            New DM
          </Button>
        </div>
      </div>

      {conversations.length ? (
        <ul className="conversation-list">
          {conversations.map((conversation) => {
            const identity = conversation.peerAddress ?? conversation.peerInboxId
            return (
              <li key={conversation.id}>
                <button
                  className="conversation-row"
                  onClick={() => onOpen(conversation.id)}
                  type="button"
                >
                  <Avatar name={identity} />
                  <span className="conversation-row__body">
                    <span className="conversation-row__topline">
                      <strong>{shortIdentity(identity)}</strong>
                      <time dateTime={conversation.updatedAt?.toISOString()}>
                        {conversationTime(conversation.updatedAt)}
                      </time>
                    </span>
                    <span className="conversation-row__preview">
                      {conversation.isOwnLastMessage ? 'You: ' : ''}{conversation.preview}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="empty-inbox">
          <span className="empty-inbox__icon"><MessageCircleMore aria-hidden="true" /></span>
          <h2>No allowed conversations yet</h2>
          <p>Start with an Ethereum address that already has an XMTP inbox.</p>
          <Button onClick={onNewDm}>
            <Plus aria-hidden="true" />
            Start a private message
          </Button>
        </div>
      )}
    </section>
  )
}

type EnsMenuIdentityProps = {
  identity: EnsIdentityState
  onClearPreference: () => void
  onRefresh: () => void
  onReview: () => void
  onUse: () => void
  reviewing: boolean
}

function EnsMenuIdentity({
  identity,
  onClearPreference,
  onRefresh,
  onReview,
  onUse,
  reviewing,
}: EnsMenuIdentityProps) {
  const candidate = identity.candidate
  const alreadyConnected = identity.relationship === 'active-address' ||
    identity.relationship === 'same-inbox'

  if (!candidate) {
    return (
      <div className="identity-menu__ens">
        <strong>ENS inbox</strong>
        <span>{identity.preference === 'dismissed' && identity.status === 'idle'
          ? 'You declined the automatic ENS offer on this device.'
          : identity.status === 'checking'
          ? 'Checking your Farcaster primary address…'
          : identity.status === 'none'
            ? 'No forward-verified ENS primary name was found.'
            : 'ENS identity discovery is unavailable right now.'}</span>
        <button type="button" onClick={onRefresh} disabled={identity.status === 'checking'}>
          Check ENS identity
        </button>
        {identity.preference !== null ? (
          <button type="button" onClick={onClearPreference}>
            Delete saved ENS choice
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="identity-menu__ens">
      <strong>{candidate.name}</strong>
      <code>{candidate.address}</code>
      {alreadyConnected ? (
        <>
          <span>
            {identity.relationship === 'active-address'
              ? 'This name resolves to the Farcaster wallet already opening XMTP.'
              : 'This address is already associated with the active XMTP inbox.'}
          </span>
          {identity.preference === 'accepted' ? (
            <span className="identity-menu__connected">ENS name in use</span>
          ) : (
            <button type="button" onClick={onUse}>Use ENS name</button>
          )}
        </>
      ) : (
        <>
          <button type="button" onClick={onReview}>Connect ENS inbox</button>
          {reviewing ? (
            <span className="identity-menu__warning">
              {identity.relationship === 'different-inbox'
                ? 'This address belongs to a separate XMTP inbox. XMTP inboxes and their message histories cannot be merged.'
                : identity.relationship === 'no-inbox'
                  ? 'Farcaster does not expose this ENS address as a signer, so Converge Mini cannot safely add it to the active inbox.'
                  : 'XMTP could not verify how this address relates to the active inbox. No identity was changed.'}
            </span>
          ) : null}
        </>
      )}
      {identity.preference !== null ? (
        <button type="button" onClick={onClearPreference}>
          Delete saved ENS choice
        </button>
      ) : null}
    </div>
  )
}
