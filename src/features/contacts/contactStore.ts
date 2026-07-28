import { getAddress, isAddress } from 'viem'

import type { Contact } from '../messaging/types'

const KEY_PREFIX = 'converge-miniapp:contacts:v1:'
const MAX_CONTACTS = 500
const MAX_NAME_LENGTH = 50
const MAX_USERNAME_LENGTH = 64
const MAX_AVATAR_URL_LENGTH = 2_048

export function readContacts(inboxId: string): Contact[] {
  const storage = safeStorage()
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(contactKey(inboxId)) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .flatMap((value) => {
        const contact = parseContact(value)
        return contact ? [contact] : []
      })
      .sort(compareContacts)
      .slice(0, MAX_CONTACTS)
  } catch {
    return []
  }
}

export function mergeContacts(
  inboxId: string,
  additions: Contact[],
): Contact[] {
  const contacts = new Map(
    readContacts(inboxId).map((contact) => [contact.inboxId.toLowerCase(), contact]),
  )
  for (const addition of additions) {
    const valid = parseContact(addition)
    if (!valid || valid.inboxId.toLowerCase() === inboxId.toLowerCase()) continue
    const key = valid.inboxId.toLowerCase()
    const current = contacts.get(key)
    contacts.set(key, current ? mergeContact(current, valid) : valid)
  }
  const result = [...contacts.values()]
    .sort(compareContacts)
    .slice(0, MAX_CONTACTS)
  const storage = safeStorage()
  if (storage) {
    try {
      storage.setItem(contactKey(inboxId), JSON.stringify(result))
    } catch {
      // Keep the in-memory result useful when storage is full or unavailable.
    }
  }
  return result
}

export function clearContacts(inboxId: string): void {
  try {
    safeStorage()?.removeItem(contactKey(inboxId))
  } catch {
    // Clearing site data remains the recovery path when storage is unavailable.
  }
}

function mergeContact(current: Contact, addition: Contact): Contact {
  const profileWins = sourceRank(addition.source) >= sourceRank(current.source)
  return {
    address: addition.address ?? current.address,
    avatarUrl: profileWins
      ? addition.avatarUrl ?? current.avatarUrl
      : current.avatarUrl ?? addition.avatarUrl,
    conversationId: addition.conversationId ?? current.conversationId,
    displayName: profileWins
      ? addition.displayName ?? current.displayName
      : current.displayName ?? addition.displayName,
    fid: addition.fid ?? current.fid,
    inboxId: current.inboxId,
    source: profileWins ? addition.source : current.source,
    updatedAt: Math.max(current.updatedAt, addition.updatedAt),
    username: profileWins
      ? addition.username ?? current.username
      : current.username ?? addition.username,
  }
}

function sourceRank(source: Contact['source']): number {
  if (source === 'convos-profile') return 3
  if (source === 'farcaster') return 2
  return 1
}

function parseContact(value: unknown): Contact | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<Contact>
  if (
    typeof candidate.inboxId !== 'string' ||
    candidate.inboxId.length < 8 ||
    candidate.inboxId.length > 256 ||
    !isAddress(candidate.address ?? '') ||
    !Number.isSafeInteger(candidate.updatedAt) ||
    (candidate.updatedAt ?? 0) <= 0 ||
    !['conversation', 'convos-profile', 'farcaster'].includes(candidate.source ?? '')
  ) return null
  const fid = candidate.fid === null ||
    (Number.isSafeInteger(candidate.fid) && (candidate.fid ?? 0) > 0)
    ? candidate.fid ?? null
    : null
  return {
    address: getAddress(candidate.address as string),
    avatarUrl: boundedString(candidate.avatarUrl, MAX_AVATAR_URL_LENGTH),
    conversationId: boundedString(candidate.conversationId, 256),
    displayName: boundedString(candidate.displayName, MAX_NAME_LENGTH),
    fid,
    inboxId: candidate.inboxId,
    source: candidate.source as Contact['source'],
    updatedAt: candidate.updatedAt as number,
    username: boundedString(candidate.username, MAX_USERNAME_LENGTH),
  }
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function compareContacts(left: Contact, right: Contact): number {
  const leftName = left.displayName ?? left.username ?? left.address
  const rightName = right.displayName ?? right.username ?? right.address
  return leftName.localeCompare(rightName, undefined, { sensitivity: 'base' })
}

function contactKey(inboxId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(inboxId.toLowerCase())}`
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
