import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NewDmScreen } from './NewDmScreen'

const ownAddress = '0x52908400098527886E0F7030069857D2E4169EE7'
const peerAddress = '0xde709f2102306220921060314715629080e2fb77'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    ownAddress,
    onBack: vi.fn(),
    onCheckReachability: vi.fn().mockResolvedValue(true),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onInspectIdentity: vi.fn().mockResolvedValue('different-inbox'),
    onResetResolution: vi.fn(),
    onResolveEns: vi.fn().mockResolvedValue({
      address: peerAddress,
      name: 'deanpierce.eth',
    }),
    resolutionError: null,
    ...overrides,
  } as Parameters<typeof NewDmScreen>[0]
}

describe('NewDmScreen', () => {
  it('disables recipient checks while offline', () => {
    const options = props({ offline: true })
    render(<NewDmScreen {...options} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Reconnect before checking or opening a new conversation.',
    )
    expect(screen.getByLabelText('Ethereum address or ENS name')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check recipient' })).toBeDisabled()
    expect(options.onResolveEns).not.toHaveBeenCalled()
    expect(options.onCheckReachability).not.toHaveBeenCalled()
  })

  it('rejects incomplete input and the active address before checking XMTP', async () => {
    const options = props()
    render(<NewDmScreen {...options} />)

    const input = screen.getByLabelText('Ethereum address or ENS name')
    fireEvent.change(input, { target: { value: 'alice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check recipient' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('address or ENS name')

    fireEvent.change(input, { target: { value: ownAddress.toLowerCase() } })
    fireEvent.click(screen.getByRole('button', { name: 'Check recipient' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wallet already connected')
    expect(options.onInspectIdentity).not.toHaveBeenCalled()
    expect(options.onCheckReachability).not.toHaveBeenCalled()
    expect(options.onCreate).not.toHaveBeenCalled()
  })

  it('checks an address once, shows the full destination, then opens on confirmation', async () => {
    let finishOpen: (() => void) | undefined
    const onCreate = vi.fn(() => new Promise<void>((resolve) => {
      finishOpen = resolve
    }))
    const options = props({ onCreate })
    render(<NewDmScreen {...options} />)

    const input = screen.getByLabelText('Ethereum address or ENS name')
    fireEvent.change(input, { target: { value: ` ${peerAddress} ` } })
    const form = input.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(await screen.findByText('Reachable on XMTP')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Reachable on XMTP')
    expect(screen.getByText(peerAddress)).toBeVisible()
    expect(options.onCheckReachability).toHaveBeenCalledTimes(1)
    expect(options.onCreate).not.toHaveBeenCalled()

    const open = screen.getByRole('button', { name: 'Open DM' })
    fireEvent.click(open)
    fireEvent.click(open)
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith(peerAddress)

    finishOpen?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open DM' })).toBeEnabled())
  })

  it('resolves an ENS name and displays both normalized name and full address', async () => {
    const options = props()
    render(<NewDmScreen {...options} />)

    fireEvent.change(screen.getByLabelText('Ethereum address or ENS name'), {
      target: { value: 'DeanPierce.ETH' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check recipient' }))

    expect(await screen.findByText('deanpierce.eth')).toBeVisible()
    expect(screen.getByText(peerAddress)).toBeVisible()
    expect(options.onResolveEns).toHaveBeenCalledWith('DeanPierce.ETH')
    expect(options.onInspectIdentity).toHaveBeenCalledWith(peerAddress)
    expect(options.onCheckReachability).toHaveBeenCalledWith(peerAddress)
    expect(options.onCreate).not.toHaveBeenCalled()
  })

  it('rejects another address already associated with the current inbox', async () => {
    const options = props({
      onInspectIdentity: vi.fn().mockResolvedValue('same-inbox'),
    })
    render(<NewDmScreen {...options} />)

    fireEvent.change(screen.getByLabelText('Ethereum address or ENS name'), {
      target: { value: 'deanpierce.eth' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check recipient' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'already belongs to your current XMTP inbox',
    )
    expect(options.onCheckReachability).not.toHaveBeenCalled()
  })

  it('keeps an unreachable resolved destination visible without an open action', async () => {
    const options = props({
      onCheckReachability: vi.fn().mockResolvedValue(false),
    })
    render(<NewDmScreen {...options} />)

    fireEvent.change(screen.getByLabelText('Ethereum address or ENS name'), {
      target: { value: 'deanpierce.eth' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check recipient' }))

    expect(await screen.findByText('Not on XMTP yet')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Not on XMTP yet')
    expect(screen.getByText(peerAddress)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Open DM' })).not.toBeInTheDocument()
  })

  it('invalidates a checked destination when the input changes', async () => {
    const options = props()
    render(<NewDmScreen {...options} />)

    const input = screen.getByLabelText('Ethereum address or ENS name')
    fireEvent.change(input, { target: { value: 'deanpierce.eth' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check recipient' }))
    expect(await screen.findByRole('button', { name: 'Open DM' })).toBeVisible()

    fireEvent.change(input, { target: { value: 'other.eth' } })
    expect(screen.queryByRole('button', { name: 'Open DM' })).not.toBeInTheDocument()
    expect(options.onResetResolution).toHaveBeenCalled()
  })

  it('does not restore a stale recipient after the query changes mid-check', async () => {
    const reachability = deferred<boolean>()
    const options = props({
      onCheckReachability: vi.fn().mockReturnValue(reachability.promise),
    })
    render(<NewDmScreen {...options} />)

    const input = screen.getByLabelText('Ethereum address or ENS name')
    fireEvent.change(input, { target: { value: peerAddress } })
    fireEvent.click(screen.getByRole('button', { name: 'Check recipient' }))
    await waitFor(() => expect(options.onCheckReachability).toHaveBeenCalledWith(
      peerAddress,
    ))

    fireEvent.change(input, { target: { value: 'other.eth' } })
    await act(async () => reachability.resolve(true))

    await waitFor(() => expect(screen.getByRole('button', {
      name: 'Check recipient',
    })).toBeEnabled())
    expect(screen.queryByRole('button', { name: 'Open DM' })).not.toBeInTheDocument()
    expect(screen.queryByText(peerAddress)).not.toBeInTheDocument()
  })
})
