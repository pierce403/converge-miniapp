import {
  ArrowDownUp,
  CircleUserRound,
  Link2,
  MessageCircleMore,
  Plus,
  RefreshCw,
  WifiOff,
} from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import type { EnsIdentityState } from '../identity/useEnsIdentity'
import {
  participantPresentation,
  type ParticipantIdentity,
} from '../identity/useParticipantIdentities'
import type { ConversationSummary, StreamHealth } from './types'
import { conversationTime, shortIdentity } from './format'

type InboxScreenProps = {
  activeInboxName?: string | undefined
  address: `0x${string}`
  conversations: ConversationSummary[]
  ensIdentity: EnsIdentityState
  ensTargetNameVerified?: boolean | undefined
  environment: string
  onJoinConvos: () => void
  onNewDm: () => void
  onOpen: (conversationId: string) => void
  onClearEnsPreference: () => void
  onRefresh: () => void
  onRefreshEns: () => void
  onReviewEnsSwitch?: ((returnFocus: HTMLElement | null) => void) | undefined
  onRetryLiveUpdates: () => void
  onUseFarcasterInbox?: (() => void) | undefined
  onUseEns: () => void
  participantIdentityFor: (address: string | null | undefined) => ParticipantIdentity | null
  profile: {
    displayName?: string
    pfpUrl?: string
    username?: string
  }
  recoveryError?: string | null | undefined
  refreshing: boolean
  returnFocusConversationId?: string | null | undefined
  streamHealth: StreamHealth
}

