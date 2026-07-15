import { SendHorizontal } from 'lucide-react'
import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

const MAX_MESSAGE_LENGTH = 2_000

type MessageComposerProps = {
  disabled?: boolean
  onSend: (text: string) => Promise<void>
  sending: boolean
}

export function MessageComposer({ disabled = false, onSend, sending }: MessageComposerProps) {
  const [text, setText] = useState('')
  const submittingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`
  }, [text])

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const message = text.trim()
    if (!message || sending || disabled || submittingRef.current) return

    submittingRef.current = true
    setText('')
    try {
      await onSend(message)
    } catch {
      setText((current) => current || message)
    } finally {
      submittingRef.current = false
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <form className="message-composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="message-text">Message</label>
      <textarea
        id="message-text"
        disabled={disabled}
        maxLength={MAX_MESSAGE_LENGTH}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Message privately…"
        ref={textareaRef}
        rows={1}
        value={text}
      />
      <button
        className="send-button"
        disabled={disabled || sending || !text.trim()}
        onPointerDown={(event) => event.preventDefault()}
        type="submit"
        aria-label={sending ? 'Sending message' : 'Send message'}
      >
        <SendHorizontal aria-hidden="true" />
      </button>
    </form>
  )
}
