const OFFLINE_SHELL_WORKER_URL = '/service-worker.js'
const WARM_STATIC_MESSAGE = 'converge-miniapp:warm-static-v1'
const ENTRY_ASSET_PATTERN = /^\/assets\/index-[A-Za-z0-9_-]{6,64}\.js$/u

/**
 * Installs the static offline shell after the initial page has loaded. The
 * worker never receives message content or protected API responses; XMTP keeps
 * decrypted state in its own per-inbox OPFS database.
 */
export function registerOfflineShell(): void {
  if (!('serviceWorker' in navigator)) return

  const register = () => {
    void navigator.serviceWorker.register(OFFLINE_SHELL_WORKER_URL, {
      scope: '/',
      updateViaCache: 'none',
    }).then(async (registration) => {
      await navigator.serviceWorker.ready
      const worker = registration.active ?? registration.waiting ?? registration.installing
      if (!worker) return

      const loadedPaths = new Set<string>()
      let entryPath: string | null = null
      const warmLoadedStaticResources = (entries: PerformanceEntry[]) => {
        for (const path of staticAssetPaths(entries)) {
          loadedPaths.add(path)
          if (entryPath === null && ENTRY_ASSET_PATTERN.test(path)) entryPath = path
        }
        if (entryPath !== null && loadedPaths.size) {
          worker.postMessage({
            entryPath,
            paths: [...loadedPaths].slice(0, 64),
            type: WARM_STATIC_MESSAGE,
          })
        }
      }
      warmLoadedStaticResources(performance.getEntriesByType('resource'))

      if ('PerformanceObserver' in window) {
        const observer = new PerformanceObserver((list) => {
          warmLoadedStaticResources(list.getEntries())
        })
        observer.observe({ buffered: true, type: 'resource' })
        window.setTimeout(() => observer.disconnect(), 5_000)
      }
    }).catch(() => {
      // Offline shell installation is best-effort and must never block XMTP.
    })
  }

  if (document.readyState === 'complete') {
    register()
    return
  }
  window.addEventListener('load', register, { once: true })
}

function staticAssetPaths(entries: PerformanceEntry[]): string[] {
  const paths = new Set<string>()
  for (const entry of entries) {
    try {
      const url = new URL(entry.name, window.location.origin)
      if (
        url.origin === window.location.origin &&
        !url.search &&
        (url.pathname.startsWith('/assets/') || url.pathname === '/mark.svg')
      ) paths.add(url.pathname)
    } catch {
      // A malformed performance entry is not a static cache candidate.
    }
  }
  return [...paths].slice(0, 64)
}
