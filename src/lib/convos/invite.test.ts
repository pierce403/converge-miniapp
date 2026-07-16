import { secp256k1 } from '@noble/curves/secp256k1.js'
import { deflateSync, zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { sha256 } from 'viem'
import {
  buildConvergeInviteUrl,
  buildConvosAppUrl,
  buildConvosShareUrl,
  ConvosInviteError,
  parseConvosInvite,
  type ParsedConvosInvite,
} from './invite'

const privateKey = new Uint8Array(32).fill(0x42)
const defaultNow = 2_000_000_000

function concat(...values: Uint8Array<ArrayBufferLike>[]) {
  const result = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0))
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.length
  }
  return result
}

function varint(value: bigint | number) {
  let remaining = BigInt(value)
  const bytes: number[] = []
  do {
    let byte = Number(remaining & 0x7fn)
    remaining >>= 7n
    if (remaining) byte |= 0x80
    bytes.push(byte)
  } while (remaining)
  return new Uint8Array(bytes)
}

function bytesField(field: number, value: Uint8Array) {
  return concat(varint((field << 3) | 2), varint(value.length), value)
}

function stringField(field: number, value: string) {
  return bytesField(field, new TextEncoder().encode(value))
}

function fixed64Field(field: number, value: bigint | number) {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true)
  return concat(varint((field << 3) | 1), bytes)
}

function boolField(field: number, value: boolean) {
  return concat(varint(field << 3), varint(value ? 1 : 0))
}

type PayloadOptions = {
  token?: Uint8Array
  creatorInbox?: Uint8Array
  tag?: string
  name?: string
  description?: string
  imageUrl?: string
  emoji?: string
  expiresAtUnix?: number
  conversationExpiresAtUnix?: number
  expiresAfterUse?: boolean
  extraFields?: Uint8Array<ArrayBufferLike>[]
}

function makePayload(options: PayloadOptions = {}) {
  const token = options.token ?? concat(new Uint8Array([1]), new Uint8Array(31).fill(7))
  const creatorInbox = options.creatorInbox ?? new Uint8Array(32).fill(0xab)
  const fields: Uint8Array<ArrayBufferLike>[] = [
    bytesField(1, token),
    bytesField(2, creatorInbox),
    stringField(3, options.tag ?? 'convos-test-tag'),
  ]
  if (options.name !== undefined) fields.push(stringField(4, options.name))
  if (options.description !== undefined) fields.push(stringField(5, options.description))
  if (options.imageUrl !== undefined) fields.push(stringField(6, options.imageUrl))
  if (options.conversationExpiresAtUnix !== undefined) {
    fields.push(fixed64Field(7, options.conversationExpiresAtUnix))
  }
  if (options.expiresAtUnix !== undefined) {
    fields.push(fixed64Field(8, options.expiresAtUnix))
  }
  if (options.expiresAfterUse !== undefined) {
    fields.push(boolField(9, options.expiresAfterUse))
  }
  if (options.emoji !== undefined) fields.push(stringField(10, options.emoji))
  fields.push(...(options.extraFields ?? []))
  return concat(...fields)
}

function signPayload(payload: Uint8Array<ArrayBufferLike>) {
  const signature = secp256k1.sign(sha256(payload, 'bytes'), privateKey, {
    prehash: false,
  })
  return concat(signature.toBytes('compact'), new Uint8Array([signature.recovery]))
}

function makeOuter(
  payload: Uint8Array<ArrayBufferLike>,
  signature: Uint8Array<ArrayBufferLike> = signPayload(payload),
  extra?: Uint8Array<ArrayBufferLike>,
) {
  return concat(
    bytesField(1, payload),
    bytesField(2, signature),
    extra ?? new Uint8Array(),
  )
}

