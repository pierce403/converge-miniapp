// @vitest-environment node
import {
  createJsonFarcasterSignature,
  parseWebhookEvent,
  type VerifyAppKey,
} from '@farcaster/miniapp-node'
import { describe, expect, it, vi } from 'vitest'

import {
  handleFarcasterWebhook,
  type FarcasterWebhookDependencies,
  type FarcasterWebhookEnv,
} from './farcasterWebhook.js'
import {
  decryptNotificationDetails,
  encryptNotificationDetails,
} from './notificationCrypto.js'

const encryptionKey = Buffer.alloc(32, 7).toString('base64url')
const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const deliveryUrl = 'https://api.farcaster.xyz/v1/frame-notifications'
const token = 'opaque-notification-token'

type StoredRow = {
  appFid: number
  ciphertext: string
  fid: number
  keyVersion: number
  nonce: string
}

describe('Farcaster notification webhook', () => {
  it('verifies, encrypts, and upserts notification details without storing plaintext', async () => {
    const storage = fakeNotificationDatabase()
    const dependencies = webhookDependencies()
    const response = await handleFarcasterWebhook(
      webhookRequest({
        event: 'notifications_enabled',
        notificationDetails: { token, url: deliveryUrl },
      }),
      webhookEnvironment(storage.database),
      dependencies.value,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(dependencies.createVerifier).toHaveBeenCalledWith(
      'https://hub.example',
      expect.objectContaining({
        headers: { 'x-api-key': 'hub-secret' },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(dependencies.verifyAppKey).toHaveBeenCalledWith(
      8531,
      expect.stringMatching(/^0x[0-9a-f]+$/u),
    )

    const row = storage.row(8531, 9152)
    expect(row).not.toBeNull()
    expect(JSON.stringify(row)).not.toContain(token)
    expect(JSON.stringify(row)).not.toContain(deliveryUrl)
    await expect(decryptNotificationDetails({
      ciphertext: row!.ciphertext,
      keyVersion: row!.keyVersion,
      nonce: row!.nonce,
    }, encryptionKey, {
      appFid: 9152,
      canonicalDomain: 'miniapp.converge.cv',
      fid: 8531,
    })).resolves.toEqual({ token, url: deliveryUrl })
  })

  it('rotates an existing client token in one composite-key row', async () => {
    const storage = fakeNotificationDatabase()
    const dependencies = webhookDependencies()
    const env = webhookEnvironment(storage.database)
    const first = await handleFarcasterWebhook(webhookRequest({
      event: 'miniapp_added',
      notificationDetails: { token, url: deliveryUrl },
    }), env, dependencies.value)
    const firstRow = storage.row(8531, 9152)
    const second = await handleFarcasterWebhook(webhookRequest({
      event: 'notifications_enabled',
      notificationDetails: { token: 'rotated-token', url: deliveryUrl },
    }), env, dependencies.value)
    const secondRow = storage.row(8531, 9152)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(storage.size()).toBe(1)
    expect(secondRow?.ciphertext).not.toBe(firstRow?.ciphertext)
    await expect(decryptNotificationDetails({
      ciphertext: secondRow!.ciphertext,
      keyVersion: secondRow!.keyVersion,
      nonce: secondRow!.nonce,
    }, encryptionKey, {
      appFid: 9152,
      canonicalDomain: 'miniapp.converge.cv',
      fid: 8531,
    })).resolves.toEqual({ token: 'rotated-token', url: deliveryUrl })
  })

  it.each([
    ['an add without details', { event: 'miniapp_added' }],
    ['notifications being disabled', { event: 'notifications_disabled' }],
    ['the Mini App being removed', { event: 'miniapp_removed' }],
  ])('deletes only the verified client row after %s', async (_label, event) => {
    const storage = fakeNotificationDatabase()
    storage.seed(8531, 9152)
    storage.seed(8531, 9999)
    storage.seed(9000, 9152)
    storage.seedRoute(8531)
    const dependencies = webhookDependencies()
    const response = await handleFarcasterWebhook(
      webhookRequest(event),
      webhookEnvironment(storage.database),
      dependencies.value,
    )

    expect(response.status).toBe(200)
    expect(storage.row(8531, 9152)).toBeNull()
    expect(storage.row(8531, 9999)).not.toBeNull()
    expect(storage.row(9000, 9152)).not.toBeNull()
    expect(storage.hasRoute(8531)).toBe(true)
    expect(dependencies.revokeNotificationRoute).not.toHaveBeenCalled()
  })

  it('revokes the XMTP route after the final Farcaster client disables alerts', async () => {
    const storage = fakeNotificationDatabase()
    storage.seed(8531, 9152)
    storage.seedRoute(8531)
    const dependencies = webhookDependencies()
    dependencies.revokeNotificationRoute.mockImplementation(async () => {
      storage.revokeRoute(8531)
      return true
    })
    const response = await handleFarcasterWebhook(
      webhookRequest({ event: 'notifications_disabled' }),
      webhookEnvironment(storage.database),
      dependencies.value,
    )

    expect(response.status).toBe(200)
    expect(storage.row(8531, 9152)).toBeNull()
    expect(storage.hasRoute(8531)).toBe(false)
  })

  it('retains the opaque route and retries when upstream revocation fails', async () => {
    const storage = fakeNotificationDatabase()
    storage.seed(8531, 9152)
    storage.seedRoute(8531)
    const dependencies = webhookDependencies()
    dependencies.revokeNotificationRoute.mockRejectedValue(
      new Error('vapid.party unavailable'),
    )
    const response = await handleFarcasterWebhook(
      webhookRequest({ event: 'notifications_disabled' }),
      webhookEnvironment(storage.database),
      dependencies.value,
    )

    expect(response.status).toBe(503)
    expect(storage.row(8531, 9152)).toBeNull()
    expect(storage.hasRoute(8531)).toBe(true)
  })

  it.each([
    'https://evil.example/v1/frame-notifications',
    'http://api.farcaster.xyz/v1/frame-notifications',
    'https://api.farcaster.xyz:444/v1/frame-notifications',
    'https://user@api.farcaster.xyz/v1/frame-notifications',
    'https://api.farcaster.xyz/v1/frame-notifications#fragment',
  ])('rejects an unsafe or non-allowlisted delivery URL: %s', async (url) => {
    const storage = fakeNotificationDatabase()
    const response = await handleFarcasterWebhook(
      webhookRequest({
        event: 'notifications_enabled',
        notificationDetails: { token, url },
      }),
      webhookEnvironment(storage.database),
      webhookDependencies().value,
    )

    expect(response.status).toBe(400)
    expect(storage.size()).toBe(0)
  })

  it.each([
    'FARCASTER_HUB_API_KEY',
    'FARCASTER_HUB_URL',
    'FARCASTER_NOTIFICATION_DELIVERY_URLS',
    'FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1',
    'PREFERENCES',
  ] as const)('fails closed when %s is missing', async (field) => {
    const storage = fakeNotificationDatabase()
    const env = webhookEnvironment(storage.database)
    delete env[field]

    const response = await handleFarcasterWebhook(
      webhookRequest({ event: 'miniapp_added' }),
      env,
      webhookDependencies().value,
    )

    expect(response.status).toBe(503)
    expect(storage.size()).toBe(0)
  })

  it('distinguishes invalid signatures from a current-network verifier outage', async () => {
    const storage = fakeNotificationDatabase()
    const invalidBody = signedWebhook({ event: 'miniapp_removed' })
    invalidBody.signature = `${invalidBody.signature[0] === 'A' ? 'B' : 'A'}${invalidBody.signature.slice(1)}`
    const invalid = await handleFarcasterWebhook(
      jsonWebhookRequest(JSON.stringify(invalidBody)),
      webhookEnvironment(storage.database),
      webhookDependencies().value,
    )

    const unavailableDependencies = webhookDependencies()
    unavailableDependencies.verifyAppKey.mockRejectedValue(
      new Error('hub unavailable'),
    )
    const unavailable = await handleFarcasterWebhook(
      webhookRequest({ event: 'miniapp_removed' }),
      webhookEnvironment(storage.database),
      unavailableDependencies.value,
    )

    expect(invalid.status).toBe(400)
    expect(unavailable.status).toBe(503)
    expect(storage.size()).toBe(0)
  })

  it('rejects a signing app key that is no longer active', async () => {
    const storage = fakeNotificationDatabase()
    const dependencies = webhookDependencies()
    dependencies.verifyAppKey.mockResolvedValue({ valid: false })

    const response = await handleFarcasterWebhook(
      webhookRequest({ event: 'miniapp_removed' }),
      webhookEnvironment(storage.database),
      dependencies.value,
    )

    expect(response.status).toBe(400)
    expect(storage.size()).toBe(0)
  })

  it('bounds the exact production JSON POST surface before verification', async () => {
    const storage = fakeNotificationDatabase()
    const env = webhookEnvironment(storage.database)
    const dependencies = webhookDependencies()
    const wrongHost = await handleFarcasterWebhook(
      new Request('https://alternate.example/api/farcaster/webhook', {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      env,
      dependencies.value,
    )
    const wrongMethod = await handleFarcasterWebhook(
      new Request('https://miniapp.converge.cv/api/farcaster/webhook'),
      env,
      dependencies.value,
    )
    const wrongType = await handleFarcasterWebhook(
      new Request('https://miniapp.converge.cv/api/farcaster/webhook', {
        body: '{}',
        headers: { 'content-type': 'text/plain' },
        method: 'POST',
      }),
      env,
      dependencies.value,
    )
    const malformed = await handleFarcasterWebhook(
      jsonWebhookRequest('{'),
      env,
      dependencies.value,
    )
    const tooLarge = await handleFarcasterWebhook(
      jsonWebhookRequest(JSON.stringify({ value: 'x'.repeat(8_193) })),
      env,
      dependencies.value,
    )

    expect(wrongHost.status).toBe(404)
    expect(wrongMethod.status).toBe(405)
    expect(wrongType.status).toBe(415)
    expect(malformed.status).toBe(400)
    expect(tooLarge.status).toBe(413)
    expect(dependencies.createVerifier).not.toHaveBeenCalled()
  })

  it('uses the exact rendered HTTPS host for an isolated preview', async () => {
    const storage = fakeNotificationDatabase()
    const env = {
      ...webhookEnvironment(storage.database),
      APP_ENV: 'preview',
      CANONICAL_ORIGIN: 'http://localhost:5173',
    }
    const response = await handleFarcasterWebhook(
      webhookRequest(
        { event: 'miniapp_removed' },
        'https://converge-miniapp-preview.example.workers.dev/api/farcaster/webhook',
      ),
      env,
      webhookDependencies().value,
    )

    expect(response.status).toBe(200)
  })

  it('returns a retryable failure without plaintext when encrypted persistence fails', async () => {
    const storage = fakeNotificationDatabase({ failWrites: true })
    const response = await handleFarcasterWebhook(
      webhookRequest({
        event: 'notifications_enabled',
        notificationDetails: { token, url: deliveryUrl },
      }),
      webhookEnvironment(storage.database),
      webhookDependencies().value,
    )

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(token)
    expect(storage.size()).toBe(0)
  })
})

function webhookEnvironment(database: D1Database): FarcasterWebhookEnv {
  return {
    APP_ENV: 'production',
    CANONICAL_ORIGIN: 'https://miniapp.converge.cv',
    FARCASTER_HUB_API_KEY: 'hub-secret',
    FARCASTER_HUB_URL: 'https://hub.example',
    FARCASTER_NOTIFICATION_DELIVERY_URLS: deliveryUrl,
    FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1: encryptionKey,
    PREFERENCES: database,
  }
}

function webhookDependencies(appFid = 9152) {
  const verifyAppKey = vi.fn<VerifyAppKey>().mockResolvedValue({
    appFid,
    valid: true,
  })
  const createVerifier = vi.fn(() => verifyAppKey)
  const revokeRoute = vi.fn().mockResolvedValue(false)
  return {
    createVerifier,
    value: {
      createVerifyAppKeyWithHub: createVerifier,
      encryptNotificationDetails,
      parseWebhookEvent,
      revokeNotificationRoute: revokeRoute,
    } satisfies FarcasterWebhookDependencies,
    verifyAppKey,
    revokeNotificationRoute: revokeRoute,
  }
}

function webhookRequest(
  event: object,
  url = 'https://miniapp.converge.cv/api/farcaster/webhook',
): Request {
  return jsonWebhookRequest(JSON.stringify(signedWebhook(event)), url)
}

function jsonWebhookRequest(
  body: string,
  url = 'https://miniapp.converge.cv/api/farcaster/webhook',
): Request {
  return new Request(url, {
    body,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    method: 'POST',
  })
}

function signedWebhook(event: object) {
  return createJsonFarcasterSignature({
    fid: 8531,
    payload: new TextEncoder().encode(JSON.stringify(event)),
    privateKey,
    type: 'app_key',
  })
}

function fakeNotificationDatabase(options: { failWrites?: boolean } = {}) {
  const rows = new Map<string, StoredRow>()
  const routes = new Set<number>()
  const key = (fid: number, appFid: number) => `${fid}:${appFid}`
  const database = {
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return await Promise.all(statements.map((statement) => statement.run()))
    },
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (query.includes('FROM farcaster_notification_subscriptions')) {
                const fid = values[0] as number
                return [...rows.values()].some((row) => row.fid === fid)
                  ? { active: 1 }
                  : null
              }
              return null
            },
            async run() {
              if (options.failWrites) throw new Error('D1 unavailable')
              const fid = values[0] as number
              const appFid = values[1] as number
              if (query.includes('INSERT INTO farcaster_notification_subscriptions')) {
                rows.set(key(fid, appFid), {
                  appFid,
                  ciphertext: values[2] as string,
                  fid,
                  keyVersion: values[4] as number,
                  nonce: values[3] as string,
                })
              } else if (query.includes('DELETE FROM farcaster_notification_subscriptions')) {
                rows.delete(key(fid, appFid))
              } else if (query.includes('DELETE FROM xmtp_notification_routes')) {
                const hasSubscription = [...rows.values()].some((row) =>
                  row.fid === fid)
                if (!hasSubscription) routes.delete(fid)
              }
              return { success: true }
            },
          }
        },
      }
    },
  } as unknown as D1Database
  return {
    database,
    hasRoute: (fid: number) => routes.has(fid),
    row: (fid: number, appFid: number) => rows.get(key(fid, appFid)) ?? null,
    seed(fid: number, appFid: number) {
      rows.set(key(fid, appFid), {
        appFid,
        ciphertext: 'seed-ciphertext',
        fid,
        keyVersion: 1,
        nonce: 'seed-nonce',
      })
    },
    seedRoute(fid: number) {
      routes.add(fid)
    },
    revokeRoute(fid: number) {
      routes.delete(fid)
    },
    size: () => rows.size,
  }
}
