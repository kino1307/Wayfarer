import cache from './cache.js'

const WIKI_API = 'https://en.wikipedia.org/w/api.php'

export interface WikiArticle {
  title: string
  text: string
}

// Fetch intro paragraphs for multiple articles in batches of 20.
// Intros summarise the key facts Claude needs — birthplace, location, dates —
// without the cost and rate-limit exposure of full article fetches.
// Wikipedia limits full-article batch extracts to 1 per request, but sequential
// individual requests at this scale don't trigger 429 rate limiting.
export async function fetchArticlesBatch(
  titles: string[],
  batchSize = 20,
  onProgress?: (msg: string) => void,
): Promise<WikiArticle[]> {
  if (titles.length === 0) return []

  // Serve any titles already cached without touching Wikipedia at all.
  const uncached: string[] = []
  const fromCache: WikiArticle[] = []
  for (const t of titles) {
    const hit = cache.get<WikiArticle>(`wiki_intro:${t}`)
    if (hit) fromCache.push(hit)
    else uncached.push(t)
  }

  if (uncached.length === 0) {
    console.log(`[wiki/batch] all ${titles.length} titles served from cache`)
    onProgress?.(`Done — ${fromCache.length} article${fromCache.length === 1 ? '' : 's'} ready (cached)`)
    return fromCache
  }

  const totalBatches = Math.ceil(uncached.length / batchSize)
  console.log(`[wiki/batch] starting intro pass: ${uncached.length} uncached titles, ${totalBatches} batch${totalBatches === 1 ? '' : 'es'} (${fromCache.length} served from cache)`)
  onProgress?.(`Screening candidates: ${totalBatches} batch${totalBatches === 1 ? '' : 'es'} (${uncached.length} to fetch)…`)

  const intros: WikiArticle[] = [...fromCache]
  let consecutiveFailures = 0

  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    console.log(`[wiki/batch] intro batch ${batchNum}/${totalBatches}: ${batch.join(', ')}`)
    onProgress?.(`Screening batch ${batchNum}/${totalBatches}…`)
    const batchIntros = await fetchBatchIntro(batch, onProgress)

    // Cache each successfully fetched article intro
    for (const article of batchIntros) {
      cache.set(`wiki_intro:${article.title}`, article, 3600)
    }

    intros.push(...batchIntros)
    console.log(`[wiki/batch] intro batch ${batchNum}/${totalBatches}: got ${batchIntros.length} results`)
    onProgress?.(`Screened batch ${batchNum}/${totalBatches} — ${intros.length} articles found so far`)

    if (i + batchSize < uncached.length) {
      if (batchIntros.length === 0) {
        consecutiveFailures++
        if (consecutiveFailures >= 2) {
          console.log(`[wiki/batch] 2 consecutive rate-limit failures — stopping early`)
          onProgress?.(`Wikipedia rate limited — stopping early, ${intros.length} articles ready`)
          break
        }
        // Wait longer after a failed batch to let the rate limit window clear
        console.log(`[wiki/batch] rate-limited batch, waiting 15s before next`)
        await new Promise(r => setTimeout(r, 15_000))
      } else {
        consecutiveFailures = 0
        // 2s between successful batches — gentler than 1s, avoids burst triggers
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }

  console.log(`[wiki/batch] done: ${intros.length} intros ready`)
  onProgress?.(`Done — ${intros.length} article${intros.length === 1 ? '' : 's'} ready`)
  return intros
}

async function fetchBatchIntro(titles: string[], onProgress?: (msg: string) => void): Promise<WikiArticle[]> {
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'plain',
    exintro: '1',
    format: 'json',
    formatversion: '2',
    redirects: '1',
  })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${WIKI_API}?${params}`, {
        headers: { 'User-Agent': 'Terriq/1.0 (geographic research tool)' },
      })
      if (res.status === 429) {
        const wait = (attempt + 1) * 3000
        console.log(`[wiki/batch-intro] 429 rate limit, retrying in ${wait}ms (attempt ${attempt + 1})`)
        onProgress?.(`Wikipedia rate limited — retrying in ${wait / 1000}s…`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (!res.ok) {
        console.log(`[wiki/batch-intro] HTTP ${res.status} for batch of ${titles.length}`)
        return []
      }
      const data = await res.json() as {
        query: { pages: Array<{ title: string; extract?: string; missing?: boolean }> }
      }
      const pages = data.query?.pages ?? []
      return pages
        .filter(p => !p.missing && p.extract?.trim())
        .map(p => ({ title: p.title, text: p.extract!.trim() }))
    } catch (err) {
      console.log(`[wiki/batch-intro] error: ${err}`)
      return []
    }
  }
  return []
}

async function fetchSingleArticle(title: string): Promise<WikiArticle | null> {
  const key = `wiki_single:${title}`
  const cached = cache.get<WikiArticle | null>(key)
  if (cached !== undefined) return cached

  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'plain',
    format: 'json',
    formatversion: '2',
    redirects: '1',
  })

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${WIKI_API}?${params}`, {
        headers: { 'User-Agent': 'Terriq/1.0 (geographic research tool)' },
      })
      if (res.status === 429) {
        const wait = (attempt + 1) * 3000
        console.log(`[wiki/single] 429 rate limit for "${title}", retrying in ${wait}ms`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (!res.ok) {
        console.log(`[wiki/single] HTTP ${res.status} for "${title}"`)
        cache.set(key, null)
        return null
      }
      const data = await res.json() as {
        query: { pages: Array<{ title: string; extract?: string; missing?: boolean }> }
      }
      const page = data.query?.pages?.[0]
      if (!page || page.missing || !page.extract?.trim()) {
        console.log(`[wiki/single] null for "${title}" missing=${page?.missing} extractLen=${page?.extract?.length ?? 0}`)
        cache.set(key, null)
        return null
      }
      const result = { title: page.title, text: page.extract.trim() }
      cache.set(key, result)
      return result
    } catch {
      cache.set(key, null)
      return null
    }
  }
  cache.set(key, null)
  return null
}

