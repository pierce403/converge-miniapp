import { ArrowLeft, AtSign, Search } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { getAddress, isAddress } from 'viem'

import { Button } from '../../components/Button'

type NewDmScreenProps = {
  ownAddress: `0x${string}`
  onBack: () => void
  onCreate: (address: `0x${string}`) => Promise<void>
}

export function NewDmScreen({ ownAddress, onBack, onCreate }: NewDmScreenProps) {
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (checkingRef.current) return

    const value = address.trim()

    if (!isAddress(value)) {
      setError('Enter a complete Ethereum address beginning with 0x.')
      return
    }

    const normalized = getAddress(value)
    if (normalized.toLowerCase() === ownAddress.toLowerCase()) {
      setError('That is the wallet already connected to this inbox.')
      return
    }

    checkingRef.current = true
    setChecking(true)
    setError(null)
    try {
      await onCreate(normalized)
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message.trim()
          ? nextError.message
          : 'XMTP could not check that address.',
      )
    } finally {
      checkingRef.current = false
      setChecking(false)
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

      <form className="new-dm-form" onSubmit={submit}>
        <label htmlFor="recipient-address">Ethereum address</label>
        <div className="address-input">
          <AtSign aria-hidden="true" />
          <input
            id="recipient-address"
            aria-describedby={`recipient-help${error ? ' recipient-error' : ''}`}
            aria-invalid={Boolean(error)}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            inputMode="text"
            onChange={(event) => {
              setAddress(event.target.value)
              if (error) setError(null)
            }}
            placeholder="0x…"
            spellCheck={false}
            value={address}
          />
        </div>
        <p className="field-help" id="recipient-help">
          Address-first keeps recipient matching precise. Farcaster and ENS search come later.
        </p>
        {error ? <p className="field-error" id="recipient-error" role="alert">{error}</p> : null}
        <Button busy={checking} disabled={!address.trim()} type="submit">
          <Search aria-hidden="true" />
          {checking ? 'Checking XMTP…' : 'Check and open DM'}
        </Button>
      </form>

      <aside className="privacy-callout">
        Converge checks reachability with XMTP. It does not upload this address to a Converge contacts database.
      </aside>
    </section>
  )
}
