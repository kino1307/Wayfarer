export interface Location {
  name: string
  lat: number
  lng: number
  country: string
  description: string
  year: string | null
  wiki_url: string
  // Tier labels (PID R4/R8). Optional so the legacy path still type-checks.
  coord_tier?: CoordTier
  membership_tier?: MembershipTier
  why_url?: string | null
}

// --- Structured node schema (PID section 5) ---

export type CoordTier = 'verified' | 'geocoded' | 'approximate'
export type MembershipTier = 'structural' | 'asserted'

export interface WhyAttribution {
  label: string
  why_url: string | null
  membership_tier: MembershipTier
}

export interface MapNode {
  where: {
    name: string
    lat: number
    lng: number
    entity: string | null
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

// Verification gate report (PID R10). Surfaced loudly when results couldn't be confirmed.
export interface VerificationReport {
  where: { expected_label: string | null; resolved: boolean; conclusive: boolean; total: number; conforming: number }
  why: { expected_label: string | null; resolved: boolean; conclusive: boolean; total: number; conforming: number } | null
  cardinality: {
    expected_min: number | null
    expected_max: number | null
    structural: number
    total: number
    verdict: 'ok' | 'over' | 'under' | 'unknown'
  }
  demoted: number
  sampled: number
  status: 'verified' | 'flagged' | 'inconclusive'
  notes: string[]
}

export interface StructuredResult {
  nodes: MapNode[]
  unresolved: Unresolved[]
  meta: {
    query_role: string
    sparql: string
    rows: number
    error?: string
    enumerator?: 'structured' | 'asserted'
    verification?: VerificationReport | null
    repaired?: boolean
  }
}

// Trust read for a location across both axes (PID R4 coordinate + R8 membership).
// A "clean" green pin requires verified coordinate AND structural membership; anything
// else surfaces its weaker axis. Membership uncertainty (model-suggested) dominates.
export function nodeTrust(loc: Location): {
  marker: 'verified' | 'geocoded' | 'unverified'
  badge: string | null
  short: string | null
} {
  const coord = loc.coord_tier ?? (loc.wiki_url ? 'verified' : 'approximate')
  if (loc.membership_tier === 'asserted') {
    return { marker: 'unverified', badge: 'Model-suggested · not in Wikidata', short: 'model-suggested' }
  }
  if (coord === 'verified') return { marker: 'verified', badge: null, short: null }
  if (coord === 'geocoded') return { marker: 'geocoded', badge: 'Coordinate: geocoded · unverified', short: 'geocoded' }
  return { marker: 'unverified', badge: 'Coordinate: approximate · unverified', short: 'approximate' }
}

// Map a structured node onto the legacy Location shape for rendering.
// Phase 1 reuses the existing verified-pin path; tier-aware markers land in Phase 3.
export function nodeToLocation(n: MapNode): Location {
  const whyLabels = n.why.map(w => w.label)
  const role = n.query_role.charAt(0).toUpperCase() + n.query_role.slice(1)
  // Aggregate membership trust: a node is only as strong as its weakest attribution.
  const membership_tier: MembershipTier =
    n.why.length > 0 && n.why.every(w => w.membership_tier === 'structural')
      ? 'structural'
      : n.why.length === 0
        ? 'structural' // intrinsic relevance (e.g. the battle itself)
        : 'asserted'
  return {
    name: n.where.name,
    lat: n.where.lat,
    lng: n.where.lng,
    country: whyLabels[0] ?? '',
    description: whyLabels.length ? `${role} · ${whyLabels.join(', ')}` : role,
    year: null,
    wiki_url: n.where.where_url ?? n.why.find(w => w.why_url)?.why_url ?? '',
    coord_tier: n.where.coord_tier,
    membership_tier,
    why_url: n.why.find(w => w.why_url)?.why_url ?? null,
  }
}

export interface QueryResult {
  locations: Location[]
  unresolved?: Unresolved[]
  nodes?: MapNode[]
  enumerator?: 'structured' | 'asserted'
  verification?: VerificationReport | null
  repaired?: boolean
}

export type QueryMode = 'idle' | 'loading' | 'success' | 'error'

export type ModelId =
  | 'claude-haiku-4-5-20251001'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-8'
  | 'openai:gpt-5.6-sol'
  | 'openai:gpt-5.6-terra'
  | 'openai:gpt-5.6-luna'

export type Provider = 'anthropic' | 'openai'

// Only the prefix distinguishes providers (mirrors the server's `chat()` dispatcher) — anything
// without a recognised prefix is Anthropic, the original/default provider.
export function providerFor(model: string): Provider {
  return model.startsWith('openai:') ? 'openai' : 'anthropic'
}

// Sonnet is the default: benchmarked cheaper in aggregate than Haiku (converges in ~half the
// builder steps, and prompt caching activates on it) AND higher quality. Haiku stays as the
// budget option; Opus as the escalation for hard queries. See PID §8 / llm-provider-decision.
export const MODEL_OPTIONS: { id: ModelId; label: string; maxTokens: number; approxNodes: number }[] = [
  { id: 'claude-sonnet-4-6',         label: 'Sonnet · recommended', maxTokens: 16000, approxNodes: 50 },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku · budget',       maxTokens:  8192, approxNodes: 50 },
  { id: 'claude-opus-4-8',           label: 'Opus · fastest on hard queries', maxTokens: 16000, approxNodes: 50 },
  { id: 'openai:gpt-5.6-terra',      label: 'GPT-5.6 Terra · balanced', maxTokens: 16000, approxNodes: 50 },
  { id: 'openai:gpt-5.6-sol',        label: 'GPT-5.6 Sol · frontier', maxTokens: 16000, approxNodes: 50 },
  { id: 'openai:gpt-5.6-luna',       label: 'GPT-5.6 Luna · budget', maxTokens:  8192, approxNodes: 50 },
]

export function modelsForProvider(p: Provider) {
  return MODEL_OPTIONS.filter(o => providerFor(o.id) === p)
}

export interface StatusState {
  phase:
    | 'idle'
    | 'locations'
    | 'done'
    | 'error'
    | 'analysing'
  message: string
}
