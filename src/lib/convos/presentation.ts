function isControlCharacter(codePoint: number) {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
}

function isUnsafeFormatCharacter(codePoint: number, preserveEmojiJoiner: boolean) {
  if (preserveEmojiJoiner && codePoint === 0x200d) return false
  return (
    codePoint === 0x061c ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  )
}

export function hasConvosControlCharacters(value: string) {
  return Array.from(value).some((character) =>
    isControlCharacter(character.codePointAt(0)!),
  )
}

export function sanitizeConvosPreviewText(
  value: string,
  maximumCharacters: number,
  preserveEmojiJoiner = false,
) {
  const cleaned = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!
    return isControlCharacter(codePoint) ||
      isUnsafeFormatCharacter(codePoint, preserveEmojiJoiner)
      ? ' '
      : character
  })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!cleaned) return undefined
  return Array.from(cleaned).slice(0, maximumCharacters).join('')
}
