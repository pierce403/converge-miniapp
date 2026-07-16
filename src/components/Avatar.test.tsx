import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('keeps an astral emoji intact when deriving an avatar glyph', () => {
    const { container } = render(<Avatar name="🌱" />)

    expect(container.querySelector('.avatar')).toHaveTextContent('🌱')
    expect(screen.queryByText('�')).not.toBeInTheDocument()
  })
})
