import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FarcasterAlertPrompt, FarcasterAlertsMenu } from './FarcasterAlerts'
import type { FarcasterAlertsState } from './useFarcasterAlerts'

describe('Farcaster alert controls', () => {
  it('offers an explicit host action and a compact dismiss control', () => {
    const alerts = state({
      error: 'Alert setup was canceled. Try again when you are ready.',
      promptVisible: true,
    })
    render(<FarcasterAlertPrompt alerts={alerts} />)

    expect(screen.getByText(/without including message text/i)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(/setup was canceled/i)
    expect(alerts.requestAlerts).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Enable alerts' }))
    expect(alerts.requestAlerts).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss alert setup' }))
    expect(alerts.dismissPrompt).toHaveBeenCalledOnce()
  })

  it('keeps current status and recovery guidance in the identity menu', () => {
    const alerts = state({ added: true })
    render(<FarcasterAlertsMenu alerts={alerts} />)

    expect(screen.getByText('Farcaster alerts')).toBeVisible()
    expect(screen.getByText(/Notifications are off/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'How to turn on alerts' }))
    expect(alerts.showSettingsHelp).toHaveBeenCalledOnce()
  })

  it('reports enabled alerts without exposing a disable action the SDK lacks', () => {
    render(<FarcasterAlertsMenu alerts={state({
      added: true,
      notificationsEnabled: true,
    })} />)

    expect(screen.getByText('Alerts on')).toBeVisible()
    expect(screen.getByText(/never include message text/i)).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

function state(overrides: Partial<FarcasterAlertsState> = {}): FarcasterAlertsState {
  return {
    added: false,
    available: true,
    dismissPrompt: vi.fn(),
    error: null,
    notificationsEnabled: false,
    pending: false,
    promptVisible: false,
    requestAlerts: vi.fn().mockResolvedValue(undefined),
    settingsHelpVisible: false,
    showSettingsHelp: vi.fn(),
    supported: true,
    ...overrides,
  }
}
