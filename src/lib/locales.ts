import type { LocalizedString, ResumeStore } from '../types'

export const LOCALE_LABELS: Record<string, { name: string; flag: string }> = {
  en: { name: 'English', flag: '🇬🇧' },
  no: { name: 'Norsk', flag: '🇳🇴' },
  se: { name: 'Svenska', flag: '🇸🇪' },
  dk: { name: 'Dansk', flag: '🇩🇰' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  fr: { name: 'Français', flag: '🇫🇷' },
  es: { name: 'Español', flag: '🇪🇸' },
  it: { name: 'Italiano', flag: '🇮🇹' },
  nl: { name: 'Nederlands', flag: '🇳🇱' },
  pt: { name: 'Português', flag: '🇵🇹' },
  pl: { name: 'Polski', flag: '🇵🇱' },
  fi: { name: 'Suomi', flag: '🇫🇮' },
  is: { name: 'Íslenska', flag: '🇮🇸' },
  ru: { name: 'Русский', flag: '🇷🇺' },
  uk: { name: 'Українська', flag: '🇺🇦' },
  zh: { name: '中文', flag: '🇨🇳' },
  ja: { name: '日本語', flag: '🇯🇵' },
  ar: { name: 'العربية', flag: '🇸🇦' },
  hi: { name: 'हिन्दी', flag: '🇮🇳' },
}

/**
 * App locale code → BCP-47 language tag for HTML `lang` attributes.
 * The CVpartner-derived codes `se`/`dk` are *country* codes, not language
 * codes (BCP-47 `se` is Northern Sami; `dk` is unassigned) — map them to
 * Swedish/Danish so screen readers pick the right voice and the browser
 * spell-checker picks the right dictionary. Everything else in
 * LOCALE_LABELS is already a valid ISO 639-1 code.
 */
export function bcp47(locale: string): string {
  if (locale === 'se') return 'sv'
  if (locale === 'dk') return 'da'
  return locale
}

/** Resolve a localized string for display with fallback chain. */
export function resolve(ls: LocalizedString | undefined, locale: string, fallback = 'en'): string {
  if (!ls) return ''
  if (ls[locale]) return ls[locale]
  if (ls[fallback]) return ls[fallback]
  for (const v of Object.values(ls)) if (v) return v
  return ''
}

/** Format a YearMonth as e.g. "Mar 2021" or "2021". */
export function fmtDate(ym: { year: number; month: number | null } | null): string {
  if (!ym) return ''
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return ym.month ? `${months[ym.month - 1]} ${ym.year}` : `${ym.year}`
}

/** Format a date range. */
export function fmtRange(start: { year: number; month: number | null } | null, end: { year: number; month: number | null } | null): string {
  const s = fmtDate(start)
  const e = end ? fmtDate(end) : 'Present'
  if (!s) return e === 'Present' ? '' : e
  return `${s} – ${e}`
}

/**
 * Human-friendly "time ago" for snapshot timestamps. `now` is injectable so
 * the formatting is deterministic in tests. Falls back to a locale date/time
 * string for anything older than a day.
 */
export function fmtRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.round((now - then) / 1000)
  if (secs < 0) return 'just now'
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  return new Date(iso).toLocaleString()
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Walk the entire store and return every locale code (from LOCALE_LABELS)
 * that has at least one non-empty value somewhere. Used when:
 *
 *   - the importer needs to detect locales the source file under-declared
 *     (CVpartner exports lie about language_codes)
 *   - the user pastes content in a new language and wants the LanguageSwitcher
 *     to surface it
 *
 * `int` is normalised to `en` to match the importer's convention.
 */
export function detectLocalesInData(data: ResumeStore): string[] {
  // `int` is the CVpartner-export name for English; we treat it as `en`
  // here so this detector matches the importer's normalization.
  const known = new Set([...Object.keys(LOCALE_LABELS), 'int'])
  const found = new Set<string>()

  const scan = (val: unknown): void => {
    if (!val || typeof val !== 'object') return
    if (Array.isArray(val)) { val.forEach(scan); return }
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (known.has(k) && typeof v === 'string' && v.trim()) {
        found.add(k === 'int' ? 'en' : k)
      } else if (typeof v === 'object') {
        scan(v)
      }
    }
  }
  scan(data)
  return [...found]
}

/**
 * Order locales for display: `no` first, then `en`, then the rest in their
 * incoming order. Mirrors the importer's convention so the same set always
 * displays the same way.
 */
export function sortLocales(locales: string[]): string[] {
  const rank = (l: string) => (l === 'no' ? 0 : l === 'en' ? 1 : 2)
  return [...new Set(locales)].sort((a, b) => rank(a) - rank(b))
}
