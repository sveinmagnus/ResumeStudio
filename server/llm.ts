/**
 * The app's ONE LLM backend — configuration, endpoint resolution, and the single
 * chat round-trip every AI assist rides on. The client never calls a model
 * directly (keys/URLs stay server-side, one auth perimeter), mirroring
 * translate.ts.
 *
 * NAME CONFIG AFTER THE LAYER, NOT A FEATURE. One configured model powers
 * summarize, translation, the writing coach, tailoring, import and the whole-CV
 * advisors, so config is `llm_*` / `LLM_*`. `summarize.ts` is one FEATURE built
 * on this file — keep it that way.
 *
 * Two wire protocols, dispatched on the provider (see `endpointFor`):
 *
 * OpenAI **Chat Completions** (`POST {baseUrl}/chat/completions`) — the shape
 * most backends speak:
 *   - ollama — a local Ollama (Docker-managed or a remote URL); its OpenAI-
 *     compatible endpoint lives at `{url}/v1`. First-class, like the Docker
 *     LibreTranslate for translation.
 *   - openai — the OpenAI API (needs a key).
 *   - gemini — Google Gemini via its OpenAI-compatible endpoint (Bearer key).
 *   - mistral — the Mistral API (OpenAI-compatible; Bearer key).
 *   - compat — any other OpenAI-compatible endpoint (OpenRouter, Groq, Together,
 *     LM Studio, …) via an explicit base URL + optional key.
 *
 * Anthropic **Messages** (`POST {baseUrl}/messages`) — a different shape, so it
 * gets its own branch:
 *   - anthropic — the Claude API. `x-api-key` + `anthropic-version` headers (not
 *     Bearer), the system prompt is a top-level field (not a message role), and
 *     current Claude models REJECT `temperature`, so we omit it. Response text
 *     is `content[].text`, not `choices[].message.content`.
 *
 * Env is read lazily per call so tests can vary it and importing has no side
 * effects; the desktop build pushes in-app settings onto the same env vars
 * (settings.ts → applyToEnv). Output is a review-required draft.
 */

export type LlmProvider =
  | 'off' | 'ollama' | 'openai' | 'compat' | 'anthropic' | 'gemini' | 'mistral'

/** Canonical list — settings.ts and the settings route validate against this
 *  (see TRANSLATE_PROVIDERS in translate.ts for why copies are banned). */
export const LLM_PROVIDERS: readonly LlmProvider[] =
  ['off', 'ollama', 'openai', 'compat', 'anthropic', 'gemini', 'mistral']

/** Default local Ollama base (no trailing /v1 — added when composing the URL). */
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

/** Fixed base URLs for the hosted providers. */
const OPENAI_BASE = 'https://api.openai.com/v1'
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'
/** Anthropic requires a version header; this is the stable dated value. */
const ANTHROPIC_VERSION = '2023-06-01'
/** Google's OpenAI-compatibility endpoint (Chat Completions + Bearer key). */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'
const MISTRAL_BASE = 'https://api.mistral.ai/v1'

/**
 * Fallback chat model per hosted provider, used only when the model field is
 * blank — it means an API key alone is enough to count as "configured".
 *
 * ⚠️ These are model ids belonging to someone else's product line, so they go
 * stale, and when they do the failure is late and confusing: the app looks
 * configured and every call 404s. `gemini-2.5-flash` sat here after Google had
 * moved on, which is exactly how that plays out.
 *
 * Prefer ids with a floating alias (`-latest`) where the provider offers one,
 * since those don't rot. And note the real fix is elsewhere: the settings model
 * picker now lists what the provider currently offers (`llmModels.ts`), so a
 * configured install should never be relying on this table.
 */
const DEFAULT_MODEL: Partial<Record<LlmProvider, string>> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-flash-latest',
  mistral: 'mistral-small-latest',
}

export interface LlmConfig {
  provider: LlmProvider
  /** Ollama base URL (without /v1). */
  ollama: { url: string }
  openai: { apiKey: string }
  compat: { url: string; apiKey: string }
  anthropic: { apiKey: string }
  gemini: { apiKey: string }
  mistral: { apiKey: string }
  /** Chat model name (e.g. 'llama3.2:3b', 'gpt-4o-mini', 'claude-haiku-4-5'). */
  model: string
  /**
   * The user's declaration that this model is strong enough for the ADVANCED
   * assists (whole-CV review, positioning, cross-language semantics) — see
   * `src/lib/llmAssist.ts → supportsAdvanced`.
   *
   * Declared, never sniffed. A `compat` endpoint can point at anything, model
   * names carry no reliable capability signal, and being wrong here doesn't
   * fail loudly — a 3B model answers a whole-CV review with confident nonsense.
   * So the person who configured the endpoint says, and the UI only *suggests* a
   * default (see `looksHighEnd` on the client).
   */
  highEnd: boolean
}

