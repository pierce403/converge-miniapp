import { describe, expect, it } from 'vitest'
import {
  CONVOS_JOIN_REQUEST_CONTENT_TYPE,
  convosJoinRequestCodec,
} from './joinRequestCodec'

const canonicalSlug = 'YWJj'

describe('convosJoinRequestCodec', () => {
  it('uses the current Convos content type and encodes only the invite slug', () => {
    const encoded = convosJoinRequestCodec.encode({ inviteSlug: canonicalSlug })

    expect(encoded.type).toEqual(CONVOS_JOIN_REQUEST_CONTENT_TYPE)
    expect(encoded.parameters).toEqual({})
    expect(encoded.fallback).toBe(canonicalSlug)
    expect(JSON.parse(new TextDecoder().decode(encoded.content))).toEqual({
      inviteSlug: canonicalSlug,
    })
  })

  it('round trips a request, ignores future JSON keys, and canonicalizes separators', () => {
    const content = new TextEncoder().encode(
      JSON.stringify({ inviteSlug: canonicalSlug, futureField: true }),
    )
    expect(
      convosJoinRequestCodec.decode({ parameters: {}, content }),
    ).toEqual({ inviteSlug: canonicalSlug })

    const longSlug = 'A'.repeat(300) + '*' + 'AAA'
    expect(convosJoinRequestCodec.fallback({ inviteSlug: longSlug })).toBe('A'.repeat(303))
  })

  it('retains the raw slug fallback and requests push handling', () => {
    expect(convosJoinRequestCodec.fallback({ inviteSlug: canonicalSlug })).toBe(canonicalSlug)
    expect(convosJoinRequestCodec.shouldPush({ inviteSlug: canonicalSlug })).toBe(true)
  })

  it.each([
    new Uint8Array(),
    new TextEncoder().encode('not-json'),
    new TextEncoder().encode('{}'),
    new TextEncoder().encode('{"inviteSlug":"private-canary!"}'),
  ])('rejects malformed content without reflecting it', (content) => {
    expect(() => convosJoinRequestCodec.decode({ parameters: {}, content })).toThrow(
      'Invalid Convos join request.',
    )
  })
})
