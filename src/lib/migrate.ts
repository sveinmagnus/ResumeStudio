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

import type { ResumeStore, LocalizedString, ProjectRole, ProjectIndustry, KeyCompetency, KeyPoint, WorkExperience, Industry, Project } from '../types'
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
 *
 * Bump this ONLY for structural changes that need a migration (moving or
 * reshaping data). Additive optional fields are handled by render-boundary
 * defaults (`with*Defaults`) and must NOT bump it — a bump makes every other
 * install consider its data outdated. A new top-level array that code iterates
 * (like `industries`) is NOT a tolerable "optional field" — it must be
 * guaranteed present, hence the bump + migration.
 */
export const CURRENT_SHAPE_VERSION = 4

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
  const migrated = internProjectIndustries(
    defaultEmploymentRoleLinks(
      extractKeyPointsToCompetencies(foldRoleDescriptions(store)),
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
