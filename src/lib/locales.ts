import type { LocalizedString } from '../types'

export const LOCALE_LABELS: Record<string, { name: string; flag: string }> = {
  en: { name: 'English', flag: '🇬🇧' },
  no: { name: 'Norsk', flag: '🇳🇴' },
  se: { name: 'Svenska', flag: '🇸🇪' },
  dk: { name: 'Dansk', flag: '🇩🇰' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  fr: { name: 'Français', flag: '🇫🇷' },
  es: { name: 'Español', flag: '🇪🇸' },
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
