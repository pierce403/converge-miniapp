import { useCallback, useEffect, useRef, useState } from 'react'

import type { HostWalletConnection } from '../../lib/xmtp/signer'
import type { InboxTarget } from '../identity/inboxTarget'
import type { XmtpLease } from '../../lib/xmtp/lease'
import type {
  ConvosAccessSnapshot,
  XmtpIdentityRelationship,
  XmtpMessagingSession,
} from '../../lib/xmtp/session'
import {
  classifyXmtpFailure,
  type XmtpFailureKind,
  type XmtpOperationStage,
} from '../../lib/xmtp/errors'
import type { StorageDurability } from '../../lib/xmtp/storage'
import type {
  ActiveConversation,
  ConvosAccessRequest,
  ConversationSummary,
  MessageItem,
  StreamHealth,
} from './types'
import type { ParsedConvosInvite } from '../../lib/convos/invite'
import { ConvosInviteError } from '../../lib/convos/error'

export type ConnectionPhase =
  | 'idle'
  | 'storage'
  | 'locking'
  | 'wallet'
  | 'xmtp'
  | 'history'
  | 'syncing'
  | 'ready'
  | 'locked'
  | 'unsupported-browser'
  | 'storage-error'
  | 'installation-limit'
  | 'inbox-update-limit'
  | 'configuration-error'
  | 'restart-required'
  | 'target-mismatch'
  | 'target-source-mismatch'
  | 'target-unavailable'
  | 'error'

export type MessagingView = 'inbox' | 'new-dm' | 'join-convos' | 'conversation'

type ConnectionState = {
  error: string | null
  phase: ConnectionPhase
}

type PendingSessionFactory = {
  cancelled: boolean
  cleanup: Promise<void> | null
  promise: Promise<XmtpMessagingSession>
}

const initialConnection: ConnectionState = {
  error: null,
  phase: 'idle',
}

type UseXmtpMessagingOptions = {
  autoConnect?: boolean
  inboxTarget?: InboxTarget | null
}

export type InboxSwitchPreflight = {
  address: `0x${string}`
  inboxId: string
}

