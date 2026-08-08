// PID R9 — the schema-discovery toolset. The "expertise" the SPARQL builder needs lives in
// Wikidata, not in a prompt full of examples. These tools let the agent READ that schema at
// query time: resolve the properties/classes a query needs, see how the relevant entities
// are actually modelled, and test a draft against the live endpoint before committing it.
// Each returns a compact, token-bounded observation string for the agent transcript.

import { runSparql, searchEntities, searchProperties, SparqlError, type SparqlBinding } from './wikidata.js'

// Probe queries (sample instances / a known entity's statements) are bounded by construction
// (LIMIT in the query), so a moderate cap is safe and just backstops a hung request.
const PROBE_TIMEOUT_MS = 20_000
// test_sparql timeout. This is a deliberate, measured choice, NOT an obvious one:
//   • A SHORT cap makes broad/wrong drafts fail FAST so the agent reformulates instead of stalling on
//     WDQS's ~60s server limit — this is what fixed the reported case ("Tagalog" 339s→~25s).
//   • A LONG cap lets a legitimately-slow transitive query (P131*/P279*, "castles in Wales") finish,
//     but a flailing query (Tagalog kept drafting slow P2936/P279* variants) then costs the long cap
//     PER attempt — measured 121s of builder time, worse than short.
// We tried escalating the cap by attempt count; it backfired because "later attempt" does NOT mean
// "committed to a correct path" (Tagalog flails late; Castles commits late — indistinguishable by
// count). So: keep the SHORT cap (protects the common/reported case) and instead guide the agent, via
// the timeout message (wikidata.ts), to make a slow query MORE SELECTIVE rather than drop a constraint
// — that's the lower-risk lever for the deep-query case. The final ANSWER query keeps the 45s default.
export const TEST_TIMEOUT_MS = 12_000

const lastSeg = (uri?: string): string => (uri ? (uri.split('/').pop() ?? '') : '')
const isEntityUri = (v?: string): boolean => !!v && v.includes('/entity/')

function errText(e: unknown): string {
  return e instanceof SparqlError ? `WDQS ${e.status}: ${e.detail.slice(0, 250)}` : String(e)
}

// "place of birth" → P19, with descriptions to disambiguate (P19 place of birth vs others).
export async function searchProperty(text: string): Promise<string> {
  const hits = await searchProperties(text, 7)
  if (!hits.length) return `no properties found for "${text}"`
  return hits.map(h => `${h.id} — ${h.label}${h.description ? ` (${h.description})` : ''}`).join('\n')
}

// "sovereign state" → Q3624078. Works for classes and specific entities alike.
export async function searchEntity(text: string): Promise<string> {
  const hits = await searchEntities(text, 7)
  if (!hits.length) return `no entities found for "${text}"`
  return hits.map(h => `${h.id} — ${h.label}${h.description ? ` (${h.description})` : ''}`).join('\n')
}

// How is a CLASS modelled? Sample instances (confirms the class is right) + the properties
// its instances most commonly carry (reveals the real coordinate/relationship path).
export async function probeClass(qid: string): Promise<string> {
  if (!/^Q\d+$/.test(qid)) return `bad qid "${qid}" (expected like Q23413)`
  const sampleQ =
    `SELECT ?s ?sLabel WHERE { ?s wdt:P31 wd:${qid} . ` +
    `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 8`
  const propQ =
    `SELECT ?prop ?propLabel (COUNT(*) AS ?c) WHERE { ` +
    `{ SELECT ?s WHERE { ?s wdt:P31 wd:${qid} } LIMIT 150 } ` +
    `?s ?wdt ?o . ?prop wikibase:directClaim ?wdt . ` +
    `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ` +
    `GROUP BY ?prop ?propLabel ORDER BY DESC(?c) LIMIT 18`
  try {
    const [sRows, pRows] = await Promise.all([
      runSparql(sampleQ, { timeoutMs: PROBE_TIMEOUT_MS }),
      runSparql(propQ, { timeoutMs: PROBE_TIMEOUT_MS }),
    ])
    if (!sRows.length) return `no instances found with P31=${qid} — is it really a class?`
    const samples = sRows.map(r => `${lastSeg(r.s?.value)}(${r.sLabel?.value ?? '?'})`).join(', ')
    const props = pRows
      .map(r => `${lastSeg(r.prop?.value)} ${r.propLabel?.value ?? ''} [${r.c?.value ?? '0'}]`)
      .join('; ')
    return `sample instances: ${samples}\ncommon properties: ${props}`
  } catch (e) {
    return errText(e)
  }
}

