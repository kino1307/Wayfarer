import { Router, Request, Response } from 'express'
import { streamClaude, extractNextJsonObject, maxTokensForModel } from '../lib/anthropic.js'
import type { LocationRole } from '../lib/anthropic.js'

const router = Router()

const VALID_MODELS = new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'])

interface Location {
  name: string
  lat: number
  lng: number
  country: string
  description: string
  year: string | null
  wiki_url: string
  role?: LocationRole
  relevant?: boolean
}

function isValidLocation(loc: unknown): loc is Location {
  if (!loc || typeof loc !== 'object') return false
  const l = loc as Record<string, unknown>
  return (
    typeof l.name === 'string' && l.name.length > 0 &&
    typeof l.lat === 'number' && isFinite(l.lat) && l.lat >= -90 && l.lat <= 90 &&
    typeof l.lng === 'number' && isFinite(l.lng) && l.lng >= -180 && l.lng <= 180 &&
    typeof l.description === 'string' &&
    typeof l.country === 'string'
  )
}

function sseEvent(res: Response, data: unknown) {
  if (!res.writable) return
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

router.post('/', async (req: Request, res: Response) => {
  const { query, model, wikiContext } = req.body as {
    query: string
    model: string
    wikiContext?: { title: string; text: string }
  }
  const apiKey = req.headers['x-api-key'] as string

  if (!apiKey) return res.status(401).json({ error: 'Missing API key' })
  if (!query || !model) return res.status(400).json({ error: 'Missing query or model' })
  if (!VALID_MODELS.has(model)) return res.status(400).json({ error: 'Invalid model' })

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const MAX_LOCATIONS = 50

  const MIN_ARTICLE_CHARS = 800
  const articleIsRich = wikiContext && wikiContext.text.trim().length >= MIN_ARTICLE_CHARS
  const isGrounded = articleIsRich

  let prompt: string

  if (articleIsRich && wikiContext) {
    const encodedTitle = encodeURIComponent(wikiContext.title.replace(/ /g, '_'))
    const articleText = wikiContext.text.slice(0, 60000)
    const isTruncated = wikiContext.text.length > 60000
    prompt = `You are a geographic research assistant. Extract every mappable location from the Wikipedia article below.

WIKIPEDIA ARTICLE: "${wikiContext.title}"
SOURCE URL: https://en.wikipedia.org/wiki/${encodedTitle}
${isTruncated ? '(Note: article was truncated — supplement with your knowledge of remaining locations in this article)\n' : ''}---
${articleText}
---

The user's query is: <query>${query}</query>

The article above may contain "--- LINKED ARTICLE: Title ---" sections. Use these only to enrich details about locations already established by the primary article. Do NOT extract locations that appear only in a linked article section and have no connection to "${wikiContext.title}" itself.

Return a JSON array only. Each object MUST have:
{"name":"specific place name","lat":0.0,"lng":0.0,"country":"country name","description":"1-2 sentences describing this location","year":"year or era or null","wiki_url":"https://en.wikipedia.org/wiki/ARTICLE_TITLE","role":"birthplace|raised|residence|active|venue|origin|location","relevant":true}

role must be one of:
- birthplace: where a person was born
- raised: where a person grew up
- residence: where a person lives or lived
- active: where a person/group works, performs, or is based
- venue: performance, event, or ceremony location
- origin: where something was created or founded
- location: general geographic association (use this for non-person articles)

relevant: Ask yourself — "Does this location directly answer the user's query?" Set true only if yes.
- If the query asks for a specific type (pubs, filming locations, birthplaces, battle sites, tour venues), only locations of that exact type are relevant. Everything else in the article — setting descriptions, premiere cities, festival screenings, tributes, protests, critical reception locations — is false.
- If the query has a geographic constraint ("in Europe", "in Asia"), locations outside that region are false.
- If there is no type or geographic constraint, use true for all locations from the primary article.

For wiki_url: use the most specific Wikipedia article for that individual location. If none exists, use the source article URL.

Rules:
- Return ONLY raw JSON. No markdown, no backticks, no preamble.
- Order entries by relevance to the query — most directly relevant first.
- Return at most ${MAX_LOCATIONS} locations total. Stop after ${MAX_LOCATIONS} entries.
- Coordinates (lat/lng) may come from your geographic knowledge.
- Every entry MUST have a wiki_url, a role, and a relevant field.`
  } else {
    const wikiHint = wikiContext
      ? `\n\nUse the Wikipedia article "${wikiContext.title}" (https://en.wikipedia.org/wiki/${encodeURIComponent(wikiContext.title.replace(/ /g, '_'))}) as your primary source — extract every location that article covers.`
      : ''

    prompt = `You are a geographic research assistant. The user wants to map locations matching: "${query}"${wikiHint}

Return a JSON array. Each item MUST have:
- "name": the place name only, e.g. "Jakarta" or "Naperville" — not the person's name (string)
- "lat": latitude (number)
- "lng": longitude (number)
- "country": country name (string)
- "description": 1-2 sentence factual description relevant to the query (string)
- "year": approximate year or era if relevant (string or null)

Rules:
- Return ONLY raw JSON. No markdown, no backticks, no preamble.
- Order entries by relevance — most important or most directly relevant to the query first.
- Return at most ${MAX_LOCATIONS} locations. Stop after ${MAX_LOCATIONS} entries.
- Respect every constraint in the query exactly. If the query specifies a region, only include locations in that region. If it specifies a type, only include that type.
- If the query asks about birthplaces, hometowns, or origins of specific people or a named group, return ONE entry per person — name the specific individual in the description field. Do NOT aggregate multiple people into one city entry.
- Do NOT include a wiki_url field — Wikipedia URLs will be looked up separately.`
  }

  console.log(`[query] mode=${isGrounded ? 'grounded' : 'memory'} article="${wikiContext?.title ?? 'none'}" chars=${wikiContext?.text.length ?? 0}`)

  let jsonBuffer = ''
  let scanFrom = 0
  let sent = 0
  let dropped = 0

  try {
    await streamClaude(apiKey, model, prompt, maxTokensForModel(model), (chunk) => {
      jsonBuffer += chunk

      while (true) {
        const result = extractNextJsonObject(jsonBuffer, scanFrom)
        if (!result) break
        scanFrom = result.end

        let loc: unknown
        try { loc = JSON.parse(result.obj) } catch { continue }
        if (!isValidLocation(loc)) continue

        if (isGrounded) {
          // In grounded mode Claude marks relevant:true/false inline.
          // If the field is absent (e.g. model didn't emit it), default to showing the pin.
          const l = loc as Location
          if (l.relevant === false) { dropped++; continue }
          sseEvent(res, { type: 'location', data: l })
          sent++
        } else {
          // Memory mode: emit immediately without wiki URL — grounded phase fills these in.
          sseEvent(res, { type: 'location', data: { ...loc as Location, wiki_url: '' } })
          sent++
        }

        // Hard cap — return false to stop the stream immediately
        if (sent >= MAX_LOCATIONS) return false
      }
    })

    sseEvent(res, {
      type: 'done',
      mode: isGrounded ? 'grounded' : 'memory',
      dropped,
      wikiSource: wikiContext?.title ?? null,
    })
    console.log(`[query] done sent=${sent} dropped=${dropped}`)
  } catch (err) {
    console.error('[query] error:', err)
    sseEvent(res, { type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
  } finally {
    res.end()
  }
})

export default router
