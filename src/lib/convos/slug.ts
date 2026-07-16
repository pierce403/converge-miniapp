import { ConvosInviteError } from './error'

export const MAX_CONVOS_INVITE_SLUG_CHARACTERS = 1_410_000

export function decodeConvosInviteSlug(value: string) {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new ConvosInviteError('invalid_encoding')
  }

  const output = new Uint8Array(Math.floor((value.length * 6) / 8))
  let accumulator = 0
  let availableBits = 0
  let outputOffset = 0

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    let digit: number
    if (code >= 65 && code <= 90) digit = code - 65
    else if (code >= 97 && code <= 122) digit = code - 71
    else if (code >= 48 && code <= 57) digit = code + 4
    else if (code === 45) digit = 62
    else if (code === 95) digit = 63
    else throw new ConvosInviteError('invalid_encoding')

    accumulator = (accumulator << 6) | digit
    availableBits += 6
    if (availableBits >= 8) {
      availableBits -= 8
      output[outputOffset] = (accumulator >> availableBits) & 0xff
      outputOffset += 1
      accumulator &= availableBits === 0 ? 0 : (1 << availableBits) - 1
    }
  }

  if (accumulator !== 0 || outputOffset !== output.length) {
    throw new ConvosInviteError('invalid_encoding')
  }
  return output
}

export function normalizeConvosInviteSlug(input: string) {
  if (!input || input.length > MAX_CONVOS_INVITE_SLUG_CHARACTERS) {
    throw new ConvosInviteError('invalid_encoding')
  }

  const chunks = input.split('*')
  if (chunks.length > 1) {
    if (
      chunks.some((chunk, index) =>
        index < chunks.length - 1
          ? chunk.length !== 300
          : chunk.length < 1 || chunk.length > 300,
      )
    ) {
      throw new ConvosInviteError('invalid_encoding')
    }
  }

  const slug = chunks.join('')
  decodeConvosInviteSlug(slug)
  return slug
}
