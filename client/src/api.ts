import type { Location, StructuredResult } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  }
}

// Structured path (PID): query → Wikidata nodes + unresolved report.
export async function fetchStructured(
  query: string,
  model: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<StructuredResult> {
  const res = await fetch(`${BASE}/api/structured`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ query, model }),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Structured query failed' })) as { error: string }
    throw new Error(err.error ?? 'Structured query failed')
  }
  return await res.json() as StructuredResult
}

// Streaming variant: reads NDJSON progress events, calls onProgress for each, resolves with
// the final result. Same StructuredResult shape as fetchStructured.
export async function fetchStructuredStream(
  query: string,
  model: string,
  apiKey: string,
  onProgress: (message: string) => void,
  signal?: AbortSignal,
): Promise<StructuredResult> {
  const res = await fetch(`${BASE}/api/structured/stream`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ query, model }),
    signal,
  })
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({ error: 'Structured query failed' }))) as { error: string }
    throw new Error(err.error ?? 'Structured query failed')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let result: StructuredResult | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const evt = JSON.parse(line) as
        | { type: 'progress'; message: string }
        | { type: 'result'; nodes: StructuredResult['nodes']; unresolved: StructuredResult['unresolved']; meta: StructuredResult['meta'] }
        | { type: 'error'; error: string }
      if (evt.type === 'progress') onProgress(evt.message)
      else if (evt.type === 'error') throw new Error(evt.error)
      else if (evt.type === 'result') result = { nodes: evt.nodes, unresolved: evt.unresolved, meta: evt.meta }
    }
  }
  if (!result) throw new Error('Stream ended without a result')
  return result
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
