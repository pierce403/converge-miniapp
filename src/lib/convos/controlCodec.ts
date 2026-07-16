import type {
  ContentCodec,
  EncodedContent,
} from '@xmtp/content-type-primitives'
import { hasConvosControlCharacters } from './presentation'

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const MAX_CONTROL_BYTES = 4096
const MAX_TAG_CHARACTERS = 4096
const MAX_MESSAGE_ID_CHARACTERS = 512

export const CONVOS_INVITE_JOIN_HANDLED_CONTENT_TYPE = {
  authorityId: 'convos.org',
  typeId: 'invite_join_handled',
  versionMajor: 1,
  versionMinor: 0,
} as const

export const CONVOS_INVITE_JOIN_ERROR_CONTENT_TYPE = {
  authorityId: 'convos.org',
  typeId: 'invite_join_error',
  versionMajor: 1,
  versionMinor: 0,
} as const

export type ConvosInviteJoinHandled = {
  handledMessageId: string
  inviteTag: string
  timestamp: string
}

export type ConvosInviteJoinErrorType =
  | 'conversation_expired'
  | 'conversation_not_found'
  | 'consent_not_allowed'
  | 'generic_failure'

export type ConvosInviteJoinError = {
  errorType: ConvosInviteJoinErrorType
  inviteTag: string
  reason?: string
  timestamp: string
}

function boundedTag(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > MAX_TAG_CHARACTERS ||
    hasConvosControlCharacters(value)
  ) throw new Error('Invalid Convos invite control.')
  return value
}

function isoTimestamp(value: unknown) {
  if (typeof value !== 'string' || value.length > 64) {
    throw new Error('Invalid Convos invite control.')
  }
  const time = Date.parse(value)
  if (!Number.isFinite(time)) throw new Error('Invalid Convos invite control.')
  return value
}

function handledContent(value: unknown): ConvosInviteJoinHandled {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Convos invite control.')
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.handledMessageId !== 'string' ||
    !record.handledMessageId ||
    record.handledMessageId.length > MAX_MESSAGE_ID_CHARACTERS
  ) throw new Error('Invalid Convos invite control.')
  return {
    handledMessageId: record.handledMessageId,
    inviteTag: boundedTag(record.inviteTag),
    timestamp: isoTimestamp(record.timestamp),
  }
}

function errorContent(value: unknown): ConvosInviteJoinError {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Convos invite control.')
  }
  const record = value as Record<string, unknown>
  if (![
    'conversation_expired',
    'conversation_not_found',
    'consent_not_allowed',
    'generic_failure',
  ].includes(record.errorType as string)) {
    throw new Error('Invalid Convos invite control.')
  }
  return {
    errorType: record.errorType as ConvosInviteJoinErrorType,
    inviteTag: boundedTag(record.inviteTag),
    timestamp: isoTimestamp(record.timestamp),
    ...(typeof record.reason === 'string' && record.reason.length <= 500
      ? { reason: record.reason }
      : {}),
  }
}

function encodeJson(value: unknown) {
  const bytes = utf8Encoder.encode(JSON.stringify(value))
  if (!bytes.length || bytes.length > MAX_CONTROL_BYTES) {
    throw new Error('Invalid Convos invite control.')
  }
  return bytes
}

function decodeJson(content: EncodedContent) {
  if (!content.content.length || content.content.length > MAX_CONTROL_BYTES) {
    throw new Error('Invalid Convos invite control.')
  }
  try {
    return JSON.parse(utf8Decoder.decode(content.content)) as unknown
  } catch {
    throw new Error('Invalid Convos invite control.')
  }
}

export const convosInviteJoinHandledCodec: ContentCodec<ConvosInviteJoinHandled> = {
  contentType: CONVOS_INVITE_JOIN_HANDLED_CONTENT_TYPE,
  encode(content) {
    const normalized = handledContent(content)
    return {
      type: CONVOS_INVITE_JOIN_HANDLED_CONTENT_TYPE,
      parameters: {},
      content: encodeJson(normalized),
    }
  },
  decode(content) {
    return handledContent(decodeJson(content))
  },
  fallback() {
    return undefined
  },
  shouldPush() {
    return false
  },
}

export const convosInviteJoinErrorCodec: ContentCodec<ConvosInviteJoinError> = {
  contentType: CONVOS_INVITE_JOIN_ERROR_CONTENT_TYPE,
  encode(content) {
    const normalized = errorContent(content)
    return {
      type: CONVOS_INVITE_JOIN_ERROR_CONTENT_TYPE,
      parameters: {},
      content: encodeJson(normalized),
    }
  },
  decode(content) {
    return errorContent(decodeJson(content))
  },
  fallback(content) {
    return content.errorType === 'generic_failure'
      ? 'Failed to join conversation'
      : 'This conversation is no longer available'
  },
  shouldPush() {
    return true
  },
}

export function convosJoinErrorMessage(error: ConvosInviteJoinError) {
  return error.errorType === 'generic_failure'
    ? 'The inviter could not add this inbox. You can send a fresh request.'
    : 'This conversation is no longer available.'
}
