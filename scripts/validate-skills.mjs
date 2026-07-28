import { access, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
const validator = join(
  codexHome,
  'skills',
  '.system',
  'skill-creator',
  'scripts',
  'quick_validate.py',
)

await access(validator).catch(() => {
  throw new Error(
    `Skill validator not found at ${validator}. Run this command from a Codex environment with the skill-creator system skill installed.`,
  )
})

const skillsRoot = join(repositoryRoot, 'skills')
const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

for (const skillName of skillNames) {
  const result = spawnSync('python3', [validator, join(skillsRoot, skillName)], {
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

console.log(`Validated ${skillNames.length} repository skills.`)
