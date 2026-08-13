// Wikidata Query Service (WDQS) transport.
// This is the structured enumerator+locator: a single SPARQL query returns the
// answer entities AND their coordinates together (PID R2/R3/R4, structured path).
// We never parse article text here — Wikidata executes the query and returns rows.

const WDQS = 'https://query.wikidata.org/sparql'

// WDQS requires a descriptive User-Agent or it returns 403.
const USER_AGENT = 'Wayfarer/0.1 (geographic query tool; structured node mapper)'

export type SparqlValue = { type: string; value: string; 'xml:lang'?: string }
export type SparqlBinding = Record<string, SparqlValue | undefined>

export class SparqlError extends Error {
  constructor(public status: number, public detail: string) {
    super(`WDQS ${status}: ${detail}`)
    this.name = 'SparqlError'
  }
}

// WDQS's own server-side timeout is ~60s. A single runaway query (an unbounded P131*/P279*
// chain) therefore blocks for a full minute before erroring — and the schema-discovery builder
// fires several test queries per request, so a few timeouts = multiple minutes of wall time.
// We cap each call CLIENT-SIDE with an AbortController so a slow query fails FAST and the agent
// can move on (PID: latency budget). Exploratory builder tests get a tight cap; the real answer
// query gets a generous one.
const DEFAULT_TIMEOUT_MS = 45_000

// WDQS rate-limits by IP (429) and is briefly unavailable under load (503). A single transient
// 429 should NOT hard-fail the user's query — back off and retry within the time budget, honouring
// the Retry-After header when WDQS sends one. PID R6: loud failure only after we've genuinely given up.
const RETRYABLE_STATUS = new Set([429, 503])
const MAX_ATTEMPTS = 6

// Abortable sleep: resolves after ms, or rejects if the controller fires (timeout/cancel).
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) }, { once: true })
  })
}

export interface SparqlOpts {
  signal?: AbortSignal
  timeoutMs?: number
}

// Good-citizen rate limiting. One user request fires a BURST of WDQS queries (probes, the builder's
// tests, roll-up batches, verification sampling, label backfill). The public endpoint throttles a
// too-bursty IP — and that throttle surfaces NOT as a clean 429 but as requests silently HANGING
// until our client timeout fires (a confusing 408 on otherwise-fine queries). Capping concurrency
// keeps us under the throttle. (Heavy benchmarking tripped exactly this; the cap stops it
// recurring.) Normal pipelines are mostly sequential, so a cap of 3 adds ~nothing in practice.
const MAX_WDQS_CONCURRENCY = 3
let wdqsActive = 0
const wdqsQueue: Array<() => void> = []
function acquireWdqs(): Promise<void> {
  return new Promise<void>(resolve => {
    if (wdqsActive < MAX_WDQS_CONCURRENCY) { wdqsActive++; resolve() }
    else wdqsQueue.push(resolve) // resolved on release — the freed slot transfers, no re-increment
  })
}
function releaseWdqs(): void {
  const next = wdqsQueue.shift()
  if (next) next()
  else wdqsActive--
}

// Passive WDQS health signal. We don't POLL WDQS (that adds load) — we watch the outcomes of the
// queries we already run. A BURST of 429s / client-timeouts in a short window means our IP is being
// throttled (a transient, shared-endpoint condition), as opposed to a single genuinely-too-broad
// query timing out in isolation. The route reads this to tell the user "Wikidata is busy, retry
// shortly" vs "that query was too broad" — instead of a cryptic 408. (Both surface identically today.)
const TROUBLE_WINDOW_MS = 60_000
const THROTTLE_THRESHOLD = 3 // ≥3 timeouts/429s within the window ⇒ treat as throttled
let troubleTimes: number[] = []
function recordWdqsTrouble(): void {
  const cutoff = Date.now() - TROUBLE_WINDOW_MS
  troubleTimes = troubleTimes.filter(t => t >= cutoff)
  troubleTimes.push(Date.now())
}
export function wdqsThrottled(): boolean {
  const cutoff = Date.now() - TROUBLE_WINDOW_MS
  troubleTimes = troubleTimes.filter(t => t >= cutoff)
  return troubleTimes.length >= THROTTLE_THRESHOLD
}

