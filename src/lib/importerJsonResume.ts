/**
 * Resume Studio — JSON Resume import (exporterJsonResume is the mirror half).
 *
 * JSON Resume (https://jsonresume.org/schema, v1.0.0) is the open interchange
 * schema many resume tools read and write: top-level `basics`, `work`,
 * `volunteer`, `education`, `awards`, `certificates`, `publications`, `skills`,
 * `languages`, `projects`, `references`. Every field is optional and the files
 * come from other people's exporters, so everything is narrowed through the
 * shared coerce helpers — a total function in the importer.ts tradition.
 *
 * Locale: the schema has no language declaration, so — like the LinkedIn
 * importer — all content lands under 'en' and the user re-detects / translates
 * inside the app.
 *
 * `references[]` become Recommendations, not our References section: a JSON
 * Resume reference is a testimonial QUOTE, while our References are contactable
 * referees with consent implications a foreign file cannot carry.
 */

import { uuidv4 } from './uuid'
import { freshStore } from './freshStore'
import { isPlainObject, str, strOrNull, toNames, norm } from './coerce'
import { skillKey } from './skillExtract'
import { plainParagraphs } from './richText'
import { escapeHtml } from './viewFilter'
import { isBackupFormat, isMergeableBackupFormat, looksLikeResumeStore } from './backup'
import { isCVPartnerFormat } from './importer'
import type {
  ResumeStore, LocalizedString, YearMonth, Skill, SkillCategory, Role,
  ProjectRole, ProjectSkill,
} from '../types'

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Positive detector for a JSON Resume file (project rule: third-party formats
 * are detected explicitly, never by fallback). Our own formats are checked
 * FIRST so a Resume Studio file can never be claimed here, whatever else it
 * happens to contain — the id-preserving merge path must win.
 */
export function isJsonResumeFormat(json: unknown): boolean {
  if (!isPlainObject(json)) return false
  const schema = json['$schema']
  if (typeof schema === 'string' && schema.includes('resumestudio')) return false
  if (isBackupFormat(json) || isMergeableBackupFormat(json) || looksLikeResumeStore(json)) return false
  if (isCVPartnerFormat(json)) return false
  const basics = json['basics']
  if (!isPlainObject(basics)) return false
  if (typeof basics['name'] === 'string') return true
  return ['work', 'education', 'skills', 'projects'].some((k) => Array.isArray(json[k]))
}

// ─── Dates ────────────────────────────────────────────────────────────────────

/**
 * JSON Resume dates are ISO 8601 prefixes: "YYYY-MM-DD", "YYYY-MM" or "YYYY"
 * (the day is dropped — the data model is month-precision). A month outside
 * 1–12 drops to null while the year is kept, matching parseEuropassDate;
 * anything else is null rather than a guess.
 */
export function parseJsonResumeDate(val: unknown): YearMonth | null {
  const s = typeof val === 'number' ? String(val) : typeof val === 'string' ? val.trim() : ''
  if (!s) return null
  const m = /^(\d{4})(?:-(\d{1,2})(?:-\d{1,2})?)?$/.exec(s)
  if (!m) return null
  const year = Number(m[1])
  const month = m[2] ? Number(m[2]) : null
  return { year, month: month && month >= 1 && month <= 12 ? month : null }
}

// ─── Proficiency ──────────────────────────────────────────────────────────────

/** Free-text `level` → the 0–5 proficiency scale (0 = unstated). */
function levelToProficiency(level: string): number {
  if (/master|expert/i.test(level)) return 5
  if (/advanced/i.test(level)) return 4
  if (/intermediate/i.test(level)) return 3
  if (/beginner|basic|novice/i.test(level)) return 1
  return 0
}

// ─── Prose ────────────────────────────────────────────────────────────────────

/**
 * A summary plus its highlight bullets, as one stored value. Plain text stays
 * plain (the render boundary paragraphs it, like every other importer's
 * output); highlights force the canonical rich shape because a bullet list is
 * what they are — flattening them into newlines would lose that.
 */
