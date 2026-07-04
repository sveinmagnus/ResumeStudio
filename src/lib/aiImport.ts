/**
 * Resume Studio — AI-assisted import (v1)
 *
 * A deliberately *simpler* exchange format than the full backup (`backup.ts`).
 * The user feeds an LLM of their choice a PDF/Word CV plus the template
 * (`public/ai-import-template.md`), the LLM returns JSON in THIS shape, and we
 * map it into a real `ResumeStore`.
 *
 * Why a separate, smaller schema instead of asking for `BackupV1` directly:
 *   - no ids / sort_order / view configs for the model to hallucinate
 *   - skills & roles are plain *names* — the importer dedupes them into the
 *     shared registries and assigns ids (same discipline as importer.ts)
 *   - localized fields are plain strings — we wrap them as
 *     `{ [primary_locale]: value }`
 *
 * Two entry points:
 *   - `validateAIImport(json)` — structural validation, throws
 *     `InvalidAIImportError` with field-pathed issues (rendered by the modal)
 *   - `importFromAIDraft(parsed)` — total mapper, assumes validated input,
 *     never throws; skips empty/garbage bits rather than failing
 *
 * SECURITY: every value coming in is untrusted. We only ever wrap strings into
 * `LocalizedString` / scalar fields — we never build HTML here. The render
 * boundary (viewFilter/richText) still escapes everything. Do not interpolate
 * these values into markup anywhere.
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  ResumeStore, Resume, Skill, Role, KeyQualification, KeyCompetency,
  Project, ProjectRole, ProjectSkill, WorkExperience, Education,
  Course, Certification, SpokenLanguage, SkillCategory,
  Recommendation, LocalizedString, YearMonth,
} from '../types'
import { LOCALE_LABELS } from './locales'

// ─── Format marker ──────────────────────────────────────────────────────────

export const AI_IMPORT_SCHEMA = 'resumestudio-ai/v1'

// ─── Schema (the shape the LLM must produce) ─────────────────────────────────

/** A month-precision date. `month` 1–12, or null/omitted when only the year is known. */
export interface AIDate {
  year: number
  month?: number | null
}

export interface AIProfile {
  full_name?: string
  title?: string
  email?: string
  phone?: string
  nationality?: string
  place_of_residence?: string
  linkedin_url?: string
  website_url?: string
  /** Short professional summary — becomes a leading Key Qualification. */
  summary?: string
}

export interface AIKeyQualification {
  label?: string
  summary?: string
  bullets?: string[]
}

export interface AIWorkExperience {
  employer?: string
  role_title?: string
  description?: string
  start?: AIDate | null
  end?: AIDate | null
}

export interface AIProject {
  customer?: string
  industry?: string
  description?: string
  /** Free-text employer name; if it matches a work experience's employer, the project links to it. */
  employer?: string
  roles?: string[]
  skills?: string[]
  start?: AIDate | null
  end?: AIDate | null
}

export interface AIEducation {
  school?: string
  degree?: string
  description?: string
  start?: AIDate | null
  end?: AIDate | null
}

export interface AICourse {
  name?: string
  program?: string
  completed?: AIDate | null
}

export interface AICertification {
  name?: string
  organiser?: string
  issued?: AIDate | null
  expires?: AIDate | null
}

export interface AISpokenLanguage {
  name?: string
  level?: string
}

export interface AITechnologyCategory {
  name?: string
  skills?: string[]
}

export interface AIRecommendation {
  recommender_name?: string
  recommender_title?: string
  recommender_company?: string
  relationship?: string
  text?: string
}

