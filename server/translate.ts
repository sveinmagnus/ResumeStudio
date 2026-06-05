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

export type TranslateProvider = 'off' | 'libretranslate' | 'deepl' | 'google' | 'azure'

const PROVIDERS: readonly TranslateProvider[] = ['off', 'libretranslate', 'deepl', 'google', 'azure']

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
  if ((PROVIDERS as string[]).includes(explicit)) provider = explicit as TranslateProvider
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
    default:               return false
  }
}

// ─── Locale maps (app codes → each provider's expected codes) ───────────────
// The app uses CVpartner-flavoured codes (`no`, `se`, `dk`). Each provider wants
// slightly different ISO variants. Unknown codes pass through lower-cased so a
// deployer can use any language a provider supports.

/** LibreTranslate / Argos codes. Also the public `toServiceLocale` (kept for compat). */
const LIBRE_MAP: Record<string, string> = { en: 'en', no: 'nb', se: 'sv', dk: 'da', de: 'de', fr: 'fr', es: 'es' }
export function toServiceLocale(appCode: string): string {
  return LIBRE_MAP[appCode] ?? appCode.toLowerCase()
}

const DEEPL_SOURCE: Record<string, string> = { en: 'EN', no: 'NB', se: 'SV', dk: 'DA', de: 'DE', fr: 'FR', es: 'ES' }
// DeepL requires a regional variant for an English *target* (bare EN is rejected).
const DEEPL_TARGET: Record<string, string> = { ...DEEPL_SOURCE, en: 'EN-GB' }
const GOOGLE_MAP: Record<string, string> = { en: 'en', no: 'no', se: 'sv', dk: 'da', de: 'de', fr: 'fr', es: 'es' }
const AZURE_MAP: Record<string, string> = { en: 'en', no: 'nb', se: 'sv', dk: 'da', de: 'de', fr: 'fr', es: 'es' }

const mapWith = (m: Record<string, string>, code: string): string => m[code] ?? code.toLowerCase()

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
      source_lang: mapWith(DEEPL_SOURCE, source),
      target_lang: mapWith(DEEPL_TARGET, target),
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
  const from = mapWith(AZURE_MAP, source)
  const to = mapWith(AZURE_MAP, target)
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
    default:               throw new TranslateError(503, 'Translation is not configured on this server')
  }
}
