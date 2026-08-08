import { Router, Request, Response } from 'express'
import { callClaude, parseJsonResponse } from '../lib/anthropic.js'
import { runSparql, SparqlError, searchEntities, wdqsThrottled } from '../lib/wikidata.js'
import { bindingsToNodes, backfillLabels, type Node, type Unresolved } from '../lib/nodes.js'
import { locateAndGuard, locateAndGuardAsserted } from '../lib/fallback.js'
import { modelEnumerate, resolveCandidates } from '../lib/enumerate.js'
import { verifyStructured, deriveExpectations, offEarthEntities, uriToQid, type VerificationReport, type Expectations } from '../lib/verify.js'
import { collapseSubcomponents } from '../lib/rollup.js'
import { buildSparql, type AgentStep } from '../lib/builder.js'
import { runWithUsage, estimateCostUsd, formatUsage, type Usage } from '../lib/usage.js'
import NodeCache from 'node-cache'

const router = Router()

// Cross-user result cache (Tier 1 cost cut): identical query+model returns the prior result for
// free — no LLM calls. Wikidata changes slowly, so a 24h TTL is safe; results are public data.
// Cache EVERYTHING (no key cap) — a small cap has negligible cross-user hit rate and FIFO would
// evict the popular head for one-off tail queries. Memory is bounded only by the 24h TTL, so a
// sustained flood of UNIQUE queries could grow it; the production answer for "cache everything
// safely" is an external store (Redis), which also persists across restarts and shares across
// instances. Swap NodeCache → Redis there; the get/set seam below is the only thing that changes.
const resultCache = new NodeCache({ stdTTL: 86400, useClones: false })
const cacheKey = (query: string, model: string) => `${query.trim().toLowerCase()}::${model}`

function getCached(query: string, model: string): PipelineResult | null {
  const hit = resultCache.get<PipelineResult>(cacheKey(query, model))
  if (!hit) return null
  // Served for free → reflect zero spend and flag it as cached.
  return {
    ...hit,
    meta: {
      ...hit.meta,
      cached: true,
      usage: { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    },
  }
}

function setCached(query: string, model: string, result: PipelineResult): void {
  if (result.nodes.length === 0) return // don't cache empties — let them retry
  // Never cache a DEGRADED result: a WDQS error (timeout/429/…) means the structured path failed and
  // we fell back — that failure is usually transient, so caching it would serve the error (and the
  // weaker asserted result) for the full 24h TTL. Let these recompute. (This is the "408 served
  // instantly forever" bug: a one-off timeout got baked into the cache.)
  if (result.meta.error) return
  // A NON-CONVERGED asserted result is a degraded fallback: the builder couldn't produce a working
  // structured query THIS run (possibly a transient WDQS/agent hiccup), so we fell back to the model
  // guess. Caching it would lock the weaker answer in for the full 24h TTL even though a retry might
  // converge. A CONVERGED asserted result is different — the query was valid but the set is genuinely
  // non-structural (a vibe query), so it's stable and worth caching. Only skip the flaky case.
  if (result.meta.enumerator === 'asserted' && !result.meta.builder.converged) return
  try {
    resultCache.set(cacheKey(query, model), result)
  } catch (e) {
    // Caching is best-effort — never break a successful request over a cache write.
    console.error('[cache] set failed (ignored):', e instanceof Error ? e.message : e)
  }
}

// Live-progress callback for the UI stream; a no-op for the plain JSON endpoint.
type ProgressFn = (message: string) => void
const NO_PROGRESS: ProgressFn = () => {}

const VALID_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-opus-4-6',
  // Stage 5 benchmark candidates (server-side GEMINI_API_KEY, not BYOK).
  'gemini:gemini-2.0-flash',
  'gemini:gemini-2.5-flash',
])

