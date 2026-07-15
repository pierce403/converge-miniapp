import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
  it('renders the stable branded shell', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Converge Mini' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Farcaster × XMTP')).toBeInTheDocument()
  })
})
