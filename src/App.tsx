import { AlertTriangle, MessageCircleMore } from 'lucide-react'

import { AppShell } from './app/AppShell'
import { useMiniAppHost } from './app/useMiniAppHost'
import { StatePanel } from './components/StatePanel'
import { MessagingApp } from './features/messaging/MessagingApp'
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
        <MessagingApp
          canAddMiniApp={host.capabilities.includes('actions.addMiniApp')}
          canUseBack={host.capabilities.includes('back')}
          canUseWallet={host.capabilities.includes('wallet.getEthereumProvider')}
          initiallyMiniAppAdded={host.context.client.added}
          initiallyNotificationsEnabled={host.context.client.notificationsEnabled}
          key={host.context.user.fid}
          user={host.context.user}
        />
      ) : null}
    </AppShell>
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
