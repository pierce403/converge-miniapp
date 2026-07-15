import {
  discoverEnsIdentity,
  normalizeEnsQuery,
  resolveEnsName,
  type EnsDiscovery,
  type EnsForwardResolution,
} from './ens.js'
import {
  resolveParticipantIdentities,
  type ParticipantIdentityBatch,
} from './participantIdentities.js'
import { verifyQuickAuthToken } from './quickAuth.js'
import { getAddress, isAddress } from 'viem'

const securityHeaders = {
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
}

const noStoreJsonHeaders = {
  ...securityHeaders,
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
}

const manifestJsonHeaders = {
  ...securityHeaders,
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=300, must-revalidate',
  'content-type': 'application/json; charset=utf-8',
}

const bootstrapManifestJsonHeaders = {
  ...manifestJsonHeaders,
  'cache-control': 'no-store',
}

const BASE64URL_VALUE = /^[A-Za-z0-9_-]+$/
const ENS_RESOLUTION_BODY_LIMIT_BYTES = 2_048
const ENS_RESOLUTION_TIMEOUT_MS = 10_000
const PARTICIPANT_BODY_LIMIT_BYTES = 16_384
const PARTICIPANT_RESOLUTION_TIMEOUT_MS = 10_000

export type AppEnv = {
  APP_ENV: Env['APP_ENV']
  APP_VERSION: Env['APP_VERSION']
  CANONICAL_ORIGIN: Env['CANONICAL_ORIGIN']
  CF_VERSION_METADATA: Env['CF_VERSION_METADATA']
  ENS_MAINNET_RPC_URLS?: Env['ENS_MAINNET_RPC_URLS']
  FARCASTER_BASE_RPC_URL?: string
  FARCASTER_ACCOUNT_ASSOCIATION_HEADER?: string
  FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD?: string
  FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE?: string
  IDENTITY_RATE_LIMITER?: RateLimit
  PREFERENCES?: D1Database
}

export type WorkerDependencies = {
  discoverEnsIdentity: (fid: number, rpcUrls: string) => Promise<EnsDiscovery>
  resolveEnsName: (
    query: string,
    rpcUrls: string,
  ) => Promise<EnsForwardResolution>
  resolveParticipantIdentities: (
    addresses: readonly string[],
    rpcUrls?: string,
    options?: { baseRpcUrl?: string; signal?: AbortSignal },
  ) => Promise<ParticipantIdentityBatch>
  verifyQuickAuthToken: (token: string, domain: string) => Promise<number>
}

const defaultDependencies: WorkerDependencies = {
  discoverEnsIdentity,
  resolveEnsName,
  resolveParticipantIdentities,
  verifyQuickAuthToken,
}

export async function handleRequest(
  request: Request,
  env: AppEnv,
  dependencies: WorkerDependencies = defaultDependencies,
): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/.well-known/farcaster.json') {
    return farcasterManifest(request, env)
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const version = env.CF_VERSION_METADATA
    return Response.json(
      {
        environment: env.APP_ENV,
        ok: true,
        service: 'converge-miniapp',
        version: {
          app: env.APP_VERSION,
          deployedAt: version?.timestamp ?? null,
          id: version?.id ?? null,
          tag: version?.tag ?? null,
        },
      },
      { headers: noStoreJsonHeaders },
    )
  }

  if (
    url.pathname === '/api/me/ens' ||
    url.pathname === '/api/me/ens-preference' ||
    url.pathname === '/api/me'
  ) {
    return identityApi(request, env, dependencies)
  }

  if (url.pathname === '/api/identities') {
    return participantIdentityApi(request, env, dependencies)
  }

  if (url.pathname === '/api/resolve') {
    return recipientResolutionApi(request, env, dependencies)
  }

  if (url.pathname.startsWith('/api/')) {
    return Response.json(
      {
        error: 'not_found',
      },
      { status: 404, headers: noStoreJsonHeaders },
    )
  }

  return new Response(null, { status: 404, headers: securityHeaders })
}

