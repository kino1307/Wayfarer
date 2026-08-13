// PID R10 — the verification gate. A structured query returning rows is necessary but
// NOT sufficient: a query that is valid SPARQL but the wrong interpretation returns
// confident garbage, and because it has rows it never trips the empty-result fallback.
// Before emission we check the result set against the query's INTENT along generic,
// shape-agnostic dimensions:
//
//   • TYPE conformance — does each plotted (WHERE) and relating (WHY) entity belong to the
//     class the query implies? The expected class is derived from the query intent, NOT
//     from the result's own dominant class — pollution can outvote the signal (74 bogus
//     "countries" vs 13 real sovereign states), so the dominant class is untrustworthy.
//   • CARDINALITY sanity — is the count near an independently-derived expectation?
//
// Verification has no oracle and cannot PROVE correctness. On non-confirmation it DEMOTES
// membership to `asserted` and reports the reason loudly (R6/R8); it never drops a node,
// and never lets an unverified row pass as `structural`. When our own expectation looks
// wrong (it matches none of the results) the check is INCONCLUSIVE and we demote nothing —
// we do not punish results for our inability to form an expectation.

import { callClaude, parseJsonResponse } from './anthropic.js'
import { runSparql, searchEntities, type SparqlBinding } from './wikidata.js'

const WD_ENTITY = 'http://www.wikidata.org/entity/'

export function uriToQid(uri: string | undefined): string | null {
  if (!uri || !uri.startsWith(WD_ENTITY)) return null
  const qid = uri.slice(WD_ENTITY.length)
  return /^Q\d+$/.test(qid) ? qid : null
}

export interface Expectations {
  where_class: string | null
  why_class: string | null
  expected_min: number | null
  expected_max: number | null
}

// One model call: what class should the plotted (WHERE) and relating (WHY) entities be,
// and roughly how many results does a correct answer hold? Derived from the QUERY INTENT,
// independent of the (possibly polluted) result set — that independence is the whole point.
export async function deriveExpectations(
  query: string,
  queryRole: string,
  apiKey: string,
  model: string,
): Promise<Expectations> {
  const prompt = `For a map query, state the general Wikidata CLASS that the plotted entities
should belong to, and — if relevance comes from a related entity — the class that related
entity should belong to. Also give a rough expected COUNT RANGE a correct answer holds.

Choose the class BROAD enough to include every valid result but no broader — it is a net for
gross type errors, not a precise filter. For places that are settlements, prefer the general
"human settlement" over "city" (a valid result may be a town, village, or district, not a
city). Use a specific class only when the role itself is specific (castle, lighthouse, battle).

DESIGNATION/HETEROGENEOUS queries: when the plotted entities are defined by a DESIGNATION,
listing, award, or status (World Heritage Sites, national monuments, Ramsar sites, Michelin-
starred restaurants, protected areas) rather than sharing one physical kind, they have NO single
valid type — a UNESCO site can be a town, a church, an archaeological area, or a forest. Set
where_class to null in that case: a type net would wrongly reject most valid results. Membership
there is carried by the designation itself, not by a class.

The plotted entity (WHERE) is always a place. The relating entity (WHY) is the thing that
makes the place relevant (the country a capital belongs to; the person whose birthplace it
is). If the plotted things are intrinsically relevant (battles, monuments), why_class is null.

Return ONLY raw JSON: {"where_class":"<class label or null>","why_class":"<label or null>","expected_min":<int>,"expected_max":<int>}

Examples:
"South American capitals" role=capital -> {"where_class":"human settlement","why_class":"sovereign state","expected_min":10,"expected_max":16}
"Birthplaces of The Beatles members" role=birthplace -> {"where_class":"human settlement","why_class":"human","expected_min":2,"expected_max":6}
"World War I battles" role=battle -> {"where_class":"battle","why_class":null,"expected_min":40,"expected_max":1500}
"Castles in Wales" role=castle -> {"where_class":"castle","why_class":null,"expected_min":50,"expected_max":600}
"UNESCO World Heritage Sites in Italy" role=site -> {"where_class":null,"why_class":null,"expected_min":50,"expected_max":60}

Query: <query>${query}</query>  role: "${queryRole}"`

  try {
    const raw = await callClaude(apiKey, model, prompt, 200)
    const p = parseJsonResponse(raw) as Record<string, unknown>
    const str = (v: unknown) =>
      typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    return {
      where_class: str(p.where_class),
      why_class: str(p.why_class),
      expected_min: num(p.expected_min),
      expected_max: num(p.expected_max),
    }
  } catch {
    return { where_class: null, why_class: null, expected_min: null, expected_max: null }
  }
}

