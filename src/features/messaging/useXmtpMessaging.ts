import { useCallback, useEffect, useRef, useState } from 'react'

import type { WalletConnection } from '../../lib/xmtp/signer'
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
import {
  disableXmtpAlertRegistration,
  syncXmtpAlertRegistration,
} from '../../lib/xmtp/alertRegistration'

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

const RESUME_WALLET_RETRY_DELAYS_MS = [0, 100, 300] as const
const RESUME_WALLET_REQUEST_TIMEOUT_MS = 2_000
const PROVIDER_EVENT_WALLET_RECHECK_DELAY_MS = 750

type UseXmtpMessagingOptions = {
  autoConnect?: boolean
  inboxTarget?: InboxTarget | null
  notificationFid?: number
}

export type InboxBindingResult = {
  address: `0x${string}`
  chainId: string
  inboxId: string
  walletKind: 'EOA' | 'SCW'
}

type InboxSwitchOptions = {
  onCommitting?: (() => void) | undefined
  onPairingUri?: (uri: string) => void
  signal?: AbortSignal
}

export function useXmtpMessaging({
  autoConnect = false,
  inboxTarget = null,
  notificationFid,
}: UseXmtpMessagingOptions = {}) {
  const mountedRef = useRef(true)
  const connectionAttemptRef = useRef(0)
  const cleanupPromiseRef = useRef<Promise<void> | null>(null)
  const connectingRef = useRef(false)
  const creatingDmRef = useRef(false)
  const refreshingRef = useRef(false)
  const visibleRefreshRef = useRef(false)
  const onlineRefreshPendingRef = useRef(false)
  const foregroundCheckRef = useRef<symbol | null>(null)
  const foregroundRefreshNeededRef = useRef(false)
  const foregroundEventPendingRef = useRef(false)
  const backgroundEpochRef = useRef(0)
  const confirmedBackgroundRef = useRef(false)
  const foregroundRefreshCallbackRef = useRef<() => void>(() => undefined)
  const visibleRefreshCallbackRef = useRef<() => void>(() => undefined)
  const loadingOlderRequestRef = useRef<number | null>(null)
  const sendingRef = useRef(false)
  const retryingMessageIdsRef = useRef(new Set<string>())
  const requestingConvosRef = useRef(false)
  const convosAccessRequestRef = useRef<ConvosAccessRequest | null>(null)
  const sessionRef = useRef<XmtpMessagingSession | null>(null)
  const pendingSessionFactoryRef = useRef<PendingSessionFactory | null>(null)
  const leaseRef = useRef<XmtpLease | null>(null)
  const poisonedLeaseRef = useRef<XmtpLease | null>(null)
  const walletRef = useRef<WalletConnection | null>(null)
  const validateWalletRef = useRef<(() => Promise<boolean>) | null>(null)
  const removeWalletListenerRef = useRef<(() => void) | null>(null)
  const inboxRefreshTimerRef = useRef<number | null>(null)
  const activeRef = useRef<ActiveConversation | null>(null)
  const openRequestRef = useRef(0)
  const operationGenerationRef = useRef(0)
  const inboxRequestRef = useRef(0)
  const loadedMessageWindowRef = useRef(0)
  const noticeRevisionRef = useRef(0)
  const alertSyncPromiseRef = useRef<Promise<void> | null>(null)
  const alertSyncDirtyRef = useRef(false)
  const alertSyncCallbackRef = useRef<() => Promise<void>>(async () => undefined)
  const alertsEnabledRef = useRef(false)
  const notificationFidRef = useRef(notificationFid)

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

  const syncAlerts = useCallback(async () => {
    alertsEnabledRef.current = true
    alertSyncDirtyRef.current = true
    if (alertSyncPromiseRef.current) {
      return await alertSyncPromiseRef.current
    }
    const sync = (async () => {
      while (alertsEnabledRef.current && alertSyncDirtyRef.current) {
        alertSyncDirtyRef.current = false
        const session = sessionRef.current
        const fid = notificationFidRef.current
        if (!session || !fid) return
        try {
          await session.startPushTopicStream(() => {
            if (!alertsEnabledRef.current) return
            alertSyncDirtyRef.current = true
            void alertSyncCallbackRef.current().catch(() => undefined)
          })
          await syncXmtpAlertRegistration(session, fid)
        } catch (error) {
          if (alertsEnabledRef.current && sessionRef.current !== session) {
            alertSyncDirtyRef.current = true
            continue
          }
          throw error
        }
        if (sessionRef.current !== session || notificationFidRef.current !== fid) {
          alertSyncDirtyRef.current = true
        }
      }
    })()
    alertSyncPromiseRef.current = sync
    try {
      await sync
    } finally {
      if (alertSyncPromiseRef.current === sync) alertSyncPromiseRef.current = null
    }
  }, [])

  useEffect(() => {
    alertSyncCallbackRef.current = syncAlerts
  }, [syncAlerts])

  useEffect(() => {
    notificationFidRef.current = notificationFid
    if (alertsEnabledRef.current) {
      alertSyncDirtyRef.current = true
      void alertSyncCallbackRef.current().catch(() => undefined)
    }
  }, [notificationFid])

  const disableAlerts = useCallback(async () => {
    alertsEnabledRef.current = false
    alertSyncDirtyRef.current = false
    await sessionRef.current?.stopPushTopicStream()
    await alertSyncPromiseRef.current?.catch(() => undefined)
    await disableXmtpAlertRegistration()
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
    foregroundCheckRef.current = null
    foregroundRefreshNeededRef.current = false
    foregroundEventPendingRef.current = false
    backgroundEpochRef.current += 1
    confirmedBackgroundRef.current = false
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
        if (alertsEnabledRef.current) void syncAlerts().catch(() => undefined)
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
  }, [applyConvosAccessSnapshot, syncAlerts, updateNotice])

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

  const connectWithWalletPrompt = useCallback(async () => {
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
        {
          connectHostWallet,
          parseEip1193ChainId,
        },
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
        ? await connectHostWallet(inboxTarget.sourceAddress, inboxTarget.sourceAddress)
        : await connectHostWallet()
      if (inboxTarget) assertPersistedWalletMetadata(inboxTarget, wallet)
      if (!isCurrent()) {
        await lease.release()
        return
      }
      walletRef.current = wallet
      setAddress(wallet.address)
      setWalletKind(wallet.kind)

      const provider = wallet.provider
      let walletInvalidated = false
      let providerEventWalletTimer: number | null = null
      const invalidateWallet = (
        message: string,
        phase: ConnectionPhase = 'error',
      ) => {
        if (walletInvalidated || walletRef.current !== wallet) return
        walletInvalidated = true
        activeRef.current = null
        setConnection({
          error: pendingSessionFactoryRef.current
            ? 'The wallet connection changed while XMTP was opening. Reload before reconnecting so local message storage stays safe.'
            : message,
          phase: pendingSessionFactoryRef.current ? 'restart-required' : phase,
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
      const expectedPreferredTarget = inboxTarget?.sourceAddress
      const cancelProviderEventWalletRecheck = () => {
        if (providerEventWalletTimer === null) return
        window.clearTimeout(providerEventWalletTimer)
        providerEventWalletTimer = null
      }
      const scheduleProviderEventWalletRecheck = () => {
        if (walletInvalidated || providerEventWalletTimer !== null) return
        const scheduledEpoch = backgroundEpochRef.current
        providerEventWalletTimer = window.setTimeout(() => {
          providerEventWalletTimer = null
          if (
            walletInvalidated ||
            walletRef.current !== wallet ||
            backgroundEpochRef.current !== scheduledEpoch
          ) return
          void validateWalletRef.current?.()
        }, PROVIDER_EVENT_WALLET_RECHECK_DELAY_MS)
      }
      const onAccountsChanged = (accounts: readonly string[]) => {
        if (walletAccountIsAvailable(
          accounts,
          wallet.address,
          expectedPreferredTarget,
        )) {
          cancelProviderEventWalletRecheck()
          return
        }

        // Embedded hosts can briefly report no accounts while native chrome,
        // Quick Auth, or another host-owned overlay is taking focus. A concrete
        // different account is authoritative and still closes immediately. An
        // empty list gets a bounded wallet-only recheck without refreshing XMTP.
        const hasConcreteAccount = accounts.some((account) => account.length > 0)
        if (hasConcreteAccount || pendingSessionFactoryRef.current) {
          invalidateWallet('Your Farcaster wallet account changed. Reconnect to open the matching XMTP inbox.')
          return
        }
        scheduleProviderEventWalletRecheck()
      }
      const onChainChanged = (chainId: string) => {
        if (wallet.kind !== 'SCW') return
        try {
          if (parseEip1193ChainId(chainId) !== wallet.chainId) {
            invalidateWallet('Your Farcaster wallet network changed. Reconnect so XMTP can verify the active signer.')
          }
        } catch {
          invalidateWallet('The Farcaster wallet reported an invalid network. Reconnect to continue safely.')
        }
      }
      const onDisconnect = () => {
        // The Farcaster RPC bridge can emit a transient disconnect while a
        // host-owned overlay changes. Do not destroy an already-open XMTP
        // session from that visible first-use churn; use a delayed wallet-only
        // recheck without resuming inbox or stream work.
        if (pendingSessionFactoryRef.current) {
          invalidateWallet('Your Farcaster wallet disconnected. Reconnect to open the matching XMTP inbox.')
          return
        }
        scheduleProviderEventWalletRecheck()
      }
      provider.on('accountsChanged', onAccountsChanged)
      provider.on('chainChanged', onChainChanged)
      provider.on('disconnect', onDisconnect)
      validateWalletRef.current = async () => {
        const validationEpoch = backgroundEpochRef.current
        for (const [attempt, delayMs] of RESUME_WALLET_RETRY_DELAYS_MS.entries()) {
          if (delayMs) await waitForWalletResume(delayMs)
          if (
            walletRef.current !== wallet ||
            backgroundEpochRef.current !== validationEpoch
          ) return false

          let accounts: unknown
          let chainId: unknown
          try {
            [accounts, chainId] = await withWalletResumeTimeout(Promise.all([
              provider.request({ method: 'eth_accounts' }),
              wallet.kind === 'SCW'
                ? provider.request({ method: 'eth_chainId' })
                : Promise.resolve(wallet.chainId),
            ]))
          } catch {
            if (
              walletRef.current !== wallet ||
              backgroundEpochRef.current !== validationEpoch
            ) return false
            if (attempt < RESUME_WALLET_RETRY_DELAYS_MS.length - 1) continue
            invalidateWallet('Converge Mini could not reverify the Farcaster wallet after the app resumed. Reconnect it to continue safely.')
            return false
          }
          if (
            walletRef.current !== wallet ||
            backgroundEpochRef.current !== validationEpoch
          ) return false

          if (!walletAccountIsAvailable(
            accounts,
            wallet.address,
            expectedPreferredTarget,
          )) {
            const accountResultIsTransient = !Array.isArray(accounts) ||
              accounts.length === 0 || typeof accounts[0] !== 'string'
            if (
              accountResultIsTransient &&
              attempt < RESUME_WALLET_RETRY_DELAYS_MS.length - 1
            ) continue
            invalidateWallet(accountResultIsTransient
              ? 'Converge Mini could not reverify the Farcaster wallet after the app resumed. Reconnect it to continue safely.'
              : 'Your Farcaster wallet account changed while the app was away. Reconnect to open the matching XMTP inbox.')
            return false
          }

          if (wallet.kind === 'SCW') {
            let parsedChainId: bigint
            try {
              parsedChainId = parseEip1193ChainId(chainId)
            } catch {
              if (attempt < RESUME_WALLET_RETRY_DELAYS_MS.length - 1) continue
              invalidateWallet('The Farcaster wallet reported an invalid network after the app resumed. Reconnect to continue safely.')
              return false
            }
            if (parsedChainId !== wallet.chainId) {
              invalidateWallet('Your Farcaster wallet network changed while the app was away. Reconnect so XMTP can verify the active signer.')
              return false
            }
          }

          return true
        }

        return false
      }
      removeWalletListenerRef.current = () => {
        cancelProviderEventWalletRecheck()
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
        () => invalidateWallet(
          'XMTP stopped responding while synchronizing. Reconnect the inbox to restart it safely.',
        ),
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
      // Wallet approval can blur/focus the host while the initial client is
      // still opening. That belongs to setup, not to foreground recovery. A
      // genuinely hidden document still needs one refresh when it returns.
      if (
        document.visibilityState !== 'hidden' &&
        !confirmedBackgroundRef.current
      ) {
        foregroundRefreshNeededRef.current = false
      }
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
      if (connectionAttemptRef.current === attempt) {
        connectingRef.current = false
        const hasSession = sessionRef.current !== null
        const shouldRevalidateForeground = hasSession &&
          confirmedBackgroundRef.current &&
          document.visibilityState !== 'hidden'
        const shouldRecoverOnline = hasSession &&
          onlineRefreshPendingRef.current &&
          !browserIsKnownOffline()
        // Any visible blur/focus during setup was caused by the wallet or host
        // handoff that setup just completed. A confirmed visibility/BFCache
        // transition remains distinct and is revalidated once setup settles.
        if (document.visibilityState !== 'hidden') {
          foregroundRefreshNeededRef.current = shouldRevalidateForeground
          if (!shouldRevalidateForeground) confirmedBackgroundRef.current = false
        }
        if (shouldRevalidateForeground) {
          const resumeEpoch = backgroundEpochRef.current
          confirmedBackgroundRef.current = false
          onlineRefreshPendingRef.current = false
          window.setTimeout(() => {
            if (backgroundEpochRef.current === resumeEpoch) {
              foregroundRefreshCallbackRef.current()
            }
          }, 0)
        } else if (shouldRecoverOnline) {
          const resumeEpoch = backgroundEpochRef.current
          onlineRefreshPendingRef.current = false
          window.setTimeout(() => {
            if (backgroundEpochRef.current === resumeEpoch) {
              visibleRefreshCallbackRef.current()
            }
          }, 0)
        }
      }
    }
  }, [applyConvosAccessSnapshot, inboxTarget, releaseResources, startMessageStream, updateConvosAccessRequest, updateNotice])

  const connect = useCallback(() => connectWithWalletPrompt(), [connectWithWalletPrompt])

  const bindEnsInbox = useCallback(async (
    candidateAddress: `0x${string}`,
    options: InboxSwitchOptions = {},
  ): Promise<InboxBindingResult> => {
    const sourceSession = sessionRef.current
    const sourceWallet = walletRef.current
    if (!sourceSession || !sourceWallet || connection.phase !== 'ready') {
      throw new Error('Open the current XMTP inbox before binding an identity.')
    }
    if (candidateAddress.toLowerCase() === sourceSession.address.toLowerCase()) {
      throw new Error('That address already opens the current inbox.')
    }

    const generation = operationGenerationRef.current
    const targetInboxId = await sourceSession.findInboxId(candidateAddress)
    if (
      sessionRef.current !== sourceSession ||
      operationGenerationRef.current !== generation
    ) throw new Error('The current inbox changed during the safety check.')
    if (!targetInboxId) {
      throw new Error('That ENS address does not have an existing XMTP inbox to join.')
    }
    if (targetInboxId === sourceSession.inboxId) {
      throw new Error('That ENS address is already part of the current XMTP inbox.')
    }

    const { connectWalletConnectWallet } = await import(
      '../../lib/xmtp/walletConnect'
    )
    const targetWallet = await connectWalletConnectWallet(candidateAddress, {
      onDisplayUri: options.onPairingUri,
      prompt: true,
      signal: options.signal,
    })
    let committed = false
    let targetLease: XmtpLease | null = null
    let targetSession: XmtpMessagingSession | null = null
    try {
      if (
        sessionRef.current !== sourceSession ||
        operationGenerationRef.current !== generation
      ) throw new Error('The current inbox changed during the wallet check.')
      if (targetWallet.address.toLowerCase() !== candidateAddress.toLowerCase()) {
        throw new Error('The external wallet returned a different Ethereum account.')
      }
      if (options.signal?.aborted) {
        throw new DOMException('The identity binding was cancelled.', 'AbortError')
      }

      // Everything above is reversible. From this callback onward, the dialog
      // and host back handler must remain mounted until XMTP confirms or fails.
      options.onCommitting?.()
      if (options.signal?.aborted) {
        throw new DOMException('The identity binding was cancelled.', 'AbortError')
      }
      committed = true

      // The browser SDK permits only one OPFS-backed client in this document.
      // Close inbox A before opening B; successful completion intentionally ends
      // with one document reload so the normal Farcaster session opens B's DB.
      await releaseResources()

      const [{ acquireXmtpLease }, { XmtpMessagingSession }] = await Promise.all([
        import('../../lib/xmtp/lease'),
        import('../../lib/xmtp/session'),
      ])
      targetLease = await acquireXmtpLease()
      if (!targetLease) {
        throw new Error('XMTP storage is still closing. Reload before trying the binding again.')
      }
      targetSession = await XmtpMessagingSession.create(
        targetWallet.signer,
        targetWallet.address,
        targetInboxId,
      )
      await targetSession.bindIdentity(sourceWallet.signer, sourceWallet.address)

      return {
        address: targetWallet.address,
        chainId: sourceWallet.chainId.toString(10),
        inboxId: targetInboxId,
        walletKind: sourceWallet.kind,
      }
    } catch (error) {
      if (!committed) throw error
      if (
        error && typeof error === 'object' &&
        'name' in error && error.name === 'XmtpClientInitializationError' &&
        targetLease
      ) {
        poisonedLeaseRef.current = targetLease
        targetLease = null
      }
      if (
        error && typeof error === 'object' &&
        'name' in error && error.name === 'XmtpIdentityBindingVerificationError'
      ) {
        throw Object.assign(
          new Error('XMTP could not confirm whether the Farcaster identity binding completed. Reload Converge Mini and verify the inbox before trying again.'),
          { code: 'ens-binding-ambiguous' },
        )
      }
      throw Object.assign(
        new Error('The one-time binding stopped after the current XMTP client closed. Reload Converge Mini before retrying; the ENS owner wallet will not be used for routine sign-in.', { cause: error }),
        { code: 'ens-binding-failed' },
      )
    } finally {
      await targetSession?.close().catch(() => undefined)
      await targetLease?.release().catch(() => undefined)
      await import('../../lib/xmtp/walletConnect')
        .then(({ disconnectWalletConnect }) => disconnectWalletConnect())
        .catch(() => undefined)
    }
  }, [connection.phase, releaseResources])

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
        } else if (activeRef.current?.id === conversationId) {
          setStreamHealth(browserIsKnownOffline() ? 'offline' : 'failed')
          updateNotice(readableMessagingError(
            error,
            'This conversation could not sync. Its saved inbox entry remains open so you can retry.',
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
    const activeConversationIdAtStart = activeRef.current?.id ?? null
    const openRequestAtStart = openRequestRef.current
    let offline = browserIsKnownOffline()
    onlineRefreshPendingRef.current = false
    if (offline) setStreamHealth('offline')
    visibleRefreshRef.current = true
    try {
      await loadInbox(false)
      offline = browserIsKnownOffline()

      const conversation = activeRef.current
      if (
        conversation &&
        conversation.id === activeConversationIdAtStart &&
        openRequestRef.current === openRequestAtStart
      ) {
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
      const session = sessionRef.current
      if (
        document.visibilityState === 'hidden' ||
        !session ||
        connectingRef.current ||
        foregroundCheckRef.current !== null
      ) return

      const generation = operationGenerationRef.current
      const owner = Symbol('foreground-check')
      foregroundCheckRef.current = owner
      try {
        const validateWallet = validateWalletRef.current
        if (validateWallet && !(await validateWallet())) return
        if (
          operationGenerationRef.current !== generation ||
          sessionRef.current !== session
        ) return
        await refreshVisibleState()
      } finally {
        if (foregroundCheckRef.current === owner) {
          foregroundCheckRef.current = null
          if (
            foregroundEventPendingRef.current &&
            foregroundRefreshNeededRef.current &&
            !documentIsHidden() &&
            !connectingRef.current &&
            operationGenerationRef.current === generation &&
            sessionRef.current === session
          ) {
            const resumeEpoch = backgroundEpochRef.current
            foregroundEventPendingRef.current = false
            foregroundRefreshNeededRef.current = false
            window.setTimeout(() => {
              if (backgroundEpochRef.current === resumeEpoch) {
                void refreshForeground()
              }
            }, 0)
          }
        }
      }
    }
    const markConfirmedBackground = () => {
      confirmedBackgroundRef.current = true
      backgroundEpochRef.current += 1
      foregroundEventPendingRef.current = false
      foregroundRefreshNeededRef.current = true
    }
    const onForeground = () => {
      if (
        !foregroundRefreshNeededRef.current ||
        document.visibilityState === 'hidden' ||
        !sessionRef.current ||
        connectingRef.current
      ) return
      if (foregroundCheckRef.current !== null) {
        foregroundEventPendingRef.current = true
        return
      }
      foregroundRefreshNeededRef.current = false
      foregroundEventPendingRef.current = false
      confirmedBackgroundRef.current = false
      void refreshForeground()
    }
    const onOnline = () => {
      if (mountedRef.current && (sessionRef.current || connectingRef.current)) {
        onlineRefreshPendingRef.current = true
        if (sessionRef.current) setStreamHealth('retrying')
        if (
          visibleRefreshRef.current ||
          connectingRef.current ||
          foregroundCheckRef.current !== null
        ) return
      }
      void refreshForeground()
    }
    const onOffline = () => {
      if (mountedRef.current && sessionRef.current) setStreamHealth('offline')
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markConfirmedBackground()
      else onForeground()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) markConfirmedBackground()
      if (!sessionRef.current) return
      onForeground()
    }
    foregroundRefreshCallbackRef.current = onForeground
    visibleRefreshCallbackRef.current = () => void refreshVisibleState()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onForeground)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pagehide', markConfirmedBackground)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onForeground)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('pagehide', markConfirmedBackground)
      window.removeEventListener('pageshow', onPageShow)
      if (foregroundRefreshCallbackRef.current === onForeground) {
        foregroundRefreshCallbackRef.current = () => undefined
      }
      visibleRefreshCallbackRef.current = () => undefined
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
    disableAlerts,
    disconnect,
    environment,
    loadingConversation,
    loadingOlder,
    hasOlderMessages,
    inspectIdentityRelationship,
    bindEnsInbox,
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
    syncAlerts,
    view,
    walletKind,
  }
}

function browserIsKnownOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function documentIsHidden(): boolean {
  return document.visibilityState === 'hidden'
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

function waitForWalletResume(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

async function withWalletResumeTimeout<T>(request: Promise<T>): Promise<T> {
  let timeoutId: number | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('The Farcaster wallet did not respond in time.'))
    }, RESUME_WALLET_REQUEST_TIMEOUT_MS)
  })

  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}

function assertPersistedWalletMetadata(
  target: InboxTarget,
  wallet: WalletConnection,
): void {
  if (
    wallet.kind !== target.walletKind ||
    (wallet.kind === 'SCW' && wallet.chainId.toString(10) !== target.chainId)
  ) {
    throw Object.assign(
      new Error('The Farcaster wallet signer no longer matches the saved binding.'),
      { code: 'host-wallet-metadata-mismatch' },
    )
  }
}

function inboxTargetFailure(
  error: unknown,
):
  | 'target-mismatch'
  | 'target-source-mismatch'
  | 'target-unavailable'
  | null {
  if (!error || typeof error !== 'object') return null
  if ('code' in error && error.code === 'host-wallet-metadata-mismatch') {
    return 'target-source-mismatch'
  }
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
  failure:
    | 'target-mismatch'
    | 'target-source-mismatch'
    | 'target-unavailable',
): string {
  if (failure === 'target-unavailable') {
    return 'Farcaster does not expose the wallet identity saved for this inbox.'
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
