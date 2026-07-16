/**
 * PURE: the view editor's bulk item-selection maths — "select all / none" for
 * one section, and the TYPE FACETS that let a section with a classification
 * field toggle a whole type at once ("show every board seat, drop the rest").
 *
 * Why this isn't inline in ViewEditor: a view stores `excluded_item_ids`, one
 * FLAT list for the whole view rather than a list per section. So every bulk
 * operation is a set operation that must touch only the ids the section
 * actually shows, and leave every other section's exclusions alone. That is
 * more than a one-line computation, so it lives here (CLAUDE.md §3).
 *
 * Note the inversion: the view stores what is EXCLUDED, but the UI shows what
 * is INCLUDED. Every helper here takes and returns the excluded list, and the
 * names say which direction they move things.
 *
 * Two sections deliberately share their ids with another section — Projects
 * with Promoted Projects, the Skills Showcase with the Skill Matrix — because
 * both render the same underlying rows. Excluding an id in one therefore
 * excludes it in its twin. That is the existing per-item behaviour; bulk
 * selection inherits it rather than inventing a second, contradictory rule.
 */

import { POSITION_TYPES, positionTypeLabel } from './positionTypes'
import { PUBLICATION_TYPES, publicationTypeLabel } from './publicationTypes'

/** The shape bulk selection needs: an id, plus whatever facet field applies. */
export type SelectableItem = { id: string } & Record<string, unknown>

/** How much of a group is currently included in the view. */
export type GroupState = 'all' | 'none' | 'some'

/** Whether every / no / some of `ids` is included (i.e. NOT excluded). */
export function groupState(excluded: readonly string[], ids: readonly string[]): GroupState {
  if (!ids.length) return 'none'
  const ex = new Set(excluded)
  let included = 0
  for (const id of ids) if (!ex.has(id)) included++
  if (included === ids.length) return 'all'
  return included === 0 ? 'none' : 'some'
}

/** Include `ids` (drop them from the exclusion list). Other sections untouched. */
export function includeIds(excluded: readonly string[], ids: readonly string[]): string[] {
  const drop = new Set(ids)
  return excluded.filter((id) => !drop.has(id))
}

/** Exclude `ids`, without duplicating any the view already excludes. */
export function excludeIds(excluded: readonly string[], ids: readonly string[]): string[] {
  const ex = new Set(excluded)
  for (const id of ids) ex.add(id)
  return [...ex]
}

/**
 * Flip a group: fully included → exclude it all; otherwise → include it all.
 * A PARTIAL group includes the rest rather than clearing, so a click always has
 * a visible effect and repeated clicks alternate.
 */
export function toggleIds(excluded: readonly string[], ids: readonly string[]): string[] {
  return groupState(excluded, ids) === 'all' ? excludeIds(excluded, ids) : includeIds(excluded, ids)
}

// ─── Type facets ─────────────────────────────────────────────────────────────

/**
 * One facet per section that classifies its items with a type field. Adding a
 * section to this map is the whole job — the control reads it generically.
 *
 * Only sections with a real enumerated type qualify. Registry LINKS (a
 * project's roles, an employment's role_id) are deliberately not facets: they
 * are many-per-item, so "select all with role X" would have to define what
 * happens to an item carrying X *and* Y. That needs a product decision, not a
 * guess.
 */
interface TypeFacet {
  /** Item field holding the type value. */
  field: string
  /** Known values, in the order the section's editor offers them. */
  values: readonly string[]
  /** Editor-facing label for a value, in the editing locale. */
  label: (value: string, locale: string) => string
}

const TYPE_FACETS: Record<string, TypeFacet> = {
  positions: {
    field: 'position_type',
    values: POSITION_TYPES.map((t) => t.value),
    label: positionTypeLabel,
  },
  publications: {
    field: 'publication_type',
    values: PUBLICATION_TYPES.map((t) => t.value as string),
    label: publicationTypeLabel,
  },
}

export interface TypeGroup {
  /** The type value, or '' for the untyped group. */
  value: string
  label: string
  ids: string[]
}

/** True when this section classifies its items by a type field. */
export function hasTypeFacet(sectionKey: string): boolean {
  return sectionKey in TYPE_FACETS
}

/**
 * Group a section's items by their type, in the section's own type order, with
 * an untyped group last. Groups with no items are omitted — a facet only offers
 * what the resume actually contains.
 *
 * `position_type` is optional and imported data can carry a value we don't know
 * (an unrecognised type has no label to show), so BOTH cases fall into the
 * untyped group rather than rendering a nameless chip.
 */
export function typeGroups(
  sectionKey: string,
  items: readonly SelectableItem[],
  locale: string,
): TypeGroup[] {
  const facet = TYPE_FACETS[sectionKey]
  if (!facet) return []

  const known = new Set(facet.values)
  const byValue = new Map<string, string[]>()
  const untyped: string[] = []
  for (const item of items) {
    const raw = item[facet.field]
    const value = typeof raw === 'string' ? raw : ''
    if (!known.has(value)) { untyped.push(item.id); continue }
    const bucket = byValue.get(value)
    if (bucket) bucket.push(item.id)
    else byValue.set(value, [item.id])
  }

  const groups: TypeGroup[] = []
  for (const value of facet.values) {
    const ids = byValue.get(value)
    if (ids?.length) groups.push({ value, label: facet.label(value, locale), ids })
  }
  if (untyped.length) groups.push({ value: '', label: 'No type', ids: untyped })
  return groups
}
