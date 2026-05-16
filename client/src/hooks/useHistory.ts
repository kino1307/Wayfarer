import { useState, useCallback, useRef } from 'react'
import { fetchChips } from '../api'

const DEFAULT_CHIPS = [
  'WWI Western Front battlefields',
  'Ancient Roman aqueducts',
  'Birthplaces of Olympic gold medallists',
  'Medieval plague outbreaks in Europe',
  'UNESCO World Heritage Sites in Asia',
  'Active volcanoes in the Pacific Ring of Fire',
]

export function useHistory(model: string, apiKey: string) {
  const [history, setHistory] = useState<string[]>([])
  const historyRef = useRef<string[]>([])
  const [chips, setChips] = useState<string[]>(DEFAULT_CHIPS)
  const [chipsLoading, setChipsLoading] = useState(false)
  const chipsAbortRef = useRef<AbortController | null>(null)

  const addToHistory = useCallback(
    async (query: string) => {
      const updated = [...historyRef.current, query].slice(-10)
      historyRef.current = updated
      setHistory(updated)

      if (!apiKey) return
      chipsAbortRef.current?.abort()
      const controller = new AbortController()
      chipsAbortRef.current = controller

      setChipsLoading(true)
      try {
        const suggestions = await fetchChips(updated, model, apiKey, false, controller.signal)
        if (suggestions.length > 0) setChips(suggestions)
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          // keep existing chips on error
        }
      } finally {
        setChipsLoading(false)
      }
    },
    [model, apiKey]
  )

  const refreshChips = useCallback(async () => {
    if (!apiKey) return
    chipsAbortRef.current?.abort()
    const controller = new AbortController()
    chipsAbortRef.current = controller

    setChipsLoading(true)
    try {
      const suggestions = await fetchChips(historyRef.current, model, apiKey, true, controller.signal)
      if (suggestions.length > 0) setChips(suggestions)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        // keep existing chips on error
      }
    } finally {
      setChipsLoading(false)
    }
  }, [model, apiKey])

  return { history, chips, chipsLoading, addToHistory, refreshChips }
}
