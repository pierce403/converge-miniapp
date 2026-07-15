import { expect, test } from '@playwright/test'

test('standalone shell fits an embedded mobile viewport', async ({ page }) => {
  await page.goto('/')

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
})
