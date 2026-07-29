/**
 * Ask the CONFIGURED provider what models it currently offers.
 *
 * This exists because a hardcoded shortlist is wrong the moment a provider revs
 * its line-up, and it fails in the worst possible way: the field suggests a
 * model id, the user picks it, saves, and only finds out at "Save and test"
 * that it no longer exists. (That is exactly what happened — the curated Gemini
 * entry outlived the model.) Every provider here can be asked directly, so ask.
 *
 * The curated catalogs (`lib/cloudModelCatalog.ts`, `lib/ollamaCatalog.ts`) stay
 * as the OFFLINE fallback: before a key is entered there is nobody to ask, and
 * a shortlist beats an empty box. They are no longer the primary source.
 *
 * SECURITY: the endpoint and key come from server config (or, on the desktop
 * build only, from the pending settings form — same rule as the "test" route).
 * A request can never name the host, because this makes an outbound fetch.
 *
 * Never throws. An unreachable provider, a bad key or a shape we don't
 * recognise all mean "no live list", and the caller falls back.
 */

import { resolveEndpoint, type LlmConfig } from './llm.js'
import { listOllamaModels } from './ollamaDocker.js'

export interface LlmModel {
  /** The id to put in the model field. */
  id: string
  /** Optional human label (Anthropic gives one; sizes for Ollama). */
  label?: string
}

const TIMEOUT_MS = 8_000
/** Providers can list hundreds; the picker only needs a usable set. */
const MAX_MODELS = 120

/**
 * Model ids that are real but useless here. Chat completion is the only thing
 * this app does, so embeddings, audio, image and moderation models are noise in
 * a picker — and on OpenAI they are the majority of the list.
 *
 * A substring deny-list rather than an allow-list on purpose: an allow-list
 * would hide every model released after this file was written, which is the
 * failure this whole module exists to fix.
 */
const NOT_CHAT = [
  'embed', 'embedding', 'tts', 'whisper', 'audio', 'transcribe', 'speech',
  'moderation', 'image', 'dall-e', 'vision-preview', 'rerank', 'guard',
  'codestral-embed', 'ocr',
]

function isChatModel(id: string): boolean {
  const lower = id.toLowerCase()
  return !NOT_CHAT.some((bad) => lower.includes(bad))
}

/**
 * Newest-looking first. Providers return their lists in no useful order (often
 * alphabetical or creation order), and the user almost always wants the current
 * generation — so sort by the highest version number in the id, descending,
 * then alphabetically. Crude, and much better than alphabetical, which buries
 * `gemini-3.6-flash` under `gemini-1.5-flash`.
 */
function versionScore(id: string): number {
  let best = 0
  for (const m of id.matchAll(/(\d+)(?:[.-](\d+))?/g)) {
    const major = Number(m[1])
    const minor = m[2] ? Number(m[2]) : 0
    // Ignore date-like runs (20240620) — they'd swamp a real version number.
    if (major > 1000) continue
    best = Math.max(best, major * 100 + Math.min(minor, 99))
  }
  return best
}

function tidy(models: LlmModel[]): LlmModel[] {
  const seen = new Set<string>()
  const out: LlmModel[] = []
  for (const m of models) {
    const id = m.id.trim()
    if (!id || seen.has(id) || !isChatModel(id)) continue
    seen.add(id)
    out.push({ id, ...(m.label ? { label: m.label } : {}) })
  }
  out.sort((a, b) => versionScore(b.id) - versionScore(a.id) || a.id.localeCompare(b.id))
  return out.slice(0, MAX_MODELS)
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  }
}

/** The OpenAI `/models` shape, which openai, gemini, mistral and compat share. */
function parseOpenAiList(json: unknown): LlmModel[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    const id = (entry as { id?: unknown })?.id
    if (typeof id !== 'string') return []
    // Gemini's OpenAI-compatible endpoint returns ids as "models/gemini-…",
    // but the chat endpoint expects them bare.
    return [{ id: id.replace(/^models\//, '') }]
  })
}

/** Anthropic's native list — same envelope, plus a display name worth showing. */
function parseAnthropicList(json: unknown): LlmModel[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    const e = entry as { id?: unknown; display_name?: unknown }
    if (typeof e.id !== 'string') return []
    return [{ id: e.id, ...(typeof e.display_name === 'string' ? { label: e.display_name } : {}) }]
  })
}

/**
 * The models the configured provider currently offers. Empty when nothing is
 * configured, the provider can't be reached, or it has no list endpoint.
 */
export async function listProviderModels(config: LlmConfig): Promise<LlmModel[]> {
  // Ollama is not an OpenAI-compatible list: it reports what this instance has
  // PULLED, which is the more useful answer for a local runtime.
  if (config.provider === 'ollama') {
    const url = config.ollama.url
    if (!url) return []
    const tags = await listOllamaModels(url, TIMEOUT_MS)
    return tidy(tags.map((t) => ({ id: t.name })))
  }

  const ep = resolveEndpoint(config)
  if (!ep) return []

  if (ep.protocol === 'anthropic') {
    const json = await getJson(`${ep.baseUrl}/models?limit=100`, {
      'x-api-key': ep.apiKey,
      'anthropic-version': '2023-06-01',
    })
    return tidy(parseAnthropicList(json))
  }

  const json = await getJson(
    `${ep.baseUrl}/models`,
    ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {},
  )
  return tidy(parseOpenAiList(json))
}
