import { getAddress, isAddress } from 'viem'

import type { FarcasterContactCandidate } from '../messaging/types'

export type FarcasterFollowingPage = {
  nextCursor: string | null
  users: FarcasterContactCandidate[]
}

export async function fetchFarcasterFollowing(
  cursor: string | null,
): Promise<FarcasterFollowingPage> {
  const { sdk } = await import('@farcaster/miniapp-sdk')
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  const response = await sdk.quickAuth.fetch(
    `/api/me/farcaster-following${query}`,
    { headers: { accept: 'application/json' } },
  )
  if (!response.ok) {
    throw new Error('Farcaster contacts are unavailable right now.')
  }
  return parseFollowingPage(await response.json())
}

function parseFollowingPage(value: unknown): FarcasterFollowingPage {
  if (!value || typeof value !== 'object') {
    throw new Error('Farcaster contacts returned an invalid response.')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.users)) {
    throw new Error('Farcaster contacts returned an invalid response.')
  }
  const users = record.users.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const candidate = value as Record<string, unknown>
    if (!Number.isSafeInteger(candidate.fid) || (candidate.fid as number) <= 0) {
      return []
    }
    const addresses = Array.isArray(candidate.addresses)
      ? candidate.addresses.flatMap((address) =>
          typeof address === 'string' && isAddress(address)
            ? [getAddress(address)]
            : [])
      : []
    return [{
      addresses,
      avatarUrl: stringOrNull(candidate.avatarUrl, 2_048),
      displayName: stringOrNull(candidate.displayName, 50),
      fid: candidate.fid as number,
      username: stringOrNull(candidate.username, 64),
    }]
  })
  return {
    nextCursor: typeof record.nextCursor === 'string'
      ? record.nextCursor || null
      : null,
    users,
  }
}

function stringOrNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}
