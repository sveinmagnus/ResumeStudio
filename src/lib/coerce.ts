/**
 * Resume Studio — shared coercion + validation helpers for untrusted imports.
 *
 * `aiImport.ts` and `bulkImport.ts` both ingest JSON written by somebody else's
 * LLM, so both need the same "be generous about scalars, strict about shapes"
 * primitives. They each grew their own private copies, which then drifted —
 * `toYearMonth` gained a month-range clamp in one and not the other. This is
 * the single copy.
 *
 * SECURITY: everything here handles untrusted input. These functions only ever
 * produce strings/numbers/plain objects — they never build markup. Escaping is
 * the render boundary's job (viewFilter/richText).
 */

import type { YearMonth } from '../types'

/** A structural problem found while validating an import file. */
export interface ImportIssue {
  /** Dotted path to the offending field, e.g. `projects[0].start.year`. */
  path: string
  reason: string
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Coerce an incoming scalar to a trimmed string (numbers/booleans stringified). */
export function str(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/** `str()`, but an empty result becomes null (for nullable scalar columns). */
export function strOrNull(v: unknown): string | null {
  return str(v) || null
}

/** Trim + lower-case, for case-insensitive interning and duplicate keys. */
export function norm(s: string): string {
  return s.trim().toLowerCase()
}

/** Coerce a list-ish value to trimmed, non-empty strings. */
export function toNames(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map(str).filter(Boolean)
}

/**
 * Coerce a date-ish value to a `YearMonth | null`.
 *
 * Accepts a bare year (number or string) or a `{ year, month }` object. A month
 * outside 1–12 is dropped to `null` rather than carried through: month is
 * 1-based everywhere in the data model, so a 0 or 13 would silently produce a
 * wrong date downstream.
 *
 * (This clamp previously existed only in bulkImport; aiImport's copy checked
 * `Number.isInteger` alone. Validation happens to reject out-of-range months
 * before either mapper runs, so nothing was visibly broken — but the two copies
 * disagreeing about the same input is exactly the drift that motivated this
 * module. The stricter rule wins.)
 */
export function toYearMonth(val: unknown): YearMonth | null {
  if (val == null) return null
  if (typeof val === 'number' || typeof val === 'string') {
    const y = Number(val)
    return Number.isFinite(y) ? { year: Math.trunc(y), month: null } : null
  }
  if (isPlainObject(val)) {
    const y = Number(val['year'])
    if (!Number.isFinite(y)) return null
    const m = val['month'] == null ? null : Number(val['month'])
    const month = m && Number.isInteger(m) && m >= 1 && m <= 12 ? m : null
    return { year: Math.trunc(y), month }
  }
  return null
}

/**
 * Validate a date-ish value, appending any problem to `issues`.
 *
 * Lenient about representation (an LLM writing `2019` for `"2019"` is fine),
 * strict about anything that would silently lose or corrupt the date.
 */
export function checkDate(val: unknown, path: string, issues: ImportIssue[]): void {
  if (val == null) return
  if (typeof val === 'number' || typeof val === 'string') {
    const y = Number(val)
    if (!Number.isFinite(y) || y < 1000 || y > 3000) {
      issues.push({ path, reason: `expected a 4-digit year, got ${JSON.stringify(val)}` })
    }
    return
  }
  if (isPlainObject(val)) {
    const y = Number(val['year'])
    if (!Number.isFinite(y) || y < 1000 || y > 3000) {
      issues.push({ path: `${path}.year`, reason: `expected a 4-digit year, got ${JSON.stringify(val['year'])}` })
    }
    const m = val['month']
    if (m != null) {
      const mn = Number(m)
      if (!Number.isInteger(mn) || mn < 1 || mn > 12) {
        issues.push({ path: `${path}.month`, reason: `expected a month 1–12 or null, got ${JSON.stringify(m)}` })
      }
    }
    return
  }
  issues.push({ path, reason: 'expected a year number or a { year, month } object' })
}
