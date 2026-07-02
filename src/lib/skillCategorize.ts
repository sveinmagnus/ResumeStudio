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

/**
 * A skill's category and its (legacy) `skill_type` are ONE concept in the UI —
 * there is no separate "type". `skill_type` is just the coarse default a skill
 * carries until it's given (or auto-assigned) a real category. The effective
 * category is therefore the explicit `category` if set, else the title-cased
 * type label. Everything user-facing — the list card, the By-category view, the
 * category filter — groups on this so the three never disagree.
 */
export const SKILL_TYPE_LABELS: Record<Skill['skill_type'], string> = {
  technical: 'Technical',
  methodology: 'Methodology',
  domain: 'Domain',
  soft: 'Soft',
}

export function effectiveSkillCategory(
  skill: Pick<Skill, 'category' | 'skill_type'>,
): string {
  const explicit = skill.category?.trim()
  return explicit || SKILL_TYPE_LABELS[skill.skill_type]
}

export interface CategoryAssignment {
  skill_id: string
  /** Resolved skill name (best available locale) — for the preview UI. */
  name: string
  /** The category (library domain) that will be assigned. */
  category: string
  /** Which tier produced the match. */
  tier: 1 | 2
}

export interface CategorizeResult {
  store: ResumeStore
  /** Number of skills that received a category. */
  changed: number
  assignments: CategoryAssignment[]
}

export interface CategorizeOptions {
  /** Overwrite a category the user already set. Default false (fill blanks only). */
  overwrite?: boolean
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

/** Tier 1: the domain for a skill whose name matches the library, else null. */
function exactDomain(name: Record<string, string>, domains: Map<string, string>): string | null {
  for (const v of Object.values(name)) {
    const d = domains.get(v.trim().toLowerCase())
    if (d) return d
  }
  return null
}

/**
 * Tier 2: the majority domain among a skill's graph neighbours. The skill's
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
 * Auto-categorize a store's skills from library domains (Tier 1) with an
 * optional graph-vote fallback (Tier 2). Pure — the input store is not mutated.
 */
export function autoCategorizeSkills(
  store: ResumeStore,
  domains: SkillDomains,
  relations?: SkillRelations,
  opts: CategorizeOptions = {},
): CategorizeResult {
  const domainMap = lowerMap(domains)
  if (domainMap.size === 0) return { store, changed: 0, assignments: [] }

  // Case-insensitive relations lookup (built once) for Tier 2.
  const relMap = new Map<string, string[]>()
  if (relations) {
    for (const [k, v] of Object.entries(relations)) relMap.set(k.trim().toLowerCase(), v)
  }

  const assignments: CategoryAssignment[] = []
  const skills = store.skills.map((s) => {
    // Respect a manually-set category unless the caller opts into overwrite.
    const hasCategory = !!(s.category && s.category.trim())
    if (hasCategory && !opts.overwrite) return s

    let category = exactDomain(s.name, domainMap)
    let tier: 1 | 2 = 1
    if (!category && relMap.size) {
      category = neighbourDomain(s.name, relMap, domainMap)
      tier = 2
    }
    if (!category || category === s.category) return s

    assignments.push({ skill_id: s.id, name: anyName(s.name), category, tier })
    return { ...s, category }
  })

  if (assignments.length === 0) return { store, changed: 0, assignments: [] }
  return { store: { ...store, skills }, changed: assignments.length, assignments }
}
