import { createHash } from 'node:crypto'

const source = 'https://recurse.bot/'
const requiredHeadings = [
  'Repository Etiquette',
  'Instruction File Etiquette',
  'Memory Etiquette',
  'Skill Etiquette',
  'Weekly Advice Etiquette',
  'Etiquette Loop',
]
const jsonOutput = process.argv.includes('--json')
const includeText = process.argv.includes('--include-text')

function decodeHtml(value) {
  return value
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\s+/g, ' ')
    .trim()
}

const response = await fetch(source, {
  headers: {
    accept: 'text/html',
    'user-agent': 'converge-miniapp-recurse-advice-check/1',
  },
  redirect: 'error',
  signal: AbortSignal.timeout(15_000),
})

if (!response.ok) {
  throw new Error(`recurse.bot returned HTTP ${response.status}`)
}
if (response.url !== source) {
  throw new Error(`recurse.bot did not remain on the exact canonical URL: ${response.url}`)
}

const bytes = Buffer.from(await response.arrayBuffer())
const html = bytes.toString('utf8')
const title = decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
  .map((match) => decodeHtml(match[1]))
  .filter(Boolean)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const bodyHtml = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
const pageText = decodeHtml(
  bodyHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' '),
)

if (!title.includes("Sparkle's Agent Etiquette Guide")) {
  throw new Error(`unexpected recurse.bot page title: ${title || '(missing)'}`)
}

const missingHeadings = requiredHeadings.filter(
  (required) => !headings.some((heading) => heading.includes(required)),
)
if (missingHeadings.length > 0) {
  throw new Error(`recurse.bot is missing expected sections: ${missingHeadings.join(', ')}`)
}

const result = {
  source,
  finalUrl: response.url,
  title,
  sha256,
  headings,
  ...(includeText ? { text: pageText } : {}),
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`${title}`)
  console.log(`SHA-256: ${sha256}`)
  console.log(`Sections: ${headings.join(' | ')}`)
}
