/**
 * Resume Studio — in-memory data migrations.
 *
 * These run on EVERY path where data enters the running app from outside —
 * server load, the localStorage offline queue, backup files, snapshot
 * restores — via `migrateStore()` below. They are pure functions over
 * `ResumeStore` and must be idempotent — running them twice is a no-op.
 * (Idempotence is load-bearing: data written before versioning existed is
 * unstamped, so the only safe dispatch for it is shape-sniffing.)
 *
 * Current migrations (all part of shape v1 → v2):
 *  - foldRoleDescriptions: collapse the old per-role free text
 *    (ProjectRole.long_description / .summary) into the project's single
 *    `long_description`, leaving roles as registry links only.
 *  - extractKeyPointsToCompetencies: promote per-KQ key_points to the
 *    standalone key_competencies section.
 *  - defaultEmploymentRoleLinks: backfill WorkExperience.role_id as null.
 */

import type {
  ResumeStore, LocalizedString, ProjectRole, ProjectIndustry, KeyCompetency, KeyPoint,
  WorkExperience, Industry, Project, Skill, SkillCategory,
} from '../types'
import { v4 as uuidv4 } from 'uuid'

// ─── Shape versioning ─────────────────────────────────────────────────────────

/**
 * The data-shape version this build reads and writes.
 *
 *  - absent / 1 — everything written before versioning existed.
 *  - 2          — the three structural migrations (role descriptions, key
 *                 points → competencies, employment role links) applied.
 *  - 3          — the Industry registry (A8.1): `industries[]` + every
 *                 project's `industry_id`, with legacy/imported free-text
 *                 `industry` interned into the registry.
 *  - 4          — a project may reference MULTIPLE industries: the single
 *                 `industry`/`industry_id` pair becomes `Project.industries[]`
 *                 (ProjectIndustry links, snapshot names), mirroring
 *                 `roles`/`skills`.
 *  - 5          — `skill_categories[]` seeded from the categories skills already
 *                 use, so a category persists after its last skill leaves (it's
 *                 removed only by an explicit "Delete category").
 *  - 6          — the Skills Showcase (`technology_categories` +
 *                 `Skill.category`) is unified into the skill-category system:
 *                 `skill_categories` becomes localized `SkillCategory`
 *                 ENTITIES (was `string[]`), every skill's free-text
 *                 `category` becomes a `category_id` link, and legacy
 *                 showcase membership is folded in (a skill in a showcase
 *                 group takes THAT group's category + is marked
 *                 highlighted — see `unifyShowcaseCategories`). The Skills
 *                 Showcase view section is now a virtual projection of
 *                 highlighted, categorized skills.
 *
 * Bump this ONLY for structural changes that need a migration (moving or
 * reshaping data). Additive optional fields are handled by render-boundary
 * defaults (`with*Defaults`) and must NOT bump it — a bump makes every other
 * install consider its data outdated. A new top-level array that code iterates
 * (like `industries`) is NOT a tolerable "optional field" — it must be
 * guaranteed present, hence the bump + migration.
 */
export const CURRENT_SHAPE_VERSION = 6

/**
 * True when `store` was written by a build with a NEWER shape than this one
 * (e.g. the cloud-folder sync carried data from an auto-updated machine to a
 * stale one). The store loads best-effort — unknown fields survive in memory
 * because the store only spreads/shallow-merges — but a save from this build
 * may still lose details a newer shape moved. The editor shows a warning.
 */
export function isNewerShape(store: ResumeStore): boolean {
  return (store.shape_version ?? 1) > CURRENT_SHAPE_VERSION
}

/**
 * Bring external data up to the current shape and stamp it. The single
 * migration choke point: `loadStore` runs it on every load, and any UI that
 * feeds outside data through `replaceData` (snapshot restore) must call it
 * first. In-app computed data (undo snapshots, registry merges) is current by
 * construction and skips it.
 *
 *  - already current → returned as-is (same reference, zero work);
 *  - newer than this build → returned as-is, stamp untouched (never
 *    downgrade — see `isNewerShape`);
 *  - older / unstamped → idempotent migration chain, then stamped.
 */