export function useXmtpMessaging({
  autoConnect = false,
  inboxTarget = null,
}: UseXmtpMessagingOptions = {}) {
  const mountedRef = useRef(true)
  const connectionAttemptRef = useRef(0)
  const cleanupPromiseRef = useRef<Promise<void> | null>(null)
  const connectingRef = useRef(false)
  const creatingDmRef = useRef(false)
  const refreshingRef = useRef(false)
  const visibleRefreshRef = useRef(false)
  const onlineRefreshPendingRef = useRef(false)
  const foregroundCheckRef = useRef(false)
  const loadingOlderRequestRef = useRef<number | null>(null)
  const sendingRef = useRef(false)
  const retryingMessageIdsRef = useRef(new Set<string>())
  const requestingConvosRef = useRef(false)
  const convosAccessRequestRef = useRef<ConvosAccessRequest | null>(null)
  const sessionRef = useRef<XmtpMessagingSession | null>(null)
  const pendingSessionFactoryRef = useRef<PendingSessionFactory | null>(null)
  const leaseRef = useRef<XmtpLease | null>(null)
  const poisonedLeaseRef = useRef<XmtpLease | null>(null)
  const walletRef = useRef<HostWalletConnection | null>(null)
  const validateWalletRef = useRef<(() => Promise<boolean>) | null>(null)
  const removeWalletListenerRef = useRef<(() => void) | null>(null)
  const inboxRefreshTimerRef = useRef<number | null>(null)
  const activeRef = useRef<ActiveConversation | null>(null)
  const openRequestRef = useRef(0)
  const operationGenerationRef = useRef(0)
  const inboxRequestRef = useRef(0)
  const loadedMessageWindowRef = useRef(0)
  const noticeRevisionRef = useRef(0)

  const [connection, setConnection] = useState<ConnectionState>(initialConnection)
  const [address, setAddress] = useState<`0x${string}` | null>(null)
  const [walletKind, setWalletKind] = useState<'EOA' | 'SCW' | null>(null)
  const [environment, setEnvironment] = useState('')
  const [storageDurability, setStorageDurability] = useState<StorageDurability | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversation, setActiveConversation] = useState<ActiveConversation | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [view, setView] = useState<MessagingView>('inbox')
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [streamHealth, setStreamHealth] = useState<StreamHealth>(() => (
    browserIsKnownOffline() ? 'offline' : 'live'
  ))
  const [notice, setNotice] = useState<string | null>(null)
  const [convosAccessRequest, setConvosAccessRequest] =
    useState<ConvosAccessRequest | null>(null)

  const updateConvosAccessRequest = useCallback((next: ConvosAccessRequest | null) => {
    convosAccessRequestRef.current = next
    setConvosAccessRequest(next)
  }, [])

  const applyConvosAccessSnapshot = useCallback((snapshot: ConvosAccessSnapshot | null) => {
    if (!snapshot || requestingConvosRef.current) return
    const current = convosAccessRequestRef.current
    if (
      current?.messageId &&
      current.messageId !== snapshot.messageId
    ) return
    updateConvosAccessRequest({ ...snapshot })
  }, [updateConvosAccessRequest])

  const updateNotice = useCallback((next: string | null) => {
    noticeRevisionRef.current += 1
    setNotice(next)
  }, [])

  const upsertMessage = useCallback((message: MessageItem) => {
    setMessages((current) => {
      const existingIndex = current.findIndex((item) => item.id === message.id)
      const next = existingIndex === -1
        ? [...current, message]
        : current.map((item, index) => (index === existingIndex ? message : item))
      return next.sort(compareMessages)
    })
  }, [])

  const releaseResources = useCallback(async () => {
    connectionAttemptRef.current += 1
    connectingRef.current = false
    openRequestRef.current += 1
    activeRef.current = null
    operationGenerationRef.current += 1
    inboxRequestRef.current += 1
    loadedMessageWindowRef.current = 0
    refreshingRef.current = false
    visibleRefreshRef.current = false
    onlineRefreshPendingRef.current = false
    foregroundCheckRef.current = false
    loadingOlderRequestRef.current = null
    creatingDmRef.current = false
    sendingRef.current = false
    retryingMessageIdsRef.current.clear()
    requestingConvosRef.current = false
    convosAccessRequestRef.current = null

    const existingCleanup = cleanupPromiseRef.current
    if (existingCleanup) {
      await existingCleanup
      return
    }

    if (inboxRefreshTimerRef.current !== null) {
      window.clearTimeout(inboxRefreshTimerRef.current)
      inboxRefreshTimerRef.current = null
    }

    removeWalletListenerRef.current?.()
    removeWalletListenerRef.current = null
    validateWalletRef.current = null
    walletRef.current = null

    const session = sessionRef.current
    sessionRef.current = null
    const pendingFactory = pendingSessionFactoryRef.current
    pendingSessionFactoryRef.current = null
    if (pendingFactory) pendingFactory.cancelled = true
    const lease = leaseRef.current
    leaseRef.current = null

    const cleanup = (async () => {
      if (session) {
        try {
          await session.close()
        } catch {
          // Closing is best-effort; the OPFS lease is still released below.
        }
      }

      if (pendingFactory) {
        try {
          const pendingSession = await pendingFactory.promise
          if (pendingSession !== session) await pendingSession.close()
        } catch (error) {
          if (isUnsafeInitializationFailure(error)) {
            // Client.create() can leave an inaccessible Worker alive when it
            // rejects. Keep the OPFS lease until a document reload terminates
            // that Worker; never permit a second client in this document.
            if (lease) poisonedLeaseRef.current = lease
            if (mountedRef.current) {
              setConnection({
                error: 'XMTP setup stopped while the wallet connection changed.',
                phase: 'restart-required',
              })
            }
            return
          }
          // Registration and post-create validation failures close the exposed
          // client before rejecting, so they do not poison this document.
        }
      }

      if (lease) await lease.release()
    })()

    if (pendingFactory) pendingFactory.cleanup = cleanup
    cleanupPromiseRef.current = cleanup
    try {
      await cleanup
    } finally {
      if (cleanupPromiseRef.current === cleanup) cleanupPromiseRef.current = null
    }
  }, [])

  const loadInbox = useCallback(async (showSpinner = true) => {
    const session = sessionRef.current
    if (!session || refreshingRef.current) return
    const generation = operationGenerationRef.current
    const request = ++inboxRequestRef.current

    refreshingRef.current = true
    if (showSpinner) setRefreshing(true)
    try {
      let offline = browserIsKnownOffline()
      let next: ConversationSummary[]
      if (offline) {
        next = await session.readInbox()
      } else {
        const outcome = await settleUntilOffline(session.loadInbox())
        if (outcome.status === 'offline') {
          offline = true
          next = await session.readInbox()
        } else {
          next = outcome.value
        }
      }
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        inboxRequestRef.current === request &&
        sessionRef.current === session
      ) {
        setConversations(next)
        applyConvosAccessSnapshot(session.convosAccessSnapshot)
        if (offline) setStreamHealth('offline')
        updateNotice(null)
      }
    } catch (error) {
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        inboxRequestRef.current === request &&
        sessionRef.current === session
      ) {
        updateNotice(readableMessagingError(error, 'The inbox could not refresh.'))
      }
    } finally {
      if (operationGenerationRef.current === generation) {
        refreshingRef.current = false
        if (mountedRef.current) setRefreshing(false)
      }
    }
  }, [applyConvosAccessSnapshot, updateNotice])

  const scheduleInboxRefresh = useCallback(() => {
    if (inboxRefreshTimerRef.current !== null) return
    inboxRefreshTimerRef.current = window.setTimeout(() => {
      inboxRefreshTimerRef.current = null
      const session = sessionRef.current
      if (!session || refreshingRef.current) return
      const generation = operationGenerationRef.current
      const request = ++inboxRequestRef.current
      void session.readInbox().then((next) => {
        if (
          mountedRef.current &&
          operationGenerationRef.current === generation &&
          inboxRequestRef.current === request &&
          sessionRef.current === session
        ) {
          setConversations(next)
          applyConvosAccessSnapshot(session.convosAccessSnapshot)
        }
      }).catch(() => {
        // The next explicit foreground/manual sync will surface the failure.
      })
    }, 300)
  }, [applyConvosAccessSnapshot])

  const startMessageStream = useCallback(async (session: XmtpMessagingSession) => {
    if (browserIsKnownOffline()) {
      if (mountedRef.current && sessionRef.current === session) setStreamHealth('offline')
      return
    }
    const outcome = await settleUntilOffline(session.startMessageStream(
      (message) => {
        if (sessionRef.current !== session) return
        if (activeRef.current?.id === message.conversationId) upsertMessage(message)
        scheduleInboxRefresh()
      },
      (health) => {
        if (mountedRef.current && sessionRef.current === session) {
          setStreamHealth(browserIsKnownOffline() ? 'offline' : health)
        }
      },
      scheduleInboxRefresh,
    ))
    if (
      outcome.status === 'offline' &&
      mountedRef.current &&
      sessionRef.current === session
    ) setStreamHealth('offline')
  }, [scheduleInboxRefresh, upsertMessage])

  const disconnect = useCallback(async () => {
    await releaseResources()
    if (!mountedRef.current) return

    connectingRef.current = false
    sendingRef.current = false
    activeRef.current = null
    setConnection(initialConnection)
    setAddress(null)
    setWalletKind(null)
    setEnvironment('')
    setStorageDurability(null)
    setConversations([])
    setActiveConversation(null)
    setMessages([])
    setView('inbox')
    setLoadingConversation(false)
    setLoadingOlder(false)
    setHasOlderMessages(false)
    setRefreshing(false)
    setSending(false)
    updateConvosAccessRequest(null)
    setStreamHealth('live')
    updateNotice(null)
  }, [releaseResources, updateConvosAccessRequest, updateNotice])

  const connect = useCallback(async () => {
    if (connectingRef.current || sessionRef.current) return
    if (poisonedLeaseRef.current) {
      setConnection({
        error: 'XMTP setup stopped before the client could be closed safely.',
        phase: 'restart-required',
      })
      return
    }
    const attempt = ++connectionAttemptRef.current
    const isCurrent = () => mountedRef.current && connectionAttemptRef.current === attempt

    connectingRef.current = true
    let clientCreationFailed = false
    let failureStage: XmtpOperationStage = 'preflight'
    setConnection({ error: null, phase: 'storage' })
    setStorageDurability(null)
    updateConvosAccessRequest(null)
    updateNotice(null)

    try {
      const cleanup = cleanupPromiseRef.current
      if (cleanup) await cleanup
      if (!isCurrent()) return

      const [
        { acquireXmtpLease },
        { prepareXmtpStorage },
        { connectHostWallet },
        { XmtpClientInitializationError, XmtpMessagingSession },
      ] =
        await Promise.all([
          import('../../lib/xmtp/lease'),
          import('../../lib/xmtp/storage'),
          import('../../lib/xmtp/signer'),
          import('../../lib/xmtp/session'),
        ])
      if (!isCurrent()) return

      const durability = await prepareXmtpStorage()
      if (!isCurrent()) return
      setStorageDurability(durability)

      setConnection({ error: null, phase: 'locking' })
      const lease = await acquireXmtpLease()
      if (!isCurrent()) {
        await lease?.release()
        return
      }
      if (!lease) {
        setConnection({
          error: 'Converge Mini is already using XMTP in another tab or window. Close it there, then try again.',
          phase: 'locked',
        })
        return
      }
      leaseRef.current = lease

      setConnection({ error: null, phase: 'wallet' })
      failureStage = 'wallet'
      const wallet = inboxTarget
        ? await connectHostWallet(inboxTarget.address, inboxTarget.sourceAddress)
        : await connectHostWallet()
      if (!isCurrent()) {
        await lease.release()
        return
      }
      walletRef.current = wallet
      setAddress(wallet.address)
      setWalletKind(wallet.kind)

      const provider = wallet.provider
      let walletInvalidated = false
      const invalidateWallet = (message: string) => {
        if (walletInvalidated || walletRef.current !== wallet) return
        walletInvalidated = true
        activeRef.current = null
        setConnection({
          error: pendingSessionFactoryRef.current
            ? 'The wallet connection changed while XMTP was opening. Reload before reconnecting so local message storage stays safe.'
            : message,
          phase: pendingSessionFactoryRef.current ? 'restart-required' : 'error',
        })
        setAddress(null)
        setWalletKind(null)
        setEnvironment('')
        setStorageDurability(null)
        setConversations([])
        setActiveConversation(null)
        setMessages([])
        setHasOlderMessages(false)
        setLoadingOlder(false)
        setView('inbox')
        updateConvosAccessRequest(null)
        updateNotice(null)
        void releaseResources()
      }
      const expectedSourceAddress = inboxTarget?.sourceAddress
      const onAccountsChanged = (accounts: readonly string[]) => {
        if (!walletAccountIsAvailable(
          accounts,
          wallet.address,
          expectedSourceAddress,
        )) {
          invalidateWallet(
            'Your Farcaster wallet account changed. Reconnect to open the matching XMTP inbox.',
          )
        }
      }
      const onChainChanged = (chainId: string) => {
        try {
          if (BigInt(chainId) !== wallet.chainId) {
            invalidateWallet(
              'Your Farcaster wallet network changed. Reconnect so XMTP can verify the active signer.',
            )
          }
        } catch {
          invalidateWallet(
            'The Farcaster wallet reported an invalid network. Reconnect to continue safely.',
          )
        }
      }
      const onDisconnect = () => {
        invalidateWallet(
          'Your Farcaster wallet disconnected. Reconnect to open the matching XMTP inbox.',
        )
      }
      provider.on('accountsChanged', onAccountsChanged)
      provider.on('chainChanged', onChainChanged)
      provider.on('disconnect', onDisconnect)
      validateWalletRef.current = async () => {
        let accounts: unknown
        let chainId: unknown
        try {
          [accounts, chainId] = await Promise.all([
            provider.request({ method: 'eth_accounts' }),
            provider.request({ method: 'eth_chainId' }),
          ])
        } catch {
          // A host can briefly reject read-only RPC while resuming. Provider
          // events and the next foreground pass still protect identity changes.
          return true
        }

        if (!walletAccountIsAvailable(
          accounts,
          wallet.address,
          expectedSourceAddress,
        )) {
          invalidateWallet(
            'Your Farcaster wallet account changed while the app was away. Reconnect to open the matching XMTP inbox.',
          )
          return false
        }

        try {
          if (typeof chainId !== 'string' || BigInt(chainId) !== wallet.chainId) {
            invalidateWallet(
              'Your Farcaster wallet network changed while the app was away. Reconnect so XMTP can verify the active signer.',
            )
            return false
          }
        } catch {
          invalidateWallet(
            'The Farcaster wallet reported an invalid network after the app resumed. Reconnect to continue safely.',
          )
          return false
        }

        return true
      }
      removeWalletListenerRef.current = () => {
        provider.removeListener('accountsChanged', onAccountsChanged)
        provider.removeListener('chainChanged', onChainChanged)
        provider.removeListener('disconnect', onDisconnect)
      }

      setConnection({ error: null, phase: 'xmtp' })
      failureStage = 'initialize'
      let session: XmtpMessagingSession
      const sessionPromise = XmtpMessagingSession.create(
        wallet.signer,
        wallet.address,
        inboxTarget?.inboxId,
      )
      const pendingFactory: PendingSessionFactory = {
        cancelled: false,
        cleanup: null,
        promise: sessionPromise,
      }
      pendingSessionFactoryRef.current = pendingFactory
      try {
        session = await sessionPromise
      } catch (error) {
        // browser-sdk@7.0.0 does not expose the Client instance when its static
        // create flow rejects, so its Worker cannot be closed safely here.
        // Keep our OPFS lease until the document reloads instead of allowing a
        // second client to contend with that possibly-live Worker.
        clientCreationFailed = error instanceof XmtpClientInitializationError
        throw error
      } finally {
        if (pendingSessionFactoryRef.current === pendingFactory) {
          pendingSessionFactoryRef.current = null
        }
      }
      if (pendingFactory.cancelled) {
        await pendingFactory.cleanup
        return
      }
      if (!isCurrent()) {
        await session.close()
        await lease.release()
        return
      }
      sessionRef.current = session
      setEnvironment(session.environment)

      let recoveryNotice: string | null = null
      let offline = browserIsKnownOffline()
      if (offline) setStreamHealth('offline')
      if (session.isNewInstallation && !offline) {
        setConnection({ error: null, phase: 'history' })
        try {
          const outcome = await settleUntilOffline(session.requestHistorySync())
          if (outcome.status === 'offline') {
            offline = true
            setStreamHealth('offline')
          }
        } catch (error) {
          recoveryNotice = readableMessagingError(
            error,
            'Older-history recovery could not be requested. The local inbox can still open.',
          )
        }
      }
      if (!mountedRef.current || sessionRef.current !== session) return

      setConnection({ error: null, phase: 'syncing' })
      failureStage = 'sync'
      const finalNoticeRevision = noticeRevisionRef.current
      const inboxRequest = ++inboxRequestRef.current
      refreshingRef.current = true
      let cachedInboxRead = false
      try {
        const onCachedInbox = (cached: ConversationSummary[]) => {
          if (
            !mountedRef.current ||
            sessionRef.current !== session ||
            inboxRequestRef.current !== inboxRequest
          ) return
          cachedInboxRead = true
          setConversations(cached)
          applyConvosAccessSnapshot(session.convosAccessSnapshot)
          if (cached.length) {
            setRefreshing(true)
            setConnection({ error: null, phase: 'ready' })
          }
        }
        let nextConversations: ConversationSummary[]
        if (offline) {
          nextConversations = await session.readInbox()
        } else {
          const outcome = await settleUntilOffline(session.loadInbox(onCachedInbox))
          if (outcome.status === 'offline') {
            offline = true
            setStreamHealth('offline')
            nextConversations = await session.readInbox()
          } else {
            nextConversations = outcome.value
          }
        }
        if (offline) {
          cachedInboxRead = true
          onCachedInbox(nextConversations)
        }
        if (
          !mountedRef.current ||
          sessionRef.current !== session ||
          inboxRequestRef.current !== inboxRequest
        ) return
        setConversations(nextConversations)
        applyConvosAccessSnapshot(session.convosAccessSnapshot)
      } catch (error) {
        if (!mountedRef.current || sessionRef.current !== session) return
        if (!cachedInboxRead) throw error
        recoveryNotice = readableMessagingError(
          error,
          'Network sync paused. Showing the inbox saved in this browser.',
        )
        setStreamHealth('failed')
      } finally {
        if (sessionRef.current === session && inboxRequestRef.current === inboxRequest) {
          refreshingRef.current = false
          if (mountedRef.current) setRefreshing(false)
        }
      }

      if (!mountedRef.current || sessionRef.current !== session) return

      if (!offline) {
        try {
          await startMessageStream(session)
        } catch (error) {
          if (mountedRef.current && sessionRef.current === session) {
            setStreamHealth('failed')
            recoveryNotice = readableMessagingError(
              error,
              'Live updates could not start. Manual refresh is still available.',
            )
          }
        }
      }

      if (mountedRef.current && sessionRef.current === session) {
        setConnection({ error: null, phase: 'ready' })
        if (noticeRevisionRef.current === finalNoticeRevision) {
          setNotice(recoveryNotice)
        }
      }
    } catch (error) {
      const shouldReport = isCurrent()
      if (clientCreationFailed) {
        const unsafeLease = leaseRef.current
        leaseRef.current = null
        if (unsafeLease) poisonedLeaseRef.current = unsafeLease
        removeWalletListenerRef.current?.()
        removeWalletListenerRef.current = null
        walletRef.current = null
        if (shouldReport && mountedRef.current) {
          setConnection({
            error: readableMessagingError(
              error,
              'XMTP setup stopped before the client could be closed safely.',
              failureStage,
            ),
            phase: 'restart-required',
          })
        }
        return
      }

      await releaseResources()
      if (shouldReport && mountedRef.current) {
        const targetFailure = inboxTarget ? inboxTargetFailure(error) : null
        if (targetFailure) {
          setConnection({
            error: inboxTargetFailureMessage(targetFailure),
            phase: targetFailure,
          })
          return
        }
        const failure = classifyXmtpFailure(error, failureStage)
        setConnection({
          error: failure.kind === 'unknown'
            ? 'XMTP could not open this inbox.'
            : failure.message,
          phase: connectionFailurePhase(failure.kind),
        })
      }
    } finally {
      if (connectionAttemptRef.current === attempt) connectingRef.current = false
    }
  }, [applyConvosAccessSnapshot, inboxTarget, releaseResources, startMessageStream, updateConvosAccessRequest, updateNotice])

  const prepareInboxSwitch = useCallback(async (
    candidateAddress: `0x${string}`,
  ): Promise<InboxSwitchPreflight> => {
    const session = sessionRef.current
    if (!session || connection.phase !== 'ready') {
      throw new Error('Open the current XMTP inbox before switching.')
    }
    if (candidateAddress.toLowerCase() === session.address.toLowerCase()) {
      throw new Error('That address already opens the current inbox.')
    }

    const generation = operationGenerationRef.current
    const targetInboxId = await session.findInboxId(candidateAddress)
    if (
      sessionRef.current !== session ||
      operationGenerationRef.current !== generation
    ) throw new Error('The current inbox changed during the safety check.')
    if (!targetInboxId) {
      throw new Error('That ENS address does not have an existing XMTP inbox to join.')
    }
    if (targetInboxId === session.inboxId) {
      throw new Error('That ENS address is already part of the current XMTP inbox.')
    }

    const { connectHostWallet } = await import('../../lib/xmtp/signer')
    const targetWallet = await connectHostWallet(candidateAddress, session.address)
    if (
      sessionRef.current !== session ||
      operationGenerationRef.current !== generation
    ) throw new Error('The current inbox changed during the wallet check.')
    if (targetWallet.address.toLowerCase() !== candidateAddress.toLowerCase()) {
      throw new Error('The Farcaster wallet returned a different Ethereum account.')
    }

    return { address: targetWallet.address, inboxId: targetInboxId }
  }, [connection.phase])

  const inspectIdentityRelationship = useCallback(async (
    candidateAddress: `0x${string}`,
  ): Promise<XmtpIdentityRelationship> => {
    const session = sessionRef.current
    if (!session) throw new Error('Open the XMTP inbox before checking another identity.')
    try {
      return await session.inspectIdentityRelationship(candidateAddress)
    } catch (error) {
      throw new Error(
        readableMessagingError(
          error,
          'XMTP could not verify how that address relates to your inbox.',
          'sync',
        ),
        { cause: error },
      )
    }
  }, [])

  const canMessageAddress = useCallback(async (
    candidateAddress: `0x${string}`,
  ): Promise<boolean> => {
    const session = sessionRef.current
    if (!session) throw new Error('Open the XMTP inbox before checking a recipient.')
    if (browserIsKnownOffline()) {
      throw new Error('Reconnect before checking a new recipient.')
    }
    try {
      return await session.canMessageAddress(candidateAddress)
    } catch (error) {
      throw new Error(
        readableMessagingError(
          error,
          'XMTP could not check that recipient right now.',
          'sync',
        ),
        { cause: error },
      )
    }
  }, [])

  const openConversation = useCallback(async (
    conversationId: string,
    seed?: ActiveConversation,
  ) => {
    const session = sessionRef.current
    if (!session) return

    const request = ++openRequestRef.current
    loadingOlderRequestRef.current = null
    loadedMessageWindowRef.current = 0
    const summary = conversations.find((item) => item.id === conversationId)
    const initial = seed ?? (summary ? activeFromSummary(summary) : null)

    if (initial) {
      activeRef.current = initial
      setActiveConversation(initial)
    }
    setMessages([])
    setHasOlderMessages(false)
    setLoadingOlder(false)
    setLoadingConversation(true)
    setView('conversation')
    updateNotice(null)

    let cachedConversationRead = false
    try {
      let offline = browserIsKnownOffline()
      const onCachedConversation = (cached: Awaited<ReturnType<
        XmtpMessagingSession['readConversation']
      >>) => {
        if (
          !mountedRef.current ||
          request !== openRequestRef.current ||
          sessionRef.current !== session
        ) return

        cachedConversationRead = true
        const resolvedConversation = preservePeerAddress(
          cached.conversation,
          activeRef.current,
        )
        activeRef.current = resolvedConversation
        setActiveConversation(resolvedConversation)
        setMessages((current) => mergeMessages(cached.messages, current))
        loadedMessageWindowRef.current = Math.max(
          loadedMessageWindowRef.current,
          scannedWindowSize(cached),
        )
        setHasOlderMessages(cached.hasOlder)
      }
      let loaded: Awaited<ReturnType<XmtpMessagingSession['readConversation']>>
      if (offline) {
        loaded = await session.readConversation(conversationId)
      } else {
        const outcome = await settleUntilOffline(
          session.loadConversation(conversationId, onCachedConversation),
        )
        if (outcome.status === 'offline') {
          offline = true
          loaded = await session.readConversation(conversationId)
        } else {
          loaded = outcome.value
        }
      }
      if (offline) {
        cachedConversationRead = true
        onCachedConversation(loaded)
        setStreamHealth('offline')
      }
      if (
        !mountedRef.current ||
        request !== openRequestRef.current ||
        sessionRef.current !== session
      ) return

      const resolvedConversation = preservePeerAddress(
        loaded.conversation,
        activeRef.current,
      )
      activeRef.current = resolvedConversation
      setActiveConversation(resolvedConversation)
      setMessages((current) => mergeMessages(current, loaded.messages))
      loadedMessageWindowRef.current = Math.max(
        loadedMessageWindowRef.current,
        scannedWindowSize(loaded),
      )
      setHasOlderMessages(loaded.hasOlder)
    } catch (error) {
      if (mountedRef.current && request === openRequestRef.current) {
        if (cachedConversationRead) {
          updateNotice(readableMessagingError(
            error,
            'Network sync paused. Showing messages saved in this browser.',
          ))
        } else {
          updateNotice(readableMessagingError(error, 'This conversation could not sync.'))
          setView('inbox')
          activeRef.current = null
          setActiveConversation(null)
        }
      }
    } finally {
      if (mountedRef.current && request === openRequestRef.current) {
        setLoadingConversation(false)
      }
    }
  }, [conversations, updateNotice])

  const loadOlderMessages = useCallback(async () => {
    const session = sessionRef.current
    const conversation = activeRef.current
    const request = openRequestRef.current
    if (
      !session ||
      !conversation ||
      !hasOlderMessages ||
      loadingOlderRequestRef.current === request
    ) return

    const generation = operationGenerationRef.current
    loadingOlderRequestRef.current = request
    setLoadingOlder(true)
    try {
      const page = await session.loadOlderMessages(
        conversation.id,
        loadedMessageWindowRef.current,
      )
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        openRequestRef.current === request &&
        sessionRef.current === session &&
        activeRef.current?.id === conversation.id
      ) {
        loadedMessageWindowRef.current = Math.max(
          loadedMessageWindowRef.current,
          scannedWindowSize(page),
        )
        setMessages((current) => mergeMessages(current, page.messages))
        setHasOlderMessages(page.hasOlder)
      }
    } catch (error) {
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        openRequestRef.current === request &&
        sessionRef.current === session &&
        activeRef.current?.id === conversation.id
      ) {
        updateNotice(readableMessagingError(error, 'Earlier messages could not load.'))
      }
    } finally {
      if (loadingOlderRequestRef.current === request) {
        loadingOlderRequestRef.current = null
        if (mountedRef.current) setLoadingOlder(false)
      }
    }
  }, [hasOlderMessages, updateNotice])

  const createDm = useCallback(async (recipient: `0x${string}`) => {
    const session = sessionRef.current
    if (!session) throw new Error('Connect the XMTP inbox first.')
    if (browserIsKnownOffline()) {
      throw new Error('Reconnect before starting a new conversation.')
    }
    if (creatingDmRef.current) return
    if (recipient.toLowerCase() === session.address.toLowerCase()) {
      throw new Error('That is the wallet already connected to this inbox.')
    }

    const generation = operationGenerationRef.current
    const request = openRequestRef.current
    creatingDmRef.current = true
    try {
      const conversation = await session.createDm(recipient)
      if (
        operationGenerationRef.current !== generation ||
        openRequestRef.current !== request ||
        sessionRef.current !== session
      ) return
      void loadInbox(false)
      await openConversation(conversation.id, conversation)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'That address does not have a reachable XMTP inbox yet.'
      ) throw error
      throw new Error(
        readableMessagingError(error, 'XMTP could not check that address.', 'sync'),
        { cause: error },
      )
    } finally {
      if (operationGenerationRef.current === generation) {
        creatingDmRef.current = false
      }
    }
  }, [loadInbox, openConversation])

  const requestConvosAccess = useCallback(async (invite: ParsedConvosInvite) => {
    const session = sessionRef.current
    if (!session) throw new Error('Connect the XMTP inbox first.')
    if (browserIsKnownOffline()) {
      throw new Error('Reconnect before requesting access to this conversation.')
    }
    if (requestingConvosRef.current) return

    const generation = operationGenerationRef.current
    requestingConvosRef.current = true
    updateConvosAccessRequest({
      conversationId: null,
      error: null,
      groupId: null,
      invite,
      messageId: null,
      retryMode: 'none',
      status: 'sending',
    })
    try {
      const result = await session.requestConvosAccess(invite)
      if (
        !mountedRef.current ||
        operationGenerationRef.current !== generation ||
        sessionRef.current !== session
      ) return
      updateConvosAccessRequest({
        conversationId: result.conversationId,
        error: null,
        groupId: null,
        invite,
        messageId: result.messageId,
        retryMode: 'none',
        status: 'waiting',
      })
    } catch (error) {
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        sessionRef.current === session
      ) {
        updateConvosAccessRequest({
          conversationId: null,
          error: readableMessagingError(
            error,
            'XMTP could not send the Convos access request.',
            'send',
          ),
          groupId: null,
          invite,
          messageId: null,
          retryMode: 'fresh',
          status: 'failed',
        })
      }
    } finally {
      if (operationGenerationRef.current === generation) {
        requestingConvosRef.current = false
        if (convosAccessRequestRef.current?.status === 'waiting') {
          applyConvosAccessSnapshot(session.convosAccessSnapshot)
        }
      }
    }
  }, [applyConvosAccessSnapshot, updateConvosAccessRequest])

  const retryConvosAccess = useCallback(async () => {
    const session = sessionRef.current
    const pending = convosAccessRequestRef.current
    if (
      !session ||
      !pending ||
      pending.status !== 'failed' ||
      pending.retryMode !== 'fresh' ||
      requestingConvosRef.current
    ) return
    if (browserIsKnownOffline()) {
      throw new Error('Reconnect before retrying this access request.')
    }

    const generation = operationGenerationRef.current
    requestingConvosRef.current = true
    updateConvosAccessRequest({
      ...pending,
      error: null,
      retryMode: 'none',
      status: 'sending',
    })
    try {
      const { parseConvosInvite } = await import('../../lib/convos/invite')
      const freshInvite = parseConvosInvite(pending.invite.slug)
      const result = await session.requestConvosAccess(freshInvite)
      if (
        !mountedRef.current ||
        operationGenerationRef.current !== generation ||
        sessionRef.current !== session
      ) return
      updateConvosAccessRequest({
        ...pending,
        conversationId: result.conversationId,
        error: null,
        invite: freshInvite,
        messageId: result.messageId,
        retryMode: 'none',
        status: 'waiting',
      })
    } catch (error) {
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        sessionRef.current === session
      ) {
        updateConvosAccessRequest({
          ...pending,
          error: error instanceof ConvosInviteError
            ? error.message
            : readableMessagingError(
              error,
              'XMTP could not retry the Convos access request.',
              'send',
            ),
          retryMode: error instanceof ConvosInviteError
            ? 'reset'
            : 'fresh',
          status: 'failed',
        })
      }
    } finally {
      if (operationGenerationRef.current === generation) {
        requestingConvosRef.current = false
        if (convosAccessRequestRef.current?.status === 'waiting') {
          applyConvosAccessSnapshot(session.convosAccessSnapshot)
        }
      }
    }
  }, [applyConvosAccessSnapshot, updateConvosAccessRequest])

  const resetConvosAccessRequest = useCallback(() => {
    const pending = convosAccessRequestRef.current
    if (
      requestingConvosRef.current ||
      pending?.status !== 'failed'
    ) return
    if (pending.messageId) {
      sessionRef.current?.dismissConvosAccessRequest(pending.messageId)
    }
    updateConvosAccessRequest(null)
  }, [updateConvosAccessRequest])

  const sendMessage = useCallback(async (text: string) => {
    const session = sessionRef.current
    const conversation = activeRef.current
    if (!session || !conversation || sendingRef.current) return
    if (browserIsKnownOffline()) {
      const error = new Error('Reconnect before sending this message.')
      updateNotice(error.message)
      throw error
    }

    const generation = operationGenerationRef.current
    sendingRef.current = true
    setSending(true)
    updateNotice(null)
    try {
      const result = await session.sendText(
        conversation.id,
        text,
        (message) => {
          if (
            operationGenerationRef.current === generation &&
            sessionRef.current === session &&
            activeRef.current?.id === conversation.id
          ) upsertMessage(message)
        },
      )
      if (
        operationGenerationRef.current === generation &&
        sessionRef.current === session &&
        activeRef.current?.id === conversation.id
      ) {
        upsertMessage(result.message)
        if (result.error) updateNotice(result.error)
        scheduleInboxRefresh()
      }
    } catch (error) {
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        sessionRef.current === session &&
        activeRef.current?.id === conversation.id
      ) {
        updateNotice(readableMessagingError(error, 'XMTP could not send that message.', 'send'))
      }
      throw error
    } finally {
      if (operationGenerationRef.current === generation) {
        sendingRef.current = false
        if (mountedRef.current) setSending(false)
      }
    }
  }, [scheduleInboxRefresh, updateNotice, upsertMessage])

  const retryMessage = useCallback(async (messageId: string) => {
    const session = sessionRef.current
    const conversation = activeRef.current
    if (!session || !conversation || retryingMessageIdsRef.current.has(messageId)) return
    if (browserIsKnownOffline()) {
      updateNotice('Reconnect before retrying this message.')
      return
    }

    const generation = operationGenerationRef.current
    retryingMessageIdsRef.current.add(messageId)
    setMessages((current) => current.map((message) => (
      message.id === messageId ? { ...message, delivery: 'sending' } : message
    )))
    try {
      const result = await session.retryMessage(conversation.id, messageId)
      if (
        operationGenerationRef.current === generation &&
        sessionRef.current === session &&
        activeRef.current?.id === conversation.id
      ) {
        upsertMessage(result.message)
        updateNotice(result.error)
        scheduleInboxRefresh()
      }
    } catch (error) {
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        sessionRef.current === session &&
        activeRef.current?.id === conversation.id
      ) {
        setMessages((current) => current.map((message) => (
          message.id === messageId ? { ...message, delivery: 'failed' } : message
        )))
        updateNotice(readableMessagingError(error, 'XMTP could not retry that message.', 'send'))
      }
    } finally {
      if (operationGenerationRef.current === generation) {
        retryingMessageIdsRef.current.delete(messageId)
      }
    }
  }, [scheduleInboxRefresh, updateNotice, upsertMessage])

  const backToInbox = useCallback(() => {
    openRequestRef.current += 1
    loadingOlderRequestRef.current = null
    loadedMessageWindowRef.current = 0
    activeRef.current = null
    setActiveConversation(null)
    setMessages([])
    setHasOlderMessages(false)
    setLoadingOlder(false)
    setLoadingConversation(false)
    setView('inbox')
  }, [])

  const refreshVisibleState = useCallback(async function refreshVisibleState() {
    const session = sessionRef.current
    if (!session || visibleRefreshRef.current) return

    const generation = operationGenerationRef.current
    let offline = browserIsKnownOffline()
    onlineRefreshPendingRef.current = false
    if (offline) setStreamHealth('offline')
    visibleRefreshRef.current = true
    try {
      await loadInbox(false)
      offline = browserIsKnownOffline()

      const conversation = activeRef.current
      if (conversation) {
        try {
          let loaded: Awaited<ReturnType<XmtpMessagingSession['readConversation']>>
          if (offline) {
            loaded = await session.readConversation(
              conversation.id,
              loadedMessageWindowRef.current,
            )
          } else {
            const outcome = await settleUntilOffline(
              session.loadConversation(
                conversation.id,
                undefined,
                loadedMessageWindowRef.current,
              ),
            )
            if (outcome.status === 'offline') {
              offline = true
              loaded = await session.readConversation(
                conversation.id,
                loadedMessageWindowRef.current,
              )
            } else {
              loaded = outcome.value
            }
          }
          if (
            mountedRef.current &&
            operationGenerationRef.current === generation &&
            sessionRef.current === session &&
            activeRef.current?.id === conversation.id
          ) {
            const resolvedConversation = preservePeerAddress(
              loaded.conversation,
              activeRef.current,
            )
            activeRef.current = resolvedConversation
            setActiveConversation(resolvedConversation)
            loadedMessageWindowRef.current = Math.max(
              loadedMessageWindowRef.current,
              scannedWindowSize(loaded),
            )
            setMessages((current) => mergeMessages(current, loaded.messages))
            setHasOlderMessages(loaded.hasOlder)
          }
        } catch (error) {
          if (
            mountedRef.current &&
            operationGenerationRef.current === generation &&
            sessionRef.current === session &&
            activeRef.current?.id === conversation.id
          ) {
            updateNotice(readableMessagingError(
              error,
              'This conversation could not refresh. Saved messages remain available.',
            ))
          }
        }
      }

      if (
        !browserIsKnownOffline() &&
        !onlineRefreshPendingRef.current &&
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        sessionRef.current === session
      ) {
        try {
          await startMessageStream(session)
        } catch (error) {
          if (
            mountedRef.current &&
            operationGenerationRef.current === generation &&
            sessionRef.current === session
          ) {
            setStreamHealth('failed')
            updateNotice(readableMessagingError(
              error,
              'Live updates could not restart. Manual refresh is still available.',
            ))
          }
        }
      }
    } finally {
      if (operationGenerationRef.current === generation) {
        visibleRefreshRef.current = false
        if (
          onlineRefreshPendingRef.current &&
          !browserIsKnownOffline() &&
          mountedRef.current &&
          sessionRef.current === session
        ) {
          onlineRefreshPendingRef.current = false
          window.setTimeout(() => void refreshVisibleState(), 0)
        }
      }
    }
  }, [loadInbox, startMessageStream, updateNotice])

  useEffect(() => {
    const refreshForeground = async () => {
      if (
        document.visibilityState === 'hidden' ||
        !sessionRef.current ||
        foregroundCheckRef.current
      ) return

      foregroundCheckRef.current = true
      try {
        const validateWallet = validateWalletRef.current
        if (validateWallet && !(await validateWallet())) return
        if (sessionRef.current) await refreshVisibleState()
      } finally {
        foregroundCheckRef.current = false
      }
    }
    const onForeground = () => void refreshForeground()
    const onOnline = () => {
      if (mountedRef.current && sessionRef.current) {
        onlineRefreshPendingRef.current = true
        setStreamHealth('retrying')
        if (visibleRefreshRef.current || foregroundCheckRef.current) return
      }
      onForeground()
    }
    const onOffline = () => {
      if (mountedRef.current && sessionRef.current) setStreamHealth('offline')
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') onForeground()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onForeground)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pageshow', onForeground)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onForeground)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('pageshow', onForeground)
    }
  }, [refreshVisibleState])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void releaseResources()
    }
  }, [releaseResources])

  useEffect(() => {
    if (!autoConnect) return
    const timer = window.setTimeout(() => void connect(), 0)
    return () => window.clearTimeout(timer)
  }, [autoConnect, connect])

  return {
    activeConversation,
    address,
    backToInbox,
    canMessageAddress,
    connect,
    connection,
    convosAccessRequest,
    conversations,
    createDm,
    disconnect,
    environment,
    loadingConversation,
    loadingOlder,
    hasOlderMessages,
    inspectIdentityRelationship,
    prepareInboxSwitch,
    loadOlderMessages,
    messages,
    notice,
    openConversation,
    refresh: () => loadInbox(true),
    requestConvosAccess,
    resetConvosAccessRequest,
    retryLiveUpdates: refreshVisibleState,
    retryConvosAccess,
    refreshing,
    retryMessage,
    sendMessage,
    sending,
    setNotice: updateNotice,
    setView,
    streamHealth,
    storageDurability,
    view,
    walletKind,
  }
}

function browserIsKnownOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

async function settleUntilOffline<T>(promise: Promise<T>): Promise<
  | { status: 'completed'; value: T }
  | { status: 'offline' }
> {
  return await new Promise((resolve, reject) => {
    let settled = false
    const finish = (
      result: { status: 'completed'; value: T } | { status: 'offline' },
    ) => {
      if (settled) return
      settled = true
      window.removeEventListener('offline', onOffline)
      resolve(result)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      window.removeEventListener('offline', onOffline)
      reject(error)
    }
    const onOffline = () => finish({ status: 'offline' })

    window.addEventListener('offline', onOffline, { once: true })
    if (browserIsKnownOffline()) onOffline()
    void promise.then(
      (value) => finish({ status: 'completed', value }),
      fail,
    )
  })
}

function walletAccountIsAvailable(
  accounts: unknown,
  address: `0x${string}`,
  expectedSourceAddress?: `0x${string}`,
): boolean {
  if (!Array.isArray(accounts)) return false
  if (expectedSourceAddress && (
    typeof accounts[0] !== 'string' ||
    accounts[0].toLowerCase() !== expectedSourceAddress.toLowerCase()
  )) return false
  const candidates = expectedSourceAddress ? accounts : accounts.slice(0, 1)
  return candidates.some((account: unknown) => (
    typeof account === 'string' && account.toLowerCase() === address.toLowerCase()
  ))
}

