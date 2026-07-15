import { useEffect } from 'react'

type MiniAppSdk = (typeof import('@farcaster/miniapp-sdk'))['sdk']

/**
 * Owns Farcaster's host back control for app-local views that do not create a
 * browser history entry. The in-app back button remains available as a
 * predictable fallback when a host does not advertise the capability.
 */
export function useMiniAppBack(
  supported: boolean,
  visible: boolean,
  onBack: () => void,
): void {
  useEffect(() => {
    if (!supported) return

    let active = true
    let back: MiniAppSdk['back'] | null = null

    void import('@farcaster/miniapp-sdk').then(async ({ sdk }) => {
      if (!active) return
      back = sdk.back

      if (!visible) {
        back.onback = null
        await back.hide()
        return
      }

      back.onback = onBack
      await back.show()
      if (!active) await back.hide()
    }).catch(() => {
      // Host capability calls can still fail if a client is closing. The
      // visible in-app control remains the recovery path.
    })

    return () => {
      active = false
      if (!back) return
      back.onback = null
      if (visible) void back.hide().catch(() => undefined)
    }
  }, [onBack, supported, visible])
}
