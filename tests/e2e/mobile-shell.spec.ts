import { expect, test } from '@playwright/test'

test('standalone shell fits an embedded mobile viewport', async ({ page }) => {
  const response = await page.goto('/')

  expect(response?.headers()['content-security-policy']).toContain(
    "script-src 'self' 'wasm-unsafe-eval'",
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

test('Worker health is versioned and an unsigned manifest fails closed', async ({ request }) => {
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
