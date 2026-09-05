import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// Compile app JSX through Vite, outside Playwright's component-test JSX
// transform, then use the real component markup with the page's stylesheet.
const layouts: Record<string, string> = JSON.parse(execFileSync(process.execPath, [
  resolve('scripts/render-layout-fixtures.mjs'),
], { encoding: 'utf8' }))

async function renderScreen(page: Page, markup: string | undefined) {
  if (!markup) throw new Error('Layout fixture is missing')
  await page.evaluate((html) => {
    const root = document.getElementById('root')
    if (!root) throw new Error('App root is missing')
    root.innerHTML = html
  }, markup)
}

async function topGap(page: Page, container: string, content: string) {
  return page.evaluate(({ container, content }) => {
    const parent = document.querySelector(container)
    const child = document.querySelector(content)
    if (!parent || !child) throw new Error('Layout content is missing')
    return child.getBoundingClientRect().top - parent.getBoundingClientRect().top
  }, { container, content })
}

for (const viewport of [
  { width: 320, height: 695 },
  { width: 390, height: 844 },
  { width: 424, height: 420 },
  { width: 1363, height: 936 },
]) {
  test(`content starts at the top across screens at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.locator('.standalone')).toBeVisible()
    expect(await topGap(page, '.app-main', '.standalone')).toBeLessThanOrEqual(22)

    for (const platform of ['mobile', 'web', undefined] as const) {
      await renderScreen(page, layouts[platform ?? 'unknown'])
      expect(await topGap(page, '.app-main', '.state-panel')).toBeLessThanOrEqual(22)
    }

    for (const name of ['inbox', 'contacts', 'conversation', 'compose', 'join']) {
      await renderScreen(page, layouts[name])
      expect(await topGap(page, '.app-shell', '.messaging-screen'), name).toBeLessThanOrEqual(12)
      if (name === 'inbox' || name === 'contacts') {
        expect(await topGap(page, '.empty-inbox', '.empty-inbox__icon'), name).toBeLessThanOrEqual(28)
      }
      if (name === 'conversation') {
        expect(await topGap(page, '.message-list', '.conversation-start')).toBeLessThanOrEqual(16)
        const bottomGap = await page.evaluate(() => {
          const screen = document.querySelector('.conversation-screen')!
          const composer = document.querySelector('.message-composer')!
          return screen.getBoundingClientRect().bottom - composer.getBoundingClientRect().bottom
        })
        expect(Math.abs(bottomGap)).toBeLessThan(1)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    }
  })

  for (const platform of ['mobile', 'web', 'unknown']) {
    test(`populated ${platform} headers avoid duplicate chrome at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      // Exercise the shipped SDK and AppShell with a synthetic native bridge.
      // No wallet capability, signatures, or private messaging data are supplied.
      await page.addInitScript((platform) => {
        const context = {
          client: {
            added: true, clientFid: 1,
            ...(platform === 'unknown' ? {} : { platformType: platform }),
            safeAreaInsets: { top: 72, right: 3, bottom: 18, left: 2 },
          },
          user: { fid: 1, displayName: 'Layout review' },
        }
        Object.defineProperty(window, 'ReactNativeWebView', {
          value: { postMessage(message: string) {
            const request = JSON.parse(message) as { id: string, path: string[] }
            const method = request.path.join('.')
            const value = method === 'context' ? context : method === 'getCapabilities' ? [] : undefined
            queueMicrotask(() => document.dispatchEvent(new MessageEvent('FarcasterFrameCallback', {
              data: { id: request.id, type: 'RAW', value },
            })))
          } },
        })
      }, platform)
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'This Farcaster client cannot open XMTP' })).toBeVisible()

      for (const name of ['inbox', 'group', 'dm']) {
        const markup = layouts[`insets-${platform}-${name}`]
        if (!markup) throw new Error('Populated layout fixture is missing')
        await page.evaluate((markup) => {
          const fixture = new DOMParser().parseFromString(markup, 'text/html')
          const messaging = fixture.querySelector('.messaging-app')
          const main = document.querySelector('.app-main')
          if (!messaging || !main) throw new Error('Messaging layout is missing')
          // Keep the live AppShell and its SDK-derived inset values. Replace
          // only the wallet-unavailable panel with synthetic screen content.
          main.replaceChildren(messaging)
        }, markup)
        const expectedGap = platform === 'web' ? 73 : 1
        expect(await topGap(page, '.messaging-app', '.screen-header'), `${platform} ${name}`)
          .toBe(expectedGap)
        const layout = await page.evaluate(() => {
          const shell = document.querySelector('.app-shell')!
          const surface = document.querySelector('.messaging-app')!
          const screen = document.querySelector('.messaging-screen')!
          const composer = document.querySelector('.message-composer')
          const style = getComputedStyle(shell)
          return {
            bottom: style.paddingBottom, left: style.paddingLeft, right: style.paddingRight,
            surfaceBottom: shell.getBoundingClientRect().bottom - surface.getBoundingClientRect().bottom,
            composerGap: composer
              ? screen.getBoundingClientRect().bottom - composer.getBoundingClientRect().bottom
              : 0,
            width: document.documentElement.scrollWidth,
          }
        })
        expect(layout).toMatchObject({ bottom: '18px', left: '2px', right: '3px', width: viewport.width })
        expect(Math.abs(layout.composerGap)).toBeLessThan(1)
        expect(layout.surfaceBottom).toBeGreaterThanOrEqual(18)

        const scroller = page.locator(name === 'inbox' ? '.conversation-list' : '.message-list')
        await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
        expect(await topGap(page, '.messaging-app', '.screen-header')).toBe(expectedGap)
        if (platform === 'unknown' && viewport.width === 390) {
          await testInfo.attach(`${name}-native-header`, {
            body: await page.screenshot(), contentType: 'image/png',
          })
        }
      }
    })
  }
}
