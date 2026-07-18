import {
  createVerifyAppKeyWithHub,
  parseWebhookEvent,
  type ParseWebhookEventResult,
  type VerifyAppKey,
} from '@farcaster/miniapp-node'

import {
  encryptNotificationDetails,
  type EncryptedNotificationDetails,
  type NotificationDetails,
} from './notificationCrypto.js'
import {
  revokeNotificationRoute,
  type NotificationBridgeEnv,
} from './notificationBridge.js'

const BODY_LIMIT_BYTES = 8_192
const HUB_TIMEOUT_MS = 5_000
const MAX_TOKEN_BYTES = 4_096
const MAX_URL_BYTES = 2_048

const responseHeaders = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
}

export type FarcasterWebhookEnv = NotificationBridgeEnv

export type FarcasterWebhookDependencies = {
  createVerifyAppKeyWithHub: (
    hubUrl: string,
    requestOptions?: RequestInit,
  ) => VerifyAppKey
  encryptNotificationDetails: typeof encryptNotificationDetails
  parseWebhookEvent: (
    rawData: unknown,
    verifyAppKey: VerifyAppKey,
  ) => Promise<ParseWebhookEventResult>
  revokeNotificationRoute: typeof revokeNotificationRoute
}

const defaultDependencies: FarcasterWebhookDependencies = {
  createVerifyAppKeyWithHub,
  encryptNotificationDetails,
  parseWebhookEvent,
  revokeNotificationRoute,
}

export async function handleFarcasterWebhook(
  request: Request,
  env: FarcasterWebhookEnv,
  dependencies: FarcasterWebhookDependencies = defaultDependencies,
): Promise<Response> {
  const requestUrl = new URL(request.url)
  const canonicalDomain = webhookDomain(requestUrl, env)
  if (
    !canonicalDomain ||
    requestUrl.pathname !== '/api/farcaster/webhook' ||
    requestUrl.search !== ''
  ) return jsonError('not_found', 404)

  if (request.method !== 'POST') {
    return Response.json(
      { error: 'method_not_allowed' },
      { headers: { ...responseHeaders, allow: 'POST' }, status: 405 },
    )
  }
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json') return jsonError('invalid_request', 415)

  const configuration = notificationConfiguration(env)
  const database = env.PREFERENCES
  if (!configuration || !database) {
    return jsonError('notification_unavailable', 503)
  }

  const body = await readJsonBody(request)
  if (body.status === 'too-large') return jsonError('invalid_request', 413)
  if (body.status === 'invalid') return jsonError('invalid_request', 400)
  if (body.status !== 'valid') return jsonError('invalid_request', 400)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HUB_TIMEOUT_MS)
  let parsed: ParseWebhookEventResult
  try {
    const verifyAppKey = dependencies.createVerifyAppKeyWithHub(
      configuration.hubUrl,
      {
        headers: { 'x-api-key': configuration.hubApiKey },
        redirect: 'error',
        signal: controller.signal,
      },
    )
    parsed = await dependencies.parseWebhookEvent(body.value, verifyAppKey)
  } catch (error) {
    if (isInvalidWebhookError(error)) return jsonError('invalid_request', 400)
    return jsonError('notification_unavailable', 503)
  } finally {
    clearTimeout(timeout)
  }

  if (
    !Number.isSafeInteger(parsed.fid) ||
    parsed.fid <= 0 ||
    !Number.isSafeInteger(parsed.appFid) ||
    parsed.appFid <= 0
  ) return jsonError('invalid_request', 400)

  try {
    const event = parsed.event
    if (event.event === 'notifications_enabled') {
      const details = acceptedNotificationDetails(
        event.notificationDetails,
        configuration.deliveryUrls,
      )
      if (!details) return jsonError('invalid_request', 400)
      await upsertSubscription(
        database,
        parsed.fid,
        parsed.appFid,
        details,
        configuration.encryptionKey,
        canonicalDomain,
        dependencies,
      )
    } else if (event.event === 'miniapp_added' && event.notificationDetails) {
      const details = acceptedNotificationDetails(
        event.notificationDetails,
        configuration.deliveryUrls,
      )
      if (!details) return jsonError('invalid_request', 400)
      await upsertSubscription(
        database,
        parsed.fid,
        parsed.appFid,
        details,
        configuration.encryptionKey,
        canonicalDomain,
        dependencies,
      )
    } else {
      await deleteSubscription(
        env,
        database,
        parsed.fid,
        parsed.appFid,
        dependencies,
      )
    }
  } catch {
    return jsonError('notification_unavailable', 503)
  }

  return Response.json({ ok: true }, { headers: responseHeaders })
}

async function upsertSubscription(
  database: D1Database,
  fid: number,
  appFid: number,
  details: NotificationDetails,
  encryptionKey: string,
  canonicalDomain: string,
  dependencies: FarcasterWebhookDependencies,
): Promise<void> {
  const encrypted: EncryptedNotificationDetails =
    await dependencies.encryptNotificationDetails(details, encryptionKey, {
      appFid,
      canonicalDomain,
      fid,
    })
  await database.prepare(`
    INSERT INTO farcaster_notification_subscriptions (
      fid,
      app_fid,
      details_ciphertext,
      details_nonce,
      key_version,
      created_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, unixepoch(), unixepoch())
    ON CONFLICT(fid, app_fid) DO UPDATE SET
      details_ciphertext = excluded.details_ciphertext,
      details_nonce = excluded.details_nonce,
      key_version = excluded.key_version,
      updated_at = unixepoch()
  `).bind(
    fid,
    appFid,
    encrypted.ciphertext,
    encrypted.nonce,
    encrypted.keyVersion,
  ).run()
}