// Step 1 — identify the specific named anchor entities in the query (a band, person,
// war, …) and the query_role. The model can't reliably know their QIDs, so we resolve
// them against Wikidata search rather than letting it guess (PID R3, resolve the subject).
async function planQuery(
  query: string,
  apiKey: string,
  model: string,
): Promise<{ query_role: string; anchors: string[] }> {
  const prompt = `Identify the specific named entities in this map query that each refer to ONE
particular Wikidata item: named people, groups/bands, organisations, teams, creative works,
specific wars/events, AND geographic qualifiers that scope the query (countries, regions,
continents, states, cities — e.g. Wales, South America, France), AND named DESIGNATIONS or
classifications that are one specific listing/status/award (World Heritage Site, Ramsar site,
national monument, Michelin star, biosphere reserve) — these resolve to one Wikidata class and
the builder must filter membership on the RIGHT one (there are confusable near-matches). The
schema-discovery builder needs the real Wikidata QID of every proper noun, so include them all.
EXCLUDE ONLY generic category words that are just the plotted kind (capital, city, battle,
castle, birthplace, member, stadium) — but a formal designation like "World Heritage Site" is
NOT generic, include it.

Also give a short query_role noun for what gets plotted.

Return ONLY raw JSON: {"query_role":"<noun>","anchors":["Name", ...]}

Examples:
"Birthplaces of Katseye members" -> {"query_role":"birthplace","anchors":["Katseye"]}
"South American capitals" -> {"query_role":"capital","anchors":["South America"]}
"Filming locations of Game of Thrones" -> {"query_role":"filming location","anchors":["Game of Thrones"]}
"Castles in Wales" -> {"query_role":"castle","anchors":["Wales"]}
"World War I battles" -> {"query_role":"battle","anchors":["World War I"]}
"UNESCO World Heritage Sites in Italy" -> {"query_role":"site","anchors":["World Heritage Site","Italy"]}

Query: <query>${query}</query>`

  const raw = await callClaude(apiKey, model, prompt, 300)
  // A malformed plan must not kill the request: degrade to no anchors (the builder can still
  // discover the schema, just without pre-resolved QIDs) rather than throwing a 500.
  let parsed: { query_role?: string; anchors?: unknown } = {}
  try {
    parsed = parseJsonResponse(raw) as { query_role?: string; anchors?: unknown }
  } catch {
    console.warn(`[structured] planQuery JSON unparseable; proceeding with no anchors`)
  }
  const anchors = Array.isArray(parsed?.anchors)
    ? parsed.anchors.filter((a): a is string => typeof a === 'string').map(a => a.trim()).filter(Boolean)
    : []
  return { query_role: parsed?.query_role?.trim() || 'location', anchors }
}

// Step 2 — resolve each anchor to its candidate Wikidata IDs, formatted for the writer.
async function resolveAnchors(anchors: string[]): Promise<string> {
  const blocks: string[] = []
  for (const name of anchors) {
    const cands = await searchEntities(name, 6)
    if (!cands.length) continue
    const lines = cands
      .map(c => `    wd:${c.id} — ${c.label}${c.description ? ` — ${c.description}` : ''}`)
      .join('\n')
    blocks.push(`- "${name}":\n${lines}`)
  }
  if (!blocks.length) return ''
  return `RESOLVED ENTITIES — these are the ONLY correct Wikidata IDs for the named entities in
the query. Pick the candidate that best fits the query context, and use its exact QID. NEVER
invent or guess a QID for these names:
${blocks.join('\n')}
`
}

// Orchestrate: plan (extract anchors) → resolve anchors to QIDs → schema-discovery builder.
// Step 3 is no longer a single-shot writer with worked examples; the agent reads Wikidata's
// schema and tests its draft before answering (PID R9, lib/builder.ts).
async function generateSparql(
  query: string,
  apiKey: string,
  model: string,
  onProgress: ProgressFn = NO_PROGRESS,
): Promise<{ query_role: string; sparql: string; anchors: string[]; steps: AgentStep[]; converged: boolean; resolvedBlock: string; expectations: Promise<Expectations> }> {
  onProgress('Planning the query…')
  const { query_role, anchors } = await planQuery(query, apiKey, model)
  // Prefetch the verifier's expectations now (depends only on query + role) so the LLM call
  // overlaps the long builder loop instead of running sequentially after it. Resolved later, in
  // verify; reused across the original + repair passes. Swallow errors → a null expectation just
  // makes the type/cardinality checks inconclusive, never a crash.
  const expectations = deriveExpectations(query, query_role, apiKey, model).catch(
    (): Expectations => ({ where_class: null, why_class: null, expected_min: null, expected_max: null }),
  )
  if (anchors.length) onProgress(`Resolving ${anchors.join(', ')}…`)
  const resolvedBlock = await resolveAnchors(anchors)
  onProgress('Discovering the Wikidata schema…')
  const { sparql, steps, converged } = await buildSparql(query, query_role, resolvedBlock, apiKey, model, { onProgress })
  return { query_role, sparql, anchors, steps, converged, resolvedBlock, expectations }
}

