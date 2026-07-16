import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAddress, stringToHex, type Address, type Hex } from 'viem'

import {
  connectEip1193Wallet,
  connectHostWallet,
  HostWalletSourceMismatchError,
  HostWalletTargetUnavailableError,
  verifyHostWalletSource,
  WalletPreferredAccountMismatchError,
  WalletTargetUnavailableError,
  type HostWalletProvider,
} from './signer'

const miniAppMocks = vi.hoisted(() => ({
  getEthereumProvider: vi.fn(),
}))

vi.mock('@farcaster/miniapp-sdk', () => ({
  sdk: {
    wallet: {
      getEthereumProvider: miniAppMocks.getEthereumProvider,
    },
  },
}))

type ProviderRequest = Parameters<HostWalletProvider['request']>[0]

const signature = `0x${'11'.repeat(65)}` as Hex

function createProvider(options: {
  account: Address
  accounts?: unknown
  chainId: unknown
  code: Hex
}) {
  const request = vi.fn(async ({ method, params }: ProviderRequest) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return options.accounts ?? [options.account]
      case 'eth_chainId':
        return options.chainId
      case 'eth_getCode':
        expect(params).toEqual([getAddress(options.account), 'latest'])
        return options.code
      case 'personal_sign':
        return signature
      default:
        throw new Error(`Unexpected provider method: ${method}`)
    }
  })
  const provider = {
    on: vi.fn(),
    removeListener: vi.fn(),
    request,
  } as unknown as HostWalletProvider

  return { provider, request }
}

