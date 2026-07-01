/**
 * PURE: career-timeline model (roadmap F15).
 *
 * Turns the store's employments, education and projects into a positioned
 * timeline: bars on three tracks (employment / education / project),
 * overlap-packed into lanes, plus detected work-history GAPS and the year
 * ticks for an axis. The Overview's CareerTimeline card renders this as SVG —
 * all geometry decisions that need testing live here, not in the component.
 *
 * Gaps are computed from employment AND education combined, so a period spent
 * studying does NOT read as a gap in the career — only spans with neither work
 * nor education count.
 *
 * Months are absolute integers (`year * 12 + month`) so arithmetic is trivial
 * and locale-free; the card maps the [minMonths, maxMonths] span to pixels.
 */

import type { ResumeStore, YearMonth, LocalizedString } from '../types'
import { resolve } from './locales'

export type TimelineKind = 'employment' | 'education' | 'project'

export interface TimelineBar {
  id: string
  label: string
  sublabel: string
  /** Absolute start month (year*12 + month); month defaults to 1 when unknown. */
  startMonths: number
  /** Absolute end month, inclusive. For ongoing items this is `nowMonths`. */
  endMonths: number
  ongoing: boolean
  kind: TimelineKind
  /** Vertical lane within the track (0-based) so overlapping bars don't collide. */
  lane: number
}

export interface TimelineGap {
  startMonths: number
  endMonths: number
  /** Number of uncovered months. */
  months: number
}

export interface TimelineTrack {
  bars: TimelineBar[]
  /** How many lanes this track needs (max lane + 1, or 0 when empty). */
  lanes: number
}

export interface CareerTimelineModel {
  employment: TimelineTrack
  education: TimelineTrack
  projects: TimelineTrack
  /** Uncovered spans in the work history (neither employment nor education), ≥ the gap threshold. */
  gaps: TimelineGap[]
  /** Axis bounds (rounded out to whole years). */
  minMonths: number
  maxMonths: number
  /** Integer year ticks spanning the axis. */
  years: number[]
  /** False when there's nothing dated to draw. */
  hasData: boolean
}

const monthsOf = (ym: YearMonth): number => ym.year * 12 + (ym.month ?? 1)

interface RawItem {
  id: string
  label: string
  sublabel: string
  start: YearMonth
  end: YearMonth | null
  kind: TimelineKind
}

/**
 * Greedy lane packing: sort by start, drop each bar into the first lane whose
 * last bar ended before this one starts, else open a new lane. Mutates `lane`
 * on the bars and returns the lane count.
 */
function packLanes(bars: TimelineBar[]): number {
  const laneEnds: number[] = [] // last endMonths per lane
  // Stable: assume the caller passes bars already sorted by start.
  for (const bar of bars) {
    let placed = false
    for (let i = 0; i < laneEnds.length; i++) {
      if (bar.startMonths >= laneEnds[i]) {
        bar.lane = i
        laneEnds[i] = bar.endMonths
        placed = true
        break
      }
    }
    if (!placed) {
      bar.lane = laneEnds.length
      laneEnds.push(bar.endMonths)
    }
  }
  return laneEnds.length
}

/** Compute employment gaps from a set of inclusive [start, end] month intervals. */
function computeGaps(intervals: Array<{ start: number; end: number }>, minGapMonths: number): TimelineGap[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const gaps: TimelineGap[] = []
  let coveredEnd = sorted[0].end
  for (const iv of sorted.slice(1)) {
    if (iv.start > coveredEnd + 1) {
      // Uncovered months strictly between coveredEnd and iv.start.
      const months = iv.start - coveredEnd - 1
      if (months >= minGapMonths) {
        gaps.push({ startMonths: coveredEnd + 1, endMonths: iv.start - 1, months })
      }
    }
    coveredEnd = Math.max(coveredEnd, iv.end)
  }
  return gaps
}

export interface TimelineOptions {
  /** "Today" for ongoing bars + the axis end. Injectable for deterministic tests. */
  now?: Date
  /** Minimum uncovered months to report as a gap (default 2). */
  minGapMonths?: number
  /** Include the projects track (default true). */
  includeProjects?: boolean
  /**
   * Include education — both as its own track AND as gap coverage (default
   * true). When false, education is ignored entirely, so study periods reopen
   * as gaps (used by tests to assert the gap-filling behaviour).
   */
  includeEducation?: boolean
}

