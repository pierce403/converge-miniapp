import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

vi.mock('./app/useMiniAppHost', () => ({
  useMiniAppHost: vi.fn(() => ({
    capabilities: [],
    context: null,
    error: null,
    status: 'standalone',
  })),
}))

describe('App', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--vh')
  })

  it('renders the honest standalone state', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', {
        name: 'Private messages, right where the conversation starts.',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('miniapp.converge.cv')).toBeInTheDocument()
    expect(screen.getByText(/Standalone wallet access is intentionally off/)).toBeInTheDocument()
  })
})
