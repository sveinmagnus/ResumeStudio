/**
 * PURE: the Skill Matrix view section (roadmap F9) — the competency-matrix
 * format Nordic tenders ask for: skill × years × proficiency × last-used.
 *
 * A synthetic, view-only section like Promoted Projects: it derives rows from
 * the skill registry + project usage instead of owning a store array. Both
 * render paths (and the text adapter) consume `skillMatrixRows`; the renderers
 * own all escaping.
 *
 * Detail semantics for the section: 'full' = every (non-excluded) skill,
 * 'summary' = highlighted skills only.
 */

import type { ResumeStore, ResumeView, YearMonth } from '../types'
import { resolve, fmtDate } from './locales'

export interface SkillMatrixRow {
  /** Skill registry id (excludable via the view's item list). */
  id: string
  name: string
  /** skill_type from the registry ('technical', …) — '' when unset. */
  type: string
  /** Experience in years, one decimal. 0 = unknown. */
  years: number
  /** 0–5; 0 = unknown (CVpartner imports often carry no proficiency). */
  proficiency: number
  /** Most recent usage across referencing projects; null = no dated usage. */
  lastUsed: YearMonth | null
  /** True when a referencing project is still running. */
  ongoing: boolean
  highlighted: boolean
}

const monthsOf = (ym: YearMonth): number => ym.year * 12 + (ym.month ?? 1)

/** Total length in years of the union of [start..end] project intervals. */
function unionYears(ranges: Array<{ start: YearMonth; end: YearMonth }>): number {
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
  return Math.round((total / 12) * 10) / 10
}

export interface SkillMatrixOptions {
  /** 'summary' detail: highlighted skills only. */
  highlightedOnly?: boolean
}

/** Build the matrix rows for a view: registry + project usage, view exclusions applied. */
export function skillMatrixRows(
  store: ResumeStore,
  view: ResumeView,
  locale: string,
  opts: SkillMatrixOptions = {},
): SkillMatrixRow[] {
  const excluded = new Set(view.excluded_item_ids)
  const nowYm: YearMonth = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }

  // Per-skill usage from enabled projects: declared durations + date ranges.
  const usage = new Map<string, {
    declaredYears: number
    ranges: Array<{ start: YearMonth; end: YearMonth }>
    lastUsed: YearMonth | null
    ongoing: boolean
  }>()
  for (const p of store.projects) {
    if (p.disabled) continue
    for (const ps of p.skills) {
      if (!ps.skill_id) continue
      let u = usage.get(ps.skill_id)
      if (!u) { u = { declaredYears: 0, ranges: [], lastUsed: null, ongoing: false }; usage.set(ps.skill_id, u) }
      u.declaredYears += ps.duration_in_years || 0
      if (p.start) {
        const end = p.end ?? nowYm
        u.ranges.push({ start: p.start, end })
        if (!p.end) u.ongoing = true
        if (!u.lastUsed || monthsOf(end) > monthsOf(u.lastUsed)) u.lastUsed = p.end ? p.end : nowYm
      }
    }
  }

  return store.skills
    .filter((s) => !excluded.has(s.id))
    .filter((s) => !opts.highlightedOnly || s.is_highlighted)
    .map((s): SkillMatrixRow => {
      const u = usage.get(s.id)
      const years = s.total_duration_in_years > 0
        ? s.total_duration_in_years
        : u
          ? (u.declaredYears > 0 ? Math.round(u.declaredYears * 10) / 10 : unionYears(u.ranges))
          : 0
      return {
        id: s.id,
        name: resolve(s.name, locale),
        type: s.skill_type ?? '',
        years,
        proficiency: Math.max(0, Math.min(5, Math.round(s.proficiency || 0))),
        lastUsed: u?.ongoing ? null : u?.lastUsed ?? null,
        ongoing: u?.ongoing ?? false,
        highlighted: s.is_highlighted,
      }
    })
    .filter((r) => r.name !== '')
    .sort((a, b) =>
      Number(b.highlighted) - Number(a.highlighted)
      || b.years - a.years
      || a.name.localeCompare(b.name))
}

/** Display string for the last-used column: 'Ongoing', a formatted date, or ''. */
export function fmtLastUsed(row: SkillMatrixRow): string {
  if (row.ongoing) return 'Ongoing'
  return row.lastUsed ? fmtDate(row.lastUsed) : ''
}

/** Display string for proficiency: '4/5' or '' when unknown. */
export function fmtProficiency(p: number): string {
  return p > 0 ? `${p}/5` : ''
}
