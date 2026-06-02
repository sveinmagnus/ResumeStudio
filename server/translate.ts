/**
 * Server-side proxy to a self-hosted LibreTranslate instance.
 *
 * Why proxy rather than call from the browser:
 *   - The LibreTranslate URL / API key stay server-side (the client is a pure
 *     browser app and never reads env vars — see CLAUDE.md §2).
 *   - CV text flows server→server inside the self-hosted deployment instead of
 *     leaving the browser to a third origin; no CORS to manage.
 *   - One auth perimeter: the proxy sits behind the same bearer-token
 *     middleware as the rest of /api.
 *
 * Translations are explicitly "drafts for review" — LibreTranslate quality on
 * Nordic languages is serviceable, not publication-grade.
 */

// Env is read lazily (per call) rather than at import time so tests can vary
// the config with vi.stubEnv, and so importing this module has no side effects.
// Runtime behaviour is unchanged — the env doesn't change after boot.
function libreUrl(): string | null {
  return process.env.LIBRETRANSLATE_URL?.trim().replace(/\/+$/, '') || null
}
function apiKey(): string {
  return process.env.LIBRETRANSLATE_API_KEY?.trim() || ''
}

/** Hard cap on a single translation request (chars). Generous for a CV field. */
export const MAX_TRANSLATE_CHARS = 5000

/** Upstream request timeout (ms). */
const TIMEOUT_MS = 15_000

/**
 * Map the app's locale codes to the ISO codes LibreTranslate/Argos expect.
 * The app uses CVpartner-flavoured codes (`no`, `se`, `dk`) that differ from
 * ISO 639-1. Unknown codes pass through lower-cased so a deployer can use any
 * language their instance has installed.
 *
 * NOTE: a near-identical map exists client-side in src/lib/translateClient.ts
 * for display gating. Kept duplicated rather than shared to avoid coupling the
 * server build to the client source tree; both are tiny and rarely change.
 */
const LOCALE_TO_SERVICE: Record<string, string> = {
  en: 'en',
  no: 'nb', // Norwegian Bokmål
  se: 'sv', // Swedish
  dk: 'da', // Danish
  de: 'de',
  fr: 'fr',
  es: 'es',
}

export function toServiceLocale(appCode: string): string {
  return LOCALE_TO_SERVICE[appCode] ?? appCode.toLowerCase()
}

/** True when a LibreTranslate URL has been configured. */
export function isTranslationConfigured(): boolean {
  return libreUrl() !== null
}

/** Raised for any upstream/translation failure; carries a safe HTTP status. */
export class TranslateError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'TranslateError'
  }
}

interface LibreTranslateResponse {
  translatedText?: string
  error?: string
}

/**
 * Translate `text` from `source` to `target` (both in app locale codes).
 * Throws TranslateError on any failure — callers map that to an HTTP response
 * without leaking upstream internals.
 */
export async function translate(text: string, source: string, target: string): Promise<string> {
  const url = libreUrl()
  if (!url) {
    throw new TranslateError(503, 'Translation is not configured on this server')
  }

  const key = apiKey()
  const body = {
    q: text,
    source: toServiceLocale(source),
    target: toServiceLocale(target),
    format: 'text',
    ...(key ? { api_key: key } : {}),
  }

  let res: Response
  try {
    res = await fetch(`${url}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Network error / timeout. Don't echo the underlying message (may contain
    // the internal URL).
    throw new TranslateError(502, 'Translation service is unreachable')
  }

  if (!res.ok) {
    // 400 from LibreTranslate usually means the language pair isn't installed.
    if (res.status === 400) {
      throw new TranslateError(400, 'Translation is unavailable for this language pair')
    }
    throw new TranslateError(502, 'Translation service returned an error')
  }

  let json: LibreTranslateResponse
  try {
    json = (await res.json()) as LibreTranslateResponse
  } catch {
    throw new TranslateError(502, 'Translation service returned an invalid response')
  }

  if (typeof json.translatedText !== 'string') {
    throw new TranslateError(502, 'Translation service returned no text')
  }
  return json.translatedText
}
