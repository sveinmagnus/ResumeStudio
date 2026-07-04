/**
 * PURE: the Skill registry's category system — shared `SkillCategory`
 * entities (`ResumeStore.skill_categories`) linked from each skill via
 * `Skill.category_id`. This is the SINGLE grouping concept for skills: the
 * list card subtitle, the By-category view, the category filter, and the
 * Skills Showcase export section (`lib/showcase.ts`, highlighted skills only)
 * all group on it.
 *
 * Also home to offline auto-categorization from the Quadim skill library: a
 * one-click action that fills each skill's category from the library's
 * fine-grained `domain` via a layered matcher (`lib/skillMatch.ts`) — exact →
 * token → fuzzy → semantic → a relations-graph vote. Only `exact` is
 * high-confidence; the rest are surfaced as "inferred — worth a review"
 * (`INFERRED_TIERS`). Never overwrites a manually-set category unless asked.
 */

import type { ResumeStore, Skill, SkillCategory, LocalizedString } from '../types'
import { resolve } from './locales'
import type { SkillDomains, SkillRelations } from './skillTaxonomy'
import {
  buildDomainIndex, matchSkillDomain, type DomainMatch, type MatchTier, type SkillDomainModel,
} from './skillMatch'
import { v4 as uuidv4 } from 'uuid'

/** Label for a skill with no linked category (the list card + filter). */
export const UNCATEGORIZED_LABEL = 'Uncategorized'

/** A representative lowercased key for a localized name (first non-empty value). */
function nameKey(ls: LocalizedString | undefined): string {
  if (!ls) return ''
  for (const v of Object.values(ls)) {
    const t = (v ?? '').trim()
    if (t) return t.toLowerCase()
  }
  return ''
}

/**
 * All known skill categories, sorted by their curated `sort_order` — the
 * source for the datalist, the filter, the By-category headers, and the
 * Skills Showcase export order. A category persists (even with zero skills)
 * until explicitly deleted. PURE.
 */
