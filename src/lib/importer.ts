import { v4 as uuidv4 } from 'uuid'
import type {
  ResumeStore, Resume, Skill, Role, KeyQualification, Project,
  WorkExperience, Education, Course, Certification, SpokenLanguage,
  TechnologyCategory, Position, Presentation, HonorAward,
  LocalizedString, YearMonth, ProjectRole, ProjectSkill, CategorySkill, KeyPoint
} from '../types'
import { appendLocalized, buildRoleParagraph } from './migrate'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localized(val: unknown): LocalizedString {
  if (!val) return {}
  if (typeof val === 'string') return { en: val }
  if (Array.isArray(val)) {
    // CVpartner format: ['no', 'int', 'no_value', 'int_value']
    const result: LocalizedString = {}
    for (let i = 0; i < val.length - 1; i += 2) {
      const locale = val[i] as string
      const text = val[i + 1] as string
      if (text && typeof text === 'string' && text.trim()) {
        const key = locale === 'int' ? 'en' : locale
        result[key] = text.trim()
      }
    }
    return result
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, string>
    const result: LocalizedString = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'string' && v.trim()) {
        result[k === 'int' ? 'en' : k] = v.trim()
      }
    }
    return result
  }
  return {}
}

function yearMonth(year?: string | number, month?: string | number): YearMonth | null {
  if (!year) return null
  return {
    year: typeof year === 'string' ? parseInt(year) : year,
    month: month ? (typeof month === 'string' ? parseInt(month) : month) : null
  }
}

function durationFromProject(p: CVProject): number {
  if (!p.year_from) return 0
  const from = new Date(parseInt(p.year_from), p.month_from ? parseInt(p.month_from) - 1 : 0)
  const to = p.year_to && p.year_to !== ''
    ? new Date(parseInt(p.year_to), p.month_to ? parseInt(p.month_to) - 1 : 11)
    : new Date()
  return Math.max(0, (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 365.25))
}

// ─── CVpartner raw types ──────────────────────────────────────────────────────

interface CVProject {
  _id: string
  customer?: unknown
  customer_anonymized?: unknown
  customer_selected?: string
  description?: unknown
  long_description?: unknown
  industry?: unknown
  roles?: CVProjectRole[]
  project_experience_skills?: CVProjectSkill[]
  year_from?: string
  year_to?: string
  month_from?: string
  month_to?: string
  percent_allocated?: string
  related_work_experience_id?: string | null
  location_country_code?: string | null
  disabled?: boolean
  starred?: boolean
  order?: number
}

interface CVProjectRole {
  _id: string
  cv_role_id?: string
  name?: unknown
  long_description?: unknown
  summary?: unknown
  order?: number | null
  disabled?: boolean
}

interface CVProjectSkill {
  _id: string
  tags?: unknown
  proficiency?: number
  base_duration_in_years?: number
  offset_duration_in_years?: number
  total_duration_in_years?: number
  order?: number
}

// ─── Main import function ─────────────────────────────────────────────────────