function inboxTargetFailure(
  error: unknown,
): 'target-mismatch' | 'target-source-mismatch' | 'target-unavailable' | null {
  if (!error || typeof error !== 'object') return null
  if ('code' in error && error.code === 'host-wallet-target-unavailable') {
    return 'target-unavailable'
  }
  if ('name' in error && error.name === 'XmtpInboxTargetMismatchError') {
    return 'target-mismatch'
  }
  if ('code' in error && error.code === 'host-wallet-source-mismatch') {
    return 'target-source-mismatch'
  }
  return null
}

function isUnsafeInitializationFailure(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'XmtpClientInitializationError',
  )
}

function inboxTargetFailureMessage(
  failure: 'target-mismatch' | 'target-source-mismatch' | 'target-unavailable',
): string {
  if (failure === 'target-unavailable') {
    return 'Farcaster does not expose the exact saved ENS address as a signing wallet.'
  }
  if (failure === 'target-source-mismatch') {
    return 'The saved inbox selection does not match the preferred Farcaster account.'
  }
  return 'XMTP opened a different inbox than the verified target.'
}

function readableMessagingError(
  error: unknown,
  fallback: string,
  stage: XmtpOperationStage = 'sync',
): string {
  const failure = classifyXmtpFailure(error, stage)
  return failure.kind === 'unknown' ? fallback : failure.message
}

