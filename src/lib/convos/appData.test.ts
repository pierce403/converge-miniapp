import { deflateSync, zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { parseConvosGroupAppData } from './appData'

const encoder = new TextEncoder()

describe('Convos group app data', () => {
  it('extracts the exact tag and bounded emoji from current protobuf metadata', () => {
    const encoded = base64Url(concat(
      bytesField(1, encoder.encode(' exact-tag ')),
      bytesField(6, encoder.encode('🌱')),
    ))

    expect(parseConvosGroupAppData(encoded)).toEqual({
      emoji: '🌱',
      tag: ' exact-tag ',
    })
  })

  it.each([
    ['raw DEFLATE', deflateSync],
    ['zlib-wrapped DEFLATE', zlibSync],
  ])('accepts bounded %s metadata frames', (_label, compress) => {
    const payload = concat(
      bytesField(1, encoder.encode('compressed-tag')),
      bytesField(2, new Uint8Array(180).fill(0x41)),
      bytesField(6, encoder.encode('🎭')),
    )
    const compressed = compress(payload)
    const framed = concat(
      new Uint8Array([0x1f]),
      uint32(payload.length),
      compressed,
    )

    expect(parseConvosGroupAppData(base64Url(framed))).toEqual({
      emoji: '🎭',
      tag: 'compressed-tag',
    })
  })

  it.each([
    ['invalid base64', 'not valid'],
    ['empty payload', ''],
    ['overlong input', 'A'.repeat(8193)],
    ['noncanonical trailing bits', 'AB'],
  ])('rejects %s', (_label, input) => {
    expect(parseConvosGroupAppData(input)).toBeNull()
  })

  it('rejects missing, duplicate, wrong-wire, and control-bearing tags', () => {
    const duplicate = concat(
      bytesField(1, encoder.encode('one')),
      bytesField(1, encoder.encode('two')),
    )
    const wrongWire = new Uint8Array([0x08, 0x01])
    const control = bytesField(1, encoder.encode('bad\u0000tag'))

    expect(parseConvosGroupAppData(base64Url(bytesField(6, encoder.encode('💬'))))).toBeNull()
    expect(parseConvosGroupAppData(base64Url(duplicate))).toBeNull()
    expect(parseConvosGroupAppData(base64Url(wrongWire))).toBeNull()
    expect(parseConvosGroupAppData(base64Url(control))).toBeNull()
  })

  it('rejects framed size mismatches and suspicious compression ratios', () => {
    const payload = bytesField(1, encoder.encode('tag'))
    const compressed = deflateSync(payload)
    const wrongSize = concat(
      new Uint8Array([0x1f]),
      uint32(payload.length + 1),
      compressed,
    )
    const suspicious = concat(
      new Uint8Array([0x1f]),
      uint32(1_000_000),
      new Uint8Array([0x01]),
    )

    expect(parseConvosGroupAppData(base64Url(wrongSize))).toBeNull()
    expect(parseConvosGroupAppData(base64Url(suspicious))).toBeNull()
  })

  it('removes spoofing controls while preserving an emoji joiner', () => {
    const encoded = base64Url(concat(
      bytesField(1, encoder.encode('exact-tag')),
      bytesField(6, encoder.encode('\u202e👩‍💻\u202c')),
    ))

    expect(parseConvosGroupAppData(encoded)).toEqual({
      emoji: '👩‍💻',
      tag: 'exact-tag',
    })
  })
})

function bytesField(field: number, bytes: Uint8Array) {
  return concat(
    new Uint8Array([(field << 3) | 2]),
    varint(bytes.length),
    bytes,
  )
}

function varint(value: number) {
  const bytes: number[] = []
  let remaining = value
  do {
    const next = remaining & 0x7f
    remaining >>>= 7
    bytes.push(remaining ? next | 0x80 : next)
  } while (remaining)
  return new Uint8Array(bytes)
}

function uint32(value: number) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function concat(...chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function base64Url(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let result = ''
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!
    const second = bytes[offset + 1]
    const third = bytes[offset + 2]
    result += alphabet[first >> 2]!
    result += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]!
    if (second !== undefined) {
      result += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]!
    }
    if (third !== undefined) result += alphabet[third & 63]!
  }
  return result
}
