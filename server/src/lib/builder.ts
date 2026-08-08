// PID R9 — the schema-discovery SPARQL builder. Replaces the old single-shot writer that
// carried a fixed set of worked examples (which generalised only to anticipated shapes).
// Here the model is given TOOLS to read Wikidata's schema at query time and must TEST its
// draft against the live endpoint before submitting. A bounded ReAct loop: the model emits
// one JSON action per turn (search / probe / test / answer); we execute it and feed back the
// observation. Provider-portable (plain text + JSON, no vendor tool API) so a later LLM swap
// (Stage 5) is contained.

import { callClaudeMessages, parseJsonResponse, type ChatMessage } from './anthropic.js'
import { searchProperty, searchEntity, probeClass, probeEntity, testSparql, TEST_TIMEOUT_MS } from './schema.js'

const MAX_STEPS = 11

// The builder must not silently cap recall. If the query didn't ask for a limit, strip a stray
// trailing LIMIT the agent sometimes adds (PID: enumeration is complete; recall is owned here).
// Only a TOP-LEVEL trailing LIMIT is removed — subquery LIMITs (inside braces) are untouched.
//
// "Limit-bearing" must mean an explicit COUNT request ("top 5", "first 10", "3 largest", "nearest",
// "single"). A bare digit is NOT enough: "World War 2" / "Group of 7 capitals" contain a number but
// ask for the COMPLETE set, and the old `\d+` rule wrongly suppressed stripping for them, letting a
// stray LIMIT silently cap recall. When in doubt we strip (completeness is the contract).
export function impliesLimit(query: string): boolean {
  return (
    /\b(top|first)\s+\d+\b/i.test(query) ||
    /\b\d+\s+(largest|biggest|smallest|tallest|highest|longest|nearest|closest|oldest|newest|most|best)\b/i.test(query) ||
    /\b(nearest|closest|single)\b/i.test(query)
  )
}
function stripStrayLimit(query: string, sparql: string): string {
  if (!sparql || impliesLimit(query)) return sparql
  const stripped = sparql.replace(/\s+limit\s+\d+\s*$/i, '')
  if (stripped !== sparql) console.log('[builder] stripped a stray LIMIT (query did not request one)')
  return stripped
}