async function recipientResolutionApi(
  request: Request,
  env: AppEnv,
  dependencies: WorkerDependencies,
): Promise<Response> {
  const url = new URL(request.url)
  const canonicalDomain = new URL(env.CANONICAL_ORIGIN).host
  if (env.APP_ENV === 'production' && url.host !== canonicalDomain) {
    return jsonError('not_found', 404)
  }
  if (request.method !== 'POST') return methodNotAllowed('POST')

  const token = bearerToken(request)
  if (!token) return jsonError('unauthorized', 401)
  let fid: number
  try {
    fid = await dependencies.verifyQuickAuthToken(
      token,
      env.APP_ENV === 'production' ? canonicalDomain : url.host,
    )
  } catch {
    return jsonError('unauthorized', 401)
  }

  const query = await recipientEnsQuery(request)
  if (!query) return jsonError('invalid_request', 400)
  if (!env.ENS_MAINNET_RPC_URLS || !env.IDENTITY_RATE_LIMITER) {
    return jsonError('identity_unavailable', 503)
  }

  let allowed: boolean
  try {
    const outcome = await env.IDENTITY_RATE_LIMITER.limit({
      key: `${env.APP_ENV}:ens-resolution:fid:${fid}`,
    })
    allowed = outcome.success
  } catch {
    return jsonError('identity_unavailable', 503)
  }
  if (!allowed) return rateLimited()

  try {
    const result = await withEnsResolutionDeadline(
      dependencies.resolveEnsName(query, env.ENS_MAINNET_RPC_URLS),
    )
    if (result.status === 'invalid') return jsonError('invalid_request', 400)
    if (result.status === 'unavailable') {
      return jsonError('identity_unavailable', 503)
    }
    return Response.json(result, { headers: noStoreJsonHeaders })
  } catch {
    return jsonError('identity_unavailable', 503)
  }
}

async function recipientEnsQuery(request: Request): Promise<string | null> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json') return null

  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader)
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > ENS_RESOLUTION_BODY_LIMIT_BYTES
    ) return null
  }

  let body: unknown
  try {
    const bytes = await boundedRequestBody(
      request,
      ENS_RESOLUTION_BODY_LIMIT_BYTES,
    )
    if (!bytes) return null
    body = JSON.parse(new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes))
  } catch {
    return null
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !('query' in body) ||
    typeof body.query !== 'string'
  ) return null
  return normalizeEnsQuery(body.query)
}

async function withEnsResolutionDeadline(
  resolution: Promise<EnsForwardResolution>,
): Promise<EnsForwardResolution> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('ENS resolution timed out.'))
    }, ENS_RESOLUTION_TIMEOUT_MS)
  })
  try {
    return await Promise.race([resolution, deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function participantIdentityApi(
  request: Request,
  env: AppEnv,
  dependencies: WorkerDependencies,
): Promise<Response> {
  const url = new URL(request.url)
  const canonicalDomain = new URL(env.CANONICAL_ORIGIN).host
  if (env.APP_ENV === 'production' && url.host !== canonicalDomain) {
    return jsonError('not_found', 404)
  }
  if (request.method !== 'POST') return methodNotAllowed('POST')

  const token = bearerToken(request)
  if (!token) return jsonError('unauthorized', 401)
  let fid: number
  try {
    fid = await dependencies.verifyQuickAuthToken(
      token,
      env.APP_ENV === 'production' ? canonicalDomain : url.host,
    )
  } catch {
    return jsonError('unauthorized', 401)
  }

  const addresses = await participantAddresses(request)
  if (!addresses) return jsonError('invalid_request', 400)

  if (!env.IDENTITY_RATE_LIMITER) return jsonError('identity_unavailable', 503)
  let allowed: boolean
  try {
    const outcome = await env.IDENTITY_RATE_LIMITER.limit({
      key: `${env.APP_ENV}:participant-identities:fid:${fid}`,
    })
    allowed = outcome.success
  } catch {
    return jsonError('identity_unavailable', 503)
  }
  if (!allowed) return rateLimited()

  try {
    const batch = await withParticipantResolutionDeadline(
      (signal) => dependencies.resolveParticipantIdentities(
        addresses,
        env.ENS_MAINNET_RPC_URLS,
        {
          ...(env.FARCASTER_BASE_RPC_URL
            ? { baseRpcUrl: env.FARCASTER_BASE_RPC_URL }
            : {}),
          signal,
        },
      ),
    )
    if (batch.status === 'unavailable') {
      return jsonError('identity_unavailable', 503)
    }
    return Response.json({
      identities: batch.identities.map((identity) => ({
        address: identity.address,
        basename: identity.basename,
        ensName: identity.ensName,
        registeredFname: identity.registeredFname,
      })),
      partial: batch.status === 'partial',
    }, { headers: noStoreJsonHeaders })
  } catch {
    return jsonError('identity_unavailable', 503)
  }
}

async function participantAddresses(
  request: Request,
): Promise<`0x${string}`[] | null> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json') {
    return null
  }
  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 ||
      contentLength > PARTICIPANT_BODY_LIMIT_BYTES) return null
  }

  let body: unknown
  try {
    const bytes = await boundedRequestBody(request, PARTICIPANT_BODY_LIMIT_BYTES)
    if (!bytes) return null
    body = JSON.parse(new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes))
  } catch {
    return null
  }
  if (!body || typeof body !== 'object' || !('addresses' in body) ||
    !Array.isArray(body.addresses) || body.addresses.length > 12) return null

  const addresses = new Set<`0x${string}`>()
  for (const value of body.addresses) {
    if (typeof value !== 'string' || !isAddress(value)) return null
    addresses.add(getAddress(value).toLowerCase() as `0x${string}`)
  }
  return [...addresses]
}