/** Upstream timeout (ms) — LLMs (esp. local) are slower than an MT engine. */
const TIMEOUT_MS = 45_000
/**
 * Timeout for an ADVANCED run. A whole-CV pass on a frontier model reasons for
 * a while before the first token; 45 s aborts work that was going to succeed.
 */
export const ADVANCED_TIMEOUT_MS = 180_000

function clean(v: string | undefined): string {
  return v?.trim() ?? ''
}

/**
 * Read `LLM_<name>`, falling back to the legacy `SUMMARIZE_<name>`.
 *
 * The env vars were renamed when this module stopped being about summarizing.
 * Deployed VPS instances and desktop shims still set the old names, and an
 * instance silently losing its API key on upgrade is a bad way to find out.
 */
function envVar(env: NodeJS.ProcessEnv, name: string): string {
  return clean(env[`LLM_${name}`]) || clean(env[`SUMMARIZE_${name}`])
}

/** Env truthiness for a boolean flag ('1'/'true'/'yes', case-insensitive). */
function envFlag(v: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const explicit = envVar(env, 'PROVIDER').toLowerCase()
  const provider = (LLM_PROVIDERS as string[]).includes(explicit) ? (explicit as LlmProvider) : 'off'
  return {
    provider,
    ollama: { url: envVar(env, 'OLLAMA_URL').replace(/\/+$/, '') || DEFAULT_OLLAMA_URL },
    openai: { apiKey: envVar(env, 'OPENAI_API_KEY') },
    compat: { url: envVar(env, 'COMPAT_URL').replace(/\/+$/, ''), apiKey: envVar(env, 'COMPAT_API_KEY') },
    anthropic: { apiKey: envVar(env, 'ANTHROPIC_API_KEY') },
    gemini: { apiKey: envVar(env, 'GEMINI_API_KEY') },
    mistral: { apiKey: envVar(env, 'MISTRAL_API_KEY') },
    model: envVar(env, 'MODEL'),
    highEnd: envFlag(envVar(env, 'HIGH_END')),
  }
}

/** The wire protocol an endpoint speaks — most are OpenAI Chat Completions; only
 *  Anthropic's native Messages API differs enough to need its own branch. */
type WireProtocol = 'openai' | 'anthropic'

export interface ResolvedEndpoint {
  protocol: WireProtocol
  baseUrl: string
  apiKey: string
  model: string
}

/** The resolved endpoint (protocol + base URL + key + model) for the active
 *  provider, or null when the provider lacks what it needs to run. */
function endpointFor(c: LlmConfig): ResolvedEndpoint | null {
  const model = (p: LlmProvider) => c.model || DEFAULT_MODEL[p] || ''
  switch (c.provider) {
    case 'ollama': return c.ollama.url ? { protocol: 'openai', baseUrl: `${c.ollama.url}/v1`, apiKey: '', model: c.model } : null
    case 'openai': return c.openai.apiKey ? { protocol: 'openai', baseUrl: OPENAI_BASE, apiKey: c.openai.apiKey, model: model('openai') } : null
    case 'compat': return c.compat.url ? { protocol: 'openai', baseUrl: c.compat.url, apiKey: c.compat.apiKey, model: c.model } : null
    case 'gemini': return c.gemini.apiKey ? { protocol: 'openai', baseUrl: GEMINI_BASE, apiKey: c.gemini.apiKey, model: model('gemini') } : null
    case 'mistral': return c.mistral.apiKey ? { protocol: 'openai', baseUrl: MISTRAL_BASE, apiKey: c.mistral.apiKey, model: model('mistral') } : null
    case 'anthropic': return c.anthropic.apiKey ? { protocol: 'anthropic', baseUrl: ANTHROPIC_BASE, apiKey: c.anthropic.apiKey, model: model('anthropic') } : null
    default: return null
  }
}

/**
 * The resolved endpoint for a config, or null. Exported for `llmModels.ts`,
 * which needs the same base URL + auth to ask a provider what it offers — the
 * alternative was a second copy of the provider table, which is exactly the
 * drift this file exists to prevent.
 */
export function resolveEndpoint(config?: LlmConfig): ResolvedEndpoint | null {
  return endpointFor(config ?? resolveConfig())
}

/** True when the resolved (or supplied) provider has what it needs to run. */
export function isLlmConfigured(config?: LlmConfig): boolean {
  const c = config ?? resolveConfig()
  const ep = endpointFor(c)
  return !!ep && ep.model.length > 0
}

/**
 * True when a configured model is ALSO declared high-end — the gate on every
 * advanced assist. Unconfigured is never high-end, so callers can ask this one
 * question instead of two.
 */