// Repair triggers (PID R10 → R9): only worth a second agent loop (≈6 more LLM calls) when the
// result is structurally wrong — over/under cardinality, or a large share demoted. Minor demotions
// and inconclusive type-checks are not worth the latency.
function repairWorthy(r: VerificationReport): boolean {
  const c = r.cardinality
  // A wrong query usually shows up as a high demote share — always worth a repair.
  if (c.total > 0 && r.demoted / c.total > 0.3) return true
  if (c.verdict === 'over') return true
  if (c.verdict === 'under') {
    // Repair a SEVERE under-gap (a too-narrow membership path — e.g. the designation case, ~8 vs
    // ~55, far below the floor → still repairs) but SKIP a mild near-miss with no demotions: when
    // we already returned ≥70% of the expected floor and nothing looked wrong, a second loop
    // rarely recovers the tail and just doubles the cost (typical of a subjective query that found
    // a few valid rows).
    if (r.demoted > 0) return true
    if (c.expected_min != null && c.structural >= c.expected_min * 0.7) return false
    return true
  }
  return false
}

// Is the repaired result better than the original? Prefer a stronger status, then fewer
// demotions, then a cardinality that lands in range. Never adopt a near-empty result.
function rank(s: VerificationReport['status']): number {
  return s === 'verified' ? 2 : s === 'inconclusive' ? 1 : 0
}
function isBetter(repaired: VerificationReport, original: VerificationReport): boolean {
  if (repaired.cardinality.structural === 0) return false
  if (rank(repaired.status) !== rank(original.status)) return rank(repaired.status) > rank(original.status)
  // Same status → prefer MORE confirmed answers (never trade away recall for a cleaner-looking
  // smaller set), then fewer demotions, then a cardinality that lands in range.
  if (repaired.cardinality.structural !== original.cardinality.structural)
    return repaired.cardinality.structural > original.cardinality.structural
  if (repaired.demoted !== original.demoted) return repaired.demoted < original.demoted
  const card = (r: VerificationReport) => (r.cardinality.verdict === 'ok' ? 1 : 0)
  return card(repaired) > card(original)
}

interface PipelineResult {
  nodes: Node[]
  unresolved: Unresolved[]
  meta: {
    query_role: string
    sparql: string
    rows: number
    tiers: Record<string, number>
    enumerator: 'structured' | 'asserted'
    error?: string
    verification: VerificationReport | null
    repaired: boolean
    builder: { steps: number; converged: boolean; trace: Array<{ tool: string; thought?: string }> }
    verifyMs?: number
    rollup?: { collapsed: number }
    usage?: Usage & { costUsd: number }
    cached?: boolean
  }
}

// Wrap the pipeline in a usage context, log the per-query token/cost summary, and attach it to
// meta. Both endpoints go through this.
async function runTracked(query: string, model: string, apiKey: string, onProgress: ProgressFn): Promise<PipelineResult> {
  const { result, usage } = await runWithUsage(() => runStructuredPipeline(query, model, apiKey, onProgress))
  console.log(`[usage] "${query}" → ${formatUsage(model, usage)}`)
  result.meta.usage = { ...usage, costUsd: estimateCostUsd(model, usage) }
  return result
}

function validate(req: Request, res: Response): { query: string; model: string; apiKey: string } | null {
  const { query, model } = req.body as { query: unknown; model: unknown }
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) { res.status(401).json({ error: 'Missing API key' }); return null }
  if (typeof query !== 'string' || !query.trim() || typeof model !== 'string') {
    res.status(400).json({ error: 'Missing or invalid query or model' }); return null
  }
  if (!VALID_MODELS.has(model)) { res.status(400).json({ error: 'Invalid model' }); return null }
  return { query, model, apiKey }
}

