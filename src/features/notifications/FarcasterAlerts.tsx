import { Bell, BellOff, X } from 'lucide-react'

import { Button } from '../../components/Button'
import type { FarcasterAlertsState } from './useFarcasterAlerts'

type FarcasterAlertPromptProps = {
  alerts: FarcasterAlertsState
}

export function FarcasterAlertPrompt({ alerts }: FarcasterAlertPromptProps) {
  if (!alerts.promptVisible) return null

  return (
    <aside
      className="alert-assist"
      aria-labelledby="alert-assist-title"
      role="status"
    >
      <Bell aria-hidden="true" />
      <div className="alert-assist__body">
        <strong id="alert-assist-title">
          {alerts.added ? 'Turn alerts back on' : 'Get private-inbox alerts'}
        </strong>
        <span>
          {alerts.added
            ? 'Open this Mini App’s settings in Farcaster and turn on notifications.'
            : 'Add Converge Mini so Farcaster can alert you without including message text.'}
        </span>
        {alerts.added ? (
          <button type="button" onClick={alerts.showSettingsHelp}>
            How to enable
          </button>
        ) : (
          <Button busy={alerts.pending} onClick={() => void alerts.requestAlerts()}>
            Enable alerts
          </Button>
        )}
        {alerts.settingsHelpVisible ? (
          <small>
            In Farcaster, open Converge Mini’s app settings and enable notifications.
          </small>
        ) : null}
        {alerts.error ? (
          <small className="alert-assist__error" role="alert">
            {alerts.error}
          </small>
        ) : null}
      </div>
      <button
        aria-label="Dismiss alert setup"
        className="alert-assist__dismiss"
        onClick={alerts.dismissPrompt}
        type="button"
      >
        <X aria-hidden="true" />
      </button>
    </aside>
  )
}

type FarcasterAlertsMenuProps = {
  alerts: FarcasterAlertsState
}

export function FarcasterAlertsMenu({ alerts }: FarcasterAlertsMenuProps) {
  if (!alerts.available) return null

  return (
    <div className="identity-menu__alerts">
      <strong>Farcaster alerts</strong>
      {alerts.notificationsEnabled ? (
        <>
          <span className="identity-menu__connected">
            <Bell aria-hidden="true" />
            Alerts on
          </span>
          <span>New-message alerts never include message text.</span>
        </>
      ) : alerts.added ? (
        <>
          <span>
            <BellOff aria-hidden="true" />
            Notifications are off in this Farcaster client.
          </span>
          <button type="button" onClick={alerts.showSettingsHelp}>
            How to turn on alerts
          </button>
        </>
      ) : alerts.supported ? (
        <>
          <span>Add Converge Mini so Farcaster can deliver privacy-safe alerts.</span>
          <button
            disabled={alerts.pending}
            onClick={() => void alerts.requestAlerts()}
            type="button"
          >
            {alerts.pending ? 'Waiting for Farcaster…' : 'Enable alerts'}
          </button>
        </>
      ) : (
        <span>This Farcaster client does not expose alert setup.</span>
      )}
      {alerts.settingsHelpVisible ? (
        <span role="status">
          Open this Mini App’s settings in Farcaster and enable notifications.
        </span>
      ) : null}
      {alerts.error ? (
        <span className="identity-menu__warning" role="alert">
          {alerts.error}
        </span>
      ) : null}
    </div>
  )
}
