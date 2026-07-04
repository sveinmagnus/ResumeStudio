/**
 * PURE: human-readable diff between two ResumeStore snapshots, for the version
 * history modal. Describes what changed line by line:
 *   - items added / removed, named by their title (e.g. "Added Project: Acme");
 *   - items edited, with per-field character deltas that name the field AND the
 *     language box (e.g. "Description (Norsk): +42 chars");
 *   - profile (header) field changes, collapsed into one entry.
 *
 * Identity / ordering / bookkeeping / image fields are ignored (snapshots are
 * stored image-free anyway), so a pure reorder or an image-only edit yields no
 * entries. Not a merge engine — just enough for the user to see what a given
 * save actually changed. Deterministic and unit-tested.
 */

import type { ResumeStore, LocalizedString } from '../types'
import { LOCALE_LABELS } from './locales'

export interface SnapshotChange {
  kind: 'added' | 'removed' | 'edited'
  /** Singular section label, e.g. "Project", "Role", "Profile". */
  section: string
  /** The item's title (added / removed / edited) or "Profile details". */
  label: string
  /** Field-level descriptions for an edit, e.g. "Description (Norsk): +42 chars". */
  details?: string[]
}

/** Cap output so a huge bulk change can't make the panel unreadable. */
const MAX_ENTRIES = 40
/** Cap field details per edited item. */
const MAX_DETAILS = 8

/** Section key → singular label, in display order. */
const SECTION_SINGULAR: Record<string, string> = {
  projects: 'Project',
  work_experiences: 'Employment',
  educations: 'Education',
  courses: 'Course',
  certifications: 'Certification',
  key_qualifications: 'Profile',
  key_competencies: 'Key competency',
  recommendations: 'Recommendation',
  positions: 'Position',
  presentations: 'Presentation',
  publications: 'Publication',
  honor_awards: 'Award',
  references: 'Reference',
  spoken_languages: 'Language',
  skills: 'Skill',
  roles: 'Role',
  industries: 'Industry',
  skill_categories: 'Skill category',
  views: 'View',
}
const SECTION_ORDER = Object.keys(SECTION_SINGULAR)

/** Best-effort title fields, tried in order, across heterogeneous sections. */
const TITLE_FIELDS = [
  'customer', 'employer', 'school', 'name', 'title', 'role_title',
  'degree', 'issuer', 'organisation', 'event', 'publisher',
  'recommender_name', 'label',
]

/** Field key → readable label for the per-field deltas. */
const FIELD_LABELS: Record<string, string> = {
  long_description: 'Description', description: 'Description', summary: 'Summary',
  abstract: 'Abstract', text: 'Testimonial', tag_line: 'Tag line',
  customer: 'Customer', customer_anonymized: 'Anonymized customer',
  employer: 'Employer', role_title: 'Role / title', title: 'Title', name: 'Name',
  degree: 'Degree', school: 'School', grade: 'Grade', organiser: 'Organiser',
  organisation: 'Organisation', issuer: 'Issuer', event: 'Event',
  publisher: 'Publisher', industry: 'Industry', relationship: 'Relationship',
  level: 'Level', highlights: 'Highlights', roles: 'Roles', skills: 'Skills',
  key_points: 'Key points', start: 'Start date', end: 'End date',
  expires: 'Expiry', issued: 'Issued', completed: 'Completed', date: 'Date',
  percent_allocated: 'Allocation %', team_size: 'Team size',
  skill_tags: 'Skill tags', co_authors: 'Co-authors', email: 'Email',
  phone: 'Phone', nationality: 'Nationality',
  place_of_residence: 'Place of residence', linkedin_url: 'LinkedIn',
  website_url: 'Website', full_name: 'Full name', company_name: 'Company',
  introduction: 'Introduction', sections: 'Sections', style: 'Styling',
  header: 'Header', footer: 'Footer',
}

/** Keys never worth reporting (identity / ordering / bookkeeping / images). */
const SKIP_KEYS = new Set([
  'id', 'resume_id', 'sort_order', 'created_at', 'updated_at', 'disabled',
  'starred', 'skill_id', 'role_id', 'industry_id', 'category_id', 'work_experience_id',
  'project_id', 'use_anonymized', 'include_in_exports', 'is_highlighted',
  'default_locale', 'supported_locales', 'attention_dismissals',
  'profile_photo', 'company_logo', 'profile_image_url', 'photo_override',
  'logo_override', 'skill_ids', 'template_id', 'last_exported_at',
])

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function localeName(code: string): string {
  return LOCALE_LABELS[code]?.name ?? code
}

