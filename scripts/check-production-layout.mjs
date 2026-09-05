import { spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

// Read-only verification: Workers Builds owns deployment. Its public build
// configuration differs from CI (for example WalletConnect), so bundle hashes
// cannot be compared across the two environments. Bind delivery to the Git SHA
// through Cloudflare's check, then test the actual deployed shell and SDK.
const origin = 'https://miniapp.converge.cv'
const sha = process.env.GITHUB_SHA
if (!/^[a-f0-9]{40}$/u.test(sha ?? '')) throw new Error('GITHUB_SHA is required')
const repository = 'https://api.github.com/repos/pierce403/converge-miniapp'

async function json(url) {
  const response = await fetch(url, {
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Review request returned ${response.status}`)
  return response.json()
}

let deployment
for (let attempt = 0; attempt < 40; attempt += 1) {
  let checks
  try {
    checks = await json(`${repository}/commits/${sha}/check-runs`)
  } catch {
    // Transient network errors do not count as evidence of deployment.
  }
  const build = checks?.check_runs?.find((check) =>
    check.head_sha === sha && check.name === 'Workers Builds: converge-miniapp' &&
    check.app?.slug === 'cloudflare-workers-and-pages')
  if (build?.status === 'completed') {
    if (build.conclusion !== 'success') throw new Error('The Cloudflare build failed')
    deployment = build
    break
  }
  await setTimeout(10_000)
}
if (!deployment) throw new Error(`Cloudflare did not deploy ${sha} within the review window`)

const head = await json(`${repository}/git/ref/heads/main`)
if (head.object?.sha !== sha) throw new Error('Main changed before production review')
const status = await json(`${origin}/api/health`)
if (status.ok !== true || status.environment !== 'production' ||
  status.service !== 'converge-miniapp' || !status.version?.id ||
  !(Date.parse(status.version.deployedAt) >= Date.parse(deployment.started_at))) {
  throw new Error('Production health did not identify a healthy version')
}
console.log(`Reviewing commit ${sha} on Worker ${status.version.id}`)
const result = spawnSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test',
], {
  env: { ...process.env, PLAYWRIGHT_PRODUCTION_LAYOUT: '1' }, stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
