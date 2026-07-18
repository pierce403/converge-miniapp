import type { CSSProperties, ReactNode } from 'react'

import { BrandMark } from '../components/BrandMark'
import type { MiniAppHostState } from './useMiniAppHost'

type AppShellProps = {
  children: ReactNode
  host: MiniAppHostState
}

type SafeAreaStyle = CSSProperties & {
  '--host-safe-bottom': string
  '--host-safe-left': string
  '--host-messaging-safe-top': string
  '--host-safe-right': string
  '--host-safe-top': string
}

export function AppShell({ children, host }: AppShellProps) {
  const insets = host.context?.client.safeAreaInsets
  const hostTop = host.context?.client.platformType === 'mobile'
    ? 0
    : (insets?.top ?? 0)
  const style: SafeAreaStyle = {
    '--host-safe-right': `${insets?.right ?? 0}px`,
    '--host-safe-bottom': `${insets?.bottom ?? 0}px`,
    '--host-safe-left': `${insets?.left ?? 0}px`,
    '--host-messaging-safe-top': `${hostTop}px`,
    '--host-safe-top': `${hostTop}px`,
  }

  return (
    <div
      className="app-shell"
      data-host-platform={host.context?.client.platformType}
      style={style}
    >
      <header className="app-header">
        <div className="brand" aria-label="Converge Mini">
          <BrandMark />
          <span>
            <strong>Converge</strong>
            <small>mini</small>
          </span>
        </div>
        <div className="network-pill" title="XMTP network">
          <span aria-hidden="true" />
          XMTP
        </div>
      </header>

      <main className="app-main">{children}</main>

      <footer className="app-footer">
        <span>Private message content is end-to-end encrypted by XMTP.</span>
      </footer>
    </div>
  )
}
