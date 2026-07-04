/**
 * Resume Studio — backup / portable file format (v1)
 *
 * This is the canonical format for exporting and restoring resume data.
 * It is NOT the CVpartner format — see importer.ts for that.
 *
 * The outer structure wraps the internal ResumeStore with:
 *   - version metadata (schema, format_version, exported_at)
 *   - semantic grouping: profile / registries / sections / views
 *
 * "sections" uses the same key names as ResumeStore for direct mapping.
 */

import type {
  ResumeStore, Resume, Skill, Role, Industry, SkillCategory,
  KeyQualification, KeyCompetency, Recommendation, Project, WorkExperience,
  Education, Course, Certification, SpokenLanguage,
  Position, Presentation, HonorAward, Publication, Reference, ResumeView,
} from '../types'

// ─── Backup format types ──────────────────────────────────────────────────────

/**
 * Highest format version this build knows how to read AND write. Bumped only
 * when the on-disk shape changes in a way that requires migration.
 */
export const CURRENT_FORMAT_VERSION = 1

export interface BackupV1 {
  $schema: 'resumestudio/v1'
  format_version: 1
  exported_at: string
  /**
   * The CONTENT's data-shape stamp (`ResumeStore.shape_version`) — distinct
   * from `format_version`, which versions this envelope. Carried through so a
   * backup written by a newer build keeps warning older builds on import.
   * Additive + optional: backups from before versioning simply omit it.
   */
  shape_version?: number
  profile: Resume | null
  registries: {
    skills: Skill[]
    roles: Role[]
    /** Industry registry (A8.1). Additive — backups from older builds omit it. */
    industries?: Industry[]
    /**
     * Skill-category entities (shape v6, roadmap: showcase unification).
     * Additive — backups from older builds omit it; `sections.technology_categories`
     * (legacy, below) carries the pre-unification data instead, and
     * `migrateStore`'s `unifyShowcaseCategories` converts it on load.
     */
    skill_categories?: SkillCategory[]
  }
  sections: {
    key_qualifications: KeyQualification[]
    key_competencies: KeyCompetency[]
    recommendations: Recommendation[]
    projects: Project[]
    work_experiences: WorkExperience[]
    educations: Education[]
    courses: Course[]
    certifications: Certification[]
    spoken_languages: SpokenLanguage[]
    /**
     * LEGACY: the pre-unification "Skills Showcase" structure
     * (TechnologyCategory + CategorySkill, both removed from `types/index.ts`).
     * Never written by this build — kept optional/loosely-typed so an OLD
     * backup still round-trips through `importFromBackup` into
     * `migrateStore`'s `unifyShowcaseCategories`, which converts it into
     * `registries.skill_categories` + `Skill.category_id` on load.
     */
    technology_categories?: unknown[]
    positions: Position[]
    presentations: Presentation[]
    honor_awards: HonorAward[]
    publications: Publication[]
    references: Reference[]
  }
  views: ResumeView[]
}

/**
 * Union of every backup shape this build can read. When you add a new format
 * version, add its interface to this union AND extend `migrateBackup` below.
 */
export type AnyBackup = BackupV1

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns true if the parsed JSON object looks like ANY known Resume Studio
 * backup version. Distinguishes backup files from CVpartner exports without
 * yet asserting which version it is — use `migrateBackup` to actually read it.
 *
 * Older callers expecting a BackupV1 type guard still work: today every known
 * version IS v1, so the guard is correct. When a v2 is added, this stays the
 * same but the guard narrows to `AnyBackup`.
 */
export function isBackupFormat(json: unknown): json is AnyBackup {
  if (!json || typeof json !== 'object') return false
  const obj = json as Record<string, unknown>
  if (typeof obj['$schema'] !== 'string') return false
  if (!String(obj['$schema']).startsWith('resumestudio/')) return false
  if (typeof obj['format_version'] !== 'number') return false
  if (!('profile' in obj) || !('sections' in obj)) return false
  return true
}

// ─── Migration scaffold ───────────────────────────────────────────────────────

export class UnsupportedBackupVersionError extends Error {
  constructor(public version: unknown) {
    super(
      `Unsupported backup format_version: ${String(version)}. ` +
      `This build understands versions 1 through ${CURRENT_FORMAT_VERSION}. ` +
      `The file may have been saved by a newer build of Resume Studio.`
    )
    this.name = 'UnsupportedBackupVersionError'
  }
}

