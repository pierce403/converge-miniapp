import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFarcasterAlerts } from './useFarcasterAlerts'

const mocks = vi.hoisted(() => ({
  addMiniApp: vi.fn(),
  off: vi.fn(),
  on: vi.fn(),
}))

vi.mock('@farcaster/miniapp-sdk', () => ({
  sdk: {
    actions: {
      addMiniApp: (...args: unknown[]) => mocks.addMiniApp(...args),
    },
    off: (...args: unknown[]) => mocks.off(...args),
    on: (...args: unknown[]) => mocks.on(...args),
  },
}))

describe('useFarcasterAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mocks.addMiniApp.mockResolvedValue({
      notificationDetails: { token: 'host-secret', url: 'https://example.test' },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ available: true }),
      ok: true,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the assistance once without opening host approval automatically', async () => {
    const first = renderHook(() => useFarcasterAlerts(options()))

    await waitFor(() => expect(first.result.current.promptVisible).toBe(true))
    expect(mocks.addMiniApp).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(
      'converge-miniapp:alert-prompt-seen:v1:403',
    )).toBe('1')

    first.unmount()
    const second = renderHook(() => useFarcasterAlerts(options()))
    await waitFor(() => expect(second.result.current.available).toBe(true))

    expect(second.result.current.promptVisible).toBe(false)
  })

  it('asks the host only after a user action and retains booleans, not token details', async () => {
    const { result } = renderHook(() => useFarcasterAlerts(options()))
    await waitFor(() => expect(result.current.promptVisible).toBe(true))

    await act(() => result.current.requestAlerts())

    expect(mocks.addMiniApp).toHaveBeenCalledOnce()
    expect(result.current.added).toBe(true)
    expect(result.current.notificationsEnabled).toBe(true)
    expect(result.current.promptVisible).toBe(false)
    expect(result.current).not.toHaveProperty('notificationDetails')
  })

  it('tracks enable, disable, add, and remove events from the host', async () => {
    const { result } = renderHook(() => useFarcasterAlerts(options()))
    await waitFor(() => expect(mocks.on).toHaveBeenCalledTimes(4))

    emit('miniAppAdded', {
      notificationDetails: { token: 'do-not-retain', url: 'https://example.test' },
    })
    expect(result.current.added).toBe(true)
    expect(result.current.notificationsEnabled).toBe(true)

    emit('notificationsDisabled')
    expect(result.current.notificationsEnabled).toBe(false)

    emit('notificationsEnabled', {
      notificationDetails: { token: 'also-do-not-retain', url: 'https://example.test' },
    })
    expect(result.current.notificationsEnabled).toBe(true)

    emit('miniAppRemoved')
    expect(result.current.added).toBe(false)
    expect(result.current.notificationsEnabled).toBe(false)
  })

  it('does not offer setup until the backend reports complete availability', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ available: false }),
      ok: true,
    } as unknown as Response)
    const { result } = renderHook(() => useFarcasterAlerts(options()))

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(result.current.available).toBe(false)
    expect(result.current.promptVisible).toBe(false)

    await act(() => result.current.requestAlerts())
    expect(mocks.addMiniApp).not.toHaveBeenCalled()
  })

  it('turns a rejected host prompt into recoverable menu guidance', async () => {
    const rejection = new Error('rejected')
    rejection.name = 'AddMiniApp.RejectedByUser'
    mocks.addMiniApp.mockRejectedValue(rejection)
    const { result } = renderHook(() => useFarcasterAlerts(options()))
    await waitFor(() => expect(result.current.promptVisible).toBe(true))

    await act(() => result.current.requestAlerts())

    expect(result.current.promptVisible).toBe(true)
    expect(result.current.error).toMatch(/canceled.*identity menu/i)
  })
})

function options() {
  return {
    canAddMiniApp: true,
    canPrompt: true,
    fid: 403,
    initiallyAdded: false,
    initiallyNotificationsEnabled: false,
  }
}

function emit(event: string, payload?: unknown): void {
  const listener = mocks.on.mock.calls.find(([name]) => name === event)?.[1] as
    ((value?: unknown) => void) | undefined
  if (!listener) throw new Error(`Missing ${event} listener`)
  act(() => listener(payload))
}
