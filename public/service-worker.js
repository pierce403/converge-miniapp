const STATIC_CACHE_NAMESPACE = 'converge-miniapp-static-'
const SHELL_CACHE_PREFIX = `${STATIC_CACHE_NAMESPACE}shell-`
const LEGACY_SHELL_CACHE = `${STATIC_CACHE_NAMESPACE}v1`
const METADATA_CACHE = `${STATIC_CACHE_NAMESPACE}meta-v1`
const METADATA_KEY = '/__converge-offline-shell-metadata__'
const WARM_STATIC_MESSAGE = 'converge-miniapp:warm-static-v1'
const ENTRY_PATH_PATTERN = /^\/assets\/(index-[A-Za-z0-9_-]{6,64})\.js$/u
const CACHE_NAME_PATTERN = /^converge-miniapp-static-shell-index-[A-Za-z0-9_-]{6,64}$/u

let shellUpdateQueue = Promise.resolve()
let lastKnownMetadata = null

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch(reloadRequest('/'))
    if (!response.ok) throw new Error('The app shell could not be cached.')
    await cacheShellResponse(response)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const metadata = await resolveShellMetadata()
      if (metadata) await cleanupStaleShellCaches(metadata)
    } catch {
      // A transient Cache Storage failure must not delete a known-good shell.
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || isPrivatePath(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
    return
  }
  if (isStaticRequest(url)) {
    event.respondWith(staticResponse(request))
  }
})

self.addEventListener('message', (event) => {
  if (
    event.data?.type !== WARM_STATIC_MESSAGE ||
    typeof event.data.entryPath !== 'string' ||
    !Array.isArray(event.data.paths)
  ) return
  event.waitUntil(cacheLoadedStaticPaths(event.data.entryPath, event.data.paths))
})

async function navigationResponse(request) {
  try {
    const response = await fetch(request)
    const url = new URL(request.url)
    if (
      response.ok &&
      url.pathname === '/' &&
      !url.search &&
      isHtmlResponse(response)
    ) {
      try {
        await cacheShellResponse(response.clone())
      } catch {
        // Keep serving the successful network response and retain the prior
        // complete offline shell when an update cannot be cached atomically.
      }
    }
    return response
  } catch (error) {
    const metadata = await resolveShellMetadata()
    for (const cacheName of retainedCacheNames(metadata)) {
      try {
        const cached = await (await caches.open(cacheName)).match('/')
        if (cached && isHtmlResponse(cached)) return cached
      } catch {
        // Try the prior complete generation before surfacing the network error.
      }
    }
    throw error
  }
}

async function staticResponse(request) {
  const pathname = new URL(request.url).pathname
  const metadata = await resolveShellMetadata()
  for (const cacheName of retainedCacheNames(metadata)) {
    try {
      const cache = await caches.open(cacheName)
      const cached = await cache.match(request, { ignoreVary: true })
      if (!cached) continue
      if (isCacheableStaticResponse(pathname, cached)) return cached
      await cache.delete(request, { ignoreVary: true })
    } catch {
      // Cache Storage is best-effort; a live static request must still work.
    }
  }

  // Cloudflare's SPA fallback can return cacheable HTML for a missing hashed
  // asset. Always bypass that HTTP-cache entry, then admit only the expected
  // MIME type into Cache Storage.
  const response = await fetch(reloadRequest(request))
  if (isCacheableStaticResponse(pathname, response)) {
    const cacheName = targetCacheForRequest(request, metadata)
    if (cacheName) {
      try {
        await (await caches.open(cacheName)).put(request, response.clone())
      } catch {
        // Quota/storage failures must not discard the successful live response.
      }
    }
  }
  return response
}

function cacheShellResponse(response) {
  const update = shellUpdateQueue.then(() => cacheShellResponseLocked(response))
  shellUpdateQueue = update.catch(() => undefined)
  return update
}

