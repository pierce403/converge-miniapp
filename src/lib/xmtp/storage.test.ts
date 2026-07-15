import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  prepareXmtpStorage,
  XmtpStorageUnavailableError,
  XmtpStorageUnsupportedError,
} from './storage'

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext')
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')

const getDirectory = vi.fn()
const persist = vi.fn()
const persisted = vi.fn()

describe('prepareXmtpStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'isSecureContext', {
      configurable: true,
      value: true,
    })
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: class Worker {},
    })
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: vi.fn() },
    })
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory, persist, persisted },
    })
    getDirectory.mockResolvedValue({})
    persist.mockResolvedValue(false)
    persisted.mockResolvedValue(false)
  })

  it('blocks before wallet work when a required browser primitive is missing', async () => {
    Reflect.deleteProperty(globalThis, 'Worker')

    await expect(prepareXmtpStorage()).rejects.toBeInstanceOf(
      XmtpStorageUnsupportedError,
    )
    expect(getDirectory).not.toHaveBeenCalled()
  })

  it('wraps an OPFS open failure without exposing its raw path', async () => {
    const cause = new DOMException('private/path/to/database', 'SecurityError')
    getDirectory.mockRejectedValue(cause)

    await expect(prepareXmtpStorage()).rejects.toMatchObject({
      cause,
      name: XmtpStorageUnavailableError.name,
    })
  })

  it('returns persistent when the origin already has durable storage', async () => {
    persisted.mockResolvedValue(true)

    await expect(prepareXmtpStorage()).resolves.toBe('persistent')
    expect(persist).not.toHaveBeenCalled()
  })

  it('requests durability once and continues honestly when it is denied', async () => {
    await expect(prepareXmtpStorage()).resolves.toBe('best-effort')
    expect(persist).toHaveBeenCalledOnce()
  })

  it('treats a persistence API rejection as best-effort, not fatal', async () => {
    persisted.mockRejectedValue(new Error('not available'))

    await expect(prepareXmtpStorage()).resolves.toBe('best-effort')
  })
})

afterAll(() => {
  restoreProperty(globalThis, 'Worker', originalWorker)
  restoreProperty(globalThis, 'isSecureContext', originalSecureContext)
  restoreProperty(navigator, 'locks', originalLocks)
  restoreProperty(navigator, 'storage', originalStorage)
})

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(target, key, descriptor)
  else Reflect.deleteProperty(target, key)
}
