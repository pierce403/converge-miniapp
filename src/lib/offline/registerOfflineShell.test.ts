import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerOfflineShell } from './registerOfflineShell'

const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  'serviceWorker',
)
const originalReadyState = Object.getOwnPropertyDescriptor(document, 'readyState')

describe('registerOfflineShell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker')
    }
    if (originalReadyState) {
      Object.defineProperty(document, 'readyState', originalReadyState)
    }
  })

  it('registers the same-origin worker without using the HTTP cache', () => {
    const postMessage = vi.fn()
    const registration = { active: { postMessage } }
    const register = vi.fn().mockResolvedValue(registration)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve(registration), register },
    })
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete',
    })

    registerOfflineShell()

    expect(register).toHaveBeenCalledWith('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none',
    })
  })

  it('warms only same-origin static resources that have already loaded', async () => {
    const postMessage = vi.fn()
    const registration = { active: { postMessage } }
    const register = vi.fn().mockResolvedValue(registration)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve(registration), register },
    })
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete',
    })
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { name: `${window.location.origin}/assets/index-abcdef.js` } as PerformanceEntry,
      { name: `${window.location.origin}/mark.svg` } as PerformanceEntry,
      { name: `${window.location.origin}/api/me/ens` } as PerformanceEntry,
      { name: 'https://auth.farcaster.xyz/token' } as PerformanceEntry,
      { name: `${window.location.origin}/assets/private.js?token=secret` } as PerformanceEntry,
    ])

    registerOfflineShell()

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      entryPath: '/assets/index-abcdef.js',
      paths: ['/assets/index-abcdef.js', '/mark.svg'],
      type: 'converge-miniapp:warm-static-v1',
    }))
  })

  it('does nothing when the browser has no service-worker support', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker')

    expect(() => registerOfflineShell()).not.toThrow()
  })
})
