# Orbis: Product & Implementation Definition (PID)

> The contract. Every change is checked against this document. If a proposed change
> needs a rule below to be weakened, the change is wrong until this document is amended
> first, not the other way around.

## 1. What Orbis is

At its simplest, Orbis is an app that:

1. accepts a user **query**,
2. **processes** it, and
3. returns a **verified list of nodes** related to the query, plotted at real coordinates.

Acceptance example (the canonical test):

> Input `"South American capitals"` should produce a node at the coordinate of **every**
> South American capital city, and **only** South American capital cities. The inverse must
> also hold: every node returned is a real South American capital.

This is a contract on **precision and recall**. Both directions must hold.

The "every / only" framing is judged against a **defensible canonical set**, not a
mythical single truth. Genuine edge cases get adjudicated explicitly and recorded.
Bolivia has two capitals (La Paz as seat of government, Sucre as constitutional); there
is Cayenne in French Guiana and Stanley in the Falklands. Including or excluding each one
is a documented decision, not a bug to chase. Recall and precision are measured against
that adjudicated set.

## 2. The core reframe

Wikipedia is **untrusted, heterogeneous input**. It has no consistent structure: one
answer lives in prose, another in a wikitable, another across 200 linked pages. Any
rule that parses an article's *shape* will work for one article and break on the next.

So the governing decision is:

> **A structured query enumerates (the model only where no structured query can).
> Structured data verifies, both the coordinate and, where possible, the membership.
> The unit of work is the entity, never the article.**

We never derive *which nodes exist* from *how an article is structured*. Enumeration
produces candidate entities; verification then confirms each entity against its own
canonical record along two independent axes. Is the *coordinate* real (R4), and is the
*claim* that puts it in the answer set true (R8)? This is the only design that does not
depend on article shape.

## 3. Hard rules (invariants)

These are source-shape-agnostic by construction. None can be broken by "a different
article." They are not guidelines; they are the contract.

**R1: Wikipedia is for verification, not enumeration.**
We never derive the *set* of answers from an article's prose or tables. Article
structure may not influence which nodes exist.

**R2: Enumeration comes only from structured sources, structured-first.**
Enumeration answers "which entities, and *why* are they relevant?", the **WHY**, not the
**WHERE**. The enumerator is chosen by *capability*, not by query content (R7):

- **Wikidata query: the default, and the recall source of truth** whenever the set is
  expressible as a structured query ("P31=capital ∧ country's continent=SA";
  "P527 members of KATSEYE → their P19 birthplaces"). A structured set is, by
  construction, both *complete* and *self-verifying for membership*; it owns recall and
  precision together.
- **Model knowledge** is a *cross-check and enrichment* over the structured set, and the
  *primary* enumerator only for sets that are **not** structurally expressible (open or
  "vibe" queries). Membership from this path is `asserted`, not `structural` (R8).
- **RAG: deferred, out of scope for v1.** It extracts entities from unstructured text,
  the exact brittleness R1 bans, merely relocated, so it stays off until a query class
  proves it is needed, and even then only to *propose* `asserted` entities that still
  pass R3 / R4 / R8.

Article *text* is never an enumerator. Completeness is never inferred from a model
returning *some* results: a partial model list is not an "empty" signal. Recall is owned
by the structured enumerator, or it is explicitly `asserted` and surfaced as
unverifiable-for-completeness (R6).

**R3: One entity resolved against its own canonical record, context-constrained, never a guess.**
Every candidate node is verified the same way regardless of query type: resolve the
entity, then its Wikidata/Wikipedia page, done. We never load, parse, or branch on a
"list" page, because we never look at list pages.

Name-to-entity resolution is the new chokepoint and must not fail silently. It is
constrained by the context the enumerator supplied (country, role, relationship).
"Georgia" the country is not the US state; "Springfield" needs its state. If name plus
context do not resolve to a single high-confidence entity, the node is surfaced as
**ambiguous** (R6), never silently resolved to the most popular guess. The geocoder tier
(R4) inherits the same context-constrained rule.

**R4: A node separates WHERE, WHY, and SOURCE; coordinates are tiered and labelled.**
The entity you *enumerate* (the **WHY**) and the entity you *geocode* (the **WHERE**)
are often different. For "birthplaces of KATSEYE members" the WHY is the member, the
WHERE is the birth *city*. The pin sits on the WHERE, which is almost always a place
(city, venue, building) and therefore almost always carries structured coordinates.

Every node therefore carries up to two citations, and they need not be the same URL:
- `where_url` is the place's Wikidata/Wikipedia page and the **source of the coordinate**
  (the verification plus "jump in" 2-in-1). It collapses into `why_url` when they are the
  same entity (e.g. capitals).
- `why_url` is the page establishing the relationship (the member or group page), where
  the user goes to research *why* this node matters.

Coordinates come from an **escalating, labelled** source ladder. Every node records
which tier produced its coordinate:
- **`verified`** is structured `prop=coordinates` / Wikidata for the resolved place.
  This is the default and the overwhelming majority.
- **`geocoded`** is a geocoding service used when the place resolves but has no Wikidata
  coordinate.
- **`approximate`** is a model best-guess, last resort only.

`verified` is authoritative. `geocoded` and `approximate` are **unverified** and MUST
be visually distinct on the map (different marker plus a "coordinate unverified" badge);
an unverified pin may never *look* verified. The model may *propose* a node and a
fallback coordinate; it may not be the *source of truth* for a `verified` one.

These tiers grade **coordinate** trust only, whether the pin is in the right *spot*.
Whether the node *belongs* in the answer set at all is a separate, independent axis (R8).

**R5: "Verified" has exactly one definition; emission has a looser one.**
A node's coordinate is **verified iff** it comes from structured data for the resolved
place (R4 tier `verified`). A node is **emitted iff** it resolves to a real entity (R3)
and obtains a coordinate from *any* tier (R4). Every emitted node carries **both** its
coordinate tier (R4) and its membership tier (R8); tiers below the best are surfaced as
such (R6). No coordinate from any tier, or an unresolved/ambiguous identity, means not a
node (reported, not dropped).

**R6: Failures and uncertainty are loud, never silent.**
If enumeration yields 12 and only 2 resolve, that is a surfaced error
("10 unresolved: Lima, Santiago, …"), not a quiet drop. Likewise a node carrying a
`geocoded` or `approximate` coordinate (R4) must be visibly flagged as unverified, not
quietly mixed in with `verified` pins. Silent dropping and silent uncertainty are
what hid the original bug; both are banned.

