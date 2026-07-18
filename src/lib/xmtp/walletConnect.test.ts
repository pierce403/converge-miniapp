import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const walletConnectMocks = vi.hoisted(() => ({
  init: vi.fn(),
}))

const signerMocks = vi.hoisted(() => {
  class WalletTargetUnavailableError extends Error {
    readonly targetAddress: string

    constructor(targetAddress: string) {
      super('Target unavailable')
      this.name = 'WalletTargetUnavailableError'
      this.targetAddress = targetAddress
    }
  }

  return {
    connectEip1193Wallet: vi.fn(),
    WalletTargetUnavailableError,
  }
})

vi.mock('@walletconnect/ethereum-provider', () => ({
  EthereumProvider: {
    init: walletConnectMocks.init,
  },
}))

vi.mock('./signer', () => ({
  connectEip1193Wallet: signerMocks.connectEip1193Wallet,
  WalletTargetUnavailableError: signerMocks.WalletTargetUnavailableError,
}))

const targetAddress = '0x52908400098527886E0F7030069857D2E4169EE7'
const otherAddress = '0xde709f2102306220921060314715629080e2fb77'

type UriListener = (uri: string) => void

function createProvider(options: {
  hasSession?: boolean
  accounts?: string[]
  connect?: () => Promise<void>
  disconnect?: () => Promise<void>
} = {}) {
  const state: { session: object | undefined } = {
    session: options.hasSession ? { topic: 'persisted' } : undefined,
  }
  const uriListeners = new Set<UriListener>()
  const provider = {
    accounts: [...(options.accounts ?? [])],
    get session() {
      return state.session
    },
    request: vi.fn(),
    on: vi.fn((event: string, listener: UriListener) => {
      if (event === 'display_uri') uriListeners.add(listener)
    }),
    removeListener: vi.fn((event: string, listener: UriListener) => {
      if (event === 'display_uri') uriListeners.delete(listener)
    }),
    connect: vi.fn(options.connect ?? (async () => {
      state.session = { topic: 'new' }
      provider.accounts = [targetAddress]
    })),
    disconnect: vi.fn(options.disconnect ?? (async () => {
      state.session = undefined
      provider.accounts = []
    })),
    emitUri(uri: string) {
      for (const listener of uriListeners) listener(uri)
    },
    setSession(session?: object) {
      state.session = session
    },
  }

  return provider
}

async function loadWalletConnect() {
  return import('./walletConnect')
}

