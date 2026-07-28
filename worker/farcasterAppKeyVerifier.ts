import {
  signedKeyRequestAbi,
  type VerifyAppKey,
  type VerifyAppKeyResult,
} from '@farcaster/miniapp-node'
import * as AbiParameters from 'ox/AbiParameters'
import { z } from 'zod'

export type FarcasterAppKeyVerifierFailure =
  | 'app_key_metadata'
  | 'current_network_non_200'
  | 'current_network_response'
  | 'current_network_verifier'

export class FarcasterAppKeyVerifierError extends Error {
  override readonly name = 'Converge.FarcasterAppKeyVerifierError'
  readonly failure: FarcasterAppKeyVerifierFailure

  constructor(
    failure: FarcasterAppKeyVerifierFailure,
    options?: ErrorOptions,
  ) {
    super('Farcaster app-key verification failed.', options)
    this.failure = failure
  }
}

const hubResponseSchema = z.object({
  events: z.array(
    z.object({
      signerEventBody: z.object({
        key: z.string(),
        metadata: z.string(),
      }),
    }),
  ),
})
const MAX_REDIRECTS = 2

/**
 * Worker-native equivalent of the verifier shipped in miniapp-node 0.2.0.
 *
 * The upstream implementation passes a Node Buffer into its ABI decoder and
 * lets runtime/provider failures escape without a stable error category. Keep
 * Farcaster's JFS verification in the official package, but make this small
 * current-network lookup portable and diagnosable.
 */
export function createWorkerVerifyAppKeyWithHub(
  hubUrl: string,
  requestOptions?: RequestInit,
): VerifyAppKey {
  return async (
    fid: number,
    appKey: string,
  ): Promise<VerifyAppKeyResult> => {
    const url = new URL('/v1/onChainSignersByFid', hubUrl)
    url.searchParams.set('fid', fid.toString())

    let response: Response
    try {
      response = await fetchWithSafeNeynarRedirects(url, requestOptions)
    } catch (error) {
      throw verifierError('current_network_verifier', error)
    }
    if (response.status !== 200) {
      await response.body?.cancel()
      throw verifierError('current_network_non_200')
    }

    let responseJson: unknown
    try {
      responseJson = await response.json()
    } catch (error) {
      throw verifierError('current_network_response', error)
    }
    const parsedResponse = hubResponseSchema.safeParse(responseJson)
    if (!parsedResponse.success) {
      throw verifierError('current_network_response', parsedResponse.error)
    }

    const appKeyLower = appKey.toLowerCase()
    const signerEvent = parsedResponse.data.events.find(
      (event) => event.signerEventBody.key.toLowerCase() === appKeyLower,
    )
    if (!signerEvent) return { valid: false }

    try {
      const decoded = AbiParameters.decode(
        signedKeyRequestAbi,
        decodeBase64(signerEvent.signerEventBody.metadata),
      )
      if (decoded.length !== 1) throw new Error('Unexpected tuple count.')
      const appFid = Number(decoded[0].requestFid)
      if (!Number.isSafeInteger(appFid) || appFid <= 0) {
        throw new Error('Invalid application FID.')
      }
      return { appFid, valid: true }
    } catch (error) {
      throw verifierError('app_key_metadata', error)
    }
  }
}

async function fetchWithSafeNeynarRedirects(
  initialUrl: URL,
  requestOptions?: RequestInit,
): Promise<Response> {
  let url = initialUrl
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetch(url, {
      ...requestOptions,
      redirect: 'manual',
    })
    if (response.status < 300 || response.status >= 400) return response

    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new Error('Unsafe current-network redirect.')
    }
    const nextUrl = new URL(location, url)
    if (
      nextUrl.protocol !== 'https:' ||
      nextUrl.port !== '' ||
      nextUrl.username !== '' ||
      nextUrl.password !== '' ||
      nextUrl.hash !== '' ||
      !isNeynarHostname(nextUrl.hostname)
    ) throw new Error('Unsafe current-network redirect.')
    url = nextUrl
  }
  throw new Error('Too many current-network redirects.')
}

function isNeynarHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'neynar.com' || normalized.endsWith('.neynar.com')
}

function decodeBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  ) throw new Error('Invalid base64.')
  const decoded = atob(value)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function verifierError(
  failure: FarcasterAppKeyVerifierFailure,
  cause?: unknown,
): FarcasterAppKeyVerifierError {
  return new FarcasterAppKeyVerifierError(
    failure,
    cause instanceof Error ? { cause } : undefined,
  )
}
