/**
 * PURE: render the CV (or one section of it) as compact text for a prompt.
 *
 * Every advanced assist starts by showing the model the CV, and they must all
 * show it the SAME way — one item-id convention, one date format, one rule
 * about what gets included. When each advisor built its own bundle, a finding
 * that pointed at an item id from one prompt could not be resolved by another's
 * validator, and the model saw a different document depending on which button
 * was pressed.
 *
 * Design rules:
 *  - **Ids are verbatim and required.** Findings and proposals point back at
 *    items by id; a shortened or re-numbered id can't be resolved, and a model
 *    asked to invent a reference will.
 *  - **One locale.** These passes reason about the text a reader will see, and
 *    interleaving languages makes "is this inconsistent?" unanswerable. The
 *    cross-language pass (semantic drift) is the deliberate exception and asks
 *    for both columns explicitly.
 *  - **Rich text is flattened** (`richToPlain`), so the model never sees markup
 *    it would echo back into a field that then has to be re-sanitised.
 *  - **Disabled items are excluded**, exactly as they are from every export —
 *    advice about content that never ships is noise.
 */

import type { ResumeStore, LocalizedString, YearMonth } from '../types'
import { resolve } from './locales'
import { richToPlain } from './richText'
import { CV_SECTIONS, fieldsOf, itemsOf } from './cvFields'
import { sectionLabel } from './sections'

/** Cap per field, so one enormous description can't crowd out the whole CV. */
const DEFAULT_FIELD_CHARS = 1200

export interface DigestOptions {
  /** Which locale's text to show. */
  locale: string
  /** Restrict to these sections (default: every advisor section with items). */
  sections?: readonly string[]
  /** Per-field character cap. */
  maxFieldChars?: number
  /** Include the short_description fields (off for passes that ignore them). */
  includeShort?: boolean
}

/** "2021-03", "2021", or '' — month precision is optional in the model. */
function fmtDate(d: YearMonth | null | undefined): string {
  if (!d || typeof d.year !== 'number') return ''
  return d.month ? `${d.year}-${String(d.month).padStart(2, '0')}` : String(d.year)
}

/** "2019-06 → 2021-03" / "2019 → present" / '' when undated. */
function fmtRange(item: Record<string, unknown>): string {
  const start = fmtDate(item.start as YearMonth | null)
  // `end: null` means ongoing everywhere in the model.
  const hasEnd = 'end' in item
  const end = fmtDate(item.end as YearMonth | null)
  if (!start && !end) return ''
  if (!hasEnd || (item.end === null && start)) return `${start || '?'} → present`
  return `${start || '?'} → ${end || '?'}`
}

/** Flatten + trim one localized value for the prompt. */
function textOf(ls: unknown, locale: string, cap: number): string {
  if (!ls || typeof ls !== 'object') return ''
  const text = richToPlain(resolve(ls as LocalizedString, locale) ?? '').replace(/\s+/g, ' ').trim()
  return text.length > cap ? `${text.slice(0, cap)}…` : text
}

/**
 * A one-line label for an item — what a finding's title will refer to. Built
 * from the section's non-prose identity fields, so it reads like the editor's
 * card header rather than the first words of a description.
 */
export function itemLabel(section: string, item: Record<string, unknown>, locale: string): string {
  const parts = fieldsOf(section)
    .filter((f) => !f.prose)
    .map((f) => textOf(item[f.key], locale, 80))
    .filter(Boolean)
  return parts.join(' — ') || '(untitled)'
}

/**
 * The digest. Section headings carry the store key (what a reply must name),
 * items carry their real id, and each non-empty field is one `key: text` line.
 */
export function buildCvDigest(data: ResumeStore, opts: DigestOptions): string {
  const { locale, maxFieldChars = DEFAULT_FIELD_CHARS, includeShort = true } = opts
  const sections = opts.sections?.length ? opts.sections : CV_SECTIONS
  const out: string[] = []

  for (const section of sections) {
    const items = itemsOf(data, section)
    if (!items.length) continue
    out.push(`## ${section} (${sectionLabel(section)})`)

    for (const item of items) {
      const id = typeof item.id === 'string' ? item.id : ''
      if (!id) continue
      const range = fmtRange(item)
      out.push(`- id: ${id}`)
      out.push(`  title: ${itemLabel(section, item, locale)}${range ? `  [${range}]` : ''}`)
      if (item.starred === true) out.push('  starred: yes')

      for (const f of fieldsOf(section)) {
        if (!f.prose) continue
        if (!includeShort && f.key === 'short_description') continue
        if (f.list) {
          const list = Array.isArray(item[f.key]) ? (item[f.key] as LocalizedString[]) : []
          const lines = list.map((v) => textOf(v, locale, 300)).filter(Boolean)
          if (lines.length) out.push(`  ${f.key}:${lines.map((l) => `\n    - ${l}`).join('')}`)
          continue
        }
        const text = textOf(item[f.key], locale, maxFieldChars)
        if (text) out.push(`  ${f.key}: ${text}`)
      }
    }
    out.push('')
  }

  return out.join('\n').trim()
}

/**
 * A both-columns digest for the cross-language pass: each prose field rendered
 * in the primary AND secondary locale so the model can compare meaning. Fields
 * empty in both columns are skipped (nothing to compare); a field filled in one
 * and empty in the other is KEPT, because that gap is exactly the finding.
 */
export function buildBilingualDigest(
  data: ResumeStore,
  primary: string,
  secondary: string,
  opts: { sections?: readonly string[]; maxFieldChars?: number } = {},
): string {
  const { maxFieldChars = DEFAULT_FIELD_CHARS } = opts
  const sections = opts.sections?.length ? opts.sections : CV_SECTIONS
  const out: string[] = []

  for (const section of sections) {
    const items = itemsOf(data, section)
    if (!items.length) continue
    const rendered: string[] = []

    for (const item of items) {
      const id = typeof item.id === 'string' ? item.id : ''
      if (!id) continue
      const lines: string[] = []
      for (const f of fieldsOf(section)) {
        if (!f.prose || f.list) continue
        const ls = item[f.key]
        // Read the raw locale slots, NOT resolve(): the fallback chain would
        // paper over the very gap this pass exists to find, showing the English
        // text in the Norwegian column and reporting perfect agreement.
        const a = raw(ls, primary, maxFieldChars)
        const b = raw(ls, secondary, maxFieldChars)
        if (!a && !b) continue
        lines.push(`  ${f.key}:`)
        lines.push(`    ${primary}: ${a || '(empty)'}`)
        lines.push(`    ${secondary}: ${b || '(empty)'}`)
      }
      if (!lines.length) continue
      rendered.push(`- id: ${id}`)
      rendered.push(`  title: ${itemLabel(section, item, primary)}`)
      rendered.push(...lines)
    }

    if (rendered.length) {
      out.push(`## ${section} (${sectionLabel(section)})`)
      out.push(...rendered)
      out.push('')
    }
  }

  return out.join('\n').trim()
}

/** One locale slot, flattened — no fallback chain. See buildBilingualDigest. */
function raw(ls: unknown, locale: string, cap: number): string {
  if (!ls || typeof ls !== 'object') return ''
  const text = richToPlain((ls as LocalizedString)[locale] ?? '').replace(/\s+/g, ' ').trim()
  return text.length > cap ? `${text.slice(0, cap)}…` : text
}
