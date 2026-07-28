// @vitest-environment node
import { encodeAbiParameters } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createWorkerVerifyAppKeyWithHub,
  FarcasterAppKeyVerifierError,
} from './farcasterAppKeyVerifier.js'

const appKey = `0x${'12'.repeat(32)}`
const metadata = Buffer.from(encodeAbiParameters(
  [{
    components: [
      { name: 'requestFid', type: 'uint256' },
      { name: 'requestSigner', type: 'address' },
      { name: 'signature', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
    ],
    type: 'tuple',
  }],
  [{
    deadline: 1n,
    requestFid: 9152n,
    requestSigner: `0x${'34'.repeat(20)}`,
    signature: '0x1234',
  }],
).slice(2), 'hex').toString('base64')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Worker Farcaster app-key verifier', () => {
  it('finds the active app key and decodes its application FID without Buffer', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      events: [{
        signerEventBody: {
          key: appKey.toUpperCase(),
          metadata,
        },
      }],
    }))
    vi.stubGlobal('fetch', fetch)

    const verifier = createWorkerVerifyAppKeyWithHub(
      'https://hub.example',
      { headers: { 'x-api-key': 'secret' } },
    )

    await expect(verifier(8531, appKey)).resolves.toEqual({
      appFid: 9152,
      valid: true,
    })
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://hub.example/v1/onChainSignersByFid?fid=8531'),
      { headers: { 'x-api-key': 'secret' } },
    )
  })

  it('returns invalid when the current signer list does not contain the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      events: [],
    })))
    const verifier = createWorkerVerifyAppKeyWithHub('https://hub.example')

    await expect(verifier(8531, appKey)).resolves.toEqual({ valid: false })
  })

  it.each([
    [
      'provider rejection',
      () => Promise.resolve(new Response('', { status: 401 })),
      'current_network_non_200',
    ],
    [
      'provider response mismatch',
      () => Promise.resolve(Response.json({ events: [{}] })),
      'current_network_response',
    ],
    [
      'app-key metadata mismatch',
      () => Promise.resolve(Response.json({
        events: [{
          signerEventBody: { key: appKey, metadata: 'not-base64!' },
        }],
      })),
      'app_key_metadata',
    ],
  ] as const)('categorizes %s without provider content', async (
    _label,
    response,
    expectedFailure,
  ) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(response))
    const verifier = createWorkerVerifyAppKeyWithHub('https://hub.example')

    const error = await verifier(8531, appKey).catch((caught) => caught)

    expect(error).toBeInstanceOf(FarcasterAppKeyVerifierError)
    expect(error).toMatchObject({
      failure: expectedFailure,
      message: 'Farcaster app-key verification failed.',
    })
  })
})
