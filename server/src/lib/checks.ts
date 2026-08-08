// Runnable self-checks for the correctness fixes that have real edge-case risk.
// Run: `npx tsx src/lib/checks.ts` from server/. No framework — asserts only.
import assert from 'node:assert'
import { impliesLimit } from './builder.js'
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

console.log('checks.ts: all assertions passed')
