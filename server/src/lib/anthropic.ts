import Anthropic from '@anthropic-ai/sdk'
import { recordUsage } from './usage.js'

function recordAnthropic(u: Anthropic.Usage): void {
  recordUsage({
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  })
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

// Prompt caching is MODEL-GATED. `cacheable` callers (the builder loop) get incremental
// cache_control on the system block + latest message so each step reads the prefix the previous
// step wrote (reads ≈0.1× input). But this only ACTIVATES above the model's minimum cacheable
// prefix: Haiku 4.5's ~4096-token min exceeds our short system prompt (~750) + typical transcripts,
// so on Haiku it's a measured no-op — we skip it there to avoid the write surcharge ever biting.
// Sonnet/Opus (1024-token min) cross the threshold, so caching is applied for them.
function modelBenefitsFromCaching(apiModel: string): boolean {
  return !apiModel.includes('haiku')
}

// OpenAI, BYOK — the key is the user's own, same per-request header the Anthropic path uses.
// Chat Completions accepts a `system` role message directly, no prompt-caching support here
// (Claude-only feature), so `cacheable` is simply ignored.
const OPENAI_MAX_ATTEMPTS = 3

async function openaiChat(apiKey: string, model: string, system: string | undefined, messages: ChatMessage[], maxTokens: number): Promise<string> {
  const msgs = [...(system ? [{ role: 'system', content: system }] : []), ...messages]
  const body = JSON.stringify({ model: model.replace(/^openai:/, ''), messages: msgs, max_completion_tokens: maxTokens })

  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`)

    let data: { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    try {
      data = await res.json() as typeof data
    } catch (parseErr) {
      // Same transient truncated/corrupted-body failure mode WDQS hits under load — a raw
      // stream-decode error (e.g. "Error in input stream") means nothing to a user, so retry
      // with backoff and only surface something actionable if it keeps happening.
      const raw = parseErr instanceof Error ? parseErr.message : String(parseErr)
      if (attempt < OPENAI_MAX_ATTEMPTS - 1) {
        console.warn(`[openai] malformed response body (${raw}) — retrying (attempt ${attempt + 1}/${OPENAI_MAX_ATTEMPTS})`)
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
        continue
      }
      console.error(`[openai] malformed response body after ${attempt + 1} attempt(s): ${raw}`)
      throw new Error('OpenAI returned a corrupted response, please try again.')
    }

    recordUsage({ input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0, cacheRead: 0, cacheWrite: 0 })
    const text = data.choices?.[0]?.message?.content
    if (!text) throw new Error('Empty response from OpenAI')
    return text
  }
}

// One dispatch path for both the single-prompt and multi-turn callers.
async function chat(
  apiKey: string,
  model: string,
  system: string | undefined,
  messages: ChatMessage[],
  maxTokens: number,
  cacheable = false,
): Promise<string> {
  if (model.startsWith('openai:')) return openaiChat(apiKey, model, system, messages, maxTokens)
  const client = new Anthropic({ apiKey })
  const EPHEMERAL = { type: 'ephemeral' as const }
  const useCache = cacheable && messages.length > 0 && modelBenefitsFromCaching(model)

  const systemParam: Anthropic.MessageCreateParams['system'] | undefined = system
    ? useCache
      ? [{ type: 'text', text: system, cache_control: EPHEMERAL }]
      : system
    : undefined

  const messageParams: Anthropic.MessageParam[] = useCache
    ? messages.map((m, i) =>
        i === messages.length - 1
          ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: EPHEMERAL }] }
          : m,
      )
    : messages

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(systemParam ? { system: systemParam } : {}),
    messages: messageParams,
  })
  recordAnthropic(message.usage)
  return textOf(message)
}

function textOf(message: Anthropic.Message): string {
  const block = message.content[0]
  if (!block) throw new Error('Empty response from Claude')
  if (block.type !== 'text') throw new Error('Unexpected response type')
  return block.text
}

export async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number = 512,
): Promise<string> {
  return chat(apiKey, model, undefined, [{ role: 'user', content: prompt }], maxTokens)
}

// Multi-turn variant for the agentic schema-discovery loop (PID R9): carries a system
// prompt + a running transcript so the model can reason across tool observations.
export async function callClaudeMessages(
  apiKey: string,
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number = 1024,
  cacheable = false,
): Promise<string> {
  return chat(apiKey, model, system, messages, maxTokens, cacheable)
}

// Scan from the first `{`/`[` to its matching close, respecting string literals and escapes, and
// return that substring — so a JSON value wrapped in prose ("Here is the data: {...}. Hope that
// helps!") or followed by a trailing explanation still parses. Returns null if nothing balances
// (e.g. the value was truncated mid-stream).
function extractBalancedJson(s: string): string | null {
  const start = s.search(/[[{]/)
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') {
      inStr = true
    } else if (ch === '{' || ch === '[') {
      depth++
    } else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

export function parseJsonResponse(text: string): unknown {
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '')
  cleaned = cleaned.replace(/\s*```$/, '')
  cleaned = cleaned.trim()

  // Fast path: the whole thing is exactly one JSON value.
  try {
    return JSON.parse(cleaned)
  } catch {
    // fall through to recovery
  }

  // Recover from leading/trailing prose by parsing the first balanced JSON value.
  const balanced = extractBalancedJson(cleaned)
  if (balanced) {
    try {
      return JSON.parse(balanced)
    } catch {
      // fall through
    }
  }

  // Last resort: a truncated array of objects (model hit the token limit mid-stream) — close it
  // after the last complete object so we keep the rows we did get.
  if (cleaned.startsWith('[')) {
    const lastBrace = cleaned.lastIndexOf('}')
    if (lastBrace !== -1) return JSON.parse(cleaned.slice(0, lastBrace + 1) + ']')
  }

  return JSON.parse(cleaned) // throw the original-style error if nothing recovered
}
