import { defineConfig, devices } from '@playwright/test'

const productionLayout = process.env.PLAYWRIGHT_PRODUCTION_LAYOUT === '1'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: productionLayout ? 'https://miniapp.converge.cv' : 'http://127.0.0.1:4173',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  ...(productionLayout ? { testMatch: 'content-spacing.spec.ts' } : {
    webServer: {
      command: 'npm run preview -- --host 127.0.0.1',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://127.0.0.1:4173',
    },
  }),
})
