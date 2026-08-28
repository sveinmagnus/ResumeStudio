/**
 * PURE: global content search (roadmap F16).
 *
 * A cross-section, client-side substring search over the whole resume store —
 * "find every item mentioning Kubernetes". Walks every content section plus
 * the registries and the resume header, collecting searchable text from each
 * item (all localized values + plain strings, recursively) and returning ranked
 * hits with a snippet and where to navigate.
 *
 * Generic by design: a recursive string collector means new fields are
 * searchable automatically, with a small key denylist for ids/timestamps that
 * are never meaningful to search.
 */

import type { ResumeStore } from '../types'
import { SECTIONS } from './sections'
import { getItemTitle } from './viewFilter'

export interface SearchHit {
  /** Section key for navigation (setActiveSection). */
  section: string
  /** Section label, for grouping/among results. */
  sectionLabel: string
  /** Item id (setExpandedItem); '' for the resume header pseudo-section. */
  id: string
  /** Item title (from the section catalog where available). */
  title: string
  /** The matched text, ellipsized around the first match. */
  snippet: string
}

/**
 * Keys whose string values are never worth searching, in two parts:
 *
 *  - `ID_KEY_RE` matches any cross-reference id by SHAPE — `id`, `role_id`,
 *    `skill_ids`, `competency_ids`, `canonical_id`, `view_id`, … — rather than
 *    by name. A query landing inside one of those opaque UUIDs would surface a
 *    hit naming no field the user has ever seen, on an item they have no reason
 *    to connect to what they typed. Matching the shape covers every reference
 *    field the model grows later; a per-name list silently stops being complete.
 *  - `DENY_KEYS` is the short remainder that doesn't fit that shape:
 *    timestamps, enums, embedded image data.
 *
 * LocalizedString locale keys ('en', 'no', …) match neither, so their values
 * ARE collected.
 */
const ID_KEY_RE = /^id$|_ids?$/
const DENY_KEYS = new Set([
  'created_at', 'updated_at', 'default_locale', 'shape_version',
  'profile_image_url', 'profile_photo', 'company_logo',
])

/** Recursively collect non-empty string values, skipping denied keys. */
function collectStrings(value: unknown, key: string, out: string[]): void {
  if (typeof value === 'string') {
    if (!ID_KEY_RE.test(key) && !DENY_KEYS.has(key)) {
      const t = value.trim()
      if (t) out.push(t)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, key, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, k, out)
  }
}

/**
 * Trim a matched string to ~`pad` chars on each side of the match, with ellipses.
 *
 * Every caller found `text` BY testing that it contains `lowerQuery`, so there is
 * no no-match case to fall back to; a miss would degrade to the opening of the
 * text, which is what an untrimmed snippet was anyway.
 */
function ellipsize(text: string, lowerQuery: string, pad = 40): string {
  const idx = Math.max(0, text.toLowerCase().indexOf(lowerQuery))
  const start = Math.max(0, idx - pad)
  const end = Math.min(text.length, idx + lowerQuery.length + pad)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

/** Sections we never search: the view configs are export settings, not content. */
const SKIP_SECTIONS = new Set(['views'])

/**
 * Search the store. Returns up to `limit` hits, ranked: title matches first,
 * then by section order, then by title. Queries shorter than 2 chars return [].
 */
export function searchStore(
  store: ResumeStore,
  query: string,
  locale: string,
  limit = 30,
): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []

  const scored: Array<{ hit: SearchHit; titleMatch: boolean; order: number }> = []

  // Resume header pseudo-section (name, title, contact, etc.).
  if (store.resume) {
    const strings: string[] = []
    collectStrings(store.resume, 'resume', strings)
    const match = strings.find((s) => s.toLowerCase().includes(q))
    if (match) {
      scored.push({
        hit: {
          section: 'header', sectionLabel: 'Personal Details', id: '',
          title: store.resume.full_name || 'Personal Details',
          snippet: ellipsize(match, q),
        },
        titleMatch: (store.resume.full_name || '').toLowerCase().includes(q),
        order: -1,
      })
    }
  }

  // Skill categories aren't a SectionKey (see lib/skillCategorize.ts), so the
  // SECTIONS walk below never reaches them — search them explicitly, routing
  // hits to the Skill Registry (where they're managed, in the By-category view).
  ;(store.skill_categories ?? []).forEach((cat) => {
    const strings: string[] = []
    collectStrings(cat, 'skill_categories', strings)
    const match = strings.find((s) => s.toLowerCase().includes(q))
    if (!match) return
    const title = getItemTitle('technology_categories', cat, locale) || 'Skill category'
    scored.push({
      hit: { section: 'skills', sectionLabel: 'Skill Registry', id: '', title, snippet: ellipsize(match, q) },
      titleMatch: title.toLowerCase().includes(q),
      order: -0.5,
    })
  })

  SECTIONS.forEach((sec, order) => {
    if (!sec.storeKey || SKIP_SECTIONS.has(sec.key) || sec.virtual) return
    const items = store[sec.storeKey] as unknown as Array<Record<string, unknown>>
    for (const item of items) {
      const strings: string[] = []
      collectStrings(item, sec.key, strings)
      const match = strings.find((s) => s.toLowerCase().includes(q))
      if (!match) continue
      const title = getItemTitle(sec.key, item, locale) || sec.label
      scored.push({
        hit: {
          section: sec.key, sectionLabel: sec.label, id: String(item.id ?? ''),
          title, snippet: ellipsize(match, q),
        },
        titleMatch: title.toLowerCase().includes(q),
        order,
      })
    }
  })

  scored.sort((a, b) =>
    Number(b.titleMatch) - Number(a.titleMatch)
    || a.order - b.order
    || a.hit.title.localeCompare(b.hit.title),
  )
  return scored.slice(0, limit).map((s) => s.hit)
}
