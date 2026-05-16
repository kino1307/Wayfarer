import { Router, Request, Response } from 'express'
import { callClaude } from '../lib/anthropic.js'

const router = Router()

const WIKI_API = 'https://en.wikipedia.org/w/api.php'

// Extract the core Wikipedia-searchable entity/topic from a natural-language query.
// Uses a minimal Claude call (~10 tokens output) rather than the full query string,
// because Wikipedia search is bad at inferring intent from conversational queries.
// e.g. "Birthplaces of Katseye members" → "Katseye"
//      "Top 10 most populous US cities"  → "United States cities by population"
//      "Medieval plague outbreaks"        → "Black Death"
async function extractSearchTerm(query: string, apiKey: string, model: string): Promise<string> {
  const prompt = `Extract the core Wikipedia search term from this query. Return ONLY the search term — no explanation, no punctuation.

Examples:
"Birthplaces of Katseye members" → Katseye
"Where did Taylor Swift grow up" → Taylor Swift
"Top 10 most populous US cities" → United States cities by population
"Medieval plague outbreaks in Europe" → Black Death
"Birthplaces of Roman emperors" → List of Roman emperors
"Grammy Award winners 2020" → 62nd Grammy Awards
"Tour locations for Beyoncé Renaissance" → Renaissance World Tour

Query: <query>${query}</query>`

  try {
    const term = await callClaude(apiKey, model, prompt, 32)
    return term.trim().replace(/^["']|["']$/g, '')
  } catch {
    // Fallback to raw query if Claude call fails
    return query
  }
}

// Ask Claude which of the candidate Wikipedia titles best matches the user's query.
// Returns the titles list with the best pick promoted to position 0.
// Uses a minimal token budget — just a single digit in response.
async function rankTitles(query: string, titles: string[], apiKey: string, model: string): Promise<string[]> {
  if (titles.length <= 1) return titles
  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const prompt = `Query: <query>${query}</query>

Wikipedia search results:
${numbered}

Which single article number would best help answer this query? Return only the number.`
  try {
    const answer = await callClaude(apiKey, model, prompt, 8)
    const idx = parseInt(answer.trim(), 10) - 1
    if (idx > 0 && idx < titles.length) {
      const best = titles[idx]
      return [best, ...titles.filter(t => t !== best)]
    }
  } catch {
    // fall through — return original order
  }
  return titles
}

// POST /api/titles — returns Wikipedia article title suggestions for a query.
router.post('/', async (req: Request, res: Response) => {
  const { query, model } = req.body as { query: string; model: string }
  const apiKey = req.headers['x-api-key'] as string

  if (!apiKey) return res.status(401).json({ error: 'Missing API key' })
  if (!query) return res.status(400).json({ error: 'Missing query' })

  // Step 1: Extract the core entity/topic from the query
  const searchTerm = await extractSearchTerm(query, apiKey, model)
  console.log(`[titles] query="${query}" → search term="${searchTerm}"`)

  // Step 2: Search Wikipedia for that term
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: searchTerm,
    srlimit: '6',
    srnamespace: '0',
    format: 'json',
    formatversion: '2',
  })

  try {
    const wikiRes = await fetch(`${WIKI_API}?${params}`, {
      headers: { 'User-Agent': 'Terriq/1.0 (geographic research tool)' },
    })
    if (!wikiRes.ok) return res.status(502).json({ error: 'Wikipedia search failed' })

    const data = await wikiRes.json() as {
      query: { search: Array<{ title: string }> }
    }
    const titles = data.query?.search?.map(r => r.title) ?? []
    console.log(`[titles] wikipedia results →`, titles)

    // Re-rank: ask Claude which article best answers the query, promote it to front.
    const ranked = await rankTitles(query, titles, apiKey, model)
    console.log(`[titles] ranked →`, ranked)
    return res.json({ titles: ranked })
  } catch (err) {
    console.error('titles error:', err)
    return res.status(500).json({ error: 'Failed to fetch titles' })
  }
})

export default router