describe('WalletConnect XMTP adapter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'public-project-id')
    walletConnectMocks.init.mockReset()
    signerMocks.connectEip1193Wallet.mockReset()
    signerMocks.connectEip1193Wallet.mockImplementation(
      async (provider, { targetAddress: requestedAddress }) => ({
        address: requestedAddress,
        chainId: 1n,
        kind: 'EOA',
        provider,
        signer: { type: 'EOA' },
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('fails closed before loading the provider when the public project ID is missing', async () => {
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', '  ')
    const walletConnect = await loadWalletConnect()

    expect(walletConnect.isWalletConnectConfigured()).toBe(false)
    await expect(
      walletConnect.connectWalletConnectWallet(targetAddress, { prompt: true }),
    ).rejects.toMatchObject({ code: 'walletconnect-not-configured' })
    expect(walletConnectMocks.init).not.toHaveBeenCalled()
  })

  it('initializes a URI-only provider and restores an exact persisted account', async () => {
    const provider = createProvider({
      hasSession: true,
      accounts: [targetAddress],
    })
    walletConnectMocks.init.mockResolvedValue(provider)
    const walletConnect = await loadWalletConnect()

    const connection = await walletConnect.connectWalletConnectWallet(targetAddress)

    expect(walletConnect.isWalletConnectConfigured()).toBe(true)
    expect(walletConnectMocks.init).toHaveBeenCalledWith({
      projectId: 'public-project-id',
      optionalChains: [1, 10, 137, 8453, 42161],
      optionalMethods: [
        'eth_accounts',
        'eth_requestAccounts',
        'personal_sign',
      ],
      optionalEvents: ['accountsChanged', 'chainChanged'],
      showQrModal: false,
      telemetryEnabled: false,
      metadata: {
        name: 'Converge Mini',
        description: 'Authorize a one-time ENS inbox binding.',
        url: window.location.origin,
        icons: [`${window.location.origin}/icon-1024.png`],
      },
    })
    expect(provider.connect).not.toHaveBeenCalled()
    expect(signerMocks.connectEip1193Wallet).toHaveBeenCalledWith(provider, {
      targetAddress,
      accountRequestMethod: 'eth_accounts',
    })
    expect(connection).toMatchObject({ address: targetAddress, provider })
  })

  it('does not prompt when a restorable session is absent', async () => {
    const provider = createProvider()
    walletConnectMocks.init.mockResolvedValue(provider)
    const walletConnect = await loadWalletConnect()

    await expect(
      walletConnect.connectWalletConnectWallet(targetAddress),
    ).rejects.toMatchObject({ code: 'walletconnect-session-unavailable' })
    expect(provider.connect).not.toHaveBeenCalled()
    expect(signerMocks.connectEip1193Wallet).not.toHaveBeenCalled()
  })

  it('forwards an ephemeral pairing URI and removes its listener after pairing', async () => {
    const onDisplayUri = vi.fn()
    const provider = createProvider()
    provider.connect.mockImplementation(async () => {
      provider.emitUri('wc:ephemeral-pairing')
      provider.setSession({ topic: 'new' })
      provider.accounts = [targetAddress]
    })
    walletConnectMocks.init.mockResolvedValue(provider)
    const walletConnect = await loadWalletConnect()

    await walletConnect.connectWalletConnectWallet(targetAddress, {
      prompt: true,
      onDisplayUri,
    })

    expect(onDisplayUri).toHaveBeenCalledWith('wc:ephemeral-pairing')
    expect(provider.on).toHaveBeenCalledWith('display_uri', expect.any(Function))
    expect(provider.on.mock.invocationCallOrder[0]).toBeLessThan(
      provider.connect.mock.invocationCallOrder[0]!,
    )
    const listener = provider.on.mock.calls[0]?.[1]
    expect(provider.removeListener).toHaveBeenCalledWith('display_uri', listener)
  })

  it('replaces a persisted session that exposes the wrong account when prompting', async () => {
    const provider = createProvider({
      hasSession: true,
      accounts: [otherAddress],
    })
    provider.connect.mockImplementation(async () => {
      provider.setSession({ topic: 'replacement' })
      provider.accounts = [targetAddress]
    })
    walletConnectMocks.init.mockResolvedValue(provider)
    const walletConnect = await loadWalletConnect()

    await walletConnect.connectWalletConnectWallet(targetAddress, { prompt: true })

    expect(provider.disconnect).toHaveBeenCalledOnce()
    expect(provider.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      provider.connect.mock.invocationCallOrder[0]!,
    )
    expect(provider.connect).toHaveBeenCalledOnce()
  })

  it('does not replace a wrong-account session during a non-interactive restore', async () => {
    const provider = createProvider({
      hasSession: true,
      accounts: [otherAddress],
    })
    walletConnectMocks.init.mockResolvedValue(provider)
    const walletConnect = await loadWalletConnect()

    await expect(
      walletConnect.connectWalletConnectWallet(targetAddress),
    ).rejects.toMatchObject({
      code: 'walletconnect-target-unavailable',
      targetAddress,
    })
    expect(provider.disconnect).not.toHaveBeenCalled()
    expect(provider.connect).not.toHaveBeenCalled()
  })

  it('maps an exact-account signer mismatch and cleans up a newly paired session', async () => {
    const provider = createProvider()
    walletConnectMocks.init.mockResolvedValue(provider)
    signerMocks.connectEip1193Wallet.mockRejectedValue(
      new signerMocks.WalletTargetUnavailableError(targetAddress),
    )
    const walletConnect = await loadWalletConnect()

    await expect(
      walletConnect.connectWalletConnectWallet(targetAddress, { prompt: true }),
    ).rejects.toMatchObject({
      code: 'walletconnect-target-unavailable',
      targetAddress,
    })
    await vi.waitFor(() => expect(provider.disconnect).toHaveBeenCalledOnce())
  })

  it('classifies a rejected pairing without retaining the URI listener', async () => {
    const provider = createProvider({
      connect: async () => {
        throw Object.assign(new Error('User rejected the request'), { code: 4001 })
      },
    })
    walletConnectMocks.init.mockResolvedValue(provider)
    const walletConnect = await loadWalletConnect()

    await expect(
      walletConnect.connectWalletConnectWallet(targetAddress, {
        prompt: true,
        onDisplayUri: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'walletconnect-cancelled' })
    expect(provider.removeListener).toHaveBeenCalledWith(
      'display_uri',
      expect.any(Function),
    )
  })

  it('returns promptly on abort and disconnects a session created by the late approval', async () => {
    let approve: (() => void) | undefined
    const provider = createProvider({
      connect: () => new Promise<void>((resolve) => {
        approve = () => {
          provider.setSession({ topic: 'late' })
          provider.accounts = [targetAddress]
          resolve()
        }
      }),
    })
    walletConnectMocks.init.mockResolvedValue(provider)
    const walletConnect = await loadWalletConnect()
    const controller = new AbortController()
    const pending = walletConnect.connectWalletConnectWallet(targetAddress, {
      prompt: true,
      signal: controller.signal,
      onDisplayUri: vi.fn(),
    })
    await vi.waitFor(() => expect(provider.connect).toHaveBeenCalledOnce())

    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'walletconnect-cancelled' })
    expect(provider.removeListener).toHaveBeenCalledWith(
      'display_uri',
      expect.any(Function),
    )
    approve?.()
    await vi.waitFor(() => expect(provider.disconnect).toHaveBeenCalledOnce())
    expect(signerMocks.connectEip1193Wallet).not.toHaveBeenCalled()
  })

  it('rejects a stale pairing generation instead of claiming its late session', async () => {
    let approve: (() => void) | undefined
    const provider = createProvider({
      connect: () => new Promise<void>((resolve) => {
        approve = () => {
          provider.setSession({ topic: 'stale' })
          provider.accounts = [targetAddress]
          resolve()
        }
      }),
    })
    walletConnectMocks.init.mockResolvedValue(provider)
    const walletConnect = await loadWalletConnect()
    const stalePairing = walletConnect.connectWalletConnectWallet(targetAddress, {
      prompt: true,
    })
    await vi.waitFor(() => expect(provider.connect).toHaveBeenCalledOnce())

    await expect(
      walletConnect.connectWalletConnectWallet(targetAddress),
    ).rejects.toMatchObject({ code: 'walletconnect-session-unavailable' })
    approve?.()

    await expect(stalePairing).rejects.toMatchObject({
      code: 'walletconnect-cancelled',
    })
    await vi.waitFor(() => expect(provider.disconnect).toHaveBeenCalledOnce())
    expect(signerMocks.connectEip1193Wallet).not.toHaveBeenCalled()
  })

  it('does not let stale cleanup disconnect a newer in-flight pairing', async () => {
    let approveStale: (() => void) | undefined
    let approveCurrent: (() => void) | undefined
    const provider = createProvider()
    provider.connect
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        approveStale = () => {
          provider.setSession({ topic: 'stale' })
          provider.accounts = [targetAddress]
          resolve()
        }
      }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        approveCurrent = () => {
          provider.setSession({ topic: 'current' })
          provider.accounts = [targetAddress]
          resolve()
        }
      }))
    walletConnectMocks.init.mockResolvedValue(provider)
    const walletConnect = await loadWalletConnect()
    const stale = walletConnect.connectWalletConnectWallet(targetAddress, {
      prompt: true,
    })
    await vi.waitFor(() => expect(provider.connect).toHaveBeenCalledOnce())
    const current = walletConnect.connectWalletConnectWallet(targetAddress, {
      prompt: true,
    })
    await vi.waitFor(() => expect(provider.connect).toHaveBeenCalledTimes(2))

    approveStale?.()
    await expect(stale).rejects.toMatchObject({
      code: 'walletconnect-cancelled',
    })
    expect(provider.disconnect).not.toHaveBeenCalled()

    approveCurrent?.()
    await expect(current).resolves.toMatchObject({ address: targetAddress })
    await vi.waitFor(() => expect(provider.disconnect).not.toHaveBeenCalled())
  })

  it('does not initialize a provider merely to perform best-effort disconnect', async () => {
    const walletConnect = await loadWalletConnect()

    await expect(walletConnect.disconnectWalletConnect()).resolves.toBeUndefined()
    expect(walletConnectMocks.init).not.toHaveBeenCalled()
  })
})