**R7: No branching on query *content*; branching on *capability* is allowed.**
The path for "South American capitals" must be identical to "Beatles birthplaces" and
"WWI battlefields." Any `if` that keys off the *content or shape* of a source (article
layout, "is this a list page") is a forbidden shape-dependency. Branching on *capability
or result* ("did the structured query return rows?", "did resolution find a
coordinate?", retry/failure handling) is allowed; that is robustness, not shape.

**R8: Membership trust is a separate axis from coordinate trust.**
A `verified` *coordinate* says the pin is in the right place; it says nothing about
whether the entity truly answers the query. That is a second, independent label:
- **`structural`** means the relationship is confirmed by a Wikidata property / class
  (P19 birthplace; P31 capital ∧ country's continent). Precision is guaranteed here.
- **`asserted`** means the relationship rests on the enumerator's (model's) claim with no
  structured confirmation. It may be wrong; it must be labelled and surfaced (R6).
A green "everything checks out" pin requires `verified` **and** `structural`. Any other
combination is shown with its weaker axis visible. This is what stops a real-but-wrong
place (Panama City as a "South American capital") from wearing a verified badge: the
coordinate is real, but membership is `asserted`/false, so it cannot pass as clean.

**R9: The structured query is built by schema discovery, not by example.**
The translator does not lean on a fixed set of worked examples. A baked-in example
generalises only to the query shapes someone thought to write down; it makes the
templated cases excellent and teaches the model nothing about the rest. Instead the
translator treats Wikidata's schema as the thing to *read at query time*:
- it resolves the **properties and classes** a query needs against Wikidata itself
  (property/class search), the same way R3 resolves named entities, never guessing a
  PID/QID it can look up;
- it **probes how the relevant entities are actually modelled** (a bounded sample of
  instances, their dominant properties, the subclass/`P279` neighbourhood) rather than
  assuming a property path;
- it **tests its draft against the live endpoint and inspects the rows** before the
  result is accepted, repairing within a bounded loop (draft → test → inspect → repair).
Expertise lives in Wikidata and is read per query; it is not hard-coded per query shape.
The loop is identical for every query, so this is R7-safe (capability/result branching,
never content/shape branching).

**R10: Results are verified before they are returned.**
A structured query returning rows is **necessary but not sufficient**: a query that is
valid SPARQL but the wrong *interpretation* returns confident garbage, and because it
has rows it never trips the empty-result fallback. So before emission the result set is
checked against the query's intent along generic, shape-agnostic dimensions:
- **type conformance**: every WHERE (or WHY) matches the class the query_role implies
  (settlements for "capitals", humans for "members"); intruders of the wrong class are a
  precision signal;
- **cardinality sanity**: the row count is reconciled against an *independently derived*
  expectation (a separate count probe), catching both over-collection and under-collection;
- **sampled membership**: a random sample of results has its *claim* re-confirmed by an
  independent path (a second query or model judgement), separate from how it was enumerated.
Verification has no oracle and cannot *prove* correctness. Its job is to catch the
characteristic failure shapes and, when it cannot confirm, to **lower the membership tier
to `asserted` and surface the reason loudly** (R6/R8), never to pass unverified rows as
`structural`. A failed gate triggers one bounded repair (hand the verifier's findings
back to the R9 loop), then honest degradation. This gate **subsumes the bespoke
sovereign-state precision guard** (§8): once R10's type and cardinality checks cover it,
that hand-authored guard is retired rather than maintained.

## 4. How the rules satisfy the acceptance test

- **Recall** ("a node at every SA capital") is owned by the **structured enumerator**
  (R2). Its source of truth is the Wikidata query, which is complete by construction;
  model knowledge is a cross-check, never the completeness authority. Recall failures are
  enumeration failures, one place to look.
- **Precision** ("only SA capitals") is owned by **membership verification** (R8), *not*
  by the coordinate check. A node is precise only when its relationship is `structural`,
  or is flagged `asserted` so it cannot masquerade as confirmed. The coordinate tiers
  (R4) grade a different thing, whether the pin is in the right *spot*.
- **The inverse** (every node implies a real SA capital) is R5 plus R8: no resolution
  means no pin, and a resolved-but-`asserted` membership is shown as unconfirmed, never
  as clean.

## 5. Target pipeline

```
query
  → plan + resolve anchors              (R3: extract named entities → canonical QIDs via search)
  → build by schema discovery           (R9: resolve props/classes → probe how they're modelled → draft → test → repair)
  → enumerate + locate (single SPARQL)  (R2/R4: Wikidata returns entity AND coordinate together)
  → VERIFY before emission              (R10: type-conformance + cardinality + sampled membership → pass / lower tier / repair)
  → locate gaps, tiered + labelled      (R4: Wikidata `verified` → geocoder `geocoded` → model `approximate`)
  → emit nodes with coord-tier + links  (R5: resolved + located in any tier; where_url/why_url)
  → surface unresolved + unverified     (R6: loud drops, visible badges, verifier findings)
```

One uniform "resolve + locate" step replaces the entire list-mode / link-harvest /
grounded-vs-memory machinery. The location ladder runs top-down and stops at the first
hit. For the Wikidata-enumerator path, enumeration and location collapse into a single
SPARQL query that returns entity **and** coordinate together.

### Node schema (output contract)

A node is keyed by its **WHERE** entity; one or more **WHY** attributions attach to it.

```jsonc
{
  "where": {
    "name": "Liverpool", "lat": 53.41, "lng": -2.99,
    "entity": "Q24826", "where_url": ".../Liverpool",
    "coord_tier": "verified"                          // R4: verified|geocoded|approximate
  },
  "why": [                                            // R8: one entry per attribution
    { "label": "Birthplace of John Lennon",  "why_url": ".../John_Lennon",
      "membership_tier": "structural" },              // structural|asserted
    { "label": "Birthplace of Paul McCartney", "why_url": ".../Paul_McCartney",
      "membership_tier": "structural" }
  ],
  "query_role": "birthplace"
}
```

Unresolved or ambiguous entities are returned in a separate `unresolved[]` report
(`name` plus `reason`), never dropped silently (R6).

### Edge handling

- **Duplicate WHERE** (two Beatles, one Liverpool): **one** node with multiple `why[]`
  entries; never two overlapping pins.
- **Non-point WHERE** (a river, the Western Front, a whole country): use Wikidata's
  representative point (P625) if present; an inherently linear/area entity with no
  representative point is surfaced as `unresolved` with reason `non-point`. Polyline /
  area rendering is a deliberate **post-v1** item.
- **Multi-valued claim** (Bolivia, both La Paz **and** Sucre): both emit as distinct
  WHEREs; *which* counts is a §1 acceptance/adjudication matter, never a pipeline branch
  (R7).

## 6. What this deletes from the current code

The following are shape-dependencies and are removed, not refactored:

- list-article detection (`isListArticle`) and its separate caps/branches,
- wikilink harvesting as a data source (`fetchPageLinks` second hop),
- the candidate-link cap (80) and alphabetical `slice()` truncation,
- the "primary vs linked article, enrich only" prompt rule,
- the grounded-vs-memory prompt split,
- model-supplied coordinates treated as the source of truth,
- silent `dropped` counting in place of surfaced verification failures.

## 7. Amendment rule

This document changes by intent, not by accident. If implementation pressure pushes
toward parsing an article's structure or branching on its content, stop: that pressure
is the signal a rule is about to be violated. Amend this PID deliberately, with the
trade-off written down, or find the shape-agnostic path. Never quietly special-case.

### Amendment log

- **A1: Tiered coordinate fallback + WHERE/WHY split.** R4 originally forbade any
  non-structured coordinate (structured-or-no-pin). It was amended to a labelled
  coordinate ladder (`verified` → `geocoded` → `approximate`) so long-tail places without
  Wikidata coordinates still plot, traded against strict purity. Safety is held by R6:
  unverified tiers must be visibly badged and can never look `verified`. The same
  amendment separated a node's WHERE (geocoded place) from its WHY (relationship/citation),
  giving two links (`where_url`, `why_url`), and added RAG as the last-resort enumerator
  under R2. *Rationale: completeness is a stated product goal; a clearly-flagged
  approximate pin fails recall less than a silently-missing one.*

- **A2: Red-team hardening (pre-development).** Closed seven pitfalls found while
  stress-testing for confidence:
  1. Split trust into independent **coordinate** (R4) and **membership** (R8) axes; a
     `verified` coordinate no longer implies a true claim; precision now belongs to R8,
     not the coordinate check. (Fixes "Panama City as a verified SA capital".)
  2. Made name-to-entity resolution **context-constrained and loud-on-ambiguity** (R3),
     closing the "Springfield / Georgia" silent-mis-resolution chokepoint.
  3. **Inverted enumeration to structured-first** (R2): the Wikidata query is the recall
     and membership source of truth; model knowledge is demoted to cross-check, because a
     partial model list gives no completeness signal.
  4. **Deferred RAG out of v1** (R2); it relocates the R1 text-parsing brittleness.
  5. Clarified **R7** to permit capability/result branching while still banning
     content/shape branching.
  6. Added a **WHERE-keyed node schema** with multi-WHY attribution and
     non-point/duplicate/multi-valued edge handling (§5).
  7. Made the §1 acceptance test **adjudicated** against a defensible canonical set.
  §4 was corrected accordingly: precision is owned by R8, recall by the structured enumerator.

- **A3: Schema-discovery builder + verification gate (R9, R10).** The v1 translator was a
  single-shot LLM call carrying a handful of worked few-shot examples. It excelled on the
  templated shapes (SA capitals, group-member birthplaces, WWI battles) and was unreliable
  off them, and a *valid-but-wrong* query returned confident garbage that, having rows,
  never tripped the empty-result fallback. Adding more examples only moves the cliff; it
  cannot cover every query. It was amended in two parts:
  - **R9** replaces example-matching with **schema discovery**: the translator resolves the
    properties/classes it needs against Wikidata, probes how those entities are actually
    modelled, and tests and repairs its draft against the live endpoint before accepting it.
    The "expertise" is read from Wikidata per query, not hard-coded per shape.
  - **R10** adds a **verification gate** before emission: type-conformance, cardinality
    sanity (vs an independent count), and sampled membership re-check. It cannot prove
    correctness, so on non-confirmation it lowers the membership tier to `asserted` and
    surfaces the reason loudly (R6) rather than passing rows as `structural`; a failed gate
    feeds one bounded repair back into R9.
  *Trade-off: materially more LLM + WDQS round-trips per query (single-shot becomes a
  bounded agentic loop plus verifier). Accepted because SPARQL/disambiguation quality is the
  critical path and latency is not the bottleneck; probe/verify queries must be
  `LIMIT`-sampled to avoid WDQS timeouts. R10 is designed to **retire** the hand-authored
  sovereign-state precision guard once it demonstrably covers that case (see §8).*

- **A4: Asserted-path coordinate honesty (tier `verified` → `geocoded`).** The asserted path was
  violating R3/R8 in spirit: a model-named place was resolved by an UNCONSTRAINED top-1 name match
  (the "most popular guess" R3 bans) and then plotted with a `verified` coordinate. A same-name
  mis-resolution ("Richmond" → London) therefore wore a confident coordinate badge AND polluted the
  envelope guarding every other pin. Amended so the asserted path's resolved coordinates are
  `geocoded` (unverified), never `verified`, and are themselves guarded against the cluster's trimmed
  envelope (`locateAndGuardAsserted`). *Trade-off: asserted-query pins no longer show a `verified`
  coordinate even when the place is unambiguous. Accepted, because the tier grades the RESOLUTION's
  trustworthiness, and an unconstrained name match is not verifiable; over-claiming `verified` is the
  worse error (R6). Coordinate axis only, recall and precision (R8 membership) are unchanged.*

## 8. Build log & adjudication record

Implemented v1 as `enumerate (LLM→SPARQL) → resolve+locate (WDQS) → tiered fallback →
nodes`. The pipeline is shape-agnostic: `routes/structured.ts` plus `lib/{wikidata,nodes,
fallback}.ts`, with the legacy §6 machinery deleted.

**Adjudication decisions (per §1, recorded, not bugs):**
- **Bolivia gives two nodes** (La Paz, seat of government; Sucre, constitutional). Both emit
  as distinct WHEREs; no tie-break applied. The canonical "South American capitals" set is 13.
- **Dependent territories excluded.** The sovereign-state guard (below) drops the
  Falklands (Stanley), French Guiana (Cayenne), and so on. The strict-sovereign reading is
  the default; revisit if a broader set is wanted.

**Implementation notes (not rule deviations):**
- *Precision guard, RETIRED (Stage 4, A3/R10).* The bespoke "MANDATORY sovereign-state
  guard" (the imperative `P31 wd:Q3624078` + `FILTER NOT EXISTS P576` rule, framed as "omitting
  it is a WRONG answer") is **gone** from the builder. Precision is now owned by R10: the
  why-type check demotes non-sovereign relating entities (proven by the São Paulo-state probe),
  and a repair can re-add a constraint the builder missed. *Honest caveat:* a naive removal
  regressed convergence; the agent lost useful scaffolding and burned its whole step budget
  exploring without ever testing. So the mandate was replaced by (a) general schema-navigation
  hints listing common linkage patterns (incl. "countries usually = sovereign state" as one
  option among many, explicitly "confirm by probing", with precision deferred to the verifier),
  and (b) a "test early" instruction. With these the agent reconstructs the clean SA-capitals
  query (13, verified) on its own; R10 remains the safety net if it does not.
- *Entity-as-WHERE.* Events that are themselves located (battles) bind directly to
  `?where` via their own P625, with no `?why`, distinct from place+WHY queries but on the
  same code path.
- *Geocoded tier is bounded.* Nominatim (~1 req/s) is attempted for a budgeted number of
  pending entities; overflow falls through to the `approximate` (model) tier, then to
  `unresolved`. Bounded best-effort, never a silent cap (R6).
- *`asserted` enumeration is live.* When the structured Wikidata query returns 0 rows, errors,
  **or the schema-discovery builder fails to converge on a usable query**, the model enumerates
  the set from its own knowledge (`lib/enumerate.ts`) with `membership_tier: asserted`,
  `coord_tier: approximate`. The builder returns an empty query (not an exception) on
  non-convergence, so the route degrades into this same fallback rather than 500-ing; a hard
  query now always returns *something*, structured or clearly model-suggested, never a dead error
  (R6). It triggers only on a clean empty result (R7-safe capability branch), never on "sparse". It
  is surfaced loudly (R6): dashed marker, "model-suggested" badge per node, and a sidebar banner.
  The structured path is untouched when Wikidata has data. RAG remains deferred (A1); this is the
  model-knowledge enumerator R2 always allowed for non-structurally-expressible sets.

**R9 / R10 implementation (A3, Stages 1-3):**
- *R10 verification gate* (`lib/verify.ts`) runs on the structured bindings before emission.
  Expected WHERE/WHY classes plus a count range are derived from query intent (independent of the
  result), resolved to QIDs, and each result entity is type-checked via `P31/P279*` (batched and
  parallelised). Which slot carries membership is a capability branch (R7-safe): a row WITH a
  `?why` is judged on the WHY's type (the WHERE may legitimately be a building/district, since a
  birthplace is often a hospital); a row WITHOUT a `?why` (case-a: a castle, a battle) is judged
  on its own type. A third layer samples ~6 survivors for an independent model-judged membership
  re-check (conservative, granularity-tolerant). Non-conformers are demoted to `asserted` and
  surfaced (R6); the gate never drops a node and stays inconclusive (demoting nothing) when its
  own expectation matches no result.
