/**
 * Resume Studio — Europass import (roadmap F7)
 *
 * Europass CVs travel in two wire formats:
 *  - XML — the classic `SkillsPassport` schema (Europass CV 3.x), still what
 *    most "download your Europass CV" flows hand out alongside the PDF.
 *  - JSON — the europa.eu profile export (`{ profile: { ... } }`).
 *
 * Both map onto the same subset here: identification/contact, work
 *  experiences, education, language skills. Anything we don't recognise is
 * skipped — total functions in the importer.ts tradition.
 *
 * The XML path uses DOMParser (browser + jsdom), mirroring lib/richText.
 * SECURITY: parsed values are stored as plain strings only; the render
 * boundary escapes them like all other content.
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  ResumeStore, Resume, WorkExperience, Education, SpokenLanguage,
  LocalizedString, YearMonth,
} from '../types'
import { normalizeImportLocale } from './aiImport'

// ─── Shared store scaffolding ─────────────────────────────────────────────────

function freshImportStore(resumeId: string, resume: Resume): ResumeStore {
  return {
    resume,
    skills: [], roles: [], industries: [],
    key_qualifications: [], key_competencies: [], recommendations: [],
    projects: [], work_experiences: [], educations: [], courses: [],
    certifications: [], spoken_languages: [], skill_categories: [], cover_letters: [],
    positions: [], presentations: [], honor_awards: [], publications: [],
    references: [], views: [],
  }
}

function emptyResume(resumeId: string, loc: string, now: string): Resume {
  return {
    id: resumeId,
    full_name: '', email: '', phone: null,
    title: {}, nationality: {}, place_of_residence: {},
    date_of_birth: null, twitter: null, linkedin_url: null, website_url: null,
    profile_image_url: null, profile_photo: null, company_logo: null,
    company_name: null,
    default_locale: loc, supported_locales: [loc],
    created_at: now, updated_at: now,
  }
}

// ─── Detection ────────────────────────────────────────────────────────────────

/** Parsed JSON that looks like a Europass profile export. */
export function isEuropassJson(json: unknown): boolean {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false
  const o = json as Record<string, unknown>
  if (o['SkillsPassport']) return true
  const profile = o['profile']
  return !!profile && typeof profile === 'object' && !Array.isArray(profile)
    && 'personalInformation' in (profile as Record<string, unknown>)
}

/** Raw text that looks like a Europass XML document. */
export function isEuropassXml(text: string): boolean {
  return /<\s*SkillsPassport[\s>]/.test(text)
}

// ─── Date coercion ────────────────────────────────────────────────────────────

/**
 * Europass dates appear as "2018-06", "2018-06-01", "2018", `{year, month}`,
 * or XML attributes like year="2018" month="--06". Normalize them all.
 */
export function parseEuropassDate(val: unknown): YearMonth | null {
  if (val == null) return null
  if (typeof val === 'object' && !Array.isArray(val)) {
    const o = val as Record<string, unknown>
    const y = Number(String(o['year'] ?? '').replace(/\D/g, ''))
    if (!Number.isInteger(y) || y < 1000) return null
    const mRaw = String(o['month'] ?? '').replace(/\D/g, '')
    const m = Number(mRaw)
    return { year: y, month: mRaw && m >= 1 && m <= 12 ? m : null }
  }
  const s = String(val).trim()
  const match = /^(\d{4})(?:-(\d{2}))?/.exec(s)
  if (!match) return null
  const year = Number(match[1])
  const month = match[2] ? Number(match[2]) : null
  return { year, month: month && month >= 1 && month <= 12 ? month : null }
}

