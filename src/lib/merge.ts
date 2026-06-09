/**
 * Registry-merge operations.
 *
 * When a user has accidentally created two registry entries that should be
 * the same — e.g. "Løsningarkitekt" vs "Løsningsarkitekt" — these helpers
 * rewrite every reference from the source id to the target id and return
 * the rewritten store with the source entry removed.
 *
 * Pure functions over ResumeStore so they are easy to test. Callers wire
 * the result into the store via `loadStore` (also bumps mutationCount so
 * the auto-save + undo systems pick it up).
 */

import type { ResumeStore } from '../types'

/**
 * Merge two skills: rewrite every project.skills[].skill_id and
 * technology_categories[].skills[].skill_id that points to `sourceId` to
 * point to `targetId`, then delete the source from the registry.
 *
 * No-ops if either id is missing or both ids are the same.
 */
export function mergeSkills(store: ResumeStore, sourceId: string, targetId: string): ResumeStore {
  if (sourceId === targetId) return store
  const source = store.skills.find((s) => s.id === sourceId)
  const target = store.skills.find((s) => s.id === targetId)
  if (!source || !target) return store

  return {
    ...store,
    skills: store.skills.filter((s) => s.id !== sourceId),
    projects: store.projects.map((p) => ({
      ...p,
      skills: p.skills.map((ps) =>
        ps.skill_id === sourceId
          ? { ...ps, skill_id: targetId, name: target.name }
          : ps,
      ),
    })),
    technology_categories: store.technology_categories.map((cat) => ({
      ...cat,
      skills: cat.skills.map((cs) =>
        cs.skill_id === sourceId
          ? { ...cs, skill_id: targetId, name: target.name }
          : cs,
      ),
    })),
  }
}

/**
 * Merge two roles: rewrite every project.roles[].role_id AND every
 * work_experiences[].role_id that points to `sourceId` to point to
 * `targetId`, then delete the source from the registry.
 *
 * No-ops if either id is missing or both ids are the same.
 */
export function mergeRoles(store: ResumeStore, sourceId: string, targetId: string): ResumeStore {
  if (sourceId === targetId) return store
  const source = store.roles.find((r) => r.id === sourceId)
  const target = store.roles.find((r) => r.id === targetId)
  if (!source || !target) return store

  return {
    ...store,
    roles: store.roles.filter((r) => r.id !== sourceId),
    projects: store.projects.map((p) => ({
      ...p,
      roles: p.roles.map((pr) =>
        pr.role_id === sourceId
          ? { ...pr, role_id: targetId, name: target.name }
          : pr,
      ),
    })),
    work_experiences: store.work_experiences.map((w) =>
      w.role_id === sourceId
        ? { ...w, role_id: targetId, role_title: target.name }
        : w,
    ),
  }
}

/** Count how many entities reference a given skill id (for "this will affect N" UI). */
export function countSkillReferences(store: ResumeStore, skillId: string): number {
  let n = 0
  for (const p of store.projects) for (const ps of p.skills) if (ps.skill_id === skillId) n++
  for (const c of store.technology_categories) for (const cs of c.skills) if (cs.skill_id === skillId) n++
  return n
}

/**
 * Count how many entities reference a given role id, across projects AND
 * work_experiences. Used for the "this will affect N references" confirmation
 * dialog on merge.
 */
export function countRoleReferences(store: ResumeStore, roleId: string): number {
  let n = 0
  for (const p of store.projects) for (const pr of p.roles) if (pr.role_id === roleId) n++
  for (const w of store.work_experiences) if (w.role_id === roleId) n++
  return n
}
