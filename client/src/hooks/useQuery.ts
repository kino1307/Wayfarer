import { useState, useCallback, useRef } from 'react'
import { fetchTitles, fetchWikiArticle, streamLocations, fetchAnalysis } from '../api'
import type { Location, QueryResult, StatusState } from '../types'

// Session-level cache: repeated queries return instantly without re-fetching
const queryCache = new Map<string, QueryResult>()

export function useQuery(apiKey: string, model: string, onSearch: (q: string) => void) {
  const [result, setResult] = useState<QueryResult | null>(null)
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null)
  const [insight, setInsight] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusState>({ phase: 'idle', message: '' })
  const [analysingPattern, setAnalysingPattern] = useState(false)
  const lastQueryRef = useRef('')
  const streamCountRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus({ phase: 'idle', message: '' })
  }, [])

  const runQuery = useCallback(
    async (query: string) => {
      if (!apiKey) {
        setStatus({ phase: 'error', message: 'Enter your Anthropic API key first' })
        return
      }

      // Cancel any in-flight query
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const { signal } = controller

      lastQueryRef.current = query
      streamCountRef.current = 0
      setResult(null)
      setSelectedLocation(null)
      setInsight(null)

      // Cache hit — return immediately
      const cacheKey = `${query.trim().toLowerCase()}::${model}`
      const cached = queryCache.get(cacheKey)
      if (cached) {
        setResult(cached)
        streamCountRef.current = cached.locations.length
        const modeLabel = cached.mode === 'grounded' ? 'Wikipedia' : 'Model knowledge'
        setStatus({ phase: 'done', message: `${cached.locations.length} pins · ${modeLabel} · Cached` })
        onSearch(query)
        return
      }

      const memoryDone = { current: false }

      try {
        const titlesPromise = fetchTitles(query, model, apiKey, signal)

        const wikiPromise = titlesPromise
          .then(titles =>
            titles.length > 0
              ? fetchWikiArticle(titles, (msg) => {
                  if (memoryDone.current) setStatus({ phase: 'wiki', message: msg })
                }, signal)
              : null
          )
          .catch(() => null)

        setStatus({ phase: 'locations', message: 'Generating from model knowledge…' })
        setResult({ locations: [], mode: 'memory', dropped: 0 })

        await streamLocations(
          query, model, apiKey, undefined,
          (loc) => {
            streamCountRef.current += 1
            const count = streamCountRef.current
            setResult(prev => ({
              locations: [...(prev?.locations ?? []), loc],
              mode: 'memory',
              dropped: 0,
            }))
            setStatus({ phase: 'locations', message: `${count} preliminary pin${count === 1 ? '' : 's'}…` })
          },
          (_meta) => { memoryDone.current = true },
          (msg) => setStatus({ phase: 'error', message: msg }),
          signal,
        )

        if (signal.aborted) return
        memoryDone.current = true

        const wikiArticle = await wikiPromise
        if (signal.aborted) return

        if (wikiArticle) {
          setStatus({ phase: 'wiki', message: `Enhancing with "${wikiArticle.title}"…` })

          const touchedNames = new Set<string>()

          await streamLocations(
            query, model, apiKey, wikiArticle,
            (loc) => {
              const key = loc.name.toLowerCase()
              touchedNames.add(key)
              setResult(prev => {
                if (!prev) return prev
                const locations = [...prev.locations]
                const idx = locations.findIndex(l => l.name.toLowerCase() === key)
                if (idx >= 0) {
                  locations[idx] = { ...locations[idx], ...loc }
                } else {
                  streamCountRef.current += 1
                  locations.push(loc)
                }
                return { ...prev, locations }
              })
            },
            (meta) => {
              if (signal.aborted) return
              // Compute final result outside the updater so we can also cache it.
              // Updaters must be pure — StrictMode calls them twice.
              let cached: QueryResult | null = null
              setResult(prev => {
                if (!prev) return prev
                const locations = touchedNames.size > 0
                  ? prev.locations.filter(l => touchedNames.has(l.name.toLowerCase()))
                  : prev.locations
                cached = {
                  locations,
                  mode: touchedNames.size > 0 ? meta.mode : 'memory',
                  dropped: meta.dropped,
                  wikiSource: touchedNames.size > 0 ? meta.wikiSource : undefined,
                }
                return cached
              })
              if (cached) {
                queryCache.set(cacheKey, cached)
                streamCountRef.current = (cached as QueryResult).locations.length
              }
              const count = streamCountRef.current
              const modeLabel = touchedNames.size > 0 ? 'Wikipedia' : 'Model knowledge'
              const droppedText = meta.dropped > 0 ? ` · ${meta.dropped} dropped` : ''
              setStatus({ phase: 'done', message: `${count} verified pins · ${modeLabel}${droppedText}` })
              onSearch(query)
            },
            (msg) => setStatus({ phase: 'error', message: msg }),
            signal,
          )
        } else {
          if (signal.aborted) return
          const count = streamCountRef.current
          setResult(prev => {
            if (prev) queryCache.set(cacheKey, prev)
            return prev
          })
          setStatus({ phase: 'done', message: `${count} pins · Model knowledge` })
          onSearch(query)
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        const msg = err instanceof Error ? err.message : 'Something went wrong'
        setStatus({ phase: 'error', message: msg })
      }
    },
    [apiKey, model, onSearch]
  )

  const analysePattern = useCallback(async () => {
    if (!result || result.locations.length === 0 || !apiKey) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setAnalysingPattern(true)
    setStatus({ phase: 'analysing', message: 'Analysing geographic pattern…' })

    try {
      const text = await fetchAnalysis(lastQueryRef.current, result.locations, model, apiKey, controller.signal)
      setInsight(text)
      const count = result.locations.length
      setStatus({ phase: 'done', message: `${count} pins · Pattern analysed` })
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setStatus({ phase: 'error', message: 'Pattern analysis failed' })
      }
    } finally {
      setAnalysingPattern(false)
    }
  }, [result, model, apiKey])

  return {
    result,
    selectedLocation,
    setSelectedLocation,
    insight,
    setInsight,
    status,
    analysingPattern,
    runQuery,
    analysePattern,
    cancel,
  }
}
