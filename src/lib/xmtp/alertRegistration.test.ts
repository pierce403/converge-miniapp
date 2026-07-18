import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  disableXmtpAlertRegistration,
  syncXmtpAlertRegistration,
} from './alertRegistration'

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
    await expect(syncXmtpAlertRegistration(activeSession as never, 403)).rejects.toThrow(
      'invalid XMTP alert ticket',
    )
    expect(activeSession.signPushEnrollmentTicket).not.toHaveBeenCalled()
  })

  it('revokes the app-owned route on opt-out', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await disableXmtpAlertRegistration()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/me/notifications/xmtp-subscription',
      { cache: 'no-store', method: 'DELETE' },
    )
  })
})
