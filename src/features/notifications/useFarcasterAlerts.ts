import { useCallback, useEffect, useRef, useState } from 'react'

const ALERT_PROMPT_SEEN_KEY = 'converge-miniapp:alert-prompt-seen:v1'

type UseFarcasterAlertsOptions = {
  canAddMiniApp: boolean
  canPrompt: boolean
  fid: number
  initiallyAdded: boolean
  initiallyNotificationsEnabled: boolean
}

export type FarcasterAlertsState = {
  added: boolean
  available: boolean
  dismissPrompt: () => void
  error: string | null
  notificationsEnabled: boolean
  pending: boolean
  promptVisible: boolean
  requestAlerts: () => Promise<void>
  showSettingsHelp: () => void
  settingsHelpVisible: boolean
  supported: boolean
}

export function useFarcasterAlerts({
  canAddMiniApp,
  canPrompt,
  fid,
  initiallyAdded,
  initiallyNotificationsEnabled,
}: UseFarcasterAlertsOptions): FarcasterAlertsState {
  const [available, setAvailable] = useState(false)
  const [added, setAdded] = useState(
    initiallyAdded || initiallyNotificationsEnabled,
  )
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    initiallyNotificationsEnabled,
  )
  const [pending, setPending] = useState(false)
  const [promptVisible, setPromptVisible] = useState(false)
  const [settingsHelpVisible, setSettingsHelpVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const promptSeenRef = useRef(alertPromptWasSeen(fid))

  useEffect(() => {
    const controller = new AbortController()

    const loadAvailability = async () => {
      try {
        const response = await fetch('/api/notifications/status', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          method: 'GET',
          signal: controller.signal,
        })
        if (!response.ok) {
          setAvailable(false)
          return
        }

        const body: unknown = await response.json()
        setAvailable(
          typeof body === 'object' &&
          body !== null &&
          'available' in body &&
          body.available === true,
        )
      } catch {
        if (!controller.signal.aborted) setAvailable(false)
      }
    }

    void loadAvailability()
    window.addEventListener('online', loadAvailability)

    return () => {
      controller.abort()
      window.removeEventListener('online', loadAvailability)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let removeListeners: (() => void) | undefined

    void import('@farcaster/miniapp-sdk').then(({ sdk }) => {
      if (cancelled) return

      const onMiniAppAdded = ({
        notificationDetails,
      }: { notificationDetails?: unknown }) => {
        setAdded(true)
        setNotificationsEnabled(Boolean(notificationDetails))
        setPromptVisible(false)
        setError(null)
      }
      const onMiniAppRemoved = () => {
        setAdded(false)
        setNotificationsEnabled(false)
      }
      const onNotificationsEnabled = () => {
        setAdded(true)
        setNotificationsEnabled(true)
        setPromptVisible(false)
        setSettingsHelpVisible(false)
        setError(null)
      }
      const onNotificationsDisabled = () => {
        setNotificationsEnabled(false)
      }

      sdk.on('miniAppAdded', onMiniAppAdded)
      sdk.on('miniAppRemoved', onMiniAppRemoved)
      sdk.on('notificationsEnabled', onNotificationsEnabled)
      sdk.on('notificationsDisabled', onNotificationsDisabled)

      removeListeners = () => {
        sdk.off('miniAppAdded', onMiniAppAdded)
        sdk.off('miniAppRemoved', onMiniAppRemoved)
        sdk.off('notificationsEnabled', onNotificationsEnabled)
        sdk.off('notificationsDisabled', onNotificationsDisabled)
      }
    }).catch(() => {
      // A host capability check already controls whether setup is offered.
    })

    return () => {
      cancelled = true
      removeListeners?.()
    }
  }, [])

  useEffect(() => {
    if (
      !available ||
      !canAddMiniApp ||
      !canPrompt ||
      notificationsEnabled ||
      promptSeenRef.current
    ) return

    promptSeenRef.current = true
    rememberAlertPrompt(fid)
    setPromptVisible(true)
  }, [available, canAddMiniApp, canPrompt, fid, notificationsEnabled])

  const dismissPrompt = useCallback(() => {
    setPromptVisible(false)
    setError(null)
  }, [])

  const showSettingsHelp = useCallback(() => {
    setSettingsHelpVisible(true)
    setError(null)
  }, [])

  const requestAlerts = useCallback(async () => {
    if (!available || !canAddMiniApp || pending) return

    promptSeenRef.current = true
    rememberAlertPrompt(fid)
    setError(null)

    if (added) {
      setSettingsHelpVisible(true)
      return
    }

    setPending(true)
    try {
      const { sdk } = await import('@farcaster/miniapp-sdk')
      const result = await sdk.actions.addMiniApp()
      setAdded(true)
      setNotificationsEnabled(Boolean(result.notificationDetails))
      setPromptVisible(false)
      setSettingsHelpVisible(!result.notificationDetails)
    } catch (caught) {
      setPromptVisible(true)
      setError(alertSetupError(caught))
    } finally {
      setPending(false)
    }
  }, [added, available, canAddMiniApp, fid, pending])

  return {
    added,
    available,
    dismissPrompt,
    error,
    notificationsEnabled,
    pending,
    promptVisible,
    requestAlerts,
    settingsHelpVisible,
    showSettingsHelp,
    supported: canAddMiniApp,
  }
}

function alertPromptWasSeen(fid: number): boolean {
  try {
    return window.localStorage.getItem(alertPromptStorageKey(fid)) === '1'
  } catch {
    return false
  }
}

function rememberAlertPrompt(fid: number): void {
  try {
    window.localStorage.setItem(alertPromptStorageKey(fid), '1')
  } catch {
    // In-memory state still prevents a second prompt during this app session.
  }
}

function alertPromptStorageKey(fid: number): string {
  return `${ALERT_PROMPT_SEEN_KEY}:${fid}`
}

function alertSetupError(error: unknown): string {
  if (error instanceof Error && error.name === 'AddMiniApp.RejectedByUser') {
    return 'Alert setup was canceled. You can try again from the identity menu.'
  }

  if (error instanceof Error && error.name === 'AddMiniApp.InvalidDomainManifest') {
    return 'Farcaster could not verify this Mini App for alerts. Try again later.'
  }

  return 'Farcaster could not open alert setup. Try again from the identity menu.'
}
