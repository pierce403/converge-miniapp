export type XmtpFailureKind =
  | 'wallet-rejected'
  | 'unsupported-browser'
  | 'storage-contention'
  | 'storage-full'
  | 'storage-denied'
  | 'storage-corrupt'
  | 'installation-limit'
  | 'inbox-update-limit'
  | 'network'
  | 'unknown'

export type XmtpOperationStage =
  | 'preflight'
  | 'wallet'
  | 'initialize'
  | 'register'
  | 'sync'
  | 'send'

export type ClassifiedXmtpFailure = {
  kind: XmtpFailureKind
  message: string
}

type ErrorDetails = {
  codes: Set<string>
  names: Set<string>
  text: string
}

export function classifyXmtpFailure(
  error: unknown,
  stage: XmtpOperationStage,
): ClassifiedXmtpFailure {
  const details = errorDetails(error)
  const text = details.text

  if (details.codes.has('4001') || matches(text, ['user rejected', 'user denied'])) {
    return {
      kind: 'wallet-rejected',
      message: 'The wallet request was cancelled. Nothing was sent, registered, or changed.',
    }
  }

  if (matches(text, [
    'cannot register a new installation',
    'toomanyinstallations',
    'too many installations',
  ])) {
    return {
      kind: 'installation-limit',
      message: 'This XMTP inbox already has the maximum number of active installations. Revoke an old installation in another XMTP client, then return here. Converge Mini did not revoke anything automatically.',
    }
  }

  if (matches(text, ['inbox log is full', 'inboxupdatelimit'])) {
    return {
      kind: 'inbox-update-limit',
      message: 'This XMTP inbox has reached its permanent identity-update limit. Retrying or revoking another installation will not repair it, and Converge Mini changed nothing automatically.',
    }
  }

  if (
    details.names.has('xmtpstorageunsupportederror') ||
    matches(text, [
      'web locks are unavailable',
      'does not provide the secure local storage xmtp requires',
      'opfs must be initialized',
      'opfs not initialized',
    ])
  ) {
    return {
      kind: 'unsupported-browser',
      message: 'This Farcaster client or browser does not provide the secure local storage features XMTP needs. Try a current supported client without private browsing.',
    }
  }

  if (matches(text, [
    'ensure that there are no other active xmtp clients',
    'database is locked',
    'database table is locked',
    'database is already in use',
  ])) {
    return {
      kind: 'storage-contention',
      message: 'Another XMTP window or unfinished Worker is using this browser database. Close other copies of Converge Mini, then reload this one.',
    }
  }

  if (
    details.names.has('quotaexceedederror') ||
    matches(text, [
      'storagefull',
      'quota exceeded',
      'no storage space',
      'database or disk is full',
      'database is full',
    ])
  ) {
    return {
      kind: 'storage-full',
      message: 'Local browser storage is full. Free device or site storage, then reload Converge Mini. No XMTP installations were revoked.',
    }
  }

  if (
    details.names.has('securityerror') ||
    details.names.has('notallowederror') ||
    matches(text, [
      'attempt to write a readonly database',
      'read-only filesystem',
      'read only filesystem',
      'storage medium is read-only',
    ])
  ) {
    return {
      kind: 'storage-denied',
      message: 'This browser denied XMTP access to local message storage. Allow site storage and leave private browsing, then reload.',
    }
  }

  if (matches(text, [
    'database disk image is malformed',
    'file is not a database',
    'database corruption',
    'corrupt database',
    'data corruption detected',
    'malformed database schema',
  ])) {
    return {
      kind: 'storage-corrupt',
      message: 'The local XMTP message database appears damaged. Close the app before changing site data; clearing it is destructive and can consume another XMTP installation.',
    }
  }

  if (
    details.names.has('xmtpstorageunavailableerror') ||
    matches(text, ['could not open secure local storage for xmtp'])
  ) {
    return {
      kind: 'unsupported-browser',
      message: 'This browser could not open the local storage XMTP needs. Check site-storage permissions, available space, and private-browsing settings, then reload.',
    }
  }

  if (
    details.names.has('xmtpclientinitializationtimeouterror') ||
    matches(text, ['xmtp client initialization timed out'])
  ) {
    return {
      kind: 'unsupported-browser',
      message: 'XMTP storage did not finish opening in this browser. Reload Converge Mini before trying again so no second database Worker is started.',
    }
  }

  if (stage === 'wallet' && matches(text, [
    'farcaster host did not provide',
    'farcaster host does not expose',
    'farcaster wallet did not return',
    'farcaster wallet returned an invalid',
  ])) {
    return {
      kind: 'unsupported-browser',
      message: 'This Farcaster client did not provide a compatible Ethereum wallet for XMTP. Try a current supported Farcaster client.',
    }
  }

  if (matches(text, [
    'network',
    'failed to fetch',
    'fetch failed',
    'websocket',
    'offline',
    'service unavailable',
    'connection refused',
    'connection reset',
  ])) {
    return {
      kind: 'network',
      message: 'XMTP is temporarily unreachable. Saved local messages remain available; try again when the connection returns.',
    }
  }

  return {
    kind: 'unknown',
    message: 'XMTP could not complete that operation.',
  }
}

function errorDetails(error: unknown): ErrorDetails {
  const codes = new Set<string>()
  const names = new Set<string>()
  const messages: string[] = []
  const seen = new Set<object>()

  const visit = (value: unknown, depth: number) => {
    if (depth > 6) return
    if (typeof value === 'string') {
      messages.push(value.toLowerCase())
      return
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value)

    if ('name' in value && typeof value.name === 'string') {
      names.add(value.name.toLowerCase())
    }
    if ('message' in value && typeof value.message === 'string') {
      messages.push(value.message.toLowerCase())
    }
    if ('code' in value && (typeof value.code === 'string' || typeof value.code === 'number')) {
      codes.add(String(value.code).toLowerCase())
    }
    if ('cause' in value) visit(value.cause, depth + 1)
  }

  visit(error, 0)
  return { codes, names, text: messages.join('\n') }
}

function matches(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}