export function isHighEndConfigured(config?: LlmConfig): boolean {
  const c = config ?? resolveConfig()
  return isLlmConfigured(c) && c.highEnd
}

/** Hosts that mean "this machine" — nothing sent there leaves the computer. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'])

/**
 * True when the resolved endpoint runs on this machine.
 *
 * Derived from the endpoint HOST rather than the provider name on purpose: an
 * `openai-compatible` endpoint pointed at LM Studio on localhost is every bit as
 * private as Ollama, and a remote Ollama is not private at all. The UI states
 * "nothing leaves this computer" based on this, so it has to describe where the
 * bytes actually go — and it must fail CLOSED: anything unparseable is treated
 * as remote.
 */
export function isLocalEndpoint(config?: LlmConfig): boolean {
  const c = config ?? resolveConfig()
  const ep = endpointFor(c)
  if (!ep) return false
  try {
    return LOCAL_HOSTS.has(new URL(ep.baseUrl).hostname)
  } catch {
    return false
  }
}

/** What the client needs to describe the backend honestly (provenance line). */
export interface LlmInfo {
  configured: boolean
  /** '' when nothing is configured. */
  provider: LlmProvider | ''
  model: string
  /** True only when the endpoint is on this machine — see isLocalEndpoint. */
  local: boolean
  /** True when the user declared this model high-end — gates the advanced assists. */
  high_end: boolean
}

export function llmInfo(config?: LlmConfig): LlmInfo {
  const c = config ?? resolveConfig()
  const configured = isLlmConfigured(c)
  return {
    configured,
    provider: configured ? c.provider : '',
    model: configured ? (endpointFor(c)?.model ?? '') : '',
    local: configured && isLocalEndpoint(c),
    high_end: configured && c.highEnd,
  }
}

/**
 * App locale code → how a prompt names that language. One entry per offered
 * locale (LOCALE_LABELS in src/lib/locales.ts) — an unlisted code degrades to
 * "the same language as the input", which is a sane fallback for summarising but
 * would silently no-op a TRANSLATION, so this table must track the offered set.
 *
 * `name` is English (what models resolve most reliably) PLUS the native name in
 * parentheses. The native word is a strong anchor for smaller models, which
 * otherwise conflate close languages — the reported bug was English→Norwegian
 * coming back Swedish, because "Norwegian" alone doesn't distinguish Bokmål from
 * Swedish in a 3B model's representation. `no` is spelled out as Bokmål (the
 * app's `no` is Bokmål, per the CVpartner convention) so the target is
 * unmistakable.
 *
 * `directive` is the same instruction WRITTEN IN THAT LANGUAGE, and it is what
 * an all-English prompt cannot do however many times it names the target: every
 * token the model has read still points at English-adjacent output, leaving the
 * first generated token to a single content word. A sentence in the target
 * language moves that prior — the model is already "speaking" Bokmål before it
 * reaches the text. On 8B-class models the difference is the whole bug:
 * Norwegian requests answered in Swedish. It also separates bokmål from svenska
 * WITHOUT naming the wrong language, which would only prime it — never write
 * "not Swedish" into a prompt.
 */
interface LangEntry { name: string; directive: string }

const LANGUAGES: Record<string, LangEntry> = {
  en: { name: 'English', directive: 'Write your entire answer in English.' },
  no: { name: 'Norwegian Bokmål (norsk bokmål)', directive: 'Skriv hele svaret på norsk bokmål.' },
  se: { name: 'Swedish (svenska)', directive: 'Skriv hela svaret på svenska.' },
  dk: { name: 'Danish (dansk)', directive: 'Skriv hele svaret på dansk.' },
  de: { name: 'German (Deutsch)', directive: 'Schreibe die gesamte Antwort auf Deutsch.' },
  fr: { name: 'French (français)', directive: 'Rédige toute ta réponse en français.' },
  es: { name: 'Spanish (español)', directive: 'Escribe toda la respuesta en español.' },
  it: { name: 'Italian (italiano)', directive: 'Scrivi tutta la risposta in italiano.' },
  nl: { name: 'Dutch (Nederlands)', directive: 'Schrijf je volledige antwoord in het Nederlands.' },
  pt: { name: 'Portuguese (português)', directive: 'Escreva toda a resposta em português.' },
  pl: { name: 'Polish (polski)', directive: 'Napisz całą odpowiedź po polsku.' },
  fi: { name: 'Finnish (suomi)', directive: 'Kirjoita koko vastaus suomeksi.' },
  is: { name: 'Icelandic (íslenska)', directive: 'Skrifaðu allt svarið á íslensku.' },
  ru: { name: 'Russian (русский)', directive: 'Напишите весь ответ на русском языке.' },
  uk: { name: 'Ukrainian (українська)', directive: 'Напишіть усю відповідь українською мовою.' },
}