// The full structured pipeline (PID §5), emitting live progress. Shared by the JSON and the
// streaming endpoints. Never throws on builder non-convergence — degrades to asserted.
async function runStructuredPipeline(
  query: string,
  model: string,
  apiKey: string,
  onProgress: ProgressFn,
): Promise<PipelineResult> {
  const { query_role, sparql, anchors, steps, converged, resolvedBlock, expectations } = await generateSparql(query, apiKey, model, onProgress)
  console.log(`[structured] query="${query}" role="${query_role}" anchors=${JSON.stringify(anchors)}`)
  console.log(`[structured] builder: ${steps.length} steps, converged=${converged}`)
  for (const s of steps) console.log(`[structured]   · ${s.tool}${s.thought ? ` — ${s.thought}` : ''}`)
  console.log(`[structured] sparql: ${sparql}`)

  let bindings: Awaited<ReturnType<typeof runSparql>> = []
  let sparqlError: string | undefined
  // Empty sparql == the builder didn't converge; leave bindings empty so the asserted
  // fallback below handles it (graceful degradation, never a 500).
  if (sparql) {
    onProgress('Querying Wikidata…')
    try {
      bindings = await runSparql(sparql)
    } catch (err) {
      if (err instanceof SparqlError) {
        console.error(`[structured] WDQS error ${err.status}: ${err.detail}`)
        // Honest, distinct message: a system-wide throttle ("Wikidata is busy") vs this one query
        // being too heavy. The passive detector (wdqsThrottled) tells them apart — both used to look
        // like the same cryptic 408. Shown to the user only when nothing came back (client-side).
        sparqlError = wdqsThrottled()
          ? 'Wikidata is rate-limiting us right now — please try again in a moment.'
          : 'That query was too broad or complex for Wikidata to answer in time. Try narrowing or rephrasing it.'
      } else {
        throw err
      }
    }
  }

  // Collapse over-collection (PID R10 result shaping): when a serial/transnational listing is
  // returned alongside its P361 sub-components, fold the children into the parent so one listing
  // is one pin. Self-gating — only fires when a result's part-of parent is itself in the set.
  let collapsed = 0
  if (bindings.length) {
    const rolled = await collapseSubcomponents(bindings)
    if (rolled.collapsed) {
      console.log(`[structured] rollup: collapsed ${rolled.collapsed} sub-components (${bindings.length}→${rolled.bindings.length})`)
      onProgress(`Collapsing ${rolled.collapsed} sub-components…`)
      bindings = rolled.bindings
      collapsed = rolled.collapsed
    }
  }

  // Off-Earth exclusion (see verify.ts offEarthEntities): a class-only match (volcano, crater,
  // sea, ...) can pull in a namesake feature on another world, which still carries a real
  // Wikidata coordinate — just not one that means anything on this app's Earth map. Filtered
  // BEFORE verify, same reasoning as rollup: don't spend the verification+geocode budget on a
  // result that can never be a valid node, and don't let it inflate the cardinality count either.
  const offEarthUnresolved: Unresolved[] = []
  if (bindings.length) {
    const whereQids = [...new Set(bindings.map(b => uriToQid(b.where?.value)).filter((q): q is string => !!q))]
    const offEarth = await offEarthEntities(whereQids)
    if (offEarth.size) {
      const removedNames = new Map<string, string>()
      for (const b of bindings) {
        const qid = uriToQid(b.where?.value)
        if (qid && offEarth.has(qid) && !removedNames.has(qid)) removedNames.set(qid, b.whereLabel?.value ?? qid)
      }
      console.log(`[structured] excluded ${offEarth.size} off-Earth entities: ${[...removedNames.values()].join(', ')}`)
      for (const name of removedNames.values()) offEarthUnresolved.push({ name, reason: 'off-Earth (located on another astronomical body, not a valid Earth-map result)' })
      bindings = bindings.filter(b => {
        const qid = uriToQid(b.where?.value)
        return !(qid && offEarth.has(qid))
      })
    }
  }

  let nodes: Node[]
  let unresolved: Unresolved[]
  let enumerator: 'structured' | 'asserted'
  let verification: VerificationReport | null = null
  let finalSparql = sparql
  let finalRows = bindings.length
  let repaired = false
  let verifyMs = 0

  if (bindings.length === 0) {
    // Wikidata expressed/found nothing → the MODEL proposes the set (PID R2), but WIKIDATA still
    // grounds where each one is: resolve each candidate to its entity + coordinate, then guard the
    // cluster. Membership stays asserted; the coordinate is `geocoded` (the name resolution is a
    // best-effort match, not context-verified — PID R3), so every pin is visibly unverified (R6).
    onProgress('Building from model knowledge…')
    enumerator = 'asserted'
    const candidates = await modelEnumerate(query, query_role, apiKey, model)
    onProgress('Grounding places in Wikidata…')
    const { located, pending } = await resolveCandidates(candidates, query_role)
    // Asserted-specific guard: no SPARQL-verified core here, so every name-resolved pin is guarded
    // against the cluster's own region (catches same-name mis-resolutions). See fallback.ts.
    const r = await locateAndGuardAsserted(located, pending, query, apiKey, model)
    nodes = r.nodes
    unresolved = r.unresolved
  } else {
    enumerator = 'structured'

    // Verification gate (PID R10) runs on the BINDINGS first — before the expensive geocode
    // ladder — so a repair can swap the query without paying to locate a doomed result set.
    onProgress('Verifying results…')
    const exp = await expectations // prefetched during the build (no extra wait here)
    const tVerify = Date.now()
    let { demote, report } = await verifyStructured(bindings, query, query_role, apiKey, model, exp)
    verifyMs = Date.now() - tVerify
    let chosenBindings = bindings

    // Failed gate → one bounded repair fed back into the R9 builder (PID R10 → R9).
    if (repairWorthy(report)) {
      console.log(`[structured] verify flagged → repair: ${report.notes.join(' | ')}`)
      onProgress('Repairing the query…')
      try {
        const rep = await buildSparql(query, query_role, resolvedBlock, apiKey, model, {
          maxSteps: 6,
          repair: { priorSparql: sparql, findings: report.notes },
          onProgress,
        })
        let repBindings = await runSparql(rep.sparql)
        // A widened repair (e.g. P31=<class> → P1435 designation) often re-introduces
        // over-collection; collapse it the same way before verifying/comparing so the verdict
        // and the kept result are both on the rolled-up set.
        let repCollapsed = 0
        if (repBindings.length) {
          const rolledRep = await collapseSubcomponents(repBindings)
          if (rolledRep.collapsed) {
            console.log(`[structured] rollup (repair): collapsed ${rolledRep.collapsed} (${repBindings.length}→${rolledRep.bindings.length})`)
            repBindings = rolledRep.bindings
            repCollapsed = rolledRep.collapsed
          }
        }
        if (repBindings.length) {
          const tVerify2 = Date.now()
          const v2 = await verifyStructured(repBindings, query, query_role, apiKey, model, exp)
          verifyMs += Date.now() - tVerify2
          if (isBetter(v2.report, report)) {
            console.log(`[structured] repair adopted (${report.status}→${v2.report.status}, rows ${bindings.length}→${repBindings.length})`)
            chosenBindings = repBindings
            collapsed = repCollapsed // adopted repair's bindings → its roll-up count is the one that applies
            demote = v2.demote
            report = v2.report
            finalSparql = rep.sparql
            finalRows = repBindings.length
            repaired = true
          } else {
            console.log(`[structured] repair rejected (not better); keeping original`)
          }
        }
      } catch (e) {
        console.error('[structured] repair failed:', e instanceof Error ? e.message : e)
      }
    }

    // Set-level over-collection distrust (PID R10 hardening). Repair (above) already had its
    // shot at fixing an over-broad query; if the surviving verdict is STILL 'over', per-row
    // checks can't catch the rest — every row can be a genuine instance of the class the builder
    // queried on (a real "human settlement in Italy"), just the wrong SCOPE for the actual
    // request (there's no Wikidata property for "romantic"). Demote the whole survivor set to
    // asserted rather than let a query this far outside its own expected range wear a
    // `structural` badge — never dropped (R5), just honestly downgraded (R6/R8).
    if (report.cardinality.verdict === 'over') {
      const overReason = `set-level over-collection: ${report.cardinality.structural} results vs an expected ~${report.cardinality.expected_min}-${report.cardinality.expected_max} (query likely too broad)`
      const seen = new Set<string>()
      let freshlyDemoted = 0
      for (const b of chosenBindings) {
        const wUri = b.where?.value
        if (wUri && !seen.has(wUri)) {
          seen.add(wUri)
          if (!demote.has(wUri)) { demote.set(wUri, overReason); freshlyDemoted++ }
        }
      }
      // report.demoted was snapshotted inside verifyStructured before this block ran — update it
      // so the returned/logged report reflects what ACTUALLY happened to the nodes, not a stale
      // pre-demotion count (a `flagged` status with a "demoted: 0" count is misleading, even
      // though the per-node membership_tier was already correctly set).
      if (freshlyDemoted) {
        report = { ...report, demoted: report.demoted + freshlyDemoted, notes: [...report.notes, `all ${demote.size} surviving results demoted to asserted membership (persistent over-collection, repair did not resolve it)`] }
      }
    }

    onProgress('Locating places…')
    // Location ladder (structural → geocode → context-model) + envelope guard (PID R4) — the same
    // stage the asserted path uses, so every pin in Orbis is grounded the same way.
    const { located, pending } = bindingsToNodes(chosenBindings, query_role)
    const r = await locateAndGuard(located, pending, query, apiKey, model)
    nodes = r.nodes
    unresolved = r.unresolved
    verification = report

    // Demote non-conforming nodes' membership to `asserted` (loud, never dropped; R8/R10).
    if (demote.size) {
      for (const n of nodes) {
        const reason = n.where.entity ? demote.get(n.where.entity) : undefined
        if (!reason) continue
        if (n.why.length) {
          for (const w of n.why) w.membership_tier = 'asserted'
        } else {
          // Case-(a) node (the located thing is itself the answer, no ?why). Attach a
          // synthetic asserted attribution so the flag is visible per node (R6).
          n.why.push({ label: `Unverified: ${reason}`, why_url: null, membership_tier: 'asserted' })
        }
      }
    }
  }

  if (offEarthUnresolved.length) unresolved = [...unresolved, ...offEarthUnresolved]

  // Guarantee human-readable pin names even if the generated SPARQL omitted ?whereLabel.
  await backfillLabels(nodes)

  const tiers = nodes.reduce<Record<string, number>>((a, n) => {
    a[n.where.coord_tier] = (a[n.where.coord_tier] ?? 0) + 1
    return a
  }, {})
  console.log(
    `[structured] rows=${finalRows} enumerator=${enumerator} nodes=${nodes.length} repaired=${repaired} ` +
      `tiers=${JSON.stringify(tiers)} unresolved=${unresolved.length}` +
      (verification ? ` verify=${verification.status} demoted=${verification.demoted}` : '') +
      (verifyMs ? ` verifyMs=${verifyMs}` : ''),
  )
  if (verification?.notes.length) {
    for (const note of verification.notes) console.log(`[structured]   verify: ${note}`)
  }

  return {
    nodes,
    unresolved,
    meta: {
      query_role,
      sparql: finalSparql,
      rows: finalRows,
      tiers,
      enumerator,
      error: sparqlError,
      verification,
      repaired,
      builder: { steps: steps.length, converged, trace: steps.map(s => ({ tool: s.tool, thought: s.thought })) },
      ...(verifyMs ? { verifyMs } : {}),
      ...(collapsed ? { rollup: { collapsed } } : {}),
    },
  }
}

