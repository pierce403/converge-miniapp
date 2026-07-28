import { describe, expect, it } from 'vitest'

import {
  CONVOS_PROFILE_SNAPSHOT_CONTENT_TYPE,
  CONVOS_PROFILE_UPDATE_CONTENT_TYPE,
  convosProfileSnapshotCodec,
  convosProfileUpdateCodec,
} from './profileCodec'

describe('Convos profile codecs', () => {
  it('round-trips the Convos protobuf profile name without push', () => {
    const encoded = convosProfileUpdateCodec.encode({ name: '  Alice  ' })

    expect(encoded.type).toEqual(CONVOS_PROFILE_UPDATE_CONTENT_TYPE)
    expect(encoded.fallback).toBeUndefined()
    expect(convosProfileUpdateCodec.shouldPush({ name: 'Alice' })).toBe(false)
    expect(convosProfileUpdateCodec.decode(encoded)).toEqual({ name: 'Alice' })
  })

  it('uses the Convos 50-character display-name bound', () => {
    const encoded = convosProfileUpdateCodec.encode({ name: 'a'.repeat(80) })

    expect(convosProfileUpdateCodec.decode(encoded).name).toHaveLength(50)
  })

  it('round-trips names in a Convos member snapshot', () => {
    const inboxId = 'ab'.repeat(32)
    const encoded = convosProfileSnapshotCodec.encode({
      profiles: [{ inboxId, name: 'Bob' }],
    })

    expect(encoded.type).toEqual(CONVOS_PROFILE_SNAPSHOT_CONTENT_TYPE)
    expect(convosProfileSnapshotCodec.decode(encoded)).toEqual({
      profiles: [{ inboxId, name: 'Bob' }],
    })
  })

  it('fails closed on malformed protobuf', () => {
    expect(convosProfileUpdateCodec.decode({
      content: Uint8Array.from([0x0a, 0xff]),
      parameters: {},
      type: CONVOS_PROFILE_UPDATE_CONTENT_TYPE,
    })).toEqual({})
  })
})
