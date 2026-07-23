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
  CoverLetter, RegistryEntry, CanonicalSnapshot,
} from '../types'
import { collectReferencedCanonical } from './registryReintern'
import { emptyStore } from './freshStore'
import { api } from './api'

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
  /**
   * Cover letters (shape v10). Additive/optional — backups written before the
   * feature omit it; `importFromBackup` defaults to `[]`. No `format_version`
   * bump needed (the envelope stays readable to older builds).
   */
  cover_letters?: CoverLetter[]
  /**
   * Snapshots of the instance-level canonical registry entries this backup's
   * `canonical_id` links reference (cross-resume registries, Stage 3). A
   * per-resume backup is portable ACROSS instances, so a bare `canonical_id`
   * (an id in the SOURCE instance's registry) would dangle on restore into a
   * DIFFERENT instance. Embedding {id, kind, name, key} lets the import
   * re-intern by `key` against the target registry (reuse or create) and
   * rewrite the links — see `lib/registryReintern.ts`. Additive/optional:
   * absent (older backups, or a resume with no shared links) → nothing to
   * re-intern, links stay as-is.
   */
  canonical_registry?: CanonicalSnapshot[]
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

// ─── Validation ─────────────────────────────────────────────────────────────
//
// `isBackupFormat` is a lenient ROUTER — it decides "this is a backup, not a
// CVpartner export" from the envelope alone, deliberately loose so a slightly
// unusual backup still gets handled here rather than misrouted. `validateBackup`
// is the stricter GATE: before we build a ResumeStore from untrusted JSON, it
// confirms the structural invariants the app relies on — collections are arrays
// of id-bearing objects, profile is object-or-null — and reports every problem
// with a field path, mirroring `validateAIImport` in aiImport.ts.
//
// It is intentionally STRUCTURAL, not a full data-model schema. Deep per-field
// validation of every LocalizedString would double the data model as a second
// source of truth (drift the codebase avoids) for little gain — the render
// boundary already escapes every value (see the security skill), so the danger
// isn't a malformed string, it's a `projects` that isn't an array or an item
// with no `id`, which breaks the store the moment it loads.

export interface BackupIssue {
  /** Dotted path to the offending field, e.g. `sections.projects[3].id`. */
  path: string
  reason: string
}

/**
 * Thrown when a backup file is structurally unusable. Carries every issue found
 * (not just the first) so a caller could list them; `ImportScreen` surfaces the
 * message. Same shape/spirit as `InvalidAIImportError`.
 */
