// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import {
  handleNotificationUserApi,
  handleXmtpNotificationCallback,
  notificationBridgeConfigured,
  verifyVapidPartySignature,
  type NotificationBridgeDependencies,
  type NotificationBridgeEnv,
} from './notificationBridge.js'

const now = Date.parse('2026-07-18T12:00:00.000Z')
const deliveryUrl = 'https://api.farcaster.xyz/v1/frame-notifications'
const publicKey = base64url(Uint8Array.from([4, ...new Uint8Array(64).fill(7)]))
const encryptionKey = base64url(new Uint8Array(32).fill(9))

describe('XMTP to Farcaster notification bridge', () => {
  it('reports availability only with the complete fail-closed configuration', () => {
    const storage = fakeBridgeDatabase()
    const env = environment(storage.database)
    expect(notificationBridgeConfigured(env)).toBe(true)
    delete env.VAPID_PARTY_APP_SECRET
    expect(notificationBridgeConfigured(env)).toBe(false)
  })

  it('mints an app-approved ticket with a server-owned callback and opaque route', async () => {
    const storage = fakeBridgeDatabase()
    storage.seedSubscription(8531, 9152)
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      data: {
        expiresAt: '2026-07-18T12:05:00.000Z',
        signatureText: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
        token: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
      },
      success: true,
    }))
    const response = await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-ticket', {
        registration: requestedRegistration(),
      }),
      environment(storage.database),
      8531,
      dependencies({ fetch: upstreamFetch }),
    )

    expect(response.status).toBe(200)
    const body = await response.json() as {
      registration: Record<string, unknown>
      ticket: string
    }
    expect(body.ticket).toMatch(/^vpxet1\./u)
    expect(body.registration).toMatchObject({
      delivery: {
        kind: 'https_callback',
        url: 'https://miniapp.converge.cv/api/internal/xmtp-notification',
      },
      notification: { inboxHandle: base64url(new Uint8Array(32).fill(5)) },
      preferences: { minimalPayloadOnly: true, plaintextPreview: false },
      xmtp: { topicSource: 'conversations.hmacKeys' },
    })
    expect(JSON.stringify(body)).not.toMatch(/sender|message|conversationId/u)
    expect(upstreamFetch).toHaveBeenCalledWith(
      'https://vapid.party/api/apps/app_12345678/xmtp/enrollment-ticket',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'app-secret' }),
        method: 'POST',
        redirect: 'manual',
      }),
    )
    expect(storage.routeForFid(8531)).toBe(
      base64url(new Uint8Array(32).fill(5)),
    )
  })

  it('keeps one stable opaque route while vapid.party replaces the active installation', async () => {
    const storage = fakeBridgeDatabase()
    storage.seedSubscription(8531, 9152)
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      data: {
        expiresAt: '2026-07-18T12:05:00.000Z',
        signatureText: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
        token: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
      },
      success: true,
    }))
    const env = environment(storage.database)

    await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-ticket', {
        registration: requestedRegistration(),
      }),
      env,
      8531,
      dependencies({ fetch: upstreamFetch }),
    )
    const firstHandle = storage.routeForFid(8531)

    await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-ticket', {
        registration: requestedRegistration(),
      }),
      env,
      8531,
      dependencies({
        fetch: upstreamFetch,
        randomBytes: () => new Uint8Array(32).fill(6),
      }),
    )
    expect(storage.routeForFid(8531)).toBe(firstHandle)

    const changed = requestedRegistration()
    changed.identity.installationId = 'ef'.repeat(32)
    changed.xmtp.topics[1] = {
      hmacKeys: [],
      topic: `/xmtp/mls/1/w-${changed.identity.installationId}/proto`,
    }
    await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-ticket', { registration: changed }),
      env,
      8531,
      dependencies({
        fetch: upstreamFetch,
        randomBytes: () => new Uint8Array(32).fill(7),
      }),
    )
    expect(storage.routeForFid(8531)).toBe(firstHandle)
  })

  it('forwards installation proof but keeps the management receipt server-side', async () => {
    const storage = fakeBridgeDatabase()
    storage.seedSubscription(8531, 9152)
    const ticket = `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`
    const upstreamFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        data: {
          expiresAt: '2026-07-18T12:05:00.000Z',
          signatureText: ticket,
          token: ticket,
        },
        success: true,
      }))
      .mockResolvedValueOnce(Response.json({
        data: {
          created: true,
          diagnostics: { receipt: 'vpxmr1.secret-capability' },
          hmacKeysRegistered: 1,
          identityId: 'identity',
          subscriptionId: 'subscription',
          topicsRegistered: 2,
        },
        success: true,
      }, { status: 201 }))
    const deps = dependencies({ fetch: upstreamFetch })
    const env = environment(storage.database)
    const ticketResponse = await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-ticket', {
        registration: requestedRegistration(),
      }),
      env,
      8531,
      deps,
    )
    const enrollment = await ticketResponse.json() as {
      registration: unknown
      ticket: string
    }
    const submit = await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-subscription', {
        proof: {
          publicKey: base64url(new Uint8Array(32).fill(0xab)),
          signature: base64url(new Uint8Array(64).fill(3)),
        },
        registration: enrollment.registration,
        ticket: enrollment.ticket,
      }),
      env,
      8531,
      deps,
    )

    expect(submit.status).toBe(200)
    const submitText = await submit.text()
    expect(JSON.parse(submitText)).toEqual({ registered: true })
    expect(submitText).not.toContain('vpxmr1')
    const forwarded = JSON.parse(
      upstreamFetch.mock.calls[1]?.[1]?.body as string,
    )
    expect(forwarded.proof.publicKey).toBe(
      base64url(new Uint8Array(32).fill(0xab)),
    )
    expect(upstreamFetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${ticket}`,
    })
  })

  it('does not proxy arbitrary vapid.party error details to the browser', async () => {
    const storage = fakeBridgeDatabase()
    storage.seedSubscription(8531, 9152)
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: 'invalid_app_secret',
      diagnostics: { credential: 'do-not-reflect-this' },
    }, { status: 401 }))
    const response = await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-ticket', {
        registration: requestedRegistration(),
      }),
      environment(storage.database),
      8531,
      dependencies({ fetch: upstreamFetch }),
    )

    expect(response.status).toBe(503)
    const responseText = await response.text()
    expect(JSON.parse(responseText)).toEqual({
      error: 'notification_unavailable',
    })
    expect(responseText).not.toContain('do-not-reflect-this')
  })

  it('keeps the vapid.party timeout active while reading the response body', async () => {
    vi.useFakeTimers()
    try {
      const storage = fakeBridgeDatabase()
      storage.seedSubscription(8531, 9152)
      let started!: () => void
      const fetchStarted = new Promise<void>((resolve) => {
        started = resolve
      })
      const upstreamFetch = vi.fn<typeof fetch>().mockImplementation(
        async (_input, init) => {
          const signal = init?.signal as AbortSignal
          started()
          return stalledJsonResponse(signal)
        },
      )
      const pendingResponse = handleNotificationUserApi(
        jsonRequest('/api/me/notifications/xmtp-ticket', {
          registration: requestedRegistration(),
        }),
        environment(storage.database),
        8531,
        dependencies({ fetch: upstreamFetch }),
      )

      await fetchStarted
      await vi.advanceTimersByTimeAsync(8_001)
      const response = await pendingResponse

      expect(response.status).toBe(503)
      expect(upstreamFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('revokes a proved enrollment that races with a signed opt-out', async () => {
    const storage = fakeBridgeDatabase()
    storage.seedSubscription(8531, 9152)
    const ticket = `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`
    const upstreamFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        data: {
          expiresAt: '2026-07-18T12:05:00.000Z',
          signatureText: ticket,
          token: ticket,
        },
        success: true,
      }))
      .mockImplementationOnce(async () => {
        storage.removeRoute(8531)
        return Response.json({ data: { created: true }, success: true })
      })
      .mockResolvedValueOnce(Response.json({
        data: { disabled: 1 },
        success: true,
      }))
    const deps = dependencies({ fetch: upstreamFetch })
    const env = environment(storage.database)
    const prepared = await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-ticket', {
        registration: requestedRegistration(),
      }),
      env,
      8531,
      deps,
    )
    const enrollment = await prepared.json() as {
      registration: unknown
      ticket: string
    }
    const response = await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-subscription', {
        proof: {
          publicKey: base64url(new Uint8Array(32).fill(0xab)),
          signature: base64url(new Uint8Array(64).fill(3)),
        },
        registration: enrollment.registration,
        ticket: enrollment.ticket,
      }),
      env,
      8531,
      deps,
    )

    expect(response.status).toBe(410)
    expect(upstreamFetch).toHaveBeenCalledTimes(3)
    expect(upstreamFetch.mock.calls[2]?.[0]).toBe(
      'https://vapid.party/api/apps/app_12345678/xmtp/callback-routes',
    )
  })

  it('revokes the app-scoped callback route without exposing a management token', async () => {
    const storage = fakeBridgeDatabase()
    const inboxHandle = base64url(new Uint8Array(32).fill(4))
    storage.seedRoute(8531, inboxHandle)
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      data: { disabled: 1 },
      success: true,
    }))
    const response = await handleNotificationUserApi(
      new Request(
        'https://miniapp.converge.cv/api/me/notifications/xmtp-subscription',
        { method: 'DELETE' },
      ),
      environment(storage.database),
      8531,
      dependencies({ fetch: upstreamFetch }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ disabled: true })
    expect(storage.routeForFid(8531)).toBeUndefined()
    expect(upstreamFetch).toHaveBeenCalledWith(
      'https://vapid.party/api/apps/app_12345678/xmtp/callback-routes',
      expect.objectContaining({
        body: JSON.stringify({ inboxHandle }),
        headers: expect.objectContaining({ 'x-api-key': 'app-secret' }),
        method: 'DELETE',
        redirect: 'manual',
      }),
    )
  })

  it('waits for the signed Farcaster webhook before creating an XMTP route', async () => {
    const storage = fakeBridgeDatabase()
    const upstreamFetch = vi.fn<typeof fetch>()
    const response = await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-ticket', {
        registration: requestedRegistration(),
      }),
      environment(storage.database),
      8531,
      dependencies({ fetch: upstreamFetch }),
    )

    expect(response.status).toBe(425)
    expect(response.headers.get('retry-after')).toBe('2')
    expect(storage.routeForFid(8531)).toBeUndefined()
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('rate limits enrollment mutations by the verified Farcaster FID', async () => {
    const storage = fakeBridgeDatabase()
    storage.seedSubscription(8531, 9152)
    const env = environment(storage.database)
    env.IDENTITY_RATE_LIMITER = {
      limit: vi.fn().mockResolvedValue({ success: false }),
    } as unknown as RateLimit
    const upstreamFetch = vi.fn<typeof fetch>()
    const response = await handleNotificationUserApi(
      jsonRequest('/api/me/notifications/xmtp-ticket', {
        registration: requestedRegistration(),
      }),
      env,
      8531,
      dependencies({ fetch: upstreamFetch }),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('verifies the minimal callback, sends fixed copy, and replays idempotently', async () => {
    const storage = fakeBridgeDatabase()
    const inboxHandle = base64url(new Uint8Array(32).fill(6))
    storage.seedRoute(8531, inboxHandle)
    storage.seedSubscription(8531, 9152)
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      invalidTokens: [],
      rateLimitedTokens: [],
      successfulTokens: ['farcaster-token'],
    }))
    const verify = vi.fn().mockResolvedValue(true)
    const deps = dependencies({
      decryptNotificationDetails: vi.fn().mockResolvedValue({
        token: 'farcaster-token',
        url: deliveryUrl,
      }),
      fetch: providerFetch,
      verifyCallbackSignature: verify,
    })
    const deliveryId = '3c0f7a8e-b9a1-4d8e-a9cc-123456789abc'
    const callback = callbackRequest(deliveryId, inboxHandle)
    const first = await handleXmtpNotificationCallback(
      callback,
      environment(storage.database),
      deps,
    )

    expect(first.status).toBe(204)
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(providerFetch.mock.calls[0]?.[1]?.redirect).toBe('manual')
    const providerBody = JSON.parse(
      providerFetch.mock.calls[0]?.[1]?.body as string,
    )
    expect(providerBody).toEqual({
      body: 'Open Converge Mini to read it.',
      notificationId: `xmtp.${deliveryId}`,
      targetUrl: 'https://miniapp.converge.cv/',
      title: 'New Converge message',
      tokens: ['farcaster-token'],
    })
    expect(JSON.stringify(providerBody)).not.toMatch(/sender|plaintext|conversationId/u)
    expect(verify).toHaveBeenCalledTimes(1)

    const replay = await handleXmtpNotificationCallback(
      callbackRequest(deliveryId, inboxHandle),
      environment(storage.database),
      deps,
    )
    expect(replay.status).toBe(204)
    expect(providerFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the Farcaster timeout active while reading the response body', async () => {
    vi.useFakeTimers()
    try {
      const storage = fakeBridgeDatabase()
      const inboxHandle = base64url(new Uint8Array(32).fill(9))
      storage.seedRoute(8531, inboxHandle)
      storage.seedSubscription(8531, 9152)
      let started!: () => void
      const fetchStarted = new Promise<void>((resolve) => {
        started = resolve
      })
      const providerFetch = vi.fn<typeof fetch>().mockImplementation(
        async (_input, init) => {
          const signal = init?.signal as AbortSignal
          started()
          return stalledJsonResponse(signal)
        },
      )
      const pendingResponse = handleXmtpNotificationCallback(
        callbackRequest(
          '9c0f7a8e-b9a1-4d8e-a9cc-123456789abc',
          inboxHandle,
        ),
        environment(storage.database),
        dependencies({
          decryptNotificationDetails: vi.fn().mockResolvedValue({
            token: 'farcaster-token',
            url: deliveryUrl,
          }),
          fetch: providerFetch,
          verifyCallbackSignature: vi.fn().mockResolvedValue(true),
        }),
      )

      await fetchStarted
      await vi.advanceTimersByTimeAsync(8_001)
      const response = await pendingResponse

      expect(response.status).toBe(503)
      expect(providerFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('deletes invalid Farcaster tokens and asks vapid.party to retry throttles', async () => {
    const storage = fakeBridgeDatabase()
    const inboxHandle = base64url(new Uint8Array(32).fill(8))
    storage.seedRoute(8531, inboxHandle)
    storage.seedSubscription(8531, 9152)
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      invalidTokens: [],
      rateLimitedTokens: ['farcaster-token'],
      successfulTokens: [],
    }, { headers: { 'retry-after': '45' } }))
    const response = await handleXmtpNotificationCallback(
      callbackRequest('4c0f7a8e-b9a1-4d8e-a9cc-123456789abc', inboxHandle),
      environment(storage.database),
      dependencies({
        decryptNotificationDetails: vi.fn().mockResolvedValue({
          token: 'farcaster-token',
          url: deliveryUrl,
        }),
        fetch: providerFetch,
        verifyCallbackSignature: vi.fn().mockResolvedValue(true),
      }),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('45')
  })

  it('revokes the opaque route after the last Farcaster token becomes invalid', async () => {
    const storage = fakeBridgeDatabase()
    const inboxHandle = base64url(new Uint8Array(32).fill(2))
    storage.seedRoute(8531, inboxHandle)
    storage.seedSubscription(8531, 9152)
    const deps = dependencies({
      decryptNotificationDetails: vi.fn().mockResolvedValue({
        token: 'farcaster-token',
        url: deliveryUrl,
      }),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        invalidTokens: ['farcaster-token'],
        rateLimitedTokens: [],
        successfulTokens: [],
      })),
      verifyCallbackSignature: vi.fn().mockResolvedValue(true),
    })
    const first = await handleXmtpNotificationCallback(
      callbackRequest('6c0f7a8e-b9a1-4d8e-a9cc-123456789abc', inboxHandle),
      environment(storage.database),
      deps,
    )
    expect(first.status).toBe(410)
    expect(storage.routeForFid(8531)).toBeUndefined()

    const next = await handleXmtpNotificationCallback(
      callbackRequest('7c0f7a8e-b9a1-4d8e-a9cc-123456789abc', inboxHandle),
      environment(storage.database),
      deps,
    )
    expect(next.status).toBe(410)
  })

  it('returns terminal gone for a revoked route without sending anything', async () => {
    const storage = fakeBridgeDatabase()
    const providerFetch = vi.fn<typeof fetch>()
    const response = await handleXmtpNotificationCallback(
      callbackRequest(
        '5c0f7a8e-b9a1-4d8e-a9cc-123456789abc',
        base64url(new Uint8Array(32).fill(4)),
      ),
      environment(storage.database),
      dependencies({
        fetch: providerFetch,
        verifyCallbackSignature: vi.fn().mockResolvedValue(true),
      }),
    )

    expect(response.status).toBe(410)
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('revokes a stale route instead of acknowledging an event with no native token', async () => {
    const storage = fakeBridgeDatabase()
    const inboxHandle = base64url(new Uint8Array(32).fill(1))
    storage.seedRoute(8531, inboxHandle)
    const providerFetch = vi.fn<typeof fetch>()
    const response = await handleXmtpNotificationCallback(
      callbackRequest('8c0f7a8e-b9a1-4d8e-a9cc-123456789abc', inboxHandle),
      environment(storage.database),
      dependencies({
        fetch: providerFetch,
        verifyCallbackSignature: vi.fn().mockResolvedValue(true),
      }),
    )

    expect(response.status).toBe(410)
    expect(storage.routeForFid(8531)).toBeUndefined()
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('verifies raw WebCrypto P-256 callback signatures', async () => {
    const generated = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )
    if (!('publicKey' in generated)) throw new Error('Expected an ECDSA key pair.')
    const pair = generated
    const rawPublicKey = new Uint8Array(
      await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer,
    )
    const signedBytes = new TextEncoder().encode('timestamp\ndelivery\n{}')
    const signature = new Uint8Array(await crypto.subtle.sign(
      { hash: 'SHA-256', name: 'ECDSA' },
      pair.privateKey,
      signedBytes,
    ))

    await expect(verifyVapidPartySignature(
      base64url(rawPublicKey),
      signature,
      signedBytes,
    )).resolves.toBe(true)
    const tamperedBytes = signedBytes.slice()
    tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 1
    await expect(verifyVapidPartySignature(
      base64url(rawPublicKey),
      signature,
      tamperedBytes,
    )).resolves.toBe(false)
  })
})

function environment(database: D1Database): NotificationBridgeEnv {
  return {
    APP_ENV: 'production',
    CANONICAL_ORIGIN: 'https://miniapp.converge.cv',
    FARCASTER_HUB_API_KEY: 'neynar-key',
    FARCASTER_HUB_URL: 'https://hub-api.neynar.com',
    FARCASTER_NOTIFICATION_DELIVERY_URLS: deliveryUrl,
    FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1: encryptionKey,
    IDENTITY_RATE_LIMITER: {
      limit: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as RateLimit,
    PREFERENCES: database,
    VAPID_PARTY_APP_ID: 'app_12345678',
    VAPID_PARTY_APP_SECRET: 'app-secret',
    VAPID_PARTY_ORIGIN: 'https://vapid.party',
    VAPID_PARTY_PUBLIC_KEY: publicKey,
  }
}

function dependencies(
  overrides: Partial<NotificationBridgeDependencies> = {},
): NotificationBridgeDependencies {
  return {
    decryptNotificationDetails: vi.fn().mockRejectedValue(
      new Error('Unexpected decryption.'),
    ),
    fetch: vi.fn(),
    now: () => now,
    randomBytes: () => new Uint8Array(32).fill(5),
    verifyCallbackSignature: vi.fn().mockResolvedValue(false),
    ...overrides,
  }
}

function requestedRegistration() {
  const installationId = 'ab'.repeat(32)
  return {
    identity: { inboxId: 'cd'.repeat(32), installationId },
    registeredAt: new Date(now).toISOString(),
    version: 1,
    xmtp: {
      env: 'production',
      topics: [
        {
          hmacKeys: [{ epoch: 7, key: base64url(new Uint8Array([1, 2, 3])) }],
          topic: `/xmtp/mls/1/g-${'12'.repeat(16)}/proto`,
        },
        {
          hmacKeys: [],
          topic: `/xmtp/mls/1/w-${installationId}/proto`,
        },
      ],
    },
  }
}

function callbackRequest(deliveryId: string, inboxHandle: string): Request {
  const body = JSON.stringify({
    deliveryId,
    inboxHandle,
    type: 'xmtp.message_available',
    version: 1,
  })
  return new Request(
    'https://miniapp.converge.cv/api/internal/xmtp-notification',
    {
      body,
      headers: {
        'content-type': 'application/json',
        'vapid-party-app-id': 'app_12345678',
        'vapid-party-delivery-id': deliveryId,
        'vapid-party-signature': `v1=${base64url(new Uint8Array(64).fill(3))}`,
        'vapid-party-timestamp': String(Math.floor(now / 1_000)),
      },
      method: 'POST',
    },
  )
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://miniapp.converge.cv${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

function stalledJsonResponse(signal: AbortSignal): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => controller.error(signal.reason)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    },
  }), {
    headers: { 'content-type': 'application/json' },
  })
}

type FakeSubscription = {
  app_fid: number
  details_ciphertext: string
  details_nonce: string
  fid: number
  key_version: number
}

function fakeBridgeDatabase() {
  const routesByFid = new Map<number, {
    handle: string
    state: 'active' | 'revoking'
  }>()
  const routesByHandle = new Map<string, number>()
  const deliveries = new Map<string, {
    inboxHandle: string
    lease: number
    status: 'delivered' | 'processing' | 'retry'
  }>()
  const subscriptions = new Map<string, FakeSubscription>()

  class Statement {
    private readonly query: string
    private values: unknown[] = []

    constructor(query: string) {
      this.query = query
    }

    bind(...values: unknown[]) {
      this.values = values
      return this
    }

    async first<T>(): Promise<T | null> {
      if (this.query.includes('FROM farcaster_notification_subscriptions')) {
        const fid = this.values[0] as number
        const active = [...subscriptions.values()].some((row) => row.fid === fid)
        return (active ? { active: 1 } : null) as T | null
      }
      if (this.query.includes('FROM xmtp_notification_routes') &&
        this.query.includes('WHERE fid = ?1 AND inbox_handle = ?2')) {
        const [fid, handle] = this.values as [number, string]
        const route = routesByFid.get(fid)
        return (route?.handle === handle && route.state === 'active'
          ? { owned: 1 }
          : null) as T | null
      }
      if (this.query.includes('FROM xmtp_notification_routes') &&
        this.query.includes('WHERE inbox_handle = ?1')) {
        const fid = routesByHandle.get(this.values[0] as string)
        const route = fid === undefined ? undefined : routesByFid.get(fid)
        return (fid === undefined || !route
          ? null
          : { fid, state: route.state }) as T | null
      }
      if (this.query.includes('FROM xmtp_notification_routes') &&
        this.query.includes('WHERE fid = ?1')) {
        const route = routesByFid.get(this.values[0] as number)
        return (route === undefined ? null : {
          inbox_handle: route.handle,
          state: route.state,
        }) as T | null
      }
      if (this.query.includes('FROM xmtp_notification_deliveries')) {
        const row = deliveries.get(this.values[0] as string)
        return (row === undefined ? null : {
          inbox_handle: row.inboxHandle,
          lease_expires_at: row.lease,
          status: row.status,
        }) as T | null
      }
      return null
    }

    async all<T>() {
      if (this.query.includes('FROM farcaster_notification_subscriptions')) {
        const fid = this.values[0] as number
        return {
          results: [...subscriptions.values()].filter((row) => row.fid === fid) as T[],
          success: true,
        }
      }
      return { results: [] as T[], success: true }
    }

    async run() {
      let changes = 0
      if (this.query.includes('INSERT OR IGNORE INTO xmtp_notification_routes')) {
        const [handle, fid] = this.values as [string, number]
        if (!routesByFid.has(fid) && !routesByHandle.has(handle)) {
          routesByFid.set(fid, { handle, state: 'active' })
          routesByHandle.set(handle, fid)
          changes = 1
        }
      } else if (this.query.includes('INSERT OR IGNORE INTO xmtp_notification_deliveries')) {
        const [deliveryId, inboxHandle, lease] = this.values as [string, string, number]
        if (!deliveries.has(deliveryId)) {
          deliveries.set(deliveryId, { inboxHandle, lease, status: 'processing' })
          changes = 1
        }
      } else if (this.query.includes("SET status = 'processing'")) {
        const [deliveryId, lease, current] = this.values as [string, number, number]
        const row = deliveries.get(deliveryId)
        if (row && row.status !== 'delivered' &&
          (row.status === 'retry' || row.lease <= current)) {
          row.status = 'processing'
          row.lease = lease
          changes = 1
        }
      } else if (this.query.includes("SET status = 'delivered'")) {
        const row = deliveries.get(this.values[0] as string)
        if (row) {
          row.status = 'delivered'
          row.lease = 0
          changes = 1
        }
      } else if (this.query.includes("SET status = 'retry'")) {
        const row = deliveries.get(this.values[0] as string)
        if (row) {
          row.status = 'retry'
          row.lease = this.values[1] as number
          changes = 1
        }
      } else if (this.query.includes("SET state = 'revoking'")) {
        const [fid, handle] = this.values as [number, string]
        const route = routesByFid.get(fid)
        if (route?.handle === handle) {
          route.state = 'revoking'
          changes = 1
        }
      } else if (this.query.includes('DELETE FROM farcaster_notification_subscriptions')) {
        const [fid, appFid] = this.values as [number, number]
        changes = subscriptions.delete(`${fid}:${appFid}`) ? 1 : 0
      } else if (this.query.includes('DELETE FROM xmtp_notification_routes')) {
        const fid = this.values[0] as number
        const route = routesByFid.get(fid)
        const deleteExactHandle = this.values.length === 2 &&
          route?.handle === this.values[1]
        const deleteUnconditional = this.values.length === 1
        if (route && (deleteExactHandle || deleteUnconditional)) {
          routesByFid.delete(fid)
          routesByHandle.delete(route.handle)
          changes = 1
        }
      }
      return { meta: { changes }, success: true }
    }
  }

  const database = {
    async batch(statements: Statement[]) {
      return await Promise.all(statements.map((statement) => statement.run()))
    },
    prepare(query: string) {
      return new Statement(query)
    },
  } as unknown as D1Database

  return {
    database,
    routeForFid: (fid: number) => routesByFid.get(fid)?.handle,
    removeRoute(fid: number) {
      const route = routesByFid.get(fid)
      if (!route) return
      routesByFid.delete(fid)
      routesByHandle.delete(route.handle)
    },
    seedRoute(fid: number, handle: string) {
      routesByFid.set(fid, { handle, state: 'active' })
      routesByHandle.set(handle, fid)
    },
    seedSubscription(fid: number, appFid: number) {
      subscriptions.set(`${fid}:${appFid}`, {
        app_fid: appFid,
        details_ciphertext: 'ciphertext',
        details_nonce: 'nonce',
        fid,
        key_version: 1,
      })
    },
  }
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}
