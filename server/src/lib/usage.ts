// Per-query LLM usage tracking. A request opens a usage context (AsyncLocalStorage, so it is
// concurrency-safe and needs no plumbing through the pipeline); every LLM call records its
// token usage into the active context; the route logs a summary at the end. Token counts are
// exact (from the provider response); the dollar figure is an estimate from the table below.

import { AsyncLocalStorage } from 'node:async_hooks'

export interface Usage {
  calls: number
  input: number // fresh (uncached) input tokens
  output: number
  cacheRead: number // tokens served from prompt cache (cheap)
  cacheWrite: number // tokens written to prompt cache (slight surcharge)
}

const store = new AsyncLocalStorage<Usage>()

export async function runWithUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: Usage }> {
  const usage: Usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const result = await store.run(usage, fn)
  return { result, usage }
}

// Called by each LLM call (anthropic.ts) with its provider-normalised token counts.
export function recordUsage(u: Partial<Omit<Usage, 'calls'>>): void {
  const cur = store.getStore()
  if (!cur) return
  cur.calls += 1
  cur.input += u.input ?? 0
  cur.output += u.output ?? 0
  cur.cacheRead += u.cacheRead ?? 0
  cur.cacheWrite += u.cacheWrite ?? 0
}

// Best-effort pricing, USD per 1M tokens (input, output). UPDATE if provider pricing changes.
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-opus-4-6': { in: 15, out: 75 },
  // Gemini PAID per-1M rates — the benchmark motive is the free tier ($0), but free-tier limits
  // won't scale to many users, so cost the comparison at the paid rate to see the real at-scale price.
  'gemini:gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'gemini:gemini-2.5-flash': { in: 0.3, out: 2.5 },
}
function priceFor(model: string): { in: number; out: number } {
  return PRICING[model] ?? { in: 1, out: 5 }
}

export function estimateCostUsd(model: string, u: Usage): number {
  const p = priceFor(model)
  // Anthropic cache pricing: reads ≈ 0.1× input, writes ≈ 1.25× input.
  const cents = u.input * p.in + u.cacheRead * p.in * 0.1 + u.cacheWrite * p.in * 1.25 + u.output * p.out
  return cents / 1e6
}

export function formatUsage(model: string, u: Usage): string {
  const totalIn = u.input + u.cacheRead + u.cacheWrite
  return (
    `${u.calls} calls · in ${totalIn} (fresh ${u.input}, cache-read ${u.cacheRead}, cache-write ${u.cacheWrite}) · ` +
    `out ${u.output} · ~$${estimateCostUsd(model, u).toFixed(4)}`
  )
}
