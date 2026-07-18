import { useEffect, useState } from 'react'

type MiniAppSdk = (typeof import('@farcaster/miniapp-sdk'))['sdk']
type MiniAppContext = Awaited<MiniAppSdk['context']>
type MiniAppHostCapability = Awaited<ReturnType<MiniAppSdk['getCapabilities']>>[number]

type MiniAppHostContext = {
  client: Pick<MiniAppContext['client'], 'added' | 'platformType' | 'safeAreaInsets'> & {
    notificationsEnabled: boolean
  }
  user: Pick<MiniAppContext['user'], 'displayName' | 'fid' | 'pfpUrl' | 'username'>
}

export type MiniAppHostState = {
  capabilities: readonly MiniAppHostCapability[]
  context: MiniAppHostContext | null
  error: string | null
  status: 'detecting' | 'embedded' | 'standalone' | 'error'
}

const initialState: MiniAppHostState = {
  capabilities: [],
  context: null,
  error: null,
  status: 'detecting',
}

export function useMiniAppHost(): MiniAppHostState {
  const [state, setState] = useState<MiniAppHostState>(initialState)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const { sdk } = await import('@farcaster/miniapp-sdk')
        const embedded = await sdk.isInMiniApp()
        if (cancelled) return

        if (!embedded) {
          setState({ ...initialState, status: 'standalone' })
          return
        }

        const contextPromise = sdk.context
        await sdk.actions.ready()

        const [rawContext, capabilities] = await Promise.all([
          contextPromise,
          sdk.getCapabilities(),
        ])

        if (!cancelled) {
          setState({
            capabilities: [...capabilities],
            context: sanitizeContext(rawContext),
            error: null,
            status: 'embedded',
          })
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            ...initialState,
            error: readableHostError(error),
            status: 'error',
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}

function sanitizeContext(context: MiniAppContext): MiniAppHostContext {
  return {
    client: {
      added: context.client.added,
      notificationsEnabled: Boolean(context.client.notificationDetails),
      ...(context.client.platformType === undefined
        ? {}
        : { platformType: context.client.platformType }),
      ...(context.client.safeAreaInsets === undefined
        ? {}
        : { safeAreaInsets: { ...context.client.safeAreaInsets } }),
    },
    user: {
      fid: context.user.fid,
      ...(context.user.displayName === undefined
        ? {}
        : { displayName: context.user.displayName }),
      ...(context.user.pfpUrl === undefined ? {} : { pfpUrl: context.user.pfpUrl }),
      ...(context.user.username === undefined
        ? {}
        : { username: context.user.username }),
    },
  }
}

function readableHostError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Close this view and open Converge Mini again from Farcaster.'
}
