import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress, type Address } from 'viem'

import {
  clearInboxTarget,
  readInboxTarget,
  type PersistableInboxTarget,
  writeInboxTarget,
} from './inboxTarget'

const fid = 8531
const key = `converge-miniapp:ens-inbox-target:${fid}`
const address = getAddress('0x7ab874eeef0169ada0d225e9801a3ffffa26aac3')
const target = {
  address,
  chainId: '8453',
  inboxId: 'target-inbox-id',
  name: 'deanpierce.eth',
  signerSource: 'walletconnect',
  sourceAddress: getAddress('0xde709f2102306220921060314715629080e2fb77'),
  walletKind: 'EOA',
} satisfies PersistableInboxTarget

describe('inbox target storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('stores a versioned record with a normalized name and checksummed address', () => {
    expect(writeInboxTarget(fid, {
      address: address.toLowerCase() as Address,
      inboxId: target.inboxId,
      name: '  DEANPIERCE.eth  ',
      signerSource: 'walletconnect',
      sourceAddress: target.sourceAddress.toLowerCase() as Address,
      walletKind: 'EOA',
      chainId: '0x2105',
    })).toBe(true)

    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({
      address,
      chainId: target.chainId,
      inboxId: target.inboxId,
      name: target.name,
      signerSource: target.signerSource,
      sourceAddress: target.sourceAddress,
      version: 3,
      walletKind: target.walletKind,
    })
    expect(readInboxTarget(fid)).toEqual({ status: 'valid', target })
  })

  it('reads an exact legacy v2 record as a Farcaster signer with unknown metadata', () => {
    const legacy = {
      address: target.address,
      inboxId: target.inboxId,
      name: target.name,
      sourceAddress: target.sourceAddress,
      version: 2,
    }
    const serialized = JSON.stringify(legacy)
    window.localStorage.setItem(key, serialized)

    expect(readInboxTarget(fid)).toEqual({
      status: 'valid',
      target: {
        address: target.address,
        chainId: null,
        inboxId: target.inboxId,
        name: target.name,
        signerSource: 'farcaster',
        sourceAddress: target.sourceAddress,
        walletKind: null,
      },
    })
    expect(window.localStorage.getItem(key)).toBe(serialized)
  })

  it('never persists WalletConnect pairing material supplied by a caller', () => {
    const withPairingMaterial = {
      ...target,
      topic: 'private-session-topic',
      uri: 'wc:private-pairing-uri',
    }

    expect(writeInboxTarget(fid, withPairingMaterial)).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({
      address: target.address,
      chainId: target.chainId,
      inboxId: target.inboxId,
      name: target.name,
      signerSource: target.signerSource,
      sourceAddress: target.sourceAddress,
      version: 3,
      walletKind: target.walletKind,
    })
  })

  it('keeps selector hints isolated by positive host-context FID', () => {
    expect(writeInboxTarget(fid, target)).toBe(true)
    expect(readInboxTarget(fid + 1)).toEqual({ status: 'none', target: null })
    expect(readInboxTarget(0)).toEqual({ status: 'invalid', target: null })
    expect(readInboxTarget(-1)).toEqual({ status: 'invalid', target: null })
    expect(readInboxTarget(Number.MAX_SAFE_INTEGER + 1)).toEqual({
      status: 'invalid',
      target: null,
    })
    expect(writeInboxTarget(0, target)).toBe(false)
  })

  it.each([
    ['invalid JSON', '{'],
    ['wrong version', JSON.stringify({ ...target, version: 1 })],
    ['missing version', JSON.stringify(target)],
    ['extra fields', JSON.stringify({ ...target, privateKey: 'nope', version: 3 })],
    ['WalletConnect URI', JSON.stringify({ ...target, uri: 'wc:secret', version: 3 })],
    ['WalletConnect topic', JSON.stringify({ ...target, topic: 'secret', version: 3 })],
    ['unnormalized name', JSON.stringify({ ...target, name: 'DEANPIERCE.eth', version: 3 })],
    ['invalid address', JSON.stringify({ ...target, address: 'not-an-address', version: 3 })],
    ['non-checksummed address', JSON.stringify({
      ...target,
      address: address.toLowerCase(),
      version: 3,
    })],
    ['empty inbox ID', JSON.stringify({ ...target, inboxId: '', version: 3 })],
    ['oversized inbox ID', JSON.stringify({
      ...target,
      inboxId: 'i'.repeat(513),
      version: 3,
    })],
    ['same source and target', JSON.stringify({
      ...target,
      sourceAddress: target.address,
      version: 3,
    })],
    ['invalid signer source', JSON.stringify({
      ...target,
      signerSource: 'injected',
      version: 3,
    })],
    ['invalid wallet kind', JSON.stringify({
      ...target,
      walletKind: 'hardware',
      version: 3,
    })],
    ['missing wallet kind', JSON.stringify({
      address: target.address,
      chainId: target.chainId,
      inboxId: target.inboxId,
      name: target.name,
      signerSource: target.signerSource,
      sourceAddress: target.sourceAddress,
      version: 3,
    })],
    ['zero chain ID', JSON.stringify({ ...target, chainId: '0', version: 3 })],
    ['noncanonical chain ID', JSON.stringify({
      ...target,
      chainId: '0x2105',
      version: 3,
    })],
  ])('blocks on a stored record with %s', (_label, serialized) => {
    window.localStorage.setItem(key, serialized)

    expect(readInboxTarget(fid)).toEqual({ status: 'invalid', target: null })
    expect(window.localStorage.getItem(key)).toBe(serialized)
  })

  it('does not overwrite a valid target with invalid input', () => {
    expect(writeInboxTarget(fid, target)).toBe(true)

    expect(writeInboxTarget(fid, { ...target, inboxId: ' '.repeat(2) })).toBe(false)
    expect(writeInboxTarget(fid, { ...target, name: 'not-an-ens-name' })).toBe(false)
    expect(writeInboxTarget(fid, { ...target, chainId: '0' })).toBe(false)
    expect(readInboxTarget(fid)).toEqual({ status: 'valid', target })
  })

  it('preserves a valid target when browser storage rejects a replacement', () => {
    expect(writeInboxTarget(fid, target)).toBe(true)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full')
    })

    expect(writeInboxTarget(fid, { ...target, inboxId: 'replacement' })).toBe(false)
    setItem.mockRestore()
    expect(readInboxTarget(fid)).toEqual({ status: 'valid', target })
  })

  it('clears only the selected FID record', () => {
    expect(writeInboxTarget(fid, target)).toBe(true)
    expect(writeInboxTarget(fid + 1, { ...target, inboxId: 'other' })).toBe(true)

    expect(clearInboxTarget(fid)).toBe(true)
    expect(readInboxTarget(fid)).toEqual({ status: 'none', target: null })
    expect(readInboxTarget(fid + 1)).toMatchObject({
      status: 'valid',
      target: { inboxId: 'other' },
    })
  })

  it('reports a failed clear and leaves the saved target intact', () => {
    expect(writeInboxTarget(fid, target)).toBe(true)
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(clearInboxTarget(fid)).toBe(false)
    removeItem.mockRestore()
    expect(readInboxTarget(fid)).toEqual({ status: 'valid', target })
  })

  it('fails closed when local storage operations throw', () => {
    expect(writeInboxTarget(fid, target)).toBe(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    expect(readInboxTarget(fid)).toEqual({ status: 'unavailable', target: null })
  })
})