async function cacheShellResponseLocked(response) {
  const shellResponse = response.clone()
  const manifest = await parseShellManifest(response)
  const targetCacheName = cacheNameForEntryPath(manifest.entryPath)
  if (!targetCacheName) throw new Error('The app shell had no valid entry asset.')

  const existing = await resolveShellMetadata()
  const retained = retainedCacheNames(existing)
  const wasRetained = retained.includes(targetCacheName)
  if (!wasRetained) {
    await caches.delete(targetCacheName)
  }
  let promoted = false
  try {
    const requiredAssets = await Promise.all(manifest.requiredPaths.map(async (path) => {
      const asset = await fetch(reloadRequest(path))
      if (!isCacheableStaticResponse(path, asset)) {
        throw new Error('A required app-shell asset could not be cached.')
      }
      return [path, asset]
    }))

    const cache = await caches.open(targetCacheName)
    for (const [path, asset] of requiredAssets) {
      await cache.put(path, asset)
    }
    // Commit the new root only after every required fingerprinted asset is in
    // place. Until the metadata pointer is promoted, the prior shell remains
    // the only offline generation readers can select.
    await cache.put('/', shellResponse)

    const nextMetadata = {
      current: targetCacheName,
      previous: targetCacheName === existing?.current
        ? existing.previous
        : existing?.current ?? null,
    }
    await writeStoredMetadata(nextMetadata)
    promoted = true
    try {
      await cleanupStaleShellCaches(nextMetadata)
    } catch {
      // Activation and the next successful promotion can retry bounded cleanup.
    }

    await Promise.all(manifest.optionalPaths.map(async (path) => {
      try {
        const asset = await fetch(reloadRequest(path))
        if (isCacheableStaticResponse(path, asset)) await cache.put(path, asset)
      } catch {
        // One optional image must not prevent the core shell from installing.
      }
    }))
  } catch (error) {
    if (!wasRetained && !promoted) {
      try {
        await caches.delete(targetCacheName)
      } catch {
        // A later activation/promotion retries namespace-scoped cleanup.
      }
    }
    throw error
  }
}

async function cacheLoadedStaticPaths(entryPath, paths) {
  const targetCacheName = cacheNameForEntryPath(entryPath)
  if (!targetCacheName) return

  const metadata = await resolveShellMetadata()
  if (!retainedCacheNames(metadata).includes(targetCacheName)) return

  const safePaths = new Set()
  for (const candidate of paths.slice(0, 64)) {
    if (typeof candidate !== 'string') continue
    try {
      const url = new URL(candidate, self.location.origin)
      if (
        url.origin === self.location.origin &&
        !url.search &&
        !isPrivatePath(url.pathname) &&
        (url.pathname.startsWith('/assets/') || isPublicStaticPath(url.pathname))
      ) safePaths.add(url.pathname)
    } catch {
      // Ignore malformed messages from an obsolete or broken client.
    }
  }

  let cache
  try {
    cache = await caches.open(targetCacheName)
  } catch {
    return
  }
  await Promise.all([...safePaths].map(async (path) => {
    try {
      const cached = await cache.match(path, { ignoreVary: true })
      if (cached && isCacheableStaticResponse(path, cached)) return
      if (cached) await cache.delete(path, { ignoreVary: true })
      const response = await fetch(reloadRequest(path))
      if (isCacheableStaticResponse(path, response)) await cache.put(path, response)
    } catch {
      // Warming is best-effort; a later controlled request can fill the cache.
    }
  }))
}

async function parseShellManifest(response) {
  if (!isHtmlResponse(response)) throw new Error('The app shell was not HTML.')
  const html = await response.text()
  const requiredPaths = new Set()
  const optionalPaths = new Set()
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/gu)) {
    const url = new URL(match[1], self.location.origin)
    if (
      url.origin === self.location.origin &&
      !url.search &&
      !isPrivatePath(url.pathname) &&
      (url.pathname.startsWith('/assets/') || isPublicStaticPath(url.pathname))
    ) {
      if (url.pathname.startsWith('/assets/')) requiredPaths.add(url.pathname)
      else optionalPaths.add(url.pathname)
    }
  }

  const entryPaths = [...requiredPaths].filter((path) => ENTRY_PATH_PATTERN.test(path))
  if (entryPaths.length !== 1) throw new Error('The app shell entry was ambiguous.')
  return {
    entryPath: entryPaths[0],
    optionalPaths: [...optionalPaths],
    requiredPaths: [...requiredPaths],
  }
}

async function resolveShellMetadata() {
  try {
    const stored = await readStoredMetadata()
    if (stored && await metadataIsComplete(stored)) {
      lastKnownMetadata = stored
      return stored
    }
  } catch {
    // Fall through to the last verified pointer or complete-cache discovery.
  }
  if (lastKnownMetadata) {
    try {
      if (await metadataIsComplete(lastKnownMetadata)) return lastKnownMetadata
    } catch {
      // Discover another complete generation below.
    }
    lastKnownMetadata = null
  }

  try {
    const completeCaches = []
    const names = await caches.keys()
    for (const name of [...names].reverse()) {
      if (
        isShellCacheName(name) &&
        completeCaches.length < 2 &&
        await shellCacheIsComplete(name)
      ) completeCaches.push(name)
    }
    if (completeCaches.length) {
      lastKnownMetadata = {
        current: completeCaches[0],
        previous: completeCaches[1] ?? null,
      }
      return lastKnownMetadata
    }
  } catch {
    // No complete cache could be proven; online responses still pass through.
  }
  return null
}