function connectionFailurePhase(kind: XmtpFailureKind): ConnectionPhase {
  if (kind === 'configuration') return 'configuration-error'
  if (kind === 'installation-limit') return 'installation-limit'
  if (kind === 'inbox-update-limit') return 'inbox-update-limit'
  if (kind === 'unsupported-browser') return 'unsupported-browser'
  if (
    kind === 'storage-contention' ||
    kind === 'storage-full' ||
    kind === 'storage-denied' ||
    kind === 'storage-corrupt'
  ) return 'storage-error'
  return 'error'
}

function mergeMessages(...collections: MessageItem[][]): MessageItem[] {
  const messages = new Map<string, MessageItem>()
  for (const collection of collections) {
    for (const message of collection) {
      const existing = messages.get(message.id)
      if (!existing || deliveryRank(message) >= deliveryRank(existing)) {
        messages.set(message.id, message)
      }
    }
  }
  return [...messages.values()].sort(compareMessages)
}

function deliveryRank(message: MessageItem): number {
  if (message.delivery === 'sent') return 2
  if (message.delivery === 'sending') return 1
  return 0
}

function compareMessages(left: MessageItem, right: MessageItem): number {
  if (left.sentAtNs < right.sentAtNs) return -1
  if (left.sentAtNs > right.sentAtNs) return 1
  return left.id.localeCompare(right.id)
}

function scannedWindowSize(page: {
  messages: MessageItem[]
  scannedMessageCount?: number
}): number {
  const scannedMessageCount = page.scannedMessageCount
  return typeof scannedMessageCount === 'number' &&
    Number.isSafeInteger(scannedMessageCount) &&
    scannedMessageCount >= page.messages.length
    ? scannedMessageCount
    : page.messages.length
}

function preservePeerAddress(
  next: ActiveConversation,
  current: ActiveConversation | null,
): ActiveConversation {
  if (next.kind === 'convos-group') return next
  if (current?.kind !== 'dm') return next
  if (next.peerAddress || current?.id !== next.id || !current.peerAddress) return next
  return { ...next, peerAddress: current.peerAddress }
}

function activeFromSummary(summary: ConversationSummary): ActiveConversation {
  if (summary.kind === 'convos-group') {
    return {
      creatorInboxId: summary.creatorInboxId,
      emoji: summary.emoji,
      id: summary.id,
      kind: 'convos-group',
      peerAddress: null,
      peerInboxId: null,
      title: summary.title,
    }
  }
  return {
    id: summary.id,
    kind: 'dm',
    peerAddress: summary.peerAddress,
    peerInboxId: summary.peerInboxId,
  }
}
