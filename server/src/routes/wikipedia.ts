import { Router, Request, Response } from 'express'
import { fetchArticles, fetchArticlesBatch, fetchPageLinks, verifyArticle } from '../lib/wikipedia.js'

const router = Router()

// GET /api/wikipedia/fetch?titles=Title1|Title2|...
// Returns the best article plus text from any linked sub-articles (e.g. member pages).
// Streams SSE progress events ({type:'progress',message:'...'}) then a final
// {type:'result',data:{title,text}|null} event.
router.get('/fetch', async (req: Request, res: Response) => {
  const titlesParam = req.query.titles as string
  if (!titlesParam) return res.status(400).json({ error: 'Missing titles parameter' })

  const titles = titlesParam.split('|').map(t => t.trim()).filter(Boolean)
  if (titles.length === 0) return res.status(400).json({ error: 'No valid titles' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  function progress(message: string) {
    if (!res.writable) return
    res.write(`data: ${JSON.stringify({ type: 'progress', message })}\n\n`)
  }

  try {
    progress(`Selecting article from ${titles.length} candidate${titles.length === 1 ? '' : 's'}…`)
    const article = await fetchArticles(titles)
    console.log('[wiki/fetch] candidates:', titles)
    console.log('[wiki/fetch] selected:', article ? `"${article.title}" (${article.text.length} chars)` : 'null')

    if (!article) {
      res.write(`data: ${JSON.stringify({ type: 'result', data: null })}\n\n`)
      return res.end()
    }

    progress(`Found "${article.title}" — fetching linked article list…`)

    // Second hop: fetch linked articles and append their text.
    const links = await fetchPageLinks(article.title)
    console.log(`[wiki/fetch] linked pages: ${links.length}`)

    const isListArticle = /^list of /i.test(article.title)

    let candidateLinks: string[]
    if (isListArticle) {
      // Skip Wikipedia meta-links and list-within-list articles only.
      // Deliberately keep battles, wars, kingdoms, empires, etc. — those are valid
      // location-bearing articles for queries like "WWI battlefields" or "Roman wars".
      const SKIP = /^(list of |category:|wikipedia:|template:|file:|special:|portal:)/i
      candidateLinks = links.filter(link =>
        link.split(' ').length <= 8 &&
        !SKIP.test(link) &&
        !/\(disambiguation\)$/i.test(link)
      )
    } else {
      // Filter to links mentioned in the article text, then sort by first occurrence so
      // entities named early (e.g. members listed in the intro paragraph) are prioritised.
      candidateLinks = links
        .filter(link => article.text.includes(link))
        .sort((a, b) => article.text.indexOf(a) - article.text.indexOf(b))
    }

    // Cap candidates before batching — list articles get a lower cap (80→4 batches)
    // to reduce Wikipedia rate-limit exposure; non-list articles rarely exceed 80 anyway.
    const cap = isListArticle ? 80 : 150
    const cappedLinks = candidateLinks.slice(0, cap)
    console.log(`[wiki/fetch] candidate links (${cappedLinks.length}/${candidateLinks.length}, ${isListArticle ? 'list-mode' : 'text-filter'}): ${cappedLinks.slice(0, 30).join(', ')}`)
    progress(`Found ${links.length} links — screening ${cappedLinks.length} candidate${cappedLinks.length === 1 ? '' : 's'}…`)

    // Batch-fetch intros for all candidate links. Cap higher for list articles
    // since the main article text is kept very short, freeing context for linked articles.
    const articleCap = isListArticle ? 80 : 50
    const linkedArticles = (await fetchArticlesBatch(cappedLinks, 20, progress)).slice(0, articleCap)

    console.log(`[wiki/fetch] linked articles (${linkedArticles.length}): ${linkedArticles.map(a => a.title).join(', ')}`)

    const linkedText = linkedArticles
      .map(a => `\n\n--- LINKED ARTICLE: ${a.title} ---\n${a.text.slice(0, 1500)}`)
      .join('')

    // For list articles the table body is redundant — the linked member/entity articles
    // confirm who belongs to the list and contain the actual location data we need.
    // Keep only the intro paragraph (~2 000 chars) so context budget goes to linked articles.
    const mainText = isListArticle ? article.text.slice(0, 2000) : article.text

    res.write(`data: ${JSON.stringify({ type: 'result', data: { title: article.title, text: mainText + linkedText } })}\n\n`)
    return res.end()
  } catch (err) {
    console.error('wikipedia fetch error:', err)
    res.write(`data: ${JSON.stringify({ type: 'result', data: null })}\n\n`)
    return res.end()
  }
})

// GET /api/wikipedia/verify?title=Article_Title
router.get('/verify', async (req: Request, res: Response) => {
  const title = req.query.title as string
  if (!title) return res.status(400).json({ error: 'Missing title parameter' })

  try {
    const result = await verifyArticle(title)
    return res.json(result)
  } catch (err) {
    console.error('wikipedia verify error:', err)
    return res.status(500).json({ error: 'Failed to verify Wikipedia article' })
  }
})

export default router
