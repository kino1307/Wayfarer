// Coordinate fallback ladder (PID R4) for entities that resolved to a real Wikidata
// entity but carry no P625 coordinate:  geocoded → approximate → unresolved.
// Every produced coordinate is labelled with its tier; nothing is silently dropped (R6).

import { callClaude, parseJsonResponse } from './anthropic.js'
import { runSparql, parsePoint } from './wikidata.js'
import type { Node, PendingNode, Unresolved } from './nodes.js'

const WD_ENTITY = 'http://www.wikidata.org/entity/'
function uriToQid(uri: string | null): string | null {
  if (!uri || !uri.startsWith(WD_ENTITY)) return null
  const qid = uri.slice(WD_ENTITY.length)
  return /^Q\d+$/.test(qid) ? qid : null
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const UA = 'Orbis/0.1 (geographic query tool)'

// Nominatim asks for <= 1 request/second. We geocode sequentially with spacing, bounded
// by a budget so the fallback stays interactive; entities beyond the budget fall through
// to the model tier rather than being dropped. Kept small because the structural (P276/P131)
// tier above now resolves most no-coordinate entities — geocoding is a thin slice, and each
// hit costs ~1.1s of sequential wait, so a large budget is mostly latency for little gain.
const GEOCODE_BUDGET = 3
const GEOCODE_SPACING_MS = 1100

// Tier 0 of the ladder — STRUCTURAL location from Wikidata. An entity with no P625 of its own
// often still records WHERE it is: P276 (location) or P131 (located in admin territory), whose
// target place has a coordinate. "Battle of Fort Fizzle" has no point but P276 → Glenmont, Ohio
// (the real Civil-War site) — far better than a model guess that lands on the same-named Montana
// referent. We resolve that here, grounded in Wikidata, before any geocoding or model estimate.
// The coordinate belongs to the containing place (town/county-level), so it's labelled 'geocoded'
// (located via lookup), never 'verified' (which means the entity's own point).
async function locationCoords(qids: string[], path: string): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>()
  const BATCH = 100
  for (let i = 0; i < qids.length; i += BATCH) {
    const values = qids.slice(i, i + BATCH).map(q => `wd:${q}`).join(' ')
    const sparql = `SELECT ?e ?coord WHERE { VALUES ?e { ${values} } ?e ${path} ?loc . ?loc wdt:P625 ?coord }`
    try {
      const rows = await runSparql(sparql)
      for (const r of rows) {
        const qid = uriToQid(r.e?.value ?? null)
        if (!qid || out.has(qid)) continue // first coordinate per entity wins
        const pt = r.coord?.value ? parsePoint(r.coord.value) : null
        if (pt) out.set(qid, pt)
      }
    } catch {
      // structural lookup is best-effort; a failed batch just leaves those entities for later tiers
    }
  }
  return out
}

async function structuralCoords(pending: PendingNode[]): Promise<{ located: Node[]; remaining: PendingNode[] }> {
  const qids = [...new Set(pending.map(p => uriToQid(p.entity)).filter((q): q is string => !!q))]
  if (!qids.length) return { located: [], remaining: pending }
  // Prefer P276 (specific "location") over P131 (admin region, coarser); only look up P131 for the
  // entities P276 didn't resolve.
  const viaP276 = await locationCoords(qids, 'wdt:P276')
  const stillNeed = qids.filter(q => !viaP276.has(q))
  const viaP131 = stillNeed.length ? await locationCoords(stillNeed, 'wdt:P131') : new Map<string, { lat: number; lng: number }>()
  const located: Node[] = []
  const remaining: PendingNode[] = []
  for (const p of pending) {
    const qid = uriToQid(p.entity)
    const c = qid ? (viaP276.get(qid) ?? viaP131.get(qid)) : undefined
    if (c) located.push(toNode(p, c.lat, c.lng, 'geocoded'))
    else remaining.push(p)
  }
  return { located, remaining }
}

