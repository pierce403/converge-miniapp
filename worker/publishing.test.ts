// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  domainManifestSchema,
  domainMiniAppConfigSchema,
  safeParseFrameEmbed,
  safeParseMiniAppEmbed,
} from '@farcaster/miniapp-core'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { handleRequest, type AppEnv } from './index.js'

const env = {
  APP_ENV: 'production',
  APP_VERSION: '0.1.0',
  CANONICAL_ORIGIN: 'https://miniapp.converge.cv',
  CF_VERSION_METADATA: {
    id: 'test-version',
    tag: 'test',
    timestamp: '2026-07-14T19:00:00.000Z',
  },
  FARCASTER_ACCOUNT_ASSOCIATION_HEADER: 'header_value',
  FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD:
    'eyJkb21haW4iOiJtaW5pYXBwLmNvbnZlcmdlLmN2In0',
  FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE: 'signature_value',
} satisfies AppEnv

const bootstrapEnv = {
  APP_ENV: env.APP_ENV,
  APP_VERSION: env.APP_VERSION,
  CANONICAL_ORIGIN: env.CANONICAL_ORIGIN,
  CF_VERSION_METADATA: env.CF_VERSION_METADATA,
} satisfies AppEnv

describe('Farcaster publishing contract', () => {
  it('serves schema-valid metadata before account association is configured', async () => {
    const response = handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      bootstrapEnv,
    )
    const manifest = await response.json() as {
      accountAssociation?: unknown
      miniapp?: unknown
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(manifest.accountAssociation).toBeUndefined()
    const parsed = domainMiniAppConfigSchema.safeParse(manifest.miniapp)
    expect(parsed.success, parsed.error?.message).toBe(true)
    expect(parsed.data?.noindex).toBe(true)
  })

  it('matches the official manifest schema', async () => {
    const response = handleRequest(
      new Request('https://miniapp.converge.cv/.well-known/farcaster.json'),
      env,
    )
    const manifest = await response.json()

    const parsed = domainManifestSchema.safeParse(manifest)
    expect(parsed.success, parsed.error?.message).toBe(true)
    expect(parsed.data?.miniapp?.noindex).toBe(true)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=300, must-revalidate',
    )
  })

  it('keeps modern and compatibility embeds schema-valid', async () => {
    const html = await readFile(resolve('index.html'), 'utf8')
    const miniapp = JSON.parse(metaContent(html, 'fc:miniapp'))
    const frame = JSON.parse(metaContent(html, 'fc:frame'))

    const parsedMiniApp = safeParseMiniAppEmbed(miniapp)
    const parsedFrame = safeParseFrameEmbed(frame)
    expect(parsedMiniApp.success, parsedMiniApp.error?.message).toBe(true)
    expect(parsedFrame.success, parsedFrame.error?.message).toBe(true)
    expect(miniapp.button.action.url).toBe('https://miniapp.converge.cv/')
    expect(frame.version).toBe('1')
  })

  it('ships opaque PNG publishing assets at the declared dimensions', async () => {
    const expected = new Map([
      ['icon-1024.png', [1024, 1024]],
      ['splash-200.png', [200, 200]],
      ['embed-1200x800.png', [1200, 800]],
      ['hero-1200x630.png', [1200, 630]],
      ['screenshot-1284x2778.png', [1284, 2778]],
    ])

    for (const [name, [width, height]] of expected) {
      const metadata = await sharp(resolve('public', name)).metadata()
      expect(metadata).toMatchObject({
        format: 'png',
        hasAlpha: false,
        height,
        width,
      })
    }
  })
})

function metaContent(html: string, name: string): string {
  const tag = html.match(new RegExp(`<meta[^>]+name="${name}"[^>]*>`, 's'))?.[0]
  const content = tag?.match(/content='([^']+)'/s)?.[1]
  if (!content) throw new Error(`Missing ${name} metadata`)
  return content
}
