import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Link2,
  Send,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '../../components/Button'
import { ConvosInviteError } from '../../lib/convos/error'
import type { ParsedConvosInvite } from '../../lib/convos/invite'
import type { ConvosAccessRequest } from './types'

const MAX_INVITE_INPUT_CHARACTERS = 1_411_024

type JoinConvosScreenProps = {
  offline?: boolean
  onBack: () => void
  onRequestAccess: (invite: ParsedConvosInvite) => Promise<void>
  onReset: () => void
  onRetry: () => Promise<void>
  request: ConvosAccessRequest | null
}

export function JoinConvosScreen({
  offline = false,
  onBack,
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
  const parsingRef = useRef(false)
  const parseRequestRef = useRef(0)
  const requestingRef = useRef(false)

  useEffect(() => () => {
    mountedRef.current = false
    parseRequestRef.current += 1
  }, [])

  const parse = async (event: FormEvent) => {
    event.preventDefault()
    if (offline || parsingRef.current || requestingRef.current) return
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
          <span>Reconnect before checking an invite or requesting access.</span>
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
                disabled={offline || parsing}
                maxLength={MAX_INVITE_INPUT_CHARACTERS}
                onChange={(event) => {
                  parseRequestRef.current += 1
                  setInput(event.target.value)
                  if (error) setError(null)
                }}
                placeholder="Paste a Convos invite"
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
              disabled={offline || !input.trim()}
              type="submit"
            >
              <KeyRound aria-hidden="true" />
              {parsing ? 'Checking invite…' : 'Check invite'}
            </Button>
          </form>
        ) : (
          <InvitePreview invite={visibleInvite} />
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
            onReset={onReset}
            onRetry={onRetry}
            request={request}
          />
        ) : null}
      </div>
    </section>
  )
}

function InvitePreview({ invite }: { invite: ParsedConvosInvite }) {
  const title = invite.name || 'Convos conversation'
  return (
    <section className="convos-invite-preview" aria-labelledby="convos-preview-title">
      <div className="convos-invite-preview__title">
        <span aria-hidden="true">{invite.emoji || '💬'}</span>
        <div>
          <p className="eyebrow">Invite preview</p>
          <h2 id="convos-preview-title">{title}</h2>
        </div>
      </div>
      <p>
        Preview from the link, not a verified identity. The inviter’s device validates the request.
      </p>
    </section>
  )
}

function RequestStatus({
  offline,
  onReset,
  onRetry,
  request,
}: {
  offline: boolean
  onReset: () => void
  onRetry: () => Promise<void>
  request: ConvosAccessRequest
}) {
  const waiting = request.status === 'waiting'
  const sending = request.status === 'sending'
  return (
    <section
      className={`convos-request-status convos-request-status--${request.status}`}
      aria-live="polite"
      aria-atomic="true"
    >
      {request.status === 'failed'
        ? <XCircle aria-hidden="true" />
        : <CheckCircle2 aria-hidden="true" />}
      <div>
        <h2>
          {sending
            ? 'Sending access request…'
            : waiting
              ? 'Request sent'
              : 'Request needs attention'}
        </h2>
        <p>
          {sending
            ? 'Keep this view open while XMTP publishes the request.'
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
      {request.status === 'failed' ? (
        <Button variant="ghost" onClick={onReset}>
          Use a different invite
        </Button>
      ) : null}
      {waiting ? <small>You can leave this screen; the request remains in this inbox.</small> : null}
    </section>
  )
}

function safeInviteError(error: unknown) {
  return error instanceof ConvosInviteError
    ? error.message
    : 'That Convos invite could not be opened safely.'
}
