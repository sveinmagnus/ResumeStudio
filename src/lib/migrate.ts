/**
 * Resume Studio — in-memory data migrations.
 *
 * These run on EVERY load path (server, local cache, backup file) via
 * `loadStore` in the store, so an older saved resume is silently brought up
 * to the current shape. They are pure functions over `ResumeStore` and must
 * be idempotent — running them twice is a no-op.
 *
 * Current migrations:
 *  - foldRoleDescriptions: collapse the old per-role free text
 *    (ProjectRole.long_description / .summary) into the project's single
 *    `long_description`, leaving roles as registry links only.
 */

import type { ResumeStore, LocalizedString, ProjectRole, KeyCompetency, KeyPoint } from '../types'
import { v4 as uuidv4 } from 'uuid'

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
