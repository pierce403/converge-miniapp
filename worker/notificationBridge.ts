import {
  decryptNotificationDetails,
  type EncryptedNotificationDetails,
} from './notificationCrypto.js'

const CALLBACK_BODY_LIMIT_BYTES = 4_096
const CALLBACK_MAX_AGE_SECONDS = 300
const CALLBACK_LEASE_SECONDS = 60
const PROXY_BODY_LIMIT_BYTES = 256 * 1_024
const UPSTREAM_BODY_LIMIT_BYTES = 64 * 1_024
const UPSTREAM_TIMEOUT_MS = 8_000
const FARCASTER_TIMEOUT_MS = 8_000
const MAX_TOPICS = 400
const MAX_HMAC_KEYS_PER_TOPIC = 16
const MAX_PERSISTED_TOPIC_ROWS = 800
const MAX_FARCASTER_TOKENS = 100
const DELIVERY_RETENTION_SECONDS = 7 * 24 * 60 * 60

const BASE64URL = /^[A-Za-z0-9_-]+$/u
const CALLBACK_IDENTIFIER = /^[A-Za-z0-9_-]{8,120}$/u
const HEX_32 = /^[0-9a-f]{64}$/u
const GROUP_TOPIC = /^\/xmtp\/mls\/1\/g-[0-9a-f]{32}\/proto$/u
const VAPID_TICKET = /^vpxet1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u

const responseHeaders = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
}

export type NotificationBridgeEnv = {
  APP_ENV: string
  CANONICAL_ORIGIN: string
  FARCASTER_HUB_API_KEY?: string
  FARCASTER_HUB_URL?: string
  FARCASTER_NOTIFICATION_DELIVERY_URLS?: string
  FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1?: string
  IDENTITY_RATE_LIMITER?: RateLimit
  PREFERENCES?: D1Database
  VAPID_PARTY_APP_ID?: string
  VAPID_PARTY_APP_SECRET?: string
  VAPID_PARTY_ORIGIN?: string
  VAPID_PARTY_PUBLIC_KEY?: string
}

type BridgeConfiguration = {
  appId: string
  appSecret: string
  callbackPublicKey: string
  callbackUrl: string
  canonicalDomain: string
  canonicalOrigin: string
  deliveryUrls: ReadonlySet<string>
  encryptionKey: string
  vapidPartyOrigin: string
}

type XmtpHmacKey = {
  epoch: number
  key: string
}

type XmtpTopic = {
  hmacKeys: XmtpHmacKey[]
  topic: string
}

type RegistrationIdentity = {
  inboxId: string
  installationId: string
}

type XmtpCallbackRegistration = {
  delivery: {
    kind: 'https_callback'
    url: string
  }
  identity: RegistrationIdentity
  notification: {
    inboxHandle: string
  }
  preferences: {
    minimalPayloadOnly: true
    plaintextPreview: false
  }
  registeredAt: string
  version: 1
  xmtp: {
    env: 'production'
    topicSource: 'conversations.hmacKeys'
    topics: XmtpTopic[]
  }
}

type RequestedXmtpRegistration = {
  identity: RegistrationIdentity
  registeredAt: string
  version: 1
  xmtp: Pick<XmtpCallbackRegistration['xmtp'], 'env' | 'topics'>
}

type NotificationSubscriptionRow = {
  app_fid: number
  details_ciphertext: string
  details_nonce: string
  fid: number
  key_version: number
}

type DeliveryRow = {
  inbox_handle: string
  lease_expires_at: number
  status: string
}

export type NotificationBridgeDependencies = {
  decryptNotificationDetails: typeof decryptNotificationDetails
  fetch: typeof fetch
  now: () => number
  randomBytes: (length: number) => Uint8Array
  verifyCallbackSignature: typeof verifyVapidPartySignature
}

const defaultDependencies: NotificationBridgeDependencies = {
  decryptNotificationDetails,
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  verifyCallbackSignature: verifyVapidPartySignature,
}

export function notificationBridgeConfigured(
  env: NotificationBridgeEnv,
): boolean {
  return notificationBridgeConfiguration(env) !== null
}