export function migrateStore(store: ResumeStore): ResumeStore {
  const stored = store.shape_version ?? 1
  if (stored >= CURRENT_SHAPE_VERSION) return store
  const migrated = unifyShowcaseCategories(
    internSkillCategories(
      internProjectIndustries(
        defaultEmploymentRoleLinks(
          extractKeyPointsToCompetencies(foldRoleDescriptions(store)),
        ),
      ),
    ),
  )
  return { ...migrated, shape_version: CURRENT_SHAPE_VERSION }
}

/**
 * Merge localized `addition` into `base`, joining non-empty values per-locale
 * with a blank line. Existing text comes first. Returns a new object.
 */
export function appendLocalized(
  base: LocalizedString,
  addition: LocalizedString | undefined,
): LocalizedString {
  if (!addition) return { ...base }
  const out: LocalizedString = { ...base }
  for (const [locale, raw] of Object.entries(addition)) {
    const text = (raw ?? '').trim()
    if (!text) continue
    const existing = (out[locale] ?? '').trim()
    out[locale] = existing ? `${existing}\n\n${text}` : text
  }
  return out
}

/**
 * Build a single localized paragraph for a (legacy) project role, combining
 * its long_description and summary, prefixed with the role name for context.
 * Produces a value only for locales that actually have role text.
 */
export function buildRoleParagraph(role: {
  name?: LocalizedString
  long_description?: LocalizedString
  summary?: LocalizedString
}): LocalizedString {
  const name = role.name ?? {}
  const desc = role.long_description ?? {}
  const summ = role.summary ?? {}
  const out: LocalizedString = {}
  const locales = new Set([...Object.keys(desc), ...Object.keys(summ)])
  for (const locale of locales) {
    const body = [desc[locale], summ[locale]]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join('\n\n')
    if (!body) continue
    const label = (name[locale] ?? '').trim()
    out[locale] = label ? `${label}: ${body}` : body
  }
  return out
}

/** A ProjectRole as it may exist on older persisted data (extra free-text fields). */
type LegacyProjectRole = ProjectRole & {
  long_description?: LocalizedString
  summary?: LocalizedString
}

function roleHasText(role: LegacyProjectRole): boolean {
  const hasIn = (ls?: LocalizedString) => !!ls && Object.values(ls).some((v) => (v ?? '').trim())
  return hasIn(role.long_description) || hasIn(role.summary)
}

/**
 * Fold any legacy per-role description text into the owning project's single
 * `long_description`, then strip the description fields from the roles so they
 * are pure registry links. Idempotent: projects whose roles carry no such
 * fields are returned untouched (and the same object reference is preserved
 * so the migration is cheap on already-current data).
 */
export function foldRoleDescriptions(store: ResumeStore): ResumeStore {
  let storeChanged = false

  const projects = store.projects.map((p) => {
    let longDesc = p.long_description
    let projectChanged = false

    const roles = p.roles.map((role) => {
      const legacy = role as LegacyProjectRole
      const hasLegacyKeys =
        'long_description' in legacy || 'summary' in legacy
      if (!hasLegacyKeys) return role

      if (roleHasText(legacy)) {
        longDesc = appendLocalized(longDesc, buildRoleParagraph(legacy))
      }
      projectChanged = true
      // Rebuild the role without the legacy free-text fields.
      const clean: ProjectRole = {
        id: legacy.id,
        role_id: legacy.role_id,
        name: legacy.name,
        sort_order: legacy.sort_order,
        disabled: legacy.disabled,
      }
      return clean
    })

    if (!projectChanged) return p
    storeChanged = true
    return { ...p, long_description: longDesc, roles }
  })

  if (!storeChanged) return store
  return { ...store, projects }
}

// ─── Move key_points off key_qualifications and into key_competencies ────────
//
// Earlier importer revisions stuffed CVpartner's per-KQ "key_points" array onto
// each KeyQualification as a sub-list under the Profile editor. Those points
// are conceptually the same thing as the standalone "Key Competencies" section
// (short heading + longer description), so the UX now treats them that way: the
// sub-list under Profile is gone, and the data lives in `key_competencies`.
//
// This migration takes any existing per-KQ key_points and appends them to the
// top-level key_competencies array (mapping name → title, long_description →
// description), then clears the per-KQ list. Idempotent: a store whose KQs
// already have empty key_points is returned untouched.

function pointHasText(p: KeyPoint): boolean {
  const any = (ls: LocalizedString | undefined) => !!ls && Object.values(ls).some((v) => (v ?? '').trim())
  return any(p.name) || any(p.long_description)
}

