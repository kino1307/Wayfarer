# Wayfarer

Spatial intelligence tool. Type any query and it maps every relevant location worldwide —
grounded in [Wikidata](https://www.wikidata.org/), not guessed by an LLM.

## How it works

1. **Anchor resolution** — named entities in the query (a band, a war, a country) are pinned
   to their real Wikidata IDs, never guessed.
2. **Schema-discovery agent** — rather than answering from a fixed set of examples, the agent
   reads Wikidata's own schema at query time: it searches for the relevant properties/classes,
   probes how real instances are modelled, and builds + tests a SPARQL query live against
   Wikidata before ever proposing it as an answer.
3. **Verification gate** — before a result is shown, it's checked along independent axes (does
   each result match the expected type, does the row count look sane, does a sample of results
   hold up under a second, independent check). A failed check triggers one bounded repair pass;
   if the query still can't be trusted, it's downgraded — never dropped.
4. **Honest tiering** — every pin carries two separate trust labels, shown plainly on the map:
   - **Coordinate trust**: `verified` (Wikidata's own coordinate) → `geocoded` → `approximate`
   - **Membership trust**: `structural` (confirmed by a real Wikidata relationship) vs
     `asserted` (the model's own claim, no structural backing)
   A pin only looks fully "clean" when both are the strongest tier — anything weaker is visibly
   flagged, not silently blended in.
5. **Fallback, not failure** — if Wikidata has no structured answer for a query (subjective or
   very recent topics), the app falls back to curated model knowledge instead of returning
   nothing — every result from that path is honestly labelled `asserted`.
6. **Nothing vanishes quietly** — anything that couldn't be resolved or verified is reported in
   an `unresolved` list with a reason, never just dropped from the result.

The full contract this is built against — the hard invariants, the pipeline design, and a
running build log of every bug found and fixed — is in [`PID.md`](PID.md).

## Quick start (local dev)

```bash
# 1. Copy env
cp .env.example .env
# defaults are fine for local dev — see .env.example for what each var does

# 2. Install all dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 3. Run both dev servers
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and paste in your own Anthropic API key
(BYOK — bring your own key). The key is stored only in your browser's `localStorage` and sent
per-request; the server never holds or logs it.

## Running in Docker

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). See [`docker-compose.yml`](docker-compose.yml)
and `.env.example` for configuration (`ALLOWED_ORIGINS`, optional `GEMINI_API_KEY` for the
Gemini benchmark model). No Anthropic key is needed server-side — BYOK is entered in the browser.

## Stack

- **Client:** React 18, TypeScript, Vite, Tailwind CSS, Leaflet / React-Leaflet
- **Server:** Node.js, Express, TypeScript
- **AI:** Anthropic Claude (Haiku / Sonnet / Opus), BYOK — no server-side key required
- **Knowledge:** [Wikidata](https://www.wikidata.org/) (CC0, queried live via SPARQL/WDQS)
- **Map tiles:** OpenStreetMap (free, no key required)

## Notes

- Results are cached cross-user for 24h (identical query + model = free, instant repeat) —
  in-memory by default; swap to Redis before running multiple server instances.
- A per-IP rate limit protects the expensive LLM-agent endpoints; it's in-memory too and is
  single-instance only (see the `ponytail:` comment in `server/src/index.ts`).