describe('connectEip1193Wallet', () => {
  afterEach(() => {
    miniAppMocks.getEthereumProvider.mockReset()
  })

  it('selects an exact external account without consulting the Farcaster host', async () => {
    const firstAccount = getAddress('0xde709f2102306220921060314715629080e2fb77')
    const target = getAddress('0x52908400098527886e0f7030069857d2e4169ee7')
    const { provider, request } = createProvider({
      account: target,
      accounts: [firstAccount, target.toLowerCase()],
      chainId: '0x1',
      code: '0x',
    })

    const connection = await connectEip1193Wallet(provider, {
      targetAddress: target,
      accountRequestMethod: 'eth_accounts',
    })

    expect(connection).toMatchObject({
      address: target,
      chainId: 1n,
      kind: 'EOA',
      provider,
    })
    expect(miniAppMocks.getEthereumProvider).not.toHaveBeenCalled()
    expect(request).toHaveBeenNthCalledWith(1, { method: 'eth_accounts' })
    expect(request).toHaveBeenNthCalledWith(3, {
      method: 'eth_getCode',
      params: [target, 'latest'],
    })
  })

  it('accepts the numeric chain ID returned by the WalletConnect provider', async () => {
    const target = getAddress('0x52908400098527886e0f7030069857d2e4169ee7')
    const { provider } = createProvider({
      account: target,
      chainId: 8453,
      code: '0x',
    })

    await expect(connectEip1193Wallet(provider, {
      targetAddress: target,
      accountRequestMethod: 'eth_accounts',
    })).resolves.toMatchObject({
      address: target,
      chainId: 8453n,
      kind: 'EOA',
    })
  })

  it('fails closed when an exact target is absent', async () => {
    const available = getAddress('0xde709f2102306220921060314715629080e2fb77')
    const target = getAddress('0x52908400098527886e0f7030069857d2e4169ee7')
    const { provider, request } = createProvider({
      account: available,
      chainId: '0x1',
      code: '0x',
    })

    await expect(connectEip1193Wallet(provider, {
      targetAddress: target,
    })).rejects.toMatchObject({
      code: 'wallet-target-unavailable',
      name: WalletTargetUnavailableError.name,
      targetAddress: target,
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('can require an exact preferred account independently of target selection', async () => {
    const expected = getAddress('0xde709f2102306220921060314715629080e2fb77')
    const different = getAddress('0x7ab874eeef0169ada0d225e9801a3ffffa26aac3')
    const { provider, request } = createProvider({
      account: different,
      chainId: '0x1',
      code: '0x',
    })

    await expect(connectEip1193Wallet(provider, {
      expectedPreferredAddress: expected,
    })).rejects.toMatchObject({
      code: 'wallet-preferred-account-mismatch',
      name: WalletPreferredAccountMismatchError.name,
      expectedAddress: expected,
    })
    expect(request).toHaveBeenCalledOnce()
  })
})

describe('verifyHostWalletSource', () => {
  afterEach(() => {
    miniAppMocks.getEthereumProvider.mockReset()
  })

  it('verifies only the preferred Farcaster source account', async () => {
    const sourceAddress = getAddress('0xde709f2102306220921060314715629080e2fb77')
    const targetAddress = getAddress('0x52908400098527886e0f7030069857d2e4169ee7')
    const { provider, request } = createProvider({
      account: sourceAddress,
      accounts: [sourceAddress, targetAddress],
      chainId: '0x2105',
      code: '0x',
    })
    miniAppMocks.getEthereumProvider.mockResolvedValue(provider)

    await expect(verifyHostWalletSource(sourceAddress)).resolves.toEqual({
      address: sourceAddress,
      provider,
    })
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })

  it('keeps the existing host source-mismatch error contract', async () => {
    const sourceAddress = getAddress('0xde709f2102306220921060314715629080e2fb77')
    const differentAddress = getAddress('0x7ab874eeef0169ada0d225e9801a3ffffa26aac3')
    const { provider } = createProvider({
      account: differentAddress,
      chainId: '0x2105',
      code: '0x',
    })
    miniAppMocks.getEthereumProvider.mockResolvedValue(provider)

    await expect(verifyHostWalletSource(sourceAddress)).rejects.toMatchObject({
      code: 'host-wallet-source-mismatch',
      name: HostWalletSourceMismatchError.name,
      sourceAddress,
    })
  })
})

describe('connectHostWallet', () => {
  afterEach(() => {
    miniAppMocks.getEthereumProvider.mockReset()
  })

  it('creates an EOA signer for an account without contract code', async () => {
    const account = '0x52908400098527886e0f7030069857d2e4169ee7'
    const expectedAddress = '0x52908400098527886E0F7030069857D2E4169EE7'
    const { provider, request } = createProvider({
      account,
      chainId: '0x2105',
      code: '0x',
    })
    miniAppMocks.getEthereumProvider.mockResolvedValue(provider)

    const connection = await connectHostWallet()

    expect(connection).toMatchObject({
      address: expectedAddress,
      chainId: 8453n,
      kind: 'EOA',
      provider,
    })
    expect(connection.signer.type).toBe('EOA')
    expect(await connection.signer.getIdentifier()).toMatchObject({
      identifier: expectedAddress.toLowerCase(),
    })

    const bytes = await connection.signer.signMessage('hello')
    expect(bytes).toEqual(new Uint8Array(65).fill(0x11))
    expect(request).toHaveBeenNthCalledWith(
      4,
      {
        method: 'personal_sign',
        params: [stringToHex('hello'), expectedAddress],
      },
      undefined,
    )
  })

  it('creates an SCW signer for an account with contract code', async () => {
    const account = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'
    const expectedAddress = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const { provider } = createProvider({
      account,
      chainId: '0x2105',
      code: '0x6001600055',
    })
    miniAppMocks.getEthereumProvider.mockResolvedValue(provider)

    const connection = await connectHostWallet()

    expect(connection.address).toBe(expectedAddress)
    expect(connection.chainId).toBe(8453n)
    expect(connection.kind).toBe('SCW')
    expect(connection.signer.type).toBe('SCW')
    if (connection.signer.type !== 'SCW') {
      throw new Error('Expected an SCW signer')
    }
    expect(connection.signer.getChainId()).toBe(8453n)
    expect(await connection.signer.getIdentifier()).toMatchObject({
      identifier: expectedAddress.toLowerCase(),
    })
    await expect(connection.signer.signMessage('hello')).resolves.toEqual(
      new Uint8Array(65).fill(0x11),
    )
  })

  it('continues to use the first returned account when no target is requested', async () => {
    const firstAccount = '0xde709f2102306220921060314715629080e2fb77'
    const secondAccount = '0x52908400098527886e0f7030069857d2e4169ee7'
    const { provider, request } = createProvider({
      account: firstAccount,
      accounts: [firstAccount, secondAccount],
      chainId: '0x2105',
      code: '0x',
    })
    miniAppMocks.getEthereumProvider.mockResolvedValue(provider)

    const connection = await connectHostWallet()

    expect(connection.address).toBe(getAddress(firstAccount))
    expect(request).toHaveBeenNthCalledWith(3, {
      method: 'eth_getCode',
      params: [getAddress(firstAccount), 'latest'],
    })
  })

  it('selects an explicitly requested account case-insensitively', async () => {
    const firstAccount = '0xde709f2102306220921060314715629080e2fb77'
    const target = '0x52908400098527886E0F7030069857D2E4169EE7'
    const { provider, request } = createProvider({
      account: target,
      accounts: [firstAccount, target.toLowerCase()],
      chainId: '0x2105',
      code: '0x',
    })
    miniAppMocks.getEthereumProvider.mockResolvedValue(provider)

    const connection = await connectHostWallet(target, firstAccount)

    expect(connection.address).toBe(target)
    expect(miniAppMocks.getEthereumProvider).toHaveBeenCalledOnce()
    expect(request).toHaveBeenNthCalledWith(1, { method: 'eth_requestAccounts' })
    await connection.signer.signMessage('hello')
    expect(request).toHaveBeenNthCalledWith(3, {
      method: 'eth_getCode',
      params: [target, 'latest'],
    })
    expect(request).toHaveBeenNthCalledWith(
      4,
      {
        method: 'personal_sign',
        params: [stringToHex('hello'), target],
      },
      undefined,
    )
  })

  it('does not fall back when the requested account is unavailable', async () => {
    const available = '0xde709f2102306220921060314715629080e2fb77'
    const target = getAddress('0x52908400098527886e0f7030069857d2e4169ee7')
    const { provider, request } = createProvider({
      account: available,
      accounts: [available],
      chainId: '0x2105',
      code: '0x',
    })
    miniAppMocks.getEthereumProvider.mockResolvedValue(provider)

    await expect(connectHostWallet(target)).rejects.toMatchObject({
      code: 'host-wallet-target-unavailable',
      name: HostWalletTargetUnavailableError.name,
      targetAddress: target,
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })

  it('rejects a target when the same account snapshot has a different preferred source', async () => {
    const expectedSource = getAddress('0xde709f2102306220921060314715629080e2fb77')
    const differentSource = getAddress('0x7ab874eeef0169ada0d225e9801a3ffffa26aac3')
    const target = getAddress('0x52908400098527886e0f7030069857d2e4169ee7')
    const { provider, request } = createProvider({
      account: differentSource,
      accounts: [differentSource, target],
      chainId: '0x2105',
      code: '0x',
    })
    miniAppMocks.getEthereumProvider.mockResolvedValue(provider)

    await expect(connectHostWallet(target, expectedSource)).rejects.toMatchObject({
      code: 'host-wallet-source-mismatch',
      name: HostWalletSourceMismatchError.name,
      sourceAddress: expectedSource,
    })
    expect(miniAppMocks.getEthereumProvider).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })

  it('rejects an invalid returned account before account inspection or signing', async () => {
    const fallbackAccount = '0xde709f2102306220921060314715629080e2fb77'
    const { provider, request } = createProvider({
      account: fallbackAccount,
      accounts: ['not-an-address'],
      chainId: '0x2105',
      code: '0x',
    })
    miniAppMocks.getEthereumProvider.mockResolvedValue(provider)

    await expect(connectHostWallet()).rejects.toThrow(
      'The Farcaster wallet returned an invalid Ethereum account.',
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })

  it('does not fall back to a generated identity without a host wallet', async () => {
    miniAppMocks.getEthereumProvider.mockResolvedValue(undefined)

    await expect(connectHostWallet()).rejects.toThrow(
      'The Farcaster host does not expose an Ethereum wallet.',
    )
  })
})