// What does a KNOWN example entity look like? Its direct statements (property → value),
// labelled — so the agent can learn the exact property path from a concrete case.
export async function probeEntity(qid: string): Promise<string> {
  if (!/^Q\d+$/.test(qid)) return `bad qid "${qid}" (expected like Q1299)`
  const q =
    `SELECT ?prop ?propLabel ?o ?oLabel WHERE { wd:${qid} ?wdt ?o . ` +
    `?prop wikibase:directClaim ?wdt . ` +
    `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 60`
  try {
    const rows = await runSparql(q, { timeoutMs: PROBE_TIMEOUT_MS })
    if (!rows.length) return `no direct statements found for ${qid}`
    const lines = rows
      .slice(0, 30)
      .map(r => {
        const val = isEntityUri(r.o?.value) ? `${lastSeg(r.o?.value)}(${r.oLabel?.value ?? '?'})` : (r.o?.value ?? '').slice(0, 40)
        return `${lastSeg(r.prop?.value)} ${r.propLabel?.value ?? ''} → ${val}`
      })
      .join('; ')
    return lines
  } catch (e) {
    return errText(e)
  }
}

export interface TestResult {
  observation: string
  rows: number | null // null on error
}

// A draft test only needs to confirm the query SHAPE returns the right KIND of rows — not the full
// result set. Unbounded broad patterns (e.g. "all countries speaking X") otherwise scan to WDQS's
// ~60s limit and dominate latency. Cap exploratory tests with a sample LIMIT so they return FAST;
// the agent still distinguishes "few exact rows" from "hit the cap (broad — refine)". Aggregates
// (COUNT/GROUP BY) need the full scan to be meaningful, and an already-limited query is left as-is.
// The agent's final `answer` query is NEVER capped here — only the throwaway test observation is.
const TEST_SAMPLE_LIMIT = 300
// The Wikipedia-article OPTIONAL binds (schema:about … isPartOf en.wikipedia) are part of the OUTPUT
// contract but add a per-row sitelink join the agent doesn't need to check a draft's shape (~1s/test,
// more as rows grow). Strip them from TEST runs only — they don't affect row COUNT or the ?where/?why
// bindings (OPTIONAL never filters), and the agent's final answer query keeps them. The label SERVICE
// is left in (cheap, and gives readable names in the sample for sanity-checking).
function stripArticleBinds(sparql: string): string {
  return sparql.replace(/optional\s*\{[^{}]*schema:about[^{}]*\}/gi, '').replace(/[ \t]+\n/g, '\n')
}
function capForTest(sparql: string): { q: string; capped: boolean } {
  const s = stripArticleBinds(sparql.trim())
  if (/\blimit\s+\d+\s*$/i.test(s)) return { q: s, capped: false }
  if (/\bgroup\s+by\b/i.test(s) || /\bcount\s*\(/i.test(s)) return { q: s, capped: false }
  return { q: `${s}\nLIMIT ${TEST_SAMPLE_LIMIT}`, capped: true }
}

// Test a draft query: row count + a small sample, so the agent SEES its own result before
// committing. Errors (syntax, timeout) come back as text so the agent can repair. The caller passes
// an escalating timeout (short for early drafts, long once committed to a path) — see builder.ts.
export async function testSparql(sparql: string, timeoutMs: number = TEST_TIMEOUT_MS): Promise<TestResult> {
  const { q, capped } = capForTest(sparql)
  try {
    const rows = await runSparql(q, { timeoutMs })
    const sample = rows.slice(0, 5).map(simplify)
    // When we capped, a full hit means "≥LIMIT" — tell the agent so it reads the count correctly.
    const atCap = capped && rows.length >= TEST_SAMPLE_LIMIT
    const count = atCap ? `≥${TEST_SAMPLE_LIMIT} (sample-capped; broad result)` : String(rows.length)
    return {
      rows: rows.length,
      observation: `rows: ${count}\nsample: ${JSON.stringify(sample)}`,
    }
  } catch (e) {
    return { rows: null, observation: `ERROR — ${errText(e)}` }
  }
}

function simplify(b: SparqlBinding): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(b)) {
    const v = b[k]
    if (!v) continue
    out[k] = isEntityUri(v.value) ? lastSeg(v.value) : v.value.slice(0, 50)
  }
  return out
}
