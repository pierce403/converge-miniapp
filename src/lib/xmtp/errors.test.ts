import { describe, expect, it } from 'vitest'

import { classifyXmtpFailure } from './errors'

describe('classifyXmtpFailure', () => {
  it('recognizes a missing payer Gateway as application configuration', () => {
    const error = new Error('XMTP mainnet requires an authenticated payer Gateway.')
    error.name = 'XmtpGatewayConfigurationError'

    expect(classifyXmtpFailure(error, 'initialize')).toEqual({
      kind: 'configuration',
      message: 'Converge Mini is not configured for this XMTP network yet. No XMTP signature was requested and no inbox was changed.',
    })
  })

  it('recognizes a nested wallet cancellation without exposing provider text', () => {
    const failure = classifyXmtpFailure({
      cause: { code: 4001, message: 'provider-specific rejection details' },
      message: 'outer failure',
    }, 'register')

    expect(failure).toMatchObject({ kind: 'wallet-rejected' })
    expect(failure.message).not.toMatch(/provider-specific/)
  })

  it('recognizes the pinned installation-limit text and redacts the inbox ID', () => {
    const failure = classifyXmtpFailure(new Error(
      'Cannot register a new installation because the InboxID secret-inbox-id has already registered 10 installations. Please revoke existing installations first.',
    ), 'register')

    expect(failure.kind).toBe('installation-limit')
    expect(failure.message).toMatch(/maximum number of active installations/)
    expect(failure.message).not.toContain('secret-inbox-id')
  })

  it('distinguishes the permanent inbox update limit', () => {
    const failure = classifyXmtpFailure({ message: 'inbox log is full' }, 'register')

    expect(failure.kind).toBe('inbox-update-limit')
    expect(failure.message).toMatch(/permanent identity-update limit/)
  })

  it.each([
    ['storage-contention', { message: 'database is already in use' }],
    ['storage-full', { cause: { name: 'QuotaExceededError' }, message: 'write failed' }],
    ['storage-denied', { name: 'NotAllowedError', message: 'private detail' }],
    ['storage-corrupt', { message: 'database disk image is malformed at page 403' }],
  ] as const)('classifies %s from structured-clone-shaped errors', (kind, error) => {
    const failure = classifyXmtpFailure(error, 'initialize')

    expect(failure.kind).toBe(kind)
    expect(failure.message).not.toMatch(/page 403|private detail/)
  })

  it('recognizes a blocked OPFS preflight through nested causes', () => {
    const failure = classifyXmtpFailure({
      cause: { name: 'SecurityError', message: 'Access denied for an internal path' },
      message: 'This browser could not open secure local storage for XMTP.',
      name: 'XmtpStorageUnavailableError',
    }, 'preflight')

    expect(failure.kind).toBe('storage-denied')
    expect(failure.message).not.toMatch(/internal path/)
  })

  it('never returns an unknown raw SDK or database message', () => {
    const failure = classifyXmtpFailure(
      new Error('opaque database detail containing a private identifier'),
      'sync',
    )

    expect(failure).toEqual({
      kind: 'unknown',
      message: 'XMTP could not complete that operation.',
    })
  })
})