/** Strip HTML so char counts reflect visible text, not markup. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

function isLocalized(v: unknown): v is LocalizedString {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const values = Object.values(v as Record<string, unknown>)
  return values.length > 0 && values.every((x) => typeof x === 'string')
}

function display(v: unknown, locale: string): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (isLocalized(v)) {
    if (v[locale]?.trim()) return v[locale]
    for (const x of Object.values(v)) if (x.trim()) return x
  }
  return ''
}

function titleOf(item: Record<string, unknown>, locale: string): string {
  for (const f of TITLE_FIELDS) {
    if (f in item) {
      const s = display(item[f], locale)
      if (s) return s
    }
  }
  return '(untitled)'
}

/** A "+N chars" / "−N chars" / "edited" descriptor for a text change. */
function deltaLabel(prev: string, next: string): string {
  const d = stripTags(next).length - stripTags(prev).length
  if (d > 0) return `+${d} chars`
  if (d < 0) return `−${-d} chars` // U+2212 minus sign
  return 'edited'
}

function describeItemEdit(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  locale: string,
): string[] {
  const details: string[] = []
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of keys) {
    if (SKIP_KEYS.has(key)) continue
    const a = prev[key]
    const b = next[key]
    if (JSON.stringify(a) === JSON.stringify(b)) continue

    if (isLocalized(a) || isLocalized(b)) {
      const av = (a ?? {}) as LocalizedString
      const bv = (b ?? {}) as LocalizedString
      for (const loc of new Set([...Object.keys(av), ...Object.keys(bv)])) {
        const pv = av[loc] ?? ''
        const nv = bv[loc] ?? ''
        if (stripTags(pv) === stripTags(nv)) continue
        details.push(`${fieldLabel(key)} (${localeName(loc)}): ${deltaLabel(pv, nv)}`)
        if (details.length >= MAX_DETAILS) return details
      }
    } else if (typeof a === 'string' || typeof b === 'string') {
      const pv = typeof a === 'string' ? a : ''
      const nv = typeof b === 'string' ? b : ''
      details.push(`${fieldLabel(key)}: ${deltaLabel(pv, nv)}`)
    } else {
      details.push(`${fieldLabel(key)} changed`)
    }
    if (details.length >= MAX_DETAILS) return details
  }
  return details
}

/**
 * Describe how `next` differs from `prev` (prev = the older snapshot). Returns
 * an empty array when nothing reportable changed (e.g. only reordering or
 * images).
 */
export function describeSnapshotChanges(
  prev: ResumeStore,
  next: ResumeStore,
  locale = 'en',
): SnapshotChange[] {
  const out: SnapshotChange[] = []

  // Profile (header) — one collapsed entry.
  const profileDetails = describeItemEdit(
    (prev.resume ?? {}) as unknown as Record<string, unknown>,
    (next.resume ?? {}) as unknown as Record<string, unknown>,
    locale,
  )
  if (profileDetails.length) {
    out.push({ kind: 'edited', section: 'Profile', label: 'Profile details', details: profileDetails })
  }

  for (const key of SECTION_ORDER) {
    const a = (prev[key as keyof ResumeStore] ?? []) as unknown as Array<Record<string, unknown>>
    const b = (next[key as keyof ResumeStore] ?? []) as unknown as Array<Record<string, unknown>>
    if (!Array.isArray(a) || !Array.isArray(b)) continue
    const section = SECTION_SINGULAR[key]
    const aById = new Map(a.map((x) => [String(x.id), x]))
    const bById = new Map(b.map((x) => [String(x.id), x]))

    const edited: SnapshotChange[] = []
    const added: SnapshotChange[] = []
    for (const [id, item] of bById) {
      const other = aById.get(id)
      if (!other) {
        added.push({ kind: 'added', section, label: titleOf(item, locale) })
      } else if (JSON.stringify(item) !== JSON.stringify(other)) {
        const details = describeItemEdit(other, item, locale)
        if (details.length) edited.push({ kind: 'edited', section, label: titleOf(item, locale), details })
      }
    }
    const removed: SnapshotChange[] = []
    for (const [id, item] of aById) {
      if (!bById.has(id)) removed.push({ kind: 'removed', section, label: titleOf(item, locale) })
    }
    out.push(...edited, ...added, ...removed)
  }

  return out.slice(0, MAX_ENTRIES)
}
