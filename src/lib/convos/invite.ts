import { secp256k1 } from '@noble/curves/secp256k1.js'
import { Inflate } from 'fflate'
import { sha256 } from 'viem'
import { ConvosInviteError } from './error'
import {
  decodeConvosInviteSlug,
  normalizeConvosInviteSlug,
} from './slug'

export { ConvosInviteError } from './error'

const COMPRESSION_MARKER = 0x1f
const MAX_DECOMPRESSED_BYTES = 1024 * 1024
const MAX_COMPRESSION_RATIO = 100
const INFLATE_INPUT_CHUNK_BYTES = 256
const MIN_TOKEN_BYTES = 32
const MAX_TOKEN_BYTES = 65_568
const MIN_CREATOR_INBOX_BYTES = 20
const MAX_CREATOR_INBOX_BYTES = 64
const MAX_TAG_BYTES = 4096
const MAX_NAME_BYTES = 512
const MAX_DESCRIPTION_BYTES = 4096
const MAX_IMAGE_URL_BYTES = 2048
const MAX_EMOJI_BYTES = 64
const MAX_DATE_UNIX_SECONDS = 8_640_000_000_000

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export type ParsedConvosInvite = {
  slug: string
  creatorInboxId: string
  tag: string
  name?: string
  emoji?: string
  expiresAtUnix?: number
  conversationExpiresAtUnix?: number
  expiresAfterUse: boolean
  reusable: boolean
}

export type ParseConvosInviteOptions = {
  nowSeconds?: number
}

type WireType = 0 | 1 | 2 | 5

class ProtobufReader {
  readonly bytes: Uint8Array
  offset = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  get done() {
    return this.offset === this.bytes.length
  }

  readKey() {
    const key = this.readVarint()
    const field = key >> 3n
    const wire = Number(key & 7n)

    if (field <= 0n || field > 0x1fffffffn || ![0, 1, 2, 5].includes(wire)) {
      throw new ConvosInviteError('invalid_payload')
    }

    return { field: Number(field), wire: wire as WireType }
  }

  readVarint() {
    let value = 0n

    for (let index = 0; index < 10; index += 1) {
      const byte = this.readByte()
      if (index === 9 && byte > 1) {
        throw new ConvosInviteError('invalid_payload')
      }

      value |= BigInt(byte & 0x7f) << BigInt(index * 7)
      if ((byte & 0x80) === 0) {
        if (index > 0 && byte === 0) {
          throw new ConvosInviteError('invalid_payload')
        }
        return value
      }
    }

    throw new ConvosInviteError('invalid_payload')
  }

  readBytes(maxLength = MAX_DECOMPRESSED_BYTES) {
    const length = this.readVarint()
    if (length > BigInt(maxLength) || length > BigInt(this.bytes.length - this.offset)) {
      throw new ConvosInviteError('invalid_payload')
    }

    const end = this.offset + Number(length)
    const value = this.bytes.slice(this.offset, end)
    this.offset = end
    return value
  }

  readFixed64() {
    this.requireRemaining(8)
    const view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      8,
    )
    const value = view.getBigInt64(0, true)
    this.offset += 8
    return value
  }

  skip(wire: WireType) {
    switch (wire) {
      case 0:
        this.readVarint()
        return
      case 1:
        this.skipBytes(8)
        return
      case 2:
        this.readBytes()
        return
      case 5:
        this.skipBytes(4)
        return
    }
  }

  private readByte() {
    this.requireRemaining(1)
    const value = this.bytes[this.offset]!
    this.offset += 1
    return value
  }

  private skipBytes(length: number) {
    this.requireRemaining(length)
    this.offset += length
  }

  private requireRemaining(length: number) {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new ConvosInviteError('invalid_payload')
    }
  }
}

function requireWire(actual: WireType, expected: WireType) {
  if (actual !== expected) {
    throw new ConvosInviteError('invalid_payload')
  }
}

function markKnownField(seen: Set<number>, field: number) {
  if (seen.has(field)) {
    throw new ConvosInviteError('invalid_payload')
  }
  seen.add(field)
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    return utf8Decoder.decode(bytes)
  } catch {
    throw new ConvosInviteError('invalid_payload')
  }
}

