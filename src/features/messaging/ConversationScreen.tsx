import { ArrowDownUp, ArrowLeft, RefreshCw, WifiOff } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Avatar } from '../../components/Avatar'
import {
  participantPresentation,
  type ParticipantIdentity,
} from '../identity/useParticipantIdentities'
import type { ActiveConversation, MessageItem, StreamHealth } from './types'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'

const STICK_TO_BOTTOM_PX = 80

type ConversationScreenProps = {
  conversation: ActiveConversation
  hasOlder: boolean
  loading: boolean
  loadingOlder: boolean
  messages: MessageItem[]
  onBack: () => void
  onLoadOlder: () => Promise<void>
  onRetry: (messageId: string) => void
  onRetryLiveUpdates: () => void
  onSend: (text: string) => Promise<void>
  participantIdentity?: ParticipantIdentity | null
  sending: boolean
  streamHealth: StreamHealth
}

export function ConversationScreen({
  conversation,
  hasOlder,
  loading,
  loadingOlder,
  messages,
  onBack,
  onLoadOlder,
  onRetry,
  onRetryLiveUpdates,
  onSend,
  participantIdentity = null,
  sending,
  streamHealth,
}: ConversationScreenProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const stickToBottomRef = useRef(true)
  const previousMessageIdsRef = useRef<string[]>([])
  const loadingEarlierRef = useRef(false)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const isGroup = conversation.kind === 'convos-group'
  const presentation = isGroup
    ? {
        label: conversation.title,
        secondary: 'Convos group',
        title: `${conversation.title} · Convos group`,
      }
    : participantPresentation(
      conversation.peerAddress ?? conversation.peerInboxId,
      participantIdentity,
    )
  const title = presentation.label
  const offline = streamHealth === 'offline'

  useEffect(() => {
    titleRef.current?.focus()
  }, [conversation.id])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const previousIds = previousMessageIdsRef.current
    const currentIds = messages.map((message) => message.id)
    const appended = !loading && previousIds.length > 0 &&
      previousIds.at(-1) !== currentIds.at(-1) &&
      previousIds.every((id) => currentIds.includes(id))

    if (scroller && stickToBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight
      setHasNewMessages(false)
    } else if (appended) {
      setHasNewMessages(true)
    }
    previousMessageIdsRef.current = currentIds
  }, [loading, messages])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !('ResizeObserver' in window)) return

    let previousHeight = scroller.clientHeight
    const observer = new ResizeObserver(() => {
      const heightChanged = scroller.clientHeight !== previousHeight
      previousHeight = scroller.clientHeight
      if (heightChanged && stickToBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight
      }
    })
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  const loadEarlier = async () => {
    if (loadingEarlierRef.current || loadingOlder) return
    loadingEarlierRef.current = true
    const scroller = scrollerRef.current
    const anchor = scroller?.querySelector<HTMLElement>('.message-bubble') ?? null
    const previousAnchorTop = anchor?.getBoundingClientRect().top ?? 0
    stickToBottomRef.current = false
    try {
      await onLoadOlder()
      requestAnimationFrame(() => {
        if (!scroller || !anchor?.isConnected) return
        scroller.scrollTop += anchor.getBoundingClientRect().top - previousAnchorTop
      })
    } finally {
      loadingEarlierRef.current = false
    }
  }

  const scrollToLatest = () => {
    const scroller = scrollerRef.current
    if (!scroller) return
    stickToBottomRef.current = true
    setHasNewMessages(false)
    scroller.scrollTo({ behavior: 'smooth', top: scroller.scrollHeight })
  }

  return (
    <section
      className={`messaging-screen conversation-screen ${streamHealth === 'live' ? '' : 'conversation-screen--degraded'}`}
      aria-labelledby="conversation-title"
    >
      <header className="screen-header screen-header--conversation">
        <button className="icon-button" type="button" onClick={onBack} aria-label="Back to inbox">
          <ArrowLeft aria-hidden="true" />
        </button>
        <Avatar name={isGroup ? conversation.emoji ?? title : title.replace(/^@/u, '')} />
        <div title={isGroup ? title : presentation.title}>
          <h1 id="conversation-title" ref={titleRef} tabIndex={-1}>{title}</h1>
          <span>{isGroup ? 'Convos group · XMTP' : `${presentation.secondary} · XMTP direct message`}</span>
        </div>
      </header>

      {streamHealth !== 'live' ? (
        <div className={`connection-banner connection-banner--${streamHealth}`} role="status">
          {streamHealth === 'retrying'
            ? <ArrowDownUp aria-hidden="true" />
            : <WifiOff aria-hidden="true" />}
          <span>
            {offline
              ? 'Offline. Showing messages saved on this device.'
              : streamHealth === 'retrying'
              ? 'Live updates are reconnecting. Saved messages remain available.'
              : 'Live updates paused. Refresh and retry when your connection returns.'}
          </span>
          {!offline ? (
            <button type="button" onClick={onRetryLiveUpdates}>Refresh now</button>
          ) : null}
        </div>
      ) : null}

      <div
        aria-label="Conversation messages"
        aria-live={loading ? 'off' : 'polite'}
        aria-relevant="additions text"
        className="message-list"
        onScroll={(event) => {
          const target = event.currentTarget
          stickToBottomRef.current =
            target.scrollHeight - target.scrollTop - target.clientHeight <= STICK_TO_BOTTOM_PX
          if (stickToBottomRef.current) setHasNewMessages(false)
        }}
        ref={scrollerRef}
        role="log"
      >
        {hasOlder ? (
          <button
            className="load-earlier"
            disabled={loadingOlder}
            onClick={() => void loadEarlier()}
            type="button"
          >
            <RefreshCw className={loadingOlder ? 'is-spinning' : ''} aria-hidden="true" />
            {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
          </button>
        ) : null}
        {loading ? (
          <div className={`messages-loading ${messages.length ? 'messages-loading--inline' : ''}`} role="status">
            <RefreshCw className="is-spinning" aria-hidden="true" />
            Syncing this conversation…
          </div>
        ) : null}
        {!loading && !messages.length ? (
          <div className="conversation-start">
            <strong>{offline
              ? 'No messages are saved on this device.'
              : isGroup
                ? 'This is the beginning of this group conversation.'
                : 'This is the beginning of your private conversation.'}</strong>
            <span>{offline
              ? 'Reconnect to check for conversation history.'
              : 'Messages are end-to-end encrypted by XMTP.'}</span>
          </div>
        ) : null}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onRetry={onRetry}
            retryDisabled={offline}
            showSender={isGroup}
          />
        ))}
      </div>

      {hasNewMessages ? (
        <button className="new-messages-button" onClick={scrollToLatest} type="button">
          New messages
        </button>
      ) : null}

      <MessageComposer
        disabled={loading || offline}
        onSend={onSend}
        placeholder={isGroup ? 'Message this group…' : 'Message privately…'}
        sending={sending}
      />
    </section>
  )
}
