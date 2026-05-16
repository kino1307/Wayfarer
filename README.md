# Terriq

Spatial intelligence tool — type any query and map every relevant location globally.

## Quick start

```bash
# 1. Copy env and add your Anthropic API key
cp .env.example .env
# edit .env → ANTHROPIC_API_KEY=sk-ant-...

# 2. Install all dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 3. Run both dev servers
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Stack

- **Client** — React 18, TypeScript, Vite, Tailwind CSS, Leaflet / React-Leaflet
- **Server** — Node.js, Express, TypeScript, tsx
- **AI** — Anthropic (Haiku / Sonnet / Opus)
- **Map tiles** — OpenStreetMap (free, no key required)
- **Knowledge** — Wikipedia REST API (free, no key required)

## How it works

1. Claude suggests Wikipedia article titles for your query
2. The best matching Wikipedia article is fetched as grounded context
3. Claude extracts locations from the article (or falls back to model knowledge)
4. Pins are verified against Wikipedia and plotted on the map
5. Click **Analyse pattern** for geographic insight
6. Chip suggestions update after each search
