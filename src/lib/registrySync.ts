/**
 * Cross-resume registry sync — the pure logic joining a resume's own registries
 * to the instance-level canonical registry (Stage 3 / Increment 2). No React, no
 * I/O; the store and UI call these and do the actual `api.*` writes.
 *
 * Two directions:
 *   - `overlayCanonicalNames` (READ / load): where a resume registry entry has a
 *     `canonical_id`, its shared IDENTITY (name, + skill classification/category)
 *     is reconciled FROM the canonical entry, so a rename in another resume shows
 *     up here on load. Per-person facts (proficiency, highlight, ordering) are
 *     never touched — see plans/cross-resume-registries.md §3.0.
 *   - `planPublish` (WRITE / publish): compute what it takes to share a resume's
 *     unlinked registries — which canonical entries to CREATE (no match by key)
 *     and which existing ones to LINK to (match by key). Idempotent: an
 *     already-linked entry is left alone.
 *
 * Additive + non-destructive: an entry with no `canonical_id` behaves exactly as
 * today (its stored name is authoritative), so an instance with an empty
 * registry is unchanged.
 */

import type {
  ResumeStore, RegistryEntry, RegistryKind, Skill, Role, Industry, SkillCategory, LocalizedString,
} from '../types'
import { skillKey } from './skillExtract'
import { normalizeKey } from './skillMatch'

/** The resume-store array + entity for each registry kind. */
const KIND_ARRAY: Record<RegistryKind, keyof Pick<ResumeStore, 'skills' | 'roles' | 'industries' | 'skill_categories'>> = {
  skill: 'skills', role: 'roles', industry: 'industries', category: 'skill_categories',
}

/** The dedup key for a name, per kind (skills get the "js" alias; must match the server). */
export function registryKey(kind: RegistryKind, name: string): string {
  return kind === 'skill' ? skillKey(name) : normalizeKey(name)
}

/** First non-empty key across a localized name's locales. */
function keyForLocalized(kind: RegistryKind, name: LocalizedString): string {
  for (const v of Object.values(name)) {
    const k = registryKey(kind, v ?? '')
    if (k) return k
  }
  return ''
}

/** Index canonical entries of one kind by id. */
function byId(entries: RegistryEntry[]): Map<string, RegistryEntry> {
  return new Map(entries.map((e) => [e.id, e]))
}

/**
 * Return a store whose linked registry entries have their identity reconciled
 * from the canonical registry. A pure, shallow rebuild: only entries whose
 * `canonical_id` resolves to a live canonical entry change; a dangling link (the
 * canonical entry was deleted) is left as-is (its stored name still shows). The
 * store reference is returned unchanged when nothing links, so callers can skip
 * a re-render cheaply.
 */
export function overlayCanonicalNames(store: ResumeStore, entries: RegistryEntry[]): ResumeStore {
  if (!entries.length) return store
  const canon = byId(entries)
  let changed = false

  const overlaySkill = (s: Skill): Skill => {
    const c = s.canonical_id ? canon.get(s.canonical_id) : undefined
    if (!c) return s
    changed = true
    return {
      ...s,
      name: c.name,
      // Skill-only canonical extras — undefined leaves the resume value.
      classification: c.extra.classification ?? s.classification,
      category_id: c.extra.category_id !== undefined ? c.extra.category_id : s.category_id,
    }
  }
  const overlayNamed = <T extends { canonical_id?: string | null; name: LocalizedString }>(item: T): T => {
    const c = item.canonical_id ? canon.get(item.canonical_id) : undefined
    if (!c) return item
    changed = true
    return { ...item, name: c.name }
  }

  const skills = store.skills.map(overlaySkill)
  const roles = store.roles.map((r) => overlayNamed<Role>(r))
  const industries = store.industries.map((i) => overlayNamed<Industry>(i))
  const skill_categories = (store.skill_categories ?? []).map((c) => overlayNamed<SkillCategory>(c))

  if (!changed) return store
  return { ...store, skills, roles, industries, skill_categories }
}

/**
 * One canonical entry to create when publishing (no existing match by key).
 * `localIds` is every resume registry entry that should link to the new
 * canonical entry once created — usually one, but same-key siblings in a resume
 * (e.g. "React" + "React.js") share a single create.
 */
