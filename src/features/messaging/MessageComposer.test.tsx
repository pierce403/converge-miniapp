import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageComposer } from './MessageComposer'

describe('MessageComposer', () => {
  it('submits a trimmed message only once while the first send is pending', async () => {
    let finishSend: (() => void) | undefined
    const onSend = vi.fn(() => new Promise<void>((resolve) => {
      finishSend = resolve
    }))

    render(<MessageComposer onSend={onSend} sending={false} />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: '  hello  ' } })
    fireEvent.submit(input.closest('form')!)
    fireEvent.submit(input.closest('form')!)

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('hello')

    await act(async () => finishSend?.())
  })

  it('restores the draft when sending rejects', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('offline'))
    render(<MessageComposer onSend={onSend} sending={false} />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'keep this' } })
    fireEvent.submit(input.closest('form')!)

    await screen.findByDisplayValue('keep this')
  })
})
