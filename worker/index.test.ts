// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import {
  handleRequest,
  type AppEnv,
  type WorkerDependencies,
} from './index.js'

const association = {
  FARCASTER_ACCOUNT_ASSOCIATION_HEADER: 'header_value',
  FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD:
    'eyJkb21haW4iOiJtaW5pYXBwLmNvbnZlcmdlLmN2In0',
  FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE: 'signature_value',
}

function environment(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    APP_ENV: 'production',
    APP_VERSION: '0.1.0',
    CANONICAL_ORIGIN: 'https://miniapp.converge.cv',
    ENS_MAINNET_RPC_URLS: 'https://ethereum-rpc.publicnode.com,https://eth.llamarpc.com',
    CF_VERSION_METADATA: {
      id: 'version-id',
      tag: 'release-tag',
      timestamp: '2026-07-14T19:00:00.000Z',
    },
    IDENTITY_RATE_LIMITER: fakeRateLimiter(),
    ...overrides,
  }
}

describe('worker API', () => {
  it('reports service and deployment health without caching', async () => {
    const response = await handleRequest(
      new Request('https://miniapp.converge.cv/api/health'),
      environment(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    await expect(response.json()).resolves.toEqual({
      environment: 'production',
      ok: true,
      service: 'converge-miniapp',
      version: {
        app: '0.1.0',
        deployedAt: '2026-07-14T19:00:00.000Z',
        id: 'version-id',
        tag: 'release-tag',
      },
    })
  })

  it('keeps unknown API routes out of the SPA fallback', async () => {
    const response = await handleRequest(
      new Request('https://miniapp.converge.cv/api/missing'),
      environment(),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })

  it('returns an authenticated, forward-verified ENS candidate and preference', async () => {
    const preferences = fakePreferences('dismissed')
    const dependencies = identityDependencies()
    const response = await handleRequest(
      authorizedRequest('/api/me/ens'),
      environment({ PREFERENCES: preferences.database }),
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      ens: {
        address: '0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3',
        name: 'deanpierce.eth',
      },
      preference: 'dismissed',
      status: 'available',
    })
    expect(dependencies.verifyQuickAuthToken).toHaveBeenCalledWith(
      'test-token',
      'miniapp.converge.cv',
    )
    expect(dependencies.discoverEnsIdentity).toHaveBeenCalledWith(
      8531,
      'https://ethereum-rpc.publicnode.com,https://eth.llamarpc.com',
    )
  })

  it('resolves authenticated participant display identities without D1', async () => {
    const dependencies = identityDependencies()
    dependencies.resolveParticipantIdentities.mockResolvedValue({
      identities: [{
        address: '0x2222222222222222222222222222222222222222',
        basename: 'alice.base.eth',
        ensName: 'alice.eth',
        farcasterFid: 10,
        registeredFname: 'alice',
      }],
      status: 'complete',
    })
    const limiter = fakeRateLimiter()
    const response = await handleRequest(
      authorizedRequest('/api/identities', {
        body: JSON.stringify({
          addresses: ['0x2222222222222222222222222222222222222222'],
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      environment({
        FARCASTER_BASE_RPC_URL: 'https://base-rpc.example',
        IDENTITY_RATE_LIMITER: limiter,
      }),
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      identities: [{
        address: '0x2222222222222222222222222222222222222222',
        basename: 'alice.base.eth',
        ensName: 'alice.eth',
        registeredFname: 'alice',
      }],
      partial: false,
    })
    expect(dependencies.resolveParticipantIdentities).toHaveBeenCalledWith(
      ['0x2222222222222222222222222222222222222222'],
      'https://ethereum-rpc.publicnode.com,https://eth.llamarpc.com',
      expect.objectContaining({
        baseRpcUrl: 'https://base-rpc.example',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(limiter.limit).toHaveBeenCalledWith({
      key: 'production:participant-identities:fid:8531',
    })
  })

  it('allows ENS-only results when the optional Base secret is absent', async () => {
    const dependencies = identityDependencies()
    dependencies.resolveParticipantIdentities.mockResolvedValue({
      identities: [{
        address: '0x2222222222222222222222222222222222222222',
        basename: 'alice.base.eth',
        ensName: 'alice.eth',
        farcasterFid: null,
        registeredFname: null,
      }],
      status: 'complete',
    })
    const response = await handleRequest(
      participantRequest(),
      environment(),
      dependencies,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      identities: [{
        ensName: 'alice.eth',
        registeredFname: null,
      }],
      partial: false,
    })
    expect(dependencies.resolveParticipantIdentities).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    const options = dependencies.resolveParticipantIdentities.mock.calls[0]?.[2]
    expect(options).not.toHaveProperty('baseRpcUrl')
  })

  it('returns partial results but rejects unavailable resolver batches', async () => {
    const dependencies = identityDependencies()
    dependencies.resolveParticipantIdentities.mockResolvedValueOnce({
      identities: [],
      status: 'partial',
    }).mockResolvedValueOnce({
      identities: [],
      status: 'unavailable',
    })

    const partial = await handleRequest(
      participantRequest(),
      environment(),
      dependencies,
    )
    const unavailable = await handleRequest(
      participantRequest(),
      environment(),
      dependencies,
    )

    expect(partial.status).toBe(200)
    await expect(partial.json()).resolves.toEqual({ identities: [], partial: true })
    expect(unavailable.status).toBe(503)
    await expect(unavailable.json()).resolves.toEqual({
      error: 'identity_unavailable',
    })
  })

  it('rate-limits by verified FID before calling identity providers', async () => {
    const dependencies = identityDependencies()
    const limiter = fakeRateLimiter(false)
    const response = await handleRequest(
      participantRequest(),
      environment({ IDENTITY_RATE_LIMITER: limiter }),
      dependencies,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' })
    expect(limiter.limit).toHaveBeenCalledWith({
      key: 'production:participant-identities:fid:8531',
    })
    expect(dependencies.resolveParticipantIdentities).not.toHaveBeenCalled()
  })

  it('fails closed when the rate-limit binding is unavailable', async () => {
    const dependencies = identityDependencies()
    const limiter = fakeRateLimiter()
    vi.mocked(limiter.limit).mockRejectedValueOnce(new Error('binding unavailable'))
    const response = await handleRequest(
      participantRequest(),
      environment({ IDENTITY_RATE_LIMITER: limiter }),
      dependencies,
    )

    expect(response.status).toBe(503)
    expect(dependencies.resolveParticipantIdentities).not.toHaveBeenCalled()
  })

  it('does not spend rate-limit budget when Quick Auth fails', async () => {
    const dependencies = identityDependencies()
    dependencies.verifyQuickAuthToken.mockRejectedValue(new Error('bad token'))
    const limiter = fakeRateLimiter()
    const response = await handleRequest(
      participantRequest(),
      environment({ IDENTITY_RATE_LIMITER: limiter }),
      dependencies,
    )

    expect(response.status).toBe(401)
    expect(limiter.limit).not.toHaveBeenCalled()
  })

  it('rejects malformed or oversized participant lookup batches', async () => {
    const dependencies = identityDependencies()
    const malformed = await handleRequest(
      authorizedRequest('/api/identities', {
        body: JSON.stringify({ addresses: ['not-an-address'] }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      environment(),
      dependencies,
    )
    const oversized = await handleRequest(
      authorizedRequest('/api/identities', {
        body: JSON.stringify({
          addresses: Array.from({ length: 13 }, (_, index) => (
            `0x${String(index + 1).padStart(40, '0')}`
          )),
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      environment(),
      dependencies,
    )

    expect(malformed.status).toBe(400)
    expect(oversized.status).toBe(400)
    expect(dependencies.resolveParticipantIdentities).not.toHaveBeenCalled()
  })

  it('enforces the byte limit when Content-Length is absent', async () => {
    const dependencies = identityDependencies()
    const limiter = fakeRateLimiter()
    const request = authorizedRequest('/api/identities', {
      body: JSON.stringify({
        addresses: ['0x2222222222222222222222222222222222222222'],
        padding: 'x'.repeat(17_000),
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(request.headers.get('content-length')).toBeNull()

    const response = await handleRequest(
      request,
      environment({ IDENTITY_RATE_LIMITER: limiter }),
      dependencies,
    )

    expect(response.status).toBe(400)
    expect(limiter.limit).not.toHaveBeenCalled()
    expect(dependencies.resolveParticipantIdentities).not.toHaveBeenCalled()
  })

  it('ends participant resolution after the endpoint deadline', async () => {
    vi.useFakeTimers()
    try {
      const dependencies = identityDependencies()
      dependencies.resolveParticipantIdentities.mockImplementation(
        () => new Promise(() => undefined),
      )
      const responsePromise = handleRequest(
        participantRequest(),
        environment(),
        dependencies,
      )
      await vi.waitFor(() => {
        expect(dependencies.resolveParticipantIdentities).toHaveBeenCalledOnce()
      })

      await vi.advanceTimersByTimeAsync(10_000)
      const response = await responsePromise

      expect(response.status).toBe(503)
      const options = dependencies.resolveParticipantIdentities.mock.calls[0]?.[2]
      expect(options?.signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires exact-domain Quick Auth and configured server storage', async () => {
    const dependencies = identityDependencies()
    dependencies.verifyQuickAuthToken.mockRejectedValue(new Error('bad token'))

    const unauthorized = await handleRequest(
      authorizedRequest('/api/me/ens'),
      environment({ PREFERENCES: fakePreferences().database }),
      dependencies,
    )
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toEqual({ error: 'unauthorized' })

    const unconfigured = await handleRequest(
      authorizedRequest('/api/me/ens'),
      environment(),
      identityDependencies(),
    )
    expect(unconfigured.status).toBe(503)
    await expect(unconfigured.json()).resolves.toEqual({
      error: 'identity_unavailable',
    })

    const wrongHost = await handleRequest(
      new Request('https://alternate.example/api/me/ens', {
        headers: { authorization: 'Bearer test-token' },
      }),
      environment({ PREFERENCES: fakePreferences().database }),
      identityDependencies(),
    )
    expect(wrongHost.status).toBe(404)
  })

  it('uses the rendered preview host as the Quick Auth audience', async () => {
    const dependencies = identityDependencies()
    const response = await handleRequest(
      new Request('https://converge-preview.example.workers.dev/api/me/ens', {
        headers: { authorization: 'Bearer test-token' },
      }),
      environment({
        APP_ENV: 'preview',
        CANONICAL_ORIGIN: 'http://localhost:5173',
        PREFERENCES: fakePreferences().database,
      }),
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(dependencies.verifyQuickAuthToken).toHaveBeenCalledWith(
      'test-token',
      'converge-preview.example.workers.dev',
    )
  })

  it('stores an idempotent account-wide choice and deletes it on request', async () => {
    const preferences = fakePreferences()
    const dependencies = identityDependencies()
    const preferencesOnlyEnvironment = environment({
      PREFERENCES: preferences.database,
    })
    delete preferencesOnlyEnvironment.ENS_MAINNET_RPC_URLS
    const accepted = await handleRequest(
      authorizedRequest('/api/me/ens-preference', {
        body: JSON.stringify({ choice: 'accepted' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }),
      preferencesOnlyEnvironment,
      dependencies,
    )
    expect(accepted.status).toBe(204)
    expect(preferences.choice()).toBe('accepted')

    const deleted = await handleRequest(
      authorizedRequest('/api/me', { method: 'DELETE' }),
      preferencesOnlyEnvironment,
      dependencies,
    )
    expect(deleted.status).toBe(204)
    expect(preferences.choice()).toBeNull()
  })

  it('rejects malformed preference writes without touching D1', async () => {
    const preferences = fakePreferences()
    const response = await handleRequest(
      authorizedRequest('/api/me/ens-preference', {
        body: '{',
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }),
      environment({ PREFERENCES: preferences.database }),
      identityDependencies(),
    )

    expect(response.status).toBe(400)
    expect(preferences.choice()).toBeNull()
  })
})

function authorizedRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('authorization', 'Bearer test-token')
  return new Request(`https://miniapp.converge.cv${path}`, { ...init, headers })
}

function participantRequest() {
  return authorizedRequest('/api/identities', {
    body: JSON.stringify({
      addresses: ['0x2222222222222222222222222222222222222222'],
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

function fakeRateLimiter(success = true): RateLimit {
  return {
    limit: vi.fn().mockResolvedValue({ success }),
  }
}

function identityDependencies() {
  return {
    discoverEnsIdentity: vi.fn().mockResolvedValue({
      candidate: {
        address: '0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3',
        name: 'deanpierce.eth',
      },
      status: 'available',
    }),
    resolveParticipantIdentities: vi.fn().mockResolvedValue({
      identities: [],
      status: 'complete',
    }),
    verifyQuickAuthToken: vi.fn().mockResolvedValue(8531),
  } satisfies WorkerDependencies
}

function fakePreferences(initialChoice: 'accepted' | 'dismissed' | null = null) {
  let choice = initialChoice
  const database = {
    prepare: (query: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => query.includes('SELECT') && choice ? { choice } : null,
        run: async () => {
          if (query.includes('INSERT')) choice = values[1] as typeof choice
          if (query.includes('DELETE')) choice = null
          return { success: true }
        },
      }),
    }),
  } as unknown as D1Database
  return { choice: () => choice, database }
}

describe('Farcaster manifest', () => {
  it('never publishes the canonical manifest from preview', async () => {
    const response = await handleRequest(
      new Request('https://preview.example.workers.dev/.well-known/farcaster.json'),
      environment({
        ...association,
        APP_ENV: 'preview',
        CANONICAL_ORIGIN: 'http://localhost:5173',
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'manifest_not_configured',
    })
  })

  it('serves a noindex bootstrap manifest when account association is absent', async () => {
    const response = await handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      environment(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      miniapp: {
        canonicalDomain: 'miniapp.converge.cv',
        noindex: true,
      },
    })

    const head = await handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json', {
        method: 'HEAD',
      }),
      environment(),
    )
    expect(head.status).toBe(200)
    expect(head.headers.get('cache-control')).toBe('no-store')
    expect(await head.text()).toBe('')
  })

  it('fails closed when account association is only partially configured', async () => {
    const response = await handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      environment({
        FARCASTER_ACCOUNT_ASSOCIATION_HEADER: association.FARCASTER_ACCOUNT_ASSOCIATION_HEADER,
      }),
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      error: 'manifest_not_configured',
    })
  })

  it('fails closed when the encoded association payload is not base64url-shaped', async () => {
    const response = await handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      environment({
        ...association,
        FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD: 'not.a.payload',
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'manifest_not_configured',
    })
  })

  it('preserves the opaque signature string returned by Farcaster', async () => {
    const signature = 'MEUCIQD+standard/base64==.'
    const response = await handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      environment({
        ...association,
        FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE: signature,
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      accountAssociation: { signature },
    })
  })

  it('fails closed when the signed payload names a different domain', async () => {
    const response = await handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      environment({
        ...association,
        FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD:
          'eyJkb21haW4iOiJ3cm9uZy5leGFtcGxlIn0',
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'manifest_not_configured',
    })
  })

  it('serves canonical metadata only with a complete association', async () => {
    const response = await handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      environment(association),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=300, must-revalidate',
    )
    await expect(response.json()).resolves.toMatchObject({
      accountAssociation: {
        header: 'header_value',
        payload: 'eyJkb21haW4iOiJtaW5pYXBwLmNvbnZlcmdlLmN2In0',
        signature: 'signature_value',
      },
      miniapp: {
        canonicalDomain: 'miniapp.converge.cv',
        heroImageUrl: 'https://miniapp.converge.cv/hero-1200x630.png',
        homeUrl: 'https://miniapp.converge.cv/',
        iconUrl: 'https://miniapp.converge.cv/icon-1024.png',
        noindex: true,
        requiredCapabilities: ['wallet.getEthereumProvider'],
        version: '1',
      },
    })
  })

  it('supports metadata-only HEAD requests and rejects writes', async () => {
    const head = await handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json', {
        method: 'HEAD',
      }),
      environment(association),
    )
    expect(head.status).toBe(200)
    expect(head.headers.get('cache-control')).toBe(
      'public, max-age=300, must-revalidate',
    )
    expect(await head.text()).toBe('')

    const post = await handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json', {
        method: 'POST',
      }),
      environment(association),
    )
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })
})
