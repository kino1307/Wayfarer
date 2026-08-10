import { useState, useCallback, useRef } from 'react'
import { fetchAnalysis, fetchStructuredStream } from '../api'
import { nodeToLocation } from '../types'
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
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus({ phase: 'idle', message: '' })
  }, [])

  function doneMessage(res: QueryResult, suffix = ''): string {
    const n = res.locations.length
    const unresolved = res.unresolved?.length ?? 0
    const unresolvedText = unresolved ? ` · ${unresolved} unresolved` : ''
    const source = res.enumerator === 'asserted' ? 'Model-suggested' : 'Wikidata'
    return `${n} node${n === 1 ? '' : 's'} · ${source}${unresolvedText}${suffix}`
  }

  // The single query path (PID): query → Wikidata nodes. One request, enumerate+locate.
  const runStructured = useCallback(
    async (query: string) => {
      if (!apiKey) {
        setStatus({ phase: 'error', message: 'Enter your API key first' })
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const { signal } = controller

      lastQueryRef.current = query
      setResult(null)
      setSelectedLocation(null)
      setInsight(null)

      const cacheKey = `${query.trim().toLowerCase()}::${model}`
      const cached = queryCache.get(cacheKey)
      if (cached) {
        setResult(cached)
        setStatus({ phase: 'done', message: doneMessage(cached, ' · Cached') })
        onSearch(query)
        return
      }

      setStatus({ phase: 'locations', message: 'Planning the query…' })

      try {
        const sr = await fetchStructuredStream(query, model, apiKey, msg => {
          if (!signal.aborted) setStatus({ phase: 'locations', message: msg })
        }, signal)
        if (signal.aborted) return

        // A WDQS error is only a HARD failure when it left us with nothing. If the structured query
        // failed (e.g. a 45s timeout on a vague query) but the asserted fallback still produced
        // model-suggested places, show those — degraded, not failed (the sidebar already flags them
        // as "Model-suggested"). Surfacing the raw 408 here used to discard a perfectly usable result.
        if (sr.meta.error && sr.nodes.length === 0) {
          setStatus({ phase: 'error', message: sr.meta.error })
          return
        }

        const res: QueryResult = {
          locations: sr.nodes.map(nodeToLocation),
          unresolved: sr.unresolved,
          nodes: sr.nodes,
          enumerator: sr.meta.enumerator,
          verification: sr.meta.verification ?? null,
          repaired: sr.meta.repaired ?? false,
        }
        setResult(res)
        // Don't cache a degraded (WDQS-errored) result client-side either — let a retry try the
        // structured path again once WDQS is healthy.
        if (!sr.meta.error) queryCache.set(cacheKey, res)
        setStatus({ phase: 'done', message: doneMessage(res) })
        onSearch(query)
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        const msg = err instanceof Error ? err.message : 'Something went wrong'
        setStatus({ phase: 'error', message: msg })
      }
    },
    [apiKey, model, onSearch],
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
      setStatus({ phase: 'done', message: `${count} nodes · Pattern analysed` })
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
    runStructured,
    analysePattern,
    cancel,
  }
}
