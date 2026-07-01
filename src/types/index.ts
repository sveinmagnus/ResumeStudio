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

export interface ProjectIndustry {
  id: string
  industry_id: string
  name: LocalizedString        // snapshot of the registry name at link time
  sort_order: number
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
  /** Uploaded profile photo as a base64 data URL (distinct from profile_image_url, an external link). */
  profile_photo?: string | null
  /** Uploaded company / consultancy logo as a base64 data URL. */
  company_logo?: string | null
  /** Consultancy presenting the resume, e.g. "Cartavio AS". Used for the view footer copyright. */
  company_name?: string | null
  default_locale: string
  supported_locales: string[]
  /**
   * Per-warning "this is fine" acknowledgements for the Overview's "Needs
   * attention" panel: a warning key (e.g. `cert:<id>`, `stale:projects:<id>`)
   * → the ISO timestamp until which that warning stays suppressed. Lets the
   * consultant dismiss a flag they've judged irrelevant so it doesn't reappear
   * for a year (see `lib/freshness.ts`). Additive + optional — absent on data
   * written before this shipped; consumers default to `{}`. Lives on the
   * resume (not a top-level store array) so it round-trips through the backup
   * `profile` and never widens the section-key unions.
   */
  attention_dismissals?: Record<string, string>
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
  /**
   * Authoritative classification from the Quadim skill library (e.g.
   * "Technical", "Management", "Analytical"), stamped at import when the name
   * matches the library (roadmap F12 pt4). Optional/additive — manually-added
   * skills lack it and fall back to `skill_type` in the skill-matrix Category
   * column. Free string (the library taxonomy is richer than our enum).
   */
  classification?: string
  created_at: string
}

/**
 * A shared Industry registry entry (A8.1). Like Role, it lives in a global
 * registry (`data.industries`) and is referenced by `Project.industries[]`
 * (shape v4; a single `industry_id` pre-v4), so "Finance" / "finance" /
 * "Banking" can be consolidated with the same merge machinery as skills and
 * roles. Each `ProjectIndustry` snapshots the registry name at link time.
 */
