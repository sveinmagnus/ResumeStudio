/**
 * Server-side translation proxy supporting several backends.
 *
 * Why proxy rather than call from the browser:
 *   - Provider URLs / API keys stay server-side (the client is a pure browser
 *     app and never reads env vars — see CLAUDE.md §2).
 *   - CV text flows server→provider; the browser never talks to a third origin,
 *     so there's no CORS and one auth perimeter (the bearer-token middleware).
 *
 * Backends (selected by TRANSLATE_PROVIDER, each with its own key):
 *   - libretranslate — self-hosted / Docker-managed (LIBRETRANSLATE_URL[/_API_KEY])
 *   - deepl          — DeepL API, Free or Pro auto-detected from the key (DEEPL_API_KEY)
 *   - google         — Google Cloud Translation v2 (GOOGLE_TRANSLATE_API_KEY)
 *   - azure          — Microsoft Azure Translator (AZURE_TRANSLATOR_KEY[/_REGION])
 *
 * Env is read lazily (per call) via `resolveConfig` so tests can vary it and
 * importing this module has no side effects. The desktop build pushes the
 * in-app settings onto these same env vars (settings.ts → applyToEnv).
 *
 * Translations are explicitly "drafts for review" — quality varies by provider
 * and language pair.
 */

import { chatComplete, isSummarizeConfigured, languageNameOf, SummarizeError } from './summarize.js'

/**
 * `llm` reuses whatever model the SUMMARIZE settings already configure (local
 * Ollama, OpenAI, or an OpenAI-compatible endpoint) instead of standing up a
 * second engine. It carries no config of its own — that's the point.
 */
export type TranslateProvider = 'off' | 'libretranslate' | 'deepl' | 'google' | 'azure' | 'llm'

/**
 * The one canonical provider list. Exported so settings.ts and the settings
 * route validate against THIS rather than their own copies — a drifted copy is
 * exactly how the 'llm' provider shipped unsaveable (the route's inline list
 * predated it and rejected the value the UI sent).
 */
export const TRANSLATE_PROVIDERS: readonly TranslateProvider[] = ['off', 'libretranslate', 'deepl', 'google', 'azure', 'llm']

export interface TranslateConfig {
  provider: TranslateProvider
  libretranslate: { url: string | null; apiKey: string }
  deepl: { apiKey: string }
  google: { apiKey: string }
  azure: { apiKey: string; region: string }
}

/** Hard cap on a single translation request (chars). Generous for a CV field. */
export const MAX_TRANSLATE_CHARS = 5000

/** Upstream request timeout (ms). */
const TIMEOUT_MS = 15_000

function clean(v: string | undefined): string {
  return v?.trim() ?? ''
}

/**
 * Resolve the active translation config from env. Back-compat: when
 * TRANSLATE_PROVIDER is unset but a LIBRETRANSLATE_URL is present, default to
 * the libretranslate provider — so existing env-only (VPS) deployments keep
 * working without setting the new variable.
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): TranslateConfig {
  const libreUrl = clean(env.LIBRETRANSLATE_URL).replace(/\/+$/, '') || null
  const explicit = clean(env.TRANSLATE_PROVIDER).toLowerCase()
  let provider: TranslateProvider
  if ((TRANSLATE_PROVIDERS as string[]).includes(explicit)) provider = explicit as TranslateProvider
  else if (libreUrl) provider = 'libretranslate'
  else provider = 'off'
  return {
    provider,
    libretranslate: { url: libreUrl, apiKey: clean(env.LIBRETRANSLATE_API_KEY) },
    deepl: { apiKey: clean(env.DEEPL_API_KEY) },
    google: { apiKey: clean(env.GOOGLE_TRANSLATE_API_KEY) },
    azure: { apiKey: clean(env.AZURE_TRANSLATOR_KEY), region: clean(env.AZURE_TRANSLATOR_REGION) },
  }
}

/** True when the resolved (or supplied) provider has the config it needs. */
export function isTranslationConfigured(config?: TranslateConfig): boolean {
  const c = config ?? resolveConfig()
  switch (c.provider) {
    case 'libretranslate': return c.libretranslate.url !== null
    case 'deepl':          return c.deepl.apiKey.length > 0
    case 'google':         return c.google.apiKey.length > 0
    case 'azure':          return c.azure.apiKey.length > 0
    // Borrowed wholesale from the summarize side — if a model is configured
    // there, translation is configured here.
    case 'llm':            return isSummarizeConfigured()
    default:               return false
  }
}

