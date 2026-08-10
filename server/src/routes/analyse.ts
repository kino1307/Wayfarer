import { Router, Request, Response } from 'express'
import { callClaude } from '../lib/anthropic.js'

const router = Router()

interface Location {
  name: string
  lat: number
  lng: number
  country: string
}

router.post('/', async (req: Request, res: Response) => {
  const { query, locations, model } = req.body as {
    query: string
    locations: Location[]
    model: string
  }
  const apiKey = req.headers['x-api-key'] as string

  const VALID_MODELS = new Set([
    'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-opus-4-6',
    'openai:gpt-5.6-sol', 'openai:gpt-5.6-terra', 'openai:gpt-5.6-luna',
  ])

  if (!apiKey) return res.status(401).json({ error: 'Missing API key' })
  if (!query || !locations || !model) return res.status(400).json({ error: 'Missing required fields' })
  if (!VALID_MODELS.has(model)) return res.status(400).json({ error: 'Invalid model' })

  const locationList = locations
    .map(loc => `${loc.name} (${loc.country}, ${loc.lat.toFixed(4)}°, ${loc.lng.toFixed(4)}°)`)
    .join(', ')

  const prompt = `You mapped ${locations.length} locations for the query: "${query}".

Locations: ${locationList}

In 3-4 sentences, analyse the geographic pattern. Why are results clustered where they are? What does the spatial distribution reveal? Be specific about the regions and explain the underlying reasons (geological, historical, cultural, political etc). Be concise and insightful.`

  try {
    const insight = await callClaude(apiKey, model, prompt, 512)
    return res.json({ insight })
  } catch (err) {
    console.error('analyse error:', err)
    return res.status(500).json({ error: 'Failed to analyse pattern' })
  }
})

export default router
