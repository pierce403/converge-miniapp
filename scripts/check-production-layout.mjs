import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'

// Read-only verification: Workers Builds owns deployment. Wait until the live
// shell names this build's content-hashed entry before reviewing its layout.
const origin = 'https://miniapp.converge.cv'
const localHtml = await readFile('dist/client/index.html', 'utf8')
const entry = localHtml.match(/src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/u)?.[1]
if (!entry) throw new Error('The local production entry is missing')

let deployed = false
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(origin, {
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    })
    if (response.ok && (await response.text()).includes(`src="${entry}"`)) {
      deployed = true
      break
    }
  } catch {
    // Transient network errors do not count as evidence of deployment.
  }
  await setTimeout(10_000)
}
if (!deployed) throw new Error(`Production did not publish ${entry} within the review window`)

const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(10_000) })
const status = await health.json()
if (!health.ok || status.ok !== true || status.environment !== 'production' ||
  status.service !== 'converge-miniapp' || !status.version?.id) {
  throw new Error('Production health did not identify a healthy version')
}
console.log(`Reviewing ${entry} on Worker ${status.version.id}`)
const result = spawnSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test',
], {
  env: { ...process.env, PLAYWRIGHT_PRODUCTION_LAYOUT: '1' }, stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