// Resolve a class label ("sovereign state") to its Wikidata QID via entity search.
async function resolveClass(label: string): Promise<{ qid: string; label: string } | null> {
  const cands = await searchEntities(label, 5)
  if (!cands.length) return null
  return { qid: cands[0].id, label: cands[0].label } // wbsearchentities ranks by relevance
}

// Of these entities, which are an instance (P31) of the class — or of any subclass (P279*)
// of it? Batched: a large result set would overflow a single VALUES clause, so we chunk it
// (a failure there once made the verifier silently go "inconclusive" on big sets). A batch
// that errors is skipped; conformance is only ever under-counted, never invented.
async function conformingEntities(qids: string[], classQid: string): Promise<Set<string>> {
  const BATCH = 100
  const chunks: string[][] = []
  for (let i = 0; i < qids.length; i += BATCH) chunks.push(qids.slice(i, i + BATCH))
  // Batches are independent → run them in parallel (a 789-entity set was ~8 serial queries).
  const results = await Promise.all(
    chunks.map(async chunk => {
      const values = chunk.map(q => `wd:${q}`).join(' ')
      const sparql =
        `SELECT DISTINCT ?e WHERE { VALUES ?e { ${values} } ` +
        `?e wdt:P31/wdt:P279* ?c . VALUES ?c { wd:${classQid} } }`
      try {
        return await runSparql(sparql)
      } catch {
        return [] // skip this batch — better to under-count conformers than to crash the gate
      }
    }),
  )
  const out = new Set<string>()
  for (const rows of results) for (const r of rows) {
    const qid = uriToQid(r.e?.value)
    if (qid) out.add(qid)
  }
  return out
}

const EARTH = 'Q2'

// A general Wikidata modelling gotcha, not query-specific: physical-geography classes (volcano,
// crater, sea, mountain, ...) are shared across the solar system, and namesake features on other
// worlds carry real P31 membership in the same class — Io's volcanoes are famously named after
// Earth fire/thunder deities (Loki, Thor, Pele, Surt, Prometheus) and are genuinely typed
// "volcano", so a class-only match (no geographic constraint left to filter them, e.g. after a
// repair widens a query) lets them through the type check with a real, verified-looking P625
// coordinate — just plotted in the wrong world's coordinate frame onto an Earth map. Every node
// this app emits is plotted on Earth (Leaflet/OSM per the README), so an entity whose OWN
// "located on astronomical body" (P376) is bound to anything but Earth is never a valid result,
// independent of the query. Checked once per pipeline run, not part of the R10 type/cardinality
// axes — this is a validity gate, not a membership judgement.
export async function offEarthEntities(qids: string[]): Promise<Set<string>> {
  if (!qids.length) return new Set()
  const BATCH = 100
  const chunks: string[][] = []
  for (let i = 0; i < qids.length; i += BATCH) chunks.push(qids.slice(i, i + BATCH))
  const results = await Promise.all(
    chunks.map(async chunk => {
      const values = chunk.map(q => `wd:${q}`).join(' ')
      const sparql =
        `SELECT DISTINCT ?e WHERE { VALUES ?e { ${values} } ` +
        `?e wdt:P376 ?body . FILTER(?body != wd:${EARTH}) }`
      try {
        return await runSparql(sparql)
      } catch {
        return [] // skip this batch — better to under-count than to crash the gate
      }
    }),
  )
  const out = new Set<string>()
  for (const rows of results) for (const r of rows) {
    const qid = uriToQid(r.e?.value)
    if (qid) out.add(qid)
  }
  return out
}

export interface SlotReport {
  expected_label: string | null
  resolved: boolean
  conclusive: boolean // false when the expected class matched NONE of the results
  total: number
  conforming: number
}

export interface VerificationReport {
  where: SlotReport
  why: SlotReport | null
  cardinality: {
    expected_min: number | null
    expected_max: number | null
    structural: number // count after demotion
    total: number // raw rows
    verdict: 'ok' | 'over' | 'under' | 'unknown'
  }
  demoted: number
  sampled: number // how many results got the independent membership re-check
  status: 'verified' | 'flagged' | 'inconclusive'
  notes: string[]
}

