import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMiniAppHost } from './useMiniAppHost'

const context = {
  client: {
    added: false,
    clientFid: 1,
    notificationDetails: {
      token: 'host-secret',
      url: 'https://notifications.example.test',
    },
    safeAreaInsets: { bottom: 8, left: 0, right: 0, top: 12 },
  },
  user: { fid: 403, username: 'pierce' },
}

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  context: Promise.resolve({}) as Promise<unknown>,
  isInMiniApp: vi.fn(),
  ready: vi.fn(),
}))

vi.mock('@farcaster/miniapp-sdk', () => ({
  sdk: {
    actions: { ready: (...args: unknown[]) => mocks.ready(...args) },
    get context() {
      return mocks.context
    },
    getCapabilities: (...args: unknown[]) => mocks.capabilities(...args),
    isInMiniApp: (...args: unknown[]) => mocks.isInMiniApp(...args),
  },
}))

describe('useMiniAppHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context = Promise.resolve(context)
    mocks.capabilities.mockResolvedValue(['wallet.getEthereumProvider', 'back'])
    mocks.isInMiniApp.mockResolvedValue(true)
    mocks.ready.mockResolvedValue(undefined)
  })

  it('renders standalone without calling host-only lifecycle methods', async () => {
    mocks.isInMiniApp.mockResolvedValue(false)
    const { result } = renderHook(() => useMiniAppHost())

    await waitFor(() => expect(result.current.status).toBe('standalone'))
    expect(mocks.ready).not.toHaveBeenCalled()
    expect(mocks.capabilities).not.toHaveBeenCalled()
  })

  it('marks the shell ready before waiting for context and capabilities', async () => {
    let resolveContext!: (value: typeof context) => void
    mocks.context = new Promise((resolve) => {
      resolveContext = resolve
    })
    const { result } = renderHook(() => useMiniAppHost())

    await waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce())
    expect(result.current.status).toBe('detecting')
    resolveContext(context)

    await waitFor(() => expect(result.current.status).toBe('embedded'))
    expect(result.current.context).toEqual({
      client: {
        added: false,
        notificationsEnabled: true,
        safeAreaInsets: { bottom: 8, left: 0, right: 0, top: 12 },
      },
      user: { fid: 403, username: 'pierce' },
    })
    expect(JSON.stringify(result.current.context)).not.toContain('host-secret')
    expect(result.current.capabilities).toEqual(['wallet.getEthereumProvider', 'back'])
  })

  it.each([
    ['ready', () => mocks.ready.mockRejectedValue(new Error('ready failed'))],
    ['capabilities', () => mocks.capabilities.mockRejectedValue(new Error('capabilities failed'))],
    ['context', () => { mocks.context = Promise.reject(new Error('context failed')) }],
  ])('shows an actionable host error when %s fails', async (_stage, fail) => {
    fail()
    const { result } = renderHook(() => useMiniAppHost())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatch(/failed/)
  })

  it('ignores host completion after unmount', async () => {
    let resolveContext!: (value: typeof context) => void
    mocks.context = new Promise((resolve) => {
      resolveContext = resolve
    })
    const { result, unmount } = renderHook(() => useMiniAppHost())
    await waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce())

    unmount()
    resolveContext(context)
    await Promise.resolve()

    expect(result.current.status).toBe('detecting')
  })
})
