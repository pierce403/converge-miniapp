export type ConvosInviteErrorCode =
  | 'invalid_input'
  | 'unsupported_link'
  | 'invalid_encoding'
  | 'invalid_compression'
  | 'invalid_payload'
  | 'invalid_signature'
  | 'invite_expired'
  | 'conversation_expired'

const errorMessages: Record<ConvosInviteErrorCode, string> = {
  invalid_input: 'Enter a Convos invite link or code.',
  unsupported_link: 'That is not a supported Convos invite link.',
  invalid_encoding: 'That Convos invite code is malformed.',
  invalid_compression: 'That Convos invite could not be safely opened.',
  invalid_payload: 'That Convos invite is invalid.',
  invalid_signature: 'That Convos invite has an invalid signature.',
  invite_expired: 'That Convos invite has expired.',
  conversation_expired: 'That Convos conversation has expired.',
}

export class ConvosInviteError extends Error {
  readonly code: ConvosInviteErrorCode

  constructor(code: ConvosInviteErrorCode) {
    super(errorMessages[code])
    this.name = 'ConvosInviteError'
    this.code = code
  }
}