// ─── Default WorkExperience.role_id ──────────────────────────────────────────
//
// `role_id` (an optional registry link, parallel to Project.roles[].role_id)
// was added after launch. Older persisted data omits the field entirely; this
// migration backfills it as null so downstream code can treat it as a known
// shape. Idempotent — once present (even as null), the field is preserved.

export function defaultEmploymentRoleLinks(store: ResumeStore): ResumeStore {
  let changed = false
  const work_experiences = store.work_experiences.map((w) => {
    if ('role_id' in w) return w
    changed = true
    const copy: WorkExperience = { ...(w as WorkExperience), role_id: null }
    return copy
  })
  if (!changed) return store
  return { ...store, work_experiences }
}

// ─── Industry registry + multi-link (A8.1 shape v3, multi shape v4) ───────────
//
// `Project.industry` used to be free LocalizedString text; v3 promoted it to a
// shared registry with a single `industry_id` link; v4 lets a project reference
// MULTIPLE industries via `Project.industries[]` (ProjectIndustry links). This
// single migration folds both steps — interning any legacy free-text name into
// the registry (deduped case-insensitively) and producing the `industries[]`
// array — because they always run together on load. Idempotent: a project that
// already carries `industries[]` is left alone (bar stripping stray legacy
// fields), and a store already at v4 is a no-op.

/** A representative lowercased key for a localized name (first non-empty value). */
function localizedKey(ls: LocalizedString | undefined): string {
  if (!ls) return ''
  for (const v of Object.values(ls)) {
    const t = (v ?? '').trim()
    if (t) return t.toLowerCase()
  }
  return ''
}

/** A project as it may exist pre-v4: single industry link + denormalized name. */
type PreV4Project = { industries?: ProjectIndustry[]; industry?: LocalizedString; industry_id?: string | null }

export function internProjectIndustries(store: ResumeStore): ResumeStore {
  const existing: Industry[] = Array.isArray(store.industries) ? [...store.industries] : []
  const byKey = new Map<string, string>() // normalized name → industry id
  for (const ind of existing) {
    const k = localizedKey(ind.name)
    if (k && !byKey.has(k)) byKey.set(k, ind.id)
  }
  const resumeId = store.resume?.id ?? ''
  let changed = !Array.isArray(store.industries) // missing array alone is a change

  const stripLegacy = (raw: Project, industries: ProjectIndustry[]): Project => {
    const clean = { ...raw } as Record<string, unknown>
    delete clean.industry
    delete clean.industry_id
    clean.industries = industries
    return clean as unknown as Project
  }

  const projects = store.projects.map((raw): Project => {
    const p = raw as unknown as PreV4Project
    const hasArray = Array.isArray(p.industries)
    const hasLegacyKeys = 'industry' in p || 'industry_id' in p
    // Clean v4 project (array present, no stray legacy fields) → nothing to do.
    if (hasArray && !hasLegacyKeys) return raw

    changed = true
    const industries: ProjectIndustry[] = hasArray ? [...(p.industries as ProjectIndustry[])] : []
    if (p.industry_id) {
      // v3 link → snapshot from the registry (fall back to the denormalized name).
      if (!industries.some((pi) => pi.industry_id === p.industry_id)) {
        const reg = existing.find((i) => i.id === p.industry_id)
        industries.push({
          id: uuidv4(), industry_id: p.industry_id,
          name: reg ? { ...reg.name } : { ...(p.industry ?? {}) }, sort_order: industries.length,
        })
      }
    } else {
      // Pre-v3 / imported free text → intern into the registry, deduped by name.
      const key = localizedKey(p.industry)
      if (key) {
        let id = byKey.get(key)
        if (!id) {
          id = uuidv4()
          byKey.set(key, id)
          existing.push({ id, resume_id: resumeId, name: { ...(p.industry ?? {}) }, sort_order: existing.length, disabled: false })
        }
        if (!industries.some((pi) => pi.industry_id === id)) {
          industries.push({ id: uuidv4(), industry_id: id, name: { ...(p.industry ?? {}) }, sort_order: industries.length })
        }
      }
    }
    return stripLegacy(raw, industries)
  })

  if (!changed) return store
  return { ...store, industries: existing, projects }
}

