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
  '--host-safe-right': string
  '--host-safe-top': string
}

export function AppShell({ children, host }: AppShellProps) {
  const insets = host.context?.client.safeAreaInsets
  const style: SafeAreaStyle = {
    '--host-safe-top': `${insets?.top ?? 0}px`,
    '--host-safe-right': `${insets?.right ?? 0}px`,
    '--host-safe-bottom': `${insets?.bottom ?? 0}px`,
    '--host-safe-left': `${insets?.left ?? 0}px`,
  }

  return (
    <div className="app-shell" style={style}>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Converge Mini home">
          <BrandMark />
          <span>
            <strong>Converge</strong>
            <small>mini</small>
          </span>
        </a>
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
