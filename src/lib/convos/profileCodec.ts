import type {
  ContentCodec,
} from '@xmtp/content-type-primitives'

export const CONVOS_PROFILE_UPDATE_CONTENT_TYPE = {
  authorityId: 'convos.org',
  typeId: 'profile_update',
  versionMajor: 1,
  versionMinor: 0,
} as const

export const CONVOS_PROFILE_SNAPSHOT_CONTENT_TYPE = {
  authorityId: 'convos.org',
  typeId: 'profile_snapshot',
  versionMajor: 1,
  versionMinor: 0,
} as const

export type ConvosProfileUpdate = {
  name?: string
}

export type ConvosProfileSnapshot = {
  profiles: Array<{
    inboxId: string
    name?: string
  }>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const MAX_DISPLAY_NAME_CHARS = 50

export function sanitizeConvosDisplayName(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return undefined
  return trimmed.slice(0, MAX_DISPLAY_NAME_CHARS)
}

export const convosProfileUpdateCodec: ContentCodec<ConvosProfileUpdate> = {
  contentType: CONVOS_PROFILE_UPDATE_CONTENT_TYPE,

  encode(content) {
    const name = sanitizeConvosDisplayName(content.name)
    return {
      type: CONVOS_PROFILE_UPDATE_CONTENT_TYPE,
      parameters: {},
      content: name
        ? encodeLengthDelimited(1, encoder.encode(name))
        : new Uint8Array(),
    }
  },

  decode(encoded) {
    try {
      const fields = parseFields(encoded.content)
      const name = fields.find((field) =>
        field.number === 1 && field.value instanceof Uint8Array)
      const value = name?.value instanceof Uint8Array
        ? sanitizeConvosDisplayName(decoder.decode(name.value))
        : undefined
      return value ? { name: value } : {}
    } catch {
      return {}
    }
  },

  fallback() {
    return undefined
  },

  shouldPush() {
    return false
  },
}

export const convosProfileSnapshotCodec: ContentCodec<ConvosProfileSnapshot> = {
  contentType: CONVOS_PROFILE_SNAPSHOT_CONTENT_TYPE,

  encode(content) {
    const profiles = content.profiles.flatMap((profile) => {
      const inboxId = profile.inboxId.trim().replace(/^0x/iu, '').toLowerCase()
      if (!/^[0-9a-f]+$/u.test(inboxId) || inboxId.length % 2 !== 0) return []
      const member = [encodeLengthDelimited(1, hexToBytes(inboxId))]
      const name = sanitizeConvosDisplayName(profile.name)
      if (name) member.push(encodeLengthDelimited(2, encoder.encode(name)))
      return [encodeLengthDelimited(1, concatenate(member))]
    })
    return {
      type: CONVOS_PROFILE_SNAPSHOT_CONTENT_TYPE,
      parameters: {},
      content: concatenate(profiles),
    }
  },

  decode(encoded) {
    try {
      const profiles = parseFields(encoded.content)
        .filter((field) => field.number === 1 && field.value instanceof Uint8Array)
        .flatMap((field) => {
          if (!(field.value instanceof Uint8Array)) return []
          try {
            const member = parseFields(field.value)
            const inbox = member.find((candidate) =>
              candidate.number === 1 && candidate.value instanceof Uint8Array)
            if (!(inbox?.value instanceof Uint8Array) || inbox.value.length === 0) {
              return []
            }
            const name = member.find((candidate) =>
              candidate.number === 2 && candidate.value instanceof Uint8Array)
            const displayName = name?.value instanceof Uint8Array
              ? sanitizeConvosDisplayName(decoder.decode(name.value))
              : undefined
            return [{
              inboxId: bytesToHex(inbox.value),
              ...(displayName ? { name: displayName } : {}),
            }]
          } catch {
            return []
          }
        })
      return { profiles }
    } catch {
      return { profiles: [] }
    }
  },

  fallback() {
    return undefined
  },

  shouldPush() {
    return false
  },
}

type Field = {
  number: number
  value: number | Uint8Array
}

function parseFields(bytes: Uint8Array): Field[] {
  const fields: Field[] = []
  let offset = 0
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset)
    offset = key.offset
    const number = key.value >> 3
    const wireType = key.value & 7
    if (number <= 0) throw new Error('Invalid protobuf field.')
    if (wireType === 0) {
      const value = readVarint(bytes, offset)
      fields.push({ number, value: value.value })
      offset = value.offset
      continue
    }
    if (wireType === 2) {
      const length = readVarint(bytes, offset)
      const end = length.offset + length.value
      if (end > bytes.length) throw new Error('Invalid protobuf length.')
      fields.push({ number, value: bytes.slice(length.offset, end) })
      offset = end
      continue
    }
    if (wireType === 1) {
      offset += 8
    } else if (wireType === 5) {
      offset += 4
    } else {
      throw new Error('Unsupported protobuf wire type.')
    }
    if (offset > bytes.length) throw new Error('Invalid protobuf field.')
  }
  return fields
}

function readVarint(bytes: Uint8Array, start: number) {
  let value = 0
  let shift = 0
  let offset = start
  while (offset < bytes.length && shift <= 49) {
    const byte = bytes[offset++]
    if (byte === undefined) break
    value += (byte & 0x7f) * (2 ** shift)
    if ((byte & 0x80) === 0) return { offset, value }
    shift += 7
  }
  throw new Error('Invalid protobuf varint.')
}

function encodeVarint(input: number): Uint8Array {
  let value = BigInt(input)
  const bytes: number[] = []
  while (value >= 0x80n) {
    bytes.push(Number((value & 0x7fn) | 0x80n))
    value >>= 7n
  }
  bytes.push(Number(value))
  return Uint8Array.from(bytes)
}

function encodeLengthDelimited(number: number, value: Uint8Array): Uint8Array {
  return concatenate([
    encodeVarint((number << 3) | 2),
    encodeVarint(value.length),
    value,
  ])
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  )
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  }
  return bytes
}

function bytesToHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
