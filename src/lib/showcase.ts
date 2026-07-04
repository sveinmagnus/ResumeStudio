/**
 * PURE: the Skills Showcase view section — a projection of the skill-category
 * system (roadmap: showcase unification). Groups every HIGHLIGHTED skill by
 * its linked category, in the categories' curated order. A category is
 * omitted once it has no qualifying skills; there is never an
 * "Uncategorized" group — showcase membership is exclusively via a linked
 * category, and highlighting is what puts a skill in the showcase at all.
 *
 * `full`/`summary` detail is a pure FORMAT toggle handled by the section
 * catalog + render adapters (tags vs. one-line) — it does NOT change which
 * skills appear. The showcase always renders the same highlighted set
 * regardless of detail level. This keeps "showcase a skill" a single gesture
 * (highlight it; its category picks the group) and keeps exports from before
 * the showcase/registry unification reproducible afterward.
 */

import type { ResumeStore, ResumeView, Skill, LocalizedString } from '../types'
import { resolve } from './locales'
import { skillCategoryList } from './skillCategorize'

export interface ShowcaseGroup {
  /** The category's id — the excludable item id in the view editor. */
  id: string
  name: LocalizedString
  /** Alphabetical by resolved name (every skill here is highlighted). */
  skills: Skill[]
}

/**
 * Build the Skills Showcase groups for a view: every non-excluded category
 * (in its curated `sort_order`), paired with its highlighted skills. A
 * category with zero qualifying skills is omitted.
 */
export function showcaseGroups(store: ResumeStore, view: ResumeView, locale: string): ShowcaseGroup[] {
  const excluded = new Set(view.excluded_item_ids)
  const categories = skillCategoryList(store).filter((c) => !excluded.has(c.id))
  if (categories.length === 0) return []

  const bySkillCategory = new Map<string, Skill[]>()
  for (const s of store.skills) {
    if (!s.is_highlighted || !s.category_id) continue
    const list = bySkillCategory.get(s.category_id)
    if (list) list.push(s)
    else bySkillCategory.set(s.category_id, [s])
  }

  const groups: ShowcaseGroup[] = []
  for (const c of categories) {
    const skills = bySkillCategory.get(c.id)
    if (!skills || skills.length === 0) continue
    const sorted = [...skills].sort((a, b) => resolve(a.name, locale).localeCompare(resolve(b.name, locale)))
    groups.push({ id: c.id, name: c.name, skills: sorted })
  }
  return groups
}
