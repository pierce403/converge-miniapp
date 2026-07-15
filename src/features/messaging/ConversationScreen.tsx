import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Avatar } from '../../components/Avatar'
import type { ActiveConversation, MessageItem } from './types'
import { shortIdentity } from './format'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'

const STICK_TO_BOTTOM_PX = 80

type ConversationScreenProps = {
  conversation: ActiveConversation
  loading: boolean
  messages: MessageItem[]
  onBack: () => void
  onRetry: (messageId: string) => void
  onSend: (text: string) => Promise<void>
  sending: boolean
}

export function ConversationScreen({
  conversation,
  loading,
  messages,
  onBack,
  onRetry,
  onSend,
  sending,
}: ConversationScreenProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const identity = conversation.peerAddress ?? conversation.peerInboxId

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller && stickToBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [messages])

  return (
    <section className="messaging-screen conversation-screen" aria-labelledby="conversation-title">
      <header className="screen-header screen-header--conversation">
        <button className="icon-button" type="button" onClick={onBack} aria-label="Back to inbox">
          <ArrowLeft aria-hidden="true" />
        </button>
        <Avatar name={identity} />
        <div>
          <h1 id="conversation-title">{shortIdentity(identity)}</h1>
          <span>XMTP direct message</span>
        </div>
      </header>

      <div
        aria-label="Conversation messages"
        aria-live="polite"
        aria-relevant="additions text"
        className="message-list"
        onScroll={(event) => {
          const target = event.currentTarget
          stickToBottomRef.current =
            target.scrollHeight - target.scrollTop - target.clientHeight <= STICK_TO_BOTTOM_PX
        }}
        ref={scrollerRef}
        role="log"
      >
        {loading ? (
          <div className="messages-loading" role="status">
            <RefreshCw className="is-spinning" aria-hidden="true" />
            Syncing this conversation…
          </div>
        ) : null}
        {!loading && !messages.length ? (
          <div className="conversation-start">
            <strong>This is the beginning of your private conversation.</strong>
            <span>Messages are end-to-end encrypted by XMTP.</span>
          </div>
        ) : null}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} onRetry={onRetry} />
        ))}
      </div>

      <MessageComposer disabled={loading} onSend={onSend} sending={sending} />
    </section>
  )
}