async function readStoredMetadata() {
  const cache = await caches.open(METADATA_CACHE)
  const response = await cache.match(METADATA_KEY)
  if (!response) return null
  const value = await response.json()
  if (
    typeof value !== 'object' ||
    value === null ||
    !isShellCacheName(value.current) ||
    (value.previous !== null && !isShellCacheName(value.previous)) ||
    value.previous === value.current
  ) return null
  return { current: value.current, previous: value.previous }
}

async function writeStoredMetadata(metadata) {
  if (
    !isShellCacheName(metadata.current) ||
    (metadata.previous !== null && !isShellCacheName(metadata.previous)) ||
    metadata.previous === metadata.current
  ) throw new Error('The offline-shell metadata was invalid.')

  const cache = await caches.open(METADATA_CACHE)
  await cache.put(METADATA_KEY, new Response(JSON.stringify(metadata), {
    headers: { 'content-type': 'application/json' },
  }))
  lastKnownMetadata = metadata
}

async function metadataIsComplete(metadata) {
  if (!await shellCacheIsComplete(metadata.current)) return false
  return metadata.previous === null || await shellCacheIsComplete(metadata.previous)
}

async function shellCacheIsComplete(cacheName) {
  if (!isShellCacheName(cacheName)) return false
  const cache = await caches.open(cacheName)
  const root = await cache.match('/')
  if (!root || !isHtmlResponse(root)) return false
  const manifest = await parseShellManifest(root.clone())
  if (cacheNameForEntryPath(manifest.entryPath) !== cacheName) return false
  for (const path of manifest.requiredPaths) {
    const asset = await cache.match(path, { ignoreVary: true })
    if (!asset || !isCacheableStaticResponse(path, asset)) return false
  }
  return true
}

async function cleanupStaleShellCaches(metadata) {
  const retained = new Set(retainedCacheNames(metadata))
  const names = await caches.keys()
  await Promise.all(names.map((name) => {
    if (name === LEGACY_SHELL_CACHE) return caches.delete(name)
    if (name.startsWith(SHELL_CACHE_PREFIX) && !retained.has(name)) {
      return caches.delete(name)
    }
    return Promise.resolve(false)
  }))
}

function retainedCacheNames(metadata) {
  if (!metadata) return []
  return [metadata.current, metadata.previous].filter((name) => isShellCacheName(name))
}

function targetCacheForRequest(request, metadata) {
  const retained = retainedCacheNames(metadata)
  try {
    const referrerPath = new URL(request.referrer).pathname
    const referrerCache = cacheNameForEntryPath(referrerPath)
    if (referrerCache && retained.includes(referrerCache)) return referrerCache
  } catch {
    // Top-level resources can have an empty referrer.
  }
  const requestCache = cacheNameForEntryPath(new URL(request.url).pathname)
  if (requestCache && retained.includes(requestCache)) return requestCache
  return metadata?.current ?? null
}

function cacheNameForEntryPath(pathname) {
  const match = ENTRY_PATH_PATTERN.exec(pathname)
  return match ? `${SHELL_CACHE_PREFIX}${match[1]}` : null
}

function isShellCacheName(value) {
  return typeof value === 'string' && CACHE_NAME_PATTERN.test(value)
}

function reloadRequest(input) {
  return new Request(input, { cache: 'reload' })
}

function isPrivatePath(pathname) {
  return pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/.well-known' ||
    pathname.startsWith('/.well-known/')
}

function isStaticRequest(url) {
  return !url.search && (
    url.pathname.startsWith('/assets/') || isPublicStaticPath(url.pathname)
  )
}

function isPublicStaticPath(pathname) {
  return pathname === '/mark.svg'
}

function isHtmlResponse(response) {
  return response.ok &&
    response.headers.get('content-type')?.toLowerCase().startsWith('text/html') === true
}

function isCacheableStaticResponse(pathname, response) {
  if (!response.ok || response.type !== 'basic') return false
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (pathname.endsWith('.js')) return contentType.includes('javascript')
  if (pathname.endsWith('.css')) return contentType.startsWith('text/css')
  return contentType.length > 0 && !contentType.startsWith('text/html')
}
