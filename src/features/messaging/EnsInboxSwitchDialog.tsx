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
    onCommitting: () => void,
  ) => Promise<void>
  onRestarting: () => void
}

type DialogPhase = 'review' | 'checking' | 'binding' | 'error' | 'restarting'
type SwitchErrorPresentation = {
  cancelLabel?: string
  message: string
  reload?: boolean
  retryable: boolean
}

export function EnsInboxSwitchDialog({
  candidate,
  onCancel,
  onConfirm,
  onRestarting,
}: EnsInboxSwitchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const committedRef = useRef(false)
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
    if (committedRef.current || phase === 'restarting') return
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
      await onConfirm(
        candidate,
        operation.signal,
        (uri) => {
          if (!operation.signal.aborted && operationRef.current === operation) {
            setPairingUri(uri)
          }
        },
        () => {
          if (operation.signal.aborted || operationRef.current !== operation) return
          committedRef.current = true
          setPairingUri(null)
          setPhase('binding')
        },
      )
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
        cancel()
      }}
      ref={dialogRef}
    >
      <section className="ens-offer__card ens-inbox-switch__card">
        <p className="eyebrow">One-time identity binding</p>
        <h2 id="ens-switch-title">
          {pairingUri
            ? `Connect the wallet for ${candidate.name}`
            : `Bind your Farcaster wallet to ${candidate.name}?`}
        </h2>
        <div id="ens-switch-description" className="ens-inbox-switch__copy">
          <p>
            This permanently reassigns your Farcaster wallet key to the existing XMTP inbox for <strong>{candidate.name}</strong>.
          </p>
          <p>
            The inboxes do not merge. Your Farcaster wallet will lose normal access to its old XMTP inbox, and those old messages will not move into {candidate.name}.
          </p>
          <p>
            The ENS owner wallet is used only once to grant this installation access. Your Farcaster wallet then signs the binding and becomes the everyday signer; future launches will not reconnect this external wallet. Neither signature is a transaction or costs gas.
          </p>
          <p>
            After XMTP confirms the binding, Converge Mini reloads once to open the target inbox with your Farcaster wallet.
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
              : 'Rechecking the ENS name, then binding the Farcaster wallet…'}
          </p>
        ) : null}
        {phase === 'binding' ? (
          <p className="ens-inbox-switch__status" role="status" aria-live="polite">
            Binding the Farcaster wallet to {candidate.name}… Keep this window open.
          </p>
        ) : null}
        {phase === 'restarting' ? (
          <p className="ens-inbox-switch__status" role="status" aria-live="polite">
            Binding confirmed. Reopening {candidate.name} with the Farcaster wallet…
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
                : `Bind Farcaster wallet to ${candidate.name}`}
            </Button>
          ) : null}
          {phase === 'review' || phase === 'checking' || phase === 'error' ? (
            <Button
              autoFocus
              disabled={false}
              variant="ghost"
              onClick={error?.reload ? onRestarting : cancel}
            >
              {phase === 'error' && error
                ? error.cancelLabel ?? (
                    error.retryable ? 'Keep this inbox' : 'Review updated identity'
                  )
                : phase === 'checking' ? 'Cancel connection' : 'Keep this inbox'}
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
    (error.code === 'ens-binding-ambiguous' || error.code === 'ens-binding-failed')
  ) {
    return {
      cancelLabel: 'Reload and verify',
      message: error instanceof Error
        ? error.message
        : 'The binding stopped after XMTP began switching inboxes. Reload and verify the Farcaster inbox before retrying.',
      reload: true,
      retryable: false,
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
      message: 'WalletConnect is not configured for one-time ENS binding on this deployment. Your current inbox is unchanged.',
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
