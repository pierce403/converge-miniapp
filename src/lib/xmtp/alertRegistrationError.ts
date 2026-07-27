export type XmtpAlertRegistrationStage =
  | 'alert_account'
  | 'push_snapshot'
  | 'route_revocation'
  | 'ticket_request'
  | 'ticket_response'
  | 'ticket_signature'
  | 'subscription_request'

export type XmtpAlertRegistrationCode =
  | 'invalid_alert_account'
  | 'push_snapshot_failed'
  | 'network_error'
  | 'invalid_request'
  | 'unauthorized'
  | 'not_found'
  | 'method_not_allowed'
  | 'notification_token_pending'
  | 'notification_route_gone'
  | 'rate_limited'
  | 'notification_unavailable'
  | 'invalid_ticket_response'
  | 'ticket_signature_failed'
  | 'request_failed'

const responseCodes = new Set<XmtpAlertRegistrationCode>([
  'invalid_request',
  'unauthorized',
  'not_found',
  'method_not_allowed',
  'notification_token_pending',
  'notification_route_gone',
  'rate_limited',
  'notification_unavailable',
])

const stageLabels: Record<XmtpAlertRegistrationStage, string> = {
  alert_account: 'alert account',
  push_snapshot: 'push snapshot',
  route_revocation: 'route revocation',
  ticket_request: 'ticket request',
  ticket_response: 'ticket response',
  ticket_signature: 'ticket signature',
  subscription_request: 'subscription request',
}

const explanations: Record<XmtpAlertRegistrationCode, string> = {
  invalid_alert_account:
    'Converge Mini could not identify the Farcaster account for alerts.',
  push_snapshot_failed:
    'Converge Mini could not prepare this inbox’s current XMTP alert topics.',
  network_error:
    'Converge Mini could not reach its alert API. Check your connection and reopen the Mini App.',
  invalid_request:
    'Converge Mini’s XMTP alert snapshot was rejected. Reopen online; if this persists, report the diagnostic below.',
  unauthorized:
    'Farcaster could not authenticate this alert request. Reopen Converge Mini from its canonical Farcaster entry and try again.',
  not_found:
    'This Converge Mini build could not find its alert API. Close and reopen the Mini App after deployment finishes.',
  method_not_allowed:
    'This Converge Mini build and its alert API do not match. Close and reopen the Mini App after deployment finishes.',
  notification_token_pending:
    'Farcaster reports alerts are on, but Converge Mini has not received a signed notification token for this installation. Turn alerts off and on, or remove and re-add the Mini App.',
  notification_route_gone:
    'The alert route expired before registration finished. Reopen Converge Mini to create a fresh route.',
  rate_limited:
    'Alert registration was rate-limited. Wait one minute, then reopen Converge Mini.',
  notification_unavailable:
    'The alert service was unavailable while registration was in progress. Try again online shortly.',
  invalid_ticket_response:
    'Converge Mini received an invalid XMTP alert enrollment ticket.',
  ticket_signature_failed:
    'This XMTP installation could not sign its alert enrollment ticket.',
  request_failed:
    'The alert API returned an unexpected response while registration was in progress.',
}

export class XmtpAlertRegistrationError extends Error {
  readonly code: XmtpAlertRegistrationCode
  readonly stage: XmtpAlertRegistrationStage
  readonly status: number | undefined

  constructor(
    stage: XmtpAlertRegistrationStage,
    code: XmtpAlertRegistrationCode,
    status?: number,
  ) {
    super('XMTP alert registration failed.')
    this.name = 'XmtpAlertRegistrationError'
    this.stage = stage
    this.code = code
    this.status = status
  }
}

export async function xmtpAlertRegistrationResponseError(
  stage: XmtpAlertRegistrationStage,
  response: Response,
): Promise<XmtpAlertRegistrationError> {
  const responseCode = await readResponseCode(response)
  return new XmtpAlertRegistrationError(
    stage,
    responseCode ?? codeForStatus(response.status),
    response.status,
  )
}

export function formatXmtpAlertRegistrationError(error: unknown): string {
  if (!(error instanceof XmtpAlertRegistrationError)) {
    return 'Farcaster alerts are on, but this inbox could not finish alert registration. Reopen Converge Mini online and try again. (stage: alert sync; code: unknown)'
  }

  const status = error.status === undefined ? '' : `; HTTP ${error.status}`
  return `${explanations[error.code]} (stage: ${stageLabels[error.stage]}; code: ${error.code}${status})`
}

async function readResponseCode(
  response: Response,
): Promise<XmtpAlertRegistrationCode | null> {
  try {
    const value: unknown = await response.json()
    if (
      value &&
      typeof value === 'object' &&
      'error' in value &&
      typeof value.error === 'string' &&
      responseCodes.has(value.error as XmtpAlertRegistrationCode)
    ) {
      return value.error as XmtpAlertRegistrationCode
    }
  } catch {
    // Status still supplies a safe diagnostic when the body is absent or invalid.
  }
  return null
}

function codeForStatus(status: number): XmtpAlertRegistrationCode {
  if (status === 400 || status === 413 || status === 415) {
    return 'invalid_request'
  }
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 405) return 'method_not_allowed'
  if (status === 410) return 'notification_route_gone'
  if (status === 425) return 'notification_token_pending'
  if (status === 429) return 'rate_limited'
  if (status === 503) return 'notification_unavailable'
  return 'request_failed'
}
