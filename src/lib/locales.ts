import type { LocalizedString, ResumeStore } from '../types'

/**
 * The offerable locales. Deliberately limited to Latin/Cyrillic-script European
 * languages: every one of these shares the structural assumptions the render
 * path makes — left-to-right, space-separated words, and a month/"Present"
 * vocabulary that fits a CV date range. CJK, Arabic and Indic languages were
 * offered until v0.7.4 but never had the chrome translations, the RTL support
 * (Arabic), or the typographic handling to back them up, so they were removed
 * rather than left as English-only stubs.
 *
 * EVERY code here must have a full set of chrome translations — months and
 * `PRESENT` below, `SECTION_HEADINGS` (lib/sections.ts), the export dictionary
 * (lib/exportStrings.ts), and the label sets in lib/positionTypes.ts,
 * lib/publicationTypes.ts and lib/recommendationRelationships.ts. Tests pin
 * that completeness, so adding a locale here fails the suite until it is
 * translated everywhere. That is the intended workflow — don't relax the tests.
 */
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
}

/** Every offerable locale code, in display order. */
export const LOCALE_CODES: string[] = Object.keys(LOCALE_LABELS)

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

/** Date format for exported views. See the DateFormat type. */
export type DateFormat =
  | 'month-year' | 'year-month'
  | 'month-year-num' | 'year-month-num'
  | 'year-only'

// Localized month abbreviations for exported views — one entry per
// LOCALE_LABELS code (pinned by tests). Each follows its own language's CLDR
// abbreviated form, which is why capitalisation and the trailing period vary:
// English and German capitalise, the Nordics and Romance languages don't, and
// Swedish/Finnish spell short month names out rather than abbreviate them.
// Unknown locales fall back to English.
//
// Exported for the locale-coverage test only: a missing locale here degrades to
// English rather than throwing, so completeness is invisible through `fmtDate`
// and has to be asserted against the table itself. Render code calls `fmtDate`.
export const MONTH_ABBR: Record<string, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  no: ['jan.', 'feb.', 'mar.', 'apr.', 'mai', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'],
  se: ['jan.', 'feb.', 'mars', 'apr.', 'maj', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'],
  dk: ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'],
  de: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  es: ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'],
  it: ['gen.', 'feb.', 'mar.', 'apr.', 'mag.', 'giu.', 'lug.', 'ago.', 'set.', 'ott.', 'nov.', 'dic.'],
  nl: ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'],
  pt: ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'],
  pl: ['sty.', 'lut.', 'mar.', 'kwi.', 'maj', 'cze.', 'lip.', 'sie.', 'wrz.', 'paź.', 'lis.', 'gru.'],
  fi: ['tammik.', 'helmik.', 'maalisk.', 'huhtik.', 'toukok.', 'kesäk.', 'heinäk.', 'elok.', 'syysk.', 'lokak.', 'marrask.', 'jouluk.'],
  is: ['jan.', 'feb.', 'mar.', 'apr.', 'maí', 'jún.', 'júl.', 'ágú.', 'sep.', 'okt.', 'nóv.', 'des.'],
  ru: ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
  uk: ['січ.', 'лют.', 'бер.', 'квіт.', 'трав.', 'черв.', 'лип.', 'серп.', 'вер.', 'жовт.', 'лист.', 'груд.'],
}

// The word for an ongoing end date, as it reads in a CV date range
// ("2021 – Present"). One entry per LOCALE_LABELS code. Exported for the
// coverage test for the same reason as MONTH_ABBR; render code calls
// `presentLabel`.
export const PRESENT: Record<string, string> = {
  en: 'Present', no: 'Nå', se: 'Nu', dk: 'Nu', de: 'Heute', fr: 'Présent', es: 'Presente',
  it: 'Presente', nl: 'Heden', pt: 'Presente', pl: 'Obecnie', fi: 'Nykyinen', is: 'Í dag',
  ru: 'Настоящее время', uk: 'Дотепер',
}
const monthAbbr = (locale: string): string[] => MONTH_ABBR[locale] ?? MONTH_ABBR.en
/** The localized word for an ongoing end date ("Present"). */
export const presentLabel = (locale = 'en'): string => PRESENT[locale] ?? PRESENT.en

/**
 * Format a YearMonth per the chosen format — e.g. "Mar 2021" / "2021 Mar" /
 * "03/2021" / "2021/03" / "2021". A month-less date always renders as the bare
 * year regardless of format. `locale` localizes the month abbreviation
 * (defaults to English for callers that don't care, e.g. the editor chrome).
 */
export function fmtDate(
  ym: { year: number; month: number | null } | null,
  format: DateFormat = 'month-year',
  locale = 'en',
): string {
  if (!ym) return ''
  if (format === 'year-only' || !ym.month) return `${ym.year}`
  switch (format) {
    case 'month-year-num': return `${String(ym.month).padStart(2, '0')}/${ym.year}`
    case 'year-month-num': return `${ym.year}/${String(ym.month).padStart(2, '0')}`
    default: {
      const mon = monthAbbr(locale)[ym.month - 1]
      return format === 'year-month' ? `${ym.year} ${mon}` : `${mon} ${ym.year}`
    }
  }
}

/** Format a date range. An open end renders as the localized "Present". */
export function fmtRange(
  start: { year: number; month: number | null } | null,
  end: { year: number; month: number | null } | null,
  format: DateFormat = 'month-year',
  locale = 'en',
): string {
  const s = fmtDate(start, format, locale)
  const present = presentLabel(locale)
  const e = end ? fmtDate(end, format, locale) : present
  if (!s) return e === present ? '' : e
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
