import { AlertCircle, Clock3, RotateCcw } from 'lucide-react'

import type { MessageItem } from './types'
import { messageTime } from './format'

type MessageBubbleProps = {
  message: MessageItem
  onRetry: (messageId: string) => void
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const sender = message.isOwn ? 'You' : 'Recipient'

  return (
    <article
      aria-label={`${sender}, ${messageTime(message.sentAt)}`}
      className={`message-bubble ${message.isOwn ? 'message-bubble--own' : 'message-bubble--peer'}`}
    >
      <p className={message.unsupported ? 'message-bubble__unsupported' : ''}>{message.text}</p>
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
