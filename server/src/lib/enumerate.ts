// Model-knowledge enumeration (PID R2, the `asserted` path). Used only when the structured
// Wikidata query expresses nothing — i.e. the set isn't structurally expressible (subjective /
// vibe queries) or Wikidata simply has no data.
//
// Division of labour (PID): the MODEL proposes the candidate SET; WIKIDATA grounds where each one
// is. So the model only returns NAMES here — never coordinates. We then resolve each name to its
// Wikidata entity and take its real coordinate; only what can't be grounded falls to the shared
// location ladder (geocode → context-model → envelope guard) via `resolveCandidates` + caller.
//
// Two independent trust axes (R8): membership stays `asserted` (the model's claim that this place
// belongs in the set is never verified here), but the COORDINATE can be `verified` when Wikidata
// knows the place — "we can't vouch it's a moonwalker's hometown, but if it's Wapakoneta, Ohio,
// that's exactly where Wapakoneta is."

import { callClaude, parseJsonResponse } from './anthropic.js'
import { searchEntities, runSparql, parsePoint } from './wikidata.js'
import type { Node, PendingNode } from './nodes.js'

const WD_ENTITY = 'http://www.wikidata.org/entity/'

export interface EnumeratedCandidate {
  name: string // the place to plot
  why: string // one-line attribution (model's claim of why it matches) — always `asserted`
}

interface RawEntity {
  name?: unknown
  country?: unknown
  description?: unknown
}

// Step 1 — the model lists the answer set by NAME only (no coordinates; Wikidata supplies those).
export async function modelEnumerate(
  query: string,
  queryRole: string,
  apiKey: string,
  model: string,
): Promise<EnumeratedCandidate[]> {
  const prompt = `Wikidata has no structured data for this map query, so enumerate from your own
knowledge instead. List the places that answer the query — be reasonably complete but do not pad
with weak matches.

Query: "${query}"

For each place return its name, the country it is in, and a one-line description of why it matches
the query. Do NOT return coordinates — only the name and context. Ground each description in a
specific, checkable fact — a named event, institution, statistic, or notable person — never a
sweeping generalization about a nationality, ethnicity, or culture's traits.

Return ONLY raw JSON — an array of objects:
[{"name":"...","country":"...","description":"..."}]
No markdown, no preamble.`

  const raw = await callClaude(apiKey, model, prompt, 4000)
  let arr: RawEntity[]
  try {
    arr = parseJsonResponse(raw) as RawEntity[]
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []

  const out: EnumeratedCandidate[] = []
  for (const e of arr) {
    const name = typeof e?.name === 'string' ? e.name.trim() : ''
    if (!name) continue
    const country = typeof e?.country === 'string' ? e.country.trim() : ''
    const description = typeof e?.description === 'string' ? e.description.trim() : ''
    out.push({ name, why: description || country || queryRole })
  }
  return out
}

// Run async `fn` over `items` with a bounded concurrency (Wikidata search is one HTTP call each;
// fire several at once but don't flood the API).
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// Direct P625 (the entity's OWN coordinate) for a batch of QIDs.
async function ownCoords(qids: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>()
  const BATCH = 100
  for (let i = 0; i < qids.length; i += BATCH) {
    const values = qids.slice(i, i + BATCH).map(q => `wd:${q}`).join(' ')
    const sparql = `SELECT ?e ?coord WHERE { VALUES ?e { ${values} } ?e wdt:P625 ?coord }`
    try {
      const rows = await runSparql(sparql)
      for (const r of rows) {
        const uri = r.e?.value
        const qid = uri?.startsWith(WD_ENTITY) ? uri.slice(WD_ENTITY.length) : null
        if (!qid || out.has(qid)) continue
        const pt = r.coord?.value ? parsePoint(r.coord.value) : null
        if (pt) out.set(qid, pt)
      }
    } catch {
      // best-effort — unresolved entities just fall through to the location ladder
    }
  }
  return out
}

// Step 2 — ground the candidates: resolve each NAME to its Wikidata entity and take its own P625
// (a `geocoded` coordinate — the resolution is an unconstrained name match, so it is NOT `verified`;
// membership stays `asserted`). Anything that resolves but has no own coordinate, or doesn't resolve
// at all, becomes a PendingNode for the shared location ladder (structural P276/P131 → geocode →
// context-model → envelope guard).
export async function resolveCandidates(
  candidates: EnumeratedCandidate[],
  queryRole: string,
): Promise<{ located: Node[]; pending: PendingNode[] }> {
  const resolved = await mapLimited(candidates, 8, async c => {
    let qid: string | null = null
    try {
      const hits = await searchEntities(c.name, 1)
      qid = hits[0]?.id ?? null
    } catch {
      qid = null
    }
    return { c, qid }
  })

  const qids = resolved.map(r => r.qid).filter((q): q is string => !!q)
  const coordByQid = qids.length ? await ownCoords([...new Set(qids)]) : new Map<string, { lat: number; lng: number }>()

  const located: Node[] = []
  const pending: PendingNode[] = []
  for (const { c, qid } of resolved) {
    const why = [{ label: c.why || queryRole, why_url: null, membership_tier: 'asserted' as const }]
    const entity = qid ? `${WD_ENTITY}${qid}` : null
    const coord = qid ? coordByQid.get(qid) : undefined
    if (coord) {
      // The name resolved to a Wikidata entity that has a coordinate. But the resolution was a
      // best-effort top-1 NAME match, NOT context-constrained (PID R3) — for an ambiguous name
      // ("Richmond") the top hit can be the wrong same-named place. So the COORDINATE is not
      // `verified`; label it `geocoded` (located, unverified) so the asserted envelope guard can
      // catch a mis-resolution, and it never wears a confident badge. Membership stays asserted (R8).
      located.push({
        where: { name: c.name, lat: coord.lat, lng: coord.lng, entity, where_url: null, coord_tier: 'geocoded' },
        why,
        query_role: queryRole,
      })
    } else {
      pending.push({ name: c.name, entity, where_url: null, why, query_role: queryRole })
    }
  }
  return { located, pending }
}
