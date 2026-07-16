const BASE64URL_VALUE = /^[A-Za-z0-9_-]+$/u
const KEY_BYTES = 32
const NONCE_BYTES = 12
const KEY_VERSION = 1

export type NotificationDetails = {
  token: string
  url: string
}

export type NotificationEncryptionContext = {
  appFid: number
  canonicalDomain: string
  fid: number
}

export type EncryptedNotificationDetails = {
  ciphertext: string
  keyVersion: number
  nonce: string
}

export async function encryptNotificationDetails(
  details: NotificationDetails,
  encodedKey: string,
  context: NotificationEncryptionContext,
): Promise<EncryptedNotificationDetails> {
  const key = await importEncryptionKey(encodedKey)
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const plaintext = new TextEncoder().encode(JSON.stringify({
    token: details.token,
    url: details.url,
  }))
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: associatedData(context),
      iv: nonce,
      name: 'AES-GCM',
      tagLength: 128,
    },
    key,
    plaintext,
  )

  return {
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    keyVersion: KEY_VERSION,
    nonce: encodeBase64Url(nonce),
  }
}

export async function decryptNotificationDetails(
  encrypted: EncryptedNotificationDetails,
  encodedKey: string,
  context: NotificationEncryptionContext,
): Promise<NotificationDetails> {
  if (encrypted.keyVersion !== KEY_VERSION) {
    throw new Error('Unsupported notification encryption key version.')
  }
  const nonce = decodeBase64Url(encrypted.nonce)
  if (nonce.byteLength !== NONCE_BYTES) {
    throw new Error('Invalid notification encryption nonce.')
  }
  const key = await importEncryptionKey(encodedKey)
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: associatedData(context),
      iv: nonce,
      name: 'AES-GCM',
      tagLength: 128,
    },
    key,
    decodeBase64Url(encrypted.ciphertext),
  )
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: false,
  }).decode(plaintext))
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Object.keys(parsed).length !== 2 ||
    !('token' in parsed) ||
    typeof parsed.token !== 'string' ||
    !('url' in parsed) ||
    typeof parsed.url !== 'string'
  ) {
    throw new Error('Invalid encrypted notification details.')
  }
  return { token: parsed.token, url: parsed.url }
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
  const bytes = decodeBase64Url(encodedKey)
  if (bytes.byteLength !== KEY_BYTES) {
    throw new Error('Notification encryption key must contain 32 bytes.')
  }
  return crypto.subtle.importKey(
    'raw',
    bytes,
    { length: 256, name: 'AES-GCM' },
    false,
    ['decrypt', 'encrypt'],
  )
}

function associatedData(context: NotificationEncryptionContext): Uint8Array {
  if (
    !Number.isSafeInteger(context.fid) ||
    context.fid <= 0 ||
    !Number.isSafeInteger(context.appFid) ||
    context.appFid <= 0 ||
    !context.canonicalDomain
  ) {
    throw new Error('Invalid notification encryption context.')
  }
  return new TextEncoder().encode(JSON.stringify({
    appFid: context.appFid,
    canonicalDomain: context.canonicalDomain,
    fid: context.fid,
    purpose: 'converge-miniapp-farcaster-notifications',
    version: KEY_VERSION,
  }))
}

function decodeBase64Url(value: string): Uint8Array {
  if (!value || !BASE64URL_VALUE.test(value)) {
    throw new Error('Invalid base64url value.')
  }
  try {
    const base64 = value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0))
    if (encodeBase64Url(bytes) !== value) {
      throw new Error('Non-canonical base64url value.')
    }
    return bytes
  } catch (error) {
    throw new Error('Invalid base64url value.', { cause: error })
  }
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}