// POST /api/structured — query → structured nodes + unresolved report (PID section 5).
router.post('/', async (req: Request, res: Response) => {
  const v = validate(req, res)
  if (!v) return
  const cached = getCached(v.query, v.model)
  if (cached) {
    console.log(`[cache] HIT "${v.query}" — served free`)
    return res.json(cached)
  }
  try {
    const result = await runTracked(v.query, v.model, v.apiKey, NO_PROGRESS)
    setCached(v.query, v.model, result)
    return res.json(result)
  } catch (err) {
    console.error('[structured] error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Structured query failed' })
  }
})

// POST /api/structured/stream — same pipeline, streamed as NDJSON lines:
//   {"type":"progress","message":...}  …then…  {"type":"result", nodes, unresolved, meta}  | {"type":"error", error}
router.post('/stream', async (req: Request, res: Response) => {
  const v = validate(req, res)
  if (!v) return
  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const emit = (obj: unknown) => res.write(JSON.stringify(obj) + '\n')
  const cached = getCached(v.query, v.model)
  if (cached) {
    console.log(`[cache] HIT "${v.query}" — served free`)
    emit({ type: 'progress', message: 'Loaded from cache' })
    emit({ type: 'result', ...cached })
    return res.end()
  }
  try {
    const result = await runTracked(v.query, v.model, v.apiKey, msg => emit({ type: 'progress', message: msg }))
    setCached(v.query, v.model, result)
    emit({ type: 'result', ...result })
  } catch (err) {
    console.error('[structured/stream] error:', err)
    emit({ type: 'error', error: err instanceof Error ? err.message : 'Structured query failed' })
  }
  res.end()
})

export default router