// ─── JSON path (europa.eu profile export) ─────────────────────────────────────

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {})
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** Map a Europass profile JSON export onto a fresh ResumeStore. */
export function importFromEuropassJson(json: unknown): ResumeStore {
  const root = asObj(json)
  const profile = asObj(root['profile'])
  const pi = asObj(profile['personalInformation'])
  const resumeId = uuidv4()
  const now = new Date().toISOString()
  const loc = normalizeImportLocale(asStr(asObj(profile['preference'])['profileLanguage']) || 'en')
  const L = (v: unknown): LocalizedString => {
    const s = asStr(v)
    return s ? { [loc]: s } : {}
  }

  const resume = emptyResume(resumeId, loc, now)
  resume.full_name = [asStr(pi['firstName']), asStr(pi['lastName'])].filter(Boolean).join(' ')
  resume.email = asStr(asArr(pi['emails'])[0]) || asStr(asObj(asArr(pi['emails'])[0])['email'])
  const phone0 = asArr(pi['phones'])[0]
  resume.phone = asStr(phone0) || asStr(asObj(phone0)['phoneNumber']) || null
  resume.nationality = L(asArr(pi['nationalities'])[0])
  const addr = asObj(asArr(pi['addresses'])[0])
  resume.place_of_residence = L([asStr(addr['city']), asStr(addr['country'])].filter(Boolean).join(', '))

  const store = freshImportStore(resumeId, resume)

  // Headline / about → title + a leading key qualification.
  const about = asStr(profile['aboutMe']) || asStr(asObj(profile['aboutMe'])['description'])
  resume.title = L(asStr(asObj(profile['preference'])['headline']) || asStr(pi['headline']))
  if (about) {
    store.key_qualifications.push({
      id: uuidv4(), resume_id: resumeId,
      label: {}, tag_line: {}, summary: { [loc]: about },
      key_points: [], skill_tags: [], competency_ids: [], sort_order: 0,
      starred: false, disabled: false, internal_notes: null,
    })
  }

  asArr(profile['workExperiences']).forEach((raw, i) => {
    const w = asObj(raw)
    const employer = asStr(w['employer']) || asStr(asObj(w['employer'])['name'])
    const title = asStr(w['occupation']) || asStr(asObj(w['occupation'])['label']) || asStr(w['position'])
    if (!employer && !title) return
    const we: WorkExperience = {
      id: uuidv4(), resume_id: resumeId,
      employer: L(employer), role_title: L(title),
      description: L(w['mainActivities'] ?? w['summary'] ?? w['description']),
      long_description: {},
      employment_type: null, company_size: null, company_url: null,
      start: parseEuropassDate(w['startDate'] ?? w['from']),
      end: (w['ongoing'] === true) ? null : parseEuropassDate(w['endDate'] ?? w['to']),
      role_ids: [], skill_tags: [], sort_order: i,
      starred: false, disabled: false, internal_notes: null,
    }
    store.work_experiences.push(we)
  })

  const educations = [...asArr(profile['educationTrainings']), ...asArr(profile['educations'])]
  educations.forEach((raw, i) => {
    const e = asObj(raw)
    const school = asStr(e['organisationName']) || asStr(asObj(e['organisation'])['name']) || asStr(e['school'])
    const degree = asStr(e['qualification']) || asStr(e['title']) || asStr(e['degree'])
    if (!school && !degree) return
    const ed: Education = {
      id: uuidv4(), resume_id: resumeId,
      school: L(school), degree: L(degree),
      description: L(e['description'] ?? e['mainSubjects']),
      grade: null, exchange: false,
      start: parseEuropassDate(e['startDate'] ?? e['from']),
      end: (e['ongoing'] === true) ? null : parseEuropassDate(e['endDate'] ?? e['to']),
      skill_tags: [], sort_order: i, starred: false, disabled: false,
    }
    store.educations.push(ed)
  })

  const langSkills = asObj(profile['languageSkills'])
  const mother = [...asArr(langSkills['motherTongues']), ...asArr(profile['motherTongues'])]
  const other = [...asArr(langSkills['otherLanguages']), ...asArr(profile['otherLanguages'])]
  let li = 0
  for (const raw of mother) {
    const name = asStr(raw) || asStr(asObj(raw)['language']) || asStr(asObj(raw)['name'])
    if (!name) continue
    const sl: SpokenLanguage = {
      id: uuidv4(), resume_id: resumeId,
      name: { [loc]: name }, level: { [loc]: 'Native' },
      sort_order: li++, disabled: false,
    }
    store.spoken_languages.push(sl)
  }
  for (const raw of other) {
    const o = asObj(raw)
    const name = asStr(raw) || asStr(o['language']) || asStr(o['name'])
    if (!name) continue
    const level = asStr(o['listening']) || asStr(o['overall']) || asStr(o['level'])
    const sl: SpokenLanguage = {
      id: uuidv4(), resume_id: resumeId,
      name: { [loc]: name }, level: level ? { [loc]: level } : {},
      sort_order: li++, disabled: false,
    }
    store.spoken_languages.push(sl)
  }

  return store
}

