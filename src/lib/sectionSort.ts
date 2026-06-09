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

import type { YearMonth } from '../types'
import { getItemTitle } from './viewFilter'

export type SortMode = 'custom' | 'alpha' | 'start' | 'end' | 'date'

export const SORT_LABELS: Record<SortMode, string> = {
  custom: 'Custom order',
  alpha:  'Alphabetical (A–Z)',
  start:  'Start date (newest)',
  end:    'End date (newest)',
  date:   'Date (newest)',
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
  courses:          { single: 'completed' },
  certifications:   { single: 'issued' },
  presentations:    { single: 'date' },
  publications:     { single: 'date' },
  honor_awards:     { single: 'date' },
}

/** Which sort modes a section offers, in display order. */
export function availableSortModes(section: string): SortMode[] {
  const modes: SortMode[] = ['custom', 'alpha']
  const cap = DATE_CAPS[section]
  if (cap?.start)  modes.push('start')
  if (cap?.end)    modes.push('end')
  if (cap?.single) modes.push('date')
  return modes
}

type Sortable = { id: string; sort_order: number } & Record<string, unknown>

function ymKey(ym: unknown): number | null {
  const v = ym as YearMonth | null | undefined
  if (!v || typeof v.year !== 'number') return null
  return v.year * 12 + (v.month ?? 0)
}

/**
 * Descending comparison by date key.
 * `nullIsRecent` decides where a missing date lands:
 *   - end dates: null = ongoing ⇒ most recent (sorts first)
 *   - start / single dates: null = unknown ⇒ oldest (sorts last)
 */
function byDateDesc(a: number | null, b: number | null, nullIsRecent: boolean): number {
  const av = a ?? (nullIsRecent ? Infinity : -Infinity)
  const bv = b ?? (nullIsRecent ? Infinity : -Infinity)
  if (av === bv) return 0
  return bv > av ? 1 : -1
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
        getItemTitle(section, a, locale).localeCompare(
          getItemTitle(section, b, locale), undefined, { sensitivity: 'base' },
        ),
      )
    case 'start':
      return arr.sort((a, b) => byDateDesc(ymKey(a.start), ymKey(b.start), false))
    case 'end':
      // Ongoing items (null end) all rank as "most recent" by end date, so
      // they tie with each other. Without a secondary key the input order
      // wins — which means a freshly added ongoing role can hide below an
      // older one. Tie-break ongoing items by start date descending instead,
      // so the most recently started ongoing entry shows first. Items with
      // a real end date are still compared purely by that end date.
      return arr.sort((a, b) => {
        const ae = ymKey(a.end), be = ymKey(b.end)
        const primary = byDateDesc(ae, be, true)
        if (primary !== 0) return primary
        if (ae === null && be === null) {
          return byDateDesc(ymKey(a.start), ymKey(b.start), false)
        }
        return 0
      })
    case 'date': {
      const field = DATE_CAPS[section]?.single ?? 'date'
      return arr.sort((a, b) => byDateDesc(ymKey(a[field]), ymKey(b[field]), false))
    }
    case 'custom':
    default:
      return arr.sort((a, b) => a.sort_order - b.sort_order)
  }
}
