/**
 * PURE: auto-categorize the Skill registry from the Quadim library, offline.
 *
 * Fills each skill's free-text `category` (the consultant's own grouping) from
 * the library's fine-grained `domain` field — "Software Development", "Cloud &
 * Infrastructure", "AI & Machine Learning", … — so a large registry gets a
 * sensible grouping without any external service. Two tiers, both deterministic:
 *
 *   Tier 1 — exact name match: a skill whose name (in ANY locale value) matches
 *            a library entry case-insensitively adopts that entry's domain.
 *   Tier 2 — graph vote: a still-uncategorized skill that IS a node in the
 *            `relatesTo` graph inherits the majority domain of its neighbours
 *            (ties broken alphabetically). This catches library skills that
 *            have no domain of their own but sit among ones that do.
 *
 * Conservative by design: only BLANK categories are filled — a category the
 * consultant set by hand is never overwritten (pass `overwrite: true` to opt
 * in). Skills entirely absent from the library (niche / Norwegian names that
 * aren't even graph nodes) stay uncategorized — that's Tier 3 (fuzzy/desc)
 * territory, deliberately out of scope here.
 *
 * Returns a NEW store (input untouched) plus the per-skill assignments so the
 * UI can preview "N skills will be categorized" before applying.
 */

import type { ResumeStore, Skill } from '../types'
import type { SkillDomains, SkillRelations } from './skillTaxonomy'
import {
  buildDomainIndex, matchSkillDomain, type DomainMatch, type MatchTier, type SkillDomainModel,
} from './skillMatch'

/** Label for a skill with no explicit `category` (the list card + filter). */
export const UNCATEGORIZED_LABEL = 'Uncategorized'

/**
 * The category a skill groups under across the list card, the By-category view
 * and the category filter: its explicit `category`, or "Uncategorized" when
 * empty. Category is the single grouping concept — there is no `skill_type`.
 */
export function effectiveSkillCategory(
  skill: Pick<Skill, 'category'>,
): string {
  return skill.category?.trim() || UNCATEGORIZED_LABEL
}

export interface CategoryAssignment {
  skill_id: string
  /** Resolved skill name (best available locale) — for the preview UI. */
  name: string
  /** The category (library domain) that will be assigned. */
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
 * with a graph-vote fallback for domainless library nodes. Only BLANK categories
 * are filled unless `overwrite`. Pure — the input store is not mutated.
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

  const assignments: CategoryAssignment[] = []
  const skills = store.skills.map((s) => {
    // Respect a manually-set category unless the caller opts into overwrite.
    if (s.category && s.category.trim() && !opts.overwrite) return s

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
    if (!match || match.domain === s.category) return s

    assignments.push({ skill_id: s.id, name: anyName(s.name), category: match.domain, tier: match.tier })
    return { ...s, category: match.domain }
  })

  if (assignments.length === 0) return { store, changed: 0, assignments: [] }
  return { store: { ...store, skills }, changed: assignments.length, assignments }
}

/**
 * Clear the explicit `category` on the given skills (set it to null) so they
 * fall back to their type default and become eligible for auto-categorization
 * again. Skills without an explicit category are left untouched. Pure — returns
 * a new store, or the same store when nothing changed.
 */
export function clearSkillCategories(
  store: ResumeStore,
  ids: Iterable<string>,
): { store: ResumeStore; cleared: number } {
  const idSet = new Set(ids)
  let cleared = 0
  const skills = store.skills.map((s) => {
    if (!idSet.has(s.id) || !(s.category && s.category.trim())) return s
    cleared++
    return { ...s, category: null }
  })
  if (cleared === 0) return { store, cleared: 0 }
  return { store: { ...store, skills }, cleared }
}
