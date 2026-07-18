import { describe, expect, it } from 'vitest'

import {
  buildXmtpPushSnapshot,
  bytesToBase64Url,
} from './pushRegistration'

const installationId = 'ab'.repeat(32)
const inboxId = 'cd'.repeat(32)
const groupTopic = `/xmtp/mls/1/g-${'12'.repeat(16)}/proto`
const welcomeTopic = `/xmtp/mls/1/w-${installationId}/proto`

describe('XMTP push registration snapshots', () => {
  it('builds a stable canonical topic snapshot without message metadata', async () => {
    const snapshot = await buildXmtpPushSnapshot({
      conversations: {
        hmacKeys: async () => new Map([
          ['12'.repeat(16), [
            { epoch: 4n, key: new Uint8Array([4, 5, 6]) },
            { epoch: 3n, key: new Uint8Array([1, 2, 3]) },
          ]],
        ]),
        topic: welcomeTopic,
      },
      inboxId,
      installationId,
      installationIdBytes: new Uint8Array(32).fill(0xab),
    })

    expect(snapshot).toEqual({
      inboxId,
      installationId,
      publicKey: bytesToBase64Url(new Uint8Array(32).fill(0xab)),
      topics: [
        {
          hmacKeys: [
            { epoch: 3, key: 'AQID' },
            { epoch: 4, key: 'BAUG' },
          ],
          topic: groupTopic,
        },
        { hmacKeys: [], topic: welcomeTopic },
      ],
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/sender|message|conversationId/)
  })

  it('rejects a public key that does not match the installation id', async () => {
    await expect(buildXmtpPushSnapshot({
      conversations: {
        hmacKeys: async () => new Map(),
        topic: welcomeTopic,
      },
      inboxId,
      installationId,
      installationIdBytes: new Uint8Array(32),
    })).rejects.toThrow('mismatched installation public key')
  })

  it('normalizes SDK-exposed group ids before constructing topics', async () => {
    const snapshot = await buildXmtpPushSnapshot({
      conversations: {
        hmacKeys: async () => new Map([
          [`  ${'AB'.repeat(16)}  `, [
            { epoch: 1n, key: new Uint8Array([1]) },
          ]],
        ]),
        topic: welcomeTopic,
      },
      inboxId,
      installationId,
      installationIdBytes: new Uint8Array(32).fill(0xab),
    })

    expect(snapshot.topics[0]?.topic).toBe(
      `/xmtp/mls/1/g-${'ab'.repeat(16)}/proto`,
    )
  })

  it('rejects non-canonical topics instead of broadening relay scope', async () => {
    await expect(buildXmtpPushSnapshot({
      conversations: {
        hmacKeys: async () => new Map([
          ['/xmtp/mls/1/g-not-canonical/proto', [
            { epoch: 1n, key: new Uint8Array([1]) },
          ]],
        ]),
        topic: welcomeTopic,
      },
      inboxId,
      installationId,
      installationIdBytes: new Uint8Array(32).fill(0xab),
    })).rejects.toThrow('non-canonical conversation push topic')
  })
})
