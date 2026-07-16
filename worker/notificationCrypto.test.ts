// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  decryptNotificationDetails,
  encryptNotificationDetails,
} from './notificationCrypto.js'

const key = Buffer.alloc(32, 7).toString('base64url')
const context = {
  appFid: 9152,
  canonicalDomain: 'miniapp.converge.cv',
  fid: 8531,
}
const details = {
  token: 'opaque-notification-token',
  url: 'https://api.farcaster.xyz/v1/frame-notifications',
}

describe('notification detail encryption', () => {
  it('round trips opaque details with a fresh nonce each time', async () => {
    const first = await encryptNotificationDetails(details, key, context)
    const second = await encryptNotificationDetails(details, key, context)

    expect(first.keyVersion).toBe(1)
    expect(first.nonce).not.toBe(second.nonce)
    expect(first.ciphertext).not.toContain(details.token)
    expect(first.ciphertext).not.toContain(details.url)
    await expect(decryptNotificationDetails(first, key, context)).resolves.toEqual(
      details,
    )
  })

  it.each([
    ['FID', { ...context, fid: 8532 }],
    ['client FID', { ...context, appFid: 9153 }],
    ['canonical domain', { ...context, canonicalDomain: 'example.com' }],
  ])('binds ciphertext to the %s through authenticated data', async (
    _field,
    changedContext,
  ) => {
    const encrypted = await encryptNotificationDetails(details, key, context)

    await expect(decryptNotificationDetails(
      encrypted,
      key,
      changedContext,
    )).rejects.toThrow()
  })

  it('rejects a different key, malformed keys, nonces, and key versions', async () => {
    const encrypted = await encryptNotificationDetails(details, key, context)
    const differentKey = Buffer.alloc(32, 8).toString('base64url')

    await expect(decryptNotificationDetails(
      encrypted,
      differentKey,
      context,
    )).rejects.toThrow()
    await expect(encryptNotificationDetails(details, 'not+base64url', context))
      .rejects.toThrow(/base64url/i)
    await expect(encryptNotificationDetails(
      details,
      Buffer.alloc(31).toString('base64url'),
      context,
    )).rejects.toThrow(/32 bytes/i)
    await expect(decryptNotificationDetails(
      { ...encrypted, nonce: 'AA' },
      key,
      context,
    )).rejects.toThrow(/nonce/i)
    await expect(decryptNotificationDetails(
      { ...encrypted, keyVersion: 2 },
      key,
      context,
    )).rejects.toThrow(/version/i)
  })
})
