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

test('ready messaging surface extends beneath the reserved top safe area', async ({ page }) => {
  await page.goto('/')

  const layout = await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>('.app-shell')
    const main = document.querySelector<HTMLElement>('.app-main')
    if (!shell || !main) throw new Error('App shell did not render')

    shell.style.setProperty('--host-safe-top', '72px')
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
    ensOfferSafePadding: '72px',
    messagingSafePadding: '72px',
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