export class InvalidBackupError extends Error {
  constructor(public issues: BackupIssue[]) {
    super(
      issues.length === 1
        ? `${issues[0].path}: ${issues[0].reason}`
        : `This backup file has ${issues.length} structural problems and can't be imported.`,
    )
    this.name = 'InvalidBackupError'
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Registry keys that must be arrays of id-bearing objects when present. */
const REGISTRY_KEYS = ['skills', 'roles', 'industries', 'skill_categories'] as const
/**
 * Section keys that must be arrays of id-bearing objects when present. NB:
 * `technology_categories` is intentionally excluded — it's the legacy
 * pre-v6 showcase blob (`unknown[]`), validated only as "an array" below,
 * because migrateStore reshapes it rather than reading it as entities.
 */
const SECTION_KEYS = [
  'key_qualifications', 'key_competencies', 'recommendations', 'projects',
  'work_experiences', 'educations', 'courses', 'certifications',
  'spoken_languages', 'positions', 'presentations', 'honor_awards',
  'publications', 'references',
] as const

/**
 * Assert `val` is an array of objects each carrying a string `id`, pushing an
 * issue per offender. Absent (`null`/`undefined`) is fine — optional
 * collections and older backups simply omit keys; that's handled by the
 * `?? []` defaults in `importFromBackup`.
 */
function checkIdArray(val: unknown, path: string, issues: BackupIssue[]): void {
  if (val == null) return
  if (!Array.isArray(val)) {
    issues.push({ path, reason: 'expected an array' })
    return
  }
  val.forEach((item, i) => {
    if (!isObj(item)) {
      issues.push({ path: `${path}[${i}]`, reason: 'expected an object' })
    } else if (typeof item['id'] !== 'string' || !item['id']) {
      issues.push({ path: `${path}[${i}].id`, reason: 'expected a non-empty string id' })
    }
  })
}

/**
 * Validate a parsed backup's structure and return it typed, or throw
 * `InvalidBackupError` listing every problem. Call this before
 * `importFromBackup` on untrusted input (`ImportScreen` does). `migrateBackup`
 * inside `importFromBackup` then handles version differences on the now-trusted
 * shape.
 */
export function validateBackup(json: unknown): AnyBackup {
  if (!isObj(json)) {
    throw new InvalidBackupError([{ path: '(root)', reason: 'expected a JSON object' }])
  }
  const issues: BackupIssue[] = []

  const schema = json['$schema']
  if (typeof schema !== 'string' || !schema.startsWith('resumestudio/')) {
    issues.push({ path: '$schema', reason: `expected a "resumestudio/…" schema, got ${JSON.stringify(schema)}` })
  }
  if (typeof json['format_version'] !== 'number') {
    issues.push({ path: 'format_version', reason: 'expected a number' })
  }

  // profile: object or null (an absent profile is tolerated — treated as null).
  if ('profile' in json && json['profile'] != null && !isObj(json['profile'])) {
    issues.push({ path: 'profile', reason: 'expected an object or null' })
  }

  const registries = json['registries']
  if (registries != null && !isObj(registries)) {
    issues.push({ path: 'registries', reason: 'expected an object' })
  } else if (isObj(registries)) {
    for (const key of REGISTRY_KEYS) checkIdArray(registries[key], `registries.${key}`, issues)
  }

  const sections = json['sections']
  if (sections != null && !isObj(sections)) {
    issues.push({ path: 'sections', reason: 'expected an object' })
  } else if (isObj(sections)) {
    for (const key of SECTION_KEYS) checkIdArray(sections[key], `sections.${key}`, issues)
    // Legacy showcase blob: only require it be an array; migrateStore reshapes it.
    const tc = sections['technology_categories']
    if (tc != null && !Array.isArray(tc)) {
      issues.push({ path: 'sections.technology_categories', reason: 'expected an array' })
    }
  }

  checkIdArray(json['views'], 'views', issues)
  checkIdArray(json['cover_letters'], 'cover_letters', issues)

  // Embedded canonical-registry snapshots (Stage 3): an array of id-bearing
  // objects when present. reinternBackupLinks tolerates a malformed entry
  // (unknown kind / missing key) at runtime, but a non-array is a shape error.
  const cr = json['canonical_registry']
  if (cr != null && !Array.isArray(cr)) {
    issues.push({ path: 'canonical_registry', reason: 'expected an array' })
  }

  if (issues.length) throw new InvalidBackupError(issues)
  return json as unknown as AnyBackup
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

/**
 * Convert the internal store to the portable backup format. Pass the instance
 * `canonicalEntries` (from `api.listRegistry()`) so the backup embeds a snapshot
 * of the shared-registry entries the resume's `canonical_id` links reference —
 * that's what makes the links survive a restore into a DIFFERENT instance
 * (§`canonical_registry`). Omit it for a legacy/offline export: the backup still
 * works, but cross-instance links may dangle (same as before Stage 3).
 */
export function exportToBackup(store: ResumeStore, canonicalEntries?: RegistryEntry[]): BackupV1 {
  const canonical_registry = canonicalEntries?.length
    ? collectReferencedCanonical(store, canonicalEntries)
    : undefined
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
    cover_letters: store.cover_letters,
    ...(canonical_registry ? { canonical_registry } : {}),
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
  // Gate untrusted input on the way in: even callers that skipped
  // `validateBackup` (or passed something `isBackupFormat` waved through) get
  // the structural guarantees the store build below relies on. Idempotent and
  // cheap on an already-valid backup, so validating here AND in ImportScreen is
  // fine — belt and braces on the one boundary that turns JSON into a store.
  const valid = validateBackup(backup)
  const v1 = migrateBackup(valid)
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
    // Added with cover letters (shape v10) — older backups omit it.
    cover_letters:           v1.cover_letters ?? [],
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

// ─── Store-backup (whole-store desktop-sync file) ─────────────────────────────
//
// The DESKTOP build writes a WHOLE-STORE backup into a cloud-synced folder —
// EVERY resume in one file (`server/backup.ts`, `resumestudio-store/v1`). This is
// a DIFFERENT envelope from the per-resume `resumestudio/v1` above: its top level
// is `resumes[]`, each entry `{ id, name, …, data: ResumeStore }` (the data is a
// FLAT ResumeStore, not the profile/sections grouping).
//
// Users reach for this file to "restore a resume" just as readily as the
// per-resume export — it's the biggest, most obvious backup in their sync folder.
// If the import path doesn't recognise it, its `$schema` ("resumestudio-store/…")
// slips past `isBackupFormat` (which matches only "resumestudio/…") and it falls
// through to the CVpartner importer, which maps none of these fields and yields
// an EMPTY resume. Reading it here is the fix.

/** One resume entry inside a store backup (client-side mirror of the server shape). */
interface StoreBackupEntry {
  id?: unknown
  name?: unknown
  data?: unknown
}

/** The whole-store backup envelope, as far as the client needs to read it. */
export interface StoreBackupFileV1 {
  $schema: string
  format_version: number
  resumes: StoreBackupEntry[]
  /** Instance-level canonical registry (cross-resume shared skills/roles). Optional. */
  registry?: RegistryEntry[]
}

/**
 * Lenient router (mirrors `isBackupFormat`): is this parsed JSON a whole-store
 * backup? Keyed on the `resumestudio-store/` schema prefix + a `resumes` array,
 * so it can't be confused with the per-resume `resumestudio/` backup.
 */
export function isStoreBackupFormat(json: unknown): json is StoreBackupFileV1 {
  if (!json || typeof json !== 'object') return false
  const obj = json as Record<string, unknown>
  if (typeof obj['$schema'] !== 'string') return false
  if (!String(obj['$schema']).startsWith('resumestudio-store/')) return false
  if (typeof obj['format_version'] !== 'number') return false
  return Array.isArray(obj['resumes'])
}

/** Top-level collections a ResumeStore must carry as arrays for the app to iterate them. */
const STORE_ARRAY_KEYS = [
  'skills', 'roles', 'industries', 'skill_categories',
  'key_qualifications', 'key_competencies', 'recommendations', 'projects',
  'work_experiences', 'educations', 'courses', 'certifications',
  'spoken_languages', 'positions', 'presentations', 'honor_awards',
  'publications', 'references', 'views', 'cover_letters',
] as const

/**
 * Guarantee a raw/partial/older `ResumeStore` (as carried inside a store-backup
 * entry) has every top-level collection present — WITHOUT touching its
 * `shape_version` stamp, so `migrateStore` still dispatches correctly at load for
 * an older or unstamped backup. This is the defensive fill (mirroring the `?? []`
 * defaults in `importFromBackup`) that stops a previous-version backup from
 * restoring empty or crashing a migration that iterates an absent array. A field
 * present but of the wrong type is coerced to an empty array rather than trusted.
 */
export function normalizeStoreShape(data: Record<string, unknown>): ResumeStore {
  const merged = { ...emptyStore(), ...data } as ResumeStore
  const bag = merged as unknown as Record<string, unknown>
  for (const key of STORE_ARRAY_KEYS) {
    if (!Array.isArray(bag[key])) bag[key] = []
  }
  // Preserve the backup's OWN shape stamp — including `undefined` for a
  // pre-versioning backup — so `migrateStore` runs on old data. `emptyStore()`
  // stamps CURRENT, which would wrongly mark unstamped data as already current.
  merged.shape_version = data['shape_version'] as number | undefined
  return merged
}

/**
 * Does this parsed JSON look like a bare/legacy `ResumeStore` — the internal
 * store shape WITHOUT the `resumestudio/` backup envelope? A self-export from an
 * older build (or a hand-extracted store) can arrive this way. Recognising it
 * lets the import dispatcher default such files to the Resume Studio path instead
 * of misrouting them. Requires the `resume` slot PLUS a couple of the store's own
 * top-level collections together, so a random object (or a CVpartner export,
 * which has no `resume` wrapper) doesn't masquerade as one.
 */
export function looksLikeResumeStore(json: unknown): boolean {
  if (!isObj(json)) return false
  if (!('resume' in json)) return false
  const collections = ['projects', 'skills', 'work_experiences', 'educations', 'views']
  const hits = collections.filter((k) => Array.isArray(json[k])).length
  return hits >= 2
}

/** One restored resume from a store backup: its saved name + a shape-normalized store. */
export interface RestoredResume {
  /** The resume's saved name, or '' if the backup entry had none (caller derives one). */
  name: string
  store: ResumeStore
}

/**
 * Read every resume out of a whole-store backup. Throws
 * `UnsupportedBackupVersionError` for a newer envelope and `InvalidBackupError`
 * if it isn't a store backup or carries no usable resume entry. Each entry's flat
 * `data` is normalized (`normalizeStoreShape`) so an older/partial backup still
 * restores fully; `migrateStore` finishes the job at load. A single malformed
 * entry is skipped, not fatal — as many resumes as possible are recovered.
 */
export function resumesFromStoreBackup(json: unknown): RestoredResume[] {
  if (!isStoreBackupFormat(json)) {
    throw new InvalidBackupError([{ path: '(root)', reason: 'not a Resume Studio store backup' }])
  }
  if (json.format_version !== 1) {
    throw new UnsupportedBackupVersionError(json.format_version)
  }
  const out: RestoredResume[] = []
  json.resumes.forEach((entry) => {
    if (!isObj(entry) || !isObj(entry.data)) return // skip a malformed row, keep the rest
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : ''
    out.push({ name, store: normalizeStoreShape(entry.data) })
  })
  if (!out.length) {
    throw new InvalidBackupError([{ path: 'resumes', reason: 'contains no readable resume entries' }])
  }
  return out
}

// ─── Download helper ──────────────────────────────────────────────────────────

/**
 * Trigger a browser download of the backup JSON. Fetches the instance registry
 * first so the backup embeds snapshots of the canonical entries this resume
 * links to (portable cross-instance restore). Best-effort: a registry failure
 * just omits the embedding — the backup still downloads.
 */
export async function downloadBackup(store: ResumeStore): Promise<void> {
  const canonical = await api.listRegistry().catch(() => undefined)
  const backup = exportToBackup(store, canonical)
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
