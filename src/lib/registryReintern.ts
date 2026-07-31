/**
 * Backup portability for cross-resume registries (Stage 3 / Increment 3).
 *
 * A per-resume backup can be restored into a DIFFERENT instance, whose shared
 * registry has different ids. A bare `canonical_id` would dangle there, silently
 * unlinking a skill from the team registry. So a backup embeds `CanonicalSnapshot`s
 * of the entries it references (`collectReferencedCanonical`, at export), and on
 * import those are re-interned against the TARGET instance by `key`: reuse a
 * matching entry, or create one, then rewrite the resume's links
 * (`planReintern` + `remapCanonicalIds`, wrapped by the `reinternBackupLinks`
 * orchestrator). This is the `mergeRegistry`-by-key idea moved to the import
 * boundary (see `lib/registrySync.ts` for the pure planning half).
 *
 * The pure functions here are the testable core; only `reinternBackupLinks` does
 * I/O (create-missing on the target). Same-instance restore converges too — a
 * snapshot re-interns to the still-present entry with its key.
 */

import type {
  ResumeStore, RegistryEntry, RegistryKind, CanonicalSnapshot,
} from '../types'

/**
 * The set of `canonical_id`s a resume's registry entries reference. Pure.
 */
export function referencedCanonicalIds(store: ResumeStore): Set<string> {
  const ids = new Set<string>()
  const add = (item: { canonical_id?: string | null }) => { if (item.canonical_id) ids.add(item.canonical_id) }
  store.skills.forEach(add)
  store.roles.forEach(add)
  store.industries.forEach(add)
  ;(store.skill_categories ?? []).forEach(add)
  return ids
}

/**
 * Snapshots (identity only) of the canonical entries this store links to.
 * Embedded in the backup at export. Pure.
 */
export function collectReferencedCanonical(store: ResumeStore, canonical: RegistryEntry[]): CanonicalSnapshot[] {
  const refs = referencedCanonicalIds(store)
  if (!refs.size) return []
  return canonical
    .filter((e) => refs.has(e.id))
    .map((e): CanonicalSnapshot => ({ id: e.id, kind: e.kind, name: e.name, key: e.key }))
}

const composite = (kind: RegistryKind, key: string) => `${kind}:${key}`

export interface ReinternPlan {
  /** old canonical id → target canonical id (for snapshots that matched an existing target entry). */
  idMap: Record<string, string>
  /** Snapshots with no target match — the caller creates these, then extends idMap with the new ids. */
  toCreate: CanonicalSnapshot[]
}

/**
 * Plan how to re-intern embedded snapshots against a target instance's registry:
 * match each snapshot to a target entry by (kind, key) → `idMap`, or mark it
 * `toCreate`. Pure. A snapshot whose key already appears earlier in the same
 * batch reuses that decision (dedup within the backup).
 */
export function planReintern(embedded: CanonicalSnapshot[], target: RegistryEntry[]): ReinternPlan {
  const targetByKey = new Map<string, RegistryEntry>()
  for (const e of target) targetByKey.set(composite(e.kind, e.key), e)

  const idMap: Record<string, string> = {}
  const toCreate: CanonicalSnapshot[] = []
  const willCreateKey = new Set<string>()

  for (const snap of embedded) {
    const c = composite(snap.kind, snap.key)
    const match = targetByKey.get(c)
    if (match) {
      idMap[snap.id] = match.id
    } else if (!willCreateKey.has(c)) {
      willCreateKey.add(c)
      toCreate.push(snap)
    }
    // else: another snapshot with this key is already queued for creation; this
    // one's link is resolved after creation (the caller maps every snapshot
    // sharing the key to the created id — see reinternBackupLinks).
  }
  return { idMap, toCreate }
}

/**
 * Rewrite each registry entry's `canonical_id` through `idMap`. An id NOT in the
 * map (its snapshot wasn't embedded / couldn't be resolved) is CLEARED — better
 * a purely-local entry than a link dangling into a foreign registry. Pure;
 * returns the same store ref when there are no links to touch.
 */
export function remapCanonicalIds(store: ResumeStore, idMap: Record<string, string>): ResumeStore {
  if (!referencedCanonicalIds(store).size) return store
  const remap = <T extends { canonical_id?: string | null }>(item: T): T => {
    if (!item.canonical_id) return item
    const next = idMap[item.canonical_id]
    if (next === item.canonical_id) return item
    return { ...item, canonical_id: next ?? null }
  }
  return {
    ...store,
    skills: store.skills.map(remap),
    roles: store.roles.map(remap),
    industries: store.industries.map(remap),
    skill_categories: (store.skill_categories ?? []).map(remap),
  }
}

/** The api surface `reinternBackupLinks` needs — injected so the core stays testable. */
export interface ReinternApi {
  listRegistry(): Promise<RegistryEntry[]>
  createRegistryEntry(input: { kind: RegistryKind; name: CanonicalSnapshot['name'] }): Promise<RegistryEntry>
}

/**
 * Re-intern a freshly-imported store's canonical links against THIS instance's
 * registry: match embedded snapshots by key (reuse), create the misses, then
 * remap every link. Returns the store with target-valid links (or cleared ones
 * where a snapshot was missing). No embedded snapshots → links are cleared
 * (they can't be trusted against this instance) unless there were none to begin
 * with, in which case the store is unchanged.
 */
export async function reinternBackupLinks(
  store: ResumeStore,
  embedded: CanonicalSnapshot[] | undefined,
  api: ReinternApi,
): Promise<ResumeStore> {
  if (!referencedCanonicalIds(store).size) return store // nothing links → nothing to do

  const target = await api.listRegistry()
  const plan = planReintern(embedded ?? [], target)

  // Create the misses, extending idMap. Every embedded snapshot sharing a
  // created key maps to the new id (handles same-key siblings in the backup).
  const embeddedByKey = new Map<string, CanonicalSnapshot[]>()
  for (const s of embedded ?? []) {
    const c = composite(s.kind, s.key)
    ;(embeddedByKey.get(c) ?? embeddedByKey.set(c, []).get(c)!).push(s)
  }
  for (const snap of plan.toCreate) {
    const created = await api.createRegistryEntry({ kind: snap.kind, name: snap.name })
    for (const sibling of embeddedByKey.get(composite(snap.kind, snap.key)) ?? [snap]) {
      plan.idMap[sibling.id] = created.id
    }
  }
  return remapCanonicalIds(store, plan.idMap)
}
