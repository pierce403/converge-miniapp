// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { fetchFarcasterFollowing } from './farcasterFollowing.js'

describe('fetchFarcasterFollowing', () => {
  it('uses the authenticated FID and minimizes profiles plus verified EVM addresses', async () => {
    let seenUrl: URL | null = null
    let seenHeaders: HeadersInit | undefined
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      seenUrl = input instanceof URL ? input : new URL(String(input))
      seenHeaders = init?.headers
      return Response.json({
      next: { cursor: 'next-page' },
      users: [
        {
          user: {
            display_name: 'Alice',
            fid: 10,
            pfp_url: 'https://images.example/alice.png',
            username: 'alice',
            verified_addresses: {
              eth_addresses: ['0x2222222222222222222222222222222222222222'],
            },
          },
        },
        {
          user: {
            display_name: 'No wallet',
            fid: 11,
            verified_addresses: { eth_addresses: [] },
          },
        },
      ],
      })
    })

    await expect(fetchFarcasterFollowing(
      8531,
      'secret',
      null,
      fetcher as typeof fetch,
    )).resolves.toEqual({
      nextCursor: 'next-page',
      users: [
        {
          addresses: ['0x2222222222222222222222222222222222222222'],
          avatarUrl: 'https://images.example/alice.png',
          displayName: 'Alice',
          fid: 10,
          username: 'alice',
        },
        {
          addresses: [],
          avatarUrl: null,
          displayName: 'No wallet',
          fid: 11,
          username: null,
        },
      ],
    })
    const url = seenUrl as unknown as URL
    expect(url.origin).toBe('https://api.neynar.com')
    expect(url.searchParams.get('fid')).toBe('8531')
    expect(url.searchParams.get('viewer_fid')).toBe('8531')
    expect(url.searchParams.get('limit')).toBe('100')
    expect(seenHeaders).toEqual({
      accept: 'application/json',
      'x-api-key': 'secret',
    })
  })
})
