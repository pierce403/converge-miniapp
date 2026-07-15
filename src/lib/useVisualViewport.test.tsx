import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useVisualViewport } from './useVisualViewport'

type MockVisualViewport = {
  emit: (event: 'resize' | 'scroll') => void
  setHeight: (height: number) => void
}

function createMockVisualViewport(initialHeight: number): MockVisualViewport {
  let height = initialHeight
  const listeners = {
    resize: new Set<() => void>(),
    scroll: new Set<() => void>(),
  }
  const viewport = {
    get height() {
      return height
    },
    addEventListener: vi.fn((event: 'resize' | 'scroll', listener: () => void) => {
      listeners[event].add(listener)
    }),
    removeEventListener: vi.fn((event: 'resize' | 'scroll', listener: () => void) => {
      listeners[event].delete(listener)
    }),
  }

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  })

  return {
    emit: (event) => listeners[event].forEach((listener) => listener()),
    setHeight: (nextHeight) => {
      height = nextHeight
    },
  }
}

function Harness() {
  useVisualViewport()
  return null
}

describe('useVisualViewport', () => {
  afterEach(() => {
    delete (window as { visualViewport?: VisualViewport }).visualViewport
    vi.restoreAllMocks()
  })

  it('tracks the real visual height and keyboard state', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 900,
      writable: true,
    })
    const viewport = createMockVisualViewport(900)
    const root = document.getElementById('root') ?? document.documentElement

    render(<Harness />)
    expect(root.style.getPropertyValue('--vh')).toBe('9px')

    viewport.setHeight(700)
    viewport.emit('resize')
    expect(root.classList).toContain('keyboard-open')
  })
})
