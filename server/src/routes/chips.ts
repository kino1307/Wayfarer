import { Router, Request, Response } from 'express'
import { callClaude, parseJsonResponse } from '../lib/anthropic.js'

const router = Router()

router.post('/', async (req: Request, res: Response) => {
  const { history, model, random } = req.body as { history: string[]; model: string; random?: boolean }
  const apiKey = req.headers['x-api-key'] as string

  const VALID_MODELS = new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-opus-4-6'])

  if (!apiKey) return res.status(401).json({ error: 'Missing API key' })
  if (!model) return res.status(400).json({ error: 'Missing model' })
  if (!VALID_MODELS.has(model)) return res.status(400).json({ error: 'Invalid model' })

  const THEMES = [
    'ancient civilisations', 'natural disasters', 'space exploration sites', 'Cold War history',
    'famous battles', 'migration routes', 'endangered ecosystems', 'industrial revolutions',
    'royal dynasties', 'colonial history', 'scientific discoveries', 'music scenes',
    'sporting legends', 'religious pilgrimages', 'trade routes', 'volcanic activity',
    'wildlife habitats', 'architectural wonders', 'revolutions and uprisings', 'polar exploration',
  ]

  let prompt: string
  if (random || !history?.length) {
    // Pick 3 random themes as inspiration so results vary across refreshes
    const shuffled = [...THEMES]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const picks = shuffled.slice(0, 3).join(', ')
    prompt = `You are generating example queries for a geographic map intelligence tool. Draw inspiration from these themes: ${picks}.

Generate 6 short, varied, genuinely interesting mappable queries. Mix time periods, regions, and topics — no two should feel similar.

Return ONLY a JSON array of 6 strings. No markdown, no preamble.`
  } else {
    const historyStr = history.slice(-5).join(', ')
    prompt = `You are suggesting follow-up map queries for a geographic intelligence tool. Recent searches: ${historyStr}.

Generate 6 short, diverse, interesting follow-up query suggestions that are related to or inspired by these searches but explore different angles, time periods, themes, or regions. Each suggestion should be a complete mappable query.

Return ONLY a JSON array of 6 strings. No markdown, no preamble.`
  }

  try {
    const text = await callClaude(apiKey, model, prompt, 512)
    const suggestions = parseJsonResponse(text) as string[]
    return res.json({ suggestions })
  } catch (err) {
    console.error('chips error:', err)
    return res.status(500).json({ error: 'Failed to generate suggestions' })
  }
})

export default router