// ─── Locale maps (app codes → each provider's expected codes) ───────────────
// The app uses CVpartner-flavoured codes (`no`, `se`, `dk`). Each provider wants
// slightly different ISO variants. Unknown codes pass through lower-cased so a
// deployer can use any language a provider supports.

/**
 * LibreTranslate / Argos codes. Also the public `toServiceLocale` (kept for
 * compat). Only the three CVpartner-flavoured codes actually differ from
 * ISO 639-1; the rest pass through unchanged, which is why the fallback is
 * correct for every other offered locale.
 */
const LIBRE_MAP: Record<string, string> = { en: 'en', no: 'nb', se: 'sv', dk: 'da', de: 'de', fr: 'fr', es: 'es' }
export function toServiceLocale(appCode: string): string {
  return LIBRE_MAP[appCode] ?? appCode.toLowerCase()
}

/**
 * The `LT_LOAD_ONLY` value for a set of app locale codes — which Argos model
 * packages the Docker LibreTranslate installs. Each language is a few hundred
 * MB, which is why it's a choice and not "install everything".
 *
 * English is always included: Argos pivots most pairs through it, so an install
 * without `en` can fail to resolve even a fully-selected pair. Deduped (two app
 * codes can map to one service code) and ordered so the value is stable — the
 * caller compares it to decide whether the container needs recreating.
 */
export function ltLoadOnly(appCodes: readonly string[]): string {
  const codes = new Set<string>(['en'])
  for (const c of appCodes) {
    const s = toServiceLocale(c.trim())
    if (s) codes.add(s)
  }
  return [...codes].sort().join(',')
}

/**
 * DeepL wants UPPERCASE codes, so its fallback must upper-case rather than
 * lower-case — a bare `fi` is rejected where `FI` works. Every offered locale is
 * listed explicitly except Icelandic, which DeepL simply does not support (the
 * request will fail upstream with DeepL's own message, which is the honest
 * outcome — we don't silently substitute another language).
 */
const DEEPL_SOURCE: Record<string, string> = {
  en: 'EN', no: 'NB', se: 'SV', dk: 'DA', de: 'DE', fr: 'FR', es: 'ES',
  it: 'IT', nl: 'NL', pt: 'PT', pl: 'PL', fi: 'FI', ru: 'RU', uk: 'UK',
}
// DeepL requires a regional variant for an English *target* (bare EN is rejected).
const DEEPL_TARGET: Record<string, string> = { ...DEEPL_SOURCE, en: 'EN-GB' }
/**
 * Google + Azure take plain ISO 639-1, which every offered locale already is
 * apart from the three CVpartner-flavoured codes below — so the lower-cased
 * fallback is right for the rest.
 */
const GOOGLE_MAP: Record<string, string> = { en: 'en', no: 'no', se: 'sv', dk: 'da', de: 'de', fr: 'fr', es: 'es' }
const AZURE_MAP: Record<string, string> = { en: 'en', no: 'nb', se: 'sv', dk: 'da', de: 'de', fr: 'fr', es: 'es' }

const mapWith = (m: Record<string, string>, code: string): string => m[code] ?? code.toLowerCase()
/** DeepL's variant of {@link mapWith} — unknown codes upper-case, not lower. */
const mapDeepL = (m: Record<string, string>, code: string): string => m[code] ?? code.toUpperCase()

/** Raised for any upstream/translation failure; carries a safe HTTP status. */
export class TranslateError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'TranslateError'
  }
}

/** Shared fetch wrapper: timeout + a uniform "unreachable" failure that never
 *  echoes the underlying message (which could contain an internal URL/host). */
async function postJson(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new TranslateError(502, 'Translation service is unreachable')
  }
}

