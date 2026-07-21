/**
 * PURE: the view editor's bulk item-selection maths — "select all / none" for
 * one section, radio single-select for the profile section, and the FACETS that
 * let a section select whole groups of items at once ("show every project where
 * I was PM", "drop every board seat").
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

import type { Role, KeyQualification } from '../types'
import { resolve } from './locales'
import { POSITION_TYPES, positionTypeLabel } from './positionTypes'
import { PUBLICATION_TYPES, publicationTypeLabel } from './publicationTypes'
import { EMPLOYMENT_TYPES, employmentTypeLabel } from './employmentTypes'
import { COURSE_CATEGORIES, courseCategoryLabel } from './courseCategories'

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

/**
 * Single-select: include exactly `keepId` out of `ids`, excluding the rest.
 * Drives the profile section's radio list — only one profile block shows at a
 * time. Ids outside this section (already in `excluded`) are left alone; ids in
 * this section that were previously excluded are re-included iff they are the
 * kept one.
 */
export function selectOnly(excluded: readonly string[], ids: readonly string[], keepId: string): string[] {
  const others = ids.filter((id) => id !== keepId)
  return excludeIds(includeIds(excluded, [keepId]), others)
}

/** Sections whose item list is a radio (one item shows at a time), not checkboxes. */
export function isSingleSelectSection(sectionKey: string): boolean {
  return sectionKey === 'key_qualifications'
}

// ─── Facets ──────────────────────────────────────────────────────────────────

/**
 * Context a facet may need beyond the items themselves — the role registry (so
 * a role facet can name a role id) and the profiles (so a competency's
 * profile_id facet can name its profile by tag line).
 */
export interface FacetCtx {
  roles: readonly Role[]
  keyQualifications?: readonly KeyQualification[]
}

/**
 * One facet a section offers: a way to select its items by a shared property.
 * A facet is EITHER an enum (a fixed field like `position_type`) OR a registry
 * link (roles a project/employment carries). Both reduce to the same thing —
 * "which values does this item have, and what is each value called" — so one
 * shape covers both.
 *
 * `extract` returns 0..n values per item: single-valued enums return `[value]`
 * (or `[]` when unset), multi-valued role links return every linked id. An item
 * therefore belongs to every group its values name, which is exactly why
 * toggling one role can affect an item that also carries another — the confirmed
 * "toggle affects all items with that role" behaviour, and the set-math above
 * already handles it (an id simply appears in more than one group).
 */
interface FacetSpec {
  /** Facet id — also the dropdown group heading (e.g. 'Employment type', 'Role'). */
  name: string
  /** Values on one item: [] none, [v] single-valued, [a,b,…] multi-valued. */
  extract: (item: SelectableItem) => string[]
  /**
   * Values in display order + a label. Enum facets return a fixed list; the
   * role facet returns whatever roles the resume's items actually reference,
   * ordered by the registry. Values NOT in this list fall into "No type".
   */
  ordered: (ctx: FacetCtx) => Array<{ value: string; label: string }>
}

/** Read a string field off an item, or '' when absent/blank. */
const strField = (field: string) => (item: SelectableItem): string[] => {
  const raw = item[field]
  return typeof raw === 'string' && raw ? [raw] : []
}

/** Enum facet: a fixed field with a static ordered value/label list. */
function enumFacet(
  name: string, field: string,
  values: readonly string[], label: (v: string) => string,
): FacetSpec {
  return {
    name,
    extract: strField(field),
    ordered: () => values.map((value) => ({ value, label: label(value) })),
  }
}

/**
 * Role facet: an item's registry role links. `getIds` differs by section
 * (projects carry `roles[].role_id`, employments carry `role_ids[]`), so it's a
 * parameter. Values are ordered by the registry's own order and labelled from
 * it — a role no longer in the registry (stale link) has no label and lands in
 * "No type".
 */
function roleFacet(getIds: (item: SelectableItem) => string[], locale: string): FacetSpec {
  return {
    name: 'Role',
    extract: getIds,
    ordered: (ctx) => ctx.roles.map((r) => ({ value: r.id, label: resolve(r.name, locale) })),
  }
}

/**
 * Profile facet for Key Competencies: a competency's `profile_id` links it to a
 * Profile (key_qualification), used as a "type" so a view can quick-select the
 * competencies relevant to the profile it shows. Values are ordered by the
 * resume's profiles and labelled by their tag line; a stale link falls into
 * "No type".
 */
function profileFacet(locale: string): FacetSpec {
  return {
    name: 'Profile',
    extract: strField('profile_id'),
    ordered: (ctx) => (ctx.keyQualifications ?? []).map((q) => ({
      value: q.id, label: resolve(q.tag_line, locale) || '(unnamed profile)',
    })),
  }
}

