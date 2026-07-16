import { Inflate, Unzlib } from 'fflate'
import {
  hasConvosControlCharacters,
  sanitizeConvosPreviewText,
} from './presentation'

const COMPRESSION_MARKER = 0x1f
const MAX_APP_DATA_CHARACTERS = 8 * 1024
const MAX_DECOMPRESSED_BYTES = 1024 * 1024
const MAX_COMPRESSION_RATIO = 100
const INFLATE_INPUT_CHUNK_BYTES = 256
const MAX_TAG_BYTES = 4096
const MAX_EMOJI_BYTES = 64

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export type ConvosGroupAppData = {
  emoji: string | null
  tag: string
}

export function parseConvosGroupAppData(raw: string): ConvosGroupAppData | null {
  try {
    if (!raw || raw.length > MAX_APP_DATA_CHARACTERS) return null
    const encoded = decodeBase64Url(raw)
    if (!encoded.length) return null
    const payload = encoded[0] === COMPRESSION_MARKER
      ? decodeCompressed(encoded)
      : encoded
    if (payload.length > MAX_DECOMPRESSED_BYTES) return null
    return parseMetadata(payload)
  } catch {
    return null
  }
}

function decodeBase64Url(value: string) {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Invalid Convos app data.')
  }

  const output = new Uint8Array(Math.floor((value.length * 6) / 8))
  let accumulator = 0
  let availableBits = 0
  let outputOffset = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    let digit: number
    if (code >= 65 && code <= 90) digit = code - 65
    else if (code >= 97 && code <= 122) digit = code - 71
    else if (code >= 48 && code <= 57) digit = code + 4
    else if (code === 45) digit = 62
    else if (code === 95) digit = 63
    else throw new Error('Invalid Convos app data.')

    accumulator = (accumulator << 6) | digit
    availableBits += 6
    if (availableBits >= 8) {
      availableBits -= 8
      output[outputOffset] = (accumulator >> availableBits) & 0xff
      outputOffset += 1
      accumulator &= availableBits === 0 ? 0 : (1 << availableBits) - 1
    }
  }
  if (accumulator !== 0 || outputOffset !== output.length) {
    throw new Error('Invalid Convos app data.')
  }
  return output
}

function decodeCompressed(encoded: Uint8Array) {
  if (encoded.length < 6) throw new Error('Invalid Convos app data.')
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
  ) throw new Error('Invalid Convos app data.')

  for (const Inflater of [Inflate, Unzlib]) {
    try {
      return boundedInflate(Inflater, compressed, expectedLength)
    } catch {
      // Convos iOS writes raw DEFLATE while CLI clients have written zlib.
    }
  }
  throw new Error('Invalid Convos app data.')
}

type InflaterConstructor = new (
  callback: (chunk: Uint8Array, final: boolean) => void,
) => { push(chunk: Uint8Array, final?: boolean): void }

function boundedInflate(
  Inflater: InflaterConstructor,
  bytes: Uint8Array,
  expectedLength: number,
) {
  const chunks: Uint8Array[] = []
  let outputLength = 0
  let reachedEnd = false
  const inflater = new Inflater((chunk, final) => {
    outputLength += chunk.length
    if (outputLength > expectedLength) throw new Error('Invalid Convos app data.')
    if (chunk.length) chunks.push(chunk.slice())
    if (final) reachedEnd = true
  })
  for (let offset = 0; offset < bytes.length; offset += INFLATE_INPUT_CHUNK_BYTES) {
    const end = Math.min(offset + INFLATE_INPUT_CHUNK_BYTES, bytes.length)
    inflater.push(bytes.subarray(offset, end), end === bytes.length)
  }
  if (!reachedEnd || outputLength !== expectedLength) {
    throw new Error('Invalid Convos app data.')
  }

  const output = new Uint8Array(outputLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function parseMetadata(bytes: Uint8Array): ConvosGroupAppData | null {
  const reader = new ProtobufReader(bytes)
  let tag: string | null = null
  let emoji: string | null = null
  let seenTag = false
  let seenEmoji = false
  while (!reader.done) {
    const { field, wire } = reader.readKey()
    if (field === 1) {
      if (wire !== 2 || seenTag) return null
      seenTag = true
      tag = decodeBoundedText(reader.readBytes(MAX_TAG_BYTES), false)
    } else if (field === 6) {
      if (wire !== 2 || seenEmoji) return null
      seenEmoji = true
      emoji = sanitizeConvosPreviewText(
        decodeBoundedText(reader.readBytes(MAX_EMOJI_BYTES), true),
        8,
        true,
      ) ?? null
    } else {
      reader.skip(wire)
    }
  }
  if (!tag) return null
  return { emoji, tag }
}

function decodeBoundedText(bytes: Uint8Array, allowEmpty: boolean) {
  const decoded = utf8Decoder.decode(bytes)
  if ((!allowEmpty && !decoded) || hasConvosControlCharacters(decoded)) {
    throw new Error('Invalid Convos app data.')
  }
  return decoded
}

type WireType = 0 | 1 | 2 | 5

class ProtobufReader {
  private readonly bytes: Uint8Array
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
      throw new Error('Invalid Convos app data.')
    }
    return { field: Number(field), wire: wire as WireType }
  }

  readBytes(maxLength: number) {
    const length = this.readVarint()
    if (length > BigInt(maxLength) || length > BigInt(this.bytes.length - this.offset)) {
      throw new Error('Invalid Convos app data.')
    }
    const start = this.offset
    this.offset += Number(length)
    return this.bytes.subarray(start, this.offset)
  }

  readVarint() {
    let value = 0n
    for (let shift = 0n; shift <= 63n; shift += 7n) {
      if (this.offset >= this.bytes.length) throw new Error('Invalid Convos app data.')
      const byte = this.bytes[this.offset++]!
      value |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return value
    }
    throw new Error('Invalid Convos app data.')
  }

  skip(wire: WireType) {
    if (wire === 0) this.readVarint()
    else if (wire === 1) this.advance(8)
    else if (wire === 2) {
      const length = this.readVarint()
      if (length > BigInt(this.bytes.length - this.offset)) {
        throw new Error('Invalid Convos app data.')
      }
      this.advance(Number(length))
    } else if (wire === 5) this.advance(4)
  }

  private advance(length: number) {
    if (length > this.bytes.length - this.offset) {
      throw new Error('Invalid Convos app data.')
    }
    this.offset += length
  }
}
