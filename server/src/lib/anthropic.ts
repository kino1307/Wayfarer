import Anthropic from '@anthropic-ai/sdk'

// Per-model output token maximums
// 50 locations × ~300 tokens/object = ~15 000 tokens needed.
// Cap well below model maximums to prevent runaway generation.
const MODEL_MAX_TOKENS: Record<string, number> = {
  'claude-haiku-4-5-20251001': 8192,
  'claude-sonnet-4-6': 16000,
  'claude-opus-4-6': 16000,
}

export function maxTokensForModel(model: string): number {
  return MODEL_MAX_TOKENS[model] ?? 8192
}

export function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

export async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number = 512
): Promise<string> {
  const client = createClient(apiKey)
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = message.content[0]
  if (!block) throw new Error('Empty response from Claude')
  if (block.type !== 'text') throw new Error('Unexpected response type')
  return block.text
}

// Stream text chunks from Claude, calling onChunk for each delta.
// If onChunk returns false the stream is stopped immediately.
export async function streamClaude(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number,
  onChunk: (text: string) => boolean | void
): Promise<void> {
  const client = createClient(apiKey)
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      if (onChunk(event.delta.text) === false) break
    }
  }
}

// Extract the next complete JSON object from text starting at scanFrom.
// Returns the object string and the index after its closing brace, or null if incomplete.
export function extractNextJsonObject(
  text: string,
  scanFrom: number
): { obj: string; end: number } | null {
  let depth = 0
  let inString = false
  let escape = false
  let objStart = -1

  for (let i = scanFrom; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (inString) {
      if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') {
      if (depth === 0) objStart = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && objStart !== -1) {
        return { obj: text.slice(objStart, i + 1), end: i + 1 }
      }
    }
  }
  return null
}

export type LocationRole = 'birthplace' | 'raised' | 'residence' | 'active' | 'venue' | 'origin' | 'location'

export function parseJsonResponse(text: string): unknown {
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '')
  cleaned = cleaned.replace(/\s*```$/, '')
  cleaned = cleaned.trim()

  if (cleaned.startsWith('[')) {
    const lastBrace = cleaned.lastIndexOf('}')
    if (lastBrace !== -1 && !cleaned.trimEnd().endsWith(']')) {
      cleaned = cleaned.slice(0, lastBrace + 1) + ']'
    }
  }

  return JSON.parse(cleaned)
}
