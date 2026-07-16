import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/Button'
import type { EnsCandidate } from '../identity/useEnsIdentity'
import { WalletConnectPairingOptions } from './WalletConnectPairingOptions'

type EnsInboxSwitchDialogProps = {
  candidate: EnsCandidate
  onCancel: () => void
  onConfirm: (
    candidate: EnsCandidate,
    signal: AbortSignal,
    onPairingUri: (uri: string) => void,
  ) => Promise<void>
  onRestarting: () => void
}

type DialogPhase = 'review' | 'checking' | 'error' | 'restarting'
type SwitchErrorPresentation = {
  cancelLabel?: string
  message: string
  retryable: boolean
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
  const [pairingUri, setPairingUri] = useState<string | null>(null)
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
    setPairingUri(null)
    setPhase('checking')
    let restart = false

    try {
      await onConfirm(candidate, operation.signal, (uri) => {
        if (!operation.signal.aborted && operationRef.current === operation) {
          setPairingUri(uri)
        }
      })
      restart = !operation.signal.aborted
    } catch (caught) {
      if (!operation.signal.aborted) {
        setPairingUri(null)
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
          {pairingUri
            ? `Connect the wallet for ${candidate.name}`
            : `Leave this inbox and join ${candidate.name}?`}
        </h2>
        <div id="ens-switch-description" className="ens-inbox-switch__copy">
          <p>
            You’re abandoning this inbox in Converge Mini and joining the existing XMTP inbox for <strong>{candidate.name}</strong>.
          </p>
          <p>
            This inbox and its messages are not deleted. The inboxes stay separate: nothing moves or merges, and older history in the inbox you join is recovered only when XMTP can provide it.
          </p>
          <p>
            Connect an external wallet that exposes the exact address below. WalletConnect will ask for the connection first; XMTP may then request a signature. Neither step is a transaction or costs gas.
          </p>
          <code>{candidate.address}</code>
        </div>

        {pairingUri ? (
          <WalletConnectPairingOptions name={candidate.name} uri={pairingUri} />
        ) : null}

        {phase === 'checking' ? (
          <p className="ens-inbox-switch__status" role="status" aria-live="polite">
            {pairingUri
              ? 'Waiting for the exact ENS address to approve WalletConnect…'
              : 'Rechecking the ENS name and existing target inbox…'}
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
                : `Connect wallet and join ${candidate.name}`}
            </Button>
          ) : null}
          {phase !== 'restarting' ? (
            <Button autoFocus disabled={false} variant="ghost" onClick={cancel}>
              {phase === 'error' && error
                ? error.cancelLabel ?? (
                    error.retryable ? 'Keep this inbox' : 'Review updated identity'
                  )
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
    error.code === 'walletconnect-target-unavailable'
  ) {
    return {
      message: `The connected wallet is not exposing ${candidate.address}. Choose the wallet account that owns ${candidate.name}, then try again.`,
      retryable: true,
    }
  }
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'walletconnect-not-configured'
  ) {
    return {
      cancelLabel: 'Keep this inbox',
      message: 'External-wallet connections are not configured for this deployment yet. Your current inbox is unchanged.',
      retryable: false,
    }
  }
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'walletconnect-cancelled'
  ) {
    return {
      message: 'The external-wallet connection was cancelled. Your current inbox is unchanged.',
      retryable: true,
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
    }
  }
  return {
    message: 'Converge Mini could not verify that inbox. Your current inbox is unchanged.',
    retryable: true,
  }
}