export function InboxScreen({
  activeInboxName,
  address,
  conversations,
  ensIdentity,
  ensTargetNameVerified = false,
  environment,
  onJoinConvos,
  onNewDm,
  onOpen,
  onClearEnsPreference,
  onRefresh,
  onRefreshEns,
  onReviewEnsSwitch,
  onRetryLiveUpdates,
  onUseFarcasterInbox,
  onUseEns,
  participantIdentityFor,
  profile,
  recoveryError,
  refreshing,
  returnFocusConversationId,
  streamHealth,
}: InboxScreenProps) {
  const identityMenuRef = useRef<HTMLDetailsElement>(null)
  const identitySummaryRef = useRef<HTMLElement>(null)
  const inboxTitleRef = useRef<HTMLHeadingElement>(null)
  const returnFocusConversationRef = useRef<HTMLButtonElement>(null)
  const ensConnected = ensIdentity.preference === 'accepted' && (
    ensIdentity.relationship === 'active-address' ||
    ensIdentity.relationship === 'same-inbox'
  )
  const name = activeInboxName ?? (ensConnected && ensIdentity.candidate
    ? ensIdentity.candidate.name
    : profile.displayName ?? profile.username ?? shortIdentity(address))
  const offline = streamHealth === 'offline'

  useEffect(() => {
    if (!returnFocusConversationId) return
    const frame = window.requestAnimationFrame(() => {
      (returnFocusConversationRef.current ?? inboxTitleRef.current)?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [returnFocusConversationId])

  return (
    <section className="messaging-screen inbox-screen" aria-labelledby="inbox-title">
      <header className="screen-header">
        <div className="screen-identity">
          <Avatar name={name} src={profile.pfpUrl} />
          <div>
            <p className="eyebrow">Private inbox</p>
            <h1 id="inbox-title" ref={inboxTitleRef} tabIndex={-1}>{name}</h1>
            <span>{shortIdentity(address)} · {environment}</span>
          </div>
        </div>
        <details className="identity-menu" ref={identityMenuRef}>
          <summary
            className="icon-button"
            aria-label="Identity and privacy"
            ref={identitySummaryRef}
          >
            <CircleUserRound aria-hidden="true" />
          </summary>
          <section className="identity-menu__panel" aria-labelledby="identity-menu-title">
            <p className="eyebrow">Connected identity</p>
            <h2 id="identity-menu-title">Farcaster wallet</h2>
            <code>{address}</code>
            <p>{environment}</p>
            <EnsMenuIdentity
              identity={ensIdentity}
              offline={offline}
              onClearPreference={onClearEnsPreference}
              onRefresh={onRefreshEns}
              onReview={onReviewEnsSwitch ? () => {
                identityMenuRef.current?.removeAttribute('open')
                onReviewEnsSwitch(identitySummaryRef.current)
              } : undefined}
              onUse={onUseEns}
              targetNameVerified={ensTargetNameVerified}
            />
            {onUseFarcasterInbox ? (
              <div className="identity-menu__ens">
                <strong>Saved ENS inbox</strong>
                <span>
                  Converge Mini will reopen this inbox on this device while its exact signer remains available.
                </span>
                <button type="button" onClick={onUseFarcasterInbox}>
                  Use Farcaster inbox
                </button>
                {recoveryError ? (
                  <span className="identity-menu__warning" role="alert">
                    {recoveryError}
                  </span>
                ) : null}
              </div>
            ) : null}
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
            {offline
              ? 'Offline. Showing conversations saved on this device.'
              : streamHealth === 'retrying'
              ? 'Live updates are reconnecting. Your local inbox is still available.'
              : 'Live updates paused. Pull a fresh sync when your connection returns.'}
          </span>
          {!offline ? (
            <button type="button" onClick={onRetryLiveUpdates}>Refresh now</button>
          ) : null}
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
            disabled={refreshing || offline}
            aria-label="Refresh inbox"
          >
            <RefreshCw className={refreshing ? 'is-spinning' : ''} aria-hidden="true" />
          </button>
          <Button data-join-convos="true" onClick={onJoinConvos} variant="secondary">
            <Link2 aria-hidden="true" />
            Join Convos
          </Button>
          <Button disabled={offline} onClick={onNewDm}>
            <Plus aria-hidden="true" />
            New DM
          </Button>
        </div>
      </div>

      {conversations.length ? (
        <ul className="conversation-list">
          {conversations.map((conversation) => {
            const isGroup = conversation.kind === 'convos-group'
            const presentation = isGroup
              ? {
                  fnameHint: null,
                  label: conversation.title,
                  title: `${conversation.title} · Convos group`,
                }
              : participantPresentation(
                conversation.peerAddress ?? conversation.peerInboxId,
                participantIdentityFor(conversation.peerAddress),
              )
            const label = presentation.label
            return (
              <li key={conversation.id}>
                <button
                  className="conversation-row"
                  onClick={() => onOpen(conversation.id)}
                  ref={conversation.id === returnFocusConversationId
                    ? returnFocusConversationRef
                    : undefined}
                  title={presentation.title}
                  type="button"
                >
                  <Avatar name={isGroup ? conversation.emoji ?? label : label.replace(/^@/u, '')} />
                  <span className="conversation-row__body">
                    <span className="conversation-row__topline">
                      <strong>{label}</strong>
                      <time dateTime={conversation.updatedAt?.toISOString()}>
                        {conversationTime(conversation.updatedAt)}
                      </time>
                    </span>
                    {isGroup ? (
                      <span className="conversation-row__identity-hint">
                        Convos group
                      </span>
                    ) : presentation.fnameHint ? (
                      <span className="conversation-row__identity-hint">
                        {presentation.fnameHint}
                      </span>
                    ) : null}
                    <span className="conversation-row__preview">
                      {conversation.isOwnLastMessage
                        ? 'You: '
                        : isGroup && conversation.lastSenderInboxId
                          ? `${shortIdentity(conversation.lastSenderInboxId)}: `
                          : ''}{conversation.preview}
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
          <h2>{offline ? 'No conversations saved on this device' : 'No allowed conversations yet'}</h2>
          <p>{offline
            ? 'Reconnect to check this inbox for conversations.'
            : 'Start with an Ethereum address or ENS name that reaches an XMTP inbox.'}</p>
          <Button disabled={offline} onClick={onNewDm}>
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
  offline: boolean
  onClearPreference: () => void
  onRefresh: () => void
  onReview?: (() => void) | undefined
  onUse: () => void
  targetNameVerified: boolean
}

function EnsMenuIdentity({
  identity,
  offline,
  onClearPreference,
  onRefresh,
  onReview,
  onUse,
  targetNameVerified,
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
        <button
          type="button"
          onClick={onRefresh}
          disabled={offline || identity.status === 'checking'}
        >
          Check ENS identity
        </button>
        {identity.preference !== null ? (
          <button type="button" onClick={onClearPreference} disabled={offline}>
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
          {identity.preference === 'accepted' || targetNameVerified ? (
            <span className="identity-menu__connected">
              {targetNameVerified ? 'ENS name verified for this inbox' : 'ENS name in use'}
            </span>
          ) : (
            <button type="button" onClick={onUse} disabled={offline}>Use ENS name</button>
          )}
        </>
      ) : (
        <>
          {identity.relationship === 'different-inbox' ? (
            <>
              <span className="identity-menu__warning">
                This name has a separate XMTP inbox. Messages cannot move or merge.
              </span>
              {onReview ? (
                <button type="button" onClick={onReview}>Review inbox switch</button>
              ) : null}
            </>
          ) : (
            <>
              <span className="identity-menu__warning">
                {identity.relationship === 'no-inbox'
                  ? 'This ENS address has no existing XMTP inbox to join. No identity was changed.'
                  : 'XMTP could not verify how this address relates to the active inbox. No identity was changed.'}
              </span>
              <button
                type="button"
                onClick={onRefresh}
                disabled={offline || identity.status === 'checking'}
              >
                Check ENS identity again
              </button>
            </>
          )}
        </>
      )}
      {identity.preference !== null ? (
        <button type="button" onClick={onClearPreference} disabled={offline}>
          Delete saved ENS choice
        </button>
      ) : null}
    </div>
  )
}
