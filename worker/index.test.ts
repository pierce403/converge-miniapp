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

function identityDependencies() {
  return {
    discoverEnsIdentity: vi.fn().mockResolvedValue({
      candidate: {
        address: '0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3',
        name: 'deanpierce.eth',
      },
      status: 'available',
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
