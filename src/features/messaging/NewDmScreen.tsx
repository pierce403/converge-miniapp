import { ArrowLeft, AtSign, CheckCircle2, Search, XCircle } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { getAddress, isAddress } from 'viem'

import { Button } from '../../components/Button'
import type { XmtpIdentityRelationship } from '../../lib/xmtp/session'

export type ResolvedEnsRecipient = {
  address: `0x${string}`
  name: string
}

type RecipientResult = {
  address: `0x${string}`
  name: string | null
  reachable: boolean
}

type NewDmScreenProps = {
  offline?: boolean
  ownAddress: `0x${string}`
  onBack: () => void
  onCheckReachability: (address: `0x${string}`) => Promise<boolean>
  onCreate: (address: `0x${string}`) => Promise<void>
  onInspectIdentity: (
    address: `0x${string}`,
  ) => Promise<XmtpIdentityRelationship>
  onResetResolution: () => void
  onResolveEns: (query: string) => Promise<ResolvedEnsRecipient | null>
  resolutionError: string | null
}

export function NewDmScreen({
  offline = false,
  ownAddress,
  onBack,
  onCheckReachability,
  onCreate,
  onInspectIdentity,
  onResetResolution,
  onResolveEns,
  resolutionError,
}: NewDmScreenProps) {
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecipientResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [opening, setOpening] = useState(false)
  const checkingRef = useRef(false)
  const checkRequestRef = useRef(0)
  const openingRef = useRef(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (offline || checkingRef.current || openingRef.current) return

    const value = query.trim()
    const request = ++checkRequestRef.current
    let recipient: Pick<RecipientResult, 'address' | 'name'>

    checkingRef.current = true
    setChecking(true)
    setError(null)
    setResult(null)
    try {
      if (isAddress(value)) {
        recipient = { address: getAddress(value), name: null }
      } else {
        if (!value.includes('.')) {
          throw new Error('Enter a complete Ethereum address or ENS name such as name.eth.')
        }
        const resolved = await onResolveEns(value)
        if (!resolved || checkRequestRef.current !== request) return
        recipient = resolved
      }

      if (recipient.address.toLowerCase() === ownAddress.toLowerCase()) {
        throw new Error('That is the wallet already connected to this inbox.')
      }

      const relationship = await onInspectIdentity(recipient.address)
      if (checkRequestRef.current !== request) return
      if (relationship === 'active-address' || relationship === 'same-inbox') {
        throw new Error('That address already belongs to your current XMTP inbox.')
      }

      const reachable = await onCheckReachability(recipient.address)
      if (checkRequestRef.current === request) {
        setResult({ ...recipient, reachable })
      }
    } catch (nextError) {
      if (checkRequestRef.current !== request) return
      setError(
        nextError instanceof Error && nextError.message.trim()
          ? nextError.message
          : 'That recipient could not be checked right now.',
      )
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }

  const visibleError = error ?? resolutionError

  const openDm = async () => {
    if (offline || !result?.reachable || openingRef.current || checkingRef.current) return
    const address = result.address
    openingRef.current = true
    setOpening(true)
    setError(null)
    try {
      await onCreate(address)
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message.trim()
          ? nextError.message
          : 'The DM could not open right now.',
      )
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }

  return (
    <section className="messaging-screen new-dm-screen" aria-labelledby="new-dm-title">
      <header className="screen-header screen-header--compact">
        <button className="icon-button" type="button" onClick={onBack} aria-label="Back to inbox">
          <ArrowLeft aria-hidden="true" />
        </button>
        <div>
          <p className="eyebrow">New conversation</p>
          <h1 id="new-dm-title">Find an XMTP inbox</h1>
        </div>
      </header>

      {offline ? (
        <div className="connection-banner connection-banner--offline" role="status">
          <XCircle aria-hidden="true" />
          <span>Reconnect before checking or opening a new conversation.</span>
        </div>
      ) : null}

      <form className="new-dm-form" onSubmit={submit}>
        <label htmlFor="recipient-address">Ethereum address or ENS name</label>
        <div className="address-input">
          <AtSign aria-hidden="true" />
          <input
            id="recipient-address"
            aria-describedby={`recipient-help${visibleError ? ' recipient-error' : ''}`}
            aria-invalid={Boolean(visibleError)}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            disabled={offline}
            inputMode="text"
            onChange={(event) => {
              checkRequestRef.current += 1
              setQuery(event.target.value)
              setResult(null)
              if (error) setError(null)
              onResetResolution()
            }}
            placeholder="0x… or name.eth"
            spellCheck={false}
            value={query}
          />
        </div>
        <p className="field-help" id="recipient-help">
          You will confirm the exact address before a conversation opens.
        </p>
        {visibleError ? (
          <p className="field-error" id="recipient-error" role="alert">
            {visibleError}
          </p>
        ) : null}
        <Button busy={checking} disabled={offline || !query.trim() || opening} type="submit">
          <Search aria-hidden="true" />
          {checking ? 'Checking recipient…' : 'Check recipient'}
        </Button>
      </form>

      {result ? (
        <section
          aria-label="Recipient check"
          className={`recipient-result recipient-result--${result.reachable ? 'reachable' : 'unreachable'}`}
        >
          <div aria-atomic="true" className="recipient-result__status" role="status">
            {result.reachable
              ? <CheckCircle2 aria-hidden="true" />
              : <XCircle aria-hidden="true" />}
            <strong>{result.reachable ? 'Reachable on XMTP' : 'Not on XMTP yet'}</strong>
          </div>
          {result.name ? <h2>{result.name}</h2> : null}
          <code>{result.address}</code>
          {result.reachable ? (
            <Button busy={opening} disabled={offline || checking} onClick={() => void openDm()}>
              {opening ? 'Opening DM…' : 'Open DM'}
            </Button>
          ) : (
            <p>This address does not currently have a reachable XMTP inbox.</p>
          )}
        </section>
      ) : null}

      <aside className="privacy-callout">
        ENS names are resolved transiently by Converge, then the exact address is checked with XMTP. No contacts database is created.
      </aside>
    </section>
  )
}
