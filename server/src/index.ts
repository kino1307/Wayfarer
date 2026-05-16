import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

import titlesRouter from './routes/titles.js'
import wikipediaRouter from './routes/wikipedia.js'
import queryRouter from './routes/query.js'
import analyseRouter from './routes/analyse.js'
import chipsRouter from './routes/chips.js'

dotenv.config({ path: path.resolve(process.cwd(), '../.env') })

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors())
app.use(express.json({ limit: '2mb' }))

// Routes
app.use('/api/titles', titlesRouter)
app.use('/api/wikipedia', wikipediaRouter)
app.use('/api/query', queryRouter)
app.use('/api/analyse', analyseRouter)
app.use('/api/chips', chipsRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`Terriq API:    http://localhost:${PORT}`)
  console.log(`Terriq app:    http://localhost:5173`)
})