export function skillCategoryList(store: Pick<ResumeStore, 'skill_categories'>): SkillCategory[] {
  return [...(store.skill_categories ?? [])].sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * Build an id → resolved-name lookup for a locale, once per render — pass the
 * result to `effectiveSkillCategory` so N skills don't each rebuild the index.
 */
export function categoryNameIndex(categories: SkillCategory[], locale: string): Map<string, string> {
  return new Map(categories.map((c) => [c.id, resolve(c.name, locale) || UNCATEGORIZED_LABEL]))
}

/**
 * The category a skill groups under: its linked category's resolved name, or
 * "Uncategorized" when unlinked or the link is stale. `namesById` should come
 * from `categoryNameIndex` (built once per render, not per skill).
 */
export function effectiveSkillCategory(
  skill: Pick<Skill, 'category_id'>,
  namesById: Map<string, string>,
): string {
  if (!skill.category_id) return UNCATEGORIZED_LABEL
  return namesById.get(skill.category_id) ?? UNCATEGORIZED_LABEL
}

/**
 * Set a skill's category. `categoryIdOrName` may be an existing category's id
 * (drag-and-drop in the By-category view already knows the id) OR free text
 * (the category autocomplete field, which only knows display names) — an
 * exact id match wins; otherwise the text is matched case-insensitively
 * against known category names, and a brand-new category is created (under
 * `locale`) if nothing matches. `null` clears the skill's category. New
 * categories are remembered in `skill_categories` so they survive even if
 * this skill is later recategorized. PURE (new store).
 */
export function assignSkillCategory(
  store: ResumeStore,
  skillId: string,
  categoryIdOrName: string | null,
  locale = 'en',
): ResumeStore {
  const raw = categoryIdOrName?.trim() || null
  const categories = store.skill_categories ?? []
  let category_id: string | null = null
  let nextCategories = categories

  if (raw) {
    const byId = categories.find((c) => c.id === raw)
    if (byId) {
      category_id = byId.id
    } else {
      const key = raw.toLowerCase()
      const existing = categories.find((c) => nameKey(c.name) === key)
      if (existing) {
        category_id = existing.id
      } else {
        const id = uuidv4()
        nextCategories = [...categories, {
          id, resume_id: store.resume?.id ?? '', name: { [locale]: raw }, sort_order: categories.length,
        }]
        category_id = id
      }
    }
  }

  const skills = store.skills.map((s) => (s.id === skillId ? { ...s, category_id } : s))
  return { ...store, skills, skill_categories: nextCategories }
}

/**
 * Clear the linked category on the given skills (set `category_id` to null)
 * so they fall back to Uncategorized and become eligible for auto-
 * categorization again. Skills without a category are left untouched (and
 * the category entity itself is untouched — it persists until explicitly
 * deleted). Pure — returns a new store, or the same store when nothing changed.
 */
export function clearSkillCategories(
  store: ResumeStore,
  ids: Iterable<string>,
): { store: ResumeStore; cleared: number } {
  const idSet = new Set(ids)
  let cleared = 0
  const skills = store.skills.map((s) => {
    if (!idSet.has(s.id) || !s.category_id) return s
    cleared++
    return { ...s, category_id: null }
  })
  if (cleared === 0) return { store, cleared: 0 }
  return { store: { ...store, skills }, cleared }
}

/**
 * DELETE a category outright: remove the entity and clear it off every skill
 * that had it (they become Uncategorized). This is the ONLY path that removes
 * a category — clearing/recategorizing every skill in it does not. PURE.
 */
export function deleteSkillCategory(store: ResumeStore, categoryId: string): ResumeStore {
  const categories = store.skill_categories ?? []
  if (!categories.some((c) => c.id === categoryId)) return store
  const skill_categories = categories.filter((c) => c.id !== categoryId)
  const skills = store.skills.map((s) => (s.category_id === categoryId ? { ...s, category_id: null } : s))
  return { ...store, skill_categories, skills }
}

/** Rename a category's localized name (e.g. via the By-category header's translation popover). PURE. */
export function renameSkillCategory(store: ResumeStore, categoryId: string, name: LocalizedString): ResumeStore {
  const skill_categories = (store.skill_categories ?? []).map((c) => (c.id === categoryId ? { ...c, name } : c))
  return { ...store, skill_categories }
}

/** Reorder a category up/down in the curated display/export order. PURE. */
export function moveSkillCategory(store: ResumeStore, categoryId: string, dir: 'up' | 'down'): ResumeStore {
  const sorted = skillCategoryList(store)
  const idx = sorted.findIndex((c) => c.id === categoryId)
  const swap = dir === 'up' ? idx - 1 : idx + 1
  if (idx === -1 || swap < 0 || swap >= sorted.length) return store
  ;[sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]]
  const skill_categories = sorted.map((c, i) => ({ ...c, sort_order: i }))
  return { ...store, skill_categories }
}

// ─── Auto-categorization from the Quadim library ─────────────────────────────

export interface CategoryAssignment {
  skill_id: string
  /** Resolved skill name (best available locale) — for the preview UI. */
  name: string
  /** The category (library domain) that will be assigned — a display string. */
  category: string
  /** Which match tier produced it (exact/token high-confidence; the rest inferred). */
  tier: MatchTier
}

export interface CategorizeResult {
  store: ResumeStore
  /** Number of skills that received a category. */
  changed: number
  assignments: CategoryAssignment[]
}

export interface CategorizeOptions {
  /** Relations graph — enables the 'graph' tier for domainless library nodes. */
  relations?: SkillRelations
  /** Semantic token→domain model — enables the 'semantic' tier. */
  model?: SkillDomainModel
  /** Enable the fuzzy (edit-distance) tier. Default true. */
  fuzzy?: boolean
  /** Enable the semantic tier (needs `model`). Default true. */
  semantic?: boolean
  /** Overwrite a category the user already set. Default false (fill blanks only). */
  overwrite?: boolean
}

/** Confidence order for picking the best match across a skill's locale values. */
const TIER_RANK: Record<MatchTier, number> = {
  exact: 0, token: 1, graph: 2, fuzzy: 3, semantic: 4,
}