- *R9 schema-discovery builder* (`lib/builder.ts` + `lib/schema.ts`) replaced the single-shot
  few-shot writer (now deleted). A bounded ReAct loop with tools (search_property/entity,
  probe_class, probe_entity, test_sparql) reads Wikidata's schema and tests its draft before
  answering; `planQuery` now resolves geographic qualifiers too, so the agent gets every proper
  noun's QID up front. Proven to build correct queries with zero examples for SA capitals,
  Beatles birthplaces, Welsh castles (`P131*`), and French nuclear stations (`P17`); the last
  two previously fell to the asserted path.
- *R10 → R9 repair* (`routes/structured.ts`): a repair-worthy gate result (over/under
  cardinality or >30% demoted) feeds the verifier's findings back into one bounded builder pass;
  the repaired query is adopted only if it is strictly better (stronger status, then MORE
  confirmed answers, never trading away recall), else the original is kept.
- *Known costs:* the agent loop is the dominant latency (≈20-100s/query; repair doubles it for
  flagged queries). The verifier was parallelised but the loop is inherently sequential; a
  faster model (Stage 5) is the main lever. `P131*` transitive queries can time out on WDQS, in
  which case the agent degrades to a narrower query (loudly flagged by R10's recall-gap check).
- *Stage 4, precision guard retired.* The hand-authored sovereign-state mandate was removed from
  the builder; precision is now R10's job (plus repair). See the "Precision guard, RETIRED" note
  above for the convergence caveat and what replaced it (general navigation hints + test-early).
- *R10 geographic-containment check* (`lib/verify.ts`, `geographicallyContained`): catches results
  LINKED to the queried place (e.g. `P17` includes Italy) but PLOTTED outside it, the
  transnational/serial sites. A batched `P131*` containment test; it only fires on a real
  containment query (≥50% of results contained) and only demotes multi-country entities not
  located in the place. Fixed "UNESCO sites in Italy" showing pins in Czechia/Germany/Belgium as
  verified (now demoted to asserted). No false positives on SA capitals.
- *R10 sub-component roll-up* (`lib/rollup.ts`, `collapseSubcomponents`): collapses serial-site
  over-collection; it drops any result whose `P361 (part of)` parent is ALSO in the result set, so
  one listing is one pin (UNESCO Italy 284→75 on the over-collecting path; validated against the
  real result set). It is self-gating: independent results (capitals, castles) have no internal
  part-of links, so 0 are collapsed, which makes it safe to always run (one cheap batched SPARQL
  roundtrip, gated to ≥8 results). It runs before verification so the cardinality check sees the
  collapsed count.
  *Builder variance, addressed:* "UNESCO sites in Italy" used to oscillate 8↔284. The root cause
  was the DESIGNATION TRAP: items are typed by physical kind (church, town, forest), so
  `P31=<designation>` under-collects (~8). Three coordinated fixes:
  (1) the builder SYSTEM prompt gained a general "designation trap" hint, that membership lives on
  a status/designation property (P1435) or the listing's ID, not P31; probe a known example if a
  P31 draft returns few rows. (2) the recall-gap repair now explicitly tells the agent to WIDEN the
  membership property rather than re-run a near-identical query. (3) roll-up also runs on repaired
  bindings. The result: the builder now reliably takes a broad path (P757/P1435) and roll-up collapses
  it to ~71 with cardinality "ok". Residual (now FIXED, see below): ~1/3 of runs mis-RESOLVED the
  WHS designation entity (e.g. `P1435 wd:Q39715`, which is "lighthouse", not Q9259), giving 0 rows
  and an honest asserted fallback (~41 flagged pins).
- *Designation entity resolved UP FRONT (`routes/structured.ts planQuery`).* The mis-resolution tail
  above was the builder searching for the designation class mid-loop and grabbing a confusable
  near-match (lighthouse Q39715, "buffer zone" Q64364418). Fix: `planQuery` now extracts named
  DESIGNATIONS/classifications (World Heritage Site, Ramsar site, national monument, and so on) as
  anchors alongside named entities and geographic qualifiers, so `resolveAnchors` hands the builder
  the candidate list (Q9259 "place of significance listed by UNESCO" is present with its description)
  and the resolved-block instruction forbids guessing a QID. The same machinery is already used for
  KATSEYE and similar. Result: 4/4 UNESCO runs (Italy ×3 + Spain) now filter on the correct
  `P1435 wd:Q9259`, ~70-71 nodes, green 62-67, no lighthouse. It generalises (Spain not hardcoded).
  No regression: SA capitals 13/13, Welsh castles 52/50, both cardinality "ok".
- *R10 verifier, designation queries (heterogeneous WHERE type).* The case-(a) type check demotes
  results that aren't an instance of a single derived class. For a designation query (UNESCO sites,
  monuments) there is NO single valid WHERE type, so a derived class like "human settlement" wrongly
  demoted 59/71 valid sites on runs where no ?why was bound (green collapsed 67→0). Fix:
  `deriveExpectations` now returns `where_class=null` for designation/listing/award/status queries,
  skipping the WHERE type net (membership there is the designation itself). This is query-type-based,
  NOT a conformance-ratio threshold; the sovereign-state pollution case (13 real vs 74 bogus
  "countries", 15% conformance) still RELIES on low-conformance demotion, so a ratio gate would
  break it. Verified: UNESCO green now stable ~62-70 across runs; SA capitals unchanged (13/13,
  where_class still "human settlement").