export async function fetchArticles(titles: string[]): Promise<WikiArticle | null> {
  const key = `wiki_fetch:${JSON.stringify(titles)}`
  const cached = cache.get<WikiArticle | null>(key)
  if (cached !== undefined) return cached

  // Fetch each article individually — Wikipedia's batch extract API silently drops
  // large articles when the combined response exceeds its size limit.
  const results = await Promise.all(titles.map(t => fetchSingleArticle(t)))

  // Trust Claude's title ordering: return the first article with enough content.
  // This avoids picking a long general-concept article (e.g. "Roman Emperor")
  // over a more specific list article (e.g. "List of Roman emperors") that Claude
  // ranked first but which may be shorter after table-stripping.
  const MIN_CHARS = 500
  for (const article of results) {
    if (article && article.text.length >= MIN_CHARS) {
      cache.set(key, article)
      return article
    }
  }

  cache.set(key, null)
  return null
}

// Fetch internal wikilinks from an article (up to 500), returned as page titles.
// Used to do a second hop: e.g. get all member links from a group article.
export async function fetchPageLinks(title: string): Promise<string[]> {
  const key = `wiki_links:${title}`
  const cached = cache.get<string[]>(key)
  if (cached !== undefined) return cached

  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'links',
    pllimit: '500',
    plnamespace: '0',
    format: 'json',
    formatversion: '2',
    redirects: '1',
  })

  try {
    const res = await fetch(`${WIKI_API}?${params}`, {
      headers: { 'User-Agent': 'Terriq/1.0 (geographic research tool)' },
    })
    if (!res.ok) { cache.set(key, []); return [] }

    const data = await res.json() as {
      query: { pages: Array<{ links?: Array<{ title: string }> }> }
    }
    const links = data.query?.pages?.[0]?.links?.map(l => l.title) ?? []
    cache.set(key, links)
    return links
  } catch {
    cache.set(key, [])
    return []
  }
}

// Search Wikipedia for a name and return the canonical URL of the best match, or null.
// Used instead of trusting Claude-generated URLs.
export async function searchWikiUrl(name: string): Promise<string | null> {
  const key = `wiki_search:${name}`
  const cached = cache.get<string | null>(key)
  if (cached !== undefined) return cached

  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: name,
    srlimit: '1',
    srnamespace: '0',
    format: 'json',
    formatversion: '2',
  })

  try {
    const res = await fetch(`${WIKI_API}?${params}`, {
      headers: { 'User-Agent': 'Terriq/1.0 (geographic research tool)' },
    })
    if (!res.ok) { cache.set(key, null); return null }

    const data = await res.json() as {
      query: { search: Array<{ title: string }> }
    }
    const hit = data.query?.search?.[0]
    if (!hit) { cache.set(key, null); return null }

    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`
    cache.set(key, url)
    return url
  } catch {
    cache.set(key, null)
    return null
  }
}

export async function verifyArticle(title: string): Promise<{ exists: boolean; canonicalUrl: string | null }> {
  const key = `wiki_verify:${title}`
  const cached = cache.get<{ exists: boolean; canonicalUrl: string | null }>(key)
  if (cached !== undefined) return cached

  // Extract article title from URL if a full URL is passed
  let articleTitle = title
  if (title.startsWith('https://en.wikipedia.org/wiki/')) {
    articleTitle = decodeURIComponent(title.replace('https://en.wikipedia.org/wiki/', ''))
  }

  const params = new URLSearchParams({
    action: 'query',
    titles: articleTitle,
    format: 'json',
    formatversion: '2',
    redirects: '1',
  })

  try {
    const res = await fetch(`${WIKI_API}?${params}`, {
      headers: { 'User-Agent': 'Terriq/1.0 (geographic research tool)' },
    })

    if (!res.ok) {
      const result = { exists: false, canonicalUrl: null }
      cache.set(key, result)
      return result
    }

    const data = await res.json() as {
      query: { pages: Array<{ title: string; missing?: boolean }> }
    }

    const pages = data.query?.pages ?? []
    const page = pages[0]
    const exists = !!page && !page.missing

    const result = {
      exists,
      canonicalUrl: exists
        ? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`
        : null,
    }
    cache.set(key, result)
    return result
  } catch {
    const result = { exists: false, canonicalUrl: null }
    cache.set(key, result)
    return result
  }
}