export interface VerifyResult {
  demote: Map<string, string> // ?where URI → reason it was demoted to asserted
  report: VerificationReport
}

// Geographic containment (PID R10). For "X in <place>" queries a result can be LINKED to the
// place (its P17/country list INCLUDES it) yet sit in a different country — transnational/serial
// entities (e.g. a pan-European World Heritage Site whose pin is in Germany but whose countries
// include Italy). A result counts as truly "in" its ?why iff it is located there (wdt:P131*
// reaches the ?why) OR that place is its ONLY country (covers sparse-P131 data without
// re-admitting multi-country sites). So this only ever flags MULTI-country entities not actually
// located in the place — precisely the cross-border leak. Returns the ?where QIDs that ARE in.
async function geographicallyContained(
  pairs: Array<{ whereQid: string; whyQid: string }>,
): Promise<Set<string>> {
  const contained = new Set<string>()
  const BATCH = 80
  const chunks: (typeof pairs)[] = []
  for (let i = 0; i < pairs.length; i += BATCH) chunks.push(pairs.slice(i, i + BATCH))
  const results = await Promise.all(
    chunks.map(async chunk => {
      const values = chunk.map(p => `(wd:${p.whereQid} wd:${p.whyQid})`).join(' ')
      const sparql =
        `SELECT ?where (COUNT(DISTINCT ?c) AS ?nc) (COUNT(DISTINCT ?anc) AS ?loc) WHERE { ` +
        `VALUES (?where ?why) { ${values} } ` +
        `OPTIONAL { ?where wdt:P17 ?c } ` +
        `OPTIONAL { ?where wdt:P131* ?anc . FILTER(?anc = ?why) } ` +
        `} GROUP BY ?where`
      try {
        return await runSparql(sparql)
      } catch {
        return []
      }
    }),
  )
  for (const rows of results) {
    for (const r of rows) {
      const qid = uriToQid(r.where?.value)
      const nc = parseInt(r.nc?.value ?? '0', 10)
      const loc = parseInt(r.loc?.value ?? '0', 10)
      if (qid && (loc > 0 || nc <= 1)) contained.add(qid)
    }
  }
  return contained
}

