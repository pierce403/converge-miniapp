export type StorageDurability = 'persistent' | 'best-effort'

export class XmtpStorageUnsupportedError extends Error {
  constructor(message = 'This browser does not provide the secure local storage XMTP requires.') {
    super(message)
    this.name = 'XmtpStorageUnsupportedError'
  }
}

export class XmtpStorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super('This browser could not open secure local storage for XMTP.', { cause })
    this.name = 'XmtpStorageUnavailableError'
  }
}

/**
 * Verifies the browser primitives XMTP's OPFS Worker needs before any wallet
 * signature is requested. Persistence is best effort and never blocks setup.
 */
export async function prepareXmtpStorage(): Promise<StorageDurability> {
  if (
    globalThis.isSecureContext !== true ||
    typeof Worker === 'undefined' ||
    typeof WebAssembly === 'undefined' ||
    !navigator.locks?.request ||
    !navigator.storage?.getDirectory
  ) {
    throw new XmtpStorageUnsupportedError()
  }

  try {
    await navigator.storage.getDirectory()
  } catch (error) {
    throw new XmtpStorageUnavailableError(error)
  }

  let persisted = false
  try {
    persisted = await navigator.storage.persisted?.() ?? false
    if (!persisted) persisted = await navigator.storage.persist?.() ?? false
  } catch {
    // Browsers may decline or omit durable-storage grants. OPFS remains usable
    // but can be evicted under storage pressure, which the UI discloses.
  }

  return persisted ? 'persistent' : 'best-effort'
}
