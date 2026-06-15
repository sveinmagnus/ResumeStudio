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
 *
 * Two pieces of intelligence keep the panel from nagging about the obvious:
 *  - the consultant's CURRENT engagement is auto-exempt — a single ongoing
 *    employment (the main job) and a single open full-time project (the main
 *    project) are never flagged as "still open?", however old they are;
 *  - any remaining warning can be dismissed by the user ("looks fine"), which
 *    suppresses it for a year via `Resume.attention_dismissals`.
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

/** How long (months) a dismissed warning stays suppressed — "at least a year". */
export const SNOOZE_MONTHS = 12

/**
 * The ISO timestamp at which a warning dismissed `at` should un-snooze. Pure
 * and injectable so the dismiss UI and tests agree on the policy in one place.
 */
export function snoozeUntil(at: Date = new Date(), months = SNOOZE_MONTHS): string {
  const d = new Date(at)
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

/** Stable dismissal key for a certification warning. */
export function certWarningKey(id: string): string {
  return `cert:${id}`
}

/** Stable dismissal key for a stale-ongoing warning. */
export function staleWarningKey(section: StaleOngoing['section'], id: string): string {
  return `stale:${section}:${id}`
}

export interface CertWarning {
  id: string
  name: string
  expires: YearMonth
  status: 'expired' | 'expiring'
  /** Key to pass to the store's dismissAttention(). */
  dismissKey: string
}

export interface StaleOngoing {
  id: string
  section: 'projects' | 'work_experiences'
  label: string
  start: YearMonth | null
  /** Key to pass to the store's dismissAttention(). */
  dismissKey: string
}

/** A warning the user has dismissed that is still within its snooze window. */
export interface SnoozedWarning {
  key: string
  label: string
  /** ISO timestamp when it un-snoozes and may surface again. */
  until: string
}

export interface FreshnessReport {
  expiredCerts: CertWarning[]
  expiringCerts: CertWarning[]
  staleOngoing: StaleOngoing[]
  /** Active warning count (excludes auto-exempt and currently-snoozed items). */
  total: number
  /** Warnings the user dismissed that are still suppressed — shown so they're recoverable. */
  snoozed: SnoozedWarning[]
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
  const nowMs = now.getTime()
  const dismissals = store.resume?.attention_dismissals ?? {}
  const snoozed: SnoozedWarning[] = []

  /** True when this warning was dismissed and the snooze hasn't lapsed yet. */
  const isSnoozed = (key: string): boolean => {
    const until = dismissals[key]
    if (!until) return false
    const t = Date.parse(until)
    return !Number.isNaN(t) && t > nowMs
  }

  const expiredCerts: CertWarning[] = []
  const expiringCerts: CertWarning[] = []
  for (const c of store.certifications) {
    if (c.disabled || !c.expires) continue
    // Year-only expiry is lenient: "expires 2025" means end of 2025.
    const idx = ymIndex(c.expires, 12)
    const monthsOut = idx - nowIdx
    const expired = monthsOut < 0
    if (!expired && monthsOut > config.expiringWithinMonths) continue // not a warning
    const name = resolve(c.name, locale) || 'Untitled certification'
    const key = certWarningKey(c.id)
    if (isSnoozed(key)) { snoozed.push({ key, label: name, until: dismissals[key] }); continue }
    const warning: CertWarning = {
      id: c.id, name, expires: c.expires,
      status: expired ? 'expired' : 'expiring', dismissKey: key,
    }
    if (expired) expiredCerts.push(warning)
    else expiringCerts.push(warning)
  }

  // The current engagement is auto-exempt from "still open?" nagging:
  //  - a SINGLE ongoing employment is the main job;
  //  - a SINGLE open full-time project is the main project (full-time = 100%
  //    allocation, OR unspecified/null — an open project with no part-time
  //    allocation set is assumed to be the consultant's main engagement).
  // Exactly one such item ⇒ exempt it; when several are open none is exempt,
  // since one of them may genuinely be a forgotten leftover.
  const ongoingEmployments = store.work_experiences.filter(
    (w) => !w.disabled && w.end === null && w.start,
  )
  const exemptEmploymentIds = new Set<string>()
  if (ongoingEmployments.length === 1) exemptEmploymentIds.add(ongoingEmployments[0].id)

  const openFullTimeProjects = store.projects.filter(
    (p) => !p.disabled && p.end === null && p.start &&
      (p.percent_allocated === null || p.percent_allocated >= 100),
  )
  const exemptProjectIds = new Set<string>()
  if (openFullTimeProjects.length === 1) exemptProjectIds.add(openFullTimeProjects[0].id)

  const staleThreshold = nowIdx - config.staleOngoingYears * 12
  const staleOngoing: StaleOngoing[] = []
  const collectStale = (
    items: Array<{ id: string; disabled?: boolean; start: YearMonth | null; end: YearMonth | null }>,
    section: StaleOngoing['section'],
    exempt: Set<string>,
    label: (it: { id: string }) => string,
  ) => {
    for (const it of items) {
      if (it.disabled || it.end !== null || !it.start) continue
      if (exempt.has(it.id)) continue // current main job / main project — never nag
      // Year-only start is treated as January (the earliest plausible date).
      if (ymIndex(it.start, 1) > staleThreshold) continue
      const lbl = label(it)
      const key = staleWarningKey(section, it.id)
      if (isSnoozed(key)) { snoozed.push({ key, label: lbl, until: dismissals[key] }); continue }
      staleOngoing.push({ id: it.id, section, label: lbl, start: it.start, dismissKey: key })
    }
  }
  collectStale(
    store.projects, 'projects', exemptProjectIds,
    (it) => resolve((it as { customer?: Parameters<typeof resolve>[0] }).customer, locale) || 'Untitled project',
  )
  collectStale(
    store.work_experiences, 'work_experiences', exemptEmploymentIds,
    (it) => resolve((it as { employer?: Parameters<typeof resolve>[0] }).employer, locale) || 'Untitled employer',
  )

  // Soonest-expiring / oldest-stale first so the most urgent reads at the top.
  expiredCerts.sort((a, b) => ymIndex(a.expires, 12) - ymIndex(b.expires, 12))
  expiringCerts.sort((a, b) => ymIndex(a.expires, 12) - ymIndex(b.expires, 12))
  staleOngoing.sort((a, b) =>
    (a.start ? ymIndex(a.start, 1) : 0) - (b.start ? ymIndex(b.start, 1) : 0))
  snoozed.sort((a, b) => a.label.localeCompare(b.label))

  return {
    expiredCerts,
    expiringCerts,
    staleOngoing,
    total: expiredCerts.length + expiringCerts.length + staleOngoing.length,
    snoozed,
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