function isUnsafeFormatCharacter(codePoint: number, preserveEmojiJoiner: boolean) {
  if (preserveEmojiJoiner && codePoint === 0x200d) return false
  return (
    codePoint === 0x061c ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  )
}

function sanitizePreviewText(
  value: string,
  maximumCharacters: number,
  preserveEmojiJoiner = false,
) {
  const cleaned = Array.from(value, (character) =>
    isControlCharacter(character.codePointAt(0)!) ||
    isUnsafeFormatCharacter(character.codePointAt(0)!, preserveEmojiJoiner)
      ? ' '
      : character,
  )
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!cleaned) return undefined
  return Array.from(cleaned).slice(0, maximumCharacters).join('')
}

function isControlCharacter(codePoint: number) {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) =>
    isControlCharacter(character.codePointAt(0)!),
  )
}

function unixSeconds(value: bigint) {
  if (
    value < BigInt(-MAX_DATE_UNIX_SECONDS) ||
    value > BigInt(MAX_DATE_UNIX_SECONDS)
  ) {
    throw new ConvosInviteError('invalid_payload')
  }
  return Number(value)
}

function bytesToLowercaseHex(bytes: Uint8Array) {
  let result = ''
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0')
  return result
}

function parseOuterInvite(bytes: Uint8Array) {
  const reader = new ProtobufReader(bytes)
  const seen = new Set<number>()
  let payload: Uint8Array | undefined
  let signature: Uint8Array | undefined

  while (!reader.done) {
    const { field, wire } = reader.readKey()
    if (field === 1 || field === 2) markKnownField(seen, field)

    if (field === 1) {
      requireWire(wire, 2)
      payload = reader.readBytes(MAX_DECOMPRESSED_BYTES)
    } else if (field === 2) {
      requireWire(wire, 2)
      signature = reader.readBytes(65)
    } else {
      reader.skip(wire)
    }
  }

  if (!payload?.length || signature?.length !== 65) {
    throw new ConvosInviteError('invalid_payload')
  }

  return { payload, signature }
}

function parseInvitePayload(payload: Uint8Array) {
  const reader = new ProtobufReader(payload)
  const seen = new Set<number>()
  let token: Uint8Array | undefined
  let creatorInbox: Uint8Array | undefined
  let tag: string | undefined
  let name: string | undefined
  let emoji: string | undefined
  let expiresAtUnix: number | undefined
  let conversationExpiresAtUnix: number | undefined
  let expiresAfterUse = false

  while (!reader.done) {
    const { field, wire } = reader.readKey()
    if (field >= 1 && field <= 10) markKnownField(seen, field)

    switch (field) {
      case 1:
        requireWire(wire, 2)
        token = reader.readBytes(MAX_TOKEN_BYTES)
        break
      case 2:
        requireWire(wire, 2)
        creatorInbox = reader.readBytes(MAX_CREATOR_INBOX_BYTES)
        break
      case 3:
        requireWire(wire, 2)
        tag = decodeUtf8(reader.readBytes(MAX_TAG_BYTES))
        break
      case 4:
        requireWire(wire, 2)
        name = sanitizePreviewText(
          decodeUtf8(reader.readBytes(MAX_NAME_BYTES)),
          80,
        )
        break
      case 5:
        requireWire(wire, 2)
        decodeUtf8(reader.readBytes(MAX_DESCRIPTION_BYTES))
        break
      case 6:
        requireWire(wire, 2)
        decodeUtf8(reader.readBytes(MAX_IMAGE_URL_BYTES))
        break
      case 7:
        requireWire(wire, 1)
        conversationExpiresAtUnix = unixSeconds(reader.readFixed64())
        break
      case 8:
        requireWire(wire, 1)
        expiresAtUnix = unixSeconds(reader.readFixed64())
        break
      case 9: {
        requireWire(wire, 0)
        const value = reader.readVarint()
        if (value !== 0n && value !== 1n) {
          throw new ConvosInviteError('invalid_payload')
        }
        expiresAfterUse = value === 1n
        break
      }
      case 10:
        requireWire(wire, 2)
        emoji = sanitizePreviewText(
          decodeUtf8(reader.readBytes(MAX_EMOJI_BYTES)),
          8,
          true,
        )
        break
      default:
        reader.skip(wire)
    }
  }

  if (
    !token ||
    token.length < MIN_TOKEN_BYTES ||
    token[0] !== 1 ||
    !creatorInbox ||
    creatorInbox.length < MIN_CREATOR_INBOX_BYTES ||
    !tag ||
    !tag.trim() ||
    hasControlCharacters(tag)
  ) {
    throw new ConvosInviteError('invalid_payload')
  }

  return {
    creatorInboxId: bytesToLowercaseHex(creatorInbox),
    tag,
    expiresAfterUse,
    ...(name === undefined ? {} : { name }),
    ...(emoji === undefined ? {} : { emoji }),
    ...(expiresAtUnix === undefined ? {} : { expiresAtUnix }),
    ...(conversationExpiresAtUnix === undefined
      ? {}
      : { conversationExpiresAtUnix }),
  }
}