export async function handleNotificationUserApi(
  request: Request,
  env: NotificationBridgeEnv,
  fid: number,
  dependencies: NotificationBridgeDependencies = defaultDependencies,
): Promise<Response> {
  const configuration = notificationBridgeConfiguration(env)
  if (!configuration || !env.PREFERENCES) {
    return jsonError('notification_unavailable', 503)
  }
  const url = new URL(request.url)
  if (url.origin !== configuration.canonicalOrigin || url.search !== '') {
    return jsonError('not_found', 404)
  }
  let allowed: boolean
  try {
    const outcome = await env.IDENTITY_RATE_LIMITER?.limit({
      key: `${env.APP_ENV}:notification-enrollment:fid:${fid}`,
    })
    allowed = outcome?.success === true
  } catch {
    return jsonError('notification_unavailable', 503)
  }
  if (!allowed) {
    return Response.json(
      { error: 'rate_limited' },
      { headers: { ...responseHeaders, 'retry-after': '60' }, status: 429 },
    )
  }

  if (url.pathname === '/api/me/notifications/xmtp-ticket') {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const parsed = await readJsonRequest(request, PROXY_BODY_LIMIT_BYTES)
    if (parsed.status === 'too-large') return jsonError('invalid_request', 413)
    if (parsed.status !== 'valid') return jsonError('invalid_request', 400)
    const requested = parseTicketRegistration(parsed.value, dependencies.now())
    if (!requested) return jsonError('invalid_request', 400)

    try {
      const nativeSubscription = await env.PREFERENCES.prepare(`
        SELECT 1 AS active
        FROM farcaster_notification_subscriptions
        WHERE fid = ?1
        LIMIT 1
      `).bind(fid).first<{ active: number }>()
      if (nativeSubscription?.active !== 1) {
        return Response.json(
          { error: 'notification_token_pending' },
          {
            headers: { ...responseHeaders, 'retry-after': '2' },
            status: 425,
          },
        )
      }
      const inboxHandle = await getOrCreateInboxHandle(
        env.PREFERENCES,
        fid,
        dependencies,
      )
      const registration = completeRegistration(
        requested,
        inboxHandle,
        configuration,
        dependencies.now(),
      )
      const upstream = await fetchJson(
        `${configuration.vapidPartyOrigin}/api/apps/${encodeURIComponent(configuration.appId)}/xmtp/enrollment-ticket`,
        {
          body: JSON.stringify({ registration }),
          headers: {
            'content-type': 'application/json',
            'x-api-key': configuration.appSecret,
          },
          method: 'POST',
        },
        dependencies,
      )
      if (!upstream.ok) return upstreamResponse(upstream)
      const ticket = acceptedTicketResponse(upstream.body)
      if (!ticket) return jsonError('notification_unavailable', 503)
      return Response.json({
        expiresAt: ticket.expiresAt,
        registration,
        ticket: ticket.token,
      }, { headers: responseHeaders })
    } catch {
      return jsonError('notification_unavailable', 503)
    }
  }

  if (url.pathname === '/api/me/notifications/xmtp-subscription') {
    if (request.method === 'POST') {
      return submitXmtpSubscription(
        request,
        env.PREFERENCES,
        fid,
        configuration,
        dependencies,
      )
    }
    if (request.method === 'DELETE') {
      try {
        await revokeNotificationRoute(env, fid, dependencies)
        return Response.json({ disabled: true }, { headers: responseHeaders })
      } catch {
        return jsonError('notification_unavailable', 503)
      }
    }
    return methodNotAllowed('POST, DELETE')
  }

  return jsonError('not_found', 404)
}

export async function handleXmtpNotificationCallback(
  request: Request,
  env: NotificationBridgeEnv,
  dependencies: NotificationBridgeDependencies = defaultDependencies,
): Promise<Response> {
  const configuration = notificationBridgeConfiguration(env)
  if (!configuration || !env.PREFERENCES) {
    return jsonError('notification_unavailable', 503)
  }
  const requestUrl = new URL(request.url)
  if (
    requestUrl.origin !== configuration.canonicalOrigin ||
    requestUrl.pathname !== '/api/internal/xmtp-notification' ||
    requestUrl.search !== ''
  ) return jsonError('not_found', 404)
  if (request.method !== 'POST') return methodNotAllowed('POST')
  if (mediaType(request) !== 'application/json') {
    return jsonError('invalid_request', 415)
  }

  const appId = request.headers.get('vapid-party-app-id')
  const deliveryId = request.headers.get('vapid-party-delivery-id')
  const timestamp = request.headers.get('vapid-party-timestamp')
  const signatureHeader = request.headers.get('vapid-party-signature')
  if (
    appId !== configuration.appId ||
    !deliveryId ||
    !CALLBACK_IDENTIFIER.test(deliveryId) ||
    !timestamp ||
    !/^\d{10}$/u.test(timestamp) ||
    !signatureHeader?.startsWith('v1=')
  ) return jsonError('unauthorized', 401)
  const timestampSeconds = Number(timestamp)
  const nowSeconds = Math.floor(dependencies.now() / 1_000)
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > CALLBACK_MAX_AGE_SECONDS
  ) return jsonError('unauthorized', 401)

  const rawBody = await readBody(request, CALLBACK_BODY_LIMIT_BYTES)
  if (rawBody.status === 'too-large') return jsonError('invalid_request', 413)
  if (rawBody.status !== 'valid') return jsonError('invalid_request', 400)
  let signature: Uint8Array
  try {
    signature = decodeBase64Url(signatureHeader.slice(3))
  } catch {
    return jsonError('unauthorized', 401)
  }
  if (signature.byteLength !== 64) return jsonError('unauthorized', 401)

  let verified: boolean
  try {
    verified = await dependencies.verifyCallbackSignature(
      configuration.callbackPublicKey,
      signature,
      callbackSignedBytes(timestamp, deliveryId, rawBody.value),
    )
  } catch {
    return jsonError('notification_unavailable', 503)
  }
  if (!verified) return jsonError('unauthorized', 401)

  const event = parseCallbackEvent(rawBody.value)
  if (!event || event.deliveryId !== deliveryId) {
    return jsonError('invalid_request', 400)
  }

  let route: { fid: number; state: string } | null
  try {
    route = await env.PREFERENCES.prepare(`
      SELECT fid, state
      FROM xmtp_notification_routes
      WHERE inbox_handle = ?1
    `).bind(event.inboxHandle).first<{ fid: number; state: string }>()
  } catch {
    return jsonError('notification_unavailable', 503)
  }
  if (
    !route ||
    route.state !== 'active' ||
    !Number.isSafeInteger(route.fid) ||
    route.fid <= 0
  ) {
    return jsonError('notification_route_gone', 410)
  }

  let claim: 'busy' | 'claimed' | 'delivered' | 'mismatch'
  try {
    claim = await claimDelivery(
      env.PREFERENCES,
      deliveryId,
      event.inboxHandle,
      nowSeconds,
    )
  } catch {
    return jsonError('notification_unavailable', 503)
  }
  if (claim === 'delivered') return new Response(null, { status: 204 })
  if (claim === 'mismatch') return jsonError('delivery_conflict', 409)
  if (claim === 'busy') {
    return Response.json(
      { error: 'delivery_in_progress' },
      { headers: { ...responseHeaders, 'retry-after': '15' }, status: 425 },
    )
  }

  try {
    const delivery = await deliverFarcasterNotification(
      env.PREFERENCES,
      route.fid,
      event.inboxHandle,
      deliveryId,
      configuration,
      dependencies,
    )
    if (delivery === 'route-gone') {
      return jsonError('notification_route_gone', 410)
    }
    await markDeliveryComplete(env.PREFERENCES, deliveryId, nowSeconds)
    return new Response(null, { status: 204 })
  } catch (error) {
    try {
      await markDeliveryRetry(env.PREFERENCES, deliveryId, nowSeconds)
    } catch {
      return jsonError('notification_unavailable', 503)
    }
    if (error instanceof RetryableDeliveryError && error.status === 429) {
      return Response.json(
        { error: 'notification_rate_limited' },
        {
          headers: {
            ...responseHeaders,
            'retry-after': String(error.retryAfterSeconds ?? 30),
          },
          status: 429,
        },
      )
    }
    return jsonError('notification_unavailable', 503)
  }
}

