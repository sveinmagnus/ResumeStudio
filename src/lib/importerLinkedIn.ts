/**
 * Resume Studio — LinkedIn data-export import (roadmap F7)
 *
 * LinkedIn's "Get a copy of your data" produces a ZIP of CSV files. The ZIP is
 * extracted by the caller (ImportScreen lazy-loads fflate); this module is
 * PURE: it takes `{ filename → csv text }` and maps the known files onto a
 * fresh ResumeStore. Unknown files are ignored, missing files just leave their
 * section empty — a total function in the importer.ts tradition.
 *
 * Files mapped: Profile, Email Addresses, PhoneNumbers, Positions, Education,
 * Skills, Languages, Certifications, Projects, Recommendations_Received.
 *
 * Locale: LinkedIn doesn't say what language the *content* is in; everything
 * lands under 'en' (the export UI's lingua franca) and the user re-detects /
 * translates inside the app.
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  ResumeStore, Resume, Skill, WorkExperience, Education, Certification,
  SpokenLanguage, Project, Recommendation, LocalizedString, YearMonth,
} from '../types'

// ─── CSV (RFC 4180: quoted fields, embedded commas/quotes/newlines) ──────────

/** Parse CSV text into rows of fields. Handles quoted fields, "" escapes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const push = () => { row.push(field); field = '' }
  const pushRow = () => { push(); rows.push(row); row = [] }
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { push(); i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { pushRow(); i++; continue }
    field += c; i++
  }
  // Trailing field/row (no final newline).
  if (field !== '' || row.length) pushRow()
  return rows
}

/** First row = headers; remaining rows become objects. Blank lines skipped. */
export function csvObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text).filter((r) => r.some((f) => f.trim() !== ''))
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim() })
    return obj
  })
}

// ─── LinkedIn date strings ("Mar 2020", "2020", "") ──────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/** Parse LinkedIn's "Mar 2020" / "2020" date strings into YearMonth. */
export function parseLinkedInDate(raw: string | undefined): YearMonth | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const parts = s.split(/\s+/)
  if (parts.length === 2) {
    const month = MONTHS[parts[0].slice(0, 3).toLowerCase()] ?? null
    const year = Number(parts[1])
    if (Number.isInteger(year) && year > 1000) return { year, month }
  }
  const year = Number(s)
  if (Number.isInteger(year) && year > 1000) return { year, month: null }
  return null
}

// ─── Import ───────────────────────────────────────────────────────────────────

/** Find a file by basename, case-insensitively, ignoring any folder prefix. */
function fileNamed(files: Record<string, string>, base: string): string | undefined {
  const want = base.toLowerCase()
  for (const [name, content] of Object.entries(files)) {
    const leaf = name.split('/').pop()!.toLowerCase()
    if (leaf === want) return content
  }
  return undefined
}

function objectsIn(files: Record<string, string>, base: string): Array<Record<string, string>> {
  const content = fileNamed(files, base)
  return content ? csvObjects(content) : []
}

/** Does this set of extracted files look like a LinkedIn data export? */
export function isLinkedInExport(files: Record<string, string>): boolean {
  return ['Profile.csv', 'Positions.csv', 'Skills.csv']
    .some((f) => fileNamed(files, f) !== undefined)
}

/**
 * Map an extracted LinkedIn data export onto a fresh ResumeStore.
 * Total function — bad/missing rows are skipped, never fatal.
 */
