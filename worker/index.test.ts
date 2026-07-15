// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { handleRequest, type AppEnv } from './index.js'

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
    const response = handleRequest(
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
    const response = handleRequest(
      new Request('https://miniapp.converge.cv/api/missing'),
      environment(),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })
})

describe('Farcaster manifest', () => {
  it('never publishes the canonical manifest from preview', async () => {
    const response = handleRequest(
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

  it('fails closed when exact-domain account association is absent', async () => {
    const response = handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      environment(),
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      error: 'manifest_not_configured',
    })
  })

  it('fails closed when the encoded association payload is not base64url-shaped', async () => {
    const response = handleRequest(
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
    const response = handleRequest(
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
    const response = handleRequest(
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
    const response = handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      environment(association),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toContain('max-age=300')
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
        requiredCapabilities: ['wallet.getEthereumProvider'],
        version: '1',
      },
    })
  })

  it('supports metadata-only HEAD requests and rejects writes', async () => {
    const head = handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json', {
        method: 'HEAD',
      }),
      environment(association),
    )
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    const post = handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json', {
        method: 'POST',
      }),
      environment(association),
    )
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })
})
