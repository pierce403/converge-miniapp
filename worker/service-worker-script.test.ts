// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://miniapp.converge.cv'

type WorkerEventName = 'activate' | 'fetch' | 'install' | 'message'
type WorkerListener = (event: unknown) => void

class WorkerRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(
      typeof input === 'string' ? new URL(input, ORIGIN) : input,
      init,
    )
  }
}

class MemoryCache {
  readonly entries = new Map<string, Response>()
  readonly name: string
  private readonly storage: MemoryCacheStorage

  constructor(
    name: string,
    storage: MemoryCacheStorage,
  ) {
    this.name = name
    this.storage = storage
  }

  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    const response = this.entries.get(cacheKey(input))
    return response ? cloneResponse(response) : undefined
  }

  async delete(input: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(cacheKey(input))
  }

  async keys(): Promise<ReadonlyArray<Request>> {
    return [...this.entries.keys()].map((key) => new WorkerRequest(key))
  }

  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    const key = cacheKey(input)
    this.storage.putAttempts.push({ cacheName: this.name, key })
    if (this.storage.rejectPut?.(this.name, key)) {
      throw new Error('Cache Storage quota exceeded')
    }
    this.entries.set(key, cloneResponse(response))
  }
}

class MemoryCacheStorage {
  readonly stores = new Map<string, MemoryCache>()
  readonly putAttempts: Array<{ cacheName: string; key: string }> = []
  rejectPut?: (cacheName: string, key: string) => boolean

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name)
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()]
  }

  async open(name: string): Promise<MemoryCache> {
    let cache = this.stores.get(name)
    if (!cache) {
      cache = new MemoryCache(name, this)
      this.stores.set(name, cache)
    }
    return cache
  }
}

interface WorkerHarness {
  caches: MemoryCacheStorage
  dispatchActivate: () => Promise<void>
  dispatchFetch: (
    path: string,
    mode?: 'navigate' | 'same-origin',
  ) => Promise<Response>
  dispatchInstall: () => Promise<void>
  fetcher: ReturnType<typeof vi.fn<(request: RequestInfo | URL) => Promise<Response>>>
}

