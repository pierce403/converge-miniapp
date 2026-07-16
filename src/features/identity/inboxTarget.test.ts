import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress, type Address } from 'viem'

import {
  clearInboxTarget,
  readInboxTarget,
  writeInboxTarget,
} from './inboxTarget'

const fid = 8531
const key = `converge-miniapp:ens-inbox-target:${fid}`
const address = getAddress('0x7ab874eeef0169ada0d225e9801a3ffffa26aac3')
const target = {
  address,
  inboxId: 'target-inbox-id',
  name: 'deanpierce.eth',
  sourceAddress: getAddress('0xde709f2102306220921060314715629080e2fb77'),
}

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
      sourceAddress: target.sourceAddress.toLowerCase() as Address,
    })).toBe(true)

    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({
      address,
      inboxId: target.inboxId,
      name: target.name,
      sourceAddress: target.sourceAddress,
      version: 2,
    })
    expect(readInboxTarget(fid)).toEqual({ status: 'valid', target })
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
    ['extra fields', JSON.stringify({ ...target, privateKey: 'nope', version: 2 })],
    ['unnormalized name', JSON.stringify({ ...target, name: 'DEANPIERCE.eth', version: 2 })],
    ['invalid address', JSON.stringify({ ...target, address: 'not-an-address', version: 2 })],
    ['non-checksummed address', JSON.stringify({
      ...target,
      address: address.toLowerCase(),
      version: 2,
    })],
    ['empty inbox ID', JSON.stringify({ ...target, inboxId: '', version: 2 })],
    ['oversized inbox ID', JSON.stringify({
      ...target,
      inboxId: 'i'.repeat(513),
      version: 2,
    })],
    ['same source and target', JSON.stringify({
      ...target,
      sourceAddress: target.address,
      version: 2,
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
