import { expect, test } from '@playwright/test'

test('standalone shell fits an embedded mobile viewport', async ({ page }) => {
  const response = await page.goto('/')

  const contentSecurityPolicy = response?.headers()['content-security-policy']
  expect(contentSecurityPolicy).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(contentSecurityPolicy).toContain(
    "connect-src 'self' https://auth.farcaster.xyz",
  )
  expect(response?.headers()['x-content-type-options']).toBe('nosniff')

  await expect(
    page.getByRole('heading', {
      name: 'Private messages, right where the conversation starts.',
    }),
  ).toBeVisible()

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))

  expect(viewport).toEqual({
    clientWidth: 390,
    innerWidth: 390,
    scrollWidth: 390,
  })
  await expect(page.getByText('XMTP', { exact: true })).toBeVisible()
  await expect(page.getByText('miniapp.converge.cv')).toBeVisible()

  const embeds = await page.locator('meta[name="fc:miniapp"], meta[name="fc:frame"]')
    .evaluateAll((elements) => elements.map((element) => JSON.parse(
      element.getAttribute('content') ?? '',
    )))
  expect(embeds).toHaveLength(2)
  expect(embeds.map((embed) => embed.version)).toEqual(['1', '1'])
})

test('the public app shell reopens offline after one online visit', async ({ context, page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', {
    name: 'Private messages, right where the conversation starts.',
  })).toBeVisible()
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable')
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        })
      })
    }
  })
  await expect.poll(async () => await page.evaluate(async () => {
    const metadataCache = await caches.open('converge-miniapp-static-meta-v1')
    const pointer = await metadataCache.match('/__converge-offline-shell-metadata__')
    if (!pointer) return ['offline-shell metadata']
    const metadata = await pointer.json() as {
      current?: string
      previous?: string | null
    }
    if (!metadata.current?.startsWith('converge-miniapp-static-shell-index-')) {
      return ['valid current generation']
    }
    const shellCacheNames = (await caches.keys()).filter(
      (name) => name.startsWith('converge-miniapp-static-shell-'),
    )
    if (shellCacheNames.length > 2) return ['at most two shell generations']
    if (!shellCacheNames.includes(metadata.current)) return ['current generation cache']
    if (
      metadata.previous != null &&
      (!metadata.previous.startsWith('converge-miniapp-static-shell-index-') ||
        metadata.previous === metadata.current ||
        !shellCacheNames.includes(metadata.previous))
    ) return ['valid previous generation']
    const cache = await caches.open(metadata.current)
    if (!await cache.match('/')) return ['cached root shell']
    const urls = performance.getEntriesByType('resource')
      .map((entry) => new URL(entry.name))
      .filter((url) => url.origin === window.location.origin && url.pathname.startsWith('/assets/'))
    const missing = []
    for (const url of urls) {
      if (!await cache.match(url.pathname, { ignoreVary: true })) missing.push(url.pathname)
    }
    return missing
  })).toEqual([])
  const protectedPathsCached = await page.evaluate(async () => {
    await fetch('/api/health')
    await fetch('/.well-known/farcaster.json')
    const cacheNames = await caches.keys()
    for (const name of cacheNames) {
      if (!name.startsWith('converge-miniapp-static-shell-')) continue
      const keys = await (await caches.open(name)).keys()
      if (keys.some(({ url }) => {
        const { pathname } = new URL(url)
        return pathname === '/api' || pathname.startsWith('/api/') ||
          pathname === '/.well-known' || pathname.startsWith('/.well-known/')
      })) return true
    }
    return false
  })
  expect(protectedPathsCached).toBe(false)

  // A controlled navigation to a public subresource must never overwrite the
  // cached root, and a Cloudflare-style HTML fallback must never enter an
  // immutable asset generation.
  const subresourcePage = await context.newPage()
  await subresourcePage.goto('/mark.svg')
  await subresourcePage.goto('/service-worker.js')
  await subresourcePage.close()
  await page.evaluate(async () => {
    await fetch('/assets/converge-offline-review-missing.js')
  })
  const fallbackWasCached = await page.evaluate(async () => {
    const cacheNames = await caches.keys()
    for (const name of cacheNames) {
      if (!name.startsWith('converge-miniapp-static-shell-')) continue
      if (await (await caches.open(name)).match(
        '/assets/converge-offline-review-missing.js',
        { ignoreVary: true },
      )) return true
    }
    return false
  })
  expect(fallbackWasCached).toBe(false)

  try {
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', {
      name: 'Private messages, right where the conversation starts.',
    })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})

test('ready messaging does not duplicate the mobile host top inset', async ({ page }) => {
  await page.goto('/')

  const layout = await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>('.app-shell')
    const main = document.querySelector<HTMLElement>('.app-main')
    if (!shell || !main) throw new Error('App shell did not render')

    shell.style.setProperty('--host-safe-top', '72px')
    shell.style.setProperty('--host-messaging-safe-top', '0px')
    const messaging = document.createElement('div')
    messaging.className = 'messaging-app'
    const screen = document.createElement('section')
    screen.className = 'messaging-screen'
    messaging.append(screen)
    const ensOffer = document.createElement('dialog')
    ensOffer.className = 'ens-offer'
    ensOffer.setAttribute('open', '')
    messaging.append(ensOffer)
    main.replaceChildren(messaging)

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    return {
      ensOfferSafePadding: getComputedStyle(ensOffer).paddingTop,
      messagingSafePadding: getComputedStyle(messaging).paddingTop,
      shellPaddingTop: getComputedStyle(shell).paddingTop,
      surfaceTop: Math.round(
        messaging.getBoundingClientRect().top - shell.getBoundingClientRect().top,
      ),
    }
  })

  expect(layout).toEqual({
    ensOfferSafePadding: '18px',
    messagingSafePadding: '0px',
    shellPaddingTop: '0px',
    surfaceTop: 10,
  })
})

test('Worker health is versioned and a noncanonical-host manifest fails closed', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({
    environment: 'production',
    ok: true,
    service: 'converge-miniapp',
    version: { app: '0.1.0' },
  })

  const manifest = await request.get('/.well-known/farcaster.json')
  expect(manifest.status()).toBe(503)
  expect(await manifest.json()).toEqual({
    error: 'manifest_not_configured',
  })
})

test('short visual viewports remain bounded instead of clipping below the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 })
  await page.goto('/')

  const layout = await page.evaluate(() => ({
    shellHeight: document.querySelector('.app-shell')?.getBoundingClientRect().height,
    viewportHeight: window.innerHeight,
  }))
  expect(layout.shellHeight).toBe(layout.viewportHeight)
})