// Run the gate over the raw bindings of a structured result. We read from bindings (not the
// built nodes) because we need the ?why ENTITY QIDs, which bindingsToNodes discards.
export async function verifyStructured(
  bindings: SparqlBinding[],
  query: string,
  queryRole: string,
  apiKey: string,
  model: string,
  exp: Expectations,
): Promise<VerifyResult> {
  const whereUris = new Set<string>()
  const whereUriToQid = new Map<string, string>()
  const whyByWhere = new Map<string, Set<string>>() // ?where URI → set of ?why QIDs
  const whyQids = new Set<string>()
  const whereLabel = new Map<string, string>()
  const whyLabels = new Map<string, Set<string>>() // ?where URI → set of ?why labels (for sampling)

  for (const b of bindings) {
    const wUri = b.where?.value
    if (!wUri) continue
    whereUris.add(wUri)
    const wQid = uriToQid(wUri)
    if (wQid) whereUriToQid.set(wUri, wQid)
    if (b.whereLabel?.value && !whereLabel.has(wUri)) whereLabel.set(wUri, b.whereLabel.value)

    const yQid = uriToQid(b.why?.value)
    if (yQid) {
      whyQids.add(yQid)
      let s = whyByWhere.get(wUri)
      if (!s) { s = new Set(); whyByWhere.set(wUri, s) }
      s.add(yQid)
    }
    if (b.whyLabel?.value) {
      let s = whyLabels.get(wUri)
      if (!s) { s = new Set(); whyLabels.set(wUri, s) }
      s.add(b.whyLabel.value)
    }
  }

  // Expectations are derived by the caller (prefetched in parallel with the builder; see
  // structured.ts) and reused across the original + repair verify passes.

  // Resolve both expected classes in parallel, then run both conformance checks in parallel.
  const whereQids = [...whereUriToQid.values()]
  const hasWhy = whyQids.size > 0
  const [whereResolved, whyResolved] = await Promise.all([
    exp.where_class ? resolveClass(exp.where_class) : Promise.resolve(null),
    hasWhy && exp.why_class ? resolveClass(exp.why_class) : Promise.resolve(null),
  ])
  const [whereConforming, whyConforming] = await Promise.all([
    whereResolved && whereQids.length ? conformingEntities(whereQids, whereResolved.qid) : Promise.resolve(new Set<string>()),
    whyResolved && hasWhy ? conformingEntities([...whyQids], whyResolved.qid) : Promise.resolve(new Set<string>()),
  ])
  const whereConclusive = whereConforming.size > 0
  const whyConclusive = hasWhy && whyConforming.size > 0

  // Per-WHERE verdict. Which slot carries membership depends on a CAPABILITY of the row, not
  // the query content (R7-safe): if the place has a ?why, membership rides on the WHY's type
  // (the WHERE is just a geocoding target and may legitimately be a building, district, or
  // address — a birthplace is often a hospital, not a "city"). If there's no ?why, the place
  // IS the answer (a castle, a battle), so its own type carries membership. Demote only on a
  // CONCLUSIVE check (one that matched some results — guards against a wrong expected class).
  const demote = new Map<string, string>()
  for (const wUri of whereUris) {
    const wQid = whereUriToQid.get(wUri)
    const ys = whyByWhere.get(wUri)
    if (ys && ys.size > 0) {
      // case-(b): membership = the relating entity's type.
      if (whyConclusive && ![...ys].some(y => whyConforming.has(y))) {
        demote.set(wUri, `relating entity is not a ${whyResolved!.label} (membership unverified)`)
      }
    } else if (whereConclusive && wQid && !whereConforming.has(wQid)) {
      // case-(a): membership = the plotted thing's own type.
      demote.set(wUri, `plotted entity is not a ${whereResolved!.label} (type-outlier)`)
    }
  }

  // Sampled-membership re-check (PID R10, third layer). The type checks confirm the right
  // KIND of thing; this confirms a random sample genuinely ANSWERS the query, judged
  // independently (model world-knowledge, not the structured relationship that selected it).
  // Bounded to one batched call; only demotes the specific sampled outliers it is sure about.
  const typeDemoted = demote.size

  // Geographic-containment check: demote results LINKED to the ?why place but not located in it
  // (transnational/serial entities plotting in another country). Self-limiting: it only flags
  // multi-country entities not actually inside the place, so it's a no-op for birthplaces, etc.
  let geoDemoted = 0
  let geoLabel: string | null = null
  const wheresWithWhy = [...whereUris].filter(u => (whyByWhere.get(u)?.size ?? 0) > 0)
  if (wheresWithWhy.length >= 4) {
    const pairs: Array<{ whereQid: string; whyQid: string }> = []
    for (const u of wheresWithWhy) {
      const wQid = whereUriToQid.get(u)
      if (wQid) for (const y of whyByWhere.get(u)!) pairs.push({ whereQid: wQid, whyQid: y })
    }
    const inPlace = await geographicallyContained(pairs)
    const containedCount = wheresWithWhy.filter(u => inPlace.has(whereUriToQid.get(u)!)).length
    // Only act when it really is a containment query (most results sit inside their ?why).
    if (containedCount / wheresWithWhy.length >= 0.5) {
      geoLabel = [...(whyLabels.get(wheresWithWhy.find(u => whyLabels.has(u)) ?? '') ?? [])][0] ?? 'the named place'
      for (const u of wheresWithWhy) {
        const q = whereUriToQid.get(u)
        if (q && !inPlace.has(q) && !demote.has(u)) {
          demote.set(u, `located outside ${geoLabel} (linked to it but plotted elsewhere)`)
          geoDemoted++
        }
      }
    }
  }

  let sampled = 0
  let sampledBad = 0
  const survivors = [...whereUris].filter(u => !demote.has(u))
  if (survivors.length) {
    const sample = pickRandom(survivors, 6)
    sampled = sample.length
    const items = sample.map((u, i) => ({
      i,
      uri: u,
      place: whereLabel.get(u) ?? uriToQid(u) ?? u,
      relating: [...(whyLabels.get(u) ?? [])].join(', '),
    }))
    const bad = await sampledMembership(query, queryRole, items, apiKey, model)
    for (const [uri, reason] of bad) demote.set(uri, reason)
    sampledBad = bad.size
  }

  // Cardinality — set-level advisory, judged against the post-demotion structural count.
  const structural = whereUris.size - demote.size
  let verdict: 'ok' | 'over' | 'under' | 'unknown' = 'unknown'
  if (exp.expected_min != null && exp.expected_max != null) {
    // Symmetric slack: `over` already tolerates 1.5× above max, so `under` gets the matching cushion
    // (0.7× below min, the same factor repairWorthy uses) instead of flagging a trivially-short but
    // correct result (9 of an expected ~10) as a recall gap. A severe shortfall still trips `under`.
    if (structural > exp.expected_max * 1.5) verdict = 'over'
    else if (structural < exp.expected_min * 0.7) verdict = 'under'
    else verdict = 'ok'
  }

  const notes: string[] = []
  if (exp.where_class && !whereConclusive)
    notes.push(`where-type check inconclusive (no result matched '${exp.where_class}')`)
  if (hasWhy && exp.why_class && !whyConclusive)
    notes.push(`why-type check inconclusive (no result matched '${exp.why_class}')`)
  if (typeDemoted)
    notes.push(`${typeDemoted} of ${whereUris.size} results failed type-conformance → shown as unverified`)
  if (geoDemoted)
    notes.push(`${geoDemoted} results are linked to ${geoLabel} but located outside it → shown as unverified`)
  if (sampledBad)
    notes.push(`${sampledBad} of ${sampled} sampled results failed an independent membership check → shown as unverified`)
  if (verdict === 'over')
    notes.push(`${structural} results exceed the expected ~${exp.expected_min}-${exp.expected_max} (possible over-collection)`)
  if (verdict === 'under')
    notes.push(`${structural} results below the expected ~${exp.expected_min}-${exp.expected_max} (possible recall gap)`)

  const status: VerificationReport['status'] =
    demote.size > 0 || verdict === 'over' || verdict === 'under'
      ? 'flagged'
      : whereConclusive || whyConclusive
        ? 'verified'
        : 'inconclusive'

  return {
    demote,
    report: {
      where: {
        expected_label: whereResolved?.label ?? exp.where_class,
        resolved: !!whereResolved,
        conclusive: whereConclusive,
        total: whereQids.length,
        conforming: whereConforming.size,
      },
      why: hasWhy
        ? {
            expected_label: whyResolved?.label ?? exp.why_class,
            resolved: !!whyResolved,
            conclusive: whyConclusive,
            total: whyQids.size,
            conforming: whyConforming.size,
          }
        : null,
      cardinality: {
        expected_min: exp.expected_min,
        expected_max: exp.expected_max,
        structural,
        total: whereUris.size,
        verdict,
      },
      demoted: demote.size,
      sampled,
      status,
      notes,
    },
  }
}