function proseWithHighlights(summary: string, highlights: string[], loc: string): LocalizedString {
  if (!highlights.length) return summary ? { [loc]: summary } : {}
  const paras = plainParagraphs(summary).map((p) => `<p>${escapeHtml(p)}</p>`).join('')
  const list = `<ul>${highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
  return { [loc]: paras + list }
}

// ─── Import ───────────────────────────────────────────────────────────────────

const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const asObj = (v: unknown): Record<string, unknown> => (isPlainObject(v) ? v : {})

/**
 * Map a JSON Resume document onto a fresh ResumeStore. Total function —
 * bad/missing values are skipped, never fatal.
 */
export function importFromJsonResume(json: unknown): ResumeStore {
  const root = asObj(json)
  const now = new Date().toISOString()
  const loc = 'en'
  const L = (v: unknown): LocalizedString => {
    const s = str(v)
    return s ? { [loc]: s } : {}
  }

  const store = freshStore()
  const resume = store.resume!
  const resumeId = resume.id
  const skillCategories = store.skill_categories ?? []
  store.skill_categories = skillCategories

  // ── Basics ─────────────────────────────────────────────────────────────────
  const basics = asObj(root['basics'])
  resume.full_name = str(basics['name'])
  resume.email = str(basics['email'])
  resume.phone = strOrNull(basics['phone'])
  resume.title = L(basics['label'])
  resume.website_url = strOrNull(basics['url'])
  const location = asObj(basics['location'])
  resume.place_of_residence = L([str(location['city']), str(location['region'])].filter(Boolean).join(', '))

  for (const raw of asArr(basics['profiles'])) {
    const p = asObj(raw)
    const network = str(p['network'])
    const link = str(p['url']) || str(p['username'])
    if (!link) continue
    // "x" is anchored: a bare /x/i would also claim Xing, a different network.
    if (/linkedin/i.test(network) && !resume.linkedin_url) resume.linkedin_url = link
    else if ((/twitter/i.test(network) || /^x(\.com)?$/i.test(network)) && !resume.twitter) resume.twitter = link
  }

  const summary = str(basics['summary'])
  if (summary) {
    store.key_qualifications.push({
      id: uuidv4(), resume_id: resumeId,
      label: {}, tag_line: {}, summary: { [loc]: summary },
      key_points: [], competency_ids: [], sort_order: 0,
      starred: false, disabled: false, internal_notes: null,
    })
  }

  // ── Skill / role interning (dedupe on skillKey) ────────────────────────────
  const skillByKey = new Map<string, Skill>()
  const internSkill = (name: string, over: Partial<Skill> = {}): Skill | undefined => {
    const key = skillKey(name)
    if (!key) return undefined
    const existing = skillByKey.get(key)
    if (existing) return existing
    const skill: Skill = {
      id: uuidv4(), resume_id: resumeId,
      name: { [loc]: name },
      category_id: null,
      total_duration_in_years: 0, proficiency: 0,
      is_highlighted: false, created_at: now,
      ...over,
    }
    skillByKey.set(key, skill)
    store.skills.push(skill)
    return skill
  }
  const roleByKey = new Map<string, Role>()
  const internRole = (name: string): Role | undefined => {
    const key = skillKey(name)
    if (!key) return undefined
    const existing = roleByKey.get(key)
    if (existing) return existing
    const role: Role = {
      id: uuidv4(), resume_id: resumeId,
      name: { [loc]: name },
      years_of_experience: 0, years_of_experience_offset: 0,
      starred: false, sort_order: roleByKey.size, disabled: false,
    }
    roleByKey.set(key, role)
    store.roles.push(role)
    return role
  }

  // ── Skills → registry (+ categories) ───────────────────────────────────────
  // An entry WITH keywords is a grouping: its name becomes a SkillCategory and
  // each keyword a Skill in it. An entry WITHOUT keywords is itself a Skill.
  // The entry's level applies to every skill it mints.
  const categoryByName = new Map<string, SkillCategory>()
  for (const raw of asArr(root['skills'])) {
    const s = asObj(raw)
    const name = str(s['name'])
    const proficiency = levelToProficiency(str(s['level']))
    const keywords = toNames(s['keywords'])
    if (keywords.length) {
      let category = name ? categoryByName.get(norm(name)) : undefined
      if (name && !category) {
        category = {
          id: uuidv4(), resume_id: resumeId,
          name: { [loc]: name }, sort_order: categoryByName.size,
        }
        categoryByName.set(norm(name), category)
        skillCategories.push(category)
      }
      for (const kw of keywords) internSkill(kw, { proficiency, category_id: category?.id ?? null })
    } else if (name) {
      internSkill(name, { proficiency })
    }
  }

  // ── Work ───────────────────────────────────────────────────────────────────
  asArr(root['work']).forEach((raw, i) => {
    const w = asObj(raw)
    const employer = str(w['name'])
    const position = str(w['position'])
    if (!employer && !position) return
    store.work_experiences.push({
      id: uuidv4(), resume_id: resumeId,
      employer: L(employer), role_title: L(position),
      description: {},
      long_description: proseWithHighlights(str(w['summary']), toNames(w['highlights']), loc),
      employment_type: null, company_size: null,
      company_url: strOrNull(w['url']),
      start: parseJsonResumeDate(w['startDate']),
      end: parseJsonResumeDate(w['endDate']),
      role_ids: [], sort_order: i,
      starred: false, disabled: false, internal_notes: null,
    })
  })

  // ── Projects ───────────────────────────────────────────────────────────────
  // The project name lands in `description` (our short headline field), like
  // the LinkedIn importer — renderers fall back to it when `customer` is empty.
  asArr(root['projects']).forEach((raw, i) => {
    const p = asObj(raw)
    const name = str(p['name'])
    const longDesc = str(p['description'])
    if (!name && !longDesc) return
    const roles: ProjectRole[] = []
    for (const rn of toNames(p['roles'])) {
      const role = internRole(rn)
      if (!role || roles.some((link) => link.role_id === role.id)) continue
      roles.push({ id: uuidv4(), role_id: role.id, name: { [loc]: rn }, sort_order: roles.length, disabled: false })
    }
    const skills: ProjectSkill[] = []
    for (const kw of toNames(p['keywords'])) {
      const skill = internSkill(kw)
      if (!skill || skills.some((link) => link.skill_id === skill.id)) continue
      skills.push({
        id: uuidv4(), skill_id: skill.id, name: { [loc]: kw },
        duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0,
        sort_order: skills.length,
      })
    }
    store.projects.push({
      id: uuidv4(), resume_id: resumeId,
      work_experience_id: null,
      customer: L(p['entity']),
      customer_anonymized: {}, use_anonymized: false,
      industries: [],
      description: L(name),
      long_description: L(longDesc),
      highlights: toNames(p['highlights']).map((h) => ({ [loc]: h })),
      roles, skills,
      start: parseJsonResumeDate(p['startDate']),
      end: parseJsonResumeDate(p['endDate']),
      percent_allocated: null, team_size: null, location_country_code: null,
      external_url: strOrNull(p['url']),
      sort_order: i, starred: false, disabled: false, internal_notes: null,
    })
  })

  // ── Volunteer → other roles ────────────────────────────────────────────────
  asArr(root['volunteer']).forEach((raw, i) => {
    const v = asObj(raw)
    const organisation = str(v['organization'])
    const name = str(v['position'])
    if (!organisation && !name) return
    store.positions.push({
      id: uuidv4(), resume_id: resumeId,
      name: L(name), organisation: L(organisation),
      description: proseWithHighlights(str(v['summary']), toNames(v['highlights']), loc),
      start: parseJsonResumeDate(v['startDate']),
      end: parseJsonResumeDate(v['endDate']),
      sort_order: i, starred: false, disabled: false,
    })
  })

  // ── Education ──────────────────────────────────────────────────────────────
  asArr(root['education']).forEach((raw, i) => {
    const e = asObj(raw)
    const school = str(e['institution'])
    const degree = [str(e['studyType']), str(e['area'])].filter(Boolean).join(', ')
    if (!school && !degree) return
    store.educations.push({
      id: uuidv4(), resume_id: resumeId,
      school: L(school), degree: degree ? { [loc]: degree } : {},
      description: {},
      grade: strOrNull(e['score']),
      exchange: false,
      start: parseJsonResumeDate(e['startDate']),
      end: parseJsonResumeDate(e['endDate']),
      sort_order: i, starred: false, disabled: false,
    })
  })

  // ── Awards ─────────────────────────────────────────────────────────────────
  asArr(root['awards']).forEach((raw, i) => {
    const a = asObj(raw)
    const name = str(a['title'])
    if (!name) return
    store.honor_awards.push({
      id: uuidv4(), resume_id: resumeId,
      name: L(name), issuer: L(a['awarder']), for_work: {},
      description: L(a['summary']),
      date: parseJsonResumeDate(a['date']),
      sort_order: i, disabled: false,
    })
  })

  // ── Certificates ───────────────────────────────────────────────────────────
  asArr(root['certificates']).forEach((raw, i) => {
    const c = asObj(raw)
    const name = str(c['name'])
    if (!name) return
    store.certifications.push({
      id: uuidv4(), resume_id: resumeId,
      name: L(name), organiser: L(c['issuer']), description: {},
      issued: parseJsonResumeDate(c['date']), expires: null,
      credential_url: strOrNull(c['url']),
      skill_ids: [], sort_order: i,
      starred: false, disabled: false,
    })
  })

  // ── Publications ───────────────────────────────────────────────────────────
  asArr(root['publications']).forEach((raw, i) => {
    const p = asObj(raw)
    const title = str(p['name'])
    if (!title) return
    store.publications.push({
      id: uuidv4(), resume_id: resumeId,
      title: L(title), publisher: L(p['publisher']),
      co_authors: [],
      abstract: L(p['summary']),
      url: strOrNull(p['url']),
      date: parseJsonResumeDate(p['releaseDate']),
      publication_type: 'article',
      sort_order: i, starred: false, disabled: false, internal_notes: null,
    })
  })

  // ── Languages ──────────────────────────────────────────────────────────────
  asArr(root['languages']).forEach((raw, i) => {
    const l = asObj(raw)
    const name = str(l['language'])
    if (!name) return
    store.spoken_languages.push({
      id: uuidv4(), resume_id: resumeId,
      name: L(name), level: L(l['fluency']),
      sort_order: i, disabled: false,
    })
  })

  // ── References → recommendations (quotes, not referees — see header) ───────
  asArr(root['references']).forEach((raw, i) => {
    const r = asObj(raw)
    const text = str(r['reference'])
    if (!text) return
    store.recommendations.push({
      id: uuidv4(), resume_id: resumeId,
      recommender_name: str(r['name']),
      recommender_title: {}, recommender_company: null,
      relationship: {},
      text: { [loc]: text },
      date: null, source: null, contact_url: null,
      sort_order: i, starred: false, disabled: false,
    })
  })

  return store
}