// ─── Providers ───────────────────────────────────────────────────────────────

async function translateLibre(text: string, source: string, target: string, c: TranslateConfig): Promise<string> {
  const url = c.libretranslate.url
  if (!url) throw new TranslateError(503, 'Translation is not configured on this server')
  const key = c.libretranslate.apiKey
  const res = await postJson(`${url}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: toServiceLocale(source),
      target: toServiceLocale(target),
      format: 'text',
      ...(key ? { api_key: key } : {}),
    }),
  })
  if (!res.ok) {
    if (res.status === 400) throw new TranslateError(400, 'Translation is unavailable for this language pair')
    throw new TranslateError(502, 'Translation service returned an error')
  }
  const json = await res.json().catch(() => null) as { translatedText?: string } | null
  if (!json || typeof json.translatedText !== 'string') throw new TranslateError(502, 'Translation service returned no text')
  return json.translatedText
}

async function translateDeepL(text: string, source: string, target: string, c: TranslateConfig): Promise<string> {
  const key = c.deepl.apiKey
  if (!key) throw new TranslateError(503, 'Translation is not configured on this server')
  // DeepL Free keys end in ':fx' and use a separate host.
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
  const res = await postJson(`${host}/v2/translate`, {
    method: 'POST',
    headers: { 'Authorization': `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: [text],
      source_lang: mapDeepL(DEEPL_SOURCE, source),
      target_lang: mapDeepL(DEEPL_TARGET, target),
    }),
  })
  if (!res.ok) {
    if (res.status === 403) throw new TranslateError(502, 'DeepL rejected the API key')
    if (res.status === 456) throw new TranslateError(502, 'DeepL quota exceeded')
    if (res.status === 400) throw new TranslateError(400, 'Translation is unavailable for this language pair')
    throw new TranslateError(502, 'Translation service returned an error')
  }
  const json = await res.json().catch(() => null) as { translations?: { text?: string }[] } | null
  const out = json?.translations?.[0]?.text
  if (typeof out !== 'string') throw new TranslateError(502, 'Translation service returned no text')
  return out
}

async function translateGoogle(text: string, source: string, target: string, c: TranslateConfig): Promise<string> {
  const key = c.google.apiKey
  if (!key) throw new TranslateError(503, 'Translation is not configured on this server')
  const res = await postJson(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: mapWith(GOOGLE_MAP, source),
        target: mapWith(GOOGLE_MAP, target),
        format: 'text',
      }),
    },
  )
  if (!res.ok) {
    if (res.status === 403) throw new TranslateError(502, 'Google rejected the API key')
    if (res.status === 400) throw new TranslateError(400, 'Translation is unavailable for this language pair')
    throw new TranslateError(502, 'Translation service returned an error')
  }
  const json = await res.json().catch(() => null) as { data?: { translations?: { translatedText?: string }[] } } | null
  const out = json?.data?.translations?.[0]?.translatedText
  if (typeof out !== 'string') throw new TranslateError(502, 'Translation service returned no text')
  return out
}

async function translateAzure(text: string, source: string, target: string, c: TranslateConfig): Promise<string> {
  const key = c.azure.apiKey
  if (!key) throw new TranslateError(503, 'Translation is not configured on this server')
  // encodeURIComponent: locale codes are request input validated only for
  // length, so encode at the boundary rather than trusting their charset
  // (same rule as the Google key above).
  const from = encodeURIComponent(mapWith(AZURE_MAP, source))
  const to = encodeURIComponent(mapWith(AZURE_MAP, target))
  const res = await postJson(
    `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${from}&to=${to}`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/json',
        ...(c.azure.region ? { 'Ocp-Apim-Subscription-Region': c.azure.region } : {}),
      },
      body: JSON.stringify([{ Text: text }]),
    },
  )
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new TranslateError(502, 'Azure rejected the API key (check the key and region)')
    if (res.status === 400) throw new TranslateError(400, 'Translation is unavailable for this language pair')
    throw new TranslateError(502, 'Translation service returned an error')
  }
  const json = await res.json().catch(() => null) as { translations?: { text?: string }[] }[] | null
  const out = Array.isArray(json) ? json[0]?.translations?.[0]?.text : undefined
  if (typeof out !== 'string') throw new TranslateError(502, 'Translation service returned no text')
  return out
}