async function boundedRequestBody(
  request: Request,
  limit: number,
): Promise<Uint8Array | null> {
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }

  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function withParticipantResolutionDeadline(
  operation: (signal: AbortSignal) => Promise<ParticipantIdentityBatch>,
): Promise<ParticipantIdentityBatch> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('Participant identity resolution timed out.'))
    }, PARTICIPANT_RESOLUTION_TIMEOUT_MS)
  })
  try {
    return await Promise.race([operation(controller.signal), deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function rateLimited(): Response {
  return Response.json(
    { error: 'rate_limited' },
    {
      headers: { ...noStoreJsonHeaders, 'retry-after': '60' },
      status: 429,
    },
  )
}

async function identityApi(
  request: Request,
  env: AppEnv,
  dependencies: WorkerDependencies,
): Promise<Response> {
  const url = new URL(request.url)
  const canonicalDomain = new URL(env.CANONICAL_ORIGIN).host
  if (env.APP_ENV === 'production' && url.host !== canonicalDomain) {
    return jsonError('not_found', 404)
  }
  const authDomain = env.APP_ENV === 'production' ? canonicalDomain : url.host

  if (url.pathname === '/api/me/ens' && request.method !== 'GET') {
    return methodNotAllowed('GET')
  }
  if (url.pathname === '/api/me/ens-preference' && request.method !== 'PUT') {
    return methodNotAllowed('PUT')
  }
  if (url.pathname === '/api/me' && request.method !== 'DELETE') {
    return methodNotAllowed('DELETE')
  }

  const token = bearerToken(request)
  if (!token) return jsonError('unauthorized', 401)

  let fid: number
  try {
    fid = await dependencies.verifyQuickAuthToken(token, authDomain)
  } catch {
    return jsonError('unauthorized', 401)
  }

  try {
    if (!env.PREFERENCES) {
      return jsonError('identity_unavailable', 503)
    }

    if (url.pathname === '/api/me/ens') {
      if (!env.ENS_MAINNET_RPC_URLS) {
        return jsonError('identity_unavailable', 503)
      }
      const [preference, discovery] = await Promise.all([
        readEnsPreference(env.PREFERENCES, fid),
        dependencies.discoverEnsIdentity(fid, env.ENS_MAINNET_RPC_URLS),
      ])
      return Response.json(
        {
          ens: discovery.candidate,
          preference,
          status: discovery.status,
        },
        { headers: noStoreJsonHeaders },
      )
    }

    if (url.pathname === '/api/me/ens-preference') {
      const choice = await preferenceChoice(request)
      if (!choice) return jsonError('invalid_request', 400)
      await env.PREFERENCES.prepare(`
        INSERT INTO ens_identity_preferences (fid, choice, updated_at)
        VALUES (?1, ?2, unixepoch())
        ON CONFLICT(fid) DO UPDATE SET
          choice = excluded.choice,
          updated_at = excluded.updated_at
      `).bind(fid, choice).run()
      return new Response(null, {
        status: 204,
        headers: { ...securityHeaders, 'cache-control': 'no-store' },
      })
    }

    await env.PREFERENCES.prepare(
      'DELETE FROM ens_identity_preferences WHERE fid = ?1',
    ).bind(fid).run()
    return new Response(null, {
      status: 204,
      headers: { ...securityHeaders, 'cache-control': 'no-store' },
    })
  } catch {
    return jsonError('identity_unavailable', 503)
  }
}

async function readEnsPreference(
  database: D1Database,
  fid: number,
): Promise<'accepted' | 'dismissed' | null> {
  const row = await database.prepare(
    'SELECT choice FROM ens_identity_preferences WHERE fid = ?1',
  ).bind(fid).first<{ choice: unknown }>()
  return row?.choice === 'accepted' || row?.choice === 'dismissed'
    ? row.choice
    : null
}

async function preferenceChoice(
  request: Request,
): Promise<'accepted' | 'dismissed' | null> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    return null
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (!body || typeof body !== 'object' || !('choice' in body)) return null
  return body.choice === 'accepted' || body.choice === 'dismissed'
    ? body.choice
    : null
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer ([^\s]{1,8192})$/)
  return match?.[1] ?? null
}

function methodNotAllowed(allow: string): Response {
  return Response.json(
    { error: 'method_not_allowed' },
    {
      status: 405,
      headers: { ...noStoreJsonHeaders, allow },
    },
  )
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: noStoreJsonHeaders })
}

