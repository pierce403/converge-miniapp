import { sdk } from '@farcaster/miniapp-sdk'

import type { XmtpMessagingSession } from './session'
import {
  XmtpAlertRegistrationError,
  xmtpAlertRegistrationResponseError,
} from './alertRegistrationError'

type TicketResponse = {
  registration: unknown
  signatureText: string
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
    throw new XmtpAlertRegistrationError(
      'alert_account',
      'invalid_alert_account',
    )
  }

  let snapshot: Awaited<ReturnType<XmtpMessagingSession['pushSnapshot']>>
  try {
    snapshot = await session.pushSnapshot()
  } catch {
    throw new XmtpAlertRegistrationError(
      'push_snapshot',
      'push_snapshot_failed',
    )
  }
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
  let ticketResponse: Response
  try {
    ticketResponse = await fetchTicket(ticketRequest)
  } catch {
    throw new XmtpAlertRegistrationError('ticket_request', 'network_error')
  }
  if (!ticketResponse.ok) {
    throw await xmtpAlertRegistrationResponseError(
      'ticket_request',
      ticketResponse,
    )
  }

  const enrollment = await readTicketResponse(ticketResponse)
  let signature: string
  try {
    signature = await session.signPushEnrollmentTicket(
      enrollment.signatureText,
    )
  } catch {
    throw new XmtpAlertRegistrationError(
      'ticket_signature',
      'ticket_signature_failed',
    )
  }
  let registrationResponse: Response
  try {
    registrationResponse = await sdk.quickAuth.fetch(SUBSCRIPTION_PATH, {
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
  } catch {
    throw new XmtpAlertRegistrationError(
      'subscription_request',
      'network_error',
    )
  }
  if (!registrationResponse.ok) {
    throw await xmtpAlertRegistrationResponseError(
      'subscription_request',
      registrationResponse,
    )
  }
  await readSubscriptionResponse(registrationResponse)
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

// This removes the authenticated Farcaster account's shared XMTP route. A
// single client disabling native notifications must only stop its local sync.
export async function revokeXmtpAlertRegistration(): Promise<void> {
  let response: Response
  try {
    response = await sdk.quickAuth.fetch(SUBSCRIPTION_PATH, {
      cache: 'no-store',
      method: 'DELETE',
    })
  } catch {
    throw new XmtpAlertRegistrationError('route_revocation', 'network_error')
  }
  if (!response.ok && response.status !== 410) {
    throw await xmtpAlertRegistrationResponseError(
      'route_revocation',
      response,
    )
  }
}

async function readTicketResponse(response: Response): Promise<TicketResponse> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new XmtpAlertRegistrationError(
      'ticket_response',
      'invalid_ticket_response',
    )
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('ticket' in value) ||
    typeof value.ticket !== 'string' ||
    !/^vpxet1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.ticket) ||
    value.ticket.length > 4096 ||
    !('signatureText' in value) ||
    typeof value.signatureText !== 'string' ||
    value.signatureText.length === 0 ||
    value.signatureText.length > 4096 ||
    !('registration' in value) ||
    !value.registration ||
    typeof value.registration !== 'object'
  ) {
    throw new XmtpAlertRegistrationError(
      'ticket_response',
      'invalid_ticket_response',
    )
  }
  return {
    registration: value.registration,
    signatureText: value.signatureText,
    ticket: value.ticket,
  }
}

async function readSubscriptionResponse(response: Response): Promise<void> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new XmtpAlertRegistrationError(
      'subscription_response',
      'invalid_subscription_response',
    )
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('registered' in value) ||
    value.registered !== true
  ) {
    throw new XmtpAlertRegistrationError(
      'subscription_response',
      'invalid_subscription_response',
    )
  }
}
