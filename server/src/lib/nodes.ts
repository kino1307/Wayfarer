// The node schema (PID section 5) and the mechanical mapping from SPARQL bindings
// to nodes. The mapping inspects only fixed variable NAMES, never query content —
// so it is identical for every query shape (PID R7).

import { parsePoint, runSparql, type SparqlBinding } from './wikidata.js'

export type CoordTier = 'verified' | 'geocoded' | 'approximate'
export type MembershipTier = 'structural' | 'asserted'

export interface WhyAttribution {
  label: string
  why_url: string | null
  membership_tier: MembershipTier
}

export interface Node {
  where: {
    name: string
    lat: number
    lng: number
    entity: string | null // Wikidata entity URI
    where_url: string | null
    coord_tier: CoordTier
  }
  why: WhyAttribution[]
  query_role: string
}

export interface Unresolved {
  name: string
  reason: string
}

// A resolved entity that has no Wikidata coordinate yet — carries its full WHY context
// so the fallback locator (geocoded/approximate tiers, PID R4) can place it, and so it
// can be reported by name if every tier fails (PID R5/R6).
export interface PendingNode {
  name: string
  entity: string | null
  where_url: string | null
  why: WhyAttribution[]
  query_role: string
}

// Variable contract the generated SPARQL must follow (server maps these names):
//   ?where ?whereLabel ?coord ?whereArticle  [?why ?whyLabel ?whyArticle]
//
// Rows are grouped by the ?where entity so a place that satisfies the query for
// several reasons (e.g. London: 13 Prime Ministers) becomes ONE node with multiple
// why[] entries — the duplicate-WHERE rule (PID section 5, edge handling).
//
// Entities WITH a coordinate become located nodes (coord_tier 'verified'). Entities
// without one become PendingNodes for the fallback ladder — never silently dropped.
export function bindingsToNodes(
  bindings: SparqlBinding[],
  queryRole: string,
): { located: Node[]; pending: PendingNode[] } {
  // Group all rows by entity first, collecting coordinate (if any) and WHY attributions.
  interface Acc {
    name: string
    entity: string
    where_url: string | null
    point: { lat: number; lng: number } | null
    why: WhyAttribution[]
  }
  const byEntity = new Map<string, Acc>()

  for (const b of bindings) {
    const whereUri = b.where?.value
    if (!whereUri) continue

    let acc = byEntity.get(whereUri)
    if (!acc) {
      acc = {
        name: b.whereLabel?.value ?? whereUri,
        entity: whereUri,
        where_url: b.whereArticle?.value ?? null,
        point: null,
        why: [],
      }
      byEntity.set(whereUri, acc)
    }

    if (!acc.point && b.coord?.value) {
      acc.point = parsePoint(b.coord.value)
    }

    const whyLabel = b.whyLabel?.value
    if (whyLabel) {
      const whyUrl = b.whyArticle?.value ?? null
      const dup = acc.why.some(w => w.label === whyLabel && w.why_url === whyUrl)
      if (!dup) {
        // Membership came from a structured Wikidata relationship → structural (PID R8).
        acc.why.push({ label: whyLabel, why_url: whyUrl, membership_tier: 'structural' })
      }
    }
  }

  const located: Node[] = []
  const pending: PendingNode[] = []

  for (const acc of byEntity.values()) {
    if (acc.point) {
      located.push({
        where: {
          name: acc.name,
          lat: acc.point.lat,
          lng: acc.point.lng,
          entity: acc.entity,
          where_url: acc.where_url,
          // Coordinate came from Wikidata P625 → verified (PID R4).
          coord_tier: 'verified',
        },
        why: acc.why,
        query_role: queryRole,
      })
    } else {
      pending.push({
        name: acc.name,
        entity: acc.entity,
        where_url: acc.where_url,
        why: acc.why,
        query_role: queryRole,
      })
    }
  }

  return { located, pending }
}

// Safety net for pin names so a pin never shows a raw QID. A name is non-human-readable in two ways:
//   (a) the generated SPARQL omitted ?whereLabel → the name is left as the entity URI;
//   (b) the label service found no label in the requested languages → it echoes the bare QID string
//       (e.g. a place with only a French label comes back as "Q138205699").
// Two passes: a cheap en/mul label-service lookup for the common case, then — only for whatever it
// still couldn't name — an any-language fallback (prefer en > mul > any), so an unlabelled-in-English
// place shows its real name in some language instead of the QID. Only runs when something is missing.
const WD_ENTITY = 'http://www.wikidata.org/entity/'
const isQid = (s: string): boolean => /^Q\d+$/.test(s)
const LABEL_BATCH = 150

export async function backfillLabels(nodes: Node[]): Promise<void> {
  const needs = nodes.filter(n => n.where.entity && (n.where.name.startsWith(WD_ENTITY) || isQid(n.where.name)))
  if (!needs.length) return
  const qids = [...new Set(needs.map(n => n.where.entity!.slice(WD_ENTITY.length)).filter(isQid))]
  const labels = new Map<string, string>()

  // Pass 1 — en/mul label service (one row per entity). It echoes the QID when it has no such label,
  // so ignore a "label" that is just the entity's own id; those drop to pass 2.
  for (let i = 0; i < qids.length; i += LABEL_BATCH) {
    const values = qids.slice(i, i + LABEL_BATCH).map(q => `wd:${q}`).join(' ')
    const q = `SELECT ?e ?eLabel WHERE { VALUES ?e { ${values} } SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". } }`
    try {
      for (const r of await runSparql(q)) {
        const qid = r.e?.value?.slice(WD_ENTITY.length)
        const val = r.eLabel?.value
        if (qid && val && val !== qid) labels.set(qid, val)
      }
    } catch {
      /* leave it for pass 2 / the raw id rather than crash */
    }
  }

  // Pass 2 — entities with no en/mul label: fetch ALL labels and pick the best available (en > mul >
  // any). Runs only on the leftover set, which is normally tiny.
  const missing = qids.filter(q => !labels.has(q))
  for (let i = 0; i < missing.length; i += LABEL_BATCH) {
    const values = missing.slice(i, i + LABEL_BATCH).map(q => `wd:${q}`).join(' ')
    const q = `SELECT ?e ?label WHERE { VALUES ?e { ${values} } ?e rdfs:label ?label }`
    try {
      const best = new Map<string, { en?: string; mul?: string; any?: string }>()
      for (const r of await runSparql(q)) {
        const qid = r.e?.value?.slice(WD_ENTITY.length)
        const val = r.label?.value
        const lang = r.label?.['xml:lang']
        if (!qid || !val) continue
        const cur = best.get(qid) ?? {}
        if (lang === 'en') cur.en = val
        else if (lang === 'mul') cur.mul = val
        else if (!cur.any) cur.any = val // first non-en/mul label seen
        best.set(qid, cur)
      }
      for (const [qid, p] of best) {
        const pick = p.en ?? p.mul ?? p.any
        if (pick) labels.set(qid, pick)
      }
    } catch {
      /* leave the raw id rather than crash */
    }
  }

  for (const n of needs) {
    const lbl = labels.get(n.where.entity!.slice(WD_ENTITY.length))
    if (lbl) n.where.name = lbl
  }
}
