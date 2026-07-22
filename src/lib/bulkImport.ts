/**
 * Resume Studio — per-section bulk import (v1)
 *
 * The third import format, and the narrowest one. Where `importer.ts` ingests a
 * whole CVpartner export and `aiImport.ts` builds a whole resume from scratch,
 * this ADDS ITEMS TO ONE SECTION of the resume already open. The user pastes a
 * pile of source material into the LLM of their choice along with the
 * instructions this module generates, and pastes the JSON back.
 *
 * ONE SPEC PER SECTION drives everything (same discipline as
 * `sectionCatalog.ts`): the generated LLM instructions, the validator, the
 * mapper, the preview label and the duplicate key all read the same
 * `BulkSectionSpec`. Adding a section means adding a spec — nothing else.
 *
 * Design notes:
 *   - `section` is a discriminator carried IN the file and checked against the
 *     section the user is standing in, so a Projects export can't be pasted
 *     into Courses.
 *   - Every text field takes `string | { locale: string }` — the resume is
 *     multi-language, so an LLM reading a bilingual source can fill both
 *     columns at once. A plain string lands in the resume's primary locale.
 *   - Skills/roles are plain NAMES; they intern into the resume's EXISTING
 *     registries (deduped case-insensitively) so a bulk add doesn't duplicate
 *     the registry. Same discipline as importer.ts / aiImport.ts.
 *   - Mappers are total: unusable sub-values are skipped, never thrown on.
 *     Run `validateBulkImport` first to surface problems to the user.
 *
 * SECURITY: every value here is untrusted. We only ever wrap strings into
 * `LocalizedString` / scalar fields — this module never builds HTML. The render
 * boundary (viewFilter/richText) escapes everything. Do not interpolate these
 * values into markup anywhere.
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  ResumeStore, LocalizedString, YearMonth, Skill, Role,
  Project, ProjectRole, ProjectSkill, WorkExperience, Position, Education,
  Course, Certification, Presentation, Publication, HonorAward,
  Recommendation, Reference, KeyQualification, KeyCompetency,
} from '../types'
import { LOCALE_LABELS } from './locales'

// ─── Format marker ──────────────────────────────────────────────────────────

export const BULK_IMPORT_SCHEMA = 'resumestudio-bulk/v1'

/** The sections that accept a bulk add. */
export type BulkSectionKey =
  | 'projects' | 'work_experiences' | 'positions' | 'educations' | 'courses'
  | 'certifications' | 'presentations' | 'publications' | 'honor_awards'
  | 'recommendations' | 'references' | 'key_qualifications' | 'key_competencies'

/**
 * A field as the LLM should produce it. `kind` drives both the generated
 * instructions and the validator.
 *
 *  - text   — localizable: a plain string or a `{ en: …, no: … }` object
 *  - rich   — same, but the value is a description that may run to a paragraph
 *  - plain  — a non-localized string (names, urls, emails: no translation)
 *  - date   — `{ year, month? }`, a bare year, or null
 *  - list   — an array of plain strings (skills, roles, co-authors)
 *  - enum   — one of `values`
 *  - bool   — true/false
 *  - number — a number
 */
type FieldKind = 'text' | 'rich' | 'plain' | 'date' | 'list' | 'enum' | 'bool' | 'number'

export interface BulkField {
  name: string
  kind: FieldKind
  /** One-line explanation shown to the LLM. */
  doc: string
  /** Allowed values for `kind: 'enum'`. */
  values?: readonly string[]
}

/** What a mapper needs from the resume it's being added to. */
export interface BulkContext {
  resumeId: string
  /** Locale a plain string lands in. */
  defaultLocale: string
  /** Find-or-create a skill in the existing registry; returns its id. */
  internSkill: (name: string) => string
  /** Find-or-create a role in the existing registry; returns its id. */
  internRole: (name: string) => string
}

export interface BulkSectionSpec {
  key: BulkSectionKey
  /** Human label, e.g. "Projects". */
  label: string
  /** What belongs in this section — leads the generated instructions. */
  blurb: string
  fields: readonly BulkField[]
  /** Map one validated raw item onto the real entity. Total: never throws. */
  make: (raw: Record<string, unknown>, ctx: BulkContext) => Record<string, unknown>
  /** Label for the preview row. */
  title: (item: Record<string, unknown>, locale: string) => string
  /** Secondary line for the preview row (may be empty). */
  subtitle: (item: Record<string, unknown>, locale: string) => string
  /**
   * Identities used to flag a likely duplicate of an item already in the
   * section — one key per locale of the item's name, since matching in ANY
   * language means the same item. Empty array = never flag (nothing
   * distinctive to compare).
   */
  dupKeys: (item: Record<string, unknown>) => string[]
}

// ─── Coercion helpers ────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

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

/**
 * Coerce a localizable input to a `LocalizedString`.
 *
 * A plain string lands in `defaultLocale`. An object is taken as
 * locale→text and kept as-is (bar empty values), which is what lets an LLM
 * fill both language columns from a bilingual source in one pass.
 */
export function toLocalized(v: unknown, defaultLocale: string): LocalizedString {
  if (isPlainObject(v)) {
    const out: LocalizedString = {}
    for (const [locale, raw] of Object.entries(v)) {
      const text = str(raw)
      if (text) out[locale] = text
    }
    return out
  }
  const s = str(v)
  return s ? { [defaultLocale]: s } : {}
}