function validateRecoverableSignature(payload: Uint8Array, signature: Uint8Array) {
  const recoveryId = signature[64]!
  if (recoveryId > 3) {
    throw new ConvosInviteError('invalid_signature')
  }

  try {
    secp256k1.Signature.fromCompact(signature.subarray(0, 64))
      .addRecoveryBit(recoveryId)
      .recoverPublicKey(sha256(payload, 'bytes'))
  } catch {
    throw new ConvosInviteError('invalid_signature')
  }
}

function boundedInflate(bytes: Uint8Array, expectedLength: number) {
  const chunks: Uint8Array[] = []
  let outputLength = 0
  let reachedEnd = false

  try {
    const inflater = new Inflate((chunk, final) => {
      outputLength += chunk.length
      if (outputLength > expectedLength) {
        throw new ConvosInviteError('invalid_compression')
      }
      if (chunk.length) chunks.push(chunk.slice())
      if (final) reachedEnd = true
    })

    for (let offset = 0; offset < bytes.length; offset += INFLATE_INPUT_CHUNK_BYTES) {
      const end = Math.min(offset + INFLATE_INPUT_CHUNK_BYTES, bytes.length)
      inflater.push(bytes.subarray(offset, end), end === bytes.length)
    }
  } catch (error) {
    if (error instanceof ConvosInviteError) throw error
    throw new ConvosInviteError('invalid_compression')
  }

  if (!reachedEnd || outputLength !== expectedLength) {
    throw new ConvosInviteError('invalid_compression')
  }

  const output = new Uint8Array(outputLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function decodeInviteBytes(slug: string) {
  const encoded = decodeConvosInviteSlug(slug)
  if (!encoded.length) throw new ConvosInviteError('invalid_encoding')

  if (encoded[0] !== COMPRESSION_MARKER) {
    if (encoded.length > MAX_DECOMPRESSED_BYTES) {
      throw new ConvosInviteError('invalid_payload')
    }
    return encoded
  }

  if (encoded.length < 6) {
    throw new ConvosInviteError('invalid_compression')
  }

  const expectedLength = new DataView(
    encoded.buffer,
    encoded.byteOffset + 1,
    4,
  ).getUint32(0, false)
  const compressed = encoded.subarray(5)

  if (
    expectedLength === 0 ||
    expectedLength > MAX_DECOMPRESSED_BYTES ||
    compressed.length === 0 ||
    expectedLength > compressed.length * MAX_COMPRESSION_RATIO
  ) {
    throw new ConvosInviteError('invalid_compression')
  }

  return boundedInflate(compressed, expectedLength)
}

function exactQuery(
  url: URL,
  allowedKeys: ReadonlySet<string>,
  requiredKey: string,
) {
  const entries = [...url.searchParams.entries()]
  if (entries.some(([key]) => !allowedKeys.has(key))) {
    throw new ConvosInviteError('unsupported_link')
  }

  const required = entries.filter(([key]) => key === requiredKey)
  if (required.length !== 1 || !required[0]![1]) {
    throw new ConvosInviteError('unsupported_link')
  }

  for (const key of allowedKeys) {
    if (entries.filter(([entryKey]) => entryKey === key).length > 1) {
      throw new ConvosInviteError('unsupported_link')
    }
  }
  return required[0]![1]
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ConvosInviteError('unsupported_link')
  }
}

function extractSlugFromUrl(input: string) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new ConvosInviteError('unsupported_link')
  }

  if (url.hash || url.username || url.password || url.port) {
    throw new ConvosInviteError('unsupported_link')
  }

  if (url.protocol === 'convos:') {
    if (url.hostname !== 'join' && url.hostname !== 'invite') {
      throw new ConvosInviteError('unsupported_link')
    }
    if (url.search || !/^\/[^/]+$/u.test(url.pathname)) {
      throw new ConvosInviteError('unsupported_link')
    }
    return decodePathSegment(url.pathname.slice(1))
  }

  if (url.protocol !== 'https:') {
    throw new ConvosInviteError('unsupported_link')
  }

  if (url.hostname === 'popup.convos.org' || url.hostname === 'app.convos.org') {
    if (url.pathname !== '/v2') {
      throw new ConvosInviteError('unsupported_link')
    }
    const allowed =
      url.hostname === 'app.convos.org'
        ? new Set(['i', 'open'])
        : new Set(['i'])
    const slug = exactQuery(url, allowed, 'i')
    if (
      url.hostname === 'app.convos.org' &&
      url.searchParams.has('open') &&
      url.searchParams.get('open') !== '1'
    ) {
      throw new ConvosInviteError('unsupported_link')
    }
    return slug
  }

  if (url.hostname !== 'convos.org') {
    throw new ConvosInviteError('unsupported_link')
  }

  const pathMatch = /^\/i\/([^/]+)$/u.exec(url.pathname)
  if (pathMatch && !url.search) {
    return decodePathSegment(pathMatch[1]!)
  }

  if (url.pathname === '/invite') {
    return exactQuery(url, new Set(['code']), 'code')
  }

  throw new ConvosInviteError('unsupported_link')
}

