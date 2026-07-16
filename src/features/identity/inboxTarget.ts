import { getAddress, type Address } from 'viem'
import { normalize } from 'viem/ens'

const INBOX_TARGET_STORAGE_PREFIX = 'converge-miniapp:ens-inbox-target:'
const INBOX_TARGET_VERSION = 2
const ENS_NAME_LIMIT_BYTES = 255
const INBOX_ID_LIMIT_BYTES = 512

export type InboxTarget = {
  address: Address
  inboxId: string
  name: string
  sourceAddress: Address
}

export type InboxTargetState =
  | { status: 'none'; target: null }
  | { status: 'valid'; target: InboxTarget }
  | { status: 'invalid'; target: null }
  | { status: 'unavailable'; target: null }

type InboxTargetRecord = InboxTarget & {
  version: typeof INBOX_TARGET_VERSION
}

/**
 * Reads the public identity selected under a host-context FID hint. Corrupt,
 * obsolete, or unreadable state is distinct from absence so it can never
 * trigger a silent fallback; exact source and target signers remain authority.
 */
export function readInboxTarget(fid: number): InboxTargetState {
  const key = storageKey(fid)
  if (!key) return { status: 'invalid', target: null }

  let storage: Storage
  try {
    storage = window.localStorage
  } catch {
    return { status: 'unavailable', target: null }
  }

  let serialized: string | null
  try {
    serialized = storage.getItem(key)
  } catch {
    return { status: 'unavailable', target: null }
  }
  if (serialized === null) return { status: 'none', target: null }

  try {
    const record = parseRecord(JSON.parse(serialized))
    if (record) return { status: 'valid', target: withoutVersion(record) }
  } catch {
    // Invalid JSON is handled like any other corrupt local record.
  }

  // Preserve the evidence that a selector existed. Treating corruption like
  // absence could silently reopen the host-preferred inbox after the user had
  // explicitly left it. Recovery must be an explicit user action.
  return { status: 'invalid', target: null }
}

/**
 * Stores only public ENS/XMTP identifiers. Invalid input or unavailable local
 * storage leaves any previously validated target untouched.
 */
export function writeInboxTarget(fid: number, target: InboxTarget): boolean {
  const key = storageKey(fid)
  const record = createRecord(target)
  if (!key || !record) return false

  try {
    window.localStorage.setItem(key, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

export function clearInboxTarget(fid: number): boolean {
  const key = storageKey(fid)
  if (!key) return false

  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function storageKey(fid: number): string | null {
  return Number.isSafeInteger(fid) && fid > 0
    ? `${INBOX_TARGET_STORAGE_PREFIX}${fid}`
    : null
}

function createRecord(target: InboxTarget): InboxTargetRecord | null {
  const name = normalizeName(target.name)
  const inboxId = validInboxId(target.inboxId)
  if (!name || !inboxId) return null

  let address: Address
  let sourceAddress: Address
  try {
    address = getAddress(target.address)
    sourceAddress = getAddress(target.sourceAddress)
  } catch {
    return null
  }
  if (address.toLowerCase() === sourceAddress.toLowerCase()) return null

  return {
    address,
    inboxId,
    name,
    sourceAddress,
    version: INBOX_TARGET_VERSION,
  }
}

function parseRecord(value: unknown): InboxTargetRecord | null {
  if (!isPlainRecord(value)) return null
  if (!hasExactKeys(
    value,
    ['address', 'inboxId', 'name', 'sourceAddress', 'version'],
  )) return null
  if (value.version !== INBOX_TARGET_VERSION) return null
  if (
    typeof value.address !== 'string' ||
    typeof value.inboxId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.sourceAddress !== 'string'
  ) return null

  const record = createRecord({
    address: value.address as Address,
    inboxId: value.inboxId,
    name: value.name,
    sourceAddress: value.sourceAddress as Address,
  })
  if (!record) return null

  if (
    record.address !== value.address ||
    record.inboxId !== value.inboxId ||
    record.name !== value.name ||
    record.sourceAddress !== value.sourceAddress
  ) return null
  return record
}

function normalizeName(value: string): string | null {
  const trimmed = value.trim()
  if (
    !trimmed ||
    !trimmed.includes('.') ||
    trimmed.startsWith('.') ||
    trimmed.endsWith('.') ||
    utf8Length(trimmed) > ENS_NAME_LIMIT_BYTES
  ) return null

  try {
    const name = normalize(trimmed)
    if (
      !name.includes('.') ||
      name.startsWith('.') ||
      name.endsWith('.') ||
      utf8Length(name) > ENS_NAME_LIMIT_BYTES
    ) return null
    return name
  } catch {
    return null
  }
}

function validInboxId(value: string): string | null {
  if (
    value.length === 0 ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    utf8Length(value) > INBOX_ID_LIMIT_BYTES ||
    hasControlCharacters(value)
  ) return null
  return value
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
  })
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length &&
    expected.every((key, index) => keys[index] === key)
}

function withoutVersion(record: InboxTargetRecord): InboxTarget {
  return {
    address: record.address,
    inboxId: record.inboxId,
    name: record.name,
    sourceAddress: record.sourceAddress,
  }
}