export interface CanonicalCreate {
  kind: RegistryKind
  localIds: string[]
  name: LocalizedString
  extra: RegistryEntry['extra']
}

/** One resume registry entry to link to an ALREADY-EXISTING canonical entry. */
export interface CanonicalLink {
  kind: RegistryKind
  localId: string
  canonicalId: string
}

export interface PublishPlan {
  creates: CanonicalCreate[]
  links: CanonicalLink[]
}

/**
 * Plan what it takes to publish a resume's registries to the instance registry:
 * for each not-yet-linked entry, LINK it to an existing canonical entry with the
 * same key, or CREATE a new canonical entry (same-key siblings collapse into one
 * create with several `localIds`). Already-linked entries are skipped
 * (idempotent). Pure — the caller performs the `api.createRegistryEntry` /
 * link-writes, then links each create's `localIds` to the returned id.
 */
export function planPublish(store: ResumeStore, entries: RegistryEntry[]): PublishPlan {
  const links: CanonicalLink[] = []
  // Existing canonical entries by (kind, key).
  const canonByKey = new Map<string, RegistryEntry>()
  for (const e of entries) canonByKey.set(`${e.kind}:${e.key}`, e)
  // Creates being assembled this pass, by (kind, key), so siblings coalesce.
  const createByKey = new Map<string, CanonicalCreate>()

  const plan = (kind: RegistryKind) => {
    const arr = store[KIND_ARRAY[kind]] as Array<{ id: string; name: LocalizedString; canonical_id?: string | null; classification?: string; category_id?: string | null }>
    for (const item of arr ?? []) {
      if (item.canonical_id) continue // already shared
      const key = keyForLocalized(kind, item.name)
      if (!key) continue
      const composite = `${kind}:${key}`

      const existing = canonByKey.get(composite)
      if (existing) {
        links.push({ kind, localId: item.id, canonicalId: existing.id })
        continue
      }
      const pending = createByKey.get(composite)
      if (pending) {
        pending.localIds.push(item.id) // sibling shares the same create
        continue
      }
      const extra: RegistryEntry['extra'] = kind === 'skill'
        ? { ...(item.classification ? { classification: item.classification } : {}), ...(item.category_id != null ? { category_id: item.category_id } : {}) }
        : {}
      createByKey.set(composite, { kind, localIds: [item.id], name: item.name, extra })
    }
  }

  ;(['skill', 'role', 'industry', 'category'] as RegistryKind[]).forEach(plan)
  return { creates: [...createByKey.values()], links }
}

/**
 * Return a store with `canonical_id` set on the registry entries named in
 * `byLocalId` (localId → canonicalId). Pure + shallow; entries not in the map
 * are untouched, and the store ref is returned unchanged when the map is empty.
 * Used by the publish flow to write links back before saving a resume.
 */
export function applyCanonicalLinks(store: ResumeStore, byLocalId: Record<string, string>): ResumeStore {
  if (!Object.keys(byLocalId).length) return store
  const link = <T extends { id: string; canonical_id?: string | null }>(item: T): T =>
    byLocalId[item.id] ? { ...item, canonical_id: byLocalId[item.id] } : item
  return {
    ...store,
    skills: store.skills.map(link),
    roles: store.roles.map(link),
    industries: store.industries.map(link),
    skill_categories: (store.skill_categories ?? []).map(link),
  }
}

/**
 * The NAME of every registry entry currently linked to the shared registry, as
 * `canonicalId → LocalizedString`. The canonical-sync hook diffs this against
 * its last-synced snapshot to detect a rename of a shared entry and push it to
 * the instance so other resumes see it on load.
 *
 * NAME only — deliberately not classification/`category_id`: `category_id` is a
 * per-resume reference (it points at THIS resume's `skill_categories`), so
 * propagating it to another resume would be meaningless. Cross-resume category
 * sharing needs categories to be linked too, and is a later refinement.
 */
export function linkedNameSnapshot(store: ResumeStore): Map<string, LocalizedString> {
  const out = new Map<string, LocalizedString>()
  const add = (item: { canonical_id?: string | null; name: LocalizedString }) => {
    if (item.canonical_id) out.set(item.canonical_id, item.name)
  }
  store.skills.forEach(add)
  store.roles.forEach(add)
  store.industries.forEach(add)
  ;(store.skill_categories ?? []).forEach(add)
  return out
}