function pickRandom<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr]
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

// Independent membership judgement (PID R10): does each sampled place genuinely answer the
// query? Judged by model world-knowledge — an axis independent of the structured relationship
// that selected it. One batched call. Only the items it marks clearly wrong are demoted; the
// reason is recorded. We never invent confidence — anything unsure is left as-is.
async function sampledMembership(
  query: string,
  queryRole: string,
  items: { i: number; uri: string; place: string; relating: string }[],
  apiKey: string,
  model: string,
): Promise<Map<string, string>> {
  const bad = new Map<string, string>()
  if (!items.length) return bad
  const list = items
    .map(it => `${it.i}. place="${it.place}"${it.relating ? ` relating="${it.relating}"` : ''}`)
    .join('\n')
  const prompt = `Query: "${query}" (plotting: ${queryRole}).
These results came from a structured Wikidata query and are PROBABLY correct. Your only job is
to catch CLEAR errors: a place in the wrong country/continent, or one obviously unrelated to the
subject. Granularity is NOT an error — a birthplace may be a hospital, a house, or a street
address rather than a city, and that is correct; do NOT flag it for being a building or a small
place. Mark "ok": false ONLY when you are confident the place genuinely does not belong in the
answer. When in any doubt at all, mark "ok": true.

Return ONLY a raw JSON array: [{"i":0,"ok":true,"reason":""}, ...]

Items:
${list}`
  try {
    const raw = await callClaude(apiKey, model, prompt, 600)
    const parsed = parseJsonResponse(raw)
    if (!Array.isArray(parsed)) return bad
    for (const row of parsed as Array<{ i?: number; ok?: boolean; reason?: string }>) {
      if (row && row.ok === false && typeof row.i === 'number') {
        const it = items.find(x => x.i === row.i)
        if (it) bad.set(it.uri, `independent check: not a genuine ${queryRole}${row.reason ? `, ${row.reason}` : ''}`)
      }
    }
  } catch {
    // judgement unavailable → demote nothing (R10: never invent confidence)
  }
  return bad
}