function base64Url(bytes: Uint8Array<ArrayBufferLike>) {
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

function decodeBase64Url(value: string) {
  const standard = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4)
  const decoded = atob(padded)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function withSeparators(slug: string) {
  return slug.match(/.{1,300}/gu)?.join('*') ?? slug
}

function makeSlug(options: PayloadOptions = {}) {
  return base64Url(makeOuter(makePayload(options)))
}

function compressedSlug(outer: Uint8Array, zlibWrapped = false) {
  const compressed = zlibWrapped ? zlibSync(outer) : deflateSync(outer)
  const frame = new Uint8Array(5 + compressed.length)
  frame[0] = 0x1f
  new DataView(frame.buffer).setUint32(1, outer.length, false)
  frame.set(compressed, 5)
  return base64Url(frame)
}

function expectInviteError(action: () => unknown, code?: string) {
  try {
    action()
    throw new Error('Expected a Convos invite error.')
  } catch (error) {
    expect(error).toBeInstanceOf(ConvosInviteError)
    if (code) expect((error as ConvosInviteError).code).toBe(code)
    return error as ConvosInviteError
  }
}

describe('parseConvosInvite', () => {
  it('parses a creator-signed current-schema invite and clamps its public preview', () => {
    const slug = makeSlug({
      name: '  Camp\nchat  ',
      description: 'Public but intentionally not exposed',
      imageUrl: 'https://images.example/never-load-me.png',
      emoji: '  🏕️  ',
      expiresAtUnix: defaultNow + 60,
      conversationExpiresAtUnix: defaultNow + 120,
    })

    const invite = parseConvosInvite(slug, { nowSeconds: defaultNow })

    expect(invite).toEqual({
      slug,
      creatorInboxId: 'ab'.repeat(32),
      tag: 'convos-test-tag',
      name: 'Camp chat',
      emoji: '🏕️',
      expiresAtUnix: defaultNow + 60,
      conversationExpiresAtUnix: defaultNow + 120,
      expiresAfterUse: false,
      reusable: true,
    })
    expect(invite).not.toHaveProperty('imageUrl')
    expect(invite).not.toHaveProperty('description')
  })

  it('strips bidi and invisible format controls while preserving emoji joiners', () => {
    const invite = parseConvosInvite(
      makeSlug({
        name: 'safe\u202Etxt\u2066name\u200B',
        emoji: '👨‍👩‍👧‍👦',
      }),
      { nowSeconds: defaultNow },
    )

    expect(invite.name).toBe('safe txt name')
    expect(invite.emoji).toBe('👨‍👩‍👧‍👦')
  })

  it.each([
    (slug: string) => slug,
    (slug: string) => `https://popup.convos.org/v2?i=${slug}`,
    (slug: string) => `https://app.convos.org/v2?i=${slug}`,
    (slug: string) => `https://app.convos.org/v2?i=${slug}&open=1`,
    (slug: string) => `convos://join/${slug}`,
    (slug: string) => `convos://invite/${slug}`,
    (slug: string) => `https://convos.org/i/${slug}`,
    (slug: string) => `https://convos.org/invite?code=${slug}`,
  ])('accepts an exact production invite form', (wrap) => {
    const slug = makeSlug()
    expect(parseConvosInvite(`  ${wrap(slug)}  `, { nowSeconds: defaultNow }).slug).toBe(slug)
  })

  it.each([
    'http://popup.convos.org/v2?i=SLUG',
    'https://dev.convos.org/v2?i=SLUG',
    'https://popup.convos.org.evil.test/v2?i=SLUG',
    'https://evil.test/v2?i=SLUG',
    'https://convos.org.evil.test/i/SLUG',
    'https://convos.org:444/i/SLUG',
    'https://user@convos.org/i/SLUG',
    'https://convos.org/i/SLUG#fragment',
    'https://popup.convos.org/v2?i=SLUG&next=evil',
    'https://popup.convos.org/v2?i=SLUG&i=OTHER',
    'https://app.convos.org/v2?i=SLUG&open=0',
    'https://convos.org/i/SLUG/extra',
    'convos-dev://join/SLUG',
    'convos://other/SLUG',
  ])('rejects URL allowlist bypass %s', (input) => {
    expectInviteError(() => parseConvosInvite(input), 'unsupported_link')
  })

  it('accepts canonical 300-character separators and removes them before use', () => {
    const slug = makeSlug({ description: 'x'.repeat(1200) })
    expect(slug.length).toBeGreaterThan(600)
    const separated = withSeparators(slug)

    expect(parseConvosInvite(separated, { nowSeconds: defaultNow }).slug).toBe(slug)
    expectInviteError(
      () => parseConvosInvite(`${slug.slice(0, 299)}*${slug.slice(299)}`),
      'invalid_encoding',
    )
  })

  it('opens the current raw-DEFLATE compression frame and rejects zlib wrapping', () => {
    const outer = makeOuter(makePayload({ description: 'camp '.repeat(200) }))

    expect(parseConvosInvite(compressedSlug(outer), { nowSeconds: defaultNow }).tag).toBe(
      'convos-test-tag',
    )
    expectInviteError(
      () => parseConvosInvite(compressedSlug(outer, true), { nowSeconds: defaultNow }),
      'invalid_compression',
    )
  })

  it('rejects unsafe compression headers, ratios, lengths, and bodies', () => {
    const frame = (size: number, body: Uint8Array) => {
      const bytes = new Uint8Array(5 + body.length)
      bytes[0] = 0x1f
      new DataView(bytes.buffer).setUint32(1, size, false)
      bytes.set(body, 5)
      return base64Url(bytes)
    }

    expectInviteError(() => parseConvosInvite(frame(0, new Uint8Array([1]))), 'invalid_compression')
    expectInviteError(
      () => parseConvosInvite(frame(1024 * 1024 + 1, new Uint8Array([1]))),
      'invalid_compression',
    )
    expectInviteError(() => parseConvosInvite(frame(1001, new Uint8Array(10))), 'invalid_compression')
    expectInviteError(() => parseConvosInvite(frame(100, new Uint8Array())), 'invalid_compression')
    expectInviteError(() => parseConvosInvite(frame(100, new Uint8Array(10))), 'invalid_compression')

    const outer = makeOuter(makePayload())
    const wrongSize = compressedSlug(concat(outer, new Uint8Array([0])))
    const decoded = decodeBase64Url(wrongSize)
    new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength).setUint32(
      1,
      outer.length,
      false,
    )
    expectInviteError(() => parseConvosInvite(base64Url(decoded)), 'invalid_compression')
  })

  it('accepts a bounded unknown outer field at the exact 1 MiB output limit', () => {
    const base = makeOuter(makePayload())
    const target = 1024 * 1024
    let paddingLength = target - base.length - 4
    while (base.length + bytesField(15, new Uint8Array(paddingLength)).length !== target) {
      paddingLength +=
        base.length + bytesField(15, new Uint8Array(paddingLength)).length < target ? 1 : -1
    }

    const padding = new Uint8Array(paddingLength)
    let state = 0x12345678
    for (let index = 0; index < padding.length; index += 1) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      padding[index] = state & 0xff
    }
    const outer = concat(base, bytesField(15, padding))

    expect(parseConvosInvite(compressedSlug(outer), { nowSeconds: defaultNow }).tag).toBe(
      'convos-test-tag',
    )
  })

  it('accepts bounded 20-byte and 32-byte creator inbox fixtures', () => {
    expect(
      parseConvosInvite(makeSlug({ creatorInbox: new Uint8Array(20).fill(0xcd) }), {
        nowSeconds: defaultNow,
      }).creatorInboxId,
    ).toBe('cd'.repeat(20))
    expect(
      parseConvosInvite(makeSlug({ creatorInbox: new Uint8Array(32).fill(0xef) }), {
        nowSeconds: defaultNow,
      }).creatorInboxId,
    ).toBe('ef'.repeat(32))
  })

  it.each([
    { token: new Uint8Array(31).fill(1) },
    { token: concat(new Uint8Array([2]), new Uint8Array(31)) },
    { creatorInbox: new Uint8Array(19).fill(1) },
    { creatorInbox: new Uint8Array(65).fill(1) },
    { tag: '' },
    { tag: 'bad\u0000tag' },
  ] satisfies PayloadOptions[])('rejects invalid required payload fields %#', (options) => {
    expectInviteError(
      () => parseConvosInvite(makeSlug(options), { nowSeconds: defaultNow }),
      'invalid_payload',
    )
  })

  it('rejects duplicate known fields but safely skips a bounded future field', () => {
    const duplicateTag = concat(makePayload(), stringField(3, 'other-tag'))
    expectInviteError(
      () => parseConvosInvite(base64Url(makeOuter(duplicateTag)), { nowSeconds: defaultNow }),
      'invalid_payload',
    )

    const payload = concat(bytesField(25, new Uint8Array([9, 8, 7])), makePayload())
    expect(parseConvosInvite(base64Url(makeOuter(payload)), { nowSeconds: defaultNow }).tag).toBe(
      'convos-test-tag',
    )
  })

  it('rejects malformed, truncated, wrong-wire, and noncanonical protobuf values', () => {
    expectInviteError(() => parseConvosInvite(base64Url(new Uint8Array([0x0a, 0x80]))))

    const wrongWirePayload = concat(varint((1 << 3) | 5), new Uint8Array(4), makePayload())
    expectInviteError(
      () => parseConvosInvite(base64Url(makeOuter(wrongWirePayload)), { nowSeconds: defaultNow }),
      'invalid_payload',
    )

    const overlongTagLength = concat(
      bytesField(1, concat(new Uint8Array([1]), new Uint8Array(31))),
      bytesField(2, new Uint8Array(32)),
      new Uint8Array([0x1a, 0x81, 0x00, 0x61]),
    )
    expectInviteError(
      () => parseConvosInvite(base64Url(makeOuter(overlongTagLength)), { nowSeconds: defaultNow }),
      'invalid_payload',
    )
  })

  it('uses sfixed64 expiries and conservatively refuses single-use re-sharing', () => {
    const invite = parseConvosInvite(
      makeSlug({
        expiresAtUnix: defaultNow + 1,
        conversationExpiresAtUnix: defaultNow + 2,
        expiresAfterUse: true,
      }),
      { nowSeconds: defaultNow },
    )
    expect(invite.expiresAfterUse).toBe(true)
    expect(invite.reusable).toBe(false)

    expectInviteError(
      () => parseConvosInvite(makeSlug({ expiresAtUnix: defaultNow }), { nowSeconds: defaultNow }),
      'invite_expired',
    )
    expectInviteError(
      () =>
        parseConvosInvite(makeSlug({ conversationExpiresAtUnix: defaultNow - 1 }), {
          nowSeconds: defaultNow,
        }),
      'conversation_expired',
    )
  })

  it('rejects malformed signatures and recovery IDs outside 0 through 3', () => {
    const payload = makePayload()
    const zeroSignature = new Uint8Array(65)
    expectInviteError(
      () => parseConvosInvite(base64Url(makeOuter(payload, zeroSignature)), { nowSeconds: defaultNow }),
      'invalid_signature',
    )

    const invalidRecovery = signPayload(payload)
    invalidRecovery[64] = 4
    expectInviteError(
      () => parseConvosInvite(base64Url(makeOuter(payload, invalidRecovery)), { nowSeconds: defaultNow }),
      'invalid_signature',
    )
  })

  it.each([2, 3])('permits recovery ID %i when public-key recovery is structurally valid', (recoveryId) => {
    const payload = makePayload({ tag: `recovery-${recoveryId}` })
    const hash = sha256(payload, 'bytes')
    let signature: Uint8Array | undefined

    for (let r = 1; r < 10_000 && !signature; r += 1) {
      const compact = new Uint8Array(64)
      new DataView(compact.buffer).setUint32(28, r, false)
      compact[63] = 1
      try {
        secp256k1.Signature.fromCompact(compact)
          .addRecoveryBit(recoveryId)
          .recoverPublicKey(hash)
        signature = concat(compact, new Uint8Array([recoveryId]))
      } catch {
        // Continue until x = r + n maps to a curve point.
      }
    }

    if (!signature) throw new Error('Unable to create a structurally recoverable fixture.')
    expect(
      parseConvosInvite(base64Url(makeOuter(payload, signature)), { nowSeconds: defaultNow }).tag,
    ).toBe(`recovery-${recoveryId}`)
  })

  it('never repeats the bearer slug or decoded fields in an error', () => {
    const secret = 'private-bearer-canary-928451'
    const error = expectInviteError(() =>
      parseConvosInvite(makeSlug({ tag: `${secret}\u0000` }), { nowSeconds: defaultNow }),
    )
    expect(error.message).not.toContain(secret)
  })
})

describe('Convos invite handoff URLs', () => {
  it('builds the exact canonical share, app, and Converge handoffs', () => {
    const invite = { slug: 'signed_slug-123' } as ParsedConvosInvite
    expect(buildConvosShareUrl(invite)).toBe(
      'https://popup.convos.org/v2?i=signed_slug-123',
    )
    expect(buildConvosAppUrl(invite)).toBe(
      'https://app.convos.org/v2?i=signed_slug-123&open=1',
    )
    expect(buildConvergeInviteUrl(invite)).toBe(
      'https://converge.cv/invite?i=signed_slug-123&auto=1',
    )
  })

  it('escapes a slug instead of allowing query injection', () => {
    const invite = { slug: 'signed&open=0' } as ParsedConvosInvite
    expect(buildConvosAppUrl(invite)).toBe(
      'https://app.convos.org/v2?i=signed%26open%3D0&open=1',
    )
  })
})
