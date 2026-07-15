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

export type AppEnv = Env & {
  FARCASTER_ACCOUNT_ASSOCIATION_HEADER?: string
  FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD?: string
  FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE?: string
}

export function handleRequest(request: Request, env: AppEnv): Response {
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
