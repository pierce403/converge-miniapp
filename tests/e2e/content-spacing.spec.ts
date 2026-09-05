import { expect, test, type Page } from '@playwright/test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppShell } from '../../src/app/AppShell'
import type { MiniAppHostState } from '../../src/app/useMiniAppHost'
import { StatePanel } from '../../src/components/StatePanel'
import { ContactsScreen } from '../../src/features/contacts/ContactsScreen'
import { ConversationScreen } from '../../src/features/messaging/ConversationScreen'
import { InboxScreen } from '../../src/features/messaging/InboxScreen'
import { JoinConvosScreen } from '../../src/features/messaging/JoinConvosScreen'
import { NewDmScreen } from '../../src/features/messaging/NewDmScreen'

const noop = () => undefined
const address = '0x1111111111111111111111111111111111111111' as const

async function renderScreen(page: Page, children: ReactNode, platform?: 'mobile' | 'web') {
  const host: MiniAppHostState = {
    capabilities: [],
    context: {
      client: {
        added: true,
        notificationsEnabled: true,
        ...(platform ? { platformType: platform } : {}),
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      user: { fid: 1 },
    },
    error: null,
    status: 'embedded',
  }
  const markup = renderToStaticMarkup(createElement(AppShell, { host, children }))
  // Keep the real deployed stylesheet; substitute only public, deterministic
  // component props so layout checks never need a wallet or private messages.
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

const screens = {
  inbox: createElement(InboxScreen, {
    address,
    conversations: [],
    ensIdentity: { candidate: null, preference: null, relationship: null, status: 'none' },
    environment: 'production',
    inboxId: 'a'.repeat(64),
    onClearEnsPreference: noop,
    onContacts: noop,
    onJoinConvos: noop,
    onNewDm: noop,
    onOpen: noop,
    onRefresh: noop,
    onRefreshEns: noop,
    onRetryLiveUpdates: noop,
    onUseEns: noop,
    participantIdentityFor: () => null,
    profile: { displayName: 'Layout review' },
    refreshing: false,
    streamHealth: 'live',
  }),
  contacts: createElement(ContactsScreen, {
    contacts: [], importing: false, offline: false, onBack: noop,
    onImportFollows: async () => null, onMessage: noop,
  }),
  conversation: createElement(ConversationScreen, {
    conversation: { id: 'review', kind: 'dm', peerAddress: address, peerInboxId: 'peer' },
    hasOlder: false, loading: false, loadingOlder: false, messages: [],
    onBack: noop, onLoadOlder: async () => undefined, onRetry: noop,
    onRetryLiveUpdates: noop, onSend: async () => undefined,
    sending: false, streamHealth: 'live',
  }),
  compose: createElement(NewDmScreen, {
    ownAddress: address, onBack: noop, onCheckReachability: async () => false,
    onCreate: async () => undefined, onInspectIdentity: async () => 'no-inbox',
    onResetResolution: noop, onResolveEns: async () => null, resolutionError: null,
  }),
  join: createElement(JoinConvosScreen, {
    onBack: noop, onOpenConversation: noop, onRequestAccess: async () => undefined,
    onReset: noop, onRetry: async () => undefined, request: null,
  }),
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
      await renderScreen(page, createElement(StatePanel, {
        busy: true, title: 'Opening your inbox', eyebrow: 'Private inbox',
        description: 'Connecting to your inbox.',
      }), platform)
      expect(await topGap(page, '.app-main', '.state-panel')).toBeLessThanOrEqual(22)
    }

    for (const [name, screen] of Object.entries(screens)) {
      await renderScreen(page, createElement('div', { className: 'messaging-app' }, screen), 'mobile')
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
}
