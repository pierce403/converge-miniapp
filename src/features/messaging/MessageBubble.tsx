import { AlertCircle, Clock3, RotateCcw } from 'lucide-react'

import { MAX_MESSAGE_REACTIONS, type MessageItem } from './types'
import { messageTime } from './format'

type MessageBubbleProps = {
  message: MessageItem
  onRetry: (messageId: string) => void
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const sender = message.isOwn ? 'You' : 'Recipient'
  const reactions = message.reactions?.slice(0, MAX_MESSAGE_REACTIONS)

  return (
    <article
      aria-label={`${sender}, ${messageTime(message.sentAt)}`}
      className={`message-bubble ${message.isOwn ? 'message-bubble--own' : 'message-bubble--peer'}`}
    >
      {message.replyTo ? (
        <blockquote className="message-bubble__reply">{message.replyTo}</blockquote>
      ) : null}
      <p className={message.unsupported ? 'message-bubble__unsupported' : ''}>{message.text}</p>
      {reactions?.length ? (
        <ul className="message-bubble__reactions" aria-label="Reactions">
          {reactions.map((reaction) => (
            <li key={reaction.content}>
              <span>{reaction.content}</span>
              {reaction.count > 1 ? <span>{reaction.count}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <footer>
        <time dateTime={message.sentAt.toISOString()}>{messageTime(message.sentAt)}</time>
        {message.isOwn && message.delivery === 'sending' ? (
          <span title="Publishing"><Clock3 aria-hidden="true" /> Sending</span>
        ) : null}
        {message.isOwn && message.delivery === 'failed' && message.canRetry ? (
          <button
            aria-label="Retry failed message"
            type="button"
            onClick={() => onRetry(message.id)}
          >
            <AlertCircle aria-hidden="true" />
            Failed
            <RotateCcw aria-hidden="true" />
          </button>
        ) : null}
        {message.isOwn && message.delivery === 'failed' && !message.canRetry ? (
          <span title="XMTP marked this message as permanently failed">
            <AlertCircle aria-hidden="true" /> Not sent
          </span>
        ) : null}
      </footer>
    </article>
  )
}
