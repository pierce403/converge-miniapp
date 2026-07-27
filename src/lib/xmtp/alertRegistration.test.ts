import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  revokeXmtpAlertRegistration,
  syncXmtpAlertRegistration,
} from './alertRegistration'
import {
  formatXmtpAlertRegistrationError,
  XmtpAlertRegistrationError,
} from './alertRegistrationError'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@farcaster/miniapp-sdk', () => ({
  sdk: { quickAuth: { fetch: mocks.fetch } },
}))

const snapshot = {
  inboxId: 'ab'.repeat(32),
  installationId: 'cd'.repeat(32),
  publicKey: 'public-key',
  topics: [{
    hmacKeys: [{ epoch: 7, key: 'hmac-key' }],
    topic: `/xmtp/mls/1/g-${'12'.repeat(16)}/proto`,
  }],
}

function session(environment = 'production') {
  return {
    environment,
    pushSnapshot: vi.fn().mockResolvedValue(snapshot),
    signPushEnrollmentTicket: vi.fn().mockResolvedValue('installation-signature'),
  }
}

describe('XMTP alert registration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('gets an app-approved ticket, signs it locally, and submits the proof', async () => {
    const registration = {
      delivery: {
        kind: 'https_callback',
        url: 'https://miniapp.converge.cv/api/internal/xmtp-notification',
      },
      identity: {
        inboxId: snapshot.inboxId,
        installationId: snapshot.installationId,
      },
      notification: { inboxHandle: 'opaque-route-id' },
      version: 1,
      xmtp: { env: 'production', topics: snapshot.topics },
    }
    mocks.fetch
      .mockResolvedValueOnce(Response.json({
        registration,
        ticket: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
      }))
      .mockResolvedValueOnce(Response.json({ registered: true }, { status: 201 }))
    const activeSession = session()

    await syncXmtpAlertRegistration(activeSession as never, 403)

    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/me/notifications/xmtp-ticket',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(activeSession.signPushEnrollmentTicket).toHaveBeenCalledWith(
      `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
    )
    const finalBody = JSON.parse(mocks.fetch.mock.calls[1]?.[1]?.body as string)
    expect(finalBody).toEqual({
      proof: {
        publicKey: snapshot.publicKey,
        signature: 'installation-signature',
      },
      registration,
      ticket: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
    })
    expect(JSON.stringify(finalBody)).not.toMatch(/message|sender|conversationId/)
  })

  it('does not register non-production XMTP installations', async () => {
    const inactiveSession = session('dev')
    await syncXmtpAlertRegistration(inactiveSession as never, 403)
    expect(inactiveSession.pushSnapshot).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('revokes stale inbox-wide state when the inbox has no Allowed topics', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const activeSession = session()
    activeSession.pushSnapshot.mockResolvedValue({
      ...snapshot,
      topics: [],
    })

    await syncXmtpAlertRegistration(activeSession as never, 403)

    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/me/notifications/xmtp-subscription',
      { cache: 'no-store', method: 'DELETE' },
    )
    expect(activeSession.signPushEnrollmentTicket).not.toHaveBeenCalled()
  })

  it('briefly retries while the native token webhook is still arriving', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, {
        headers: { 'retry-after': '1' },
        status: 425,
      }))
      .mockResolvedValueOnce(Response.json({
        registration: { version: 1 },
        ticket: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
      }))
      .mockResolvedValueOnce(Response.json({ registered: true }))
    const activeSession = session()

    await syncXmtpAlertRegistration(activeSession as never, 403)

    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(activeSession.signPushEnrollmentTicket).toHaveBeenCalledOnce()
  }, 7_000)

  it('preserves a terminal notification-token diagnostic after bounded retries', async () => {
    vi.useFakeTimers()
    try {
      mocks.fetch.mockImplementation(() => Promise.resolve(Response.json(
        { error: 'notification_token_pending' },
        { headers: { 'retry-after': '2' }, status: 425 },
      )))
      const activeSession = session()
      const rejection = expect(
        syncXmtpAlertRegistration(activeSession as never, 403),
      ).rejects.toMatchObject({
        code: 'notification_token_pending',
        name: 'XmtpAlertRegistrationError',
        stage: 'ticket_request',
        status: 425,
      })

      await vi.runAllTimersAsync()
      await rejection

      expect(mocks.fetch).toHaveBeenCalledTimes(4)
      expect(activeSession.signPushEnrollmentTicket).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconfirms an unchanged route instead of trusting stale browser state', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({
        registration: { version: 1 },
        ticket: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
      }))
      .mockResolvedValueOnce(Response.json({ registered: true }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({
        registration: { version: 1 },
        ticket: `vpxet1.${'c'.repeat(20)}.${'d'.repeat(43)}`,
      }))
      .mockResolvedValueOnce(Response.json({ registered: true }, { status: 201 }))
    const activeSession = session()

    await syncXmtpAlertRegistration(activeSession as never, 403)
    await syncXmtpAlertRegistration(activeSession as never, 403)

    expect(mocks.fetch).toHaveBeenCalledTimes(4)
    expect(activeSession.signPushEnrollmentTicket).toHaveBeenCalledTimes(2)
  })

  it('does not reuse one Farcaster account registration for another account', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({
        registration: { version: 1 },
        ticket: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
      }))
      .mockResolvedValueOnce(Response.json({ registered: true }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({
        registration: { version: 1 },
        ticket: `vpxet1.${'c'.repeat(20)}.${'d'.repeat(43)}`,
      }))
      .mockResolvedValueOnce(Response.json({ registered: true }, { status: 201 }))
    const activeSession = session()

    await syncXmtpAlertRegistration(activeSession as never, 403)
    await syncXmtpAlertRegistration(activeSession as never, 404)

    expect(mocks.fetch).toHaveBeenCalledTimes(4)
    expect(activeSession.signPushEnrollmentTicket).toHaveBeenCalledTimes(2)
  })

  it('never asks the installation to sign an invalid ticket response', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ ticket: 'invalid' }))
    const activeSession = session()
    await expect(
      syncXmtpAlertRegistration(activeSession as never, 403),
    ).rejects.toMatchObject({
      code: 'invalid_ticket_response',
      stage: 'ticket_response',
    })
    expect(activeSession.signPushEnrollmentTicket).not.toHaveBeenCalled()
  })

  it('reports the local ticket-signing stage without reflecting SDK details', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({
      registration: { version: 1 },
      ticket: `vpxet1.${'a'.repeat(20)}.${'b'.repeat(43)}`,
    }))
    const activeSession = session()
    activeSession.signPushEnrollmentTicket.mockRejectedValue(
      new Error('private installation detail'),
    )

    const error = await syncXmtpAlertRegistration(
      activeSession as never,
      403,
    ).catch((failure: unknown) => failure)

    expect(error).toMatchObject({
      code: 'ticket_signature_failed',
      stage: 'ticket_signature',
    })
    expect(formatXmtpAlertRegistrationError(error)).toBe(
      'This XMTP installation could not sign its alert enrollment ticket. (stage: ticket signature; code: ticket_signature_failed)',
    )
    expect(formatXmtpAlertRegistrationError(error)).not.toContain(
      'private installation detail',
    )
  })

  it('uses only allowlisted response diagnostics', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(
      { error: 'ticket_vpxet1.secret-value' },
      { status: 503 },
    ))
    const activeSession = session()

    const error = await syncXmtpAlertRegistration(
      activeSession as never,
      403,
    ).catch((failure: unknown) => failure)
    const notice = formatXmtpAlertRegistrationError(error)

    expect(error).toMatchObject({
      code: 'notification_unavailable',
      stage: 'ticket_request',
      status: 503,
    })
    expect(notice).toBe(
      'The alert service was unavailable while registration was in progress. Try again online shortly. (stage: ticket request; code: notification_unavailable; HTTP 503)',
    )
    expect(notice).not.toContain('ticket_vpxet1.secret-value')
  })

  it('never reflects an unknown exception into the user-facing diagnostic', () => {
    const notice = formatXmtpAlertRegistrationError(
      new Error('inbox abcd ticket vpxet1.secret signature private'),
    )

    expect(notice).toBe(
      'Farcaster alerts are on, but this inbox could not finish alert registration. Reopen Converge Mini online and try again. (stage: alert sync; code: unknown)',
    )
    expect(notice).not.toMatch(/abcd|vpxet1|signature|private/)
  })

  it('exposes the confirmed missing-token boundary in actionable fixed copy', () => {
    const notice = formatXmtpAlertRegistrationError(
      new XmtpAlertRegistrationError(
        'ticket_request',
        'notification_token_pending',
        425,
      ),
    )

    expect(notice).toBe(
      'Farcaster reports alerts are on, but Converge Mini has not received a signed notification token for this installation. Turn alerts off and on, or remove and re-add the Mini App. (stage: ticket request; code: notification_token_pending; HTTP 425)',
    )
  })

  it('preserves an explicit account-wide route revocation operation', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await revokeXmtpAlertRegistration()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/me/notifications/xmtp-subscription',
      { cache: 'no-store', method: 'DELETE' },
    )
  })
})