/** Case-insensitive lookup keyed by trimmed-lowercased name. */
function lowerMap(map: SkillDomains): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(map)) {
    const key = k.trim().toLowerCase()
    if (key && !out.has(key)) out.set(key, v)
  }
  return out
}

/** First non-empty locale value of a skill's name (for display + matching). */
function anyName(name: Record<string, string>): string {
  for (const v of Object.values(name)) {
    const t = v.trim()
    if (t) return t
  }
  return ''
}

/**
 * Graph tier: the majority domain among a skill's graph neighbours. The skill's
 * name must be a node in `relations`; each neighbour that has a library domain
 * casts one vote. Returns the winning domain (ties → alphabetical) or null.
 */
function neighbourDomain(
  name: Record<string, string>,
  relations: Map<string, string[]>,
  domains: Map<string, string>,
): string | null {
  let neighbours: string[] | undefined
  for (const v of Object.values(name)) {
    neighbours = relations.get(v.trim().toLowerCase())
    if (neighbours) break
  }
  if (!neighbours || neighbours.length === 0) return null

  const votes = new Map<string, number>()
  for (const n of neighbours) {
    const d = domains.get(n.trim().toLowerCase())
    if (d) votes.set(d, (votes.get(d) ?? 0) + 1)
  }
  if (votes.size === 0) return null

  return [...votes.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0][0]
}

/**
 * Auto-categorize a store's skills from the Quadim library. The layered matcher
 * (`lib/skillMatch`) tries exact → token → fuzzy → semantic on each skill name,
 * with a graph-vote fallback for domainless library nodes. Matched domain names
 * are found-or-created as category entities (case-insensitive). Only BLANK
 * categories are filled unless `overwrite`. Pure — the input store is not mutated.
 */
export function autoCategorizeSkills(
  store: ResumeStore,
  domains: SkillDomains,
  opts: CategorizeOptions = {},
): CategorizeResult {
  const index = buildDomainIndex(domains)
  if (index.entries.length === 0) return { store, changed: 0, assignments: [] }

  const domainMap = lowerMap(domains) // graph tier: neighbour name → domain
  const relMap = new Map<string, string[]>()
  if (opts.relations) {
    for (const [k, v] of Object.entries(opts.relations)) relMap.set(k.trim().toLowerCase(), v)
  }
  const matchOpts = { model: opts.model, fuzzy: opts.fuzzy, semantic: opts.semantic }

  let categories = store.skill_categories ?? []
  const idByNameKey = new Map(categories.map((c) => [nameKey(c.name), c.id]))
  const ensureCategoryId = (domainName: string): string => {
    const key = domainName.trim().toLowerCase()
    const existing = idByNameKey.get(key)
    if (existing) return existing
    const id = uuidv4()
    categories = [...categories, {
      id, resume_id: store.resume?.id ?? '', name: { en: domainName }, sort_order: categories.length,
    }]
    idByNameKey.set(key, id)
    return id
  }

  const assignments: CategoryAssignment[] = []
  const skills = store.skills.map((s) => {
    // Respect a manually-set category unless the caller opts into overwrite.
    if (s.category_id && !opts.overwrite) return s

    // Best match across the skill's locale values (prefer the higher tier).
    let match: DomainMatch | null = null
    for (const v of Object.values(s.name)) {
      if (!v || !v.trim()) continue
      const m = matchSkillDomain(v, index, matchOpts)
      if (m && (!match || TIER_RANK[m.tier] < TIER_RANK[match.tier])) match = m
      if (match && match.tier === 'exact') break
    }
    // Graph fallback for a library node with no domain of its own.
    if (!match && relMap.size) {
      const d = neighbourDomain(s.name, relMap, domainMap)
      if (d) match = { domain: d, tier: 'graph' }
    }
    if (!match) return s

    const category_id = ensureCategoryId(match.domain)
    if (category_id === s.category_id) return s

    assignments.push({ skill_id: s.id, name: anyName(s.name), category: match.domain, tier: match.tier })
    return { ...s, category_id }
  })

  if (assignments.length === 0) return { store, changed: 0, assignments: [] }
  return { store: { ...store, skills, skill_categories: categories }, changed: assignments.length, assignments }
}
