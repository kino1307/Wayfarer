import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

import analyseRouter from './routes/analyse.js'
import chipsRouter from './routes/chips.js'
import structuredRouter from './routes/structured.js'

dotenv.config({ path: path.resolve(process.cwd(), '../.env') })

const app = express()
const PORT = process.env.PORT ?? 3001

// CORS: only the configured origins may call the API (no more wildcard `*`).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean)
app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json({ limit: '2mb' }))

// ponytail: in-memory fixed-window per-IP rate limit. Single-instance only; swap to a shared
// store (Redis) or express-rate-limit if we run multiple instances or need sliding windows.
// Each request runs a 20-100s LLM agent loop, so a low cap is the right abuse guard.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 20 // requests/min/IP
const hits = new Map<string, { count: number; reset: number }>()
setInterval(() => {
  const now = Date.now()
  for (const [ip, h] of hits) if (now > h.reset) hits.delete(ip)
}, RATE_WINDOW_MS).unref()
function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? 'unknown'
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now > h.reset) { hits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS }); next(); return }
  if (h.count >= RATE_MAX) {
    res.setHeader('Retry-After', String(Math.ceil((h.reset - now) / 1000)))
    res.status(429).json({ error: 'Rate limit exceeded — slow down and retry shortly.' })
    return
  }
  h.count++
  next()
}

// Routes (rate-limited; the LLM endpoints are the expensive ones)
app.use('/api/analyse', rateLimit, analyseRouter)
app.use('/api/chips', rateLimit, chipsRouter)
app.use('/api/structured', rateLimit, structuredRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`Orbis API:    http://localhost:${PORT}`)
  console.log(`Orbis app:    http://localhost:5173`)
})