/** Coerce a date-ish value (year number, `{year, month}`, or null) to `YearMonth | null`. */
export function toYearMonth(val: unknown): YearMonth | null {
  if (val == null) return null
  if (typeof val === 'number' || typeof val === 'string') {
    const y = Number(val)
    return Number.isFinite(y) ? { year: Math.trunc(y), month: null } : null
  }
  if (isPlainObject(val)) {
    const y = Number(val['year'])
    if (!Number.isFinite(y)) return null
    const m = val['month'] == null ? null : Number(val['month'])
    return { year: Math.trunc(y), month: m && Number.isInteger(m) && m >= 1 && m <= 12 ? m : null }
  }
  return null
}

/** Coerce a list-ish value to trimmed non-empty strings. */
function toNames(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map(str).filter(Boolean)
}

const norm = (s: string): string => s.trim().toLowerCase()

/** First non-empty value of a LocalizedString, preferring `locale`. */
function pick(ls: unknown, locale: string): string {
  if (!isPlainObject(ls)) return ''
  const want = str(ls[locale])
  if (want) return want
  for (const v of Object.values(ls)) {
    const t = str(v)
    if (t) return t
  }
  return ''
}

/**
 * Duplicate keys for a localized name + an optional date — ONE PER LOCALE.
 *
 * Any single key matching means "probably the same item": an incoming entry
 * carrying both `no` and `en` must match an existing entry that only ever had
 * `no`, which a single representative name (say, the alphabetically first)
 * would miss — precisely the bilingual case this feature is for.
 */
function keysOf(ls: unknown, date?: unknown): string[] {
  const names = isPlainObject(ls)
    ? [...new Set(Object.values(ls).map(str).filter(Boolean).map(norm))]
    : [norm(str(ls))].filter(Boolean)
  if (!names.length) return []
  const d = date as YearMonth | null | undefined
  const suffix = d ? `|${d.year}-${d.month ?? ''}` : ''
  return names.map((n) => `${n}${suffix}`)
}

// ─── Field groups shared across specs ────────────────────────────────────────

const SHORT_DESC: BulkField = {
  name: 'short_description', kind: 'text',
  doc: 'One concise line for summary mode. Omit if the source has nothing to condense.',
}

const EMPLOYMENT_TYPES = ['permanent', 'contract', 'freelance', 'part_time', 'internship'] as const
const PUBLICATION_TYPES = ['article', 'research', 'whitepaper', 'book', 'book_chapter', 'blog_post', 'report', 'thesis'] as const

// ─── The specs ───────────────────────────────────────────────────────────────