export function importFromLinkedIn(files: Record<string, string>): ResumeStore {
  const resumeId = uuidv4()
  const now = new Date().toISOString()
  const loc = 'en'
  const L = (v: string | undefined): LocalizedString => {
    const s = (v ?? '').trim()
    return s ? { [loc]: s } : {}
  }

  // ── Profile + contact ──────────────────────────────────────────────────────
  const profile = objectsIn(files, 'Profile.csv')[0] ?? {}
  const emails = objectsIn(files, 'Email Addresses.csv')
  const primaryEmail =
    emails.find((e) => e['Primary']?.toLowerCase() === 'yes')?.['Email Address']
    ?? emails[0]?.['Email Address'] ?? ''
  const phones = objectsIn(files, 'PhoneNumbers.csv')
  const fullName = [profile['First Name'], profile['Last Name']].filter(Boolean).join(' ')

  const resume: Resume = {
    id: resumeId,
    full_name: fullName,
    email: primaryEmail,
    phone: phones[0]?.['Number'] || null,
    title: L(profile['Headline']),
    nationality: {},
    place_of_residence: L(profile['Geo Location']),
    date_of_birth: null,
    twitter: null,
    linkedin_url: null,
    website_url: null,
    profile_image_url: null,
    profile_photo: null,
    company_logo: null,
    company_name: null,
    default_locale: loc,
    supported_locales: [loc],
    created_at: now,
    updated_at: now,
  }

  // ── Key qualification from the profile summary ─────────────────────────────
  const store: ResumeStore = {
    resume,
    skills: [], roles: [],
    key_qualifications: [], key_competencies: [], recommendations: [],
    projects: [], work_experiences: [], educations: [], courses: [],
    certifications: [], spoken_languages: [], technology_categories: [],
    positions: [], presentations: [], honor_awards: [], publications: [],
    references: [], views: [],
  }
  if (profile['Summary']) {
    store.key_qualifications.push({
      id: uuidv4(), resume_id: resumeId,
      label: {}, tag_line: {}, summary: L(profile['Summary']),
      key_points: [], skill_tags: [], sort_order: 0,
      starred: false, disabled: false, internal_notes: null,
    })
  }

  // ── Positions → work experiences ───────────────────────────────────────────
  objectsIn(files, 'Positions.csv').forEach((p, i) => {
    if (!p['Company Name'] && !p['Title']) return
    store.work_experiences.push({
      id: uuidv4(), resume_id: resumeId,
      employer: L(p['Company Name']),
      role_title: L(p['Title']),
      description: L(p['Description']),
      long_description: {},
      employment_type: null, company_size: null, company_url: null,
      start: parseLinkedInDate(p['Started On']),
      end: parseLinkedInDate(p['Finished On']),
      role_id: null, skill_tags: [], sort_order: i,
      starred: false, disabled: false, internal_notes: null,
    })
  })

  // ── Education ──────────────────────────────────────────────────────────────
  objectsIn(files, 'Education.csv').forEach((e, i) => {
    if (!e['School Name']) return
    store.educations.push({
      id: uuidv4(), resume_id: resumeId,
      school: L(e['School Name']),
      degree: L(e['Degree Name']),
      description: L(e['Notes'] || e['Activities']),
      grade: null, exchange: false,
      start: parseLinkedInDate(e['Start Date']),
      end: parseLinkedInDate(e['End Date']),
      skill_tags: [], sort_order: i, starred: false, disabled: false,
    })
  })

  // ── Skills → registry ──────────────────────────────────────────────────────
  const seen = new Set<string>()
  objectsIn(files, 'Skills.csv').forEach((s) => {
    const name = s['Name']
    if (!name || seen.has(name.toLowerCase())) return
    seen.add(name.toLowerCase())
    const skill: Skill = {
      id: uuidv4(), resume_id: resumeId,
      name: { [loc]: name },
      default_category: null, skill_type: 'technical',
      total_duration_in_years: 0, proficiency: 0,
      is_highlighted: false, created_at: now,
    }
    store.skills.push(skill)
  })

  // ── Languages ──────────────────────────────────────────────────────────────
  objectsIn(files, 'Languages.csv').forEach((l, i) => {
    if (!l['Name']) return
    const lang: SpokenLanguage = {
      id: uuidv4(), resume_id: resumeId,
      name: L(l['Name']), level: L(l['Proficiency']),
      sort_order: i, disabled: false,
    }
    store.spoken_languages.push(lang)
  })

  // ── Certifications ─────────────────────────────────────────────────────────
  objectsIn(files, 'Certifications.csv').forEach((c, i) => {
    if (!c['Name']) return
    const cert: Certification = {
      id: uuidv4(), resume_id: resumeId,
      name: L(c['Name']), organiser: L(c['Authority']),
      description: {},
      issued: parseLinkedInDate(c['Started On']),
      expires: parseLinkedInDate(c['Finished On']),
      credential_url: c['Url'] || null,
      skill_ids: [], skill_tags: [], sort_order: i,
      starred: false, disabled: false,
    }
    store.certifications.push(cert)
  })

  // ── Projects ───────────────────────────────────────────────────────────────
  // LinkedIn projects have a Title + Description, no customer. The title lands
  // in `description` (our short headline field); the renderers fall back to it
  // for the item title when `customer` is empty.
  objectsIn(files, 'Projects.csv').forEach((p, i) => {
    if (!p['Title'] && !p['Description']) return
    const project: Project = {
      id: uuidv4(), resume_id: resumeId,
      work_experience_id: null,
      customer: {}, customer_anonymized: {}, use_anonymized: false,
      industry: {},
      description: L(p['Title']),
      long_description: L(p['Description']),
      highlights: [], roles: [], skills: [],
      start: parseLinkedInDate(p['Started On']),
      end: parseLinkedInDate(p['Finished On']),
      percent_allocated: null, team_size: null,
      location_country_code: null,
      external_url: p['Url'] || null,
      skill_tags: [], sort_order: i,
      starred: false, disabled: false, internal_notes: null,
    }
    store.projects.push(project)
  })

  // ── Recommendations received ───────────────────────────────────────────────
  objectsIn(files, 'Recommendations_Received.csv').forEach((r, i) => {
    if (!r['Text']) return
    const rec: Recommendation = {
      id: uuidv4(), resume_id: resumeId,
      recommender_name: [r['First Name'], r['Last Name']].filter(Boolean).join(' '),
      recommender_title: r['Job Title'] || null,
      recommender_company: r['Company'] || null,
      relationship: {},
      text: L(r['Text']),
      date: null, source: 'LinkedIn', contact_url: null,
      sort_order: i, starred: false, disabled: false,
    }
    store.recommendations.push(rec)
  })

  return store
}