/**
 * The entry for a locale, or null. `Object.hasOwn`, not `LANGUAGES[locale]` —
 * `locale` comes off the request body, and an inherited key reads a FUNCTION
 * out of the map: `LANGUAGES['toString'].name` is the string `'toString'`, so
 * the optional chain never fires and the prompt ends up instructing the model
 * to "translate into toString". The three readers below share this one guard.
 */
function langEntry(locale: string): LangEntry | null {
  return Object.hasOwn(LANGUAGES, locale) ? LANGUAGES[locale] : null
}

/** The English name of a locale's language, or null when we don't know it. */
export function languageNameOf(locale: string): string | null {
  return langEntry(locale)?.name ?? null
}

/** The language name for a prompt, with a safe fallback for unknown codes. */
export function languageName(locale: string): string {
  return langEntry(locale)?.name ?? 'the same language as the input'
}

/**
 * The "answer in this language" sentence, written in the language itself — the
 * closing anchor of every prompt whose output language matters. Empty for a
 * code we don't know, so callers can append it unconditionally.
 */
export function languageDirective(locale: string): string {
  return langEntry(locale)?.directive ?? ''
}

/** Raised for any upstream/LLM failure; carries a safe HTTP status. */
export class LlmError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'LlmError'
  }
}

export interface ChatMessage { role: 'system' | 'user'; content: string }
export interface ChatOpts {
  maxTokens: number
  temperature?: number
  /** Override the upstream timeout (advanced runs use ADVANCED_TIMEOUT_MS). */
  timeoutMs?: number
}

/**
 * One chat round-trip against the configured LLM, returning the raw reply text.
 * Dispatches to the OpenAI or Anthropic wire path by provider. THE one place a
 * request leaves for a model: the summarize feature, the LLM translation
 * provider (server/translate.ts) and every assist behind /api/llm/complete share
 * this endpoint resolution, auth, timeout and error mapping rather than
 * duplicating them — "use the model I already configured" is exactly one config,
 * one code path.
 *
 * Throws LlmError; translate.ts maps that onto its own error type so callers
 * still get a translate-shaped failure.
 */
export async function chatComplete(
  messages: ChatMessage[],
  opts: ChatOpts,
  config?: LlmConfig,
): Promise<string> {
  const c = config ?? resolveConfig()
  const ep = endpointFor(c)
  if (!ep || !ep.model) throw new LlmError(503, 'No AI model is configured on this server')
  return ep.protocol === 'anthropic'
    ? anthropicChat(ep, messages, opts)
    : openAIChat(ep, messages, opts)
}

/** Map an upstream HTTP status to a safe, actionable LlmError (502). */
function mapUpstreamError(status: number): LlmError {
  if (status === 401 || status === 403) return new LlmError(502, 'The AI provider rejected the API key')
  if (status === 404) return new LlmError(502, 'Model or endpoint not found — check the model name / URL')
  if (status === 429) return new LlmError(502, 'The AI provider is rate-limited or out of quota')
  return new LlmError(502, 'The AI model returned an error')
}

const UNREACHABLE = 'The AI model is unreachable (is it running / the URL correct?)'

/** OpenAI Chat Completions round-trip (ollama/openai/compat/gemini/mistral). */
async function openAIChat(ep: ResolvedEndpoint, messages: ChatMessage[], opts: ChatOpts): Promise<string> {
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
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens,
        messages,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    })
  } catch {
    throw new LlmError(502, UNREACHABLE)
  }
  if (!res.ok) throw mapUpstreamError(res.status)
  const json = await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new LlmError(502, 'The AI model returned no text')
  return content
}

/**
 * Anthropic native Messages round-trip. Differs from the OpenAI path in four
 * ways: `x-api-key`+`anthropic-version` headers (not Bearer); the system prompt
 * is a top-level `system` field, not a message with role 'system'; `temperature`
 * is omitted (current Claude models reject it with a 400); and the reply text is
 * the first text block of `content[]`, not `choices[0].message.content`.
 */
async function anthropicChat(ep: ResolvedEndpoint, messages: ChatMessage[], opts: ChatOpts): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const chat = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }))
  let res: Response
  try {
    res = await fetch(`${ep.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ep.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ep.model,
        max_tokens: opts.maxTokens,
        ...(system ? { system } : {}),
        messages: chat,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    })
  } catch {
    throw new LlmError(502, UNREACHABLE)
  }
  if (!res.ok) throw mapUpstreamError(res.status)
  const json = await res.json().catch(() => null) as { content?: { type?: string; text?: string }[] } | null
  const text = json?.content?.find((b) => b.type === 'text')?.text
  if (typeof text !== 'string' || !text.trim()) throw new LlmError(502, 'The AI model returned no text')
  return text
}
