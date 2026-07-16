import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWK, JWTVerifyGetKey, KeyLike } from 'jose'

const QUICK_AUTH_ORIGIN = 'https://auth.farcaster.xyz'
const quickAuthJwks = createRemoteJWKSet(
  new URL(`${QUICK_AUTH_ORIGIN}/.well-known/jwks.json`),
  { timeoutDuration: 5_000 },
)

type JwtVerificationKey = JWK | JWTVerifyGetKey | KeyLike | Uint8Array

export async function verifyQuickAuthToken(
  token: string,
  domain: string,
  key: JwtVerificationKey = quickAuthJwks,
): Promise<number> {
  const options = {
    audience: domain,
    issuer: QUICK_AUTH_ORIGIN,
  }
  const { payload } = typeof key === 'function'
    ? await jwtVerify(token, key, options)
    : await jwtVerify(token, key, options)
  const subject: unknown = payload.sub
  const fid = typeof subject === 'number'
    ? subject
    : typeof subject === 'string' && /^[1-9]\d*$/.test(subject)
      ? Number(subject)
      : Number.NaN
  if (!Number.isSafeInteger(fid) || fid <= 0) {
    throw new Error('Quick Auth token has no valid FID subject.')
  }
  return fid
}
