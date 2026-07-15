import { useEffect, useState } from 'react'

type MiniAppSdk = (typeof import('@farcaster/miniapp-sdk'))['sdk']
type MiniAppContext = Awaited<MiniAppSdk['context']>
type MiniAppHostCapability = Awaited<ReturnType<MiniAppSdk['getCapabilities']>>[number]

export type MiniAppHostState = {
  capabilities: readonly MiniAppHostCapability[]
  context: MiniAppContext | null
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

        const [context, capabilities] = await Promise.all([
          contextPromise,
          sdk.getCapabilities(),
        ])

        if (!cancelled) {
          setState({
            capabilities: [...capabilities],
            context,
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

function readableHostError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Close this view and open Converge Mini again from Farcaster.'
}