export const BULK_SPECS: readonly BulkSectionSpec[] = [
  {
    key: 'projects',
    label: 'Projects',
    blurb: 'Client or internal projects/assignments — one entry per engagement.',
    fields: [
      { name: 'customer', kind: 'text', doc: 'Client or project name.' },
      { name: 'description', kind: 'rich', doc: 'What the project was and what you did. Plain prose; no markup.' },
      SHORT_DESC,
      { name: 'industry', kind: 'text', doc: "The client's industry, e.g. Banking. Interned into the shared Industry registry." },
      { name: 'employer', kind: 'plain', doc: 'Your employer during the project. Links to an existing Employment entry when the name matches.' },
      { name: 'roles', kind: 'list', doc: 'Your role names, e.g. ["Tech lead", "Architect"].' },
      { name: 'skills', kind: 'list', doc: 'Technologies/methods used, e.g. ["Kubernetes", "Go"]. One skill per entry, no version numbers.' },
      { name: 'start', kind: 'date', doc: 'When it started.' },
      { name: 'end', kind: 'date', doc: 'When it ended; null if ongoing.' },
    ],
    make: (raw, ctx) => {
      const project: Project = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        work_experience_id: null, // resolved against employers by the caller
        customer: toLocalized(raw['customer'], ctx.defaultLocale),
        customer_anonymized: {},
        use_anonymized: false,
        industries: [],
        description: toLocalized(raw['description'], ctx.defaultLocale),
        long_description: {},
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        highlights: [],
        roles: toNames(raw['roles']).map((name, j): ProjectRole => ({
          id: uuidv4(), role_id: ctx.internRole(name),
          name: { [ctx.defaultLocale]: name }, sort_order: j, disabled: false,
        })),
        skills: toNames(raw['skills']).map((name, j): ProjectSkill => ({
          id: uuidv4(), skill_id: ctx.internSkill(name),
          name: { [ctx.defaultLocale]: name },
          duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: j,
        })),
        start: toYearMonth(raw['start']),
        end: toYearMonth(raw['end']),
        percent_allocated: null,
        team_size: null,
        location_country_code: null,
        external_url: null,
        skill_tags: [],
        sort_order: 0,
        starred: false,
        disabled: false,
        internal_notes: null,
      }
      // Free-text industry rides along as the legacy field; migrateStore interns
      // it into the registry + industries[] on load (shape v4), exactly as the
      // AI import does.
      const industry = toLocalized(raw['industry'], ctx.defaultLocale)
      if (Object.keys(industry).length) {
        ;(project as unknown as { industry: LocalizedString }).industry = industry
      }
      // Carried for employer linking; stripped before the item lands.
      ;(project as unknown as { _employer?: string })._employer = str(raw['employer'])
      return project as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['customer'], l),
    subtitle: (i, l) => pick(i['description'], l),
    dupKeys: (i) => keysOf(i['customer'], i['start']),
  },
  {
    key: 'work_experiences',
    label: 'Employment',
    blurb: 'Jobs held — one entry per employer/position.',
    fields: [
      { name: 'employer', kind: 'text', doc: 'Company name.' },
      { name: 'role_title', kind: 'text', doc: 'Your job title there.' },
      { name: 'description', kind: 'rich', doc: 'What the job involved.' },
      SHORT_DESC,
      { name: 'employment_type', kind: 'enum', values: EMPLOYMENT_TYPES, doc: 'Type of employment.' },
      { name: 'company_url', kind: 'plain', doc: "The company's website." },
      { name: 'start', kind: 'date', doc: 'Start date.' },
      { name: 'end', kind: 'date', doc: 'End date; null if current.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const type = str(raw['employment_type']).toLowerCase()
      const work: WorkExperience = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        employer: toLocalized(raw['employer'], ctx.defaultLocale),
        role_title: toLocalized(raw['role_title'], ctx.defaultLocale),
        description: toLocalized(raw['description'], ctx.defaultLocale),
        long_description: {},
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        employment_type: (EMPLOYMENT_TYPES as readonly string[]).includes(type)
          ? (type as WorkExperience['employment_type']) : null,
        company_size: null,
        company_url: strOrNull(raw['company_url']),
        start: toYearMonth(raw['start']),
        end: toYearMonth(raw['end']),
        role_ids: [],
        skill_tags: [],
        sort_order: 0,
        starred: false,
        disabled: false,
        internal_notes: null,
      }
      return work as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['employer'], l),
    subtitle: (i, l) => pick(i['role_title'], l),
    dupKeys: (i) => keysOf(i['employer'], i['start']),
  },
  {
    key: 'positions',
    label: 'Other roles',
    blurb: 'Board seats, volunteer work, committee memberships and other non-employment roles.',
    fields: [
      { name: 'organisation', kind: 'text', doc: 'The organisation.' },
      { name: 'name', kind: 'text', doc: 'The role held, e.g. Board member.' },
      { name: 'position_type', kind: 'plain', doc: 'Kind of role, e.g. Board, Volunteer, Committee.' },
      { name: 'description', kind: 'rich', doc: 'What the role involved.' },
      SHORT_DESC,
      { name: 'start', kind: 'date', doc: 'Start date.' },
      { name: 'end', kind: 'date', doc: 'End date; null if ongoing.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const position: Position = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        name: toLocalized(raw['name'], ctx.defaultLocale),
        organisation: toLocalized(raw['organisation'], ctx.defaultLocale),
        description: toLocalized(raw['description'], ctx.defaultLocale),
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        position_type: strOrNull(raw['position_type']),
        start: toYearMonth(raw['start']),
        end: toYearMonth(raw['end']),
        role_ids: [],
        skill_tags: [],
        sort_order: 0,
        starred: false,
        disabled: false,
      }
      return position as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['organisation'], l),
    subtitle: (i, l) => pick(i['name'], l),
    dupKeys: (i) => keysOf(i['organisation'], i['start']),
  },
  {
    key: 'educations',
    label: 'Education',
    blurb: 'Degree-bearing study. Shorter training belongs in Courses.',
    fields: [
      { name: 'school', kind: 'text', doc: 'Institution name.' },
      { name: 'degree', kind: 'text', doc: 'Degree/programme, e.g. MSc Computer Science.' },
      { name: 'description', kind: 'rich', doc: 'Focus, thesis, notable work.' },
      SHORT_DESC,
      { name: 'grade', kind: 'plain', doc: 'Final grade, if stated.' },
      { name: 'exchange', kind: 'bool', doc: 'True if this was an exchange/study-abroad term.' },
      { name: 'start', kind: 'date', doc: 'Start date.' },
      { name: 'end', kind: 'date', doc: 'End date; null if ongoing.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const education: Education = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        school: toLocalized(raw['school'], ctx.defaultLocale),
        degree: toLocalized(raw['degree'], ctx.defaultLocale),
        description: toLocalized(raw['description'], ctx.defaultLocale),
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        grade: strOrNull(raw['grade']),
        exchange: raw['exchange'] === true,
        start: toYearMonth(raw['start']),
        end: toYearMonth(raw['end']),
        skill_tags: [],
        sort_order: 0,
        starred: false,
        disabled: false,
      }
      return education as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['school'], l),
    subtitle: (i, l) => pick(i['degree'], l),
    dupKeys: (i) => keysOf(i['school'], i['start']),
  },
  {
    key: 'courses',
    label: 'Courses',
    blurb: 'Shorter courses, training and workshops.',
    fields: [
      { name: 'name', kind: 'text', doc: 'Course name.' },
      { name: 'program', kind: 'text', doc: 'Provider/programme running it.' },
      { name: 'description', kind: 'rich', doc: 'What it covered.' },
      SHORT_DESC,
      { name: 'completed', kind: 'date', doc: 'When it was completed.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const course: Course = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        name: toLocalized(raw['name'], ctx.defaultLocale),
        program: toLocalized(raw['program'], ctx.defaultLocale),
        description: toLocalized(raw['description'], ctx.defaultLocale),
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        // The paste schema still takes a single "completed" date; it maps to the
        // range's end (start left blank) — see the Course from/to change (v11).
        start: null,
        end: toYearMonth(raw['completed']),
        skill_ids: [],
        skill_tags: [],
        sort_order: 0,
        starred: false,
        disabled: false,
      }
      return course as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['name'], l),
    subtitle: (i, l) => pick(i['program'], l),
    // Produced courses carry the range's `end` (mapped from the paste "completed").
    dupKeys: (i) => keysOf(i['name'], i['end']),
  },
  {
    key: 'certifications',
    label: 'Certifications',
    blurb: 'Formal accreditations with an issuing body.',
    fields: [
      { name: 'name', kind: 'text', doc: 'Certification name.' },
      { name: 'organiser', kind: 'text', doc: 'Issuing body.' },
      { name: 'description', kind: 'rich', doc: 'What it certifies.' },
      SHORT_DESC,
      { name: 'credential_url', kind: 'plain', doc: 'Link to verify the credential.' },
      { name: 'issued', kind: 'date', doc: 'When it was issued.' },
      { name: 'expires', kind: 'date', doc: 'When it expires; null if it does not.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const certification: Certification = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        name: toLocalized(raw['name'], ctx.defaultLocale),
        organiser: toLocalized(raw['organiser'], ctx.defaultLocale),
        description: toLocalized(raw['description'], ctx.defaultLocale),
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        issued: toYearMonth(raw['issued']),
        expires: toYearMonth(raw['expires']),
        credential_url: strOrNull(raw['credential_url']),
        skill_ids: [],
        skill_tags: [],
        sort_order: 0,
        starred: false,
        disabled: false,
      }
      return certification as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['name'], l),
    subtitle: (i, l) => pick(i['organiser'], l),
    dupKeys: (i) => keysOf(i['name'], i['issued']),
  },
  {
    key: 'presentations',
    label: 'Presentations',
    blurb: 'Talks, conference sessions and workshops you delivered.',
    fields: [
      { name: 'title', kind: 'text', doc: 'Talk title.' },
      { name: 'event', kind: 'text', doc: 'Conference/event it was given at.' },
      { name: 'description', kind: 'rich', doc: 'What the talk covered.' },
      SHORT_DESC,
      { name: 'url', kind: 'plain', doc: 'Link to slides/recording.' },
      { name: 'date', kind: 'date', doc: 'When it was given.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const presentation: Presentation = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        title: toLocalized(raw['title'], ctx.defaultLocale),
        event: toLocalized(raw['event'], ctx.defaultLocale),
        description: toLocalized(raw['description'], ctx.defaultLocale),
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        url: strOrNull(raw['url']),
        date: toYearMonth(raw['date']),
        skill_tags: [],
        sort_order: 0,
        starred: false,
        disabled: false,
      }
      return presentation as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['title'], l),
    subtitle: (i, l) => pick(i['event'], l),
    dupKeys: (i) => keysOf(i['title'], i['date']),
  },
  {
    key: 'publications',
    label: 'Publications',
    blurb: 'Articles, papers, books and other published writing.',
    fields: [
      { name: 'title', kind: 'text', doc: 'Publication title.' },
      { name: 'publisher', kind: 'text', doc: 'Journal/publisher.' },
      { name: 'abstract', kind: 'rich', doc: 'Abstract or summary.' },
      SHORT_DESC,
      { name: 'co_authors', kind: 'list', doc: 'Co-author names.' },
      { name: 'publication_type', kind: 'enum', values: PUBLICATION_TYPES, doc: 'Kind of publication.' },
      { name: 'url', kind: 'plain', doc: 'Link to it.' },
      { name: 'date', kind: 'date', doc: 'Publication date.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const type = str(raw['publication_type']).toLowerCase()
      const publication: Publication = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        title: toLocalized(raw['title'], ctx.defaultLocale),
        publisher: toLocalized(raw['publisher'], ctx.defaultLocale),
        co_authors: toNames(raw['co_authors']),
        abstract: toLocalized(raw['abstract'], ctx.defaultLocale),
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        url: strOrNull(raw['url']),
        date: toYearMonth(raw['date']),
        publication_type: (PUBLICATION_TYPES as readonly string[]).includes(type)
          ? (type as Publication['publication_type']) : 'article',
        skill_tags: [],
        sort_order: 0,
        starred: false,
        disabled: false,
        internal_notes: null,
      }
      return publication as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['title'], l),
    subtitle: (i, l) => pick(i['publisher'], l),
    dupKeys: (i) => keysOf(i['title'], i['date']),
  },
  {
    key: 'honor_awards',
    label: 'Awards',
    blurb: 'Awards, honours and recognitions received.',
    fields: [
      { name: 'name', kind: 'text', doc: 'Award name.' },
      { name: 'issuer', kind: 'text', doc: 'Who gave it.' },
      { name: 'for_work', kind: 'text', doc: 'What it was awarded for.' },
      { name: 'description', kind: 'rich', doc: 'Further detail.' },
      SHORT_DESC,
      { name: 'date', kind: 'date', doc: 'When it was received.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const award: HonorAward = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        name: toLocalized(raw['name'], ctx.defaultLocale),
        issuer: toLocalized(raw['issuer'], ctx.defaultLocale),
        for_work: toLocalized(raw['for_work'], ctx.defaultLocale),
        description: toLocalized(raw['description'], ctx.defaultLocale),
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        date: toYearMonth(raw['date']),
        skill_tags: [],
        sort_order: 0,
        disabled: false,
      }
      return award as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['name'], l),
    subtitle: (i, l) => pick(i['issuer'], l),
    dupKeys: (i) => keysOf(i['name'], i['date']),
  },
  {
    key: 'recommendations',
    label: 'Recommendations',
    blurb: 'Written recommendations and testimonials others gave you.',
    fields: [
      { name: 'recommender_name', kind: 'plain', doc: 'Who wrote it (a person name — never translated).' },
      { name: 'recommender_title', kind: 'text', doc: 'Their job title.' },
      { name: 'recommender_company', kind: 'plain', doc: 'Their company.' },
      { name: 'relationship', kind: 'text', doc: 'How they know you, e.g. Line manager.' },
      { name: 'text', kind: 'rich', doc: 'The recommendation itself, quoted as written.' },
      SHORT_DESC,
      { name: 'source', kind: 'plain', doc: 'Where it came from, e.g. LinkedIn.' },
      { name: 'date', kind: 'date', doc: 'When it was written.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const recommendation: Recommendation = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        recommender_name: str(raw['recommender_name']),
        recommender_title: toLocalized(raw['recommender_title'], ctx.defaultLocale),
        recommender_company: strOrNull(raw['recommender_company']),
        relationship: toLocalized(raw['relationship'], ctx.defaultLocale),
        text: toLocalized(raw['text'], ctx.defaultLocale),
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        date: toYearMonth(raw['date']),
        source: strOrNull(raw['source']),
        contact_url: null,
        sort_order: 0,
        starred: false,
        disabled: false,
      }
      return recommendation as unknown as Record<string, unknown>
    },
    title: (i) => str(i['recommender_name']),
    subtitle: (i, l) => pick(i['text'], l),
    dupKeys: (i) => keysOf(i['recommender_name']),
  },
  {
    key: 'references',
    label: 'References',
    blurb: 'People who can vouch for you. Contact details stay private unless you mark a reference for export.',
    fields: [
      { name: 'name', kind: 'plain', doc: 'Their name.' },
      { name: 'title', kind: 'plain', doc: 'Their job title.' },
      { name: 'company', kind: 'plain', doc: 'Their company.' },
      { name: 'relationship', kind: 'text', doc: 'How they know you.' },
      { name: 'email', kind: 'plain', doc: 'Email address.' },
      { name: 'phone', kind: 'plain', doc: 'Phone number.' },
      { name: 'linkedin_url', kind: 'plain', doc: 'LinkedIn profile URL.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const reference: Reference = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        name: str(raw['name']),
        title: strOrNull(raw['title']),
        company: strOrNull(raw['company']),
        relationship: toLocalized(raw['relationship'], ctx.defaultLocale),
        email: strOrNull(raw['email']),
        phone: strOrNull(raw['phone']),
        linkedin_url: strOrNull(raw['linkedin_url']),
        project_id: null,
        work_experience_id: null,
        // Contact details are sensitive: a bulk-added reference stays out of
        // exports until the user opts it in, matching the editor's default.
        include_in_exports: false,
        internal_notes: null,
      }
      return reference as unknown as Record<string, unknown>
    },
    title: (i) => str(i['name']),
    subtitle: (i) => [str(i['title']), str(i['company'])].filter(Boolean).join(' · '),
    dupKeys: (i) => keysOf(i['name']),
  },
  {
    key: 'key_qualifications',
    label: 'Professional summary',
    blurb: 'Top-level positioning paragraphs. Usually one; several only if you pitch distinct profiles.',
    fields: [
      { name: 'label', kind: 'text', doc: 'Heading for this profile, e.g. Senior architect.' },
      { name: 'tag_line', kind: 'text', doc: 'One-line hook under the heading.' },
      { name: 'summary', kind: 'rich', doc: 'The summary paragraph itself.' },
      { name: 'summary_short', kind: 'text', doc: 'One condensed line for summary mode.' },
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const kq: KeyQualification = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        label: toLocalized(raw['label'], ctx.defaultLocale),
        tag_line: toLocalized(raw['tag_line'], ctx.defaultLocale),
        summary: toLocalized(raw['summary'], ctx.defaultLocale),
        summary_short: toLocalized(raw['summary_short'], ctx.defaultLocale),
        key_points: [],
        skill_tags: [],
        competency_ids: [],
        sort_order: 0,
        starred: false,
        disabled: false,
        internal_notes: null,
      }
      return kq as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['label'], l) || pick(i['summary'], l),
    subtitle: (i, l) => pick(i['tag_line'], l),
    dupKeys: (i) => keysOf(i['label']),
  },
  {
    key: 'key_competencies',
    label: 'Key competencies',
    blurb: 'Short capability statements — a title plus a sentence or two.',
    fields: [
      { name: 'title', kind: 'text', doc: 'The competency, e.g. Cloud migration.' },
      { name: 'description', kind: 'rich', doc: 'What you can do and the evidence for it.' },
      SHORT_DESC,
    ],
    make: (raw, ctx): Record<string, unknown> => {
      const kc: KeyCompetency = {
        id: uuidv4(),
        resume_id: ctx.resumeId,
        title: toLocalized(raw['title'], ctx.defaultLocale),
        description: toLocalized(raw['description'], ctx.defaultLocale),
        short_description: toLocalized(raw['short_description'], ctx.defaultLocale),
        sort_order: 0,
        starred: false,
        disabled: false,
      }
      return kc as unknown as Record<string, unknown>
    },
    title: (i, l) => pick(i['title'], l),
    subtitle: (i, l) => pick(i['description'], l),
    dupKeys: (i) => keysOf(i['title']),
  },
] as const