export async function verifyVapidPartySignature(
  encodedPublicKey: string,
  signature: Uint8Array,
  signedBytes: Uint8Array,
): Promise<boolean> {
  const publicKeyBytes = decodeBase64Url(encodedPublicKey)
  if (publicKeyBytes.byteLength !== 65 || publicKeyBytes[0] !== 4) {
    throw new Error('Invalid VAPID public key.')
  }
  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    { hash: 'SHA-256', name: 'ECDSA' },
    publicKey,
    signature,
    signedBytes,
  )
}

async function submitXmtpSubscription(
  request: Request,
  database: D1Database,
  fid: number,
  configuration: BridgeConfiguration,
  dependencies: NotificationBridgeDependencies,
): Promise<Response> {
  const parsed = await readJsonRequest(request, PROXY_BODY_LIMIT_BYTES)
  if (parsed.status === 'too-large') return jsonError('invalid_request', 413)
  if (parsed.status !== 'valid') return jsonError('invalid_request', 400)
  if (!isExactRecord(parsed.value, ['proof', 'registration', 'ticket'])) {
    return jsonError('invalid_request', 400)
  }
  const ticket = parsed.value.ticket
  const proof = parsed.value.proof
  const registration = parseCompleteRegistration(
    parsed.value.registration,
    configuration,
  )
  if (
    typeof ticket !== 'string' ||
    ticket.length > 4_096 ||
    !VAPID_TICKET.test(ticket) ||
    !isExactRecord(proof, ['publicKey', 'signature']) ||
    typeof proof.publicKey !== 'string' ||
    typeof proof.signature !== 'string'
  ) return jsonError('invalid_request', 400)

  let publicKey: Uint8Array
  let signature: Uint8Array
  try {
    publicKey = decodeBase64Url(proof.publicKey)
    signature = decodeBase64Url(proof.signature)
  } catch {
    return jsonError('invalid_request', 400)
  }
  if (
    !registration ||
    publicKey.byteLength !== 32 ||
    signature.byteLength !== 64 ||
    bytesToHex(publicKey) !== registration.identity.installationId
  ) return jsonError('invalid_request', 400)
  const routeOwned = await ownsInboxHandle(
    database,
    fid,
    registration.notification.inboxHandle,
  )
  if (!routeOwned) return jsonError('notification_route_gone', 410)

  try {
    const upstream = await fetchJson(
      `${configuration.vapidPartyOrigin}/api/apps/${encodeURIComponent(configuration.appId)}/xmtp/subscriptions`,
      {
        body: JSON.stringify({
          proof: {
            publicKey: proof.publicKey,
            signature: proof.signature,
          },
          registration: parsed.value.registration,
        }),
        headers: {
          authorization: `Bearer ${ticket}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
      dependencies,
    )
    if (!upstream.ok) return upstreamResponse(upstream)
    if (!acceptedSubscriptionResponse(upstream.body)) {
      return jsonError('notification_unavailable', 503)
    }
    const stillOwned = await ownsInboxHandle(
      database,
      fid,
      registration.notification.inboxHandle,
    )
    if (!stillOwned) {
      await revokeVapidPartyHandle(
        configuration,
        registration.notification.inboxHandle,
        dependencies,
      )
      return jsonError('notification_route_gone', 410)
    }
    return Response.json({ registered: true }, { headers: responseHeaders })
  } catch {
    return jsonError('notification_unavailable', 503)
  }
}

export async function revokeNotificationRoute(
  env: NotificationBridgeEnv,
  fid: number,
  dependencies: NotificationBridgeDependencies = defaultDependencies,
): Promise<boolean> {
  if (!env.PREFERENCES) throw new Error('Notification storage is unavailable.')
  const route = await env.PREFERENCES.prepare(`
    SELECT inbox_handle, state
    FROM xmtp_notification_routes
    WHERE fid = ?1
  `).bind(fid).first<{ inbox_handle: string; state: string }>()
  if (!route) return false
  const configuration = notificationBridgeConfiguration(env)
  if (!configuration) throw new Error('Notification bridge is not configured.')
  await env.PREFERENCES.prepare(`
    UPDATE xmtp_notification_routes
    SET state = 'revoking', updated_at = unixepoch()
    WHERE fid = ?1 AND inbox_handle = ?2
  `).bind(fid, route.inbox_handle).run()
  await revokeVapidPartyHandle(configuration, route.inbox_handle, dependencies)
  await env.PREFERENCES.prepare(`
    DELETE FROM xmtp_notification_routes
    WHERE fid = ?1 AND inbox_handle = ?2 AND state = 'revoking'
  `).bind(fid, route.inbox_handle).run()
  return true
}

async function revokeVapidPartyHandle(
  configuration: BridgeConfiguration,
  inboxHandle: string,
  dependencies: NotificationBridgeDependencies,
): Promise<void> {
  const upstream = await fetchJson(
    `${configuration.vapidPartyOrigin}/api/apps/${encodeURIComponent(configuration.appId)}/xmtp/callback-routes`,
    {
      body: JSON.stringify({ inboxHandle }),
      headers: {
        'content-type': 'application/json',
        'x-api-key': configuration.appSecret,
      },
      method: 'DELETE',
    },
    dependencies,
  )
  if (!upstream.ok || !acceptedCallbackRouteRevocation(upstream.body)) {
    throw new Error('vapid.party did not revoke the callback route.')
  }
}

function notificationBridgeConfiguration(
  env: NotificationBridgeEnv,
): BridgeConfiguration | null {
  if (
    env.APP_ENV !== 'production' ||
    !env.PREFERENCES ||
    !env.IDENTITY_RATE_LIMITER
  ) return null
  const canonicalOrigin = parseSafeOrigin(env.CANONICAL_ORIGIN)
  const vapidPartyOrigin = parseSafeOrigin(env.VAPID_PARTY_ORIGIN ?? '')
  const hubOrigin = parseSafeOrigin(env.FARCASTER_HUB_URL ?? '')
  const appId = env.VAPID_PARTY_APP_ID?.trim()
  const appSecret = env.VAPID_PARTY_APP_SECRET?.trim()
  const callbackPublicKey = env.VAPID_PARTY_PUBLIC_KEY?.trim()
  const encryptionKey = env.FARCASTER_NOTIFICATION_ENCRYPTION_KEY_V1?.trim()
  const hubApiKey = env.FARCASTER_HUB_API_KEY?.trim()
  const rawDeliveryUrls = env.FARCASTER_NOTIFICATION_DELIVERY_URLS
  if (
    !canonicalOrigin ||
    !vapidPartyOrigin ||
    !hubOrigin ||
    !appId ||
    !CALLBACK_IDENTIFIER.test(appId) ||
    !appSecret ||
    appSecret.length > 4_096 ||
    hasControlCharacters(appSecret) ||
    !callbackPublicKey ||
    !encryptionKey ||
    !hubApiKey ||
    hubApiKey.length > 1_024 ||
    !rawDeliveryUrls
  ) return null
  try {
    const encryptionKeyBytes = decodeBase64Url(encryptionKey)
    const callbackKeyBytes = decodeBase64Url(callbackPublicKey)
    if (
      encryptionKeyBytes.byteLength !== 32 ||
      callbackKeyBytes.byteLength !== 65 ||
      callbackKeyBytes[0] !== 4
    ) return null
  } catch {
    return null
  }

  const deliveryUrls = new Set<string>()
  for (const rawValue of rawDeliveryUrls.split(',')) {
    const deliveryUrl = parseSafeHttpsUrl(rawValue.trim())
    if (!deliveryUrl) return null
    deliveryUrls.add(deliveryUrl.href)
  }
  if (deliveryUrls.size === 0) return null

  return {
    appId,
    appSecret,
    callbackPublicKey,
    callbackUrl: `${canonicalOrigin}/api/internal/xmtp-notification`,
    canonicalDomain: new URL(canonicalOrigin).hostname,
    canonicalOrigin,
    deliveryUrls,
    encryptionKey,
    vapidPartyOrigin,
  }
}

function parseTicketRegistration(
  value: unknown,
  now: number,
): RequestedXmtpRegistration | null {
  if (!isExactRecord(value, ['registration'])) return null
  const registration = value.registration
  if (!isExactRecord(registration, ['identity', 'registeredAt', 'version', 'xmtp'])) {
    return null
  }
  const identity = parseIdentity(registration.identity)
  const xmtp = parseRequestedXmtp(registration.xmtp, identity?.installationId)
  if (
    registration.version !== 1 ||
    !identity ||
    !xmtp ||
    typeof registration.registeredAt !== 'string' ||
    !parseIsoDate(registration.registeredAt)
  ) return null
  return {
    identity,
    registeredAt: new Date(now).toISOString(),
    version: 1,
    xmtp,
  }
}

function completeRegistration(
  requested: RequestedXmtpRegistration,
  inboxHandle: string,
  configuration: BridgeConfiguration,
  now: number,
): XmtpCallbackRegistration {
  return {
    delivery: {
      kind: 'https_callback',
      url: configuration.callbackUrl,
    },
    identity: requested.identity,
    notification: { inboxHandle },
    preferences: {
      minimalPayloadOnly: true,
      plaintextPreview: false,
    },
    registeredAt: new Date(now).toISOString(),
    version: 1,
    xmtp: {
      env: 'production',
      topicSource: 'conversations.hmacKeys',
      topics: requested.xmtp.topics,
    },
  }
}

function parseCompleteRegistration(
  value: unknown,
  configuration: BridgeConfiguration,
): XmtpCallbackRegistration | null {
  if (!isExactRecord(value, [
    'delivery',
    'identity',
    'notification',
    'preferences',
    'registeredAt',
    'version',
    'xmtp',
  ])) return null
  const identity = parseIdentity(value.identity)
  if (!identity || value.version !== 1) return null
  if (
    !isExactRecord(value.delivery, ['kind', 'url']) ||
    value.delivery.kind !== 'https_callback' ||
    value.delivery.url !== configuration.callbackUrl ||
    !isExactRecord(value.notification, ['inboxHandle']) ||
    typeof value.notification.inboxHandle !== 'string' ||
    !CALLBACK_IDENTIFIER.test(value.notification.inboxHandle) ||
    !isExactRecord(value.preferences, ['minimalPayloadOnly', 'plaintextPreview']) ||
    value.preferences.minimalPayloadOnly !== true ||
    value.preferences.plaintextPreview !== false ||
    typeof value.registeredAt !== 'string' ||
    !parseIsoDate(value.registeredAt) ||
    !isExactRecord(value.xmtp, ['env', 'topicSource', 'topics']) ||
    value.xmtp.env !== 'production' ||
    value.xmtp.topicSource !== 'conversations.hmacKeys'
  ) return null
  const xmtp = parseRequestedXmtp(
    { env: value.xmtp.env, topics: value.xmtp.topics },
    identity.installationId,
  )
  if (!xmtp) return null
  return {
    delivery: { kind: 'https_callback', url: configuration.callbackUrl },
    identity,
    notification: { inboxHandle: value.notification.inboxHandle },
    preferences: { minimalPayloadOnly: true, plaintextPreview: false },
    registeredAt: value.registeredAt,
    version: 1,
    xmtp: {
      env: 'production',
      topicSource: 'conversations.hmacKeys',
      topics: xmtp.topics,
    },
  }
}

function parseIdentity(value: unknown): RegistrationIdentity | null {
  if (
    !isExactRecord(value, ['inboxId', 'installationId']) ||
    typeof value.inboxId !== 'string' ||
    !HEX_32.test(value.inboxId) ||
    typeof value.installationId !== 'string' ||
    !HEX_32.test(value.installationId)
  ) return null
  return {
    inboxId: value.inboxId,
    installationId: value.installationId,
  }
}

function parseRequestedXmtp(
  value: unknown,
  installationId: string | undefined,
): Pick<XmtpCallbackRegistration['xmtp'], 'env' | 'topics'> | null {
  if (
    !installationId ||
    !isExactRecord(value, ['env', 'topics']) ||
    value.env !== 'production' ||
    !Array.isArray(value.topics) ||
    value.topics.length === 0 ||
    value.topics.length > MAX_TOPICS
  ) return null

  const topics: XmtpTopic[] = []
  const seenTopics = new Set<string>()
  let welcomeTopics = 0
  let persistedRows = 0
  const expectedWelcomeTopic = `/xmtp/mls/1/w-${installationId}/proto`

  for (const candidate of value.topics) {
    if (
      !isExactRecord(candidate, ['hmacKeys', 'topic']) ||
      typeof candidate.topic !== 'string' ||
      seenTopics.has(candidate.topic) ||
      !Array.isArray(candidate.hmacKeys) ||
      candidate.hmacKeys.length > MAX_HMAC_KEYS_PER_TOPIC
    ) return null
    seenTopics.add(candidate.topic)

    const isWelcome = candidate.topic === expectedWelcomeTopic
    if (isWelcome) welcomeTopics += 1
    if (
      (!isWelcome && !GROUP_TOPIC.test(candidate.topic)) ||
      (isWelcome && candidate.hmacKeys.length !== 0) ||
      (!isWelcome && candidate.hmacKeys.length === 0)
    ) return null

    const epochs = new Set<number>()
    const hmacKeys: XmtpHmacKey[] = []
    for (const key of candidate.hmacKeys) {
      if (
        !isExactRecord(key, ['epoch', 'key']) ||
        typeof key.epoch !== 'number' ||
        !Number.isSafeInteger(key.epoch) ||
        key.epoch < 0 ||
        key.epoch > 0xffff_ffff ||
        epochs.has(key.epoch) ||
        typeof key.key !== 'string'
      ) return null
      let bytes: Uint8Array
      try {
        bytes = decodeBase64Url(key.key)
      } catch {
        return null
      }
      if (bytes.byteLength === 0 || bytes.byteLength > 256) return null
      epochs.add(key.epoch)
      hmacKeys.push({ epoch: key.epoch, key: key.key })
    }
    hmacKeys.sort((left, right) => left.epoch - right.epoch)
    topics.push({ hmacKeys, topic: candidate.topic })
    persistedRows += 1 + hmacKeys.length
    if (persistedRows > MAX_PERSISTED_TOPIC_ROWS) return null
  }
  if (welcomeTopics !== 1) return null
  topics.sort((left, right) => {
    if (left.topic === expectedWelcomeTopic) return 1
    if (right.topic === expectedWelcomeTopic) return -1
    return left.topic.localeCompare(right.topic)
  })
  return { env: 'production', topics }
}

function parseCallbackEvent(rawBody: Uint8Array): {
  deliveryId: string
  inboxHandle: string
} | null {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false,
    }).decode(rawBody))
  } catch {
    return null
  }
  if (
    !isExactRecord(value, ['deliveryId', 'inboxHandle', 'type', 'version']) ||
    value.version !== 1 ||
    value.type !== 'xmtp.message_available' ||
    typeof value.deliveryId !== 'string' ||
    !CALLBACK_IDENTIFIER.test(value.deliveryId) ||
    typeof value.inboxHandle !== 'string' ||
    !CALLBACK_IDENTIFIER.test(value.inboxHandle)
  ) return null
  return { deliveryId: value.deliveryId, inboxHandle: value.inboxHandle }
}

async function getOrCreateInboxHandle(
  database: D1Database,
  fid: number,
  dependencies: NotificationBridgeDependencies,
): Promise<string> {
  const existing = await database.prepare(`
    SELECT inbox_handle, state
    FROM xmtp_notification_routes
    WHERE fid = ?1
  `).bind(fid).first<{ inbox_handle: string; state: string }>()
  if (
    existing &&
    existing.state === 'active' &&
    CALLBACK_IDENTIFIER.test(existing.inbox_handle)
  ) {
    return existing.inbox_handle
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inboxHandle = encodeBase64Url(dependencies.randomBytes(32))
    await database.prepare(`
      INSERT OR IGNORE INTO xmtp_notification_routes (
        inbox_handle,
        fid,
        state,
        created_at,
        updated_at
      ) VALUES (?1, ?2, 'active', unixepoch(), unixepoch())
    `).bind(inboxHandle, fid).run()
    const stored = await database.prepare(`
      SELECT inbox_handle, state
      FROM xmtp_notification_routes
      WHERE fid = ?1
    `).bind(fid).first<{ inbox_handle: string; state: string }>()
    if (
      stored &&
      stored.state === 'active' &&
      CALLBACK_IDENTIFIER.test(stored.inbox_handle)
    ) {
      return stored.inbox_handle
    }
  }
  throw new Error('Could not allocate a notification route.')
}

async function ownsInboxHandle(
  database: D1Database,
  fid: number,
  inboxHandle: string,
): Promise<boolean> {
  const row = await database.prepare(`
    SELECT 1 AS owned
    FROM xmtp_notification_routes
    WHERE fid = ?1 AND inbox_handle = ?2 AND state = 'active'
  `).bind(fid, inboxHandle).first<{ owned: number }>()
  return row?.owned === 1
}

async function claimDelivery(
  database: D1Database,
  deliveryId: string,
  inboxHandle: string,
  nowSeconds: number,
): Promise<'busy' | 'claimed' | 'delivered' | 'mismatch'> {
  const insertion = await database.prepare(`
    INSERT OR IGNORE INTO xmtp_notification_deliveries (
      delivery_id,
      inbox_handle,
      status,
      attempt_count,
      lease_expires_at,
      created_at,
      updated_at
    ) VALUES (?1, ?2, 'processing', 1, ?3, unixepoch(), unixepoch())
  `).bind(
    deliveryId,
    inboxHandle,
    nowSeconds + CALLBACK_LEASE_SECONDS,
  ).run()
  if ((insertion.meta.changes ?? 0) > 0) return 'claimed'

  const row = await database.prepare(`
    SELECT inbox_handle, status, lease_expires_at
    FROM xmtp_notification_deliveries
    WHERE delivery_id = ?1
  `).bind(deliveryId).first<DeliveryRow>()
  if (!row) throw new Error('Delivery claim disappeared.')
  if (row.inbox_handle !== inboxHandle) return 'mismatch'
  if (row.status === 'delivered') return 'delivered'
  if (row.status === 'processing' && row.lease_expires_at > nowSeconds) {
    return 'busy'
  }

  const claim = await database.prepare(`
    UPDATE xmtp_notification_deliveries
    SET
      status = 'processing',
      attempt_count = attempt_count + 1,
      lease_expires_at = ?2,
      updated_at = unixepoch()
    WHERE delivery_id = ?1
      AND status != 'delivered'
      AND (status = 'retry' OR lease_expires_at <= ?3)
  `).bind(
    deliveryId,
    nowSeconds + CALLBACK_LEASE_SECONDS,
    nowSeconds,
  ).run()
  return (claim.meta.changes ?? 0) > 0 ? 'claimed' : 'busy'
}

async function markDeliveryComplete(
  database: D1Database,
  deliveryId: string,
  nowSeconds: number,
): Promise<void> {
  await database.batch([
    database.prepare(`
      UPDATE xmtp_notification_deliveries
      SET status = 'delivered', lease_expires_at = 0, updated_at = unixepoch()
      WHERE delivery_id = ?1
    `).bind(deliveryId),
    database.prepare(`
      DELETE FROM xmtp_notification_deliveries
      WHERE status IN ('delivered', 'retry') AND updated_at < ?1
    `).bind(nowSeconds - DELIVERY_RETENTION_SECONDS),
  ])
}

async function markDeliveryRetry(
  database: D1Database,
  deliveryId: string,
  nowSeconds: number,
): Promise<void> {
  await database.batch([
    database.prepare(`
      UPDATE xmtp_notification_deliveries
      SET status = 'retry', lease_expires_at = ?2, updated_at = unixepoch()
      WHERE delivery_id = ?1
    `).bind(deliveryId, nowSeconds),
    database.prepare(`
      DELETE FROM xmtp_notification_deliveries
      WHERE status = 'retry'
        AND delivery_id != ?1
        AND updated_at < ?2
    `).bind(deliveryId, nowSeconds - DELIVERY_RETENTION_SECONDS),
  ])
}

async function deliverFarcasterNotification(
  database: D1Database,
  fid: number,
  inboxHandle: string,
  deliveryId: string,
  configuration: BridgeConfiguration,
  dependencies: NotificationBridgeDependencies,
): Promise<'delivered' | 'route-gone'> {
  const result = await database.prepare(`
    SELECT
      fid,
      app_fid,
      details_ciphertext,
      details_nonce,
      key_version
    FROM farcaster_notification_subscriptions
    WHERE fid = ?1
    ORDER BY app_fid ASC
  `).bind(fid).all<NotificationSubscriptionRow>()
  if (!result.success) throw new Error('Could not read notification tokens.')
  if (result.results.length === 0) {
    await database.prepare(`
      DELETE FROM xmtp_notification_routes
      WHERE fid = ?1 AND inbox_handle = ?2
    `).bind(fid, inboxHandle).run()
    return 'route-gone'
  }

  const groups = new Map<string, Map<string, NotificationSubscriptionRow[]>>()
  for (const row of result.results) {
    const encrypted: EncryptedNotificationDetails = {
      ciphertext: row.details_ciphertext,
      keyVersion: row.key_version,
      nonce: row.details_nonce,
    }
    const details = await dependencies.decryptNotificationDetails(
      encrypted,
      configuration.encryptionKey,
      {
        appFid: row.app_fid,
        canonicalDomain: configuration.canonicalDomain,
        fid: row.fid,
      },
    )
    if (!configuration.deliveryUrls.has(details.url)) {
      throw new Error('Stored notification URL is no longer allowlisted.')
    }
    const tokens = groups.get(details.url) ?? new Map()
    const rows = tokens.get(details.token) ?? []
    rows.push(row)
    tokens.set(details.token, rows)
    groups.set(details.url, tokens)
  }

  for (const [url, tokenRows] of groups) {
    const tokens = [...tokenRows.keys()]
    for (let offset = 0; offset < tokens.length; offset += MAX_FARCASTER_TOKENS) {
      const batch = tokens.slice(offset, offset + MAX_FARCASTER_TOKENS)
      const outcome = await sendFarcasterNotificationBatch(
        url,
        batch,
        deliveryId,
        configuration,
        dependencies,
      )
      if (outcome.invalidTokens.length > 0) {
        const statements: D1PreparedStatement[] = []
        for (const invalidToken of outcome.invalidTokens) {
          for (const row of tokenRows.get(invalidToken) ?? []) {
            statements.push(database.prepare(`
              DELETE FROM farcaster_notification_subscriptions
              WHERE fid = ?1 AND app_fid = ?2
            `).bind(row.fid, row.app_fid))
          }
        }
        if (statements.length > 0) {
          statements.push(database.prepare(`
            DELETE FROM xmtp_notification_routes
            WHERE fid = ?1
              AND NOT EXISTS (
                SELECT 1
                FROM farcaster_notification_subscriptions
                WHERE fid = ?1
              )
          `).bind(fid))
          await database.batch(statements)
        }
      }
      if (outcome.rateLimitedTokens.length > 0) {
        throw new RetryableDeliveryError(429, outcome.retryAfterSeconds)
      }
    }
  }
  const remaining = await database.prepare(`
    SELECT 1 AS active
    FROM farcaster_notification_subscriptions
    WHERE fid = ?1
    LIMIT 1
  `).bind(fid).first<{ active: number }>()
  if (remaining?.active !== 1) return 'route-gone'
  return 'delivered'
}

async function sendFarcasterNotificationBatch(
  url: string,
  tokens: string[],
  deliveryId: string,
  configuration: BridgeConfiguration,
  dependencies: NotificationBridgeDependencies,
): Promise<{
  invalidTokens: string[]
  rateLimitedTokens: string[]
  retryAfterSeconds?: number
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FARCASTER_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await dependencies.fetch(url, {
        body: JSON.stringify({
          body: 'Open Converge Mini to read it.',
          notificationId: `xmtp.${deliveryId}`,
          targetUrl: `${configuration.canonicalOrigin}/`,
          title: 'New Converge message',
          tokens,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch (error) {
      throw new RetryableDeliveryError(503, undefined, { cause: error })
    }

    if (response.status !== 200) {
      const retryAfter = retryAfterSeconds(response.headers.get('retry-after'))
      throw new RetryableDeliveryError(
        response.status === 429 ? 429 : 503,
        retryAfter,
      )
    }
    const body = await readJsonResponse(response, UPSTREAM_BODY_LIMIT_BYTES)
    if (!isRecord(body)) throw new RetryableDeliveryError(503)
    const successfulTokens = stringArray(body.successfulTokens)
    const invalidTokens = stringArray(body.invalidTokens)
    const rateLimitedTokens = stringArray(body.rateLimitedTokens)
    if (!successfulTokens || !invalidTokens || !rateLimitedTokens) {
      throw new RetryableDeliveryError(503)
    }

    const expected = new Set(tokens)
    const seen = new Set<string>()
    for (const token of [
      ...successfulTokens,
      ...invalidTokens,
      ...rateLimitedTokens,
    ]) {
      if (!expected.has(token) || seen.has(token)) {
        throw new RetryableDeliveryError(503)
      }
      seen.add(token)
    }
    if (seen.size !== expected.size) throw new RetryableDeliveryError(503)
    const retryAfter = retryAfterSeconds(response.headers.get('retry-after'))
    return {
      invalidTokens,
      rateLimitedTokens,
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function acceptedTicketResponse(value: unknown): {
  expiresAt: string
  token: string
} | null {
  if (
    !isRecord(value) ||
    value.success !== true ||
    !isRecord(value.data) ||
    typeof value.data.token !== 'string' ||
    value.data.token.length > 4_096 ||
    !VAPID_TICKET.test(value.data.token) ||
    value.data.signatureText !== value.data.token ||
    typeof value.data.expiresAt !== 'string' ||
    !parseIsoDate(value.data.expiresAt)
  ) return null
  return { expiresAt: value.data.expiresAt, token: value.data.token }
}

function acceptedSubscriptionResponse(value: unknown): boolean {
  return isRecord(value) && value.success === true && isRecord(value.data)
}

function acceptedCallbackRouteRevocation(value: unknown): boolean {
  return isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    typeof value.data.disabled === 'number' &&
    Number.isSafeInteger(value.data.disabled) &&
    value.data.disabled >= 0
}

type UpstreamJsonResponse = {
  body: unknown
  headers: Headers
  ok: boolean
  status: number
}

async function fetchJson(
  url: string,
  init: RequestInit,
  dependencies: NotificationBridgeDependencies,
): Promise<UpstreamJsonResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const response = await dependencies.fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    })
    return {
      body: await readJsonResponse(response, UPSTREAM_BODY_LIMIT_BYTES),
      headers: response.headers,
      ok: response.ok,
      status: response.status,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function upstreamResponse(upstream: UpstreamJsonResponse): Response {
  const retryAfter = retryAfterSeconds(upstream.headers.get('retry-after'))
  if (upstream.status === 429) {
    return Response.json(
      { error: 'rate_limited' },
      {
        headers: {
          ...responseHeaders,
          ...(retryAfter === undefined
            ? {}
            : { 'retry-after': String(retryAfter) }),
        },
        status: 429,
      },
    )
  }
  return jsonError('notification_unavailable', 503)
}

async function readJsonResponse(
  response: Response,
  limit: number,
): Promise<unknown> {
  if (mediaType(response) !== 'application/json') return null
  const body = await readBody(response, limit)
  if (body.status !== 'valid') return null
  try {
    return JSON.parse(new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false,
    }).decode(body.value))
  } catch {
    return null
  }
}

async function readJsonRequest(
  request: Request,
  limit: number,
): Promise<
  | { status: 'invalid' | 'too-large' }
  | { status: 'valid'; value: unknown }
> {
  if (mediaType(request) !== 'application/json') return { status: 'invalid' }
  const body = await readBody(request, limit)
  if (body.status !== 'valid') return body
  try {
    return {
      status: 'valid',
      value: JSON.parse(new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: false,
      }).decode(body.value)),
    }
  } catch {
    return { status: 'invalid' }
  }
}

async function readBody(
  message: Request | Response,
  limit: number,
): Promise<
  | { status: 'invalid' | 'too-large' }
  | { status: 'valid'; value: Uint8Array }
> {
  const contentLengthHeader = message.headers.get('content-length')
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return { status: 'invalid' }
    }
    if (contentLength > limit) return { status: 'too-large' }
  }
  if (!message.body) return { status: 'invalid' }
  const reader = message.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel().catch(() => undefined)
        return { status: 'too-large' }
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    return { status: 'invalid' }
  }
  if (length === 0) return { status: 'invalid' }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { status: 'valid', value: bytes }
}

function callbackSignedBytes(
  timestamp: string,
  deliveryId: string,
  rawBody: Uint8Array,
): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}\n${deliveryId}\n`)
  const signed = new Uint8Array(prefix.byteLength + rawBody.byteLength)
  signed.set(prefix)
  signed.set(rawBody, prefix.byteLength)
  return signed
}

function parseSafeOrigin(value: string): string | null {
  const url = parseSafeHttpsUrl(value)
  if (!url || url.pathname !== '/' || url.search !== '') return null
  return url.origin
}

function parseSafeHttpsUrl(value: string): URL | null {
  if (!value || value !== value.trim()) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.hash !== ''
    ) return null
    return url
  } catch {
    return null
  }
}

function parseIsoDate(value: string): Date | null {
  if (value.length > 64) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  return date.toISOString() === value ? date : null
}

function mediaType(message: Request | Response): string | null {
  return message.headers.get('content-type')
    ?.split(';')[0]
    ?.trim()
    .toLowerCase() ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [...keys].sort()
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return null
  }
  return value
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value || !/^\d{1,5}$/u.test(value)) return undefined
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86_400
    ? seconds
    : undefined
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

function decodeBase64Url(value: string): Uint8Array {
  if (!value || !BASE64URL.test(value)) {
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function methodNotAllowed(allow: string): Response {
  return Response.json(
    { error: 'method_not_allowed' },
    { headers: { ...responseHeaders, allow }, status: 405 },
  )
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { headers: responseHeaders, status })
}

class RetryableDeliveryError extends Error {
  readonly retryAfterSeconds: number | undefined
  readonly status: 429 | 503

  constructor(
    status: 429 | 503,
    retryAfterSeconds?: number,
    options?: ErrorOptions,
  ) {
    super('Notification delivery should be retried.', options)
    this.name = 'RetryableDeliveryError'
    this.retryAfterSeconds = retryAfterSeconds
    this.status = status
  }
}
