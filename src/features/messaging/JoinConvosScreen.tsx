import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  KeyRound,
  Link2,
  Send,
  WifiOff,
  XCircle,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'

import { Button } from '../../components/Button'
import { ConvosInviteError } from '../../lib/convos/error'
import type { ParsedConvosInvite } from '../../lib/convos/invite'
import type { ConvosAccessRequest } from './types'

const MAX_INVITE_INPUT_CHARACTERS = 1_411_024

type JoinConvosScreenProps = {
  offline?: boolean
  onBack: () => void
  onOpenConversation: (conversationId: string) => void
  onRequestAccess: (invite: ParsedConvosInvite) => Promise<void>
  onReset: () => void
  onRetry: () => Promise<void>
  request: ConvosAccessRequest | null
}

export function JoinConvosScreen({
  offline = false,
  onBack,
  onOpenConversation,
  onRequestAccess,
  onReset,
  onRetry,
  request,
}: JoinConvosScreenProps) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<ParsedConvosInvite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const mountedRef = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const previewHeadingRef = useRef<HTMLHeadingElement>(null)
  const statusHeadingRef = useRef<HTMLHeadingElement>(null)
  const parsingRef = useRef(false)
  const parseRequestRef = useRef(0)
  const requestingRef = useRef(false)
  const requestFocusKey = request
    ? JSON.stringify([request.messageId, request.status, request.groupId])
    : null

  useEffect(() => () => {
    mountedRef.current = false
    parseRequestRef.current += 1
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (preview && !request) previewHeadingRef.current?.focus()
  }, [preview, request])

  useEffect(() => {
    if (requestFocusKey) statusHeadingRef.current?.focus()
  }, [requestFocusKey])

  const parse = async (event: FormEvent) => {
    event.preventDefault()
    if (parsingRef.current || requestingRef.current) return
    const submittedInput = input
    const requestId = ++parseRequestRef.current
    parsingRef.current = true
    setParsing(true)
    setError(null)
    setPreview(null)
    try {
      const { parseConvosInvite } = await import('../../lib/convos/invite')
      const parsed = parseConvosInvite(submittedInput)
      if (parseRequestRef.current !== requestId) return
      setInput('')
      setPreview(parsed)
    } catch (nextError) {
      if (parseRequestRef.current === requestId) setError(safeInviteError(nextError))
    } finally {
      parsingRef.current = false
      if (mountedRef.current) setParsing(false)
    }
  }

  const requestAccess = async () => {
    if (offline || !preview || requestingRef.current || request) return
    requestingRef.current = true
    setError(null)
    try {
      const { parseConvosInvite } = await import('../../lib/convos/invite')
      const freshInvite = parseConvosInvite(preview.slug)
      setPreview(freshInvite)
      await onRequestAccess(freshInvite)
    } catch (nextError) {
      setError(
        nextError instanceof ConvosInviteError
          ? nextError.message
          : 'XMTP could not send the Convos access request.',
      )
    } finally {
      requestingRef.current = false
    }
  }

  const startAnother = () => {
    setPreview(null)
    setInput('')
    setError(null)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const visibleInvite = request?.invite ?? preview

  return (
    <section className="messaging-screen join-convos-screen" aria-labelledby="join-convos-title">
      <header className="screen-header screen-header--compact">
        <button
          className="icon-button"
          type="button"
          onClick={() => {
            parseRequestRef.current += 1
            onBack()
          }}
          aria-label="Back to inbox"
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div>
          <p className="eyebrow">Convos invite</p>
          <h1 id="join-convos-title">Join a conversation</h1>
        </div>
      </header>

      {offline ? (
        <div className="connection-banner connection-banner--offline" role="status">
          <WifiOff aria-hidden="true" />
          <span>You can check an invite offline. Reconnect before requesting access.</span>
        </div>
      ) : null}

      <div className="join-convos-content">
        {!visibleInvite ? (
          <form className="join-convos-form" onSubmit={parse}>
            <label htmlFor="convos-invite">Convos invite link or code</label>
            <div className="convos-invite-input">
              <Link2 aria-hidden="true" />
              <textarea
                id="convos-invite"
                aria-describedby={`convos-invite-help${error ? ' convos-invite-error' : ''}`}
                aria-invalid={Boolean(error)}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                disabled={parsing}
                maxLength={MAX_INVITE_INPUT_CHARACTERS}
                onChange={(event) => {
                  parseRequestRef.current += 1
                  setInput(event.target.value)
                  if (error) setError(null)
                }}
                placeholder="Paste a Convos invite"
                ref={inputRef}
                rows={4}
                spellCheck={false}
                value={input}
              />
            </div>
            <p className="field-help" id="convos-invite-help">
              The invite is checked on this device. Nothing is sent until you tap Request access.
            </p>
            {error ? (
              <p className="field-error" id="convos-invite-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button
              busy={parsing}
              disabled={!input.trim()}
              type="submit"
            >
              <KeyRound aria-hidden="true" />
              {parsing ? 'Checking invite…' : 'Check invite'}
            </Button>
          </form>
        ) : (
          <InvitePreview headingRef={previewHeadingRef} invite={visibleInvite} />
        )}

        {preview && !request ? (
          <div className="join-convos-actions">
            {error ? <p className="field-error" role="alert">{error}</p> : null}
            <Button disabled={offline} onClick={() => void requestAccess()}>
              <Send aria-hidden="true" />
              Request access
            </Button>
            <Button variant="ghost" onClick={startAnother}>
              Use a different invite
            </Button>
          </div>
        ) : null}

        {request ? (
          <RequestStatus
            offline={offline}
            headingRef={statusHeadingRef}
            onOpenConversation={onOpenConversation}
            onReset={() => {
              onReset()
              startAnother()
            }}
            onRetry={onRetry}
            request={request}
          />
        ) : null}
      </div>
    </section>
  )
}

function InvitePreview({
  headingRef,
  invite,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>
  invite: ParsedConvosInvite
}) {
  const title = invite.name || 'Convos conversation'
  return (
    <section className="convos-invite-preview" aria-labelledby="convos-preview-title">
      <div className="convos-invite-preview__title">
        <span aria-hidden="true">{invite.emoji || '💬'}</span>
        <div>
          <p className="eyebrow">Invite preview</p>
          <h2 id="convos-preview-title" ref={headingRef} tabIndex={-1}>{title}</h2>
        </div>
      </div>
      <p>
        Preview from the link, not a verified identity. The inviter’s device validates the request.
      </p>
    </section>
  )
}

function RequestStatus({
  headingRef,
  offline,
  onOpenConversation,
  onReset,
  onRetry,
  request,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>
  offline: boolean
  onOpenConversation: (conversationId: string) => void
  onReset: () => void
  onRetry: () => Promise<void>
  request: ConvosAccessRequest
}) {
  const waiting = request.status === 'waiting'
  const handled = request.status === 'handled'
  const joined = request.status === 'joined'
  const joinedGroupId = joined ? request.groupId : null
  const sending = request.status === 'sending'
  return (
    <section
      className={`convos-request-status convos-request-status--${request.status}`}
      aria-live="polite"
      aria-atomic="true"
    >
      {request.status === 'failed' ? (
        <XCircle aria-hidden="true" />
      ) : joined ? (
        <CheckCircle2 aria-hidden="true" />
      ) : (
        <Clock3 aria-hidden="true" />
      )}
      <div>
        <h2 ref={headingRef} tabIndex={-1}>
          {sending
            ? 'Sending access request…'
            : joined
              ? 'Conversation joined'
              : handled
                ? 'Request handled'
            : waiting
              ? 'Request sent'
              : 'Request needs attention'}
        </h2>
        <p>
          {sending
            ? 'Keep this view open while XMTP publishes the request.'
            : joined
              ? 'This inbox received and verified the Convos group.'
              : handled
                ? 'The inviter responded to your request. Waiting for this device to receive the group…'
            : waiting
              ? "Request sent. Waiting for the inviter's device…"
              : request.error ?? 'XMTP could not confirm the request.'}
        </p>
      </div>
      {request.status === 'failed' && request.retryMode === 'fresh' ? (
        <Button disabled={offline} onClick={() => void onRetry().catch(() => undefined)}>
          Send fresh request
        </Button>
      ) : null}
      {joinedGroupId ? (
        <Button onClick={() => onOpenConversation(joinedGroupId)}>
          Open conversation
        </Button>
      ) : null}
      {request.status === 'failed' ? (
        <Button variant="ghost" onClick={onReset}>
          Use a different invite
        </Button>
      ) : null}
      {waiting || handled ? (
        <small>You can leave this screen; the request remains in this inbox.</small>
      ) : null}
    </section>
  )
}

function safeInviteError(error: unknown) {
  return error instanceof ConvosInviteError
    ? error.message
    : 'That Convos invite could not be opened safely.'
}
