/**
 * Item layout — where the parts of an item sit, shared by every render adapter.
 *
 * Two view controls live here. `summary_layout` orders the slots of a one-line
 * summary (title / org / dates); `date_position` orders a full item's details
 * line and says whether it sits above or below the title. This module owns that
 * ordering and nothing else — the adapters keep their own idea of what a bold
 * run or a column is.
 *
 * It lives here rather than in the HTML adapter because it used to live there,
 * and the consequence was a view control that moved the preview and left the
 * PDF, the Word file and the ATS text stating the same facts in a different
 * order. A CV's dates are the first thing a reader looks for; "where the date
 * sits" is not a preview-only concern.
 *
 * Pure module — no React, no DOM, no markup.
 */

import type { FullLayout, SummaryLayout } from '../types'
import type { SummaryPartKey, SummaryView } from './sectionCatalog'

/** The three ordered groups a summary line is built from. */
export type Slot = 'title' | 'org' | 'date'

const LAYOUT_SLOTS: Record<SummaryLayout, Slot[]> = {
  'title-org-date': ['title', 'org', 'date'],
  'title-date-org': ['title', 'date', 'org'],
  'org-title-date': ['org', 'title', 'date'],
  'org-date-title': ['org', 'date', 'title'],
  'date-title-org': ['date', 'title', 'org'],
  'date-org-title': ['date', 'org', 'title'],
}

/** Which slot each part belongs to. */
export const SLOT_OF: Record<SummaryPartKey, Slot> = {
  title: 'title', role: 'org', org: 'org', start: 'date', end: 'date', date: 'date',
}

/** Per-slot column order for tabulation (each key becomes its own column). */
export const SLOT_KEYS: Record<Slot, SummaryPartKey[]> = {
  title: ['title'], org: ['role', 'org'], date: ['start', 'end', 'date'],
}

/** The slot order a layout asks for, tolerating an out-of-enum stored value. */
export function slotsFor(layout: SummaryLayout): Slot[] {
  return LAYOUT_SLOTS[layout] ?? LAYOUT_SLOTS['title-org-date']
}

/**
 * One rendered piece of a summary line: the text of a slot, and the separator
 * that precedes it. `joiner` is empty on the first segment.
 */
export interface SummarySegment { slot: Slot; text: string; joiner: string }

/**
 * Order a summary's parts into the segments a line is composed of.
 *
 * The joiners are keyed off what actually RENDERED first, not the configured
 * slot order: a section with no dates (Languages) still leads with its title
 * under a date-first layout, and should read "Norwegian — Native" rather than
 * "· Native".
 */
export function summarySegments(v: SummaryView, layout: SummaryLayout): SummarySegment[] {
  const groups = slotsFor(layout)
    .map((slot) => ({
      slot,
      // Within a slot, distinct parts are joined with a middot — EXCEPT the
      // date slot, whose from/to dates read as a range and use a short dash.
      text: v.parts.filter((p) => SLOT_OF[p.key] === slot).map((p) => p.value)
        .filter(Boolean).join(slot === 'date' ? ' – ' : ' · '),
    }))
    .filter((g) => g.text)
  const titleFirst = groups[0]?.slot === 'title'
  return groups.map((g, i) => ({
    ...g,
    // Keep the classic "Title — meta" / "Category: skills" look when the title
    // leads; otherwise a neutral middot between reordered slots.
    joiner: i === 0 ? '' : i === 1 && titleFirst ? (v.sep === ':' ? ': ' : ' — ') : ' · ',
  }))
}

/** The tabulation columns for a set of summaries: every part key present, in slot order. */
export function summaryColumns(summaries: SummaryView[], layout: SummaryLayout): SummaryPartKey[] {
  const present = new Set<SummaryPartKey>()
  for (const s of summaries) for (const p of s.parts) if (p.value) present.add(p.key)
  const cols: SummaryPartKey[] = []
  for (const slot of slotsFor(layout)) for (const k of SLOT_KEYS[slot]) if (present.has(k)) cols.push(k)
  return cols
}

/**
 * Insert a dedicated separator column between adjacent start & end date
 * columns, so the range markers line up down the grid.
 */
export function tabulatedColumns(partCols: SummaryPartKey[]): Array<SummaryPartKey | 'sep'> {
  const cols: Array<SummaryPartKey | 'sep'> = []
  for (let i = 0; i < partCols.length; i++) {
    cols.push(partCols[i])
    if (partCols[i] === 'start' && partCols[i + 1] === 'end') cols.push('sep')
  }
  return cols
}


// ─── Full items ──────────────────────────────────────────────────

/** How a full item's title and details line are arranged. */
export interface FullItemLayout {
  /** The details line's parts, dates included, in reading order. */
  metaParts: string[]
  /** Whether the details line is drawn ABOVE the title (the `lead-*` layouts). */
  metaFirst: boolean
}

/**
 * Place a full item's date among its meta parts, and say which of the title and
 * the details line comes first.
 *
 * The catalog keeps `date` separate from `meta` precisely so this choice can be
 * made per view. It used to be made only by the HTML adapter, which left the
 * PDF and the Word file hanging the date off the end of the title line whatever
 * the view asked for — so two of the four layout options rendered identically
 * there, and a third moved nothing at all.
 */
export function fullItemLayout(
  v: { meta: readonly string[]; date: string }, layout: FullLayout,
): FullItemLayout {
  const dateFirst = layout === 'title-date-org' || layout === 'lead-date-org'
  const parts = v.meta.filter(Boolean)
  return {
    metaParts: (dateFirst ? [v.date, ...parts] : [...parts, v.date]).filter(Boolean),
    metaFirst: layout === 'lead-org-date' || layout === 'lead-date-org',
  }
}
