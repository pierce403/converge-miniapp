import { useCallback, useEffect, useRef, useState } from 'react'

import type { HostWalletConnection } from '../../lib/xmtp/signer'
import type { XmtpLease } from '../../lib/xmtp/lease'
import type { XmtpMessagingSession } from '../../lib/xmtp/session'
import type {
  ActiveConversation,
  ConversationSummary,
  MessageItem,
  StreamHealth,
} from './types'

export type ConnectionPhase =
  | 'idle'
  | 'locking'
  | 'wallet'
  | 'xmtp'
  | 'history'
  | 'syncing'
  | 'ready'
  | 'locked'
  | 'restart-required'
  | 'error'

export type MessagingView = 'inbox' | 'new-dm' | 'conversation'

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

export function useXmtpMessaging() {
  const mountedRef = useRef(true)
  const connectionAttemptRef = useRef(0)
  const cleanupPromiseRef = useRef<Promise<void> | null>(null)
  const connectingRef = useRef(false)
  const creatingDmRef = useRef(false)
  const refreshingRef = useRef(false)
  const visibleRefreshRef = useRef(false)
  const loadingOlderRequestRef = useRef<number | null>(null)
  const sendingRef = useRef(false)
  const retryingMessageIdsRef = useRef(new Set<string>())
  const sessionRef = useRef<XmtpMessagingSession | null>(null)
  const pendingSessionFactoryRef = useRef<PendingSessionFactory | null>(null)
  const leaseRef = useRef<XmtpLease | null>(null)
  const walletRef = useRef<HostWalletConnection | null>(null)
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
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversation, setActiveConversation] = useState<ActiveConversation | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [view, setView] = useState<MessagingView>('inbox')
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [streamHealth, setStreamHealth] = useState<StreamHealth>('live')
  const [notice, setNotice] = useState<string | null>(null)

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
    loadingOlderRequestRef.current = null
    creatingDmRef.current = false
    sendingRef.current = false
    retryingMessageIdsRef.current.clear()

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
        } catch {
          // A failed factory either self-closed after registration or requires
          // the document restart state handled by the connect attempt.
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
      const next = await session.loadInbox()
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation &&
        inboxRequestRef.current === request &&
        sessionRef.current === session
      ) {
        setConversations(next)
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
  }, [updateNotice])

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
        ) setConversations(next)
      }).catch(() => {
        // The next explicit foreground/manual sync will surface the failure.
      })
    }, 300)
  }, [])

  const startMessageStream = useCallback(async (session: XmtpMessagingSession) => {
    await session.startMessageStream(
      (message) => {
        if (sessionRef.current !== session) return
        if (activeRef.current?.id === message.conversationId) upsertMessage(message)
        scheduleInboxRefresh()
      },
      (health) => {
        if (mountedRef.current && sessionRef.current === session) {
          setStreamHealth(health)
        }
      },
    )
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
    setConversations([])
    setActiveConversation(null)
    setMessages([])
    setView('inbox')
    setLoadingConversation(false)
    setLoadingOlder(false)
    setHasOlderMessages(false)
    setRefreshing(false)
    setSending(false)
    setStreamHealth('live')
    updateNotice(null)
  }, [releaseResources, updateNotice])

  const connect = useCallback(async () => {
    if (connectingRef.current || sessionRef.current) return
    const attempt = ++connectionAttemptRef.current
    const isCurrent = () => mountedRef.current && connectionAttemptRef.current === attempt

    connectingRef.current = true
    let clientCreationFailed = false
    setConnection({ error: null, phase: 'locking' })
    updateNotice(null)

    try {
      const cleanup = cleanupPromiseRef.current
      if (cleanup) await cleanup
      if (!isCurrent()) return

      const [
        { acquireXmtpLease },
        { connectHostWallet },
        { XmtpClientInitializationError, XmtpMessagingSession },
      ] =
        await Promise.all([
          import('../../lib/xmtp/lease'),
          import('../../lib/xmtp/signer'),
          import('../../lib/xmtp/session'),
        ])
      if (!isCurrent()) return

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
      const wallet = await connectHostWallet()
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
        if (walletInvalidated) return
        walletInvalidated = true
        activeRef.current = null
        setConnection({ error: message, phase: 'error' })
        setAddress(null)
        setWalletKind(null)
        setEnvironment('')
        setConversations([])
        setActiveConversation(null)
        setMessages([])
        setHasOlderMessages(false)
        setLoadingOlder(false)
        setView('inbox')
        updateNotice(null)
        void releaseResources()
      }
      const onAccountsChanged = (accounts: readonly string[]) => {
        const next = accounts[0]?.toLowerCase()
        if (!next || next !== wallet.address.toLowerCase()) {
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
      removeWalletListenerRef.current = () => {
        provider.removeListener('accountsChanged', onAccountsChanged)
        provider.removeListener('chainChanged', onChainChanged)
        provider.removeListener('disconnect', onDisconnect)
      }

      void navigator.storage?.persist?.().catch(() => false)

      setConnection({ error: null, phase: 'xmtp' })
      let session: XmtpMessagingSession
      const sessionPromise = XmtpMessagingSession.create(wallet.signer, wallet.address)
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
      if (session.isNewInstallation) {
        setConnection({ error: null, phase: 'history' })
        try {
          await session.requestHistorySync()
        } catch (error) {
          recoveryNotice = readableMessagingError(
            error,
            'Older-history recovery could not be requested. The local inbox can still open.',
          )
        }
      }
      if (!mountedRef.current || sessionRef.current !== session) return

      setConnection({ error: null, phase: 'syncing' })
      const finalNoticeRevision = noticeRevisionRef.current
      const inboxRequest = ++inboxRequestRef.current
      refreshingRef.current = true
      let cachedInboxRead = false
      try {
        const nextConversations = await session.loadInbox((cached) => {
          if (
            !mountedRef.current ||
            sessionRef.current !== session ||
            inboxRequestRef.current !== inboxRequest
          ) return
          cachedInboxRead = true
          setConversations(cached)
          if (cached.length) {
            setRefreshing(true)
            setConnection({ error: null, phase: 'ready' })
          }
        })
        if (
          !mountedRef.current ||
          sessionRef.current !== session ||
          inboxRequestRef.current !== inboxRequest
        ) return
        setConversations(nextConversations)
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

      if (mountedRef.current && sessionRef.current === session) {
        setConnection({ error: null, phase: 'ready' })
        if (noticeRevisionRef.current === finalNoticeRevision) {
          setNotice(recoveryNotice)
        }
      }
    } catch (error) {
      const shouldReport = isCurrent()
      if (clientCreationFailed) {
        removeWalletListenerRef.current?.()
        removeWalletListenerRef.current = null
        walletRef.current = null
        if (shouldReport && mountedRef.current) {
          setConnection({
            error: readableMessagingError(
              error,
              'XMTP setup stopped before the client could be closed safely.',
            ),
            phase: 'restart-required',
          })
        }
        return
      }

      await releaseResources()
      if (shouldReport && mountedRef.current) {
        setConnection({
          error: readableMessagingError(error, 'XMTP could not open this inbox.'),
          phase: 'error',
        })
      }
    } finally {
      if (connectionAttemptRef.current === attempt) connectingRef.current = false
    }
  }, [releaseResources, startMessageStream, updateNotice])

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
    const initial = seed ?? (summary
      ? {
          id: summary.id,
          peerAddress: summary.peerAddress,
          peerInboxId: summary.peerInboxId,
        }
      : null)

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
      const loaded = await session.loadConversation(conversationId, (cached) => {
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
          cached.messages.length,
        )
        setHasOlderMessages(cached.hasOlder)
      })
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
        loaded.messages.length,
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
          page.messages.length,
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
    if (creatingDmRef.current) return
    if (recipient.toLowerCase() === session.address.toLowerCase()) {
      throw new Error('That is the wallet already connected to this inbox.')
    }

    const generation = operationGenerationRef.current
    creatingDmRef.current = true
    try {
      const conversation = await session.createDm(recipient)
      if (
        operationGenerationRef.current !== generation ||
        sessionRef.current !== session
      ) return
      void loadInbox(false)
      await openConversation(conversation.id, conversation)
    } finally {
      if (operationGenerationRef.current === generation) {
        creatingDmRef.current = false
      }
    }
  }, [loadInbox, openConversation])

  const sendMessage = useCallback(async (text: string) => {
    const session = sessionRef.current
    const conversation = activeRef.current
    if (!session || !conversation || sendingRef.current) return

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
        updateNotice(readableMessagingError(error, 'XMTP could not send that message.'))
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
        updateNotice(readableMessagingError(error, 'XMTP could not retry that message.'))
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

  const refreshVisibleState = useCallback(async () => {
    const session = sessionRef.current
    if (!session || visibleRefreshRef.current) return

    const generation = operationGenerationRef.current
    visibleRefreshRef.current = true
    try {
      await loadInbox(false)

      const conversation = activeRef.current
      if (conversation) {
        try {
          const loaded = await session.loadConversation(
            conversation.id,
            undefined,
            loadedMessageWindowRef.current,
          )
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
              loaded.messages.length,
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
      }
    }
  }, [loadInbox, startMessageStream, updateNotice])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && sessionRef.current) {
        void refreshVisibleState()
      }
    }
    const onOnline = () => void refreshVisibleState()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [refreshVisibleState])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void releaseResources()
    }
  }, [releaseResources])

  return {
    activeConversation,
    address,
    backToInbox,
    connect,
    connection,
    conversations,
    createDm,
    disconnect,
    environment,
    loadingConversation,
    loadingOlder,
    hasOlderMessages,
    loadOlderMessages,
    messages,
    notice,
    openConversation,
    refresh: () => loadInbox(true),
    retryLiveUpdates: refreshVisibleState,
    refreshing,
    retryMessage,
    sendMessage,
    sending,
    setNotice: updateNotice,
    setView,
    streamHealth,
    view,
    walletKind,
  }
}

function readableMessagingError(error: unknown, fallback: string): string {
  if (isRejectedRequest(error)) {
    return 'The wallet request was cancelled. Nothing was sent or changed.'
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function isRejectedRequest(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 4001
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

function preservePeerAddress(
  next: ActiveConversation,
  current: ActiveConversation | null,
): ActiveConversation {
  if (next.peerAddress || current?.id !== next.id || !current.peerAddress) return next
  return { ...next, peerAddress: current.peerAddress }
}
