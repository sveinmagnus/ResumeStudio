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
  ResumeStore, Resume, Skill, Role,
  KeyQualification, Project, WorkExperience, Education, Course,
  Certification, SpokenLanguage, TechnologyCategory, Position,
  Presentation, HonorAward, Publication, Reference, ResumeView,
} from '../types'

// ─── Backup format types ──────────────────────────────────────────────────────

export interface BackupV1 {
  $schema: 'resumestudio/v1'
  format_version: 1
  exported_at: string
  profile: Resume | null
  registries: {
    skills: Skill[]
    roles: Role[]
  }
  sections: {
    key_qualifications: KeyQualification[]
    projects: Project[]
    work_experiences: WorkExperience[]
    educations: Education[]
    courses: Course[]
    certifications: Certification[]
    spoken_languages: SpokenLanguage[]
    technology_categories: TechnologyCategory[]
    positions: Position[]
    presentations: Presentation[]
    honor_awards: HonorAward[]
    publications: Publication[]
    references: Reference[]
  }
  views: ResumeView[]
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns true if the parsed JSON object is a Resume Studio backup file.
 * Distinguished from CVpartner exports by the presence of `format_version`
 * and `$schema`.
 */
export function isBackupFormat(json: unknown): json is BackupV1 {
  if (!json || typeof json !== 'object') return false
  const obj = json as Record<string, unknown>
  return (
    obj['$schema'] === 'resumestudio/v1' &&
    obj['format_version'] === 1 &&
    'profile' in obj &&
    'registries' in obj &&
    'sections' in obj
  )
}

// ─── Export ───────────────────────────────────────────────────────────────────

/** Convert the internal store to the portable backup format. */
export function exportToBackup(store: ResumeStore): BackupV1 {
  return {
    $schema: 'resumestudio/v1',
    format_version: 1,
    exported_at: new Date().toISOString(),
    profile: store.resume,
    registries: {
      skills: store.skills,
      roles: store.roles,
    },
    sections: {
      key_qualifications: store.key_qualifications,
      projects: store.projects,
      work_experiences: store.work_experiences,
      educations: store.educations,
      courses: store.courses,
      certifications: store.certifications,
      spoken_languages: store.spoken_languages,
      technology_categories: store.technology_categories,
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

/** Restore a ResumeStore from a backup file. */
export function importFromBackup(backup: BackupV1): ResumeStore {
  return {
    resume:                  backup.profile,
    skills:                  backup.registries.skills,
    roles:                   backup.registries.roles,
    key_qualifications:      backup.sections.key_qualifications,
    projects:                backup.sections.projects,
    work_experiences:        backup.sections.work_experiences,
    educations:              backup.sections.educations,
    courses:                 backup.sections.courses,
    certifications:          backup.sections.certifications,
    spoken_languages:        backup.sections.spoken_languages,
    technology_categories:   backup.sections.technology_categories,
    positions:               backup.sections.positions,
    presentations:           backup.sections.presentations,
    honor_awards:            backup.sections.honor_awards,
    publications:            backup.sections.publications,
    references:              backup.sections.references,
    views:                   backup.views,
  }
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