function extractSlug(input: string) {
  const trimmed = input.trim()
  if (!trimmed) throw new ConvosInviteError('invalid_input')

  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) {
    return extractSlugFromUrl(trimmed)
  }
  return trimmed
}

export function parseConvosInvite(
  input: string,
  options: ParseConvosInviteOptions = {},
): ParsedConvosInvite {
  const slug = normalizeConvosInviteSlug(extractSlug(input))
  const { payload, signature } = parseOuterInvite(decodeInviteBytes(slug))
  validateRecoverableSignature(payload, signature)
  const parsed = parseInvitePayload(payload)
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)

  if (!Number.isSafeInteger(nowSeconds)) {
    throw new ConvosInviteError('invalid_input')
  }
  if (parsed.expiresAtUnix !== undefined && parsed.expiresAtUnix <= nowSeconds) {
    throw new ConvosInviteError('invite_expired')
  }
  if (
    parsed.conversationExpiresAtUnix !== undefined &&
    parsed.conversationExpiresAtUnix <= nowSeconds
  ) {
    throw new ConvosInviteError('conversation_expired')
  }

  return {
    slug,
    ...parsed,
    reusable: !parsed.expiresAfterUse,
  }
}

export function buildConvosShareUrl(invite: Pick<ParsedConvosInvite, 'slug'>) {
  return `https://popup.convos.org/v2?i=${encodeURIComponent(invite.slug)}`
}

export function buildConvosAppUrl(invite: Pick<ParsedConvosInvite, 'slug'>) {
  return `https://app.convos.org/v2?i=${encodeURIComponent(invite.slug)}&open=1`
}

export function buildConvergeInviteUrl(invite: Pick<ParsedConvosInvite, 'slug'>) {
  return `https://converge.cv/invite?i=${encodeURIComponent(invite.slug)}&auto=1`
}