// The model occasionally wraps its JSON action in prose. Recover by extracting the first
// balanced {...} object before parsing.
function parseAction(raw: string): { tool?: string; thought?: string; args?: Record<string, unknown> } | null {
  try {
    return parseJsonResponse(raw) as { tool?: string; thought?: string; args?: Record<string, unknown> }
  } catch {
    const start = raw.indexOf('{')
    if (start === -1) return null
    let depth = 0
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++
      else if (raw[i] === '}' && --depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
    return null
  }
}

const SYSTEM = `You are a Wikidata SPARQL engineer. Build and TEST one query that answers a map
request. Wikidata must enumerate the answer — discover the needed properties/classes with the
tools, never guess a P/Q id you can look up, never submit an untested query.

VARIABLE CONTRACT — bind these exact names and your SELECT must LIST them (labels come from the
label service but are only returned if selected, else pins show raw QIDs):
  SELECT DISTINCT ?where ?whereLabel ?coord ?whereArticle ?why ?whyLabel ?whyArticle
- ?where  the place to plot (city/town/venue/building/site) — always an entity, never a coord literal
- ?coord  OPTIONAL { ?where wdt:P625 ?coord }
- ?whereArticle  OPTIONAL { ?whereArticle schema:about ?where ; schema:isPartOf <https://en.wikipedia.org/> }
- ?why    the entity that makes ?where relevant (the country a capital belongs to; the member whose
          birthplace this is) — ALWAYS bind it when one exists, never as a throwaway helper var; OMIT
          only for intrinsically-located things (battles, monuments)
- ?whyArticle  OPTIONAL { ?whyArticle schema:about ?why ; schema:isPartOf <https://en.wikipedia.org/> }
End the WHERE block with: SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
Keep ?coord and the article binds OPTIONAL (missing data is reported, not dropped). No LIMIT unless
the request explicitly asks for one.

LINKAGE HINTS (confirm by probing one example, don't assume): place→country P17; place→region/continent
P30 or transitive P131*; country→capital P36; group→members P527; person→birthplace P19; place↔language:
official language P37, language used P2936 (NOT P1412 — that is a PERSON's languages) — query from the
language side (?place wdt:P37|wdt:P2936 wd:<lang>), and if a direct match is sparse the official form may
be a specific standardised variety, so probe the language item for a related "standard form"; "countries" =
sovereign state (Q3624078). Don't hand-filter historical/sub-national noise — a verifier catches
wrong-type rows; focus on correct linkage and real rows.

DESIGNATION TRAP (World Heritage Site, national monument, Ramsar site, listed building, protected area,
award winners, …): items are typed by their PHYSICAL KIND (a church, a town, an archaeological area), so
\`?x wdt:P31 wd:<designation>\` matches almost none and silently under-collects. Membership lives on a
STATUS/DESIGNATION property — heritage designation P1435, or a dedicated identifier the listing assigns
(e.g. a World Heritage Site ID) — NOT on P31. If a P31=<designation> draft returns suspiciously few rows,
probe a KNOWN listed example (probe_entity) to find the real designation/ID property and switch to it.

TOOLS — reply with EXACTLY ONE JSON object, nothing else. Keep "thought" to a SHORT phrase
(≤8 words), never sentences — verbose thoughts waste output budget:
{"thought":"...","tool":"search_property","args":{"text":"place of birth"}}
{"thought":"...","tool":"search_entity","args":{"text":"sovereign state"}}
{"thought":"...","tool":"probe_class","args":{"qid":"Q23413"}}   (class: sample instances + common properties)
{"thought":"...","tool":"probe_entity","args":{"qid":"Q1299"}}   (a known example's statements)
{"thought":"...","tool":"test_sparql","args":{"sparql":"SELECT DISTINCT ..."}}
{"thought":"...","tool":"answer","args":{"sparql":"SELECT DISTINCT ..."}}   (only after a successful test)

STRATEGY: the entities/qualifiers above are ALREADY resolved to QIDs — use them. TEST EARLY (draft +
test_sparql by your 3rd-4th action; a rough query is fine, refine from its rows). To link results to a
geographic qualifier, probe_entity a known example and use the path it actually shows (often P131*). If
0 rows the PATH is wrong — probe and fix; NEVER drop a constraint or add a LIMIT just to get rows (a
query that ignores part of the request is wrong). You MUST test_sparql before answering, and the answer
must satisfy every part of the request.

EFFICIENCY (a slow query that times out wastes a whole step — write FAST queries from the start):
- Anchor on the MOST SELECTIVE constraint first: match the specific property that DEFINES the set
  directly (a country's P37 official language, a person's P19 birthplace) BEFORE layering on broad
  type filters. Often the defining property alone is enough and a type filter is redundant.
- A transitive \`P131*\`/\`P279*\` combined with ANOTHER unbounded pattern is the usual timeout: keep
  only ONE open-ended traversal and pin the other side to a concrete entity (e.g. constrain to the
  target region first, then expand). DO use \`P279*\` (subclass) or \`P131*\` when recall needs it —
  e.g. a class with many sub-types (castle kinds) or a deep place hierarchy — just not two unbounded
  ones at once, and prefer pinning the side that is a single known entity.
- A timeout means too broad/deep, NOT wrong — make it more selective (tighter anchor, pin one side),
  do NOT drop a required constraint or abandon the path.`

export interface AgentStep {
  tool: string
  thought?: string
  observation: string
}

export interface BuildResult {
  sparql: string
  steps: AgentStep[]
  converged: boolean // true if the model answered; false if we fell back to its last tested query
}

async function runTool(
  tool: string,
  args: Record<string, unknown>,
  testTimeoutMs: number,
): Promise<{ observation: string; rows?: number | null }> {
  const text = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  switch (tool) {
    case 'search_property':
      return { observation: await searchProperty(text('text')) }
    case 'search_entity':
      return { observation: await searchEntity(text('text')) }
    case 'probe_class':
      return { observation: await probeClass(text('qid')) }
    case 'probe_entity':
      return { observation: await probeEntity(text('qid')) }
    case 'test_sparql': {
      const r = await testSparql(text('sparql'), testTimeoutMs)
      return { observation: r.observation, rows: r.rows }
    }
    default:
      return { observation: `unknown tool "${tool}"` }
  }
}

export interface BuildOptions {
  maxSteps?: number
  // Repair mode (PID R10 → R9): a prior query the verifier flagged, plus what it flagged.
  repair?: { priorSparql: string; findings: string[] }
  // Live progress for the UI stream — a friendly label per agent action.
  onProgress?: (message: string) => void
}

// Friendly progress labels for each agent tool (UI streaming).
const TOOL_LABEL: Record<string, string> = {
  search_property: 'Looking up Wikidata properties…',
  search_entity: 'Resolving entities…',
  probe_class: 'Inspecting how the data is modelled…',
  probe_entity: 'Inspecting a known example…',
  test_sparql: 'Testing the query against Wikidata…',
  answer: 'Query ready',
}

export async function buildSparql(
  query: string,
  queryRole: string,
  resolvedBlock: string,
  apiKey: string,
  model: string,
  opts: BuildOptions = {},
): Promise<BuildResult> {
  const maxSteps = opts.maxSteps ?? MAX_STEPS
  const recallGap = !!opts.repair?.findings.some(f => /recall gap|below the expected|too few/i.test(f))
  const opener = opts.repair
    ? `Map request: "${query}"  (plotting: ${queryRole})\n` +
      (resolvedBlock ? `${resolvedBlock}\n` : '') +
      `A PREVIOUS query was tried and the verifier flagged its results:\n` +
      opts.repair.findings.map(f => `- ${f}`).join('\n') +
      `\nPRIOR QUERY:\n${opts.repair.priorSparql}\n` +
      `Diagnose the cause (wrong property path, missing or over-broad constraint, wrong class — ` +
      `probe the schema to check), then build and TEST a corrected query that resolves the flags ` +
      `while keeping every part of the request.` +
      (recallGap
        ? ` Too FEW rows means the membership filter is too narrow — do NOT just re-run a near-identical ` +
          `query. If you matched membership with P31=<class> (e.g. a designation like World Heritage ` +
          `Site), that is the designation trap: switch to the status/designation property (P1435) or the ` +
          `listing's identifier and re-test for a fuller result.`
        : ``) +
      ` Begin with one JSON action.`
    : `Map request: "${query}"  (plotting: ${queryRole})\n` +
      (resolvedBlock ? `${resolvedBlock}\n` : '') +
      `Discover the schema, build and TEST the SPARQL, then answer. Begin with one JSON action.`
  const messages: ChatMessage[] = [{ role: 'user', content: opener }]

  const steps: AgentStep[] = []
  let lastTested: string | null = null
  let lastTestedRows = -1
  let everTested = false
  let llmMsTotal = 0
  let toolMsTotal = 0
  const logTiming = () =>
    console.log(`[builder] timing: llm=${(llmMsTotal / 1000).toFixed(1)}s tool=${(toolMsTotal / 1000).toFixed(1)}s over ${steps.length} steps`)

  for (let i = 0; i < maxSteps; i++) {
    const tLlm = Date.now()
    const raw = await callClaudeMessages(apiKey, model, SYSTEM, messages, 1500, true)
    llmMsTotal += Date.now() - tLlm
    const action = parseAction(raw)
    if (!action) {
      console.log(`[builder] step${i}: unparseable response: ${raw.slice(0, 160).replace(/\s+/g, ' ')}`)
      messages.push({ role: 'assistant', content: raw.slice(0, 300) })
      messages.push({ role: 'user', content: 'That was not valid JSON. Reply with exactly ONE JSON action object.' })
      continue
    }
    messages.push({ role: 'assistant', content: JSON.stringify(action) })
    const tool = action.tool ?? ''
    console.log(`[builder] step${i}: ${tool} — ${(action.thought ?? '').slice(0, 80)}`)
    opts.onProgress?.((opts.repair ? 'Repairing — ' : '') + (TOOL_LABEL[tool] ?? 'Working…'))

    if (tool === 'answer') {
      const sparql = typeof action.args?.sparql === 'string' ? (action.args.sparql as string).trim() : ''
      if (!sparql || !sparql.includes('?where')) {
        messages.push({ role: 'user', content: 'answer needs args.sparql binding ?where. Keep going.' })
        continue
      }
      if (!everTested) {
        messages.push({ role: 'user', content: 'You must test_sparql before answering. Test this query first.' })
        continue
      }
      steps.push({ tool, thought: action.thought, observation: 'answered' })
      logTiming()
      return { sparql: stripStrayLimit(query, sparql), steps, converged: true }
    }

    const tTool = Date.now()
    const { observation, rows } = await runTool(tool, action.args ?? {}, TEST_TIMEOUT_MS)
    toolMsTotal += Date.now() - tTool
    steps.push({ tool, thought: action.thought, observation })
    if (tool === 'test_sparql') {
      // Only a test that actually EXECUTED (rows != null; 0 rows still counts) satisfies the
      // "must test before answering" gate. A test that ERRORED (syntax/timeout → rows=null) must
      // not let the agent answer an untested-successfully query.
      if (rows != null) everTested = true
      console.log(`[builder]   test → rows=${rows} (${((Date.now() - tTool) / 1000).toFixed(1)}s)`)
      opts.onProgress?.(rows != null ? `Query returned ${rows} rows — refining…` : 'Query errored — fixing…')
      if (rows != null && rows >= 0 && (rows > 0 || lastTestedRows < 0)) {
        // Prefer the most recent query that actually returned rows; else keep any tested one.
        lastTested = typeof action.args?.sparql === 'string' ? (action.args.sparql as string).trim() : lastTested
        lastTestedRows = rows
      }
    }

    // Budget pressure (cost-tail control): the ONLY safe nudge is "stop exploring WITHOUT testing".
    // Pushing the agent to ANSWER once it had rows made it ship an incomplete query (Castles
    // 789→20: it shipped a 10-row partial path instead of finding P131*), so that nudge is gone.
    // We cut pre-test wandering; post-test refinement is left to the agent's judgement.
    let pressure = ''
    if (!everTested && i >= 4) {
      pressure = '\n\n[budget] Several steps used with no test. Draft your best query and call test_sparql NOW — refine from real rows, do not keep exploring.'
    }
    messages.push({ role: 'user', content: `Observation (${tool}):\n${observation.slice(0, 900)}${pressure}` })
  }
  logTiming()

  // Non-convergence: one last forced attempt to get a final query out of the model, then fall
  // back to the best query we actually tested. Only fail hard if nothing testable ever emerged.
  if (!lastTested) {
    const raw = await callClaudeMessages(
      apiKey,
      model,
      SYSTEM,
      [...messages, { role: 'user', content: 'Stop exploring. Output your best final query now as {"tool":"answer","args":{"sparql":"..."}}.' }],
      1500,
      true,
    )
    const action = parseAction(raw)
    const sparql = typeof action?.args?.sparql === 'string' ? (action.args.sparql as string).trim() : ''
    if (sparql.includes('?where')) {
      steps.push({ tool: 'answer', thought: 'forced final', observation: 'answered (forced)' })
      return { sparql: stripStrayLimit(query, sparql), steps, converged: false }
    }
  }
  if (lastTested && lastTested.includes('?where')) {
    console.log(`[builder] non-convergence; using last tested query (rows=${lastTestedRows})`)
    return { sparql: stripStrayLimit(query, lastTested), steps, converged: false }
  }
  // No usable query at all → return empty rather than throwing, so the route degrades to the
  // asserted model-enumeration fallback (R2/R6) instead of hard-failing the request.
  console.log('[builder] non-convergence; no usable query — handing off to asserted fallback')
  return { sparql: '', steps, converged: false }
}
