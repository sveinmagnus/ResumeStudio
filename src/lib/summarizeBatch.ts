/**
 * Resume Studio — "Bulk summarize" work list.
 *
 * The section-level sibling of `DualField`'s per-column Summarize button: it
 * finds every short-description field that is empty but COULD be filled, so the
 * section bar can offer to run the AI summarizer over the lot.
 *
 * The rule matches DualField's exactly, deliberately — a batch must fill the
 * same fields the per-field buttons would, or the count lies:
 *   - one job per (item, locale), never per item;
 *   - a job exists only where the SOURCE has real text in THAT locale (the
 *     summarizer writes in the language it reads — a Norwegian description
 *     yields a Norwegian summary), and the TARGET is empty there;
 *   - "real text" means text after stripping rich markup, so an empty `<p></p>`
 *     is not a source.
 *
 * Pure except for `richToPlain` (DOMParser) — jsdom-testable, like viewText.
 */

import type { ResumeStore, LocalizedString } from '../types'
import { richToPlain } from './richText'

/** Which long field feeds which short field, per section. */
export interface SummaryFieldPair {
  /** The long description the summary is drawn FROM. */
  source: string
  /** The single-line field the summary lands IN. */
  target: string
}

/**
 * The sections whose editor offers a Summarize button, and the field pair it
 * uses. Mirrors the `summarizeFrom` wiring in the editors — if you add the
 * button to a new section's DualField, add it here too or the batch will
 * quietly skip that section.
 *
 * Projects and Employment summarize from `long_description` (their
 * `description` is the short project/role name), everything else from its own
 * main description field.
 */
export const SUMMARY_FIELDS: Readonly<Record<string, SummaryFieldPair>> = {
  projects: { source: 'long_description', target: 'short_description' },
  work_experiences: { source: 'long_description', target: 'short_description' },
  positions: { source: 'description', target: 'short_description' },
  educations: { source: 'description', target: 'short_description' },
  courses: { source: 'description', target: 'short_description' },
  certifications: { source: 'description', target: 'short_description' },
  presentations: { source: 'description', target: 'short_description' },
  publications: { source: 'abstract', target: 'short_description' },
  honor_awards: { source: 'description', target: 'short_description' },
  key_competencies: { source: 'description', target: 'short_description' },
  recommendations: { source: 'text', target: 'short_description' },
}

/** The field pair for a section, or undefined when it has no summary field. */
export function summaryFields(section: string): SummaryFieldPair | undefined {
  return SUMMARY_FIELDS[section]
}

/**
 * The plain-text summarizable content of a rich value, or `''` when there's
 * nothing worth sending to a model.
 *
 * Shared by this batch and DualField's per-column button so both agree on what
 * "has a source" means — the batch count must match the buttons exactly.
 *
 * Emptiness needs more than a trim: `richToPlain` renders list items with a
 * bullet, so an empty `<ul><li></li></ul>` flattens to a lone "•" and would
 * otherwise read as text and cost a real LLM call. Require at least one letter
 * or digit.
 */
export function summarizableSource(rich: string | undefined): string {
  const text = richToPlain(rich ?? '').trim()
  return /[\p{L}\p{N}]/u.test(text) ? text : ''
}

/** One summarize job: fill `target[locale]` of item `id` from `source`. */
export interface SummaryTarget {
  id: string
  locale: string
  /** Plain-text source, already stripped of rich markup and trimmed. */
  source: string
}

/** A completed job, ready to apply. */
export interface SummaryResult {
  id: string
  locale: string
  text: string
}

function asLocalized(v: unknown): LocalizedString {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as LocalizedString) : {}
}

/**
 * Every (item, locale) pair in `section` whose summary is empty and whose
 * source has text to summarize — the work list, in item order then locale
 * order.
 *
 * `locales` is normally the columns the user can actually see (primary, plus
 * secondary when shown): filling a language that isn't on screen would be a
 * surprise, and the user can switch columns and re-run.
 *
 * Disabled items are skipped — they're excluded from every export, so
 * spending LLM calls on them is waste.
 */
export function emptySummaryTargets(
  store: ResumeStore,
  section: string,
  locales: string[],
): SummaryTarget[] {
  const fields = summaryFields(section)
  if (!fields) return []
  const items = (store[section as keyof ResumeStore] ?? []) as unknown as Record<string, unknown>[]
  if (!Array.isArray(items)) return []

  const wanted = [...new Set(locales.filter(Boolean))]
  const out: SummaryTarget[] = []
  for (const item of items) {
    if (item['disabled'] === true) continue
    const id = typeof item['id'] === 'string' ? item['id'] : ''
    if (!id) continue
    const source = asLocalized(item[fields.source])
    const target = asLocalized(item[fields.target])
    for (const locale of wanted) {
      if ((target[locale] ?? '').trim()) continue          // already filled
      const text = summarizableSource(source[locale])
      if (!text) continue                                   // nothing to read
      out.push({ id, locale, source: text })
    }
  }
  return out
}

/**
 * Apply completed summaries to `store`, returning a NEW store.
 *
 * Applied in one pass and fed to `replaceData` so a whole batch is a single
 * undo step — a run of twenty is one Ctrl+Z, not twenty (CLAUDE.md §7). Each
 * result merges into the item's existing localized value, so a summary written
 * for `no` never disturbs an `en` one already there.
 *
 * Results whose item has since vanished are ignored rather than resurrecting it.
 */
export function applySummaries(
  store: ResumeStore,
  section: string,
  results: SummaryResult[],
): ResumeStore {
  const fields = summaryFields(section)
  if (!fields || results.length === 0) return store

  const byId = new Map<string, SummaryResult[]>()
  for (const r of results) {
    if (!r.text.trim()) continue
    const list = byId.get(r.id)
    if (list) list.push(r)
    else byId.set(r.id, [r])
  }
  if (byId.size === 0) return store

  const items = (store[section as keyof ResumeStore] ?? []) as unknown as Record<string, unknown>[]
  if (!Array.isArray(items)) return store

  const next = items.map((item) => {
    const id = item['id']
    const hits = typeof id === 'string' ? byId.get(id) : undefined
    if (!hits) return item
    const merged: LocalizedString = { ...asLocalized(item[fields.target]) }
    for (const r of hits) merged[r.locale] = r.text.trim()
    return { ...item, [fields.target]: merged }
  })

  return { ...store, [section]: next } as ResumeStore
}
