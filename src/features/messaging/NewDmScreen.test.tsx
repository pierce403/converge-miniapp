import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NewDmScreen } from './NewDmScreen'

const ownAddress = '0x52908400098527886E0F7030069857D2E4169EE7'
const peerAddress = '0xde709f2102306220921060314715629080e2fb77'

describe('NewDmScreen', () => {
  it('rejects invalid and self addresses before checking XMTP', async () => {
    const onCreate = vi.fn()
    render(<NewDmScreen ownAddress={ownAddress} onBack={vi.fn()} onCreate={onCreate} />)

    const input = screen.getByLabelText('Ethereum address')
    fireEvent.change(input, { target: { value: 'alice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check and open DM' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('complete Ethereum address')

    fireEvent.change(input, { target: { value: ownAddress.toLowerCase() } })
    fireEvent.click(screen.getByRole('button', { name: 'Check and open DM' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wallet already connected')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('normalizes and checks a reachable recipient only once', async () => {
    let finishCheck: (() => void) | undefined
    const onCreate = vi.fn(() => new Promise<void>((resolve) => {
      finishCheck = resolve
    }))
    render(<NewDmScreen ownAddress={ownAddress} onBack={vi.fn()} onCreate={onCreate} />)

    const input = screen.getByLabelText('Ethereum address')
    fireEvent.change(input, { target: { value: ` ${peerAddress} ` } })
    const form = input.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith('0xde709f2102306220921060314715629080e2fb77')

    finishCheck?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check and open DM' })).toBeEnabled())
  })
})