export function importFromCVPartner(raw: Record<string, unknown>): ResumeStore {
  const resumeId = uuidv4()
  const now = new Date().toISOString()

  // ── Detect all locales actually used anywhere in the data ──────────────────
  const detectedLocales = new Set<string>()
  const scanLocales = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) { obj.forEach(scanLocales); return }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (['no', 'int', 'se', 'dk', 'en', 'de', 'fr', 'es'].includes(k) && typeof v === 'string' && v.trim()) {
        detectedLocales.add(k === 'int' ? 'en' : k)
      } else if (typeof v === 'object') {
        scanLocales(v)
      }
    }
  }
  scanLocales(raw.project_experiences)
  scanLocales(raw.work_experiences)
  scanLocales(raw.key_qualifications)

  // ── Resume header ──────────────────────────────────────────────────────────
  const resume: Resume = {
    id: resumeId,
    full_name: (raw.name as string) || (raw.navn as string) || '',
    email: (raw.email as string) || '',
    phone: (raw.telefon as string) || null,
    title: localized(raw.title),
    nationality: localized(raw.nationality),
    place_of_residence: localized(raw.place_of_residence),
    date_of_birth: raw.born_year
      ? `${raw.born_year}-${String(raw.born_month || 1).padStart(2,'0')}-${String(raw.born_day || 1).padStart(2,'0')}`
      : null,
    twitter: (raw.twitter as string) || null,
    linkedin_url: null,
    website_url: null,
    profile_image_url: (raw.image as string) || null,
    profile_photo: null,
    company_logo: null,
    company_name: null,
    default_locale: (raw.language_code as string) === 'no' ? 'no' : 'en',
    supported_locales: (() => {
      const codes = (raw.language_codes as string[]) || [raw.language_code as string || 'no']
      const mapped = codes.map(c => c === 'int' ? 'en' : c)
      // Merge in all locales detected in the actual content
      detectedLocales.forEach(l => { if (!mapped.includes(l)) mapped.push(l) })
      if (!mapped.includes('en')) mapped.push('en')
      // Put primary (no) first, then en, then others
      const ordered = [...new Set(mapped)].sort((a, b) => {
        const rank = (l: string) => l === 'no' ? 0 : l === 'en' ? 1 : 2
        return rank(a) - rank(b)
      })
      return ordered
    })(),
    created_at: (raw.created_at as string) || now,
    updated_at: now,
  }

  // ── Skills — build global registry from technology_skills ─────────────────
  const skillIdMap = new Map<string, string>() // cvpartner _id → our uuid
  const skills: Skill[] = []

  const techCats = (raw.technologies as Array<Record<string, unknown>>) || []
  for (const cat of techCats) {
    const techSkills = (cat.technology_skills as CVProjectSkill[]) || []
    for (const ts of techSkills) {
      const ourId = uuidv4()
      skillIdMap.set(ts._id, ourId)
      skills.push({
        id: ourId,
        resume_id: resumeId,
        name: localized(ts.tags),
        default_category: localized(cat.category) || null,
        skill_type: 'technical',
        total_duration_in_years: ts.total_duration_in_years || 0,
        proficiency: ts.proficiency || 0,
        is_highlighted: false,
        created_at: now,
      })
    }
  }

  // Also collect any project skills not already in the registry
  const existingSkillNames = new Set(skills.map(s => Object.values(s.name)[0]?.toLowerCase()))
  const projectSkillIdMap = new Map<string, string>() // for project skill instances

  const rawProjects = (raw.project_experiences as CVProject[]) || []
  for (const p of rawProjects) {
    for (const ps of (p.project_experience_skills || [])) {
      const name = localized(ps.tags)
      const nameVal = Object.values(name)[0]?.toLowerCase()
      if (nameVal && !existingSkillNames.has(nameVal)) {
        const ourId = uuidv4()
        projectSkillIdMap.set(ps._id, ourId)
        existingSkillNames.add(nameVal)
        skills.push({
          id: ourId,
          resume_id: resumeId,
          name,
          default_category: null,
          skill_type: 'technical',
          total_duration_in_years: ps.total_duration_in_years || 0,
          proficiency: ps.proficiency || 0,
          is_highlighted: false,
          created_at: now,
        })
      } else {
        // find existing
        const existing = skills.find(s =>
          Object.values(s.name)[0]?.toLowerCase() === nameVal
        )
        if (existing) projectSkillIdMap.set(ps._id, existing.id)
      }
    }
  }

  // ── Roles — build global registry from cv_roles ────────────────────────────
  const roleIdMap = new Map<string, string>()
  const roles: Role[] = []

  const cvRoles = (raw.cv_roles as Array<Record<string, unknown>>) || []
  for (const r of cvRoles) {
    const ourId = uuidv4()
    roleIdMap.set(r._id as string, ourId)
    roles.push({
      id: ourId,
      resume_id: resumeId,
      name: localized(r.name),
      years_of_experience: (r.years_of_experience as number) || 0,
      years_of_experience_offset: (r.years_of_experience_offset as number) || 0,
      starred: (r.starred as boolean) || false,
      sort_order: (r.order as number) || 0,
      disabled: (r.disabled as boolean) || false,
    })
  }

  // ── Key qualifications ────────────────────────────────────────────────────
  const key_qualifications: KeyQualification[] = []
  const kqs = (raw.key_qualifications as Array<Record<string, unknown>>) || []
  for (const kq of kqs) {
    const kpoints = (kq.key_points as Array<Record<string, unknown>>) || []
    const keyPoints: KeyPoint[] = kpoints.map((kp, i) => ({
      id: uuidv4(),
      name: localized(kp.name),
      long_description: localized(kp.long_description),
      sort_order: (kp.order as number) || i,
      disabled: (kp.disabled as boolean) || false,
    }))
    key_qualifications.push({
      id: uuidv4(),
      resume_id: resumeId,
      label: localized(kq.label),
      tag_line: localized(kq.tag_line),
      summary: localized(kq.long_description),
      key_points: keyPoints,
      skill_tags: [],
      sort_order: (kq.order as number) || 0,
      starred: (kq.starred as boolean) || false,
      disabled: (kq.disabled as boolean) || false,
      internal_notes: null,
    })
  }

  // ── Work-experience id map — built up-front so projects can resolve
  //    related_work_experience_id while we iterate them below.
  const workIdMap = new Map<string, string>()
  const rawWork = (raw.work_experiences as Array<Record<string, unknown>>) || []
  for (const w of rawWork) {
    workIdMap.set(w._id as string, uuidv4())
  }

  // ── Projects ──────────────────────────────────────────────────────────────
  const projects: Project[] = []

  for (const p of rawProjects) {
    // Project description starts from the project's own long_description, then
    // each role's free text is folded in — we keep a single description field
    // per project rather than separating background from role descriptions.
    let projectLongDescription = localized(p.long_description)

    const projectRoles: ProjectRole[] = (p.roles || []).map((r, i) => {
      const globalRoleId = r.cv_role_id ? roleIdMap.get(r.cv_role_id) : undefined
      projectLongDescription = appendLocalized(
        projectLongDescription,
        buildRoleParagraph({
          name: localized(r.name),
          long_description: localized(r.long_description),
          summary: localized(r.summary),
        }),
      )
      return {
        id: uuidv4(),
        role_id: globalRoleId || uuidv4(),
        name: localized(r.name),
        sort_order: r.order || i,
        disabled: r.disabled || false,
      }
    })

    const duration = durationFromProject(p)
    const projectSkills: ProjectSkill[] = (p.project_experience_skills || []).map((ps, i) => {
      const globalSkillId = projectSkillIdMap.get(ps._id) || skillIdMap.get(ps._id) || uuidv4()
      const offset = ps.offset_duration_in_years || 0
      return {
        id: uuidv4(),
        skill_id: globalSkillId,
        name: localized(ps.tags),
        duration_in_years: duration,
        offset_in_years: offset,
        total_duration_in_years: duration + offset,
        sort_order: ps.order || i,
      }
    })

    projects.push({
      id: uuidv4(),
      resume_id: resumeId,
      work_experience_id: p.related_work_experience_id
        ? workIdMap.get(p.related_work_experience_id) || null
        : null,
      customer: localized(p.customer),
      customer_anonymized: localized(p.customer_anonymized),
      use_anonymized: p.customer_selected === 'customer_anonymized',
      industry: localized(p.industry),
      description: localized(p.description),
      long_description: projectLongDescription,
      highlights: [],
      roles: projectRoles,
      skills: projectSkills,
      start: yearMonth(p.year_from, p.month_from),
      end: p.year_to && p.year_to !== '' ? yearMonth(p.year_to, p.month_to) : null,
      percent_allocated: p.percent_allocated ? parseInt(p.percent_allocated) : null,
      team_size: null,
      location_country_code: p.location_country_code || null,
      external_url: null,
      skill_tags: [],
      sort_order: p.order || 0,
      starred: p.starred || false,
      disabled: p.disabled || false,
      internal_notes: null,
    })
  }

  // ── Work experiences ──────────────────────────────────────────────────────
  // (rawWork and workIdMap were populated above so projects could reference them)
  const work_experiences: WorkExperience[] = []
  for (const w of rawWork) {
    const ourId = workIdMap.get(w._id as string)!
    work_experiences.push({
      id: ourId,
      resume_id: resumeId,
      employer: localized(w.employer),
      role_title: localized(w.description),
      description: localized(w.description),
      long_description: localized(w.long_description),
      employment_type: null,
      company_size: null,
      company_url: null,
      start: yearMonth(w.year_from as string, w.month_from as string),
      end: w.year_to && w.year_to !== '' ? yearMonth(w.year_to as string, w.month_to as string) : null,
      skill_tags: [],
      sort_order: (w.order as number) || 0,
      starred: (w.starred as boolean) || false,
      disabled: (w.disabled as boolean) || false,
      internal_notes: null,
    })
  }

  // ── Educations ────────────────────────────────────────────────────────────
  const educations: Education[] = []
  const rawEdu = (raw.educations as Array<Record<string, unknown>>) || []
  for (const e of rawEdu) {
    educations.push({
      id: uuidv4(),
      resume_id: resumeId,
      school: localized(e.school),
      degree: localized(e.degree),
      description: localized(e.description),
      grade: null,
      exchange: false,
      start: yearMonth(e.year_from as string, e.month_from as string),
      end: e.year_to && e.year_to !== '' ? yearMonth(e.year_to as string, e.month_to as string) : null,
      skill_tags: [],
      sort_order: (e.order as number) || 0,
      starred: (e.starred as boolean) || false,
      disabled: (e.disabled as boolean) || false,
    })
  }

  // ── Courses ───────────────────────────────────────────────────────────────
  const courses: Course[] = []
  const rawCourses = (raw.courses as Array<Record<string, unknown>>) || []
  for (const c of rawCourses) {
    courses.push({
      id: uuidv4(),
      resume_id: resumeId,
      name: localized(c.name),
      program: localized(c.program),
      description: localized(c.long_description),
      completed: yearMonth(c.year as string, c.month as string),
      skill_ids: [],
      skill_tags: [],
      sort_order: (c.order as number) || 0,
      starred: (c.starred as boolean) || false,
      disabled: (c.disabled as boolean) || false,
    })
  }

  // ── Certifications ────────────────────────────────────────────────────────
  const certifications: Certification[] = []
  const rawCerts = (raw.certifications as Array<Record<string, unknown>>) || []
  for (const c of rawCerts) {
    certifications.push({
      id: uuidv4(),
      resume_id: resumeId,
      name: localized(c.name),
      organiser: localized(c.organiser),
      description: localized(c.long_description),
      issued: yearMonth(c.year as string, c.month as string),
      expires: c.year_expire ? yearMonth(c.year_expire as string, c.month_expire as string) : null,
      credential_url: null,
      skill_ids: [],
      skill_tags: [],
      sort_order: (c.order as number) || 0,
      starred: (c.starred as boolean) || false,
      disabled: (c.disabled as boolean) || false,
    })
  }

  // ── Spoken languages ──────────────────────────────────────────────────────
  const spoken_languages: SpokenLanguage[] = []
  const rawLangs = (raw.languages as Array<Record<string, unknown>>) || []
  for (const l of rawLangs) {
    spoken_languages.push({
      id: uuidv4(),
      resume_id: resumeId,
      name: localized(l.name),
      level: localized(l.level),
      sort_order: (l.order as number) || 0,
      disabled: (l.disabled as boolean) || false,
    })
  }

  // ── Technology categories ─────────────────────────────────────────────────
  const technology_categories: TechnologyCategory[] = []
  for (const cat of techCats) {
    const techSkills = (cat.technology_skills as CVProjectSkill[]) || []
    const catSkills: CategorySkill[] = techSkills.map((ts, i) => {
      const globalSkillId = skillIdMap.get(ts._id) || uuidv4()
      const globalSkill = skills.find(s => s.id === globalSkillId)
      return {
        id: uuidv4(),
        skill_id: globalSkillId,
        name: localized(ts.tags),
        proficiency: ts.proficiency || 0,
        total_duration_in_years: ts.total_duration_in_years || globalSkill?.total_duration_in_years || 0,
        sort_order: ts.order || i,
      }
    })
    technology_categories.push({
      id: uuidv4(),
      resume_id: resumeId,
      name: localized(cat.category),
      skills: catSkills,
      sort_order: (cat.order as number) || 0,
      disabled: (cat.disabled as boolean) || false,
    })
  }

  // ── Positions ────────────────────────────────────────────────────────────
  const positions: Position[] = []
  const rawPos = (raw.positions as Array<Record<string, unknown>>) || []
  for (const p of rawPos) {
    positions.push({
      id: uuidv4(),
      resume_id: resumeId,
      name: localized(p.name),
      organisation: localized(p.description),
      description: {},
      start: yearMonth(p.year_from as string),
      end: p.year_to && p.year_to !== '' ? yearMonth(p.year_to as string) : null,
      skill_tags: [],
      sort_order: (p.order as number) || 0,
      starred: (p.starred as boolean) || false,
      disabled: (p.disabled as boolean) || false,
    })
  }

  // ── Presentations ────────────────────────────────────────────────────────
  const presentations: Presentation[] = []
  const rawPres = (raw.presentations as Array<Record<string, unknown>>) || []
  for (const p of rawPres) {
    presentations.push({
      id: uuidv4(),
      resume_id: resumeId,
      title: localized(p.description),
      event: {},
      description: localized(p.long_description),
      url: null,
      date: yearMonth(p.year as string, p.month as string),
      skill_tags: [],
      sort_order: (p.order as number) || 0,
      starred: (p.starred as boolean) || false,
      disabled: (p.disabled as boolean) || false,
    })
  }

  // ── Honors & awards ──────────────────────────────────────────────────────
  const honor_awards: HonorAward[] = []
  const rawAwards = (raw.honors_awards as Array<Record<string, unknown>>) || []
  for (const a of rawAwards) {
    honor_awards.push({
      id: uuidv4(),
      resume_id: resumeId,
      name: localized(a.name),
      issuer: localized(a.issuer),
      for_work: localized(a.for_work),
      description: localized(a.long_description),
      date: yearMonth(a.year as string, a.month as string),
      skill_tags: [],
      sort_order: (a.order as number) || 0,
      disabled: (a.disabled as boolean) || false,
    })
  }

  return {
    resume,
    skills,
    roles,
    key_qualifications,
    key_competencies: [],
    recommendations: [],
    projects,
    work_experiences,
    educations,
    courses,
    certifications,
    spoken_languages,
    technology_categories,
    positions,
    presentations,
    honor_awards,
    publications: [],
    references: [],
    views: [],
  }
}
