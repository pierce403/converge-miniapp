import { beforeEach, describe, expect, it } from 'vitest'

import { clearContacts, mergeContacts, readContacts } from './contactStore'
import type { Contact } from '../messaging/types'

const ownInbox = 'aa'.repeat(32)
const peerInbox = 'bb'.repeat(32)
const address = '0x2222222222222222222222222222222222222222' as const

describe('contactStore', () => {
  beforeEach(() => window.localStorage.clear())

  it('scopes contacts to the active XMTP inbox', () => {
    mergeContacts(ownInbox, [contact()])

    expect(readContacts(ownInbox)).toHaveLength(1)
    expect(readContacts('cc'.repeat(32))).toEqual([])
  })

  it('lets a self-authored Convos profile name outrank an imported Farcaster name', () => {
    mergeContacts(ownInbox, [contact({
      displayName: 'Alice on Farcaster',
      source: 'farcaster',
    })])
    mergeContacts(ownInbox, [contact({
      displayName: 'Alice in Convos',
      source: 'convos-profile',
    })])

    expect(readContacts(ownInbox)[0]?.displayName).toBe('Alice in Convos')
  })

  it('preserves a conversation link when a profile refreshes the contact', () => {
    mergeContacts(ownInbox, [contact({ conversationId: 'dm-1' })])
    mergeContacts(ownInbox, [contact({
      conversationId: null,
      displayName: 'Alice',
      source: 'convos-profile',
    })])

    expect(readContacts(ownInbox)[0]?.conversationId).toBe('dm-1')
  })

  it('can clear one inbox directory', () => {
    mergeContacts(ownInbox, [contact()])
    clearContacts(ownInbox)

    expect(readContacts(ownInbox)).toEqual([])
  })
})

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    address,
    avatarUrl: null,
    conversationId: 'dm-1',
    displayName: null,
    fid: null,
    inboxId: peerInbox,
    source: 'conversation' as const,
    updatedAt: 1,
    username: null,
    ...overrides,
  }
}
