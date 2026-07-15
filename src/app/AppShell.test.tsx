import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from './AppShell'
import type { MiniAppHostState } from './useMiniAppHost'

describe('AppShell', () => {
  afterEach(() => vi.restoreAllMocks())

  function host(platformType: 'mobile' | 'web' = 'mobile') {
    return {
      capabilities: [],
      context: {
        client: {
          added: false,
          clientFid: 1,
          platformType,
          safeAreaInsets: { bottom: 18, left: 2, right: 3, top: 72 },
        },
        user: { fid: 403 },
      },
      error: null,
      status: 'embedded',
    } as unknown as MiniAppHostState
  }

  it('does not apply a mobile title-bar inset twice when the webview is clipped', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(650)
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(844)

    render(<AppShell host={host()}><span>content</span></AppShell>)

    const shell = screen.getByText('content').closest('.app-shell')
    expect(shell).toHaveClass('app-shell--native-top-safe')
    expect(shell).toHaveStyle({
      '--host-safe-bottom': '18px',
      '--host-safe-left': '2px',
      '--host-safe-right': '3px',
      '--host-safe-top': '0px',
    })
  })

  it('keeps the reported top inset when host chrome overlays the viewport', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844)
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(844)

    render(<AppShell host={host()}><span>content</span></AppShell>)

    const shell = screen.getByText('content').closest('.app-shell')
    expect(shell).not.toHaveClass('app-shell--native-top-safe')
    expect(shell).toHaveStyle({
      '--host-safe-top': '72px',
    })
  })

  it('honors web-client safe areas without applying the mobile heuristic', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(650)
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(844)

    render(<AppShell host={host('web')}><span>content</span></AppShell>)

    expect(screen.getByText('content').closest('.app-shell')).toHaveStyle({
      '--host-safe-top': '72px',
    })
  })

  it('retains branded shell context outside the ready messaging view', () => {
    render(<AppShell host={host()}><span>setup content</span></AppShell>)

    expect(screen.getByLabelText('Converge Mini')).toBeInTheDocument()
    expect(screen.getByText(
      'Private message content is end-to-end encrypted by XMTP.',
    )).toBeInTheDocument()
  })
})
