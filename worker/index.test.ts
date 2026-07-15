// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { handleRequest } from './index.js'

describe('worker API', () => {
  it('reports service health without caching', async () => {
    const response = handleRequest(
      new Request('https://miniapp.converge.cv/api/health'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'converge-miniapp',
    })
  })

  it('keeps unknown API routes out of the SPA fallback', async () => {
    const response = handleRequest(
      new Request('https://miniapp.converge.cv/api/missing'),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })
})