// ─── Persist skill categories (shape v5) ─────────────────────────────────────
//
// Categories used to exist only as `Skill.category` values, so an emptied
// category vanished. `skill_categories[]` makes them first-class: seed it from
// the categories skills already use (union with any existing list) so old data
// keeps every category it had, persisting after the last skill leaves until an
// explicit delete. Idempotent — once the list covers the used categories, the
// same store reference is returned.

export function internSkillCategories(store: ResumeStore): ResumeStore {
  // The current type says `skill_categories` is entities, but at THIS point in
  // the chain (pre-v5 data) it's really absent or a plain string[] — read
  // defensively and skip anything already object-shaped (v6+ entities passed
  // straight through unifyShowcaseCategories's idempotence guard below).
  const existingRaw: unknown[] = Array.isArray(store.skill_categories) ? store.skill_categories : []
  const set = new Set<string>()
  for (const c of existingRaw) { if (typeof c === 'string') { const t = c.trim(); if (t) set.add(t) } }
  const before = set.size
  for (const s of store.skills) {
    const c = ((s as unknown as { category?: string }).category ?? '').trim()
    if (c) set.add(c)
  }
  // No change and the field already exists → keep the same reference.
  if (Array.isArray(store.skill_categories) && set.size === before) return store
  return {
    ...store,
    skill_categories: [...set].sort((a, b) => a.localeCompare(b)) as unknown as SkillCategory[],
  }
}

// ─── Unify the Skills Showcase into skill categories (shape v6) ──────────────
//
// Pre-v6 data has TWO parallel skill groupings: `Skill.category` (a free
// string, made durable by v5's `skill_categories: string[]`) and a separate
// `technology_categories[]` structure (`TechnologyCategory` + `CategorySkill`)
// — the old "Skills Showcase" editor's own curated membership, where a skill
// could sit in several groups. v6 unifies them into ONE concept:
//
//   1. `skill_categories` becomes localized `SkillCategory` ENTITIES — a v5
//      `string[]` is upgraded in place (wrapped as `{ en: name }`); a legacy
//      showcase group is found-or-created by name, adopting its (richer,
//      localized) name.
//   2. Every skill's `category` string becomes a `category_id` link to the
//      matching entity.
//   3. Legacy showcase membership WINS over a differing registry string
//      (export fidelity: the rendered showcase must look the same after this
//      migration runs) and marks the skill `is_highlighted` — the Showcase
//      view section now renders exactly the highlighted+categorized set, so
//      this preserves "which skills used to show in the Showcase". A skill in
//      several legacy groups takes the FIRST one (deterministic: showcase
//      array order). A DISABLED legacy category was invisible in every export
//      before, so it's skipped entirely (no entity, no highlighting).
//   4. Every view's `excluded_item_ids` is rewritten from old
//      TechnologyCategory ids to the new SkillCategory ids so per-view
//      excluded showcase groups stay excluded.
//   5. The legacy `technology_categories` key is dropped from the store.
//
// Idempotent: data that's already all-entities, with no legacy
// `technology_categories` and no skill carrying a `category` string, is
// returned untouched (same reference).

interface LegacyCategorySkill {
  id: string
  skill_id: string
  name?: LocalizedString
}

interface LegacyTechnologyCategory {
  id: string
  resume_id?: string
  name: LocalizedString
  skills?: LegacyCategorySkill[]
  sort_order?: number
  disabled?: boolean
}

/** A Skill as it may exist pre-v6: free-text category, no category_id yet. */
type PreV6Skill = Skill & { category?: string | null; default_category?: unknown }
/** A store as it may exist pre-v6: still carries the legacy showcase array
 *  (not a `ResumeStore` field anymore, hence the loose local type). */
type PreV6Store = ResumeStore & { technology_categories?: LegacyTechnologyCategory[] }