async function workerHarness(
  fetcher: WorkerHarness['fetcher'],
): Promise<WorkerHarness> {
  const source = await readFile(resolve('public/service-worker.js'), 'utf8')
  const listeners = new Map<WorkerEventName, WorkerListener>()
  const caches = new MemoryCacheStorage()
  const self = {
    addEventListener: (name: WorkerEventName, listener: WorkerListener) => {
      listeners.set(name, listener)
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    location: { origin: ORIGIN },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
  }

  runInNewContext(source, {
    Array,
    Error,
    Map,
    Promise,
    Request: WorkerRequest,
    Response,
    Set,
    URL,
    caches,
    fetch: fetcher,
    self,
  }, { filename: 'public/service-worker.js' })

  return {
    caches,
    fetcher,
    dispatchActivate: async () => {
      let work: Promise<unknown> | undefined
      listeners.get('activate')?.({
        waitUntil: (promise: Promise<unknown>) => {
          work = Promise.resolve(promise)
        },
      })
      if (!work) throw new Error('The worker did not register an activate handler.')
      await work
    },
    dispatchInstall: async () => {
      let work: Promise<unknown> | undefined
      listeners.get('install')?.({
        waitUntil: (promise: Promise<unknown>) => {
          work = Promise.resolve(promise)
        },
      })
      if (!work) throw new Error('The worker did not register an install handler.')
      await work
    },
    dispatchFetch: async (path, mode = 'same-origin') => {
      let response: Promise<Response> | undefined
      const request = new WorkerRequest(path)
      Object.defineProperty(request, 'mode', { value: mode })
      listeners.get('fetch')?.({
        request,
        respondWith: (candidate: Promise<Response> | Response) => {
          response = Promise.resolve(candidate)
        },
      })
      if (!response) throw new Error(`The worker did not handle ${path}.`)
      return response
    },
  }
}

describe('offline service worker script', () => {
  it('does not clean up complete caches from corrupt activation metadata', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === '/') return htmlResponse(shellHtml('alpha'))
      if (path === entryPath('alpha')) {
        return basicResponse('console.log("alpha")', 'text/javascript')
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    const worker = await workerHarness(fetcher)
    const unrelated = await worker.caches.open('another-app-activation-cache')
    await unrelated.put('/keep', basicResponse('keep', 'text/plain'))
    await worker.dispatchInstall()
    const metadata = await worker.caches.open('converge-miniapp-static-meta-v1')
    await metadata.put(
      '/__converge-offline-shell-metadata__',
      Response.json({
        current: 'converge-miniapp-static-shell-index-fake123',
        previous: null,
      }),
    )

    await worker.dispatchActivate()

    expect(await worker.caches.keys()).toEqual(expect.arrayContaining([
      'another-app-activation-cache',
      'converge-miniapp-static-shell-index-alpha-entry',
    ]))
    await expect(unrelated.match('/keep')).resolves.toBeDefined()
    const completeShell = await worker.caches.open(
      'converge-miniapp-static-shell-index-alpha-entry',
    )
    await expect(completeShell.match('/')).resolves.toBeDefined()
  })

  it('retains only the current and previous complete shell generations', async () => {
    let offline = false
    let version = 'alpha'
    let rejectPreviousAssetNetwork = false
    const previousOnlyPath = '/assets/chunk-bravo123.js'
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (offline) throw new TypeError('offline')
      if (path === '/') {
        return htmlResponse(shellHtml(
          version,
          version === 'bravo' ? [previousOnlyPath] : [],
        ))
      }
      if (path === previousOnlyPath) {
        if (rejectPreviousAssetNetwork) {
          throw new Error('The previous-generation asset reached the network.')
        }
        return basicResponse('console.log("bravo chunk")', 'text/javascript')
      }
      if (/^\/assets\/index-[a-z]+-entry\.js$/u.test(path)) {
        return basicResponse(`console.log("${version}")`, 'text/javascript')
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    const worker = await workerHarness(fetcher)
    const unrelated = await worker.caches.open('another-app-cache')
    await unrelated.put('/keep', basicResponse('keep', 'text/plain'))

    await worker.dispatchInstall()
    version = 'bravo'
    await worker.dispatchFetch('/', 'navigate')
    version = 'charlie'
    await worker.dispatchFetch('/', 'navigate')

    expect(await worker.caches.keys()).toEqual(expect.arrayContaining([
      'another-app-cache',
      'converge-miniapp-static-meta-v1',
      'converge-miniapp-static-shell-index-bravo-entry',
      'converge-miniapp-static-shell-index-charlie-entry',
    ]))
    expect(await worker.caches.keys()).not.toContain(
      'converge-miniapp-static-shell-index-alpha-entry',
    )
    const metadataCache = await worker.caches.open(
      'converge-miniapp-static-meta-v1',
    )
    const metadata = await metadataCache.match(
      '/__converge-offline-shell-metadata__',
    )
    await expect(metadata?.json()).resolves.toEqual({
      current: 'converge-miniapp-static-shell-index-charlie-entry',
      previous: 'converge-miniapp-static-shell-index-bravo-entry',
    })

    rejectPreviousAssetNetwork = true
    const previousAsset = await worker.dispatchFetch(previousOnlyPath)
    await expect(previousAsset.text()).resolves.toBe('console.log("bravo chunk")')
    offline = true
    const offlineShell = await worker.dispatchFetch('/', 'navigate')
    await expect(offlineShell.text()).resolves.toContain('shell-charlie')
  })

  it('removes partial generations after repeated pre-pointer cache failures', async () => {
    let offline = false
    let version = 'alpha'
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (offline) throw new TypeError('offline')
      if (path === '/') return htmlResponse(shellHtml(version))
      if (path === entryPath(version)) {
        return basicResponse(`console.log("${version}")`, 'text/javascript')
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    const worker = await workerHarness(fetcher)
    await worker.dispatchInstall()
    worker.caches.rejectPut = (cacheName, key) => (
      cacheName === shellCacheName(version) && key === entryPath(version)
    )

    version = 'failedone'
    await worker.dispatchFetch('/', 'navigate')

    expect(await worker.caches.keys()).not.toContain(shellCacheName('failedone'))
    const metadataCache = await worker.caches.open(
      'converge-miniapp-static-meta-v1',
    )
    const firstPointer = await metadataCache.match(
      '/__converge-offline-shell-metadata__',
    )
    await expect(firstPointer?.json()).resolves.toEqual({
      current: shellCacheName('alpha'),
      previous: null,
    })
    const originalShell = await worker.caches.open(shellCacheName('alpha'))
    await expect(originalShell.match('/')).resolves.toBeDefined()

    version = 'failedtwo'
    await worker.dispatchFetch('/', 'navigate')

    const cacheNames = await worker.caches.keys()
    expect(cacheNames).not.toContain(shellCacheName('failedone'))
    expect(cacheNames).not.toContain(shellCacheName('failedtwo'))
    expect(cacheNames.filter((name) => (
      name.startsWith('converge-miniapp-static-shell-')
    ))).toEqual([shellCacheName('alpha')])
    const secondPointer = await metadataCache.match(
      '/__converge-offline-shell-metadata__',
    )
    await expect(secondPointer?.json()).resolves.toEqual({
      current: shellCacheName('alpha'),
      previous: null,
    })

    offline = true
    const offlineShell = await worker.dispatchFetch('/', 'navigate')
    await expect(offlineShell.text()).resolves.toContain('shell-alpha')
  })

  it.each([
    ['a missing asset', () => basicResponse('missing', 'text/plain', 404)],
    ['an HTML fallback', () => basicResponse('<h1>fallback</h1>', 'text/html')],
  ])('keeps the last complete shell when an update has %s', async (_, badAsset) => {
    let phase: 'install' | 'offline' | 'update' = 'install'
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (phase === 'offline') throw new TypeError('offline')
      if (path === '/') {
        return htmlResponse(phase === 'install'
          ? shellHtml('old')
          : shellHtml('broken'))
      }
      if (path === entryPath('old')) {
        return basicResponse('console.log("old")', 'text/javascript')
      }
      if (path === entryPath('broken')) return badAsset()
      throw new Error(`Unexpected fetch: ${path}`)
    })
    const worker = await workerHarness(fetcher)

    await worker.dispatchInstall()
    phase = 'update'
    const liveUpdate = await worker.dispatchFetch('/', 'navigate')
    expect(await liveUpdate.text()).toContain('shell-broken')

    phase = 'offline'
    const offlineShell = await worker.dispatchFetch('/', 'navigate')
    const offlineHtml = await offlineShell.text()
    expect(offlineHtml).toContain('shell-old')
    expect(offlineHtml).not.toContain('shell-broken')
  })

  it('returns a successful live static response when Cache Storage put fails', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === '/') return htmlResponse(shellHtml('old'))
      if (path === entryPath('old')) {
        return basicResponse('console.log("old")', 'text/javascript')
      }
      if (path === '/assets/lazy.js') {
        return basicResponse('console.log("live lazy")', 'text/javascript')
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    const worker = await workerHarness(fetcher)
    await worker.dispatchInstall()
    worker.caches.rejectPut = (_cacheName, key) => key === '/assets/lazy.js'

    const response = await worker.dispatchFetch('/assets/lazy.js')

    expect(response.ok).toBe(true)
    await expect(response.text()).resolves.toBe('console.log("live lazy")')
    expect(worker.caches.putAttempts).toContainEqual(expect.objectContaining({
      key: '/assets/lazy.js',
    }))
  })

  it('does not replace the root shell after a controlled subresource navigation', async () => {
    let offline = false
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (offline) throw new TypeError('offline')
      if (path === '/') return htmlResponse(shellHtml('old'))
      if (path === entryPath('old')) {
        return basicResponse('console.log("old")', 'text/javascript')
      }
      if (path === '/mark.svg') {
        return basicResponse('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml')
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    const worker = await workerHarness(fetcher)
    await worker.dispatchInstall()

    const mark = await worker.dispatchFetch('/mark.svg', 'navigate')
    expect(mark.headers.get('content-type')).toBe('image/svg+xml')
    offline = true

    const offlineShell = await worker.dispatchFetch('/', 'navigate')
    await expect(offlineShell.text()).resolves.toContain('shell-old')
  })

  it('bypasses a poisoned browser HTTP cache on a static cache miss', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input)
      if (path === '/') return htmlResponse(shellHtml('old'))
      if (path === entryPath('old')) {
        return basicResponse('console.log("old")', 'text/javascript')
      }
      if (path === '/assets/lazy.js') {
        const request = input instanceof Request ? input : new WorkerRequest(input)
        return (request as unknown as { cache?: string }).cache === 'reload'
          ? basicResponse('console.log("fresh")', 'text/javascript')
          : basicResponse('<h1>poisoned fallback</h1>', 'text/html')
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    const worker = await workerHarness(fetcher)
    await worker.dispatchInstall()

    const response = await worker.dispatchFetch('/assets/lazy.js')

    await expect(response.text()).resolves.toBe('console.log("fresh")')
    const retry = worker.fetcher.mock.calls
      .map(([input]) => input)
      .find((input) => requestPath(input) === '/assets/lazy.js')
    expect(retry).toBeInstanceOf(Request)
    expect((retry as Request).cache).toBe('reload')
  })
})

function basicResponse(
  body: BodyInit,
  contentType: string,
  status = 200,
): Response {
  const response = new Response(body, {
    headers: { 'content-type': contentType },
    status,
  })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

function cacheKey(input: RequestInfo | URL): string {
  const url = input instanceof Request
    ? new URL(input.url)
    : new URL(String(input), ORIGIN)
  return `${url.pathname}${url.search}`
}

function cloneResponse(response: Response): Response {
  const clone = response.clone()
  Object.defineProperty(clone, 'type', { value: response.type })
  return clone
}

function htmlResponse(html: string): Response {
  return basicResponse(html, 'text/html; charset=utf-8')
}

function entryPath(version: string): string {
  return `/assets/index-${version}-entry.js`
}

function requestPath(input: RequestInfo | URL): string {
  return cacheKey(input)
}

function shellCacheName(version: string): string {
  return `converge-miniapp-static-shell-index-${version}-entry`
}

function shellHtml(version: string, extraPaths: string[] = []): string {
  const extras = extraPaths
    .map((path) => `<script type="module" src="${path}"></script>`)
    .join('')
  return `<!doctype html><html><head><script type="module" src="${entryPath(version)}"></script>${extras}</head><body><h1>shell-${version}</h1></body></html>`
}
