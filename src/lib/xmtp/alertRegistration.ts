import { sdk } from '@farcaster/miniapp-sdk'

import type { XmtpMessagingSession } from './session'

type TicketResponse = {
  registration: unknown
  ticket: string
}

const TICKET_PATH = '/api/me/notifications/xmtp-ticket'
const SUBSCRIPTION_PATH = '/api/me/notifications/xmtp-subscription'
const TOKEN_WEBHOOK_RETRY_ATTEMPTS = 4

export async function syncXmtpAlertRegistration(
  session: XmtpMessagingSession,
  fid: number,
): Promise<void> {
  if (session.environment !== 'production') return
  if (!Number.isSafeInteger(fid) || fid <= 0) {
    throw new Error('Converge Mini could not identify the alert account.')
  }

  const snapshot = await session.pushSnapshot()
  const ticketRequest: RequestInit = {
    body: JSON.stringify({
      registration: {
        identity: {
          inboxId: snapshot.inboxId,
          installationId: snapshot.installationId,
        },
        registeredAt: new Date().toISOString(),
        version: 1,
        xmtp: {
          env: 'production',
          topics: snapshot.topics,
        },
      },
    }),
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }
  const ticketResponse = await fetchTicket(ticketRequest)
  if (!ticketResponse.ok) {
    throw new Error('Converge Mini could not prepare XMTP alerts.')
  }

  const enrollment = await readTicketResponse(ticketResponse)
  const signature = await session.signPushEnrollmentTicket(enrollment.ticket)
  const registrationResponse = await sdk.quickAuth.fetch(SUBSCRIPTION_PATH, {
    body: JSON.stringify({
      proof: {
        publicKey: snapshot.publicKey,
        signature,
      },
      registration: enrollment.registration,
      ticket: enrollment.ticket,
    }),
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!registrationResponse.ok) {
    throw new Error('Converge Mini could not finish XMTP alert setup.')
  }
}

async function fetchTicket(init: RequestInit): Promise<Response> {
  let response = await sdk.quickAuth.fetch(TICKET_PATH, init)
  for (
    let attempt = 1;
    response.status === 425 && attempt < TOKEN_WEBHOOK_RETRY_ATTEMPTS;
    attempt += 1
  ) {
    await wait(retryAfterMilliseconds(response.headers.get('retry-after')))
    response = await sdk.quickAuth.fetch(TICKET_PATH, init)
  }
  return response
}

function retryAfterMilliseconds(value: string | null): number {
  if (!value || !/^\d{1,2}$/.test(value)) return 1_000
  return Math.min(5, Math.max(1, Number(value))) * 1_000
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export async function disableXmtpAlertRegistration(): Promise<void> {
  const response = await sdk.quickAuth.fetch(SUBSCRIPTION_PATH, {
    cache: 'no-store',
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 410) {
    throw new Error('Converge Mini could not remove XMTP alerts.')
  }
}

async function readTicketResponse(response: Response): Promise<TicketResponse> {
  const value: unknown = await response.json()
  if (
    !value ||
    typeof value !== 'object' ||
    !('ticket' in value) ||
    typeof value.ticket !== 'string' ||
    !/^vpxet1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.ticket) ||
    value.ticket.length > 4096 ||
    !('registration' in value) ||
    !value.registration ||
    typeof value.registration !== 'object'
  ) {
    throw new Error('Converge Mini received an invalid XMTP alert ticket.')
  }
  return { registration: value.registration, ticket: value.ticket }
}