// Execute a SPARQL query against WDQS, returning the raw result bindings.
// Throws SparqlError on a non-OK response OR a client-side timeout (loud failure — PID R6).
export async function runSparql(query: string, opts: SparqlOpts = {}): Promise<SparqlBinding[]> {
  // Wait for a concurrency slot BEFORE starting the timeout clock, so queue time isn't charged
  // against the query's own budget.
  await acquireWdqs()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ctrl = new AbortController()
  const deadline = Date.now() + timeoutMs
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  // Chain any caller-supplied signal into our controller so external cancellation still works.
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort()
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  const url = `${WDQS}?query=${encodeURIComponent(query)}&format=json`
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
        signal: ctrl.signal,
      })
      if (res.ok) {
        try {
          const data = (await res.json()) as { results?: { bindings?: SparqlBinding[] } }
          return data.results?.bindings ?? []
        } catch (parseErr) {
          // WDQS occasionally returns a 200 with a truncated/malformed body under load (a
          // Blazegraph failure mode, not ours) — treat it exactly like a 503: transient, worth a
          // backoff+retry within budget, never an uncaught crash (PID R6, loud only after
          // genuinely giving up).
          const raw = parseErr instanceof Error ? parseErr.message : String(parseErr)
          recordWdqsTrouble()
          if (attempt < MAX_ATTEMPTS - 1) {
            const backoff = Math.min(500 * 2 ** attempt, 4000)
            if (Date.now() + backoff < deadline) {
              console.warn(`[wdqs] malformed JSON body (${raw}) — backing off ${backoff}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`)
              await delay(backoff, ctrl.signal)
              continue
            }
          }
          // The raw error (a low-level stream/decompression message like "Error in input
          // stream") means nothing to a user and isn't ours to explain — log it for us, show
          // them something actionable instead. This is the SparqlError's own message, so every
          // call site that lets it bubble up uncaught (most of the agent loop doesn't have its
          // own translation) inherits the friendly wording for free.
          console.error(`[wdqs] malformed response body after ${attempt + 1} attempt(s): ${raw}`)
          throw new SparqlError(502, 'Wikidata returned a corrupted response, please try again.')
        }
      }
      const body = await res.text().catch(() => '')
      if (RETRYABLE_STATUS.has(res.status)) recordWdqsTrouble() // health signal (per throttle response)
      // Rate-limited / transiently unavailable → back off and retry if we have budget + attempts left.
      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
        const retryAfterSec = parseInt(res.headers.get('retry-after') ?? '', 10)
        const backoff = Number.isFinite(retryAfterSec)
          ? Math.min(retryAfterSec * 1000, 8000)
          : Math.min(500 * 2 ** attempt, 4000) // 0.5s, 1s, 2s …
        if (Date.now() + backoff < deadline) {
          console.warn(`[wdqs] ${res.status} — backing off ${backoff}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`)
          await delay(backoff, ctrl.signal)
          continue
        }
      }
      throw new SparqlError(res.status, body.slice(0, 600))
    }
  } catch (e) {
    // Our own abort surfaces as a generic AbortError — translate it to a clear, loud timeout so
    // the agent sees "too slow, simplify" rather than an opaque network error.
    if (ctrl.signal.aborted && !(opts.signal?.aborted)) {
      // A client-timeout is a throttle signal too — but ONLY count the meaningful queries (probes /
      // the main answer, ≥18s budget). The builder's cheap 12s exploratory tests time out routinely
      // on slow drafts (normal), so counting those would falsely flag a single hard query as a throttle.
      if (timeoutMs >= 18_000) recordWdqsTrouble()
      throw new SparqlError(
        408,
        `timed out after ${timeoutMs}ms — too BROAD/DEEP, not necessarily wrong. Make it MORE ` +
          `SELECTIVE: pin the entity class precisely (avoid wide wdt:P279* subclass expansion), filter ` +
          `the small side first, and/or shorten a transitive (P131*/P279*) path. Do NOT drop a required ` +
          `constraint or switch to a shallow path — that under-answers. Re-test the tightened query.`,
      )
    }
    throw e
  } finally {
    clearTimeout(timer)
    releaseWdqs()
  }
}

const WD_API = 'https://www.wikidata.org/w/api.php'

export interface EntityCandidate {
  id: string // QID, e.g. "Q123480242"
  label: string
  description: string
}

// Resolve a name to candidate Wikidata entities (wbsearchentities). Used to pin the
// correct QID for a named anchor (a band, person, war, …) instead of letting the model
// guess one — the cause of the KATSEYE recall miss (PID R3, resolve the subject).
export async function searchEntities(term: string, limit = 7): Promise<EntityCandidate[]> {
  return wbSearch(term, 'item', limit)
}

// Resolve a label to candidate Wikidata PROPERTIES (wbsearchentities type=property).
// The schema-discovery builder (PID R9) uses this to look up property IDs — "place of
// birth" → P19 — rather than guessing them.
export async function searchProperties(term: string, limit = 7): Promise<EntityCandidate[]> {
  return wbSearch(term, 'property', limit)
}

async function wbSearch(term: string, type: 'item' | 'property', limit: number): Promise<EntityCandidate[]> {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: term,
    language: 'en',
    uselang: 'en',
    type,
    format: 'json',
    limit: String(limit),
  })
  try {
    const res = await fetch(`${WD_API}?${params}`, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return []
    const data = (await res.json()) as { search?: Array<{ id: string; label?: string; description?: string }> }
    return (data.search ?? []).map(s => ({ id: s.id, label: s.label ?? s.id, description: s.description ?? '' }))
  } catch {
    return []
  }
}

// Parse a WDQS coordinate literal "Point(<lng> <lat>)" into { lat, lng }.
export function parsePoint(wkt: string): { lat: number; lng: number } | null {
  const m = wkt.match(/Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i)
  if (!m) return null
  const lng = parseFloat(m[1])
  const lat = parseFloat(m[2])
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}
