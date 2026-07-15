import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  XmtpWebLocksUnavailableError,
  acquireXmtpLease,
} from './lease'

const lockName = 'converge-miniapp:xmtp-opfs'

function installLockManager(request: LockManager['request']) {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request } satisfies Partial<LockManager>,
  })
}

describe('acquireXmtpLease', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks')
  })

  it('fails closed when the Web Locks API is unavailable', async () => {
    await expect(acquireXmtpLease()).rejects.toBeInstanceOf(
      XmtpWebLocksUnavailableError,
    )
  })

  it('uses one origin-wide lock and returns null to a second owner', async () => {
    let held = false
    const request = vi.fn(
      async (
        name: string,
        options: LockOptions,
        callback: (lock: Lock | null) => Promise<void> | void,
      ) => {
        expect(name).toBe(lockName)
        expect(options).toMatchObject({ ifAvailable: true, mode: 'exclusive' })

        if (held) {
          await callback(null)
          return
        }

        held = true
        try {
          await callback({ mode: 'exclusive', name })
        } finally {
          held = false
        }
      },
    )
    installLockManager(request as unknown as LockManager['request'])

    const firstLease = await acquireXmtpLease()
    expect(firstLease).not.toBeNull()
    await expect(acquireXmtpLease()).resolves.toBeNull()

    await firstLease?.release()
    const nextLease = await acquireXmtpLease()
    expect(nextLease).not.toBeNull()
    await nextLease?.release()
  })

  it('releases asynchronously and idempotently', async () => {
    let callbackExitCount = 0
    const request = vi.fn(
      async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => Promise<void> | void,
      ) => {
        await callback({ mode: 'exclusive', name })
        callbackExitCount += 1
      },
    )
    installLockManager(request as unknown as LockManager['request'])

    const lease = await acquireXmtpLease()
    expect(lease).not.toBeNull()
    expect(callbackExitCount).toBe(0)

    await Promise.all([lease?.release(), lease?.release()])
    expect(callbackExitCount).toBe(1)
  })
})
