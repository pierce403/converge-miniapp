import { useState } from 'react'
import QRCode from 'react-qr-code'

import { Button } from '../../components/Button'

type WalletConnectPairingOptionsProps = {
  name: string
  uri: string
}

export function WalletConnectPairingOptions({
  name,
  uri,
}: WalletConnectPairingOptionsProps) {
  const [copyResult, setCopyResult] = useState<{
    status: 'copied' | 'failed'
    uri: string
  }>()
  const metaMaskUrl = `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`

  const copyPairingUri = async () => {
    try {
      await navigator.clipboard.writeText(uri)
      setCopyResult({ status: 'copied', uri })
    } catch {
      setCopyResult({ status: 'failed', uri })
    }
  }
  const currentCopyResult = copyResult?.uri === uri ? copyResult.status : null

  return (
    <section className="walletconnect-pairing" aria-label="WalletConnect options">
      <div
        aria-label={`WalletConnect QR code for ${name}`}
        className="walletconnect-pairing__qr"
        role="img"
      >
        <QRCode size={196} value={uri} />
      </div>
      <p>
        Scan with MetaMask or another WalletConnect wallet. On this phone,
        open MetaMask directly, then return to Farcaster after approving.
      </p>
      <label className="walletconnect-pairing__uri">
        <span>WalletConnect URI</span>
        <textarea
          aria-label={`WalletConnect URI for ${name}`}
          autoComplete="off"
          readOnly
          rows={3}
          spellCheck={false}
          value={uri}
        />
      </label>
      <div className="walletconnect-pairing__actions">
        <a
          className="button button--primary"
          href={metaMaskUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open MetaMask
        </a>
        <Button variant="ghost" onClick={() => void copyPairingUri()}>
          {currentCopyResult === 'copied'
            ? 'URI copied'
            : 'Copy WalletConnect URI'}
        </Button>
      </div>
      <p
        className="walletconnect-pairing__copy-status"
        role="status"
        aria-live="polite"
      >
        {currentCopyResult === 'copied'
          ? 'WalletConnect URI copied.'
          : currentCopyResult === 'failed'
            ? 'Clipboard access failed. Select and copy the URI above.'
            : ''}
      </p>
    </section>
  )
}
