import { access } from 'node:fs/promises'

import sharp from 'sharp'

const assets = [
  ['public/mark.svg', 'public/icon-1024.png', 1024, 1024],
  ['public/mark.svg', 'public/splash-200.png', 200, 200],
  ['public/embed.svg', 'public/embed-1200x800.png', 1200, 800],
  ['public/hero.svg', 'public/hero-1200x630.png', 1200, 630],
  ['public/screenshot.svg', 'public/screenshot-1284x2778.png', 1284, 2778],
]

await Promise.all(
  assets.map(async ([source, output, width, height]) => {
    await access(source)
    await sharp(source)
      .resize(width, height)
      .flatten({ background: '#0b1f4a' })
      .png({ compressionLevel: 9, palette: true })
      .toFile(output)
  }),
)

console.log(`Generated ${assets.length} Mini App assets.`)
