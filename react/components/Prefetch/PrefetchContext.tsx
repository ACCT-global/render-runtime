import React, {
  useContext,
  createContext,
  FC,
  useEffect,
  useCallback,
  useRef,
  MutableRefObject,
} from 'react'
import LRUCache from './LRUCache'
import PQueue from './PQueue'
import { History, UnregisterCallback } from 'history'
import { isEnabled } from '../../utils/flags'
import { useRuntime } from '../../core/main'

const disposeFn = (key: string) => delete state.pathsState[key]

interface PathState {
  fetching: boolean
  page?: string | null
}

interface RoutePromise {
  promisePending: boolean
  promise: Promise<PrefetchRouteData> | null
}

interface PrefetchCacheObject {
  routeId: string
  matchingPage: RenderRuntime['route']
  contentResponse: ContentResponse | null
}

export interface PrefetchState {
  routesCache: LRUCache<PrefetchRouteData>
  pathsCache: {
    other: LRUCache<PrefetchCacheObject>
    product: LRUCache<PrefetchCacheObject>
    search: LRUCache<PrefetchCacheObject>
  }
  pathsState: Record<string, PathState>
  routePromise: Record<string, RoutePromise | null>
  queue: PQueue
}

const HALF_HOUR_MS = 1000 * 60 * 30

const state: PrefetchState = {
  routesCache: new LRUCache({ max: 100, maxAge: HALF_HOUR_MS }),
  pathsCache: {
    product: new LRUCache({ max: 100, disposeFn, maxAge: HALF_HOUR_MS }),
    search: new LRUCache({ max: 75, disposeFn, maxAge: HALF_HOUR_MS }),
    other: new LRUCache({ max: 75, disposeFn, maxAge: HALF_HOUR_MS }),
  },
  pathsState: {},
  routePromise: {},
  queue: new PQueue(),
}

const PrefetchContext = createContext<PrefetchState>(state)

export const getCacheForPage = (page: string) => {
  if (page === 'store.product') {
    return state.pathsCache.product
  }

  if (page.startsWith('store.search')) {
    return state.pathsCache.search
  }

  return state.pathsCache.other
}

export const usePrefetch = () => useContext(PrefetchContext)

const getTimeout = (isMobile: boolean) => 3500 * (isMobile ? 2 : 1)

export const PrefetchContextProvider: FC<{ history: History | null }> = ({
  children,
  history,
}) => {
  const { hints } = useRuntime()
  const unlistenRef = useRef<UnregisterCallback>(null) as MutableRefObject<
    UnregisterCallback
  >

  const onPageChanged = useCallback(() => {
    state.queue.pause()
    state.queue.clear()
    setTimeout(() => {
      if (isEnabled('PREFETCH')) {
        state.queue.start()
      }
    }, 1000)
  }, [])

  useEffect(() => {
    if (history) {
      unlistenRef.current = history.listen(onPageChanged)
    }
    window.addEventListener(
      'load',
      () => {
        if (isEnabled('PREFETCH')) {
          setTimeout(() => {
            state.queue.start()
          }, getTimeout(hints.mobile))
        }
      },
      { once: true }
    )
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current()
      }
    }
  }, [hints.mobile, history, onPageChanged, unlistenRef])

  return (
    <PrefetchContext.Provider value={state}>
      {children}
    </PrefetchContext.Provider>
  )
}

export const getPrefetechedData = (path: string) => {
  const destinationRouteId = state.pathsState[path]?.page
  if (!destinationRouteId) {
    return {
      routeData: null,
      prefetchedPathData: null,
      destinationRouteId: null,
    }
  }
  let prefetchedPathData = null
  const cache = getCacheForPage(destinationRouteId)
  prefetchedPathData = cache.get(path)

  const routeData = prefetchedPathData
    ? state.routesCache.get(destinationRouteId)
    : null
  return { routeData, prefetchedPathData, destinationRouteId }
}

export const clearQueue = () => {
  state.queue.clear()
}
