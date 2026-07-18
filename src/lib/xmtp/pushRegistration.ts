export type XmtpPushHmacKey = {
  epoch: number
  key: string
}

export type XmtpPushTopic = {
  hmacKeys: XmtpPushHmacKey[]
  topic: string
}

export type XmtpPushSnapshot = {
  inboxId: string
  installationId: string
  publicKey: string
  topics: XmtpPushTopic[]
}

type HmacKey = {
  epoch: bigint
  key: Uint8Array
}

type PushSnapshotClient = {
  conversations: {
    hmacKeys(): Promise<Map<string, HmacKey[]>>
    topic: string | undefined
  }
  inboxId: string | undefined
  installationId: string | undefined
  installationIdBytes: Uint8Array | undefined
}

const GROUP_TOPIC = /^\/xmtp\/mls\/1\/g-[0-9a-f]{32}\/proto$/
const GROUP_ID = /^[0-9a-f]{32}$/
const WELCOME_TOPIC = /^\/xmtp\/mls\/1\/w-[0-9a-f]{64}\/proto$/
const MAX_TOPICS = 400
const MAX_PERSISTED_ROWS = 800
const MAX_HMAC_KEYS_PER_TOPIC = 16

export async function buildXmtpPushSnapshot(
  client: PushSnapshotClient,
): Promise<XmtpPushSnapshot> {
  const inboxId = canonicalHex32(client.inboxId, 'inbox ID')
  const installationId = canonicalHex32(
    client.installationId,
    'installation ID',
  )
  const publicKey = client.installationIdBytes
  if (!publicKey || publicKey.length !== 32) {
    throw new Error('XMTP did not provide the installation public key.')
  }
  if (bytesToHex(publicKey) !== installationId) {
    throw new Error('XMTP returned a mismatched installation public key.')
  }

  const welcomeTopic = client.conversations.topic
  if (!welcomeTopic || !WELCOME_TOPIC.test(welcomeTopic)) {
    throw new Error('XMTP did not provide a canonical installation welcome topic.')
  }

  const keysByTopic = await client.conversations.hmacKeys()
  const topics: XmtpPushTopic[] = []
  for (const [groupIdOrTopic, keys] of keysByTopic) {
    const topic = canonicalGroupTopic(groupIdOrTopic)
    if (!topic) {
      throw new Error('XMTP returned a non-canonical conversation push topic.')
    }
    if (!keys.length || keys.length > MAX_HMAC_KEYS_PER_TOPIC) {
      throw new Error('XMTP returned an unsupported HMAC key set.')
    }
    const hmacKeys = keys.map(({ epoch, key }) => {
      if (epoch < 0n || epoch > 0xffff_ffffn) {
        throw new Error('XMTP returned an unsupported HMAC epoch.')
      }
      if (!key.length || key.length > 256) {
        throw new Error('XMTP returned an unsupported HMAC key.')
      }
      return {
        epoch: Number(epoch),
        key: bytesToBase64Url(key),
      }
    }).sort((left, right) => left.epoch - right.epoch)
    topics.push({ hmacKeys, topic })
  }
  topics.sort((left, right) => left.topic.localeCompare(right.topic))
  topics.push({ hmacKeys: [], topic: welcomeTopic })

  if (topics.length > MAX_TOPICS) {
    throw new Error('This inbox has too many XMTP push topics to register safely.')
  }
  const persistedRows = topics.reduce(
    (count, topic) => count + 1 + topic.hmacKeys.length,
    0,
  )
  if (persistedRows > MAX_PERSISTED_ROWS) {
    throw new Error('This inbox has too much XMTP push state to register safely.')
  }

  return {
    inboxId,
    installationId,
    publicKey: bytesToBase64Url(publicKey),
    topics,
  }
}

function canonicalGroupTopic(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  if (GROUP_ID.test(normalized)) return `/xmtp/mls/1/g-${normalized}/proto`
  return GROUP_TOPIC.test(normalized) ? normalized : null
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function canonicalHex32(value: string | undefined, label: string): string {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`XMTP did not provide a canonical ${label}.`)
  }
  return value
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