export function unifyShowcaseCategories(store: ResumeStore): ResumeStore {
  const raw = store as PreV6Store
  const legacyTechCats = Array.isArray(raw.technology_categories) ? raw.technology_categories : null
  const rawCats: unknown[] = Array.isArray(store.skill_categories) ? store.skill_categories : []
  const alreadyEntities = rawCats.length === 0 || typeof rawCats[0] === 'object'
  const anySkillHasCategoryString = store.skills.some(
    (s) => typeof (s as PreV6Skill).category === 'string' && !!(s as PreV6Skill).category,
  )
  if (alreadyEntities && !legacyTechCats && !anySkillHasCategoryString) return store

  const resumeId = store.resume?.id ?? ''
  const entities: SkillCategory[] = []
  const byNameKey = new Map<string, string>() // normalized name → entity id

  /** Find-or-create an entity by its localized name's representative key. */
  const ensureEntity = (name: LocalizedString): string => {
    const key = localizedKey(name)
    if (key) {
      const existing = byNameKey.get(key)
      if (existing) return existing
    }
    const id = uuidv4()
    if (key) byNameKey.set(key, id)
    entities.push({ id, resume_id: resumeId, name: { ...name }, sort_order: entities.length })
    return id
  }

  // 1. Legacy showcase groups FIRST — preserves the curated showcase order.
  // Disabled groups were invisible in every export before; skip entirely.
  const oldCatIdToNewId = new Map<string, string>()
  const skillToCategoryFromShowcase = new Map<string, string>()
  const sortedTechCats = [...(legacyTechCats ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  for (const tc of sortedTechCats) {
    if (tc.disabled) continue
    const newId = ensureEntity(tc.name)
    oldCatIdToNewId.set(tc.id, newId)
    for (const cs of tc.skills ?? []) {
      if (!skillToCategoryFromShowcase.has(cs.skill_id)) skillToCategoryFromShowcase.set(cs.skill_id, newId)
    }
  }

  // 2. Any category from skill_categories not already created by a showcase
  // group, appended after (a v5 string[] is already alphabetical).
  for (const c of rawCats) {
    if (typeof c === 'string') {
      const t = c.trim()
      if (t) ensureEntity({ en: t })
    } else if (c && typeof c === 'object' && 'id' in (c as Record<string, unknown>)) {
      const entity = c as SkillCategory
      const key = localizedKey(entity.name)
      if (key && byNameKey.has(key)) continue // dedup against a showcase group of the same name
      if (key) byNameKey.set(key, entity.id)
      entities.push({ ...entity })
    }
  }

  // 3. Rewrite skills: showcase membership wins; else the registry string
  // becomes a category_id; strip the legacy string fields either way.
  const skills = store.skills.map((raw): Skill => {
    const s = raw as PreV6Skill
    const fromShowcase = skillToCategoryFromShowcase.get(s.id)
    let category_id = s.category_id ?? null
    if (fromShowcase) {
      category_id = fromShowcase
    } else if (typeof s.category === 'string' && s.category.trim()) {
      category_id = ensureEntity({ en: s.category.trim() })
    }
    const is_highlighted = s.is_highlighted || skillToCategoryFromShowcase.has(s.id)
    const clean = { ...s } as Record<string, unknown>
    delete clean.category
    delete clean.default_category
    clean.category_id = category_id
    clean.is_highlighted = is_highlighted
    return clean as unknown as Skill
  })

  // 4. Rewrite every view's excluded_item_ids: old TechnologyCategory id →
  // the matching new SkillCategory id. Unmatched ids pass through untouched.
  const views = store.views.map((v) => ({
    ...v,
    excluded_item_ids: v.excluded_item_ids.map((id) => oldCatIdToNewId.get(id) ?? id),
  }))

  // 5. Drop the legacy technology_categories key from the store.
  const next = { ...store, skills, views, skill_categories: entities } as Record<string, unknown>
  delete next.technology_categories
  return next as unknown as ResumeStore
}

export function extractKeyPointsToCompetencies(store: ResumeStore): ResumeStore {
  const hasAny = store.key_qualifications.some((kq) => (kq.key_points?.length ?? 0) > 0)
  if (!hasAny) return store

  const competencies: KeyCompetency[] = [...store.key_competencies]
  let nextOrder = competencies.length
    ? Math.max(...competencies.map((c) => c.sort_order)) + 1
    : 0
  const resumeId = store.resume?.id ?? ''

  const key_qualifications = store.key_qualifications.map((kq) => {
    if (!kq.key_points || kq.key_points.length === 0) return kq
    for (const kp of kq.key_points) {
      if (!pointHasText(kp)) continue
      competencies.push({
        id: uuidv4(),
        resume_id: resumeId,
        title: kp.name,
        description: kp.long_description,
        sort_order: nextOrder++,
        starred: false,
        disabled: kp.disabled ?? false,
      })
    }
    return { ...kq, key_points: [] }
  })

  return { ...store, key_qualifications, key_competencies: competencies }
}
