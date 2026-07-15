import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMiniAppBack } from './useMiniAppBack'

const mocks = vi.hoisted(() => ({
  back: {
    hide: vi.fn().mockResolvedValue(undefined),
    onback: null as (() => void) | null,
    show: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@farcaster/miniapp-sdk', () => ({
  sdk: { back: mocks.back },
}))

describe('useMiniAppBack', () => {
  beforeEach(() => {
    mocks.back.hide.mockClear()
    mocks.back.show.mockClear()
    mocks.back.onback = null
  })

  it('shows host back for a nested view and routes it to the current callback', async () => {
    const onBack = vi.fn()
    const { rerender } = renderHook(
      ({ callback, visible }) => useMiniAppBack(true, visible, callback),
      { initialProps: { callback: onBack, visible: true } },
    )

    await waitFor(() => expect(mocks.back.show).toHaveBeenCalledOnce())
    act(() => mocks.back.onback?.())
    expect(onBack).toHaveBeenCalledOnce()

    const replacement = vi.fn()
    rerender({ callback: replacement, visible: true })
    await waitFor(() => expect(mocks.back.onback).toBe(replacement))
    act(() => mocks.back.onback?.())
    expect(replacement).toHaveBeenCalledOnce()
  })

  it('clears and hides host back on the root view', async () => {
    mocks.back.onback = vi.fn()
    renderHook(() => useMiniAppBack(true, false, vi.fn()))

    await waitFor(() => expect(mocks.back.hide).toHaveBeenCalled())
    expect(mocks.back.onback).toBeNull()
  })

  it('clears and hides host back when the nested view unmounts', async () => {
    const { unmount } = renderHook(() => useMiniAppBack(true, true, vi.fn()))
    await waitFor(() => expect(mocks.back.show).toHaveBeenCalledOnce())

    unmount()

    expect(mocks.back.onback).toBeNull()
    expect(mocks.back.hide).toHaveBeenCalledOnce()
  })

  it('hides again if a pending show settles after teardown', async () => {
    let resolveShow!: () => void
    mocks.back.show.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveShow = resolve
    }))
    const { unmount } = renderHook(() => useMiniAppBack(true, true, vi.fn()))
    await waitFor(() => expect(mocks.back.show).toHaveBeenCalledOnce())

    unmount()
    resolveShow()

    await waitFor(() => expect(mocks.back.hide).toHaveBeenCalledTimes(2))
    expect(mocks.back.onback).toBeNull()
  })

  it('keeps the local back control viable when a host show call rejects', async () => {
    mocks.back.show.mockRejectedValueOnce(new Error('host closing'))
    const onBack = vi.fn()
    renderHook(() => useMiniAppBack(true, true, onBack))

    await waitFor(() => expect(mocks.back.show).toHaveBeenCalledOnce())
    act(() => mocks.back.onback?.())
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('does not touch host back when the capability is unavailable', () => {
    renderHook(() => useMiniAppBack(false, true, vi.fn()))

    expect(mocks.back.show).not.toHaveBeenCalled()
    expect(mocks.back.hide).not.toHaveBeenCalled()
  })
})
