import type {
  ContentCodec,
  EncodedContent,
} from '@xmtp/content-type-primitives'
import { normalizeConvosInviteSlug } from './slug'

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const MAX_ENCODED_JOIN_REQUEST_BYTES = 1_410_128

export const CONVOS_JOIN_REQUEST_CONTENT_TYPE = {
  authorityId: 'convos.org',
  typeId: 'join_request',
  versionMajor: 1,
  versionMinor: 0,
} as const

export type ConvosJoinRequest = {
  inviteSlug: string
}

function normalizedRequest(content: ConvosJoinRequest) {
  if (
    typeof content !== 'object' ||
    content === null ||
    typeof content.inviteSlug !== 'string'
  ) {
    throw new Error('Invalid Convos join request.')
  }
  return { inviteSlug: normalizeConvosInviteSlug(content.inviteSlug) }
}

export const convosJoinRequestCodec: ContentCodec<ConvosJoinRequest> = {
  contentType: CONVOS_JOIN_REQUEST_CONTENT_TYPE,

  encode(content) {
    const request = normalizedRequest(content)
    const bytes = utf8Encoder.encode(JSON.stringify(request))
    if (bytes.length > MAX_ENCODED_JOIN_REQUEST_BYTES) {
      throw new Error('Invalid Convos join request.')
    }

    return {
      type: CONVOS_JOIN_REQUEST_CONTENT_TYPE,
      parameters: {},
      fallback: request.inviteSlug,
      content: bytes,
    }
  },

  decode(content: EncodedContent) {
    if (
      content.content.length === 0 ||
      content.content.length > MAX_ENCODED_JOIN_REQUEST_BYTES
    ) {
      throw new Error('Invalid Convos join request.')
    }

    try {
      const parsed = JSON.parse(utf8Decoder.decode(content.content)) as unknown
      return normalizedRequest(parsed as ConvosJoinRequest)
    } catch {
      throw new Error('Invalid Convos join request.')
    }
  },

  fallback(content) {
    return normalizedRequest(content).inviteSlug
  },

  shouldPush() {
    return true
  },
}
