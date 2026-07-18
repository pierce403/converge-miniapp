import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AppShell } from './AppShell'
import type { MiniAppHostState } from './useMiniAppHost'

describe('AppShell', () => {
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

  it('does not duplicate the mobile host top inset in any shell state', () => {
    render(<AppShell host={host()}><span>content</span></AppShell>)

    const shell = screen.getByText('content').closest('.app-shell')
    expect(shell).toHaveStyle({
      '--host-safe-bottom': '18px',
      '--host-safe-left': '2px',
      '--host-messaging-safe-top': '0px',
      '--host-safe-right': '3px',
      '--host-safe-top': '0px',
    })
  })

  it('honors web-client safe areas', () => {
    render(<AppShell host={host('web')}><span>content</span></AppShell>)

    expect(screen.getByText('content').closest('.app-shell')).toHaveStyle({
      '--host-messaging-safe-top': '72px',
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