export function buildCareerTimeline(
  store: ResumeStore,
  locale: string,
  opts: TimelineOptions = {},
): CareerTimelineModel {
  const now = opts.now ?? new Date()
  const nowMonths = now.getFullYear() * 12 + (now.getMonth() + 1)
  const minGapMonths = opts.minGapMonths ?? 2
  const includeProjects = opts.includeProjects ?? true
  const includeEducation = opts.includeEducation ?? true

  const ls = (v: LocalizedString | undefined): string => resolve(v, locale)

  const raw: RawItem[] = []
  for (const w of store.work_experiences) {
    if (w.disabled || !w.start) continue
    raw.push({
      id: w.id,
      label: ls(w.employer) || 'Employer',
      sublabel: ls(w.role_title),
      start: w.start, end: w.end, kind: 'employment',
    })
  }
  if (includeEducation) {
    for (const e of store.educations) {
      if (e.disabled || !e.start) continue
      raw.push({
        id: e.id,
        label: ls(e.school) || 'Education',
        sublabel: ls(e.degree),
        start: e.start, end: e.end, kind: 'education',
      })
    }
  }
  if (includeProjects) {
    for (const p of store.projects) {
      if (p.disabled || !p.start) continue
      raw.push({
        id: p.id,
        label: ls(p.customer) || ls(p.description) || 'Project',
        sublabel: p.industries.map((pi) => ls(pi.name)).filter(Boolean).join(', '),
        start: p.start, end: p.end, kind: 'project',
      })
    }
  }

  const toBar = (it: RawItem): TimelineBar => {
    const startMonths = monthsOf(it.start)
    const ongoing = it.end === null
    const endMonths = ongoing ? Math.max(startMonths, nowMonths) : monthsOf(it.end!)
    return {
      id: it.id, label: it.label, sublabel: it.sublabel,
      startMonths, endMonths: Math.max(startMonths, endMonths),
      ongoing, kind: it.kind, lane: 0,
    }
  }

  const byStart = (a: TimelineBar, b: TimelineBar) =>
    a.startMonths - b.startMonths || a.endMonths - b.endMonths

  const employmentBars = raw.filter((r) => r.kind === 'employment').map(toBar).sort(byStart)
  const educationBars = raw.filter((r) => r.kind === 'education').map(toBar).sort(byStart)
  const projectBars = raw.filter((r) => r.kind === 'project').map(toBar).sort(byStart)

  const employmentLanes = packLanes(employmentBars)
  const educationLanes = packLanes(educationBars)
  const projectLanes = packLanes(projectBars)

  const allBars = [...employmentBars, ...educationBars, ...projectBars]
  const hasData = allBars.length > 0

  // Axis bounds rounded out to whole years.
  let minMonths = 0
  let maxMonths = 0
  if (hasData) {
    const starts = allBars.map((b) => b.startMonths)
    const ends = allBars.map((b) => b.endMonths)
    const lo = Math.min(...starts)
    const hi = Math.max(...ends, nowMonths)
    minMonths = Math.floor(lo / 12) * 12 // Jan of the earliest year
    maxMonths = (Math.floor(hi / 12) + 1) * 12 // Jan of the year after the latest
  }

  const years: number[] = []
  for (let m = minMonths; m < maxMonths; m += 12) years.push(m / 12)

  // Gaps reflect uncovered work history: a span counts only when NEITHER
  // employment NOR education covers it (education fills what used to read as a
  // gap). Projects deliberately don't count toward coverage.
  const gaps = computeGaps(
    [...employmentBars, ...educationBars].map((b) => ({ start: b.startMonths, end: b.endMonths })),
    minGapMonths,
  )

  return {
    employment: { bars: employmentBars, lanes: employmentLanes },
    education: { bars: educationBars, lanes: educationLanes },
    projects: { bars: projectBars, lanes: projectLanes },
    gaps,
    minMonths, maxMonths, years,
    hasData,
  }
}

/**
 * Format an absolute-month value as "MMM YYYY" for labels/tooltips. Months are
 * encoded as `year*12 + month` with month ∈ 1..12, so December (month 12) must
 * decode back to the same year — hence the `(months - 1)` before the divide.
 */
export function monthsToLabel(months: number): string {
  const year = Math.floor((months - 1) / 12)
  const month = months - year * 12 // 1..12
  const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[month] ?? ''} ${year}`.trim()
}
