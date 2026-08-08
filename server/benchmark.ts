// Stage 5 benchmark harness. Runs the query suite through /api/structured for one or more
// models and tabulates SPARQL outcome + verification + latency, so a provider swap is decided
// on data, not vibes (the deferred llm-provider-decision).
//
// Usage (server must be running):
//   node_modules/.bin/tsx benchmark.ts                       # default: claude haiku
//   node_modules/.bin/tsx benchmark.ts claude-haiku-4-5-20251001 groq:llama-3.3-70b-versatile
//
// Groq models need GROQ_API_KEY in ../.env; the x-api-key header always carries the Anthropic
// key (used only by claude models; harmless for groq ones).
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '../.env') })
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const API = 'http://localhost:3013/api/structured'

const SUITE = [
  'South American capitals',
  'Birthplaces of The Beatles members',
  'Castles in Wales',
  'Nuclear power stations in France',
  'Important sites of the French Revolution', // a "vibe" query — likely the asserted path
]

const MODELS = process.argv.slice(2)
if (!MODELS.length) MODELS.push('claude-haiku-4-5-20251001')

interface Row {
  model: string
  query: string
  enumerator: string
  rows: number | string
  nodes: number | string
  verify: string
  demoted: number | string
  converged: string
  repaired: string
  secs: number | string
  calls: number
  cost: number
  cacheRead: number
}

async function run(model: string, query: string): Promise<Row> {
  const t0 = Date.now()
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY },
      body: JSON.stringify({ query, model }),
    })
    const secs = +((Date.now() - t0) / 1000).toFixed(1)
    const d = (await res.json()) as any
    if (d.error) return base(model, query, secs, { enumerator: `ERR: ${String(d.error).slice(0, 40)}` })
    const m = d.meta ?? {}
    const v = m.verification
    const u = m.usage ?? {}
    return {
      model: short(model),
      query: query.slice(0, 26),
      enumerator: m.enumerator ?? '?',
      rows: m.rows ?? '?',
      nodes: (d.nodes ?? []).length,
      verify: v?.status ?? '—',
      demoted: v?.demoted ?? '—',
      converged: m.builder ? (m.builder.converged ? 'y' : 'n') : '—',
      repaired: m.repaired ? 'y' : '',
      secs,
      calls: u.calls ?? 0,
      cost: u.costUsd ?? 0,
      cacheRead: u.cacheRead ?? 0,
    }
  } catch (e) {
    return base(model, query, +((Date.now() - t0) / 1000).toFixed(1), { enumerator: `FAIL: ${String(e).slice(0, 30)}` })
  }
}

function base(model: string, query: string, secs: number, over: Partial<Row>): Row {
  return { model: short(model), query: query.slice(0, 26), enumerator: '', rows: '', nodes: '', verify: '', demoted: '', converged: '', repaired: '', secs, calls: 0, cost: 0, cacheRead: 0, ...over }
}
const short = (m: string) => m.replace('claude-', '').replace('-20251001', '').replace('groq:', 'groq/')

;(async () => {
  const rows: Row[] = []
  for (const model of MODELS) {
    console.log(`\n### ${model}`)
    for (const query of SUITE) {
      const r = await run(model, query)
      rows.push(r)
      console.log(
        `  ${r.query.padEnd(27)} ${String(r.enumerator).padEnd(11)} nodes=${String(r.nodes).padEnd(4)} verify=${String(r.verify).padEnd(12)} conv=${r.converged} rep=${r.repaired || '-'} calls=${String(r.calls).padEnd(3)} $${r.cost.toFixed(4)} cR=${r.cacheRead} ${r.secs}s`,
      )
    }
  }
  // Per-model summary.
  console.log('\n=== SUMMARY ===')
  for (const model of MODELS) {
    const mr = rows.filter(r => r.model === short(model))
    const secs = mr.map(r => (typeof r.secs === 'number' ? r.secs : 0))
    const avg = +(secs.reduce((a, b) => a + b, 0) / mr.length).toFixed(1)
    const structured = mr.filter(r => r.enumerator === 'structured').length
    const verified = mr.filter(r => r.verify === 'verified').length
    const totalCalls = mr.reduce((a, b) => a + b.calls, 0)
    const totalCost = mr.reduce((a, b) => a + b.cost, 0)
    const totalCacheRead = mr.reduce((a, b) => a + b.cacheRead, 0)
    console.log(
      `${short(model).padEnd(28)} structured ${structured}/${mr.length} | verified ${verified}/${mr.length} | ` +
        `calls ${totalCalls} | $${totalCost.toFixed(4)} total ($${(totalCost / mr.length).toFixed(4)}/q) | cacheRead ${totalCacheRead} | avg ${avg}s`,
    )
  }
})()
