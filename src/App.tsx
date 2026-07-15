import { AlertTriangle, LockKeyhole, MessageCircleMore, ShieldCheck } from 'lucide-react'

import { AppShell } from './app/AppShell'
import { useMiniAppHost } from './app/useMiniAppHost'
import { Avatar } from './components/Avatar'
import { StatePanel } from './components/StatePanel'
import { useVisualViewport } from './lib/useVisualViewport'

export default function App() {
  useVisualViewport()
  const host = useMiniAppHost()

  return (
    <AppShell host={host}>
      {host.status === 'detecting' ? (
        <StatePanel
          busy
          eyebrow="Opening securely"
          title="Finding your Farcaster session"
          description="The inbox shell is ready. We’re checking which host features are available."
        />
      ) : null}

      {host.status === 'standalone' ? <StandaloneWelcome /> : null}

      {host.status === 'error' ? (
        <StatePanel
          icon={<AlertTriangle aria-hidden="true" />}
          eyebrow="Host connection"
          title="Farcaster didn’t finish opening the app"
          description={host.error ?? 'Close this view and open Converge Mini again from Farcaster.'}
        />
      ) : null}

      {host.status === 'embedded' && host.context ? (
        <EmbeddedWelcome
          canUseWallet={host.capabilities.includes('wallet.getEthereumProvider')}
          user={host.context.user}
        />
      ) : null}
    </AppShell>
  )
}

type EmbeddedWelcomeProps = {
  canUseWallet: boolean
  user: {
    displayName?: string
    fid: number
    pfpUrl?: string
    username?: string
  }
}

function EmbeddedWelcome({ canUseWallet, user }: EmbeddedWelcomeProps) {
  const name = user.displayName ?? user.username ?? `Farcaster user ${user.fid}`

  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome__glow" aria-hidden="true" />
      <div className="welcome__identity">
        <Avatar name={name} src={user.pfpUrl} size="large" />
        <div>
          <p className="eyebrow">Farcaster identity</p>
          <h1 id="welcome-title">Hi, {name}</h1>
          {user.username ? <p className="welcome__username">@{user.username}</p> : null}
        </div>
      </div>

      <p className="welcome__lead">
        Your private XMTP inbox, without leaving Farcaster.
      </p>

      <div className="trust-list" aria-label="Connection details">
        <div className="trust-row">
          <span className="trust-row__icon"><LockKeyhole aria-hidden="true" /></span>
          <div>
            <strong>One clear signature</strong>
            <span>We’ll explain the XMTP setup request before your wallet opens.</span>
          </div>
        </div>
        <div className="trust-row">
          <span className="trust-row__icon"><ShieldCheck aria-hidden="true" /></span>
          <div>
            <strong>Your messages stay yours</strong>
            <span>Keys and decrypted message content remain in this browser.</span>
          </div>
        </div>
      </div>

      <div className={`capability-note ${canUseWallet ? 'capability-note--ready' : ''}`}>
        <span className="status-dot" aria-hidden="true" />
        {canUseWallet
          ? 'Farcaster wallet support is ready.'
          : 'This Farcaster client does not expose the wallet access XMTP needs.'}
      </div>
    </section>
  )
}

function StandaloneWelcome() {
  return (
    <section className="standalone" aria-labelledby="standalone-title">
      <div className="standalone__icon" aria-hidden="true">
        <MessageCircleMore />
      </div>
      <p className="eyebrow">Made for Farcaster</p>
      <h1 id="standalone-title">Private messages, right where the conversation starts.</h1>
      <p>
        Converge Mini uses your Farcaster wallet to open an interoperable XMTP inbox. Open this app from its Farcaster listing or a shared cast to continue.
      </p>
      <div className="standalone__domain">miniapp.converge.cv</div>
      <p className="standalone__note">
        Standalone wallet access is intentionally off for the first release so the app never creates a different identity by surprise.
      </p>
    </section>
  )
}
