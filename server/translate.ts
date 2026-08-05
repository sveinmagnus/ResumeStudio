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

import { chatComplete, isLlmConfigured, languageDirective, languageNameOf, LlmError } from './llm.js'
import {
  ensureDeeplGlossary, glossaryPromptBlock, googleMarkup, googleUnmarkup,
  type WireGlossary,
} from './glossary.js'

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
    // Borrowed wholesale from the AI-assist config — if a model is configured
    // there, translation is configured here.
    case 'llm':            return isLlmConfigured()
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

async function translateDeepL(
  text: string, source: string, target: string, c: TranslateConfig, glossary?: WireGlossary,
): Promise<string> {
  const key = c.deepl.apiKey
  if (!key) throw new TranslateError(503, 'Translation is not configured on this server')
  // DeepL Free keys end in ':fx' and use a separate host.
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
  const sourceLang = mapDeepL(DEEPL_SOURCE, source)
  const targetLang = mapDeepL(DEEPL_TARGET, target)

  // DeepL is the one provider with first-class glossary support: a real
  // server-side resource, reused by id across calls (see ensureDeeplGlossary).
  // Best-effort — a null id simply means translating without it, because losing
  // the translation to a glossary hiccup would be a poor trade.
  const glossaryId = glossary
    ? await ensureDeeplGlossary(glossary, { host, key, sourceLang, targetLang }, TIMEOUT_MS)
    : null

  const res = await postJson(`${host}/v2/translate`, {
    method: 'POST',
    headers: { 'Authorization': `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: [text],
      source_lang: sourceLang,
      target_lang: targetLang,
      // A glossary requires an explicit source_lang, which we always send.
      ...(glossaryId ? { glossary_id: glossaryId } : {}),
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

async function translateGoogle(
  text: string, source: string, target: string, c: TranslateConfig, glossary?: WireGlossary,
): Promise<string> {
  const key = c.google.apiKey
  if (!key) throw new TranslateError(503, 'Translation is not configured on this server')
  const marked = googleMarkup(text, glossary)
  const res = await postJson(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: marked.html,
        source: mapWith(GOOGLE_MAP, source),
        target: mapWith(GOOGLE_MAP, target),
        // v2 has no glossary parameter (that's v3 Advanced, which needs a
        // service account). `notranslate` spans in HTML mode are the supported
        // way to pin terminology here — see googleMarkup.
        format: marked.used ? 'html' : 'text',
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
  // Only unwrap what we wrapped. HTML mode also entity-encodes the rest of the
  // text, so this must run on exactly the requests that used it.
  return marked.used ? googleUnmarkup(out) : out
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
  glossary?: WireGlossary,
): Promise<string> {
  const c = config ?? resolveConfig()
  switch (c.provider) {
    // LibreTranslate has no glossary or tag-protection facility to hook into,
    // so it is the one provider the glossary cannot reach.
    case 'libretranslate': return translateLibre(text, source, target, c)
    case 'deepl':          return translateDeepL(text, source, target, c, glossary)
    case 'google':         return translateGoogle(text, source, target, c, glossary)
    case 'azure':          return translateAzure(text, source, target, c)
    case 'llm':            return translateLlm(text, source, target, glossary)
    default:               throw new TranslateError(503, 'Translation is not configured on this server')
  }
}

/**
 * The target language is named FOUR times and, crucially, twice in the turn the
 * model reads immediately before generating: once as the task line above the
 * text and once as the closing instruction below it, in the target language
 * itself (see `languageDirective`).
 *
 * The previous version said all of this in the system prompt only, and it was
 * not enough on 8B-class local models — the reported failure (English→Norwegian
 * answered in Swedish) kept happening. Chat templates render the system message
 * far from the generation point and some Ollama modelfiles dilute or drop it
 * altogether, so an instruction that lives only there is the weakest place to
 * put the one thing that must not be got wrong.
 *
 * Note what is NOT here: the languages it must avoid. Writing "not Swedish"
 * into the prompt puts Swedish tokens in the context, which is the opposite of
 * what a confusable target needs.
 */
const LLM_TRANSLATE_RULES = [
  'You are a professional translation engine for résumé/CV content.',
  'You translate from {SOURCE} into {TARGET}.',
  'Preserve the original line breaks, capitalisation style and any HTML tags exactly.',
  'Keep proper nouns, company names, product names and technology names untranslated.',
  'If the text is already written in {TARGET}, return it unchanged.',
  'Output ONLY the translation — no preamble, explanation, quotes or markdown fences.',
  'Your entire response MUST be written in {TARGET} and in no other language.',
].join(' ')

/** The user turn: the task, the delimited source, then the target restated last. */
const LLM_TRANSLATE_TASK = [
  'Translate the text between the ### markers from {SOURCE} into {TARGET}.',
  '',
  '###',
  '{TEXT}',
  '###',
  '',
  'Output only the {TARGET} translation of that text — no markers, no notes, no original text.',
  '{DIRECTIVE}',
].join('\n')

/** Retry line, added when the first reply came back in the wrong language. */
const LLM_TRANSLATE_INSIST =
  'The previous attempt was not written in {TARGET}. Every word of your answer must be {TARGET}.'

/**
 * Strip the wrapper an LLM sometimes adds despite instructions. Unlike
 * `tidyLine` (summarize), this must PRESERVE the body: a CV field can be
 * several sentences or lines, so only fences and whole-text wrapping quotes go.
 *
 * The `###` markers the prompt wraps the source in are stripped too: delimiters
 * are what make a weak model treat the text as data rather than instructions,
 * and the price is that it sometimes echoes them back around its answer.
 */
export function tidyTranslation(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```[a-z]*\r?\n?/i, '').replace(/\r?\n?```$/i, '').trim()
  // Echoed delimiter lines, leading and trailing only — a '###' inside the body
  // could be the user's own text.
  s = s.replace(/^#{2,}[ \t]*\r?\n/, '').replace(/\r?\n[ \t]*#{2,}$/, '').trim()
  // Wrapping quotes only when they enclose the WHOLE text (not an inner quote).
  if (s.length > 1 && /^["“']/.test(s) && /["”']$/.test(s) && !/["”']/.test(s.slice(1, -1))) {
    s = s.slice(1, -1).trim()
  }
  return s
}

/**
 * Markers that a piece of text is in a language OTHER than the mainland
 * Scandinavian one we asked for. Function words and letters only — no
 * dictionary, no dependency.
 *
 * Why only these three: they are the pairs a model actually confuses (a request
 * for Norwegian answered in Swedish or Danish), and they are close enough that a
 * handful of everyday words separates them reliably. For every other target the
 * guard is a no-op, which is correct — a model does not answer a French request
 * in Polish.
 */
const SCANDINAVIAN_MARKERS: Record<string, RegExp[]> = {
  // Swedish: the vowels Norwegian/Danish write as æ/ø, plus everyday words with
  // a different form in both of the others.
  se: [/[äö]/i, /\boch\b/i, /\bär\b/i, /\bför\b/i, /\bfrån\b/i, /\binte\b/i, /\bmycket\b/i, /\bäven\b/i],
  // Danish: 'af' (no/se 'av'), 'meget' (no 'mye'), 'nogle/nogen' (no 'noen'),
  // and the -tion ending Norwegian writes -sjon.
  dk: [/\baf\b/i, /\bmeget\b/i, /\bnogle\b/i, /\bnogen\b/i, /\b\w{3,}tion(er|en|erne|s)?\b/i],
  // Norwegian: æ/ø against Swedish, -sjon against both, 'mye', 'ikke' (se 'inte').
  no: [/[æø]/i, /\b\w{3,}sjon(er|en|ene|s)?\b/i, /\bmye\b/i, /\bikke\b/i],
}

/** Which languages count as "wrong" for a given Scandinavian target. */
const SCANDINAVIAN_RIVALS: Record<string, string[]> = {
  no: ['se', 'dk'],
  se: ['no', 'dk'],
  dk: ['se', 'no'],
}

/**
 * True when `text` carries at least two distinct markers of a language that is
 * NOT `target` — our "the model answered in Swedish again" detector.
 *
 * Two markers, not one, on purpose: a Norwegian CV line legitimately containing
 * a Swedish customer name (Öhlins) trips exactly one, and re-running a correct
 * translation costs the user time and tokens. Two everyday markers in a field
 * this short is not a loanword, it is the wrong language.
 *
 * Exported for the tests, which are the only reason to believe it discriminates.
 */
export function looksWrongLanguage(text: string, target: string): boolean {
  const rivals = SCANDINAVIAN_RIVALS[target]
  if (!rivals) return false
  const own = SCANDINAVIAN_MARKERS[target] ?? []
  for (const rival of rivals) {
    const hits = (SCANDINAVIAN_MARKERS[rival] ?? []).filter((re) => re.test(text)).length
    if (hits < 2) continue
    // Don't fire when the target's own markers are just as present — mainland
    // Scandinavian shares most of its vocabulary, and a text showing both is
    // more likely a mixed quotation than a whole answer in the wrong language.
    if (own.filter((re) => re.test(text)).length >= hits) continue
    return true
  }
  return false
}

/**
 * Translate via the app's configured AI model. Same endpoint, same key,
 * same model — so "use my local LLM for translation too" is zero extra config.
 *
 * Both languages must be ones we can NAME: an unknown code would leave the
 * prompt saying "translate to undefined", which a model happily answers with
 * nonsense. Failing loudly is better than silently returning the wrong language.
 * LlmError is remapped to TranslateError so the route's error contract
 * (and its "never leak upstream detail" rule) is unchanged.
 */
async function translateLlm(
  text: string, source: string, target: string, glossary?: WireGlossary,
): Promise<string> {
  const from = languageNameOf(source)
  const to = languageNameOf(target)
  if (!from || !to) {
    throw new TranslateError(400, `The AI translator does not support ${!from ? source : target}`)
  }
  const fill = (s: string) => s.replace(/\{SOURCE\}/g, from).replace(/\{TARGET\}/g, to)
  // The glossary rides in the SYSTEM message, as a constraint on how to
  // translate rather than content to translate — but BEFORE the closing
  // language line, so the last thing the system message says is still which
  // language to answer in. Already scoped by the client to terms present in this
  // text, so it stays a few lines even on a CV with hundreds of registry
  // entries — small enough for a 3B model to obey.
  const block = glossaryPromptBlock(glossary)
  const directive = languageDirective(target)
  const system = fill(LLM_TRANSLATE_RULES)
    + (block ? `\n\n${block}` : '')
    + (directive ? `\n\n${directive}` : '')

  const ask = async (insist: boolean): Promise<string> => {
    const closing = insist ? `${fill(LLM_TRANSLATE_INSIST)} ${directive}`.trim() : directive
    // Replacer FUNCTIONS, not strings: a CV field containing "$1" or "$&" would
    // otherwise be mangled by String.replace's substitution patterns.
    const user = fill(LLM_TRANSLATE_TASK)
      .replace('{TEXT}', () => text)
      .replace('{DIRECTIVE}', () => closing)
      .trimEnd()
    const raw = await chatComplete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // Generous headroom: translations run longer than the source, and a hard
      // cut mid-sentence would silently truncate a CV field. Temperature 0 —
      // there is a right answer here, and sampling is one of the ways a model
      // wanders into a neighbouring language.
      { maxTokens: 1600, temperature: 0 },
    )
    return tidyTranslation(raw)
  }

  try {
    let out = await ask(false)
    // One retry, and only on hard evidence (see looksWrongLanguage). Prompting
    // alone has been tried twice for this failure; a model that has already
    // answered in the wrong language is best given the instruction again with
    // its mistake named, and if it insists we hand back the second attempt
    // rather than a third round-trip the user is waiting on.
    if (out && looksWrongLanguage(out, target)) {
      // A failed retry must not lose the answer we already have: a suspect
      // draft the user can fix beats an error message, and the whole feature is
      // review-required anyway.
      const retried = await ask(true).catch(() => '')
      if (retried) out = retried
    }
    if (!out) throw new TranslateError(502, 'The AI model returned no translation')
    return out
  } catch (err) {
    if (err instanceof TranslateError) throw err
    if (err instanceof LlmError) throw new TranslateError(err.status, err.message)
    throw new TranslateError(502, 'The AI model could not translate that text')
  }
}
