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

  test(`populated headers avoid duplicate native chrome at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.locator('.standalone')).toBeVisible()

    for (const platform of ['mobile', 'web', 'unknown']) {
      for (const name of ['inbox', 'group', 'dm']) {
        await renderScreen(page, layouts[`insets-${platform}-${name}`])
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
    }
  })
}