/**
 * The facets each section offers, in dropdown order. `locale` localizes the
 * enum labels (position/publication) and the role names; employment type is
 * English-only (editor metadata, not exported — see lib/employmentTypes.ts).
 *
 * Adding a facet is adding one entry here — `ItemSelectTools` renders them all
 * generically.
 */
function sectionFacets(sectionKey: string, locale: string): FacetSpec[] {
  switch (sectionKey) {
    case 'positions':
      return [enumFacet('Type', 'position_type',
        POSITION_TYPES.map((t) => t.value), (v) => positionTypeLabel(v, locale))]
    case 'publications':
      return [enumFacet('Type', 'publication_type',
        PUBLICATION_TYPES.map((t) => t.value as string), (v) => publicationTypeLabel(v, locale))]
    case 'work_experiences':
      return [
        enumFacet('Employment type', 'employment_type',
          EMPLOYMENT_TYPES.map((t) => t.value), employmentTypeLabel),
        roleFacet((it) => (it.role_ids as string[] | undefined) ?? [], locale),
      ]
    case 'projects':
      return [roleFacet(
        (it) => ((it.roles as Array<{ role_id?: string }> | undefined) ?? [])
          .map((r) => r.role_id).filter((id): id is string => !!id),
        locale,
      )]
    case 'courses':
    case 'certifications':
      return [enumFacet('Category', 'category',
        COURSE_CATEGORIES.map((t) => t.value), (v) => courseCategoryLabel(v))]
    case 'key_competencies':
      return [profileFacet(locale)]
    default:
      return []
  }
}

export interface TypeGroup {
  /** The facet value, or '' for the "No type" group. */
  value: string
  label: string
  ids: string[]
}

/** One facet's worth of groups, with the facet's dropdown heading. */
export interface FacetGroupSet {
  name: string
  groups: TypeGroup[]
}

/** Separator for an opaque type-filter key (facet name + facet value). A group's
 *  "No type" value is '' — still distinct once prefixed by the facet name. */
const TYPE_FILTER_SEP = ''

/** Build the opaque key the editor type filter stores for a facet+value pair. */
export function typeFilterKey(facet: string, value: string): string {
  return `${facet}${TYPE_FILTER_SEP}${value}`
}

/**
 * The set of item ids matching an editor type-filter `key` (from
 * `typeFilterKey`), or `null` when there's no filter. A key that no longer
 * matches any group returns an EMPTY set (nothing shown) rather than null, so a
 * stale filter doesn't silently show everything. Editor-only — never touches
 * views/exports.
 */
export function itemsMatchingTypeFilter(
  sectionKey: string,
  items: readonly SelectableItem[],
  locale: string,
  ctx: FacetCtx,
  key: string,
): Set<string> | null {
  if (!key) return null
  for (const set of typeGroups(sectionKey, items, locale, ctx)) {
    for (const g of set.groups) {
      if (typeFilterKey(set.name, g.value) === key) return new Set(g.ids)
    }
  }
  return new Set()
}

/** True when this section offers at least one facet. */
export function hasTypeFacet(sectionKey: string): boolean {
  return sectionFacets(sectionKey, 'en').length > 0
}

/**
 * Group a section's items for each facet it offers. Every facet returns its
 * value groups (in the facet's order) plus a trailing "No type" group for items
 * carrying none of the known values — an unset field OR, for roles, an item
 * with no role links or only stale ones. Groups with no items are omitted: a
 * facet only offers what the resume actually contains, and a whole facet with
 * nothing to show is dropped entirely.
 */
export function typeGroups(
  sectionKey: string,
  items: readonly SelectableItem[],
  locale: string,
  ctx: FacetCtx = { roles: [] },
): FacetGroupSet[] {
  const facets = sectionFacets(sectionKey, locale)
  if (!facets.length) return []

  const sets: FacetGroupSet[] = []
  for (const facet of facets) {
    const values = facet.ordered(ctx)
    const known = new Set(values.map((v) => v.value))
    const byValue = new Map<string, string[]>()
    const untyped: string[] = []

    for (const item of items) {
      const vals = facet.extract(item).filter((v) => known.has(v))
      if (!vals.length) { untyped.push(item.id); continue }
      for (const v of vals) {
        const bucket = byValue.get(v)
        if (bucket) bucket.push(item.id)
        else byValue.set(v, [item.id])
      }
    }

    const groups: TypeGroup[] = []
    for (const { value, label } of values) {
      const ids = byValue.get(value)
      if (ids?.length) groups.push({ value, label, ids })
    }
    if (untyped.length) groups.push({ value: '', label: 'No type', ids: untyped })
    if (groups.length) sets.push({ name: facet.name, groups })
  }
  return sets
}