function farcasterManifest(request: Request, env: AppEnv): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json(
      { error: 'method_not_allowed' },
      {
        headers: { ...noStoreJsonHeaders, allow: 'GET, HEAD' },
        status: 405,
      },
    )
  }

  if (env.APP_ENV !== 'production') {
    return Response.json(
      { error: 'manifest_not_configured' },
      { status: 503, headers: noStoreJsonHeaders },
    )
  }

  const origin = new URL(env.CANONICAL_ORIGIN).origin
  const canonicalDomain = new URL(origin).hostname
  if (new URL(request.url).hostname !== canonicalDomain) {
    return Response.json(
      { error: 'manifest_not_configured' },
      { status: 503, headers: noStoreJsonHeaders },
    )
  }

  const association = accountAssociation(env, canonicalDomain)
  if (association.state === 'invalid') {
    return Response.json(
      { error: 'manifest_not_configured' },
      { status: 503, headers: noStoreJsonHeaders },
    )
  }

  const body = {
    ...(association.state === 'valid'
      ? { accountAssociation: association.value }
      : {}),
    miniapp: {
      canonicalDomain,
      description: 'A focused, private XMTP inbox that runs inside Farcaster.',
      heroImageUrl: `${origin}/hero-1200x630.png`,
      homeUrl: `${origin}/`,
      iconUrl: `${origin}/icon-1024.png`,
      name: 'Converge Mini',
      noindex: true,
      ogDescription: 'A focused XMTP inbox inside Farcaster.',
      ogImageUrl: `${origin}/hero-1200x630.png`,
      ogTitle: 'Converge Mini',
      primaryCategory: 'social',
      requiredCapabilities: ['wallet.getEthereumProvider'],
      screenshotUrls: [`${origin}/screenshot-1284x2778.png`],
      splashBackgroundColor: '#0b1f4a',
      splashImageUrl: `${origin}/splash-200.png`,
      subtitle: 'Private XMTP messages',
      tagline: 'Private messages in Farcaster',
      tags: ['xmtp', 'messaging', 'privacy', 'farcaster'],
      version: '1',
    },
  }
  const responseHeaders = association.state === 'valid'
    ? manifestJsonHeaders
    : bootstrapManifestJsonHeaders

  if (request.method === 'HEAD') {
    return new Response(null, { headers: responseHeaders })
  }
  return Response.json(body, { headers: responseHeaders })
}

function accountAssociation(env: AppEnv, canonicalDomain: string) {
  const header = env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER?.trim()
  const payload = env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD?.trim()
  const signature = env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE?.trim()

  if (!header && !payload && !signature) {
    return { state: 'absent' } as const
  }

  if (
    !header ||
    !payload ||
    !signature ||
    !BASE64URL_VALUE.test(header) ||
    !BASE64URL_VALUE.test(payload)
  ) return { state: 'invalid' } as const

  const decodedPayload = decodeBase64UrlJson(payload)
  if (
    typeof decodedPayload !== 'object' ||
    decodedPayload === null ||
    !('domain' in decodedPayload) ||
    decodedPayload.domain !== canonicalDomain
  ) return { state: 'invalid' } as const

  return {
    state: 'valid',
    value: { header, payload, signature },
  } as const
}

function decodeBase64UrlJson(value: string): unknown {
  try {
    const base64 = value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env)
  },
} satisfies ExportedHandler<AppEnv>
