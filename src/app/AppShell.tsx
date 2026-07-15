import { useMemo, type CSSProperties, type ReactNode } from 'react'

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
  const effectiveTop = useMemo(() => effectiveHostTopInset(
    insets?.top ?? 0,
    insets?.bottom ?? 0,
    host.context?.client.platformType,
  ), [
    host.context?.client.platformType,
    insets?.bottom,
    insets?.top,
  ])
  const nativeTopAlreadyApplied = (insets?.top ?? 0) > 0 && effectiveTop === 0
  const style: SafeAreaStyle = {
    '--host-safe-right': `${insets?.right ?? 0}px`,
    '--host-safe-bottom': `${insets?.bottom ?? 0}px`,
    '--host-safe-left': `${insets?.left ?? 0}px`,
    '--host-safe-top': `${effectiveTop}px`,
  }

  return (
    <div
      className={`app-shell${nativeTopAlreadyApplied ? ' app-shell--native-top-safe' : ''}`}
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

function effectiveHostTopInset(
  top: number,
  bottom: number,
  platform: 'mobile' | 'web' | undefined,
): number {
  const mobileViewport = platform === 'mobile' || (
    platform === undefined && navigator.maxTouchPoints > 0
  )
  if (!mobileViewport || top <= 0) return top

  // Some mobile clients size the webview below their native title bar while
  // still reporting that bar as an occluding safe-area inset. A substantial
  // screen-to-webview height difference is evidence that the chrome is
  // already outside this viewport; other clients keep the reported inset.
  const clippedHeight = window.screen.height - window.innerHeight
  const reportedVerticalInset = top + Math.max(0, bottom)
  return clippedHeight >= reportedVerticalInset + 16 ? 0 : top
}