export interface AIImportV1 {
  $schema: string
  primary_locale?: string
  profile?: AIProfile
  key_qualifications?: AIKeyQualification[]
  work_experiences?: AIWorkExperience[]
  projects?: AIProject[]
  educations?: AIEducation[]
  courses?: AICourse[]
  certifications?: AICertification[]
  spoken_languages?: AISpokenLanguage[]
  technology_categories?: AITechnologyCategory[]
  recommendations?: AIRecommendation[]
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Lenient detector: does this parsed JSON look like an AI-import file?
 * Matches any `$schema` starting with `resumestudio-ai/` so future versions
 * still route here (and then `validateAIImport` decides if it's readable).
 */
export function isAIImportFormat(json: unknown): json is AIImportV1 {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false
  const schema = (json as Record<string, unknown>)['$schema']
  return typeof schema === 'string' && schema.startsWith('resumestudio-ai/')
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface AIImportIssue {
  /** Dotted path to the offending field, e.g. `projects[0].start.year`. */
  path: string
  reason: string
}

/**
 * Thrown when an AI-import file is structurally unusable. Carries every issue
 * found (not just the first) so the modal can list them and the user can fix
 * them in one pass or re-prompt their LLM with the full list.
 */
export class InvalidAIImportError extends Error {
  constructor(public issues: AIImportIssue[]) {
    super(
      issues.length === 1
        ? `${issues[0].path}: ${issues[0].reason}`
        : `Found ${issues.length} problems in the AI import file.`,
    )
    this.name = 'InvalidAIImportError'
  }
}

/** Sections that must be arrays of objects when present. */
const ARRAY_SECTIONS = [
  'key_qualifications', 'work_experiences', 'projects', 'educations',
  'courses', 'certifications', 'spoken_languages', 'technology_categories',
  'recommendations',
] as const

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** A value usable as a scalar text field (string/number/boolean/null/undefined). Objects/arrays are not. */
function isScalarish(v: unknown): boolean {
  return v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/**
 * Validate a date-ish value. Accepts: null/undefined, a bare year
 * (number or numeric string), or an object `{ year, month? }`. Pushes issues
 * for anything else or out-of-range values.
 */
function checkDate(val: unknown, path: string, issues: AIImportIssue[]): void {
  if (val == null) return
  if (typeof val === 'number' || typeof val === 'string') {
    const y = Number(val)
    if (!Number.isFinite(y) || y < 1000 || y > 3000) {
      issues.push({ path, reason: `expected a 4-digit year, got ${JSON.stringify(val)}` })
    }
    return
  }
  if (isPlainObject(val)) {
    const y = Number(val['year'])
    if (!Number.isFinite(y) || y < 1000 || y > 3000) {
      issues.push({ path: `${path}.year`, reason: `expected a 4-digit year, got ${JSON.stringify(val['year'])}` })
    }
    const m = val['month']
    if (m != null) {
      const mn = Number(m)
      if (!Number.isInteger(mn) || mn < 1 || mn > 12) {
        issues.push({ path: `${path}.month`, reason: `expected a month 1–12 or null, got ${JSON.stringify(m)}` })
      }
    }
    return
  }
  issues.push({ path, reason: 'expected a year number or a { year, month } object' })
}

/**
 * Structurally validate parsed JSON as an AI import. Throws
 * `InvalidAIImportError` (with every issue) when unusable; returns the typed
 * object otherwise. Lenient on scalar coercion — only objects/arrays in the
 * wrong place and malformed dates are hard errors.
 */
export function validateAIImport(json: unknown): AIImportV1 {
  const issues: AIImportIssue[] = []

  if (!isPlainObject(json)) {
    throw new InvalidAIImportError([{ path: '(root)', reason: 'expected a JSON object' }])
  }

  const schema = json['$schema']
  if (typeof schema !== 'string' || !schema.startsWith('resumestudio-ai/')) {
    issues.push({
      path: '$schema',
      reason: `expected "${AI_IMPORT_SCHEMA}", got ${JSON.stringify(schema)}`,
    })
  }

  if ('profile' in json && json['profile'] != null && !isPlainObject(json['profile'])) {
    issues.push({ path: 'profile', reason: 'expected an object' })
  }

  for (const key of ARRAY_SECTIONS) {
    if (!(key in json) || json[key] == null) continue
    const arr = json[key]
    if (!Array.isArray(arr)) {
      issues.push({ path: key, reason: 'expected an array' })
      continue
    }
    arr.forEach((item, i) => {
      const base = `${key}[${i}]`
      if (!isPlainObject(item)) {
        issues.push({ path: base, reason: 'expected an object' })
        return
      }
      // Date fields per section.
      if (key === 'work_experiences' || key === 'projects' || key === 'educations') {
        checkDate(item['start'], `${base}.start`, issues)
        checkDate(item['end'], `${base}.end`, issues)
      }
      if (key === 'courses') checkDate(item['completed'], `${base}.completed`, issues)
      if (key === 'certifications') {
        checkDate(item['issued'], `${base}.issued`, issues)
        checkDate(item['expires'], `${base}.expires`, issues)
      }
      // Name/skill list fields must be arrays of scalars when present.
      for (const listField of ['bullets', 'roles', 'skills'] as const) {
        const lv = item[listField]
        if (lv == null) continue
        if (!Array.isArray(lv)) {
          issues.push({ path: `${base}.${listField}`, reason: 'expected an array of strings' })
        } else {
          lv.forEach((entry, j) => {
            if (!isScalarish(entry)) {
              issues.push({ path: `${base}.${listField}[${j}]`, reason: 'expected a string' })
            }
          })
        }
      }
    })
  }

  if (issues.length) throw new InvalidAIImportError(issues)
  return json as unknown as AIImportV1
}

// ─── Locale normalisation ─────────────────────────────────────────────────────

/** Map common service/long locale codes onto the app's short codes. */
const LOCALE_ALIASES: Record<string, string> = {
  nb: 'no', nn: 'no', nob: 'no', nor: 'no',
  sv: 'se', swe: 'se',
  da: 'dk', dan: 'dk',
  int: 'en', eng: 'en', 'en-gb': 'en', 'en-us': 'en',
}

/** Resolve a raw locale code to a supported short code, defaulting to `en`. */
export function normalizeImportLocale(raw: unknown): string {
  if (typeof raw !== 'string') return 'en'
  const lower = raw.trim().toLowerCase()
  if (!lower) return 'en'
  if (LOCALE_ALIASES[lower]) return LOCALE_ALIASES[lower]
  const short = lower.slice(0, 2)
  if (LOCALE_ALIASES[short]) return LOCALE_ALIASES[short]
  if (short in LOCALE_LABELS) return short
  return 'en'
}

// ─── Mapping → ResumeStore ────────────────────────────────────────────────────

/** Coerce an incoming scalar to a trimmed string (numbers/booleans stringified). */
function str(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function strOrNull(v: unknown): string | null {
  const s = str(v)
  return s || null
}

/** Coerce a validated date-ish value to a `YearMonth | null`. */
function toYearMonth(val: unknown): YearMonth | null {
  if (val == null) return null
  if (typeof val === 'number' || typeof val === 'string') {
    const y = Number(val)
    return Number.isFinite(y) ? { year: Math.trunc(y), month: null } : null
  }
  if (isPlainObject(val)) {
    const y = Number(val['year'])
    if (!Number.isFinite(y)) return null
    const m = val['month'] == null ? null : Number(val['month'])
    return { year: Math.trunc(y), month: m && Number.isInteger(m) ? m : null }
  }
  return null
}

const norm = (s: string): string => s.trim().toLowerCase()

/**
 * Map a validated AI-import object into a fresh `ResumeStore`.
 *
 * Total function: it never throws — empty or unusable sub-values are simply
 * skipped. (Run `validateAIImport` first if you want to surface problems.)
 */
export function importFromAIDraft(input: AIImportV1): ResumeStore {
  const resumeId = uuidv4()
  const now = new Date().toISOString()
  const loc = normalizeImportLocale(input.primary_locale)

  /** Wrap a scalar as a single-locale LocalizedString (empty object if blank). */
  const L = (v: unknown): LocalizedString => {
    const s = str(v)
    return s ? { [loc]: s } : {}
  }

  // ── Shared registries: intern skills/roles by normalized name ──────────────
  const skills: Skill[] = []
  const skillByName = new Map<string, string>() // normalized name → skill id
  const internSkill = (rawName: string): string => {
    const name = rawName.trim()
    const key = norm(name)
    const existing = skillByName.get(key)
    if (existing) return existing
    const sid = uuidv4()
    skillByName.set(key, sid)
    skills.push({
      id: sid,
      resume_id: resumeId,
      name: { [loc]: name },
      category_id: null,
      total_duration_in_years: 0,
      proficiency: 0,
      is_highlighted: false,
      created_at: now,
    })
    return sid
  }

  const roles: Role[] = []
  const roleByName = new Map<string, string>()
  const internRole = (rawName: string): string => {
    const name = rawName.trim()
    const key = norm(name)
    const existing = roleByName.get(key)
    if (existing) return existing
    const rid = uuidv4()
    roleByName.set(key, rid)
    roles.push({
      id: rid,
      resume_id: resumeId,
      name: { [loc]: name },
      years_of_experience: 0,
      years_of_experience_offset: 0,
      starred: false,
      sort_order: roles.length,
      disabled: false,
    })
    return rid
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  const p = input.profile ?? {}
  const resume: Resume = {
    id: resumeId,
    full_name: str(p.full_name),
    email: str(p.email),
    phone: strOrNull(p.phone),
    title: L(p.title),
    nationality: L(p.nationality),
    place_of_residence: L(p.place_of_residence),
    date_of_birth: null,
    twitter: null,
    linkedin_url: strOrNull(p.linkedin_url),
    website_url: strOrNull(p.website_url),
    profile_image_url: null,
    profile_photo: null,
    company_logo: null,
    company_name: null,
    default_locale: loc,
    supported_locales: [loc],
    created_at: now,
    updated_at: now,
  }

  // ── Key qualifications + competencies ─────────────────────────────────────
  // Like the CVpartner import, AI-draft bullets land in the standalone
  // key_competencies array — the per-KQ key_points field is empty everywhere.
  const key_qualifications: KeyQualification[] = []
  const key_competencies: KeyCompetency[] = []
  let kcOrder = 0
  // Leading summary (from profile.summary) → its own KQ. Label left blank so we
  // don't inject an English word into a non-English resume; the user edits it.
  if (str(p.summary)) {
    key_qualifications.push({
      id: uuidv4(),
      resume_id: resumeId,
      label: {},
      tag_line: {},
      summary: L(p.summary),
      key_points: [],
      skill_tags: [],
      sort_order: key_qualifications.length,
      starred: false,
      disabled: false,
      internal_notes: null,
    })
  }
  for (const kq of input.key_qualifications ?? []) {
    const bullets = (kq.bullets ?? []).map(str).filter(Boolean)
    if (!str(kq.label) && !str(kq.summary) && bullets.length === 0) continue
    for (const b of bullets) {
      key_competencies.push({
        id: uuidv4(),
        resume_id: resumeId,
        title: { [loc]: b },
        description: {},
        sort_order: kcOrder++,
        starred: false,
        disabled: false,
      })
    }
    key_qualifications.push({
      id: uuidv4(),
      resume_id: resumeId,
      label: L(kq.label),
      tag_line: {},
      summary: L(kq.summary),
      key_points: [],
      skill_tags: [],
      sort_order: key_qualifications.length,
      starred: false,
      disabled: false,
      internal_notes: null,
    })
  }

  // ── Work experiences (built first so projects can link by employer) ────────
  const work_experiences: WorkExperience[] = []
  const workByEmployer = new Map<string, string>() // normalized employer → work id
  ;(input.work_experiences ?? []).forEach((w, i) => {
    const wid = uuidv4()
    const employer = str(w.employer)
    if (employer && !workByEmployer.has(norm(employer))) {
      workByEmployer.set(norm(employer), wid)
    }
    work_experiences.push({
      id: wid,
      resume_id: resumeId,
      employer: L(w.employer),
      role_title: L(w.role_title),
      description: L(w.description),
      long_description: {},
      employment_type: null,
      company_size: null,
      company_url: null,
      start: toYearMonth(w.start),
      end: toYearMonth(w.end),
      role_id: null,
      skill_tags: [],
      sort_order: i,
      starred: false,
      disabled: false,
      internal_notes: null,
    })
  })

  // ── Projects ───────────────────────────────────────────────────────────────
  const projects: Project[] = []
  ;(input.projects ?? []).forEach((pr, i) => {
    const projectRoles: ProjectRole[] = (pr.roles ?? [])
      .map(str)
      .filter(Boolean)
      .map((name, j) => ({
        id: uuidv4(),
        role_id: internRole(name),
        name: { [loc]: name },
        sort_order: j,
        disabled: false,
      }))
    const projectSkills: ProjectSkill[] = (pr.skills ?? [])
      .map(str)
      .filter(Boolean)
      .map((name, j) => ({
        id: uuidv4(),
        skill_id: internSkill(name),
        name: { [loc]: name },
        duration_in_years: 0,
        offset_in_years: 0,
        total_duration_in_years: 0,
        sort_order: j,
      }))
    const employer = str(pr.employer)
    const work_experience_id = employer ? workByEmployer.get(norm(employer)) ?? null : null
    const project: Project = {
      id: uuidv4(),
      resume_id: resumeId,
      work_experience_id,
      customer: L(pr.customer),
      customer_anonymized: {},
      use_anonymized: false,
      industries: [],
      description: L(pr.description),
      long_description: {},
      highlights: [],
      roles: projectRoles,
      skills: projectSkills,
      start: toYearMonth(pr.start),
      end: toYearMonth(pr.end),
      percent_allocated: null,
      team_size: null,
      location_country_code: null,
      external_url: null,
      skill_tags: [],
      sort_order: i,
      starred: false,
      disabled: false,
      internal_notes: null,
    }
    // Free-text industry rides along as a legacy field; migrateStore interns it
    // into the registry + `industries[]` on load (shape v4).
    ;(project as unknown as { industry: LocalizedString }).industry = L(pr.industry)
    projects.push(project)
  })

  // ── Educations ───────────────────────────────────────────────────────────
  const educations: Education[] = (input.educations ?? []).map((e, i) => ({
    id: uuidv4(),
    resume_id: resumeId,
    school: L(e.school),
    degree: L(e.degree),
    description: L(e.description),
    grade: null,
    exchange: false,
    start: toYearMonth(e.start),
    end: toYearMonth(e.end),
    skill_tags: [],
    sort_order: i,
    starred: false,
    disabled: false,
  }))

  // ── Courses ───────────────────────────────────────────────────────────────
  const courses: Course[] = (input.courses ?? []).map((c, i) => ({
    id: uuidv4(),
    resume_id: resumeId,
    name: L(c.name),
    program: L(c.program),
    description: {},
    completed: toYearMonth(c.completed),
    skill_ids: [],
    skill_tags: [],
    sort_order: i,
    starred: false,
    disabled: false,
  }))

  // ── Certifications ─────────────────────────────────────────────────────────
  const certifications: Certification[] = (input.certifications ?? []).map((c, i) => ({
    id: uuidv4(),
    resume_id: resumeId,
    name: L(c.name),
    organiser: L(c.organiser),
    description: {},
    issued: toYearMonth(c.issued),
    expires: toYearMonth(c.expires),
    credential_url: null,
    skill_ids: [],
    skill_tags: [],
    sort_order: i,
    starred: false,
    disabled: false,
  }))

  // ── Spoken languages ───────────────────────────────────────────────────────
  const spoken_languages: SpokenLanguage[] = (input.spoken_languages ?? []).map((l, i) => ({
    id: uuidv4(),
    resume_id: resumeId,
    name: L(l.name),
    level: L(l.level),
    sort_order: i,
    disabled: false,
  }))

  // ── Skill categories (from technology_categories groups — skills here also
  // intern into the registry AND are marked highlighted, i.e. shown in the
  // Skills Showcase; see roadmap: showcase unification) ──────────────────────
  const skill_categories: SkillCategory[] = (input.technology_categories ?? []).map((cat, i) => {
    const catId = uuidv4()
    for (const rawName of cat.skills ?? []) {
      const name = str(rawName)
      if (!name) continue
      const sid = internSkill(name)
      const sk = skills.find((s) => s.id === sid)
      if (sk) { sk.is_highlighted = true; if (!sk.category_id) sk.category_id = catId }
    }
    return { id: catId, resume_id: resumeId, name: L(cat.name), sort_order: i }
  })

  // ── Recommendations ─────────────────────────────────────────────────────
  const recommendations: Recommendation[] = (input.recommendations ?? []).map((r, i) => ({
    id: uuidv4(),
    resume_id: resumeId,
    recommender_name: str(r.recommender_name),
    recommender_title: strOrNull(r.recommender_title),
    recommender_company: strOrNull(r.recommender_company),
    relationship: L(r.relationship),
    text: L(r.text),
    date: null,
    source: null,
    contact_url: null,
    sort_order: i,
    starred: false,
    disabled: false,
  }))

  return {
    resume,
    skills,
    roles,
    industries: [],
    key_qualifications,
    key_competencies,
    recommendations,
    projects,
    work_experiences,
    educations,
    courses,
    certifications,
    spoken_languages,
    skill_categories,
    positions: [],
    presentations: [],
    honor_awards: [],
    publications: [],
    references: [],
    views: [],
  }
}

// ─── Preview summary ──────────────────────────────────────────────────────────

export interface ImportSummaryLine {
  label: string
  count: number
}

export interface ImportSummary {
  full_name: string
  primary_locale: string
  lines: ImportSummaryLine[]
  /** Total count across all sections — used to flag a suspiciously empty import. */
  total: number
}

/**
 * Build a human-readable summary of what an imported store contains, for the
 * "confirm before creating" preview. Only non-empty sections are listed.
 */
export function summarizeImportedStore(store: ResumeStore): ImportSummary {
  const candidates: ImportSummaryLine[] = [
    { label: 'projects', count: store.projects.length },
    { label: 'work experiences', count: store.work_experiences.length },
    { label: 'educations', count: store.educations.length },
    { label: 'courses', count: store.courses.length },
    { label: 'certifications', count: store.certifications.length },
    { label: 'skills', count: store.skills.length },
    { label: 'roles', count: store.roles.length },
    { label: 'key qualifications', count: store.key_qualifications.length },
    { label: 'key competencies', count: store.key_competencies.length },
    { label: 'spoken languages', count: store.spoken_languages.length },
    { label: 'skill categories', count: (store.skill_categories ?? []).length },
    { label: 'recommendations', count: store.recommendations.length },
  ]
  const lines = candidates.filter((l) => l.count > 0)
  const total = lines.reduce((n, l) => n + l.count, 0)
  return {
    full_name: store.resume?.full_name ?? '',
    primary_locale: store.resume?.default_locale ?? 'en',
    lines,
    total,
  }
}