async function geocodeOne(name: string): Promise<{ lat: number; lng: number } | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(name)}&format=json&limit=1`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    if (!data.length) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    if (!isFinite(lat) || !isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

function toNode(p: PendingNode, lat: number, lng: number, tier: 'geocoded' | 'approximate'): Node {
  return {
    where: { name: p.name, lat, lng, entity: p.entity, where_url: p.where_url, coord_tier: tier },
    why: p.why,
    query_role: p.query_role,
  }
}

// Approximate tier — one model call returns best-guess coordinates for the remaining
// places. Model coordinates are labelled 'approximate' and never treated as verified (R4).
async function modelApproximate(
  pending: PendingNode[],
  apiKey: string,
  model: string,
  query: string,
): Promise<{ nodes: Node[]; unresolved: Unresolved[] }> {
  if (pending.length === 0) return { nodes: [], unresolved: [] }
  const list = pending
    .map((p, i) => `${i}: ${p.name}${p.why.length ? ` (${p.why.map(w => w.label).join(', ')})` : ''}`)
    .join('\n')
  const prompt = `These places are all answers to the map query: "${query}".
USE THAT CONTEXT TO DISAMBIGUATE same-named places — e.g. for a query about the American Civil
War, "Richmond" is Richmond, Virginia (not Richmond in Newfoundland or London) and an obscure
battle site belongs in the war's theatre, not a random homonym elsewhere in the world. Stay
within the region/era the query implies.
For each numbered place, give your best-estimate latitude and longitude.
Return ONLY raw JSON: an array of {"i":<index>,"lat":<number>,"lng":<number>}.
Omit any entry you cannot place with reasonable confidence. No markdown, no preamble.

${list}`
  try {
    const raw = await callClaude(apiKey, model, prompt, 4000)
    const arr = parseJsonResponse(raw) as Array<{ i: number; lat: number; lng: number }>
    const placed = new Map<number, { lat: number; lng: number }>()
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (
          typeof e?.i === 'number' && isFinite(e.lat) && isFinite(e.lng) &&
          e.lat >= -90 && e.lat <= 90 && e.lng >= -180 && e.lng <= 180
        ) {
          placed.set(e.i, { lat: e.lat, lng: e.lng })
        }
      }
    }
    const nodes: Node[] = []
    const unresolved: Unresolved[] = []
    pending.forEach((p, i) => {
      const c = placed.get(i)
      if (c) nodes.push(toNode(p, c.lat, c.lng, 'approximate'))
      else unresolved.push({ name: p.name, reason: 'no-coordinate' })
    })
    return { nodes, unresolved }
  } catch {
    return { nodes: [], unresolved: pending.map(p => ({ name: p.name, reason: 'no-coordinate' })) }
  }
}

// ── Envelope guard (PID R4) ────────────────────────────────────────────────────────────────
// The VERIFIED pins (real Wikidata P625 coordinates) describe where the answer actually lies.
// A fallback pin (geocoded or model-approximate) that lands far OUTSIDE that envelope is almost
// always a same-name disambiguation error ("Fall of Richmond" → Nova Scotia in a US-battles
// query). We catch those against the verified envelope and try once to re-place them INSIDE it
// with the model; anything that still can't be confidently placed in-region is moved to the
// unresolved report rather than plotted in the wrong place (R6 — reported, never silently wrong).

export interface GeoBox { minLat: number; maxLat: number; minLng: number; maxLng: number }

// Need a real verified core to trust the envelope; below this we don't guard (no anchor).
const MIN_ANCHORS = 8

// Trimmed min/max: drop the few most-extreme values per axis before bounding, so a single
// same-name mis-resolution (a "Richmond" that landed in London) can't inflate the box and silently
// disable the guard. ponytail: a percentile trim, not full antimeridian geometry — a genuinely
// dateline-spanning answer set just gets a wide longitude box and is then guarded on latitude only,
// which is rare and benign (no obvious cross-region outlier to catch there anyway).
function trimmedRange(vals: number[]): { min: number; max: number } {
  const s = [...vals].sort((a, b) => a - b)
  const k = s.length >= MIN_ANCHORS ? Math.max(1, Math.floor(s.length * 0.1)) : 0
  return { min: s[k], max: s[s.length - 1 - k] }
}

// The region the answer occupies. By default only `verified` pins anchor it (the structured path,
// where those coordinates are SPARQL-grounded and trustworthy). Pass { anyTier:true } for the
// asserted path, whose "anchors" are themselves best-effort name resolutions — there the trimmed
// range is what stops a mis-resolved pin from defining the very region it should be caught against.
export function computeEnvelope(nodes: Node[], opts: { anyTier?: boolean } = {}): GeoBox | null {
  const lats: number[] = []
  const lngs: number[] = []
  for (const n of nodes) {
    if ((opts.anyTier || n.where.coord_tier === 'verified') && isFinite(n.where.lat) && isFinite(n.where.lng)) {
      lats.push(n.where.lat)
      lngs.push(n.where.lng)
    }
  }
  if (lats.length < MIN_ANCHORS) return null
  const { min: minLat, max: maxLat } = trimmedRange(lats)
  const { min: minLng, max: maxLng } = trimmedRange(lngs)
  // Generous margin so legitimate edge results (a western-theatre battle, an outlying member) are
  // never falsely flagged — only gross, cross-region errors fall outside.
  const mLat = Math.max(3, (maxLat - minLat) * 0.2)
  const mLng = Math.max(3, (maxLng - minLng) * 0.2)
  return { minLat: minLat - mLat, maxLat: maxLat + mLat, minLng: minLng - mLng, maxLng: maxLng + mLng }
}

function inBox(lat: number, lng: number, b: GeoBox): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng
}

// Re-place fallback pins that sit outside the verified envelope; drop (→ unresolved) any the model
// still can't place in-region. Returns the corrected node list plus newly-unresolved entries.
//
// ponytail: expected false-positive — a region/operation entity (e.g. "Flanders Fields", "Spring
// Offensive") whose fallback coordinate is a centroid/guess can land outside the point-entity
// envelope and demote to unverified even when it's geographically central. This is correct, not a
// bug: the coordinate genuinely IS approximate, so flagging it is R6 (shown, never silently wrong).
// Do NOT loosen the guard to silence these — it's the same check that catches real same-name
// mis-resolutions (a US-battle "Richmond" → London), and the role is uniform per query so there's
// no non-point branch to special-case (R7). Upgrade path if it ever matters: distinguish by
// coord_tier and soften the message wording for fallback-tier area entities, not the guard itself.
export async function guardOutliers(
  fallbackNodes: Node[],
  env: GeoBox,
  query: string,
  apiKey: string,
  model: string,
): Promise<{ nodes: Node[]; unresolved: Unresolved[]; relocated: number; unplaced: number }> {
  const outlierIdx: number[] = []
  fallbackNodes.forEach((n, i) => {
    if (n.where.coord_tier !== 'verified' && !inBox(n.where.lat, n.where.lng, env)) outlierIdx.push(i)
  })
  if (!outlierIdx.length) return { nodes: fallbackNodes, unresolved: [], relocated: 0, unplaced: 0 }

  const list = outlierIdx
    .map((idx, i) => {
      const n = fallbackNodes[idx]
      return `${i}: ${n.where.name}${n.why.length ? ` (${n.why.map(w => w.label).join(', ')})` : ''}`
    })
    .join('\n')
  const prompt = `These places are answers to the map query: "${query}". Each was mistakenly placed