export interface Industry {
  id: string
  resume_id: string
  name: LocalizedString
  sort_order: number
  disabled: boolean
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
  /**
   * Optional free-text grouping label for the Role registry's "by category"
   * view (e.g. "Architecture", "Leadership"). Additive/optional — absent roles
   * group under "Uncategorized". Not a registry of its own; the distinct values
   * across roles form the category headers.
   */
  category?: string | null
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

/**
 * A single key-competency entry — a short title plus a longer description,
 * summarising one facet of the consultant's skillset. Lives in its own
 * top-level collection, edited under the Personal Details → Key Competencies
 * tab, and rendered as a section in views (by default just below the profile).
 */
export interface KeyCompetency {
  id: string
  resume_id: string
  title: LocalizedString
  description: LocalizedString
  sort_order: number
  starred: boolean
  disabled: boolean
}

/**
 * A testimonial / recommendation received from a colleague or customer.
 * Recommender identity fields are plain strings (names are rarely localized);
 * the relationship and the quote itself are localized.
 */
export interface Recommendation {
  id: string
  resume_id: string
  recommender_name: string
  recommender_title: string | null
  recommender_company: string | null
  /** How the recommender knows the consultant (localized). */
  relationship: LocalizedString
  /** The testimonial text (localized). */
  text: LocalizedString
  /** When the recommendation was given. */
  date: YearMonth | null
  /** Where it came from, e.g. "LinkedIn". */
  source: string | null
  /** Link to the recommender / source profile. */
  contact_url: string | null
  sort_order: number
  starred: boolean
  disabled: boolean
}

export interface Project {
  id: string
  resume_id: string
  work_experience_id: string | null
  customer: LocalizedString
  customer_anonymized: LocalizedString
  use_anonymized: boolean
  /**
   * Industries this project belongs to — a multi-link into the shared Industry
   * registry (shape v4), mirroring `roles`/`skills`. A project can span several
   * sectors (e.g. "Banking" + "Public sector"). Each entry snapshots the
   * registry name at link time (the snapshot-name pattern). Migrated from the
   * pre-v4 single `industry`/`industry_id` pair.
   */
  industries: ProjectIndustry[]
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
  /**
   * Optional link to a registry Role. When set, the registry role's name is
   * the canonical title (and registry merges rewrite this id alongside
   * project role links). `role_title` stays as a free-text override so older
   * data without a registry link still renders.
   */
  role_id: string | null
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

/**
 * How much of a section's content the view renders.
 *  - 'off'     — omit the section entirely (sidebar shows it but greyed)
 *  - 'summary' — identifiers + dates only, one line per item, no descriptions
 *  - 'full'    — every field that section's renderer knows about
 */
export type SectionDetail = 'off' | 'summary' | 'full'

/** Visual density preset that scales line-height and inter-item spacing. */
export type Density = 'compact' | 'normal' | 'spacious'

/** Body text size preset — drives both HTML pt sizes and DOCX half-points. */
export type BodySize = 'small' | 'normal' | 'large'

/**
 * Heading typeface family. 'condensed' is the Cartavio default (Open Sans
 * Condensed). 'sans' and 'serif' are fallback choices for variation across
 * views without a full template system.
 */
export type HeadingFont = 'condensed' | 'sans' | 'serif'

/** Page padding preset. */
export type PageMargin = 'tight' | 'normal' | 'generous'

/** Skill / tag rendering: chip pills vs. inline comma-separated list. */
export type TagStyle = 'chips' | 'inline'

/** View-wide styling defaults — applied unless a section overrides. */
export interface ViewStyle {
  density: Density
  body_size: BodySize
  heading_font: HeadingFont
  /** CSS hex color (with leading '#') for accent — defaults to Cartavio navy. */
  accent_color: string
  page_margin: PageMargin
  tag_style: TagStyle
}

/**
 * Per-section style overrides. All optional — anything left undefined falls
 * back to the parent ViewStyle. Keep this set small and high-value; the
 * editor needs to expose every field.
 */
export interface SectionStyle {
  density?: Density
  /** Suppress the section heading entirely (renders items only). */
  hide_heading?: boolean
  /** Hide dates on items in this section. */
  hide_dates?: boolean
  /** Override the global tag chip / inline choice for projects + tech cats. */
  tag_style?: TagStyle
  /** Draw a hairline divider between items in this section (default: yes for full, no for summary). */
  item_divider?: boolean
}

export interface ViewSection {
  key: string
  detail: SectionDetail
  sort_order: number
  /** Optional per-section styling override. Sparse — only set fields override the view default. */
  style?: SectionStyle
}

// ─── View header & footer configuration ──────────────────────────────────────

/**
 * A single contact / detail row in a view header. The field's value is pulled
 * from the resume (or, for `languages`, summarised from spoken_languages).
 */
export type HeaderFieldKey =
  | 'phone' | 'email' | 'location' | 'nationality' | 'date_of_birth'
  | 'linkedin' | 'website' | 'twitter' | 'languages'

export interface HeaderField {
  key: HeaderFieldKey
  /** Whether this field is rendered in the header at all. */
  show: boolean
  /** Localized descriptor prefix, e.g. {no: 'Telefon: ', en: 'Phone: '}. Empty string = no prefix. */
  label: LocalizedString
  /** True = join the previous field's line (separated by ViewHeaderConfig.separator). False = start a new line. */
  same_line: boolean
  sort_order: number
}

/** Where the profile photo sits relative to the identity (name/title/contact) block. */
export type PhotoPlacement = 'none' | 'left' | 'right' | 'above' | 'below'

/**
 * How the profile photo is rendered in a Resume View — a square (the raw
 * cropped image), a square with rounded corners, or a circular mask. HTML/PDF
 * exports apply this via CSS border-radius; the DOCX exporter has to pre-mask
 * the embedded image since Word can't apply a CSS mask to an `ImageRun`.
 */
export type ProfileImageShape = 'square' | 'rounded' | 'circle'

/** Where the company logo sits in the top banner. */
export type LogoPlacement = 'none' | 'left' | 'center' | 'right'

/** Typography for a single header text element (the name or the title). */
export interface HeaderTextStyle {
  /** Explicit point size; null = derive from the view's body-size scale. */
  size_pt: number | null
  /** Font family — a heading font choice or the body font. */
  font: HeadingFont | 'body'
}

export interface ViewHeaderConfig {
  /** Configurable detail rows, in display order. */
  fields: HeaderField[]
  /** Separator string for fields sharing a line, e.g. ' | ' or ' · '. */
  separator: string
  name_style: HeaderTextStyle
  title_style: HeaderTextStyle
  photo_placement: PhotoPlacement
  /** Override the master profile photo for this view (base64 data URL). null = use the master photo. */
  photo_override: string | null
  /**
   * Visual shape of the rendered profile photo. Defaults to 'square'. HTML/PDF
   * paths apply this via CSS border-radius on the <img>; the DOCX exporter
   * pre-masks the bytes to a PNG with the appropriate alpha so Word renders
   * the same shape inside an `ImageRun`.
   */
  photo_shape: ProfileImageShape
  logo_placement: LogoPlacement
  /** Override the master company logo for this view (base64 data URL). null = use the master logo. */
  logo_override: string | null
}

/** A closing visual separator drawn at the end of the document. */
export type FooterSeparator = 'none' | 'line' | 'double' | 'dotted' | 'dashed' | 'thick'

/**
 * Whose name appears in the optional footer copyright line.
 *  - 'person'  — the resume's full_name
 *  - 'company' — the resume's company_name
 *  - 'custom'  — a per-view override string (copyright_custom)
 */
export type CopyrightHolder = 'none' | 'person' | 'company' | 'custom'

export interface ViewFooterConfig {
  separator: FooterSeparator
  copyright: CopyrightHolder
  /** Per-view copyright holder text, used when copyright === 'custom'. Localized. */
  copyright_custom: LocalizedString
  /** Optional localized note appended after the copyright line. */
  note: LocalizedString
}

export interface ResumeView {
  id: string
  name: string
  introduction: LocalizedString
  sections: ViewSection[]
  excluded_item_ids: string[]
  include_photo: boolean
  starred_only: boolean
  /**
   * Anonymize the whole export (roadmap F5): every project renders its
   * anonymized customer alias and references render with initials only.
   * Audience property, so it lives on the view — for agency/broker
   * submissions where client names must not leak. Optional (additive field):
   * older saved views simply lack it; consumers treat undefined as false.
   */
  force_anonymized?: boolean
  page_limit: number | null
  /** Last applied export template (lib/viewTemplates.ts), or null when fully custom. Informational — manual tweaks don't clear it. */
  template_id: string | null
  /**
   * Persisted default export locale for this view (roadmap F11): a Board CV is
   * always Norwegian, a partner CV always English. Optional/additive — when
   * absent or no longer supported, the editor falls back to the resume's first
   * locale. Set when the user picks an export language in the view editor.
   */
  export_locale?: string | null
  /** View-wide styling. Required on new views — older builds may not set it; consumers must tolerate undefined and use DEFAULT_VIEW_STYLE. */
  style: ViewStyle
  /** Header layout & content config. Required on new views; consumers tolerate undefined via withHeaderDefaults. */
  header: ViewHeaderConfig
  /** Footer / closing visual config. Required on new views; consumers tolerate undefined via withFooterDefaults. */
  footer: ViewFooterConfig
  last_exported_at: string | null
  created_at: string
  updated_at: string
}

// ─── Full resume store ────────────────────────────────────────────────────────

export interface ResumeStore {
  /**
   * Data-shape version stamp (see `lib/migrate.ts`). Absent on data written
   * before versioning existed (treated as 1). Bumped only for STRUCTURAL
   * migrations — additive optional fields stay covered by render-boundary
   * defaults (`with*Defaults`) and do not bump it. An older app may load data
   * carrying a higher version (best-effort, with an editor warning) and must
   * never downgrade the stamp.
   */
  shape_version?: number
  resume: Resume | null
  skills: Skill[]
  roles: Role[]
  industries: Industry[]
  key_qualifications: KeyQualification[]
  key_competencies: KeyCompetency[]
  recommendations: Recommendation[]
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

/**
 * The item-array sections of the store — everything except the singular
 * `resume` object and non-content metadata like `shape_version`. This is the
 * canonical "all sections" type; generic CRUD and sortable components alias it.
 */
export type SectionKey = Exclude<keyof ResumeStore, 'resume' | 'shape_version'>

export interface UIState {
  activeSection: string
  primaryLocale: string
  secondaryLocale: string | null
  expandedItemId: string | null
}
