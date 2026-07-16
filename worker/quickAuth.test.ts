// @vitest-environment node
import { generateKeyPair, SignJWT } from 'jose'
import type { JWTPayload } from 'jose'
import { describe, expect, it } from 'vitest'

import { verifyQuickAuthToken } from './quickAuth.js'

const issuer = 'https://auth.farcaster.xyz'
const domain = 'miniapp.converge.cv'

describe('Quick Auth verification', () => {
  it('returns the numeric FID subject issued by Farcaster Quick Auth', async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA')
    const token = await new SignJWT(payloadWithSubject(8531))
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(issuer)
      .setAudience(domain)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(verifyQuickAuthToken(token, domain, publicKey)).resolves.toBe(8531)
  })

  it('accepts a canonical decimal string FID for standards compatibility', async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA')
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(issuer)
      .setAudience(domain)
      .setSubject('8531')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(verifyQuickAuthToken(token, domain, publicKey)).resolves.toBe(8531)
  })

  it('rejects a token issued for another Mini App domain', async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA')
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(issuer)
      .setAudience('wrong.example')
      .setSubject('8531')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(verifyQuickAuthToken(token, domain, publicKey)).rejects.toThrow()
  })

  it('rejects expired tokens and non-FID subjects', async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA')
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(issuer)
      .setAudience(domain)
      .setSubject('8531')
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(privateKey)
    const invalidSubject = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(issuer)
      .setAudience(domain)
      .setSubject('not-a-fid')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(verifyQuickAuthToken(expired, domain, publicKey)).rejects.toThrow()
    await expect(verifyQuickAuthToken(invalidSubject, domain, publicKey)).rejects.toThrow(
      /valid FID subject/,
    )
  })

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '0',
    '08531',
    '+8531',
    '8.531e3',
  ])('rejects invalid FID subject %j', async (subject) => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA')
    const token = await new SignJWT(payloadWithSubject(subject))
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(issuer)
      .setAudience(domain)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(verifyQuickAuthToken(token, domain, publicKey)).rejects.toThrow(
      /valid FID subject/,
    )
  })
})

function payloadWithSubject(subject: unknown): JWTPayload {
  // Farcaster emits a numeric subject even though jose models the RFC string form.
  return { sub: subject } as unknown as JWTPayload
}
