// Runnable self-checks for the correctness fixes that have real edge-case risk.
// Run: `npx tsx src/lib/checks.ts` from server/. No framework — asserts only.
import assert from 'node:assert'
import { impliesLimit, coversResolvedAnchors } from './builder.js'
import { computeEnvelope } from './fallback.js'
import type { Node } from './nodes.js'

// impliesLimit: a bare number is NOT a limit request (the old `\d+` bug); only an explicit count is.
assert.equal(impliesLimit('World War 2'), false, 'a year is not a limit')
assert.equal(impliesLimit('Group of 7 capitals'), false, 'a name with a number is not a limit')
assert.equal(impliesLimit('South American capitals'), false, 'no number, no limit')
assert.equal(impliesLimit('top 5 cities'), true, '"top N" is a limit')
assert.equal(impliesLimit('3 largest lakes'), true, '"N largest" is a limit')
assert.equal(impliesLimit('nearest airports'), true, '"nearest" is a limit')
assert.equal(impliesLimit('Which 5 African countries have the largest land area?'), true,
  'digit and superlative separated by words is still a limit (the WDQS-timeout bug)')
assert.equal(impliesLimit('the largest 5 economies in Europe'), true, 'superlative before the digit is still a limit')
assert.equal(impliesLimit('Countries with more than 5 official languages'), false,
  'an unrelated number near no superlative is not a limit')

// computeEnvelope: a single same-name mis-resolution (London among a US cluster) must be TRIMMED so
// it can't stretch the box to span the Atlantic and disable the guard.
const pin = (lat: number, lng: number): Node => ({
  where: { name: 'x', lat, lng, entity: null, where_url: null, coord_tier: 'geocoded' },
  why: [], query_role: 'x',
})
const usCluster = Array.from({ length: 12 }, (_, i) => pin(38 + i * 0.2, -78 + i * 0.2)) // ~Virginia
const withOutlier = [...usCluster, pin(51.5, -0.12)] // London
const env = computeEnvelope(withOutlier, { anyTier: true })
assert(env, 'envelope should form with >=8 anchors')
assert(env!.maxLng < -50, `London outlier must be trimmed out of the box (got maxLng=${env!.maxLng})`)
assert(env!.minLng > -85 && env!.maxLat < 45, 'box should hug the US cluster')

// And it must NOT form when there is no trustworthy core in the default (verified-only) mode.
assert.equal(computeEnvelope(withOutlier), null, 'verified-only mode ignores geocoded pins')

// coversResolvedAnchors: the Ring of Fire bug — a query missing the resolved anchor's QID must be
// rejected, even though it's otherwise schema-complete (has ?where/?coord).
const ringOfFireBlock = `RESOLVED ENTITIES — these are the ONLY correct Wikidata IDs for the named entities in
the query. Pick the candidate that best fits the query context, and use its exact QID. NEVER
invent or guess a QID for these names:
- "Pacific Ring of Fire":
    wd:Q18783 — Pacific Ring of Fire — region at edges of Pacific Ocean known for tectonic activity
    wd:Q1473718 — Ring of Fire — song
`
const unconstrainedVolcanoQuery = '?where wdt:P31/wdt:P279* wd:Q1330974 . ?where wdt:P625 ?coord .'
assert.equal(coversResolvedAnchors(unconstrainedVolcanoQuery, ringOfFireBlock), false,
  'a query that never references Q18783 (or any other resolved candidate) must fail the anchor check')
const constrainedVolcanoQuery = '?where wdt:P31/wdt:P279* wd:Q1330974 . ?where wdt:P131* wd:Q18783 . ?where wdt:P625 ?coord .'
assert.equal(coversResolvedAnchors(constrainedVolcanoQuery, ringOfFireBlock), true,
  'a query referencing the resolved QID passes')
// A different resolved candidate for the same anchor (the agent picking Q1473718 instead of
// Q18783) still counts — any candidate satisfies "this anchor was accounted for".
const wrongCandidateQuery = '?where wdt:P31/wdt:P279* wd:Q1330974 . ?where wdt:P361 wd:Q1473718 . ?where wdt:P625 ?coord .'
assert.equal(coversResolvedAnchors(wrongCandidateQuery, ringOfFireBlock), true,
  'any resolved candidate for the anchor counts, not just the first-listed one')
// Multiple anchors: ALL must be covered, not just one.
const twoAnchorBlock = ringOfFireBlock + `- "Japan":\n    wd:Q17 — Japan — country in East Asia\n`
assert.equal(coversResolvedAnchors(constrainedVolcanoQuery, twoAnchorBlock), false,
  'covering only one of two resolved anchors must still fail')
assert.equal(coversResolvedAnchors(constrainedVolcanoQuery + ' ?where wdt:P17 wd:Q17 .', twoAnchorBlock), true,
  'covering every resolved anchor passes')
// No anchors resolved at all (empty block) — nothing to check, must not false-reject.
assert.equal(coversResolvedAnchors(unconstrainedVolcanoQuery, ''), true, 'no resolved anchors means nothing to enforce')

console.log('checks.ts: all assertions passed')
