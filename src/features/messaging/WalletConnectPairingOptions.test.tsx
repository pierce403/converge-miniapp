import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WalletConnectPairingOptions } from './WalletConnectPairingOptions'

const uri = 'wc:topic@2?relay-protocol=irn&symKey=secret'

describe('WalletConnectPairingOptions', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    writeText.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  it('provides QR, selectable URI, and a real MetaMask universal link', () => {
    render(<WalletConnectPairingOptions name="deanpierce.eth" uri={uri} />)

    expect(screen.getByRole('img', {
      name: 'WalletConnect QR code for deanpierce.eth',
    })).toBeVisible()
    expect(screen.getByRole('textbox', {
      name: 'WalletConnect URI for deanpierce.eth',
    })).toHaveValue(uri)
    expect(screen.getByRole('link', { name: 'Open MetaMask' })).toHaveAttribute(
      'href',
      `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`,
    )
  })

  it('announces a successful URI copy', async () => {
    writeText.mockResolvedValue(undefined)
    render(<WalletConnectPairingOptions name="deanpierce.eth" uri={uri} />)

    fireEvent.click(screen.getByRole('button', {
      name: 'Copy WalletConnect URI',
    }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(uri))
    expect(screen.getByRole('status')).toHaveTextContent(
      'WalletConnect URI copied.',
    )
  })

  it('keeps the raw URI selectable when clipboard access fails', async () => {
    writeText.mockRejectedValue(new Error('clipboard unavailable'))
    render(<WalletConnectPairingOptions name="deanpierce.eth" uri={uri} />)

    fireEvent.click(screen.getByRole('button', {
      name: 'Copy WalletConnect URI',
    }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Clipboard access failed. Select and copy the URI above.',
    ))
    expect(screen.getByRole('textbox')).toHaveValue(uri)
  })
})