/**
 * Translate `text` from `source` to `target` (both in app locale codes) using
 * the configured (or supplied) provider. Throws TranslateError on any failure —
 * callers map that to an HTTP response without leaking upstream internals.
 */
export async function translate(
  text: string, source: string, target: string, config?: TranslateConfig,
): Promise<string> {
  const c = config ?? resolveConfig()
  switch (c.provider) {
    case 'libretranslate': return translateLibre(text, source, target, c)
    case 'deepl':          return translateDeepL(text, source, target, c)
    case 'google':         return translateGoogle(text, source, target, c)
    case 'azure':          return translateAzure(text, source, target, c)
    case 'llm':            return translateLlm(text, source, target)
    default:               throw new TranslateError(503, 'Translation is not configured on this server')
  }
}

// The target language is named THREE times, including as the final instruction:
// smaller models weight the most recent instruction heavily, and the reported
// bug (Norwegian coming back as Swedish) is exactly a weak-target-signal failure
// for close languages. The language names carry their native form too (see
// LANG_NAMES) so "{TARGET}" reads e.g. "Norwegian Bokmål (norsk bokmål)".
const LLM_TRANSLATE_PROMPT =
  'You are a professional translation engine for résumé/CV content. ' +
  'Translate the user message from {SOURCE} into {TARGET}. ' +
  'Preserve the original line breaks, capitalisation style and any HTML tags exactly. ' +
  'Keep proper nouns, company names, product names and technology names untranslated. ' +
  'If the text is already written in {TARGET}, return it unchanged. ' +
  'Output ONLY the translation — no preamble, explanation, quotes or markdown fences. ' +
  'Your entire response MUST be written in {TARGET} and in no other language.'

/**
 * Strip the wrapper an LLM sometimes adds despite instructions. Unlike
 * `tidyLine` (summarize), this must PRESERVE the body: a CV field can be
 * several sentences or lines, so only fences and whole-text wrapping quotes go.
 */
export function tidyTranslation(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```[a-z]*\r?\n?/i, '').replace(/\r?\n?```$/i, '').trim()
  // Wrapping quotes only when they enclose the WHOLE text (not an inner quote).
  if (s.length > 1 && /^["“']/.test(s) && /["”']$/.test(s) && !/["”']/.test(s.slice(1, -1))) {
    s = s.slice(1, -1).trim()
  }
  return s
}

/**
 * Translate via the model configured for Summarize. Same endpoint, same key,
 * same model — so "use my local LLM for translation too" is zero extra config.
 *
 * Both languages must be ones we can NAME: an unknown code would leave the
 * prompt saying "translate to undefined", which a model happily answers with
 * nonsense. Failing loudly is better than silently returning the wrong language.
 * SummarizeError is remapped to TranslateError so the route's error contract
 * (and its "never leak upstream detail" rule) is unchanged.
 */
async function translateLlm(text: string, source: string, target: string): Promise<string> {
  const from = languageNameOf(source)
  const to = languageNameOf(target)
  if (!from || !to) {
    throw new TranslateError(400, `The AI translator does not support ${!from ? source : target}`)
  }
  try {
    const raw = await chatComplete(
      [
        {
          role: 'system',
          content: LLM_TRANSLATE_PROMPT.replace('{SOURCE}', from).replace(/\{TARGET\}/g, to),
        },
        { role: 'user', content: text },
      ],
      // Generous headroom: translations run longer than the source, and a hard
      // cut mid-sentence would silently truncate a CV field.
      { maxTokens: 1600, temperature: 0.1 },
    )
    const out = tidyTranslation(raw)
    if (!out) throw new TranslateError(502, 'The AI model returned no translation')
    return out
  } catch (err) {
    if (err instanceof TranslateError) throw err
    if (err instanceof SummarizeError) throw new TranslateError(err.status, err.message)
    throw new TranslateError(502, 'The AI model could not translate that text')
  }
}