// ─── XML path (SkillsPassport / Europass CV 3.x) ──────────────────────────────

function text(el: Element | null | undefined, selector: string): string {
  return el?.querySelector(selector)?.textContent?.trim() ?? ''
}

function dateFrom(el: Element | null): YearMonth | null {
  if (!el) return null
  const year = el.getAttribute('year') ?? ''
  const month = el.getAttribute('month') ?? ''
  return parseEuropassDate({ year, month })
}

/** Map a Europass `SkillsPassport` XML document onto a fresh ResumeStore. */
export function importFromEuropassXml(xml: string): ResumeStore {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const resumeId = uuidv4()
  const now = new Date().toISOString()
  const learner = doc.querySelector('LearnerInfo')
  const localeAttr = doc.querySelector('SkillsPassport > Locale')?.textContent
    ?? doc.documentElement.getAttribute('locale') ?? 'en'
  const loc = normalizeImportLocale(localeAttr)
  const L = (s: string): LocalizedString => (s ? { [loc]: s } : {})

  const resume = emptyResume(resumeId, loc, now)
  const ident = learner?.querySelector('Identification') ?? null
  resume.full_name = [
    text(ident, 'PersonName > FirstName'),
    text(ident, 'PersonName > Surname'),
  ].filter(Boolean).join(' ')
  resume.email = ident?.querySelector('ContactInfo Email Contact')?.textContent?.trim()
    ?? text(ident, 'ContactInfo Email')
  resume.phone = ident?.querySelector('ContactInfo Telephone Contact')?.textContent?.trim() || null
  resume.nationality = L(text(ident, 'Demographics Nationality Label'))
  resume.place_of_residence = L(text(ident, 'ContactInfo Address Contact Municipality'))
  resume.title = L(text(learner, 'Headline Description Label'))

  const store = freshImportStore(resumeId, resume)

  doc.querySelectorAll('WorkExperienceList > WorkExperience').forEach((w, i) => {
    const employer = text(w, 'Employer > Name')
    const title = text(w, 'Position > Label')
    if (!employer && !title) return
    const we: WorkExperience = {
      id: uuidv4(), resume_id: resumeId,
      employer: L(employer), role_title: L(title),
      description: L(text(w, 'Activities')),
      long_description: {},
      employment_type: null, company_size: null, company_url: null,
      start: dateFrom(w.querySelector('Period > From')),
      end: w.querySelector('Period > Current')?.textContent?.trim() === 'true'
        ? null
        : dateFrom(w.querySelector('Period > To')),
      role_ids: [], skill_tags: [], sort_order: i,
      starred: false, disabled: false, internal_notes: null,
    }
    store.work_experiences.push(we)
  })

  doc.querySelectorAll('EducationList > Education').forEach((e, i) => {
    const school = text(e, 'Organisation > Name')
    const degree = text(e, 'Title')
    if (!school && !degree) return
    const ed: Education = {
      id: uuidv4(), resume_id: resumeId,
      school: L(school), degree: L(degree),
      description: L(text(e, 'Activities')),
      grade: null, exchange: false,
      start: dateFrom(e.querySelector('Period > From')),
      end: dateFrom(e.querySelector('Period > To')),
      skill_tags: [], sort_order: i, starred: false, disabled: false,
    }
    store.educations.push(ed)
  })

  let li = 0
  doc.querySelectorAll('MotherTongueList Description Label').forEach((el) => {
    const name = el.textContent?.trim()
    if (!name) return
    const sl: SpokenLanguage = {
      id: uuidv4(), resume_id: resumeId,
      name: { [loc]: name }, level: { [loc]: 'Native' },
      sort_order: li++, disabled: false,
    }
    store.spoken_languages.push(sl)
  })
  doc.querySelectorAll('ForeignLanguageList > ForeignLanguage').forEach((fl) => {
    const name = text(fl, 'Description Label')
    if (!name) return
    const level = text(fl, 'ProficiencyLevel Listening') || text(fl, 'ProficiencyLevel')
    const sl: SpokenLanguage = {
      id: uuidv4(), resume_id: resumeId,
      name: { [loc]: name }, level: level ? { [loc]: level } : {},
      sort_order: li++, disabled: false,
    }
    store.spoken_languages.push(sl)
  })

  return store
}
