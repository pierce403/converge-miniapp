import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const commands = [
  ['git', ['diff', '--check', 'HEAD', '--']],
  ['npm', ['run', 'check']],
  ['npm', ['run', 'test:e2e']],
  ['git', ['diff', '--check', 'HEAD', '--']],
  ['git', ['status', '--short', '--branch']],
]

for (const [command, args] of commands) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
