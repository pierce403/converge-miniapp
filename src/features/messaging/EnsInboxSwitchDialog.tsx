import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/Button'
import type { EnsCandidate } from '../identity/useEnsIdentity'

type EnsInboxSwitchDialogProps = {
  candidate: EnsCandidate
  onCancel: () => void
  onConfirm: (candidate: EnsCandidate, signal: AbortSignal) => Promise<void>
  onRestarting: () => void
}

type DialogPhase = 'review' | 'checking' | 'error' | 'restarting'
type SwitchErrorPresentation = {
  message: string
  retryable: boolean
  signerUnavailable: boolean
}

export function EnsInboxSwitchDialog({
  candidate,
  onCancel,
  onConfirm,
  onRestarting,
}: EnsInboxSwitchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const operationRef = useRef<AbortController | null>(null)
  const [error, setError] = useState<SwitchErrorPresentation | null>(null)
  const [phase, setPhase] = useState<DialogPhase>('review')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')

    return () => {
      operationRef.current?.abort()
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [])

  const cancel = () => {
    if (phase === 'restarting') return
    operationRef.current?.abort()
    operationRef.current = null
    onCancel()
  }

  const confirm = async () => {
    if (operationRef.current) return
    const operation = new AbortController()
    operationRef.current = operation
    setError(null)
    setPhase('checking')
    let restart = false

    try {
      await onConfirm(candidate, operation.signal)
      restart = !operation.signal.aborted
    } catch (caught) {
      if (!operation.signal.aborted) {
        setError(readSwitchError(caught, candidate))
        setPhase('error')
      }
    } finally {
      if (operationRef.current === operation) operationRef.current = null
    }

    if (restart) {
      setPhase('restarting')
      onRestarting()
    }
  }

  const unavailable = error?.signerUnavailable ?? false

  return (
    <dialog
      aria-describedby="ens-switch-description"
      aria-labelledby="ens-switch-title"
      className="ens-offer ens-inbox-switch"
      onCancel={(event) => {
        event.preventDefault()
        if (phase !== 'restarting') cancel()
      }}
      ref={dialogRef}
    >
      <section className="ens-offer__card ens-inbox-switch__card">
        <p className="eyebrow">Existing ENS inbox</p>
        <h2 id="ens-switch-title">
          {unavailable
            ? `${candidate.name} can’t sign in this Farcaster client`
            : `Leave this inbox and join ${candidate.name}?`}
        </h2>
        <div id="ens-switch-description" className="ens-inbox-switch__copy">
          {unavailable ? (
            <p>
              The name resolves to the address below, but Farcaster is not exposing that exact address as a signing wallet. No XMTP signature was requested. Your current inbox and messages are unchanged.
            </p>
          ) : (
            <>
              <p>
                You’re abandoning this inbox in Converge Mini and joining the existing XMTP inbox for <strong>{candidate.name}</strong>.
              </p>
              <p>
                This inbox and its messages are not deleted. The inboxes stay separate: nothing moves or merges, and older history in the inbox you join is recovered only when XMTP can provide it.
              </p>
              <p>
                The exact address below must be available to approve XMTP access. XMTP may request a signature; it is not a transaction and costs no gas.
              </p>
            </>
          )}
          <code>{candidate.address}</code>
        </div>

        {phase === 'checking' ? (
          <p className="ens-inbox-switch__status" role="status" aria-live="polite">
            Rechecking the ENS name, target inbox, and exact signing address…
          </p>
        ) : null}
        {phase === 'restarting' ? (
          <p className="ens-inbox-switch__status" role="status" aria-live="polite">
            Restarting Converge Mini to open {candidate.name}…
          </p>
        ) : null}
        {phase === 'error' && error ? (
          <p className="ens-inbox-switch__error" role="alert">{error.message}</p>
        ) : null}

        <div className="ens-offer__actions">
          {phase === 'review' || (phase === 'error' && error?.retryable) ? (
            <Button busy={false} onClick={() => void confirm()}>
              {phase === 'error'
                ? 'Check again'
                : `Leave and join ${candidate.name}`}
            </Button>
          ) : null}
          {phase !== 'restarting' ? (
            <Button autoFocus disabled={false} variant="ghost" onClick={cancel}>
              {phase === 'error' && error && !error.retryable
                ? 'Review updated identity'
                : 'Keep this inbox'}
            </Button>
          ) : null}
        </div>
      </section>
    </dialog>
  )
}

function readSwitchError(
  error: unknown,
  candidate: EnsCandidate,
): SwitchErrorPresentation {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'host-wallet-target-unavailable'
  ) {
    return {
      message: `${candidate.name} can’t sign in this Farcaster client. Farcaster is not exposing ${candidate.address} as a signing wallet.`,
      retryable: true,
      signerUnavailable: true,
    }
  }
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('ens-switch-')
  ) {
    return {
      message: error.message,
      retryable: error.code !== 'ens-switch-candidate-changed',
      signerUnavailable: false,
    }
  }
  return {
    message: 'Converge Mini could not verify that inbox. Your current inbox is unchanged.',
    retryable: true,
    signerUnavailable: false,
  }
}
