const XMTP_OPFS_LOCK_NAME = 'converge-miniapp:xmtp-opfs'

export type XmtpLease = {
  release: () => Promise<void>
}

export class XmtpWebLocksUnavailableError extends Error {
  constructor() {
    super('This browser cannot safely open XMTP because Web Locks are unavailable.')
    this.name = 'XmtpWebLocksUnavailableError'
  }
}

/**
 * Holds the single origin-wide lease required by XMTP's OPFS-backed database.
 * A null result means another tab or window already owns the lease.
 */
export async function acquireXmtpLease(): Promise<XmtpLease | null> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new XmtpWebLocksUnavailableError()
  }

  let releaseHold: (() => void) | undefined
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve
  })

  let resolveAcquired: ((acquired: boolean) => void) | undefined
  let rejectAcquired: ((reason: unknown) => void) | undefined
  const acquired = new Promise<boolean>((resolve, reject) => {
    resolveAcquired = resolve
    rejectAcquired = reject
  })

  let callbackStarted = false
  const lockTask = navigator.locks.request(
    XMTP_OPFS_LOCK_NAME,
    { ifAvailable: true, mode: 'exclusive' },
    async (lock) => {
      callbackStarted = true
      resolveAcquired?.(lock !== null)

      if (lock) {
        await hold
      }
    },
  )

  void lockTask.catch((error: unknown) => {
    if (!callbackStarted) {
      rejectAcquired?.(error)
    }
  })

  if (!(await acquired)) {
    await lockTask
    return null
  }

  let released = false

  return {
    async release() {
      if (!released) {
        released = true
        releaseHold?.()
      }

      await lockTask
    },
  }
}
