import { describe, expect, it } from 'vitest'

import {
  convosInviteJoinErrorCodec,
  convosInviteJoinHandledCodec,
  convosJoinErrorMessage,
  type ConvosInviteJoinError,
} from './controlCodec'

describe('Convos invite status codecs', () => {
  it('round-trips creator handled bookkeeping without a visible fallback or push', () => {
    const content = {
      handledMessageId: 'request-1',
      inviteTag: 'exact-tag',
      timestamp: '2026-07-16T03:00:00Z',
    }
    const encoded = convosInviteJoinHandledCodec.encode(content)

    expect(convosInviteJoinHandledCodec.decode(encoded)).toEqual(content)
    expect(convosInviteJoinHandledCodec.fallback(content)).toBeUndefined()
    expect(convosInviteJoinHandledCodec.shouldPush(content)).toBe(false)
  })

  it.each([
    ['conversation_expired', 'This conversation is no longer available.'],
    ['conversation_not_found', 'This conversation is no longer available.'],
    ['consent_not_allowed', 'This conversation is no longer available.'],
    ['generic_failure', 'The inviter could not add this inbox. You can send a fresh request.'],
  ] as const)('maps %s to bounded copy without exposing reason', (errorType, message) => {
    const content: ConvosInviteJoinError = {
      errorType,
      inviteTag: 'exact-tag',
      reason: 'raw creator diagnostic with private internals',
      timestamp: '2026-07-16T03:00:00Z',
    }
    const decoded = convosInviteJoinErrorCodec.decode(
      convosInviteJoinErrorCodec.encode(content),
    )

    expect(decoded.reason).toBe(content.reason)
    expect(convosJoinErrorMessage(decoded)).toBe(message)
    expect(convosJoinErrorMessage(decoded)).not.toContain(content.reason)
  })

  it('rejects invalid tags, timestamps, error types, and oversized controls', () => {
    const base = {
      errorType: 'generic_failure',
      inviteTag: 'tag',
      timestamp: '2026-07-16T03:00:00Z',
    } as const

    expect(() => convosInviteJoinErrorCodec.encode({
      ...base,
      inviteTag: 'bad\u0000tag',
    })).toThrow('Invalid Convos invite control.')
    expect(() => convosInviteJoinErrorCodec.encode({
      ...base,
      timestamp: 'not-a-date',
    })).toThrow('Invalid Convos invite control.')
    expect(() => convosInviteJoinErrorCodec.decode({
      content: new TextEncoder().encode(JSON.stringify({ ...base, errorType: 'future' })),
      parameters: {},
      type: convosInviteJoinErrorCodec.contentType,
    })).toThrow('Invalid Convos invite control.')
    expect(() => convosInviteJoinHandledCodec.decode({
      content: new Uint8Array(4097),
      parameters: {},
      type: convosInviteJoinHandledCodec.contentType,
    })).toThrow('Invalid Convos invite control.')
  })
})