const SPEC_BY_KEY = new Map<string, BulkSectionSpec>(BULK_SPECS.map((s) => [s.key, s]))

/** The spec for a section, or undefined when the section has no bulk add. */
export function bulkSpec(section: string): BulkSectionSpec | undefined {
  return SPEC_BY_KEY.get(section)
}

/** True when this section offers a bulk add (drives the SortBar button). */
export function isBulkSection(section: string): section is BulkSectionKey {
  return SPEC_BY_KEY.has(section)
}

// ─── Detection + validation ──────────────────────────────────────────────────

export interface BulkImportIssue {
  path: string
  reason: string
}

/**
 * Thrown when a bulk file is structurally unusable. Carries every issue found
 * so the modal can list them and the user can re-prompt their LLM with the
 * whole list rather than one at a time.
 */
export class InvalidBulkImportError extends Error {
  constructor(public issues: BulkImportIssue[]) {
    super(
      issues.length === 1
        ? `${issues[0].path}: ${issues[0].reason}`
        : `Found ${issues.length} problems in the bulk import file.`,
    )
    this.name = 'InvalidBulkImportError'
  }
}

export interface BulkFileV1 {
  $schema: string
  section: string
  items: Record<string, unknown>[]
}

/** Lenient detector: does this parsed JSON look like a bulk-import file? */
export function isBulkImportFormat(json: unknown): json is BulkFileV1 {
  if (!isPlainObject(json)) return false
  const schema = json['$schema']
  return typeof schema === 'string' && schema.startsWith('resumestudio-bulk/')
}

