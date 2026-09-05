import { cloneElement, createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppShell } from '../../src/app/AppShell'
import type { MiniAppHostState } from '../../src/app/useMiniAppHost'
import { StatePanel } from '../../src/components/StatePanel'
import { ContactsScreen } from '../../src/features/contacts/ContactsScreen'
import { ConversationScreen } from '../../src/features/messaging/ConversationScreen'
import { InboxScreen } from '../../src/features/messaging/InboxScreen'
import { JoinConvosScreen } from '../../src/features/messaging/JoinConvosScreen'
import { NewDmScreen } from '../../src/features/messaging/NewDmScreen'
import type { ActiveConversation, ConversationSummary, MessageItem } from '../../src/features/messaging/types'

const noop = () => undefined
const address = '0x1111111111111111111111111111111111111111' as const

function renderScreen(children: ReactNode, platform?: 'mobile' | 'web', withInsets = false) {
  const host: MiniAppHostState = {
    capabilities: [],
    context: {
      client: {
        added: true,
        notificationsEnabled: true,
        ...(platform ? { platformType: platform } : {}),
        safeAreaInsets: withInsets
          ? { top: 72, right: 3, bottom: 18, left: 2 }
          : { top: 0, right: 0, bottom: 0, left: 0 },
      },
      user: { fid: 1 },
    },
    error: null,
    status: 'embedded',
  }
  return renderToStaticMarkup(createElement(AppShell, { host, children }))
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

// Public synthetic content only. These exercise the populated screens where
// duplicate native chrome left a band above the header, not an empty state.
const group: ActiveConversation = {
  id: 'layout-group', kind: 'convos-group', title: 'Weekend plans', emoji: '🌲',
  creatorInboxId: 'layout-creator', peerAddress: null, peerInboxId: null,
}
const dm: ActiveConversation = {
  id: 'layout-dm', kind: 'dm', peerAddress: address, peerInboxId: 'layout-peer',
  peerDisplayName: 'Alex',
}
const conversations: ConversationSummary[] = Array.from({ length: 14 }, (_, index) => ({
  ...(index % 2 ? dm : group), id: `layout-${index}`,
  isOwnLastMessage: false, preview: 'See you at the park this weekend.',
  updatedAt: new Date('2026-09-01T09:00:00Z'),
}))
function messages(conversationId: string): MessageItem[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `message-${index}`, conversationId, senderInboxId: 'layout-peer',
    text: 'The weather looks good for a walk. Shall we meet near the entrance?',
    canRetry: false, delivery: 'sent', isOwn: index % 3 === 2,
    sentAt: new Date('2026-09-01T09:00:00Z'), sentAtNs: 1n, unsupported: false,
  }))
}
const populatedScreens = {
  inbox: cloneElement(screens.inbox, { conversations }),
  group: cloneElement(screens.conversation, {
    conversation: group, messages: messages(group.id), hasOlder: true,
    contactNameFor: () => 'Alex',
  }),
  dm: cloneElement(screens.conversation, { conversation: dm, messages: messages(dm.id) }),
}

export function renderLayoutFixtures(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const platform of ['mobile', 'web', undefined] as const) {
    result[platform ?? 'unknown'] = renderScreen(createElement(StatePanel, {
      busy: true, title: 'Opening your inbox', eyebrow: 'Private inbox',
      description: 'Connecting to your inbox.',
    }), platform)
  }
  for (const [name, screen] of Object.entries(screens)) {
    result[name] = renderScreen(createElement('div', { className: 'messaging-app' }, screen), 'mobile')
  }
  for (const platform of ['mobile', 'web', undefined] as const) {
    for (const [name, screen] of Object.entries(populatedScreens)) {
      result[`insets-${platform ?? 'unknown'}-${name}`] = renderScreen(
        createElement('div', { className: 'messaging-app' }, screen), platform, true,
      )
    }
  }
  return result
}
