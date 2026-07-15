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

const ASSOCIATION_VALUE = /^[A-Za-z0-9_-]+$/

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
  if (!association) {
    return Response.json(
      { error: 'manifest_not_configured' },
      { status: 503, headers: noStoreJsonHeaders },
    )
  }

  const body = {
    accountAssociation: association,
    miniapp: {
      canonicalDomain,
      description: 'A focused, private XMTP inbox that runs inside Farcaster.',
      heroImageUrl: `${origin}/hero-1200x630.png`,
      homeUrl: `${origin}/`,
      iconUrl: `${origin}/icon-1024.png`,
      name: 'Converge Mini',
      noindex: false,
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

  if (request.method === 'HEAD') {
    return new Response(null, { headers: manifestJsonHeaders })
  }
  return Response.json(body, { headers: manifestJsonHeaders })
}

function accountAssociation(env: AppEnv, canonicalDomain: string) {
  const header = env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER?.trim()
  const payload = env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD?.trim()
  const signature = env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE?.trim()

  if (
    !header ||
    !payload ||
    !signature ||
    !ASSOCIATION_VALUE.test(header) ||
    !ASSOCIATION_VALUE.test(payload) ||
    !ASSOCIATION_VALUE.test(signature)
  ) return null

  const decodedPayload = decodeBase64UrlJson(payload)
  if (
    typeof decodedPayload !== 'object' ||
    decodedPayload === null ||
    !('domain' in decodedPayload) ||
    decodedPayload.domain !== canonicalDomain
  ) return null

  return { header, payload, signature }
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
