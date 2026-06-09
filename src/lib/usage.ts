/**
 * Registry-usage enumeration.
 *
 * Pure helpers that list every entity referencing a given Skill or Role
 * registry entry. Powers the "expand to see usage" panel on the registry
 * cards, the "X projects | Y employments" meta strings, and the
 * "Unused" filter on the registry list.
 *
 * `countSkillReferences` / `countRoleReferences` in `merge.ts` are the
 * "how many references will the merge rewrite" number — these helpers
 * return the actual entities so the UI can render a clickable breakdown.
 */

import type {
  ResumeStore, Project, WorkExperience, TechnologyCategory,
} from '../types'

export interface SkillUsage {
  projects: Project[]
  technology_categories: TechnologyCategory[]
}

export interface RoleUsage {
  projects: Project[]
  work_experiences: WorkExperience[]
}

/**
 * All entities that reference a given skill, deduplicated per-section. A
 * project that lists the same skill twice (different ProjectSkill rows on
 * the same `skill_id`) appears once in `projects`.
 */
export function usageOfSkill(store: ResumeStore, skillId: string): SkillUsage {
  const projects = store.projects.filter((p) =>
    p.skills.some((ps) => ps.skill_id === skillId),
  )
  const technology_categories = store.technology_categories.filter((c) =>
    c.skills.some((cs) => cs.skill_id === skillId),
  )
  return { projects, technology_categories }
}

/**
 * All entities that reference a given role: projects through any
 * `ProjectRole.role_id`, plus work_experiences through the optional
 * `WorkExperience.role_id` registry link.
 */
export function usageOfRole(store: ResumeStore, roleId: string): RoleUsage {
  const projects = store.projects.filter((p) =>
    p.roles.some((pr) => pr.role_id === roleId),
  )
  const work_experiences = store.work_experiences.filter(
    (w) => w.role_id === roleId,
  )
  return { projects, work_experiences }
}

/** True when no entity anywhere references this skill — safe to remove. */
export function isSkillUnused(store: ResumeStore, skillId: string): boolean {
  const u = usageOfSkill(store, skillId)
  return u.projects.length === 0 && u.technology_categories.length === 0
}

/** True when no entity anywhere references this role — safe to remove. */
export function isRoleUnused(store: ResumeStore, roleId: string): boolean {
  const u = usageOfRole(store, roleId)
  return u.projects.length === 0 && u.work_experiences.length === 0
}
