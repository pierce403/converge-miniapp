import { getAddress, isAddress } from 'viem'

export type FarcasterFollow = {
  addresses: `0x${string}`[]
  avatarUrl: string | null
  displayName: string | null
  fid: number
  username: string | null
}

export type FarcasterFollowingPage = {
  nextCursor: string | null
  users: FarcasterFollow[]
}

const NEYNAR_FOLLOWING_URL = 'https://api.neynar.com/v2/farcaster/following/'
const MAX_CURSOR_LENGTH = 1_024
const MAX_PROFILE_TEXT_LENGTH = 256

export async function fetchFarcasterFollowing(
  fid: number,
  apiKey: string,
  cursor: string | null,
  fetcher: typeof fetch = fetch,
): Promise<FarcasterFollowingPage> {
  if (!Number.isSafeInteger(fid) || fid <= 0 || !apiKey.trim()) {
    throw new Error('Farcaster following is not configured.')
  }
  if (cursor && cursor.length > MAX_CURSOR_LENGTH) {
    throw new Error('Invalid Farcaster following cursor.')
  }
  const url = new URL(NEYNAR_FOLLOWING_URL)
  url.searchParams.set('fid', fid.toString())
  url.searchParams.set('viewer_fid', fid.toString())
  url.searchParams.set('sort_type', 'desc_chron')
  url.searchParams.set('limit', '100')
  if (cursor) url.searchParams.set('cursor', cursor)

  const response = await fetcher(url, {
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey.trim(),
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Farcaster following is unavailable.')
  const value = await response.json() as unknown
  return parseFollowingPage(value)
}

function parseFollowingPage(value: unknown): FarcasterFollowingPage {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Farcaster following response.')
  }
  const record = value as Record<string, unknown>
  const entries = Array.isArray(record.users) ? record.users : []
  const users = entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const user = (entry as Record<string, unknown>).user
    if (!user || typeof user !== 'object') return []
    const profile = user as Record<string, unknown>
    if (!Number.isSafeInteger(profile.fid) || (profile.fid as number) <= 0) return []
    const verified = profile.verified_addresses
    const ethAddresses = verified && typeof verified === 'object'
      ? (verified as Record<string, unknown>).eth_addresses
      : []
    const addresses = Array.isArray(ethAddresses)
      ? [...new Set(ethAddresses.flatMap((address) =>
          typeof address === 'string' && isAddress(address)
            ? [getAddress(address)]
            : []))]
      : []
    return [{
      addresses,
      avatarUrl: boundedString(profile.pfp_url),
      displayName: boundedString(profile.display_name),
      fid: profile.fid as number,
      username: boundedString(profile.username),
    }]
  })
  const next = record.next
  const cursor = next && typeof next === 'object'
    ? (next as Record<string, unknown>).cursor
    : null
  return {
    nextCursor: typeof cursor === 'string' && cursor.length <= MAX_CURSOR_LENGTH
      ? cursor || null
      : null,
    users,
  }
}

function boundedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_PROFILE_TEXT_LENGTH) : null
}