/** A localizable value: a string, or an object of locale → string. */
function checkLocalized(val: unknown, path: string, issues: BulkImportIssue[]): void {
  if (val == null) return
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return
  if (isPlainObject(val)) {
    for (const [locale, text] of Object.entries(val)) {
      if (!/^[a-z]{2}(-[a-z]{2})?$/i.test(locale)) {
        issues.push({ path: `${path}.${locale}`, reason: 'expected a locale code like "en" or "no"' })
      } else if (text != null && typeof text !== 'string' && typeof text !== 'number') {
        issues.push({ path: `${path}.${locale}`, reason: 'expected a string' })
      }
    }
    return
  }
  issues.push({ path, reason: 'expected a string, or an object of locale → string' })
}

function checkDate(val: unknown, path: string, issues: BulkImportIssue[]): void {
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
 * Structurally validate parsed JSON as a bulk import for `expectedSection`.
 * Throws `InvalidBulkImportError` with every issue; returns the typed file
 * otherwise.
 *
 * Deliberately lenient about scalars (an LLM writing 2019 for "2019" is fine)
 * and about unknown extra keys (they're ignored by the mapper). Hard errors are
 * reserved for things that would silently lose data: the wrong section, a
 * non-array `items`, objects where text belongs, and malformed dates.
 */
export function validateBulkImport(json: unknown, expectedSection: BulkSectionKey): BulkFileV1 {
  const issues: BulkImportIssue[] = []

  if (!isPlainObject(json)) {
    throw new InvalidBulkImportError([{ path: '(root)', reason: 'expected a JSON object' }])
  }

  const schema = json['$schema']
  if (typeof schema !== 'string' || !schema.startsWith('resumestudio-bulk/')) {
    issues.push({ path: '$schema', reason: `expected "${BULK_IMPORT_SCHEMA}", got ${JSON.stringify(schema)}` })
  }

  // The section guard: pasting a Projects file into Courses is the mistake this
  // format exists to catch, so it's a hard error with an explicit message.
  const section = json['section']
  if (typeof section !== 'string' || !section) {
    issues.push({ path: 'section', reason: `expected "${expectedSection}"` })
  } else if (section !== expectedSection) {
    const known = bulkSpec(section)
    issues.push({
      path: 'section',
      reason: known
        ? `this file is for ${known.label}, but you're adding to ${bulkSpec(expectedSection)?.label}`
        : `unknown section ${JSON.stringify(section)} — expected "${expectedSection}"`,
    })
  }

  const spec = bulkSpec(expectedSection)
  const items = json['items']
  if (!Array.isArray(items)) {
    issues.push({ path: 'items', reason: 'expected an array of items' })
    throw new InvalidBulkImportError(issues)
  }
  if (items.length === 0) {
    issues.push({ path: 'items', reason: 'the file contains no items' })
  }

  if (spec) {
    items.forEach((item, i) => {
      const base = `items[${i}]`
      if (!isPlainObject(item)) {
        issues.push({ path: base, reason: 'expected an object' })
        return
      }
      for (const field of spec.fields) {
        const val = item[field.name]
        if (val == null) continue
        const path = `${base}.${field.name}`
        switch (field.kind) {
          case 'text':
          case 'rich':
            checkLocalized(val, path, issues)
            break
          case 'date':
            checkDate(val, path, issues)
            break
          case 'list':
            if (!Array.isArray(val)) {
              issues.push({ path, reason: 'expected an array of strings' })
            } else {
              val.forEach((entry, j) => {
                if (entry != null && typeof entry !== 'string' && typeof entry !== 'number') {
                  issues.push({ path: `${path}[${j}]`, reason: 'expected a string' })
                }
              })
            }
            break
          case 'enum':
            if (!(field.values ?? []).includes(str(val).toLowerCase())) {
              issues.push({
                path,
                reason: `expected one of ${(field.values ?? []).join(', ')} — got ${JSON.stringify(val)}`,
              })
            }
            break
          case 'plain':
            if (isPlainObject(val) || Array.isArray(val)) {
              issues.push({ path, reason: 'expected a plain string (this field is not translated)' })
            }
            break
          case 'bool':
            if (typeof val !== 'boolean') issues.push({ path, reason: 'expected true or false' })
            break
          case 'number':
            if (!Number.isFinite(Number(val))) issues.push({ path, reason: 'expected a number' })
            break
        }
      }
    })
  }

  if (issues.length) throw new InvalidBulkImportError(issues)
  return { $schema: str(schema), section: str(section), items: items as Record<string, unknown>[] }
}

// ─── Mapping into the open resume ────────────────────────────────────────────

/** New registry entries a bulk add implies (projects intern roles + skills). */
export interface BulkRegistryAdditions {
  skills: Skill[]
  roles: Role[]
}

export interface BulkMapResult {
  /** Mapped, ready-to-append items (in file order). */
  items: Record<string, unknown>[]
  additions: BulkRegistryAdditions
}

/**
 * Map a validated bulk file's items onto real entities for `store`.
 *
 * Registries are interned against what the resume ALREADY has, so a bulk add
 * reuses an existing skill/role rather than duplicating it; only genuinely new
 * names produce `additions`. Total function — never throws.
 */
export function mapBulkItems(
  file: BulkFileV1,
  spec: BulkSectionSpec,
  store: ResumeStore,
  defaultLocale: string,
): BulkMapResult {
  const resumeId = store.resume?.id ?? ''
  const now = new Date().toISOString()
  const newSkills: Skill[] = []
  const newRoles: Role[] = []

  // Seed the lookup maps from the EXISTING registries (every locale of each
  // name, so a Norwegian source matching an English registry entry still hits).
  const skillByName = new Map<string, string>()
  for (const s of store.skills) {
    for (const v of Object.values(s.name ?? {})) {
      const k = norm(str(v))
      if (k && !skillByName.has(k)) skillByName.set(k, s.id)
    }
  }
  const roleByName = new Map<string, string>()
  for (const r of store.roles) {
    for (const v of Object.values(r.name ?? {})) {
      const k = norm(str(v))
      if (k && !roleByName.has(k)) roleByName.set(k, r.id)
    }
  }

  const ctx: BulkContext = {
    resumeId,
    defaultLocale,
    internSkill: (rawName) => {
      const name = rawName.trim()
      const key = norm(name)
      const existing = skillByName.get(key)
      if (existing) return existing
      const id = uuidv4()
      skillByName.set(key, id)
      newSkills.push({
        id, resume_id: resumeId, name: { [defaultLocale]: name },
        category_id: null, total_duration_in_years: 0, proficiency: 0,
        is_highlighted: false, created_at: now,
      })
      return id
    },
    internRole: (rawName) => {
      const name = rawName.trim()
      const key = norm(name)
      const existing = roleByName.get(key)
      if (existing) return existing
      const id = uuidv4()
      roleByName.set(key, id)
      newRoles.push({
        id, resume_id: resumeId, name: { [defaultLocale]: name },
        years_of_experience: 0, years_of_experience_offset: 0,
        starred: false, sort_order: store.roles.length + newRoles.length, disabled: false,
      })
      return id
    },
  }

  const items = file.items.map((raw) => spec.make(raw, ctx))

  // Projects only: resolve the free-text employer against existing employment,
  // then drop the carrier field so it never reaches the store.
  if (spec.key === 'projects') {
    const workByEmployer = new Map<string, string>()
    for (const w of store.work_experiences) {
      for (const v of Object.values(w.employer ?? {})) {
        const k = norm(str(v))
        if (k && !workByEmployer.has(k)) workByEmployer.set(k, w.id)
      }
    }
    for (const item of items) {
      const carrier = item as { _employer?: string; work_experience_id?: string | null }
      const employer = carrier._employer ?? ''
      if (employer) carrier.work_experience_id = workByEmployer.get(norm(employer)) ?? null
      delete carrier._employer
    }
  }

  return { items, additions: { skills: newSkills, roles: newRoles } }
}

// ─── Duplicate detection ─────────────────────────────────────────────────────

/**
 * Indices of incoming items that look like something already in the section —
 * matched when ANY of the spec's `dupKeys` collide (typically a name in some
 * language + the start date). Also catches duplicates WITHIN the incoming
 * batch, so an LLM that listed the same project twice only offers it once.
 *
 * Advisory only: the modal unchecks these but the user decides.
 */
export function findDuplicates(
  incoming: Record<string, unknown>[],
  existing: Record<string, unknown>[],
  spec: BulkSectionSpec,
): Set<number> {
  const seen = new Set<string>()
  for (const item of existing) {
    for (const k of spec.dupKeys(item)) seen.add(k)
  }
  const flagged = new Set<number>()
  incoming.forEach((item, i) => {
    const keys = spec.dupKeys(item)
    if (!keys.length) return
    if (keys.some((k) => seen.has(k))) flagged.add(i)
    else for (const k of keys) seen.add(k)
  })
  return flagged
}

// ─── Appending to the store ──────────────────────────────────────────────────

/**
 * Append mapped items (plus any new registry entries) to `store`, returning a
 * NEW store. Items land at the END of custom order — a bulk add is bulk
 * material to work through, not something that should displace the curated top
 * of the list.
 *
 * Feed the result to `replaceData` (never `loadStore`): it's an in-app rewrite,
 * so undo and auto-save must see it (CLAUDE.md §7).
 */
export function appendBulkItems(
  store: ResumeStore,
  spec: BulkSectionSpec,
  items: Record<string, unknown>[],
  additions: BulkRegistryAdditions = { skills: [], roles: [] },
): ResumeStore {
  const existing = (store[spec.key] ?? []) as unknown as Record<string, unknown>[]
  // References carry no sort_order; everything else continues past the max.
  const maxOrder = existing.reduce((n, item) => {
    const so = item['sort_order']
    return typeof so === 'number' && so > n ? so : n
  }, -1)
  const placed = items.map((item, i) =>
    'sort_order' in item ? { ...item, sort_order: maxOrder + 1 + i } : item,
  )
  return {
    ...store,
    [spec.key]: [...existing, ...placed],
    skills: additions.skills.length ? [...store.skills, ...additions.skills] : store.skills,
    roles: additions.roles.length ? [...store.roles, ...additions.roles] : store.roles,
  } as ResumeStore
}

// ─── Generated LLM instructions ──────────────────────────────────────────────

const KIND_DOC: Record<FieldKind, string> = {
  text: 'text',
  rich: 'text (may be a paragraph)',
  plain: 'plain string, never translated',
  date: '{ "year": 2024, "month": 6 } — month optional, or null',
  list: 'array of strings',
  enum: 'one of the listed values',
  bool: 'true or false',
  number: 'number',
}

/** An illustrative value for a field, used in the generated example. */
function exampleFor(field: BulkField, locales: string[]): string {
  switch (field.kind) {
    case 'text':
    case 'rich':
      return locales.length > 1
        ? `{ ${locales.map((l) => `"${l}": "…"`).join(', ')} }`
        : `"…"`
    case 'plain': return '"…"'
    case 'date': return '{ "year": 2024, "month": 6 }'
    case 'list': return '["…", "…"]'
    case 'enum': return `"${field.values?.[0] ?? '…'}"`
    case 'bool': return 'false'
    case 'number': return '0'
  }
}

/**
 * Build the instruction sheet for one section — the text the user hands their
 * LLM along with the source material. Generated from the spec (never
 * hand-maintained per section) and tailored to the resume's actual locales, so
 * the model knows which language columns to fill.
 */
export function bulkInstructions(spec: BulkSectionSpec, locales: string[]): string {
  const langs = locales.length ? locales : ['en']
  const localeList = langs
    .map((l) => `${l} (${LOCALE_LABELS[l]?.name ?? l})`)
    .join(', ')
  const multi = langs.length > 1

  const fieldRows = spec.fields
    .map((f) => {
      const kind = f.kind === 'enum'
        ? `one of: ${(f.values ?? []).join(' | ')}`
        : KIND_DOC[f.kind]
      return `| \`${f.name}\` | ${kind} | ${f.doc} |`
    })
    .join('\n')

  const exampleFields = spec.fields
    .map((f) => `      "${f.name}": ${exampleFor(f, langs)}`)
    .join(',\n')

  return `# Resume Studio — bulk add to "${spec.label}"

You are converting source material into JSON that will be imported into the
"${spec.label}" section of a resume. ${spec.blurb}

## Rules

1. Output **only** a single JSON object — no commentary, no markdown fence.
2. \`$schema\` must be exactly \`"${BULK_IMPORT_SCHEMA}"\` and \`section\` exactly
   \`"${spec.key}"\`. The import is rejected otherwise.
3. One array entry per real-world item. Do not invent items, dates, employers or
   achievements: if the source doesn't say, omit the field.
4. Omit a field entirely rather than writing \`""\`, \`"N/A"\` or \`"unknown"\`.
5. Keep the source's own wording and level of detail. Don't editorialise or
   summarise the description away — the user edits and improves it afterwards.
6. Plain text only. No HTML, no markdown, no bullet characters.
${multi ? `7. **This resume is written in ${langs.length} languages: ${localeList}.**
   For every translatable field, give an object keyed by locale and fill each
   language you can — translate from the source where it only has one language.
   A field may also be a plain string, which lands in "${langs[0]}".` : `7. This resume is written in ${localeList}. Translatable fields may be a plain
   string, or an object like \`{ "${langs[0]}": "…" }\`.`}

## Fields

Every field is optional — include what the source supports.

| Field | Type | Notes |
|---|---|---|
${fieldRows}

## Dates

\`{ "year": 2024, "month": 6 }\` for month precision, \`{ "year": 2024 }\` when only
the year is known, \`null\` for an ongoing/open end date. Months are 1–12.

## Shape

\`\`\`json
{
  "$schema": "${BULK_IMPORT_SCHEMA}",
  "section": "${spec.key}",
  "items": [
    {
${exampleFields}
    }
  ]
}
\`\`\`

## Source material

Paste your source below this line — a CV, a project list, an export from another
system, meeting notes, anything. Convert everything relevant into the items array.

---
`
}
