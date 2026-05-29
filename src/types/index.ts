// ─── Primitives ──────────────────────────────────────────────────────────────

export type LocalizedString = Record<string, string>

export interface YearMonth {
  year: number
  month: number | null
}

// ─── Sub-entities (embedded) ─────────────────────────────────────────────────

export interface KeyPoint {
  id: string
  name: LocalizedString
  long_description: LocalizedString
  sort_order: number
  disabled: boolean
}

export interface ProjectRole {
  id: string
  role_id: string
  name: LocalizedString        // snapshot
  sort_order: number
  disabled: boolean
}

export interface ProjectSkill {
  id: string
  skill_id: string
  name: LocalizedString        // snapshot
  duration_in_years: number
  offset_in_years: number
  total_duration_in_years: number
  sort_order: number
}

export interface CategorySkill {
  id: string
  skill_id: string
  name: LocalizedString        // snapshot
  proficiency: number
  total_duration_in_years: number
  sort_order: number
}

// ─── Main entities ────────────────────────────────────────────────────────────

export interface Resume {
  id: string
  full_name: string
  email: string
  phone: string | null
  title: LocalizedString
  nationality: LocalizedString
  place_of_residence: LocalizedString
  date_of_birth: string | null
  twitter: string | null
  linkedin_url: string | null
  website_url: string | null
  profile_image_url: string | null
  default_locale: string
  supported_locales: string[]
  created_at: string
  updated_at: string
}

export interface Skill {
  id: string
  resume_id: string
  name: LocalizedString
  default_category: LocalizedString | null
  skill_type: 'technical' | 'methodology' | 'domain' | 'soft'
  total_duration_in_years: number
  proficiency: number   // 0–5
  is_highlighted: boolean
  created_at: string
}

export interface Role {
  id: string
  resume_id: string
  name: LocalizedString
  years_of_experience: number
  years_of_experience_offset: number
  starred: boolean
  sort_order: number
  disabled: boolean
}

export interface KeyQualification {
  id: string
  resume_id: string
  label: LocalizedString
  tag_line: LocalizedString
  summary: LocalizedString
  key_points: KeyPoint[]
  skill_tags: string[]
  sort_order: number
  starred: boolean
  disabled: boolean
  internal_notes: string | null
}

export interface Project {
  id: string
  resume_id: string
  work_experience_id: string | null
  customer: LocalizedString
  customer_anonymized: LocalizedString
  use_anonymized: boolean
  industry: LocalizedString
  description: LocalizedString
  long_description: LocalizedString
  highlights: LocalizedString[]
  roles: ProjectRole[]
  skills: ProjectSkill[]
  start: YearMonth | null
  end: YearMonth | null
  percent_allocated: number | null
  team_size: number | null
  location_country_code: string | null
  external_url: string | null
  skill_tags: string[]
  sort_order: number
  starred: boolean
  disabled: boolean
  internal_notes: string | null
}

export interface WorkExperience {
  id: string
  resume_id: string
  employer: LocalizedString
  role_title: LocalizedString
  description: LocalizedString
  long_description: LocalizedString
  employment_type: 'permanent' | 'contract' | 'freelance' | 'part_time' | null
  company_size: string | null
  company_url: string | null
  start: YearMonth | null
  end: YearMonth | null
  skill_tags: string[]
  sort_order: number
  starred: boolean
  disabled: boolean
  internal_notes: string | null
}

export interface Education {
  id: string
  resume_id: string
  school: LocalizedString
  degree: LocalizedString
  description: LocalizedString
  grade: string | null
  exchange: boolean
  start: YearMonth | null
  end: YearMonth | null
  skill_tags: string[]
  sort_order: number
  starred: boolean
  disabled: boolean
}

export interface Course {
  id: string
  resume_id: string
  name: LocalizedString
  program: LocalizedString
  description: LocalizedString
  completed: YearMonth | null
  skill_ids: string[]
  skill_tags: string[]
  sort_order: number
  starred: boolean
  disabled: boolean
}

export interface Certification {
  id: string
  resume_id: string
  name: LocalizedString
  organiser: LocalizedString
  description: LocalizedString
  issued: YearMonth | null
  expires: YearMonth | null
  credential_url: string | null
  skill_ids: string[]
  skill_tags: string[]
  sort_order: number
  starred: boolean
  disabled: boolean
}

export interface SpokenLanguage {
  id: string
  resume_id: string
  name: LocalizedString
  level: LocalizedString
  sort_order: number
  disabled: boolean
}

export interface TechnologyCategory {
  id: string
  resume_id: string
  name: LocalizedString
  skills: CategorySkill[]
  sort_order: number
  disabled: boolean
}

export interface Position {
  id: string
  resume_id: string
  name: LocalizedString
  organisation: LocalizedString
  description: LocalizedString
  start: YearMonth | null
  end: YearMonth | null
  skill_tags: string[]
  sort_order: number
  starred: boolean
  disabled: boolean
}

export interface Presentation {
  id: string
  resume_id: string
  title: LocalizedString
  event: LocalizedString
  description: LocalizedString
  url: string | null
  date: YearMonth | null
  skill_tags: string[]
  sort_order: number
  starred: boolean
  disabled: boolean
}

export interface HonorAward {
  id: string
  resume_id: string
  name: LocalizedString
  issuer: LocalizedString
  for_work: LocalizedString
  description: LocalizedString
  date: YearMonth | null
  skill_tags: string[]
  sort_order: number
  disabled: boolean
}

export interface Publication {
  id: string
  resume_id: string
  title: LocalizedString
  publisher: LocalizedString
  co_authors: string[]
  abstract: LocalizedString
  url: string | null
  date: YearMonth | null
  publication_type: 'article' | 'whitepaper' | 'book' | 'book_chapter' | 'blog_post' | 'report'
  skill_tags: string[]
  sort_order: number
  starred: boolean
  disabled: boolean
  internal_notes: string | null
}

export interface Reference {
  id: string
  resume_id: string
  name: string
  title: string | null
  company: string | null
  relationship: LocalizedString
  email: string | null
  phone: string | null
  linkedin_url: string | null
  project_id: string | null
  work_experience_id: string | null
  include_in_exports: boolean
  internal_notes: string | null
}

export interface ViewSection {
  key: string
  enabled: boolean
  sort_order: number
}

export interface ResumeView {
  id: string
  name: string
  introduction: LocalizedString
  sections: ViewSection[]
  excluded_item_ids: string[]
  include_photo: boolean
  starred_only: boolean
  page_limit: number | null
  template_id: string | null
  last_exported_at: string | null
  created_at: string
  updated_at: string
}

// ─── Full resume store ────────────────────────────────────────────────────────

export interface ResumeStore {
  resume: Resume | null
  skills: Skill[]
  roles: Role[]
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
  views: ResumeView[]
}

// ─── UI state ────────────────────────────────────────────────────────────────

export type SectionKey = keyof Omit<ResumeStore, 'resume'>

export interface UIState {
  activeSection: string
  primaryLocale: string
  secondaryLocale: string | null
  expandedItemId: string | null
}
