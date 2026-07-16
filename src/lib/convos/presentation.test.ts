import { describe, expect, it } from 'vitest'

import {
  hasConvosControlCharacters,
  sanitizeConvosPreviewText,
} from './presentation'

describe('Convos presentation text', () => {
  it('removes direction and format controls from untrusted labels', () => {
    expect(sanitizeConvosPreviewText(
      '\u202eSpoof\u202c \u2066group\u2069',
      80,
    )).toBe('Spoof group')
  })

  it('preserves emoji joiners only for emoji presentation', () => {
    expect(sanitizeConvosPreviewText('👩‍💻', 8, true)).toBe('👩‍💻')
    expect(sanitizeConvosPreviewText('👩‍💻', 8)).toBe('👩 💻')
  })

  it('recognizes C0 and C1 controls in exact identifiers', () => {
    expect(hasConvosControlCharacters('safe-tag')).toBe(false)
    expect(hasConvosControlCharacters('bad\u0000tag')).toBe(true)
    expect(hasConvosControlCharacters('bad\u0085tag')).toBe(true)
  })
})
