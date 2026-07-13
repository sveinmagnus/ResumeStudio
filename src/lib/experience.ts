/**
 * PURE: years-of-experience computation for the Skill and Role registries.
 *
 * "Years of experience" is not a stored, hand-typed number — it is derived from
 * the calendar span of the assignments that reference the registry entry:
 *  - a SKILL's experience spans the projects that list it (`project.skills`);
 *  - a ROLE's experience spans the projects (`project.roles`), employments
 *    (`work_experience.role_ids`) and other-roles (`position.role_ids`) that
 *    link it.
 *
 * Overlapping assignments are merged (union of calendar intervals) so two
 * concurrent two-year projects read as two years, not four — matching how
 * "years of experience" is normally understood.
 *
 * On top of the computed base the consultant applies a signed ADJUSTMENT
 * (`Skill.experience_offset_years` / `Role.years_of_experience_offset`), e.g. to
 * credit pre-CV experience the resume doesn't itemise. The displayed total is
 * `computed + adjustment`, floored at zero.
 *
 * Legacy fallback: when an entry has NO dated assignments (typical for a freshly
 * imported registry that carries a bare number), the stored legacy total
 * (`Skill.total_duration_in_years` / `Role.years_of_experience`) is used as the
 * base so imported figures aren't lost.
 *
 * Disabled assignments are skipped (they don't export, so they don't count),
 * mirroring the Skill Matrix.
 */

import type { ResumeStore, Skill, Role, YearMonth } from '../types'

const monthsOf = (ym: YearMonth): number => ym.year * 12 + (ym.month ?? 1)

interface Range { start: YearMonth; end: YearMonth }

/**
 * Total number of months covered by the union of inclusive [start, end] month
 * ranges. Overlapping/adjacent ranges are merged so shared calendar time is
 * counted once. A single-month range (start === end) counts as one month.
 */
export function unionMonths(ranges: Range[]): number {
  if (!ranges.length) return 0
  const sorted = ranges
    .map((r) => ({ a: monthsOf(r.start), b: Math.max(monthsOf(r.start), monthsOf(r.end)) }))
    .sort((x, y) => x.a - y.a)
  let total = 0
  let curA = sorted[0].a
  let curB = sorted[0].b
  for (const r of sorted.slice(1)) {
    if (r.a <= curB) { curB = Math.max(curB, r.b) }
    else { total += curB - curA + 1; curA = r.a; curB = r.b }
  }
  total += curB - curA + 1
  return total
}

export interface ExperienceSummary {
  /** Base experience in whole months (calendar union, or the legacy fallback). */
  computedMonths: number
  /** Signed manual adjustment in whole months. */
  adjustmentMonths: number
  /** `computedMonths + adjustmentMonths`, floored at 0. */
  totalMonths: number
  /** True when `computedMonths` came from the stored legacy number, not dated ranges. */
  usesFallback: boolean
}

function summarize(computedMonths: number, adjustmentYears: number, fallbackYears: number): ExperienceSummary {
  let base = computedMonths
  let usesFallback = false
  if (base === 0 && fallbackYears > 0) {
    base = Math.round(fallbackYears * 12)
    usesFallback = true
  }
  const adjustmentMonths = Math.round((adjustmentYears || 0) * 12)
  return { computedMonths: base, adjustmentMonths, totalMonths: Math.max(0, base + adjustmentMonths), usesFallback }
}

const nowYearMonth = (now: Date): YearMonth => ({ year: now.getFullYear(), month: now.getMonth() + 1 })

/** Computed + adjusted experience for a skill (from the projects that use it). */
export function skillExperience(store: ResumeStore, skill: Skill, now: Date = new Date()): ExperienceSummary {
  const nowYm = nowYearMonth(now)
  const ranges: Range[] = []
  for (const p of store.projects) {
    if (p.disabled || !p.start) continue
    if (p.skills.some((ps) => ps.skill_id === skill.id)) {
      ranges.push({ start: p.start, end: p.end ?? nowYm })
    }
  }
  return summarize(unionMonths(ranges), skill.experience_offset_years ?? 0, skill.total_duration_in_years || 0)
}

/** Computed + adjusted experience for a role (projects + employments + other-roles). */
export function roleExperience(store: ResumeStore, role: Role, now: Date = new Date()): ExperienceSummary {
  const nowYm = nowYearMonth(now)
  const ranges: Range[] = []
  for (const p of store.projects) {
    if (p.disabled || !p.start) continue
    if (p.roles.some((pr) => pr.role_id === role.id)) ranges.push({ start: p.start, end: p.end ?? nowYm })
  }
  for (const w of store.work_experiences) {
    if (w.disabled || !w.start) continue
    if (w.role_ids.includes(role.id)) ranges.push({ start: w.start, end: w.end ?? nowYm })
  }
  for (const pos of store.positions) {
    if (pos.disabled || !pos.start) continue
    if ((pos.role_ids ?? []).includes(role.id)) ranges.push({ start: pos.start, end: pos.end ?? nowYm })
  }
  return summarize(unionMonths(ranges), role.years_of_experience_offset || 0, role.years_of_experience || 0)
}

// ─── Display / input helpers ──────────────────────────────────────────────────

/** "3y 4m", "7m", "2y", or "—" for zero. Never renders a negative total. */
export function fmtYearsMonths(totalMonths: number): string {
  const m = Math.max(0, Math.round(totalMonths))
  if (m === 0) return '—'
  const y = Math.floor(m / 12)
  const mo = m % 12
  return [y ? `${y}y` : '', mo ? `${mo}m` : ''].filter(Boolean).join(' ')
}

/**
 * Split a signed month count into consistent-signed {years, months} for the two
 * adjustment inputs (e.g. -18 → { years: -1, months: -6 }).
 */
export function splitMonths(totalMonths: number): { years: number; months: number } {
  const sign = totalMonths < 0 ? -1 : 1
  const abs = Math.abs(Math.round(totalMonths))
  return { years: sign * Math.floor(abs / 12), months: sign * (abs % 12) }
}

/** Convert a signed month count to a decimal-years value (2 dp) for storage. */
export const monthsToYears = (months: number): number => Math.round((months / 12) * 100) / 100