OUTSIDE the region where the answer actually lies. The correct coordinates MUST fall within
latitude ${env.minLat.toFixed(1)} to ${env.maxLat.toFixed(1)} and longitude ${env.minLng.toFixed(1)} to ${env.maxLng.toFixed(1)}
(the envelope of the already-confirmed results). Re-estimate each WITHIN that box, disambiguating
same-named places to the one that fits the query. Return ONLY raw JSON: an array of
{"i":<index>,"lat":<number>,"lng":<number>}. OMIT any place you cannot confidently put inside the
box. No markdown, no preamble.

${list}`

  const fixed = new Map<number, { lat: number; lng: number }>()
  try {
    const raw = await callClaude(apiKey, model, prompt, 2000)
    const arr = parseJsonResponse(raw) as Array<{ i: number; lat: number; lng: number }>
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (typeof e?.i === 'number' && isFinite(e.lat) && isFinite(e.lng) && inBox(e.lat, e.lng, env)) {
          fixed.set(e.i, { lat: e.lat, lng: e.lng })
        }
      }
    }
  } catch {
    // Re-placement unavailable → fall through; every outlier becomes unresolved (never wrong-placed).
  }

  const drop = new Set<number>()
  const unresolved: Unresolved[] = []
  let relocated = 0
  outlierIdx.forEach((nodeIdx, i) => {
    const c = fixed.get(i)
    if (c) {
      const n = fallbackNodes[nodeIdx]
      n.where.lat = c.lat
      n.where.lng = c.lng
      n.where.coord_tier = 'approximate' // a corrected estimate is never better than approximate
      relocated++
    } else {
      drop.add(nodeIdx)
      unresolved.push({ name: fallbackNodes[nodeIdx].where.name, reason: 'no-coordinate' })
    }
  })
  const nodes = fallbackNodes.filter((_, i) => !drop.has(i))
  return { nodes, unresolved, relocated, unplaced: drop.size }
}

// Run the ladder: structural (P276/P131) → geocoded (bounded Nominatim) → approximate (model)
// → unresolved. The structural tier comes first because it is grounded in Wikidata, not guessed.
export async function locatePending(
  pending: PendingNode[],
  apiKey: string,
  model: string,
  query: string,
): Promise<{ nodes: Node[]; unresolved: Unresolved[] }> {
  const nodes: Node[] = []
  const remaining: PendingNode[] = []

  // Tier 0 — the entity's own recorded location (P276/P131 → that place's P625).
  const struct = await structuralCoords(pending)
  nodes.push(...struct.located)
  if (struct.located.length) console.log(`[fallback] structural location resolved ${struct.located.length}/${pending.length} (P276/P131)`)

  let used = 0
  for (const p of struct.remaining) {
    if (used >= GEOCODE_BUDGET) {
      remaining.push(p)
      continue
    }
    used++
    const c = await geocodeOne(p.name)
    if (c) nodes.push(toNode(p, c.lat, c.lng, 'geocoded'))
    else remaining.push(p)
    if (used < GEOCODE_BUDGET) await new Promise(r => setTimeout(r, GEOCODE_SPACING_MS))
  }

  const approx = await modelApproximate(remaining, apiKey, model, query)
  nodes.push(...approx.nodes)

  return { nodes, unresolved: approx.unresolved }
}

// The full location stage, shared by the structured and asserted paths (PID R4): run the fallback
// ladder over the pending set, then guard the resulting fallback pins against the verified
// envelope. `verified` are the nodes that already have a trustworthy coordinate (Wikidata P625) —
// they both pass through unchanged AND define the region the envelope guard polices.
export async function locateAndGuard(
  verified: Node[],
  pending: PendingNode[],
  query: string,
  apiKey: string,
  model: string,
): Promise<{ nodes: Node[]; unresolved: Unresolved[] }> {
  const fb = await locatePending(pending, apiKey, model, query)
  let fbNodes = fb.nodes
  let unresolved = fb.unresolved
  const env = computeEnvelope(verified)
  if (env && fbNodes.length) {
    const guarded = await guardOutliers(fbNodes, env, query, apiKey, model)
    if (guarded.relocated || guarded.unplaced) {
      console.log(`[fallback] envelope guard: ${guarded.relocated} re-placed, ${guarded.unplaced} → unresolved`)
      fbNodes = guarded.nodes
      unresolved = [...unresolved, ...guarded.unresolved]
    }
  }
  return { nodes: [...verified, ...fbNodes], unresolved }
}

// Asserted-path location + guard. Unlike the structured path, the asserted path has NO
// SPARQL-verified core: every coordinate here came from a best-effort NAME resolution (PID R3
// cannot fully constrain a model-supplied name), so NONE is a trustworthy anchor. We build the
// region from the trimmed envelope of the WHOLE cluster and guard EVERY pin against it — that is
// what catches a same-name mis-resolution (a US-battle "Richmond" that resolved to London) instead
// of plotting it on a confident-looking pin (PID R3/R6). `located` are already geocoded-tier (never
// `verified`), so guardOutliers treats them as guardable like any other fallback pin.
export async function locateAndGuardAsserted(
  located: Node[],
  pending: PendingNode[],
  query: string,
  apiKey: string,
  model: string,
): Promise<{ nodes: Node[]; unresolved: Unresolved[] }> {
  const fb = await locatePending(pending, apiKey, model, query)
  const all = [...located, ...fb.nodes]
  const env = computeEnvelope(all, { anyTier: true })
  if (env && all.length) {
    const guarded = await guardOutliers(all, env, query, apiKey, model)
    if (guarded.relocated || guarded.unplaced) {
      console.log(`[fallback] asserted envelope guard: ${guarded.relocated} re-placed, ${guarded.unplaced} → unresolved`)
      return { nodes: guarded.nodes, unresolved: [...fb.unresolved, ...guarded.unresolved] }
    }
  }
  return { nodes: all, unresolved: fb.unresolved }
}
