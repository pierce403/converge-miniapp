import { lstat, readFile, readlink, readdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requiredFiles = [
  'AGENTS.md',
  'MEMORY.md',
  'SKILLS.md',
  'README.md',
  'features.md',
  'docs/operations.md',
  'docs/privacy.md',
  'agent-memory/notes/repository-map.md',
  'agent-memory/notes/known-tooling-pitfalls.md',
  'agent-memory/people/README.md',
  'scripts/validate-skills.mjs',
]

function fail(message) {
  throw new Error(`Knowledge check failed: ${message}`)
}

async function requireFile(relativePath) {
  const path = join(repositoryRoot, relativePath)
  const stat = await lstat(path).catch(() => null)
  if (!stat?.isFile()) {
    fail(`${relativePath} is missing or is not a file`)
  }
  return readFile(path, 'utf8')
}

function parseFrontmatter(markdown, relativePath) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown)
  if (!match) {
    fail(`${relativePath} has no YAML frontmatter`)
  }
  return match[1]
}

function runGitCheckIgnore(relativePath) {
  return spawnSync('git', ['check-ignore', '--quiet', '--', relativePath], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  }).status === 0
}

for (const requiredFile of requiredFiles) {
  await requireFile(requiredFile)
}

const canonicalInstructions = await realpath(join(repositoryRoot, 'AGENTS.md'))
for (const alias of ['CLAUDE.md', 'GEMINI.md']) {
  const aliasPath = join(repositoryRoot, alias)
  const stat = await lstat(aliasPath).catch(() => null)
  if (!stat?.isSymbolicLink()) {
    fail(`${alias} must be a symlink`)
  }
  if (await readlink(aliasPath) !== 'AGENTS.md') {
    fail(`${alias} must point directly to AGENTS.md`)
  }
  if (await realpath(aliasPath) !== canonicalInstructions) {
    fail(`${alias} does not resolve to canonical AGENTS.md`)
  }
}

const catalog = await requireFile('SKILLS.md')
const catalogFrontmatter = parseFrontmatter(catalog, 'SKILLS.md')
const catalogNames = [...catalogFrontmatter.matchAll(/^  ([a-z0-9-]+):\s+\S.+$/gm)]
  .map((match) => match[1])
  .sort()

if (catalogNames.length === 0) {
  fail('SKILLS.md contains no cataloged skills')
}

const skillsRoot = join(repositoryRoot, 'skills')
const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

if (JSON.stringify(catalogNames) !== JSON.stringify(skillNames)) {
  fail(
    `SKILLS.md catalog (${catalogNames.join(', ')}) does not match skills/ (${skillNames.join(', ')})`,
  )
}

for (const skillName of skillNames) {
  const relativeSkill = `skills/${skillName}/SKILL.md`
  const markdown = await requireFile(relativeSkill)
  const frontmatter = parseFrontmatter(markdown, relativeSkill)
  const nameMatch = /^name:\s*([a-z0-9-]+)$/m.exec(frontmatter)
  const descriptionMatch = /^description:\s*(.+)$/m.exec(frontmatter)

  if (nameMatch?.[1] !== skillName) {
    fail(`${relativeSkill} name must match its directory`)
  }
  if (!descriptionMatch?.[1] || !/\buse\b|\bwhen\b/i.test(descriptionMatch[1])) {
    fail(`${relativeSkill} description must state when to use the skill`)
  }
  if (/TODO|PLACEHOLDER|example skill/i.test(markdown)) {
    fail(`${relativeSkill} still contains template text`)
  }

  const metadata = await requireFile(`skills/${skillName}/agents/openai.yaml`)
  for (const key of ['display_name', 'short_description', 'default_prompt']) {
    if (!new RegExp(`^\\s*${key}:\\s*["']?\\S`, 'm').test(metadata)) {
      fail(`skills/${skillName}/agents/openai.yaml is missing ${key}`)
    }
  }
}

const readme = await requireFile('README.md')
for (const link of ['./AGENTS.md', './MEMORY.md', './SKILLS.md']) {
  if (!readme.includes(`](${link})`)) {
    fail(`README.md does not link ${link}`)
  }
}

const logNames = (await readdir(join(repositoryRoot, 'agent-memory/logs'), {
  withFileTypes: true,
}))
  .filter(
    (entry) =>
      entry.isFile() &&
      /^\d{4}-\d{2}-\d{2}-recurse-guidance-review\.md$/.test(entry.name),
  )
  .map((entry) => entry.name)
  .sort()

if (logNames.length === 0) {
  fail('agent-memory/logs contains no dated Recurse guidance review')
}

for (const logName of logNames) {
  const relativeLog = `agent-memory/logs/${logName}`
  if (runGitCheckIgnore(relativeLog)) {
    fail(`${relativeLog} is unexpectedly ignored`)
  }
}

const latestLog = `agent-memory/logs/${logNames.at(-1)}`
const latestLogContent = await requireFile(latestLog)
for (const marker of [
  'https://recurse.bot/',
  'Page title:',
  'Review trigger:',
  'Validation:',
  '## Adopt',
  '## Adapt',
  '## Decline',
  '## Result',
]) {
  if (!latestLogContent.includes(marker)) {
    fail(`${latestLog} is missing ${marker}`)
  }
}
if (!/^- Fetched SHA-256: `[a-f0-9]{64}`$/m.test(latestLogContent)) {
  fail(`${latestLog} must contain one lowercase 64-character fetched SHA-256`)
}
const validation = /^- Validation:\s*(.+)$/m.exec(latestLogContent)?.[1].trim()
if (!validation || /^(pending|not run|unknown)\.?$/i.test(validation)) {
  fail(`${latestLog} must contain an actual validation outcome`)
}

const memory = await requireFile('MEMORY.md')
if (!memory.includes(`./${latestLog}`)) {
  fail(`MEMORY.md does not index the latest Recurse review: ${latestLog}`)
}
for (const generatedPath of ['.qmd/index.sqlite', '.codex/local-state.json']) {
  if (!runGitCheckIgnore(generatedPath)) {
    fail(`${generatedPath} should be ignored`)
  }
}

console.log(
  `Knowledge check passed: ${requiredFiles.length + 1} indexed files, 2 canonical aliases, ${skillNames.length} skills, ${logNames.length} Recurse review.`,
)
