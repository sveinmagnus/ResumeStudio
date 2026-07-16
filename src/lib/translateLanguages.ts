/**
 * PURE: which languages the Docker LibreTranslate instance should install.
 *
 * Why this is a setting at all: the container downloads an Argos model package
 * per language (hundreds of MB each), so loading all 15 offered locales would
 * be a multi-GB download most users don't want. It shipped hardcoded to
 * `en,nb,sv,da` — which silently meant a German or Finnish "Draft" had no model
 * to translate with, even though the app offers those locales.
 *
 * Two rules the UI must not let the user break:
 *
 *  1. The locales they are EDITING IN right now (primary + secondary) are
 *     forced on. Deselecting the pair you're typing in is never what you meant,
 *     and the failure is silent (the Draft button just errors).
 *  2. English is always installed. Argos routes most pairs THROUGH English as a
 *     pivot — no `en` and even a fully selected no↔se pair can fail to resolve.
 *     Users don't know this, so we don't offer them the choice.
 */

import { LOCALE_CODES } from './locales'

/** English is the pivot language for Argos; every install needs it. */
export const PIVOT_LOCALE = 'en'

/** The default install set — matches what the compose file shipped with. */
export const DEFAULT_TRANSLATE_LANGUAGES = ['en', 'no', 'se', 'dk']

/**
 * Locales the user cannot deselect: the pivot plus whatever they're editing in.
 * `secondary` may be null (single-column mode).
 */
export function forcedLanguages(primary: string, secondary: string | null): string[] {
  const out = new Set<string>([PIVOT_LOCALE])
  if (isOfferedLocale(primary)) out.add(primary)
  if (secondary && isOfferedLocale(secondary)) out.add(secondary)
  return [...out]
}

/** True when `code` is a locale the app actually offers. */
export function isOfferedLocale(code: string): boolean {
  return LOCALE_CODES.includes(code)
}

/**
 * The final install set: the user's picks, plus the forced ones, minus anything
 * we don't offer. Ordered by LOCALE_CODES so the value is stable (a stable
 * string matters — it's compared to decide whether the container must restart).
 */
export function resolveTranslateLanguages(
  selected: readonly string[],
  primary: string,
  secondary: string | null,
): string[] {
  const want = new Set<string>([...selected, ...forcedLanguages(primary, secondary)])
  return LOCALE_CODES.filter((c) => want.has(c))
}