- *R4 fallback, context-aware placement + envelope guard (`lib/fallback.ts`).* For results with no
  P625 coordinate the fallback ladder (geocode → model-approximate) was placing same-named places by
  blind name lookup: "Richmond" → Newfoundland, "Fort Fizzle" → Colorado, "Fall of Richmond" → Nova
  Scotia (on "Battles of the American Civil War"). Two fixes: (1) `modelApproximate` and
  `locatePending` now take the QUERY string and pass it into the prompt so the model disambiguates
  within the query's region/era (Richmond → Virginia). (2) ENVELOPE GUARD: the verified pins define
  the answer's true region. `computeEnvelope` builds a margined bbox from the ≥8 verified anchors,
  and `guardOutliers` re-places (one bounded model call) any fallback pin that landed outside it,
  moving anything it still can't confidently place in-region to the unresolved report rather than
  plotting it wrong (R6). Verified: ACW battles 534 nodes, 0 pins outside the US (was several);
  "Fall of Richmond" now Richmond VA. Unit-tested on synthetic outliers: a Nova-Scotia pin relocated
  to VA, an unplaceable fake went to unresolved, in-region pins untouched. No-op when results are global
  (envelope ≈ whole map) or lack a verified core (<8 anchors, guard skipped).
- *R4 fallback, STRUCTURAL location tier (grounded, beats guessing).* An entity with no P625 of its
  own often still records WHERE it is via P276 (location) or P131 (located in admin territory), whose
  target carries a coordinate. "Battle of Fort Fizzle" (Q4871040) has no point but P276 → Glenmont OH
  (the real 1863 Civil-War site); the model alone guessed Missoula MT (the same-named 1877 Nez-Perce
  site, in-region so the envelope guard couldn't catch it). New tier 0 in `locatePending`
  (`structuralCoords` → `locationCoords`): batched Wikidata lookup, prefer P276 then P131, label the
  result 'geocoded' (the containing place's point, town/county-level, not the entity's own 'verified'
  point). It runs BEFORE Nominatim/model. Result on ACW battles: of 32 no-coordinate entities, 26 now
  resolve structurally (grounded) and only 5 fall to a context-aware model estimate (all in-theatre);
  Fort Fizzle → Glenmont OH. The ladder is now: verified P625 → structural P276/P131 → geocoded name →
  model-approximate (context-aware) → envelope guard → unresolved.
- *Robust JSON parsing (`lib/anthropic.ts parseJsonResponse`).* A chatty model reply ("{...}. These
  are the 12 astronauts.") made `JSON.parse` throw "Unexpected non-whitespace character after JSON",
  and `planQuery` (the one unguarded caller) surfaced it as a request failure. Fix: parse the first
  BALANCED JSON value (string/escape-aware brace scan), tolerating leading/trailing prose; keep the
  truncated-array recovery as a fallback; `planQuery` now degrades to no-anchors instead of throwing.
  This protects every LLM call (plan/verify/approximate/enumerate). Unit-tested on 7 malformation shapes.
  (Surfaced by "Hometowns of the 12 astronauts who walked on the Moon", which itself correctly
  degrades to the asserted enumerator, since there is no clean Wikidata predicate for "walked on the Moon".)
- *Asserted path GROUNDS location in Wikidata, cluster-guarded (see A4).* Previously the asserted
  enumerator (`modelEnumerate`) let the model guess BOTH the set AND coordinates, so it could plot a
  hallucinated point (James Irwin → "Fort Ord"). That contradicts the PID's division of labour. Now
  the model returns candidate NAMES only; `resolveCandidates` resolves each to its Wikidata entity and
  takes the entity's own P625. That resolution is a best-effort top-1 NAME match, NOT context-
  constrained (R3), so the coordinate is labelled `geocoded` (located, UNVERIFIED), never `verified`;
  a `verified` badge there would let a same-name mis-resolution ("Richmond" → London) look confident
  and would pollute the envelope that guards every other pin. Whatever doesn't resolve flows through
  the SAME location ladder as the structured path. The two paths share the ladder but NOT the guard:
  the structured path anchors its envelope on its SPARQL-`verified` core (`locateAndGuard`); the
  asserted path has no trustworthy core, so `locateAndGuardAsserted` builds the region from the
  TRIMMED envelope of the whole resolved cluster and guards EVERY pin against it (a mis-resolved
  outlier is re-placed in-region or sent to `unresolved`, R6). Two trust axes still hold, but nothing
  in the asserted path is ever green: the coordinate is `geocoded`/grey and membership `asserted`/grey.
  Unresolvable names go to the unresolved report, never a fabricated pin. Verified:
  `resolveCandidates(["Pittsburgh","Fort Ord","Wheeler TX","<fake>"])` gives real places `geocoded`
  coords (Fort Ord at its actual CA location, membership asserted), fake → unresolved. No regression on
  the structured path (ACW battles 534, Fort Fizzle → Glenmont OH, 0 out-of-region).
- *Cost/latency optimisation pass (4 levers; 3 kept, 1 reverted).* (1) GEOCODE budget 8→3: the
  structural P276/P131 tier now resolves most no-coord entities, so the old 8×1.1s sequential
  Nominatim wait was mostly dead latency; kept. (2) `deriveExpectations` PREFETCHED in parallel with
  the builder loop (it depends only on query+role) and passed into `verifyStructured`, hiding one
  round-trip under the long build AND letting the repair pass reuse it instead of recomputing; kept.
  (3) REPAIR GATE: `repairWorthy` now skips the ~6-call repair on a MILD under-miss (structural ≥70%
  of expected_min) with zero demotions; a second loop rarely recovers a near-complete set and just
  doubles cost (subjective queries that found a few valid rows). SEVERE under (designation widening,
  ~8 vs ~55), over, and high-demotion still repair. (4) PROMPT CACHING on the builder loop, TRIED
  AGAIN now that loops are longer (15-23 calls), still a NO-OP on Haiku (re-measured: cache-read/
  write both 0). Haiku's ~4096-token min cacheable prefix exceeds our short system prompt (~750) plus
  typical builder transcripts, so breakpoints never activate; REVERTED (matches the earlier finding).
  It would help on Sonnet (1024 min); revisit if the builder moves there. Net: modest (capitals
  11→10 calls, $0.021→$0.019; ~5s geocode latency on fallback-heavy queries; a skipped repair saves
  ~6 calls + ~30s when it triggers). The dominant cost remains the builder loop's step count, which
  is inherently variable; the real remaining levers are fewer steps (hurts hard queries) or a model
  with effective caching. Verified no regression: capitals 13 (12 green), UNESCO 71 (69 green),
  ACW 534 (Fort Fizzle → Glenmont).
- *Default model HAIKU → SONNET (`claude-sonnet-4-6`), benchmarked.* `server/benchmark.ts` extended
  to log calls/cost/cacheRead. Haiku vs Sonnet on the 5-query suite REVERSED the earlier pricing
  estimate: Sonnet is cheaper in aggregate ($0.121 vs $0.154 on the 4 clean queries), uses ~half the
  builder calls (35 vs 63), and verifies 3/4 vs 1/4. The per-token estimate (Sonnet ~2× pricier)
  assumed equal call counts; in reality Sonnet converges in far fewer steps (Beatles 6 vs 14,
  Nuclear 9 vs 20) AND prompt caching activates on it (35k cache reads; 1024-token min vs Haiku's
  4096). Easy queries still favour Haiku on cost (capitals $0.012 vs $0.022); hard queries, which
  drive cost, favour Sonnet on BOTH cost and correctness. Prompt caching is now MODEL-GATED
  (`anthropic.ts modelBenefitsFromCaching`: on for Sonnet/Opus, off for Haiku where it's a no-op).
  Client: `App.tsx` default to sonnet, `MODEL_OPTIONS` reordered (Sonnet recommended / Haiku budget /
  Opus best); existing users keep their stored choice. Opus is the escalation tier if Sonnet
  struggles. Caveat: 5-query suite with WDQS-slowness outliers; magnitude directional, direction
  consistent.
- *LATENCY: multi-minute queries → ~20-25s (launch blocker).* Trigger: "Countries that speak Tagalog"
  (a 1-2 pin answer) took **339s**. The root cause was TWO compounding issues, both in the builder's
  WDQS round-trips, NOT the LLM: (1) **no client-side timeout** on `runSparql`; an unbounded
  P131*/P279* test query scans to WDQS's ~60s server limit before erroring, and the schema-discovery
  builder fires several test queries per request, so a few timeouts equal minutes (seen as `test → rows=null`
  in the log); (2) **unbounded test queries**; even SUCCESSFUL broad tests (`rows=1645`, `rows=187`)
  scan the full graph slowly. Fixes (`wikidata.ts` + `schema.ts`): (a) `runSparql(query, {timeoutMs})`
  now wraps every call in an AbortController, **45s** for the real `answer`/fallback query, **20s** for
  probes (`PROBE_TIMEOUT_MS`, bounded by construction), **12s** for `test_sparql` (`TEST_TIMEOUT_MS`),
  so a runaway fails fast as a loud, *guiding* error the agent reacts to; (b) `testSparql` injects a
  sample **`LIMIT 300`** into unbounded exploratory tests (`capForTest`) so a draft confirms its SHAPE
  in <1s instead of scanning; the agent still reads "≥300 (sample-capped; broad)" vs an exact small
  count, and the final `answer` query is NEVER capped (verify/rollup still run on the real, full result
  set). The LIMIT cap was the dominant win and also improved convergence: Tagalog **339s→~23s**, 21→8
  calls, now CORRECT (Philippines + Australia, both verified, was non-converged garbage). No regression
  on SA capitals (13 nodes verified, 20s) / Kenya parks (32). Added a builder timing log (`llm=Xs
  tool=Ys`) to attribute latency.
- *LATENCY follow-up, the two classes, and what did NOT work (recorded so we don't re-try it).* The
  fix above covers the **heavy-WDQS-scan** class. Profiling exposed a SECOND class, **many-LLM-round-
  trips** (e.g. "Countries that have Welsh as an official language": 102s / 21 calls, non-converging,
  since Welsh is official in *Wales* (non-sovereign) so "countries" is genuinely near-empty and the agent +
  verify-repair correctly grind to that conclusion). Its tests all RETURN fast (no timeouts), so the
  timeout/LIMIT levers don't touch it; the only lever is fewer LLM calls. **Tried and REVERTED:**
  (1) *Lowering `MAX_STEPS`*, killed by evidence: "Castles in Wales" needs all 10-11 steps to iterate
  from a 0-row P17 draft to an efficient transitive form; the naive `P31/P279* + P131*` castle query
  TIMES OUT at WDQS's own 60s limit (measured 65s), so the agent must *find* a selective form, which
  takes steps. (2) *A tighter test timeout to cut flailing* regressed Castles 964→**55** (fell to the
  asserted path): a 12s cut reads as "wrong path" on a correct-but-slow deep query, so the agent
  abandoned `P131*` for a shallow 5-row query. (3) *Escalating the test timeout by attempt count*
  (short early, long late) BACKFIRED on Tagalog (129s); "later attempt" is not "committed to a correct
  path" (Tagalog flails late, Castles commits late; indistinguishable by count), so late flailing then
  paid the long cap per attempt. **Kept instead:** the SHORT (12s) test cap (protects the common/reported
  case) PLUS a *guiding* timeout message (`wikidata.ts`) that tells the agent a slow query is "too
  BROAD/DEEP, not wrong, make it MORE SELECTIVE (pin the class, avoid wide P279*, shorten the path),
  do NOT drop a constraint", the lower-risk lever for the deep-query case, since it pushes efficient
  reformulation rather than recall-losing abandonment. **Conclusion:** the many-LLM-calls tail on
  genuinely-hard/ambiguous queries is largely INHERENT to the ReAct loop; forcing it shorter trades the
  accuracy that is Orbis's whole point. The right product answers are the streaming-progress UI (built,
  `/stream`) to keep the wait responsive plus the result cache for repeats, NOT a step cap. Concurrency
  also inflates wall time (3 parallel → 64-234s) via shared-endpoint contention (WDQS/Anthropic/Nominatim),
  a scaling concern for the Redis result-cache + a WDQS concurrency limiter, not per-query latency.
- *LATENCY, the residual is a BUILDER-QUALITY problem, not plumbing (key finding).* After the timeout/
  LIMIT/message/step-count work, profiling a query CLASS exposed the real ceiling: "countries that speak
  X" is slow ACROSS the board; even trivially-correct **"Countries where Spanish is spoken" took 121s**
  (10 steps, converged, 20 countries) and **Tagalog 141-242s** (high variance, same query). Contrast:
  capitals ~20s, Kenya parks ~31s, volcanoes 8 calls; those are fast. The language class churns because
  the builder drafts P37/P2936 queries (often with the sovereign-state P31/P279* filter + the contract's
  OPTIONAL Wikipedia-article binds) that repeatedly graze the 12s test cap and reformulate. Added a
  language LINKAGE HINT (P37/P2936, "not P1412", query from the language side, watch for a standardised
  variety); it helped Tagalog (242→141s) but did NOT fix the class (Spanish still 121s). CONCLUSION:
  the per-query latency on hard classes is dominated by the ReAct loop's step-count + reformulation
  churn on SONNET, which is an agent-quality ceiling, not a tunable. The genuine levers now are: (1) the
  streaming-progress UI (built, `/stream`) to mask the wait; (2) **benchmark OPUS as the builder model**
  on these slow classes; a stronger model that writes an efficient query first-try would cut steps AND
  churn (aligns with the pre-agreed "test against Opus if issues"); (3) possibly strip the OPTIONAL
  article binds from TEST queries (they're only needed on the final answer) to make drafts cheaper.
  Do NOT keep tuning the timeout: 12s (reported case), 45s (Tagalog 212s), and attempt-escalation
  (Tagalog 129s) were all measured; 12s + LIMIT + guiding message is the kept config.
- *LATENCY, SOLVED CHEAPLY by an EFFICIENCY PROMPT, no Opus needed (the resolution).* Opus was
  benchmarked (claude-opus-4-8) and IS dramatically better on the slow class: Spanish 121s→**21s/2
  steps**, Tagalog 242s→**21s/2 steps verified**, Castles 132s→95s, because it writes an EFFICIENT
  query first-try. But Opus is too expensive to host (user constraint: paid LLM means all BYOK; can't
  afford compute). The KEY INSIGHT that unlocked the cheap fix: direct WDQS timing showed the *correct*
  query for these is ALWAYS fast (Spanish ~1.2s even with all binds; a broad draft 1.5s), so the
  121-242s was NEVER the data, it was SONNET drafting inefficient queries and churning. Opus's only
  edge was draft QUALITY, which is teachable. Added an **EFFICIENCY block to the builder SYSTEM prompt**
  (builder.ts): "anchor on the MOST SELECTIVE constraint first (a country's P37, a person's P19) before
  broad type filters; keep only ONE open-ended P131*/P279* traversal and pin the other side to a
  concrete entity; a timeout means too broad/deep, not wrong, so tighten, don't abandon." Result on
  SONNET (no Opus): **Spanish 121→22s ($0.018), Tagalog 242→43s ($0.036, converged+correct), capitals
  17s ($0.020)**, all CHEAPER and SNAPPIER, the same lever doing both (fewer steps = fewer calls = less
  WDQS). Recall guard: a first draft of the EFFICIENCY block also said "avoid P279*, try plain P31",
  which REGRESSED Castles 789→48 (castles need the subclass tree); REMOVED that line, keeping "anchor
  selective" + "one open traversal" + "use P279*/P131* when recall needs it". Re-verified: **Castles
  back to 789 VERIFIED ($0.042, 8 steps), Spanish/Tagalog still fast.** Also strip the OUTPUT contract's
  OPTIONAL article binds from TEST queries only (`stripArticleBinds` in capForTest), ~1s/test, free,
  the binds never change row count and the final answer keeps them. NET: the cheapest-verified model floor
  is **Sonnet builder + the efficiency prompt** (Haiku flails into MORE calls, a false economy; Opus is a
  BYOK opt-in "best" dropdown option, id corrected to `claude-opus-4-8`). Heavy queries now run in ≤1 min
  except the genuinely WDQS-expensive Castles (~122s: 2 unavoidable transitive-closure timeouts +
  geocoding 789 pins). Remaining cheap levers not yet spent: Haiku for the trivial aux calls
  (plan/expectations/chips), builder-transcript trimming.
- *Correctness-pass hardening (review follow-up).* Edge-case fixes from a focused correctness review;
  none change the R1-R10 contract, they make existing mechanisms honest under edge inputs.
  (1) Asserted-path coordinate tier `verified` → `geocoded` plus a cluster-trimmed guard (see A4 and
  the "Asserted path GROUNDS location" note above). (2) `computeEnvelope` now TRIMS the extreme
  values per axis (≥8 anchors, ~10% each end) so a single same-name outlier can't inflate the box and
  silently disable the guard, the antimeridian case is intentionally left as a wide-longitude box
  (latitude still guards). (3) `setCached` no longer caches a NON-CONVERGED asserted result (a
  transient builder failure that might converge on retry) for the 24h TTL; a CONVERGED-but-empty
  asserted result (a genuine vibe query) still caches. (4) `impliesLimit` now requires an explicit
  COUNT ("top 5", "3 largest", "nearest"), not any bare digit, so "World War 2" / "Group of 7" no
  longer suppress stray-LIMIT stripping (the old `\d+` rule was a silent recall cap, contra R2). (5)
  the builder's `everTested` gate only counts a test that EXECUTED (rows ≠ null); an errored test no
  longer licenses an `answer`. (6) cardinality `under` got the same 0.7× slack `over` already had, so
  a correct 9-of-~10 is not flagged as a recall gap. (7) input validation: the structured route
  type-checks `query` before use (a non-string body used to crash the process). Self-checked in
  `server/src/lib/checks.ts` (`npx tsx src/lib/checks.ts`): the limit-regex and envelope-trim edge
  cases. (Security/auth hardening from the same session, BYOK-only key handling, per-IP rate limiting,
  scoped CORS, Groq removal, is deployment infra outside this contract and is not logged here.)

- **Cost/latency benchmark (9 varied queries) exposed two real R10 gaps, not just cost tuning.**
  A deliberately varied 9-query sweep ($0.39 total, live WDQS + LLM) targeting distinct failure
  classes (cache reuse, duplicate-WHERE, non-point WHERE, ambiguous-entity resolution, count-limited
  cardinality, large-cardinality cost stress, a repeat of a prior non-convergence class, a genuinely
  unanswerable "vibe" query, and a previously-documented slow class) found:
  1. **Silent over-collection could wear a `structural` badge.** "Most romantic small towns in Italy"
     (no Wikidata property for "romantic") had the builder invent a population-range proxy for
     "small," returning 6,201 towns — all coord-tier `verified`. The R10 gate correctly flagged
     `cardinality: over` (expected ~5-30) and even attempted a repair, but when the repair wasn't
     strictly better, the ORIGINAL over-collected result was kept and emitted with membership mostly
     still `structural` — `over` fed the repair decision but never forced a final demotion. This is
     exactly the silent-confident-wrong shape R8/R10 exist to prevent, at $0.08 / 4.7 minutes.
  2. **Non-convergence could adopt a bare exploratory draft as the final answer.** "Rivers that form
     international borders in Europe" non-converged (11 steps, no `answer`); the fallback used
     whatever SPARQL was last tested, which happened to be a minimal shape-check draft with no
     `?coord`/`?why`/`?whyArticle` at all. Every node was silently forced through the geocode ladder
     (0 verified, 59 geocoded) while `verify` reported a clean "verified, 0 demoted" status — the
     status looked fine; the underlying query was malformed for its purpose.
  Two fixes, both R7-safe (capability/result branching, not content/shape):
  - **R10 terminal demotion on persistent over-collection** (`routes/structured.ts`): after a repair
    attempt (successful or not), if the surviving `cardinality.verdict` is still `over`, the whole
    result set is demoted to `asserted` membership — per-row type checks can't catch this shape
    (every row genuinely IS a "human settlement in Italy," just the wrong SCOPE), so the set-level
    signal now has teeth instead of being advisory-only.
  - **Output-contract gate on the builder's non-convergence fallback** (`lib/builder.ts`): a new
    `hasCoordBinding` check (requires `?coord` bound via `wdt:P625`) is enforced both at the `answer`
    step (pushed back for a fix, same discipline as the existing `everTested` gate) and on the
    non-convergence "last tested" fallback, which now tracks a separate `lastGoodTested` and prefers
    it; a tested-but-contract-violating draft is discarded in favour of the honest asserted fallback
    rather than emitted as a pin-producing "answer" that can never earn a `verified` coordinate.
  (4) **verify gate wall-time instrumentation** (`meta.verifyMs`, logged and returned) — a
  Nobel-laureates query took 68.7s on only 4 builder steps (vs 17-24s for comparable 3-step queries
  elsewhere in the same sweep), and the gap wasn't visible anywhere: R10's own batched WDQS calls
  (type-conformance, geographic-containment, rollup) scale with result count and were invisible in
  the builder-loop-only timing every prior latency pass (this whole section) was based on.

- **Top-5-by-area WDQS timeout (item 3 above), root-caused and fixed — first diagnosis was wrong.**
  The initial fix for the "Africa's 5 largest countries" timeout was an ORDER-BY-forces-materialisation
  builder hint, on the theory that sorting runs the OPTIONAL coord/article joins over the full unsorted
  set before LIMIT applies. Direct isolated WDQS testing (bypassing the LLM entirely — timing raw
  SPARQL variants by hand) DISPROVED it: the identical flat `ORDER BY ... LIMIT 5` query with all three
  OPTIONALs and the label SERVICE ran in ~1s, repeatably. The hint was removed rather than left on record
  as a fix that wasn't one. Two REAL, distinct, isolated-and-confirmed causes instead:
  1. **`impliesLimit` still silently stripped a real LIMIT.** "Which 5 African countries have the
     LARGEST area" separates the digit and the superlative by several words; the existing regex
     required adjacency (`\d+\s+largest`), so `impliesLimit` returned false and `stripStrayLimit`
     removed the builder's correct `LIMIT 5` — turning a ~1s bounded query into an unbounded sort over
     the whole class. Confirmed directly: identical query, `LIMIT 5` = ~1s, no `LIMIT` = 40s+ timeout,
     every time. Fixed (`lib/builder.ts impliesLimit`) with a bounded word-gap (≤4 words digit→
     superlative, ≤3 reverse) instead of strict adjacency; new cases added to `lib/checks.ts`,
     including a negative ("more than 5 official languages" must NOT imply a limit) to guard the
     original bare-digit bug this function already exists to prevent.
  2. **`BIND(?where AS ?why)` + a duplicate self-referential `?whyArticle` OPTIONAL is a severe,
     confirmed Blazegraph performance trap.** For a query with no distinct WHY (the country IS the
     answer — the system prompt's own "intrinsically-located things" case, alongside battles and
     monuments), the builder sometimes wrote `BIND(?where AS ?why)` as a workaround to satisfy the
     "always bind ?why" instruction, followed by the standard `OPTIONAL { ?whyArticle schema:about
     ?why ; ... }` — a near-duplicate of the `?whereArticle` OPTIONAL, just aliased. Isolated component-
     by-component: the GROUP BY/MAX subquery alone (~1.5s), the subquery + both OPTIONALs (~1s), the
     subquery + label SERVICE (~0.5s), and the subquery + OPTIONALs + label SERVICE with NO bind/why-
     duplicate (~1s) were all fast; adding the `BIND(?where AS ?why)` + duplicate `whyArticle` OPTIONAL
     back in was the ONLY variant that reproduced the 40-45s timeout, every time. Fixed at the prompt
     level (`lib/builder.ts` system prompt): the ?why contract now explicitly says to OMIT ?why/
     ?whyLabel/?whyArticle entirely for this case rather than self-bind, and names the trap so the
     agent doesn't reach for the workaround again.
  Verified end-to-end after both fixes: the original failing query now completes in **18.5s**
  (`enumerator=structured`, 5/5 `verified`, no error, `LIMIT 5` intact, no `?why` emitted) — down from
  64-91s of timeout-then-asserted-fallback across three prior attempts. *Lesson for this log itself:*
  the first "fix" was plausible-sounding and untested against live WDQS before being written down;
  the correction stands as a reminder to verify a root-cause theory against the real endpoint before
  logging it as done, not just against internal reasoning.

- **Off-Earth entities plotted as `verified` Earth pins (user-reported, live traffic — not a benchmark).**
  A real run of "Active volcanoes in the Pacific Ring of Fire" plotted `Loki`, `Thor`, `Pele`, `Surt`,
  `Prometheus`, `Amirani`, `Masubi`, `Maui`, `Zamama`, `Tonatiuh`, `Volund`, `Kanehekili` — all real
  Wikidata entities, all typed `volcano`, all `coord_tier: verified` — as if they were real Ring-of-Fire
  volcanoes on the map. Confirmed directly against Wikidata: every one is `wdt:P376` (located on
  astronomical body) = **Io**, Jupiter's moon, famously named after Earth fire/thunder deities. Root
  cause: an R9→R10 repair pass, trying to fix a recall gap (23 rows, expected 50-500), adopted a query
  that dropped the ENTIRE geographic scope — from a 23-country `VALUES` list down to a bare
  `?where wdt:P31/wdt:P279* wd:Q1330974` (any active volcano anywhere), because Wikidata models
  "volcano" as a general geological class shared across worlds, not an Earth-specific one. R10's type
  check correctly confirmed "yes, these are volcanoes" — it has no axis for "is this even on Earth."
  This is a GENERAL Wikidata gotcha (also applies to craters, seas, mountains — any physical-geography
  class with off-world namesakes), not volcano-specific, so the fix is a universal validity gate, not a
  query-specific patch: `lib/verify.ts offEarthEntities` batch-checks every `?where` entity's own `P376`
  and excludes (moves to `unresolved`, reason "off-Earth...") anything bound to a body other than Earth
  (Q2), run once per pipeline in `routes/structured.ts` right after rollup and before verify — so
  off-world pollution never counts toward cardinality or spends verification/geocode budget. Re-run of
  the same query confirmed the fix (Io names: none of the 12 present in the output). A DIFFERENT LLM
  run of the same query then surfaced a genuinely separate problem (see below) rather than the same one
  recurring, which is itself a useful confirmation this fix and the over-collection fix are independent.
  *Bug found while validating this fix, in the same session:* the re-run's second failure mode (query
  correctly scoped to Earth countries this time, but massively over-collected — 1177 rows vs an
  expected 50-600 — repair attempted and rejected as not-better) triggered the earlier over-collection
  terminal-demotion fix correctly at the NODE level (all 1171 nodes correctly `asserted`, verified by
  inspecting the raw output), but `meta.verification.demoted` still reported `0` — the report object's
  `demoted` count is snapshotted inside `verifyStructured` before the later demotion block runs, so the
  aggregate report undersold what had actually happened even though every individual node was honestly
  flagged. Fixed by reassigning `report` with the corrected count and an explanatory note after the
  terminal-demotion loop. Lower severity than the off-Earth bug (per-node badges were always correct;
  only the summary count lagged), but real, and only surfaced because the same query was run twice with
  different LLM outcomes — a reminder that a single validation run proves the mechanism works, not that
  every path through it reports itself correctly.

- **Demographic-realistic test round surfaced a crash and a wasted-spend transport failure.** Ten
  queries chosen to look like actual varied users (a kid: "Where can I see dinosaur bones", a casual
  tourist: "cool castles to visit", a retiree, a hobbyist, deliberately rough grammar, etc.) rather than
  edge-case stress tests. Two real, generic robustness gaps, both against the pipeline's transport/scale
  handling, not any query's content:
  1. **Malformed WDQS response body crashed the whole request.** "Where can I see dinosaur bones" hit
     `SyntaxError: Unterminated string in JSON` from inside `res.json()` in `lib/wikidata.ts` — WDQS
     returned HTTP 200 with a truncated/malformed body (a known Blazegraph failure mode under load).
     `runSparql`'s retry loop only recognised non-2xx statuses (`RETRYABLE_STATUS` = 429/503) as
     transient; a malformed *200* fell straight through as an uncaught exception and surfaced as a raw
     500 with a useless message. Fixed: wrap the `res.json()` parse in its own try/catch; on failure,
     treat it exactly like a 503 (record WDQS trouble, backoff, retry within the existing attempt/time
     budget), and only after retries are exhausted throw a proper `SparqlError(502, …)` so the caller's
     existing graceful-degradation path handles it like any other WDQS failure (PID R6 — loud, never an
     uncaught crash). Generic: applies to every `runSparql` call, not this query.
  2. **Extreme over-collection can burn spend and never deliver a result.** "cool castles to visit" gives
     the builder nothing to constrain on, so it correctly matched ~14,500 raw rows. The pipeline dutifully
     verified, geocoded, and demoted all of them (correctly — the earlier over-collection fix worked) but
     took 305s and the resulting JSON payload was large/slow enough that the client's connection died
     before the response ever arrived (undici's default 300s body timeout) — full LLM spend (~$0.08),
     zero delivered value. Fixed: a flat sanity ceiling (`MAX_STRUCTURED_ROWS = 3000`) in
     `routes/structured.ts`, checked right after rollup + off-Earth filtering and before the expensive
     verify/geocode/hydrate stage. Above it, the raw structured rows are discarded and the query is
     routed into the SAME bounded, curated model-knowledge (`asserted`) path already used for zero
     structured rows — reusing existing, already-R6-compliant degradation rather than inventing new
     behaviour, and setting `meta.error` so the "why did this look different" reason is visible, not
     silent. 3000 is a flat, untuned ceiling (`ponytail:` marked in code) — raise it only if a genuinely
     correct result set is ever observed landing above it; a result this large is unusable as individual
     map pins regardless of correctness.
  Both type-checked and passed `lib/checks.ts`. Live re-run of both queries after restart: neither
  crashed nor hung (dinosaur bones: clean asserted-fallback in 107s; castles: clean asserted-fallback in
  148s, safely under the transport ceiling). Honest caveat: neither retest happened to reproduce the
  EXACT original failure — WDQS non-determinism meant dinosaur bones hit a genuine 502 this time (an
  already-handled path, not the new malformed-JSON branch) and castles hit a 408 timeout before
  accumulating enough rows to reach the new cap. The new code paths are simple, single-guard changes,
  type/self-check clean, and the observed behaviour (graceful degradation, no crash, no hang) is
  consistent with them working — but this is inference from absence of failure, not a direct trigger, in
  keeping with the same honesty standard applied to the `report.demoted` fix above.

- **Adversarial "bored Gen Z kid" round surfaced a real R10 evasion: `BIND`-by-fiat sails through fully
  `verified`.** Ten deliberately hard queries — slang, memes, and half-nonsense with no clean referent
  ("skibidi toilet locations", "gyatt canyon", "sigma city real or nah", etc.) — chosen to test honesty
  under garbage input, not cost/perf. Most generalised well and are worth recording as evidence the
  contract holds: "haunted places fr fr" correctly matched Wikidata's real `haunted place` class (slang →
  real referent, no special-casing needed); "biggest ohio moments" and "delulu is the solulu but where"
  both got demoted to `asserted` by the existing type-conformance/cardinality checks exactly as designed;
  "npc cafes near a mall" gracefully discarded the un-mappable "npc" qualifier and only structured the
  parts with real Wikidata backing (cafés near malls) rather than fabricating a property for it.
  One real bug: **"rizz capital of the world"** — no Wikidata property could possibly express this, so
  the builder's own reasoning trace says outright *"Wikidata won't have this concept... let me just plot
  NYC as the rizz capital"* and emitted `BIND(wd:Q60 AS ?where) # NYC — widely cited origin of 'rizz'
  slang`. Because the picked entity is a real settlement with a real coordinate and there is exactly one
  row, R10's type-conformance and cardinality checks both trivially "pass" — the result displayed fully
  `verified`, zero `asserted` flag anywhere (`why: []`, no demotion, no notes). This is the exact
  "confident garbage" R10 exists to catch, arriving via a SPARQL shape neither of its checks can see: a
  `BIND` to a literal QID carries no Wikidata evidence at all, it is the model's own judgement dressed as
  a structured query result. Not query-specific — any subjective "capital/best/most X" framing with no
  real property behind it can trigger the same evasion. Two-layer fix, matching the session's established
  pattern (prompt fix for root cause + structural guard as a reliability backstop, since LLM compliance
  with a negative instruction is never guaranteed):
  1. `lib/builder.ts` system prompt: the `?where` contract now explicitly forbids `BIND(wd:Qxxx AS
     ?where)` to hand-pick an entity, and tells the agent that returning 0 rows when no real property
     links the request to a place is the CORRECT outcome (falls through to the existing, honestly-labelled
     asserted path), not a failure to avoid.
  2. `routes/structured.ts`: a regex guard (`/\bBIND\s*\(\s*wd:Q\d+\s+AS\s+\?where\s*\)/i`) detects the
     shape directly on the final SPARQL and force-demotes every affected row into the same `demote` Map
     the over-collection fix already uses — reusing the existing per-node demotion loop rather than adding
     new machinery. Capability/shape-based, not content-based (R7-safe): it fires on ANY query whose
     `?where` is fixed by BIND, regardless of what the query is about.
  Live re-run after restart: the prompt fix alone was sufficient this time — the builder wrote
  `FILTER(false)` with an explicit comment ("no Wikidata property... falls back to labelled model
  knowledge") instead of a bare BIND, correctly returning 0 structured rows. The asserted fallback then
  produced 5 candidate cities, all honestly `geocoded`/`asserted` — exactly the R6/R8-compliant output the
  original bug denied the user. Honest caveat: this run validates the PROMPT layer; it did not exercise
  the structural regex backstop (no bare BIND was produced to catch), so that guard's correctness rests on
  code review + type/self-check, not a live trigger — same caveat class as the two robustness fixes above.

- **Model-enumeration "why" text had no guardrail against demographic generalization.** Inspecting the
  `rizz capital of the world` asserted-path output (above) surfaced a content-quality issue distinct from
  the pipeline bug: candidate justifications leaned on sweeping ethnic/national generalizations presented
  as fact ("Nigerian street culture... most naturally charming", "British... Roadman and drill scene...
  crediting UK youth culture"). Root cause: `lib/enumerate.ts`'s `modelEnumerate` prompt asks for "a
  one-line description of why it matches" with zero constraint on what kind of reasoning is acceptable —
  this is the ONE place in the pipeline where free-text `why` justification is model-generated rather than
  sourced from a real Wikidata label (the structured path's `?why` always comes from Wikidata; only the
  asserted/model-knowledge fallback free-associates). Generic to any subjective query, not "rizz"-specific.
  Fixed with one line in the prompt: ground each description in a specific, checkable fact (a named event,
  institution, statistic, or person) and explicitly forbid generalizing about a nationality/ethnicity/
  culture's traits. Live re-run confirmed the change: the same query now returns reasoning grounded in
  named specifics (Kai Cenat coining the term, Oxford's 2023 Word of the Year, Tom Holland's viral Buzzfeed
  interview, named creators) with no demographic generalization language. R7-safe (a uniform prompt
  constraint applied to every asserted-path call, not a query-content branch).