async function deleteSubscription(
  env: FarcasterWebhookEnv,
  database: D1Database,
  fid: number,
  appFid: number,
  dependencies: FarcasterWebhookDependencies,
): Promise<void> {
  await database.prepare(`
    DELETE FROM farcaster_notification_subscriptions
    WHERE fid = ?1 AND app_fid = ?2
  `).bind(fid, appFid).run()
  const remaining = await database.prepare(`
    SELECT 1 AS active
    FROM farcaster_notification_subscriptions
    WHERE fid = ?1
    LIMIT 1
  `).bind(fid).first<{ active: number }>()
  if (remaining?.active !== 1) {
    await dependencies.revokeNotificationRoute(env, fid)
  }
}

function acceptedNotificationDetails(
  value: NotificationDetails,
  allowedUrls: ReadonlySet<string>,
): NotificationDetails | null {
  if (
    typeof value.url !== 'string' ||
    value.url !== value.url.trim() ||
    utf8Length(value.url) === 0 ||
    utf8Length(value.url) > MAX_URL_BYTES ||
    typeof value.token !== 'string' ||
    utf8Length(value.token) === 0 ||
    utf8Length(value.token) > MAX_TOKEN_BYTES ||
    hasControlCharacters(value.token)
  ) return null
  const url = parseSafeHttpsUrl(value.url)
  if (!url || !allowedUrls.has(url.href)) return null
  return { token: value.token, url: url.href }
}

function notificationConfiguration(
  env: FarcasterWebhookEnv,
): {
  deliveryUrls: ReadonlySet<string>
  encryptionKey: string
  hubApiKey: string
  hubUrl: string
} | null {
  const encryptionKey = env.FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1?.trim()
  const hubApiKey = env.FARCASTER_HUB_API_KEY?.trim()
  const hubUrl = parseSafeHttpsUrl(env.FARCASTER_HUB_URL ?? '')
  const rawDeliveryUrls = env.FARCASTER_NOTIFICATION_DELIVERY_URLS
  if (
    !encryptionKey ||
    !hubApiKey ||
    hubApiKey.length > 1_024 ||
    !hubUrl ||
    hubUrl.pathname !== '/' ||
    hubUrl.search !== '' ||
    !rawDeliveryUrls
  ) return null

  const deliveryUrls = new Set<string>()
  for (const rawValue of rawDeliveryUrls.split(',')) {
    const value = rawValue.trim()
    const url = parseSafeHttpsUrl(value)
    if (!value || !url) return null
    deliveryUrls.add(url.href)
  }
  if (deliveryUrls.size === 0) return null

  return {
    deliveryUrls,
    encryptionKey,
    hubApiKey,
    hubUrl: hubUrl.origin,
  }
}

function parseCanonicalOrigin(value: string): URL | null {
  const url = parseSafeHttpsUrl(value)
  if (!url || url.pathname !== '/' || url.search !== '') return null
  return url
}

function webhookDomain(requestUrl: URL, env: FarcasterWebhookEnv): string | null {
  if (env.APP_ENV === 'production') {
    const canonicalOrigin = parseCanonicalOrigin(env.CANONICAL_ORIGIN)
    return canonicalOrigin && requestUrl.origin === canonicalOrigin.origin
      ? canonicalOrigin.hostname
      : null
  }
  if (requestUrl.protocol === 'https:') return requestUrl.hostname
  if (
    requestUrl.protocol === 'http:' &&
    (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1')
  ) return requestUrl.hostname
  return null
}

function parseSafeHttpsUrl(value: string): URL | null {
  if (!value || value !== value.trim()) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== ''
    ) return null
    return url
  } catch {
    return null
  }
}

async function readJsonBody(request: Request): Promise<
  | { status: 'invalid' | 'too-large' }
  | { status: 'valid'; value: unknown }
> {
  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return { status: 'invalid' }
    }
    if (contentLength > BODY_LIMIT_BYTES) return { status: 'too-large' }
  }
  if (!request.body) return { status: 'invalid' }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > BODY_LIMIT_BYTES) {
        await reader.cancel()
        return { status: 'too-large' }
      }
      chunks.push(value)
    }
    if (length === 0) return { status: 'invalid' }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return {
      status: 'valid',
      value: JSON.parse(new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: false,
      }).decode(bytes)),
    }
  } catch {
    return { status: 'invalid' }
  }
}

function isInvalidWebhookError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) return false
  return error.name === 'VerifyJsonFarcasterSignature.InvalidDataError' ||
    error.name === 'VerifyJsonFarcasterSignature.InvalidAppKeyError' ||
    error.name === 'VerifyJsonFarcasterSignature.InvalidEventDataError'
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { headers: responseHeaders, status })
}
