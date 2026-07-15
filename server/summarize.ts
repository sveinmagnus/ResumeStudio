/**
 * Server-side "summarize" proxy — turns a long CV description into a concise
 * one-line short description via an LLM. The client never calls the model
 * directly (keys/URLs stay server-side, one auth perimeter), mirroring
 * translate.ts.
 *
 * Every backend speaks the OpenAI **Chat Completions** shape
 * (`POST {baseUrl}/chat/completions`), which covers the lot:
 *   - ollama — a local Ollama (Docker-managed or a remote URL); its OpenAI-
 *     compatible endpoint lives at `{url}/v1`. First-class, like the Docker
 *     LibreTranslate for translation.
 *   - openai — the OpenAI API (needs a key).
 *   - compat — any OpenAI-compatible endpoint (OpenRouter, Groq, Azure OpenAI,
 *     LM Studio, …) via an explicit base URL + optional key.
 *
 * Env is read lazily per call so tests can vary it and importing has no side
 * effects; the desktop build pushes in-app settings onto the same env vars
 * (settings.ts → applyToEnv). Output is a review-required draft.
 */

export type SummarizeProvider = 'off' | 'ollama' | 'openai' | 'compat'

const PROVIDERS: readonly SummarizeProvider[] = ['off', 'ollama', 'openai', 'compat']

/** Default local Ollama base (no trailing /v1 — added when composing the URL). */
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

export interface SummarizeConfig {
  provider: SummarizeProvider
  /** Ollama base URL (without /v1). */
  ollama: { url: string }
  openai: { apiKey: string }
  compat: { url: string; apiKey: string }
  /** Chat model name (e.g. 'llama3.2:3b', 'gpt-4o-mini'). */
  model: string
}

/** Hard cap on the source text sent to the model (chars). */
export const MAX_SUMMARIZE_CHARS = 6000
/** Upstream timeout (ms) — LLMs (esp. local) are slower than an MT engine. */
const TIMEOUT_MS = 45_000

function clean(v: string | undefined): string {
  return v?.trim() ?? ''
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): SummarizeConfig {
  const explicit = clean(env.SUMMARIZE_PROVIDER).toLowerCase()
  const provider = (PROVIDERS as string[]).includes(explicit) ? (explicit as SummarizeProvider) : 'off'
  return {
    provider,
    ollama: { url: clean(env.SUMMARIZE_OLLAMA_URL).replace(/\/+$/, '') || DEFAULT_OLLAMA_URL },
    openai: { apiKey: clean(env.SUMMARIZE_OPENAI_API_KEY) },
    compat: { url: clean(env.SUMMARIZE_COMPAT_URL).replace(/\/+$/, ''), apiKey: clean(env.SUMMARIZE_COMPAT_API_KEY) },
    model: clean(env.SUMMARIZE_MODEL),
  }
}

/** The resolved OpenAI-compatible base URL + key + model for the active provider. */
function endpointFor(c: SummarizeConfig): { baseUrl: string; apiKey: string; model: string } | null {
  switch (c.provider) {
    case 'ollama': return c.ollama.url ? { baseUrl: `${c.ollama.url}/v1`, apiKey: '', model: c.model } : null
    case 'openai': return c.openai.apiKey ? { baseUrl: 'https://api.openai.com/v1', apiKey: c.openai.apiKey, model: c.model || 'gpt-4o-mini' } : null
    case 'compat': return c.compat.url ? { baseUrl: c.compat.url, apiKey: c.compat.apiKey, model: c.model } : null
    default: return null
  }
}

/** True when the resolved (or supplied) provider has what it needs to run. */
export function isSummarizeConfigured(config?: SummarizeConfig): boolean {
  const c = config ?? resolveConfig()
  const ep = endpointFor(c)
  return !!ep && ep.model.length > 0
}

// App locale code → the language name we ask the model to write in.
const LANG_NAMES: Record<string, string> = {
  en: 'English', no: 'Norwegian', se: 'Swedish', dk: 'Danish',
  de: 'German', fr: 'French', es: 'Spanish',
}
function languageName(locale: string): string {
  return LANG_NAMES[locale] ?? 'the same language as the input'
}

/** Raised for any upstream/summarize failure; carries a safe HTTP status. */
export class SummarizeError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'SummarizeError'
  }
}

/**
 * Tidy the model's reply into a single clean line: strip code fences / wrapping
 * quotes, collapse whitespace to one line, and cap the length. LLMs sometimes
 * add a preamble or quotes despite instructions — this keeps the field sane.
 */
export function tidyLine(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```[a-z]*\n?|```$/gi, '').trim()
  // First non-empty line only (drop any trailing explanation).
  s = (s.split(/\r?\n/).find((l) => l.trim()) ?? '').trim()
  // Strip a leading list marker ("- ", "• ", "1. ") and wrapping quotes.
  s = s.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '')
  s = s.replace(/^["“'']+|["”'']+$/g, '').trim()
  return s.slice(0, 240)
}

const SYSTEM_PROMPT =
  'You condense a résumé/CV entry into ONE concise line for a summary view. ' +
  'Output only that single line — no preamble, no quotes, no markdown, no trailing period unless natural. ' +
  'Keep it under ~18 words, factual and specific, preserving key role/technology/outcome. ' +
  'Write it in {LANGUAGE}.'

/**
 * Summarize `text` into a one-line short description, in `locale`'s language,
 * using the configured (or supplied) provider. Throws SummarizeError on any
 * failure — callers map that to an HTTP response without leaking internals.
 */
export async function summarize(text: string, locale: string, config?: SummarizeConfig): Promise<string> {
  const c = config ?? resolveConfig()
  const ep = endpointFor(c)
  if (!ep || !ep.model) throw new SummarizeError(503, 'Summarize is not configured on this server')

  let res: Response
  try {
    res = await fetch(`${ep.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ep.model,
        temperature: 0.3,
        max_tokens: 80,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT.replace('{LANGUAGE}', languageName(locale)) },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new SummarizeError(502, 'The AI model is unreachable (is it running / the URL correct?)')
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new SummarizeError(502, 'The AI provider rejected the API key')
    if (res.status === 404) throw new SummarizeError(502, 'Model or endpoint not found — check the model name / URL')
    if (res.status === 429) throw new SummarizeError(502, 'The AI provider is rate-limited or out of quota')
    throw new SummarizeError(502, 'The AI model returned an error')
  }
  const json = await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new SummarizeError(502, 'The AI model returned no text')
  const line = tidyLine(content)
  if (!line) throw new SummarizeError(502, 'The AI model returned no usable summary')
  return line
}
