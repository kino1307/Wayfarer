// PID R10 (result shaping) — collapse sub-components to their parent listing.
//
// Some Wikidata queries over-return: a serial/transnational site (a UNESCO World
// Heritage listing, a national park made of separate units, a polyptych split into
// panels) is modelled as one PARENT entity plus dozens of CHILD entities, each child
// linked to the parent by P361 (part of) and each carrying the same defining property
// the query matched on. "UNESCO sites in Italy" then returns 284 pins instead of ~60.
//
// The fix is general and self-gating: drop any result whose P361 parent is ALSO in the
// result set. For independent results (castles, capitals) no such internal part-of links
// exist, so nothing is dropped — the rule only ever fires on genuine parent/child sets.

import { runSparql, type SparqlBinding } from './wikidata.js'

const lastSeg = (uri: string): string => uri.split('/').pop() ?? uri
const BATCH = 200
// Below this, over-collection isn't a concern and a Wikidata roundtrip isn't worth it.
const MIN_RESULTS = 8

export interface RollupResult {
  bindings: SparqlBinding[]
  collapsed: number // how many sub-component rows were folded into their parents
}

// Fetch the P361 (part of) edges among a set of QIDs, in batches.
async function partOfEdges(qids: string[]): Promise<Array<[string, string]>> {
  const edges: Array<[string, string]> = []
  for (let i = 0; i < qids.length; i += BATCH) {
    const vals = qids.slice(i, i + BATCH).map(q => `wd:${q}`).join(' ')
    const q = `SELECT ?w ?parent WHERE { VALUES ?w {${vals}} ?w wdt:P361 ?parent }`
    const rows = await runSparql(q)
    for (const r of rows) {
      const w = r.w?.value, parent = r.parent?.value
      if (w && parent) edges.push([lastSeg(w), lastSeg(parent)])
    }
  }
  return edges
}

// Drop every binding whose ?where entity is `part of` another ?where entity in the set.
export async function collapseSubcomponents(bindings: SparqlBinding[]): Promise<RollupResult> {
  const qids = new Set<string>()
  for (const b of bindings) {
    const uri = b.where?.value
    if (uri) qids.add(lastSeg(uri))
  }
  if (qids.size < MIN_RESULTS) return { bindings, collapsed: 0 }

  let edges: Array<[string, string]>
  try {
    edges = await partOfEdges([...qids])
  } catch {
    // Roll-up is best-effort; never fail the pipeline over it.
    return { bindings, collapsed: 0 }
  }

  const drop = new Set<string>()
  for (const [child, parent] of edges) {
    if (qids.has(parent)) drop.add(child)
  }
  if (!drop.size) return { bindings, collapsed: 0 }

  const kept = bindings.filter(b => {
    const uri = b.where?.value
    return !uri || !drop.has(lastSeg(uri))
  })
  return { bindings: kept, collapsed: drop.size }
}
