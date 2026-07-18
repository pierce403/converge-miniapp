import { getAddress, type Address } from 'viem'
import { normalize } from 'viem/ens'

const INBOX_TARGET_STORAGE_PREFIX = 'converge-miniapp:ens-inbox-target:'
const INBOX_TARGET_VERSION = 4
const ENS_NAME_LIMIT_BYTES = 255
const INBOX_ID_LIMIT_BYTES = 512
const MAX_CHAIN_ID = (1n << 256n) - 1n

type InboxTargetBase = {
  address: Address
  inboxId: string
  name: string
  sourceAddress: Address
}

export type InboxTargetWalletKind = 'EOA' | 'SCW'

/**
 * A confirmed XMTP identity binding. `address` owns the ENS name/inbox while
 * `sourceAddress` is the Farcaster wallet that was reassigned into that inbox.
 * Future sessions always authenticate with the Farcaster wallet.
 */
export type InboxTarget = InboxTargetBase & {
  walletKind: InboxTargetWalletKind
  chainId: string
}

/** New writes must include the Farcaster signer metadata needed to restore it safely. */
export type PersistableInboxTarget = InboxTarget

export type InboxTargetState =
  | { status: 'none'; target: null }
  | { status: 'valid'; target: InboxTarget }
  | { status: 'invalid'; target: null }
  | { status: 'unavailable'; target: null }

type InboxTargetRecord = PersistableInboxTarget & {
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
    const target = parseRecord(JSON.parse(serialized))
    if (target) return { status: 'valid', target }
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
export function writeInboxTarget(
  fid: number,
  target: PersistableInboxTarget,
): boolean {
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

function createRecord(target: PersistableInboxTarget): InboxTargetRecord | null {
  const base = normalizeBase(target)
  const chainId = normalizeChainId(target.chainId)
  if (
    !base ||
    !isWalletKind(target.walletKind) ||
    !chainId
  ) return null

  return {
    ...base,
    walletKind: target.walletKind,
    chainId,
    version: INBOX_TARGET_VERSION,
  }
}

function normalizeBase(target: InboxTargetBase): InboxTargetBase | null {
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
  }
}

function parseRecord(value: unknown): InboxTarget | null {
  if (!isPlainRecord(value)) return null
  if (!hasExactKeys(
    value,
    [
      'address',
      'chainId',
      'inboxId',
      'name',
      'sourceAddress',
      'version',
      'walletKind',
    ],
  )) return null
  if (value.version !== INBOX_TARGET_VERSION) return null
  if (
    typeof value.address !== 'string' ||
    typeof value.inboxId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.sourceAddress !== 'string' ||
    typeof value.walletKind !== 'string' ||
    typeof value.chainId !== 'string'
  ) return null

  const record = createRecord({
    address: value.address as Address,
    inboxId: value.inboxId,
    name: value.name,
    sourceAddress: value.sourceAddress as Address,
    walletKind: value.walletKind as InboxTargetWalletKind,
    chainId: value.chainId,
  })
  if (!record) return null

  if (
    record.address !== value.address ||
    record.inboxId !== value.inboxId ||
    record.name !== value.name ||
    record.sourceAddress !== value.sourceAddress ||
    record.walletKind !== value.walletKind ||
    record.chainId !== value.chainId
  ) return null
  return withoutVersion(record)
}

function isWalletKind(value: unknown): value is InboxTargetWalletKind {
  return value === 'EOA' || value === 'SCW'
}

function normalizeChainId(value: string): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(trimmed)) return null

  try {
    const chainId = BigInt(trimmed)
    if (chainId <= 0n || chainId > MAX_CHAIN_ID) return null
    return chainId.toString(10)
  } catch {
    return null
  }
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
    chainId: record.chainId,
    inboxId: record.inboxId,
    name: record.name,
    sourceAddress: record.sourceAddress,
    walletKind: record.walletKind,
  }
}
