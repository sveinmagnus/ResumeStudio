/**
 * PURE: freshness & expiry warnings (roadmap F3) — surfaces stale/expiring
 * content on the Overview, in the spirit of `completeness.ts`. No timers, no
 * I/O: every check is computed from the store + an injected `now`, so it's
 * deterministic and unit-testable.
 *
 * Three signals:
 *  - certifications expired or expiring within N months,
 *  - projects / employments still marked "ongoing" (no end date) whose start is
 *    more than N years ago — likely the user forgot to close them out,
 *  - resume-level staleness (`isResumeStale`) drives a picker badge.
 */

import type { ResumeStore, YearMonth } from '../types'
import { resolve } from './locales'

export interface FreshnessConfig {
  /** A cert with `expires` this many months out (or fewer) is "expiring". Default 3. */
  expiringWithinMonths: number
  /** An ongoing item whose start is older than this many years is "stale". Default 3. */
  staleOngoingYears: number
}

export const DEFAULT_FRESHNESS: FreshnessConfig = {
  expiringWithinMonths: 3,
  staleOngoingYears: 3,
}

export interface CertWarning {
  id: string
  name: string
  expires: YearMonth
  status: 'expired' | 'expiring'
}

export interface StaleOngoing {
  id: string
  section: 'projects' | 'work_experiences'
  label: string
  start: YearMonth | null
}

export interface FreshnessReport {
  expiredCerts: CertWarning[]
  expiringCerts: CertWarning[]
  staleOngoing: StaleOngoing[]
  /** Total warning count — for a badge / "all clear" check. */
  total: number
}

/** 0-based absolute month index. `whenNull` picks the month for a year-only date. */
function ymIndex(ym: YearMonth, whenNull: 1 | 12): number {
  return ym.year * 12 + ((ym.month ?? whenNull) - 1)
}

function nowIndex(now: Date): number {
  return now.getFullYear() * 12 + now.getMonth() // getMonth() is 0-based
}

/**
 * Compute the freshness report. `now` is injected for testability; `locale`
 * picks the language for item labels.
 */
export function freshnessReport(
  store: ResumeStore,
  now: Date = new Date(),
  locale = 'en',
  config: FreshnessConfig = DEFAULT_FRESHNESS,
): FreshnessReport {
  const nowIdx = nowIndex(now)

  const expiredCerts: CertWarning[] = []
  const expiringCerts: CertWarning[] = []
  for (const c of store.certifications) {
    if (c.disabled || !c.expires) continue
    // Year-only expiry is lenient: "expires 2025" means end of 2025.
    const idx = ymIndex(c.expires, 12)
    const monthsOut = idx - nowIdx
    const warning: CertWarning = {
      id: c.id,
      name: resolve(c.name, locale) || 'Untitled certification',
      expires: c.expires,
      status: monthsOut < 0 ? 'expired' : 'expiring',
    }
    if (monthsOut < 0) expiredCerts.push(warning)
    else if (monthsOut <= config.expiringWithinMonths) expiringCerts.push(warning)
  }

  const staleThreshold = nowIdx - config.staleOngoingYears * 12
  const staleOngoing: StaleOngoing[] = []
  const collectStale = (
    items: Array<{ id: string; disabled?: boolean; start: YearMonth | null; end: YearMonth | null }>,
    section: StaleOngoing['section'],
    label: (it: { id: string }) => string,
  ) => {
    for (const it of items) {
      if (it.disabled || it.end !== null || !it.start) continue
      // Year-only start is treated as January (the earliest plausible date).
      if (ymIndex(it.start, 1) <= staleThreshold) {
        staleOngoing.push({ id: it.id, section, label: label(it), start: it.start })
      }
    }
  }
  collectStale(
    store.projects, 'projects',
    (it) => resolve((it as { customer?: Parameters<typeof resolve>[0] }).customer, locale) || 'Untitled project',
  )
  collectStale(
    store.work_experiences, 'work_experiences',
    (it) => resolve((it as { employer?: Parameters<typeof resolve>[0] }).employer, locale) || 'Untitled employer',
  )

  // Soonest-expiring / oldest-stale first so the most urgent reads at the top.
  expiredCerts.sort((a, b) => ymIndex(a.expires, 12) - ymIndex(b.expires, 12))
  expiringCerts.sort((a, b) => ymIndex(a.expires, 12) - ymIndex(b.expires, 12))
  staleOngoing.sort((a, b) =>
    (a.start ? ymIndex(a.start, 1) : 0) - (b.start ? ymIndex(b.start, 1) : 0))

  return {
    expiredCerts,
    expiringCerts,
    staleOngoing,
    total: expiredCerts.length + expiringCerts.length + staleOngoing.length,
  }
}

/**
 * Whether a resume hasn't been saved in `months` months — drives the picker's
 * "not updated in a while" badge. Bad/empty timestamps are treated as fresh.
 */
export function isResumeStale(savedAt: string, now: Date = new Date(), months = 6): boolean {
  const saved = Date.parse(savedAt)
  if (Number.isNaN(saved)) return false
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - months)
  return saved < cutoff.getTime()
}
