import type { Location } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  }
}

export async function fetchTitles(
  query: string,
  model: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await fetch(`${BASE}/api/titles`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ query, model }),
    signal,
  })
  if (!res.ok) throw new Error('Failed to fetch titles')
  const data = await res.json() as { titles: string[] }
  return data.titles
}

export async function fetchWikiArticle(
  titles: string[],
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<{ title: string; text: string } | null> {
  const encoded = titles.map(t => encodeURIComponent(t)).join('|')
  const res = await fetch(`${BASE}/api/wikipedia/fetch?titles=${encoded}`, { signal })
  if (!res.ok || !res.body) return null

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6)) as {
          type: string
          message?: string
          data?: { title: string; text: string } | null
        }
        if (event.type === 'progress' && event.message) {
          onProgress?.(event.message)
        } else if (event.type === 'result') {
          reader.cancel().catch(() => {})
          return event.data ?? null
        }
      } catch {
        // malformed line — skip
      }
    }
  }
  return null
}

export interface StreamDoneMeta {
  mode: 'grounded' | 'memory'
  dropped: number
  wikiSource?: string
}

// Stream locations from /api/query via SSE, calling callbacks as events arrive
export async function streamLocations(
  query: string,
  model: string,
  apiKey: string,
  wikiContext: { title: string; text: string } | undefined,
  onLocation: (loc: Location) => void,
  onDone: (meta: StreamDoneMeta) => void,
  onError: (msg: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)
  // Also abort if caller cancels — store handler so we can remove it in finally
  const abortHandler = () => controller.abort()
  signal?.addEventListener('abort', abortHandler)

  const res = await fetch(`${BASE}/api/query`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ query, model, wikiContext }),
    signal: controller.signal,
  })

  if (!res.ok || !res.body) {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortHandler)
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
    throw new Error(err.error ?? 'Failed to stream locations')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6)) as {
            type: string
            data?: Location
            mode?: 'grounded' | 'memory'
            dropped?: number
            wikiSource?: string | null
            message?: string
          }
          if (event.type === 'location' && event.data) {
            onLocation(event.data)
          } else if (event.type === 'done') {
            onDone({
              mode: event.mode ?? 'memory',
              dropped: event.dropped ?? 0,
              wikiSource: event.wikiSource ?? undefined,
            })
          } else if (event.type === 'error') {
            onError(event.message ?? 'Unknown error')
          }
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortHandler)
    reader.cancel().catch(() => {})
  }
}

export async function fetchAnalysis(
  query: string,
  locations: Location[],
  model: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${BASE}/api/analyse`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ query, locations, model }),
    signal,
  })
  if (!res.ok) throw new Error('Failed to fetch analysis')
  const data = await res.json() as { insight: string }
  return data.insight
}

export async function fetchChips(
  history: string[],
  model: string,
  apiKey: string,
  random = false,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await fetch(`${BASE}/api/chips`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ history, model, random }),
    signal,
  })
  if (!res.ok) return []
  const data = await res.json() as { suggestions: string[] }
  return data.suggestions ?? []
}
