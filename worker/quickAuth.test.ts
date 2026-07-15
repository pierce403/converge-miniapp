// @vitest-environment node
import { generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { verifyQuickAuthToken } from './quickAuth.js'

const issuer = 'https://auth.farcaster.xyz'
const domain = 'miniapp.converge.cv'

describe('Quick Auth verification', () => {
  it('returns only the verified FID subject', async () => {
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
})
