/**
 * Registry-merge operations.
 *
 * When a user has accidentally created two registry entries that should be
 * the same — e.g. "Løsningarkitekt" vs "Løsningsarkitekt", or "Finance" vs
 * "finance" — these helpers rewrite every reference from the source id to the
 * target id and return the rewritten store with the source entry removed.
 *
 * `mergeRegistry(store, kind, source, target)` is the generic engine: a
 * descriptor table (`REGISTRIES`) declares, per registry kind, how to rewrite
 * its references and how to count them. The shared envelope (no-op guards,
 * find source/target, delete source) lives once. `mergeSkills` / `mergeRoles`
 * / `mergeIndustries` are thin wrappers kept for call-site readability.
 *
 * Pure functions over ResumeStore so they are easy to test. Callers wire the
 * result into the store via `replaceData` (bumps mutationCount so the
 * auto-save + undo systems pick it up).
 */

import type { ResumeStore, LocalizedString } from '../types'

export type RegistryKind = 'skills' | 'roles' | 'industries'

interface RegistryEntry { id: string; name: LocalizedString }

interface RegistryDescriptor {
  /**
   * Rewrite every reference pointing at `sourceId` to `targetId`, refreshing
   * any denormalized name snapshot to the target's name. Returns the store
   * with references rewritten but the source registry entry still present
   * (the envelope deletes it).
   */
  rewrite(store: ResumeStore, sourceId: string, target: RegistryEntry): ResumeStore
  /** Count references to `id` (the "this will affect N" number on the merge UI). */
  count(store: ResumeStore, id: string): number
}

const REGISTRIES: Record<RegistryKind, RegistryDescriptor> = {
  skills: {
    rewrite: (store, sourceId, target) => ({
      ...store,
      projects: store.projects.map((p) => ({
        ...p,
        skills: p.skills.map((ps) =>
          ps.skill_id === sourceId ? { ...ps, skill_id: target.id, name: target.name } : ps,
        ),
      })),
    }),
    count: (store, id) => {
      let n = 0
      for (const p of store.projects) for (const ps of p.skills) if (ps.skill_id === id) n++
      return n
    },
  },
  roles: {
    rewrite: (store, sourceId, target) => ({
      ...store,
      projects: store.projects.map((p) => ({
        ...p,
        roles: p.roles.map((pr) =>
          pr.role_id === sourceId ? { ...pr, role_id: target.id, name: target.name } : pr,
        ),
      })),
      // Employment role-type links: remap the id in place, deduped (never
      // touches the independent, company-specific role_title).
      work_experiences: store.work_experiences.map((w) =>
        w.role_ids.includes(sourceId)
          ? { ...w, role_ids: [...new Set(w.role_ids.map((id) => (id === sourceId ? target.id : id)))] }
          : w,
      ),
      // Other-roles (positions) role-type links: same remap, dedupe.
      positions: store.positions.map((pos) =>
        (pos.role_ids ?? []).includes(sourceId)
          ? { ...pos, role_ids: [...new Set((pos.role_ids ?? []).map((id) => (id === sourceId ? target.id : id)))] }
          : pos,
      ),
    }),
    count: (store, id) => {
      let n = 0
      for (const p of store.projects) for (const pr of p.roles) if (pr.role_id === id) n++
      for (const w of store.work_experiences) if (w.role_ids.includes(id)) n++
      for (const pos of store.positions) if ((pos.role_ids ?? []).includes(id)) n++
      return n
    },
  },
  industries: {
    rewrite: (store, sourceId, target) => ({
      ...store,
      projects: store.projects.map((p) => {
        if (!p.industries.some((pi) => pi.industry_id === sourceId)) return p
        // Point source links at the target + refresh the snapshot, then dedupe
        // so a project that already listed the target doesn't end up with two.
        const seen = new Set<string>()
        const industries = p.industries
          .map((pi) => (pi.industry_id === sourceId ? { ...pi, industry_id: target.id, name: target.name } : pi))
          .filter((pi) => (seen.has(pi.industry_id) ? false : (seen.add(pi.industry_id), true)))
        return { ...p, industries }
      }),
    }),
    count: (store, id) => {
      let n = 0
      for (const p of store.projects) for (const pi of p.industries) if (pi.industry_id === id) n++
      return n
    },
  },
}

/**
 * Merge `sourceId` into `targetId` within the given registry kind: rewrite
 * every reference, refresh denormalized name snapshots, and delete the source
 * entry. No-ops if either id is missing or both ids are the same.
 */
export function mergeRegistry(
  store: ResumeStore,
  kind: RegistryKind,
  sourceId: string,
  targetId: string,
): ResumeStore {
  if (sourceId === targetId) return store
  const list = store[kind] as RegistryEntry[]
  const source = list.find((x) => x.id === sourceId)
  const target = list.find((x) => x.id === targetId)
  if (!source || !target) return store

  const rewritten = REGISTRIES[kind].rewrite(store, sourceId, target)
  return {
    ...rewritten,
    [kind]: (rewritten[kind] as RegistryEntry[]).filter((x) => x.id !== sourceId),
  }
}

/** Count how many entities reference a registry entry of the given kind. */
export function countRegistryReferences(store: ResumeStore, kind: RegistryKind, id: string): number {
  return REGISTRIES[kind].count(store, id)
}

// ─── Thin wrappers (call-site readability + back-compat) ──────────────────────

export const mergeSkills = (store: ResumeStore, sourceId: string, targetId: string): ResumeStore =>
  mergeRegistry(store, 'skills', sourceId, targetId)

export const mergeRoles = (store: ResumeStore, sourceId: string, targetId: string): ResumeStore =>
  mergeRegistry(store, 'roles', sourceId, targetId)

export const mergeIndustries = (store: ResumeStore, sourceId: string, targetId: string): ResumeStore =>
  mergeRegistry(store, 'industries', sourceId, targetId)

export const countSkillReferences = (store: ResumeStore, skillId: string): number =>
  countRegistryReferences(store, 'skills', skillId)

export const countRoleReferences = (store: ResumeStore, roleId: string): number =>
  countRegistryReferences(store, 'roles', roleId)

export const countIndustryReferences = (store: ResumeStore, industryId: string): number =>
  countRegistryReferences(store, 'industries', industryId)
