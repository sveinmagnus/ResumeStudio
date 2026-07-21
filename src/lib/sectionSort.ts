/**
 * Section sort modes — how the editor orders the items in a section.
 *
 * The persisted ordering is always `sort_order` ("Custom"); the other modes
 * are computed views layered on top. A manual reorder while a computed mode
 * is active bakes that view back into `sort_order` and returns the section to
 * Custom (handled in the store) — so the user's hand-tuned order is the only
 * thing that ever persists.
 *
 * Pure module — no React, no DOM. Consumed by the store (mode-aware
 * moveItem/reorderItem) and the editor hooks/components.
 */

import type { YearMonth, SortMode } from '../types'
import { SECTION_CATALOG, type AnyItem } from './sectionCatalog'

// Re-exported so existing importers (`import { SortMode } from './sectionSort'`)
// keep working; the canonical definition now lives in `types` so `ViewSection`
// can reference it without a runtime import.
export type { SortMode }

/** An item's display title for the alphabetical sort — via the section catalog
 *  directly (not viewFilter) so this module has no import cycle with it. */
function titleOf(section: string, item: unknown, locale: string): string {
  const it = item as AnyItem
  const desc = SECTION_CATALOG[section]
  return desc ? desc.title(it, locale) : String(it.id ?? 'Item')
}

export const SORT_LABELS: Record<SortMode, string> = {
  custom:    'Custom order',
  alpha:     'Alphabetical (A–Z)',
  start:     'Start date (newest)',
  start_asc: 'Start date (oldest)',
  end:       'End date (newest)',
  end_asc:   'End date (oldest)',
  date:      'Date (newest)',
  date_asc:  'Date (oldest)',
}

/**
 * Per-section date capabilities. Sections with a `start`/`end` range get the
 * Start/End modes; single-date sections get one `date` mode mapped to the
 * relevant field. Sections absent here only support Custom + Alphabetical.
 */
const DATE_CAPS: Record<string, { start?: boolean; end?: boolean; single?: string }> = {
  projects:         { start: true, end: true },
  work_experiences: { start: true, end: true },
  educations:       { start: true, end: true },
  positions:        { start: true, end: true },
  courses:          { start: true, end: true },
  certifications:   { single: 'issued' },
  presentations:    { single: 'date' },
  publications:     { single: 'date' },
  honor_awards:     { single: 'date' },
  recommendations:  { single: 'date' },
}

/** Which sort modes a section offers, in display order. Each date mode is
 *  offered newest-first then oldest-first. */
export function availableSortModes(section: string): SortMode[] {
  const modes: SortMode[] = ['custom', 'alpha']
  const cap = DATE_CAPS[section]
  if (cap?.start)  modes.push('start', 'start_asc')
  if (cap?.end)    modes.push('end', 'end_asc')
  if (cap?.single) modes.push('date', 'date_asc')
  return modes
}

type Sortable = { id: string; sort_order: number } & Record<string, unknown>

function ymKey(ym: unknown): number | null {
  const v = ym as YearMonth | null | undefined
  if (!v || typeof v.year !== 'number') return null
  return v.year * 12 + (v.month ?? 0)
}

/**
 * Comparison by date key. A missing date (`null`) always sorts to the TOP
 * regardless of direction: for end dates that means "ongoing = most recent",
 * and for start / single dates it means "not dated yet" — a freshly added item
 * stays on top until the user sets its date, at which point it drops into its
 * chronological place. `dir` only orders the *dated* items: 'desc' = newest
 * first, 'asc' = oldest first.
 */
function byDate(a: number | null, b: number | null, dir: 'asc' | 'desc' = 'desc'): number {
  if (a === null && b === null) return 0
  if (a === null) return -1  // nulls float to top
  if (b === null) return 1
  if (a === b) return 0
  return dir === 'desc' ? (b - a > 0 ? 1 : -1) : (a - b > 0 ? 1 : -1)
}

/**
 * Return a new array of `items` ordered for the given mode. Does not mutate
 * the input. `locale` is used for the alphabetical title comparison.
 */
export function sortItems<T extends Sortable>(
  section: string,
  items: readonly T[],
  mode: SortMode,
  locale: string,
): T[] {
  const arr = [...items]
  switch (mode) {
    case 'alpha':
      return arr.sort((a, b) =>
        titleOf(section, a, locale).localeCompare(
          titleOf(section, b, locale), undefined, { sensitivity: 'base' },
        ),
      )
    case 'start':
    case 'start_asc': {
      const dir = mode === 'start_asc' ? 'asc' : 'desc'
      // Undated items float to the top (new items surface until dated).
      return arr.sort((a, b) => byDate(ymKey(a.start), ymKey(b.start), dir))
    }
    case 'end':
    case 'end_asc': {
      const dir = mode === 'end_asc' ? 'asc' : 'desc'
      // Ongoing items (null end) all rank as "most recent" by end date, so
      // they tie with each other. Without a secondary key the input order
      // wins — which means a freshly added ongoing role can hide below an
      // older one. Tie-break ongoing items by start date (same direction), so
      // the entry ordering is stable. Items with a real end date are still
      // compared purely by that end date.
      return arr.sort((a, b) => {
        const ae = ymKey(a.end), be = ymKey(b.end)
        const primary = byDate(ae, be, dir)
        if (primary !== 0) return primary
        if (ae === null && be === null) {
          return byDate(ymKey(a.start), ymKey(b.start), dir)
        }
        return 0
      })
    }
    case 'date':
    case 'date_asc': {
      const dir = mode === 'date_asc' ? 'asc' : 'desc'
      const field = DATE_CAPS[section]?.single ?? 'date'
      // Undated items float to the top (new items surface until dated).
      return arr.sort((a, b) => byDate(ymKey(a[field]), ymKey(b[field]), dir))
    }
    case 'custom':
    default:
      return arr.sort((a, b) => a.sort_order - b.sort_order)
  }
}
