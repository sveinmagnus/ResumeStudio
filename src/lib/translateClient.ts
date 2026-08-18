/**
 * Client-side helpers for the translation-assist feature. Pure logic only
 * (no React) — the React hook lives in store/useTranslation.ts.
 *
 * The actual translation request goes through the Express proxy (see
 * lib/api.ts → api.translate); this module just maps locale codes and
 * memoizes the one-time "is translation configured?" probe so every DualField
 * instance shares a single network call.
 */
import { api } from './api'
import { lookup } from './lookup'

/**
 * App locale code → ISO code the translation service expects. Mirrors the map
 * in server/translate.ts (kept duplicated to avoid coupling the two build
 * trees; both are tiny). Used here only to decide whether a draft makes sense.
 */
const LOCALE_TO_SERVICE: Record<string, string> = {
  en: 'en',
  no: 'nb',
  se: 'sv',
  dk: 'da',
  de: 'de',
  fr: 'fr',
  es: 'es',
}

export function toServiceLocale(appCode: string): string {
  return lookup(LOCALE_TO_SERVICE, appCode, appCode.toLowerCase())
}

/**
 * Can we meaningfully draft a translation between these two app locales?
 * False when they map to the same service language (e.g. an unknown code that
 * collides), which would make the request a no-op.
 */
export function canDraftBetween(source: string, target: string): boolean {
  return toServiceLocale(source) !== toServiceLocale(target)
}

// ── Memoized availability probe ───────────────────────────────────────────

let availabilityPromise: Promise<boolean> | null = null

/**
 * Resolve once to whether the server has translation configured. Cached for
 * the page lifetime so N DualFields don't each hit /api/translate/status.
 */
export function getTranslationAvailability(): Promise<boolean> {
  if (!availabilityPromise) {
    availabilityPromise = api.translateStatus()
  }
  return availabilityPromise
}

/** Reset the memoized probe — for tests only. */
export function resetTranslationAvailability(): void {
  availabilityPromise = null
}
