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
  ResumeStore, Project, WorkExperience,
} from '../types'

export interface SkillUsage {
  projects: Project[]
}

export interface RoleUsage {
  projects: Project[]
  work_experiences: WorkExperience[]
}

export interface IndustryUsage {
  projects: Project[]
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
  return { projects }
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
  return usageOfSkill(store, skillId).projects.length === 0
}

/** True when no entity anywhere references this role — safe to remove. */
export function isRoleUnused(store: ResumeStore, roleId: string): boolean {
  const u = usageOfRole(store, roleId)
  return u.projects.length === 0 && u.work_experiences.length === 0
}

/** All projects that reference a given industry via `industries[]`. */
export function usageOfIndustry(store: ResumeStore, industryId: string): IndustryUsage {
  return { projects: store.projects.filter((p) => p.industries.some((pi) => pi.industry_id === industryId)) }
}

/** True when no project references this industry — safe to remove. */
export function isIndustryUnused(store: ResumeStore, industryId: string): boolean {
  return usageOfIndustry(store, industryId).projects.length === 0
}
