import {
  ArrowDownUp,
  LogOut,
  MessageCircleMore,
  Plus,
  RefreshCw,
  WifiOff,
} from 'lucide-react'

import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import type { ConversationSummary, StreamHealth } from './types'
import { conversationTime, shortIdentity } from './format'

type InboxScreenProps = {
  address: `0x${string}`
  conversations: ConversationSummary[]
  environment: string
  onDisconnect: () => void
  onNewDm: () => void
  onOpen: (conversationId: string) => void
  onRefresh: () => void
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
  environment,
  onDisconnect,
  onNewDm,
  onOpen,
  onRefresh,
  profile,
  refreshing,
  streamHealth,
}: InboxScreenProps) {
  const name = profile.displayName ?? profile.username ?? shortIdentity(address)

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
        <button className="icon-button" type="button" onClick={onDisconnect} aria-label="Disconnect XMTP inbox">
          <LogOut aria-hidden="true" />
        </button>
      </header>

      {streamHealth !== 'live' ? (
        <div className={`connection-banner connection-banner--${streamHealth}`} role="status">
          {streamHealth === 'retrying' ? <ArrowDownUp aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
          <span>
            {streamHealth === 'retrying'
              ? 'Live updates are reconnecting. Your local inbox is still available.'
              : 'Live updates paused. Pull a fresh sync when your connection returns.'}
          </span>
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