/**
 * Bring any known backup shape up to the current version.
 *
 * Today there is only v1 so this is a pass-through. When a v2 is introduced,
 * add a `migrateV1toV2(v1)` step and chain it here. The pattern keeps each
 * step small and independently testable.
 *
 * Throws `UnsupportedBackupVersionError` for unknown versions — callers
 * should catch and present a useful error to the user.
 */
export function migrateBackup(raw: AnyBackup): BackupV1 {
  const v = raw.format_version
  if (v === 1) return raw
  throw new UnsupportedBackupVersionError(v)
}

// ─── Export ───────────────────────────────────────────────────────────────────

/** Convert the internal store to the portable backup format. */
export function exportToBackup(store: ResumeStore): BackupV1 {
  return {
    $schema: 'resumestudio/v1',
    format_version: 1,
    exported_at: new Date().toISOString(),
    shape_version: store.shape_version,
    profile: store.resume,
    registries: {
      skills: store.skills,
      roles: store.roles,
      industries: store.industries,
      skill_categories: store.skill_categories ?? [],
    },
    sections: {
      key_qualifications: store.key_qualifications,
      key_competencies: store.key_competencies,
      recommendations: store.recommendations,
      projects: store.projects,
      work_experiences: store.work_experiences,
      educations: store.educations,
      courses: store.courses,
      certifications: store.certifications,
      spoken_languages: store.spoken_languages,
      positions: store.positions,
      presentations: store.presentations,
      honor_awards: store.honor_awards,
      publications: store.publications,
      references: store.references,
    },
    views: store.views,
  }
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Restore a ResumeStore from a backup file.
 *
 * Accepts any known backup version — migration is applied first. Throws
 * `UnsupportedBackupVersionError` if the version is unknown.
 */
export function importFromBackup(backup: AnyBackup): ResumeStore {
  const v1 = migrateBackup(backup)
  const store: ResumeStore = {
    shape_version:           v1.shape_version,
    resume:                  v1.profile,
    skills:                  v1.registries.skills,
    roles:                   v1.registries.roles,
    // Added with the Industry registry (A8.1) — older backups omit it; a
    // pre-v3 shape_version then triggers internIndustries in migrateStore.
    industries:              v1.registries.industries ?? [],
    // Added with the showcase unification (shape v6) — older backups omit it
    // and carry `sections.technology_categories` instead (attached below, for
    // migrateStore's unifyShowcaseCategories to convert on load).
    skill_categories:        v1.registries.skill_categories ?? [],
    key_qualifications:      v1.sections.key_qualifications,
    // Added after the initial v1 shape — older backups omit these arrays.
    key_competencies:        v1.sections.key_competencies ?? [],
    recommendations:         v1.sections.recommendations ?? [],
    projects:                v1.sections.projects,
    work_experiences:        v1.sections.work_experiences,
    educations:              v1.sections.educations,
    courses:                 v1.sections.courses,
    certifications:          v1.sections.certifications,
    spoken_languages:        v1.sections.spoken_languages,
    positions:               v1.sections.positions,
    presentations:           v1.sections.presentations,
    honor_awards:            v1.sections.honor_awards,
    publications:            v1.sections.publications,
    references:              v1.sections.references,
    views:                   v1.views,
  }
  // A pre-v6 backup carries the legacy showcase structure instead of
  // `registries.skill_categories` — attach it (untyped; ResumeStore no longer
  // declares the field) so migrateStore's unifyShowcaseCategories can convert
  // it, the same way it would for a pre-v6 live resume.
  if (v1.sections.technology_categories) {
    (store as unknown as Record<string, unknown>).technology_categories = v1.sections.technology_categories
  }
  return store
}

// ─── Download helper ──────────────────────────────────────────────────────────

/** Trigger a browser download of the backup JSON. */
export function downloadBackup(store: ResumeStore): void {
  const backup = exportToBackup(store)
  const json   = JSON.stringify(backup, null, 2)
  const blob   = new Blob([json], { type: 'application/json' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  const name   = store.resume?.full_name?.replace(/\s+/g, '_') ?? 'resume'
  a.href     = url
  a.download = `${name}_backup.json`
  a.click()
  URL.revokeObjectURL(url)
}
