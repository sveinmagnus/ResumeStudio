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
  /**
   * @deprecated as a user-editable total. Now a LEGACY FALLBACK base: the
   * skill's years of experience are computed from the calendar span of the
   * projects that reference it (`lib/experience.ts → skillExperience`); this
   * stored number is only used when the skill has no dated project usage (so
   * imported numbers aren't lost). The user-facing knob is
   * `experience_offset_years`.
   */
  total_duration_in_years: number
  /**
   * Signed manual ADJUSTMENT to the computed experience, in years (decimals =
   * month precision, e.g. 0.5 = +6 months, -0.25 = -3 months). Added on top of
   * the calendar time computed from referencing projects. Additive/optional —
   * absent reads as 0.
   */
  experience_offset_years?: number
  proficiency: number   // 0–5
  /**
   * Featured in the compact Skills Showcase view section (roadmap: showcase
   * unification) — the showcase renders every highlighted skill, grouped by
   * `category_id`. Also used for compact skill-summary rendering elsewhere.
   */
  is_highlighted: boolean
  /**
   * Authoritative classification from the Quadim skill library (e.g.
   * "Technical", "Management", "Analytical"), stamped at import when the name
   * matches the library (roadmap F12 pt4). Optional/additive. Used as the
   * skill-matrix Category column when present, else the linked `category_id`'s
   * name.
   */
  classification?: string
  /**
   * Link into the shared `ResumeStore.skill_categories` registry — the
   * consultant's own grouping (e.g. "Frontend", "Cloud", "Data"),
   * auto-fillable from the Quadim library. This is the SINGLE category
   * concept: the list card, the By-category view, the category filter AND
   * the Skills Showcase export section all group on it. `null`/absent reads
   * as "Uncategorized". Additive — pre-v6 data has this backfilled by
   * `migrate.ts` from the old free-text `category` string.
   */
  category_id?: string | null
  created_at: string
}

/**
 * A named grouping of skills (roadmap: showcase unification, shape v6) — the
 * consultant's own organisation of the Skill registry, referenced by
 * `Skill.category_id`. Also the source of the Skills Showcase export section:
 * every HIGHLIGHTED skill (`Skill.is_highlighted`) linked to a category is
 * rendered under that category's name (see `lib/showcase.ts`).
 *
 * Deliberately NOT a `SectionKey` / generic-CRUD section (see
 * `lib/skillCategorize.ts` for its dedicated pure helpers) — a category
 * persists after its last skill leaves (or is emptied by "Clear category"),
 * and is removed ONLY by an explicit delete, so generic array CRUD would be
 * the wrong shape for it.
 */
export interface SkillCategory {
  id: string
  resume_id: string
  name: LocalizedString
  /** Curated display / export order — drives the By-category view's header
   *  order and the Skills Showcase section's group order. */
  sort_order: number
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
  /**
   * @deprecated as a user-editable total. Now a LEGACY FALLBACK base: a role's
   * years of experience are computed from the calendar span of the projects,
   * employments and other-roles that link it (`lib/experience.ts →
   * roleExperience`); this stored number is only used when the role has no
   * dated assignments (so imported numbers aren't lost). The user-facing knob
   * is `years_of_experience_offset`.
   */
  years_of_experience: number
  /**
   * Signed manual ADJUSTMENT to the computed experience, in years (decimals =
   * month precision). Added on top of the calendar time computed from the
   * assignments that reference the role.
   */
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
  /** The long-form professional summary (rich text). */
  summary: LocalizedString
  /** A shorter alternative summary (rich text) for compact views. Additive/optional. */
  summary_short?: LocalizedString
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
  /** Single-line summary shown in a view's SUMMARY mode (in place of the long
   *  description used in FULL mode). Additive/optional. */
  short_description?: LocalizedString
  sort_order: number
  starred: boolean
  disabled: boolean
}

/**
 * A testimonial / recommendation received from a colleague or customer.
 * The recommender's name and company are plain strings (rarely localized);
 * their title/role, the relationship, and the quote itself are localized.
 */
export interface Recommendation {
  id: string
  resume_id: string
  recommender_name: string
  /** The recommender's title / role at the time (localized). */
  recommender_title: LocalizedString
  recommender_company: string | null
  /** How the recommender knows the consultant (localized). */
  relationship: LocalizedString
  /** The testimonial text (localized). */
  text: LocalizedString
  /** Single-line summary shown in SUMMARY mode (in place of the long text). Additive/optional. */
  short_description?: LocalizedString
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
  /** Single-line summary shown in SUMMARY mode (in place of the long description). Additive/optional. */
  short_description?: LocalizedString
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
  /** The company-specific position title (e.g. "Senior Consultant, Platform"). Free text, independent of the role-type links. */
  role_title: LocalizedString
  description: LocalizedString
  long_description: LocalizedString
  /** Single-line summary shown in SUMMARY mode (in place of the long description). Additive/optional. */
  short_description?: LocalizedString
  employment_type: 'permanent' | 'contract' | 'freelance' | 'part_time' | 'internship' | null
  /**
   * @deprecated Superseded by the company_size_* triple (shape v7). Kept so
   * pre-v7 data round-trips; `migrate.ts` seeds `company_size_national` from it.
   */
  company_size: string | null
  /** Descriptive headcount of the local company / office (free text, e.g. "~50"). Additive (shape v7). */
  company_size_local?: string | null
  /** Descriptive headcount of the national / regional division (free text). Additive (shape v7). */
  company_size_national?: string | null
  /** Descriptive headcount of the global group (free text, e.g. "40,000"). Additive (shape v7). */
  company_size_global?: string | null
  company_url: string | null
  start: YearMonth | null
  end: YearMonth | null
  /**
   * Optional links to registry Roles indicating the GENERAL role type(s) held
   * (e.g. "Architect", "Team Lead") — independent of the company-specific
   * `role_title`. Used to summarise experience across positions and by the Role
   * registry usage panel; registry merges rewrite these ids. Multiple allowed
   * (shape v7, migrated from the single pre-v7 `role_id`). Not shown in exports.
   */
  role_ids: string[]
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
  /** Single-line summary shown in SUMMARY mode. Additive/optional. */
  short_description?: LocalizedString
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
  /** Single-line summary shown in SUMMARY mode. Additive/optional. */
  short_description?: LocalizedString
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
  /** Single-line summary shown in SUMMARY mode. Additive/optional. */
  short_description?: LocalizedString
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

export interface Position {
  id: string
  resume_id: string
  name: LocalizedString
  organisation: LocalizedString
  description: LocalizedString
  /** Single-line summary shown in SUMMARY mode. Additive/optional. */
  short_description?: LocalizedString
  /** Classification for sorting/filtering (board_member, volunteer, mentor…; see lib/positionTypes.ts). Additive/optional. */
  position_type?: string | null
  start: YearMonth | null
  end: YearMonth | null
  /**
   * Optional links to registry Roles indicating the general role type(s) this
   * engagement represents (e.g. "Board Member", "Advisor") — so an "Other role"
   * feeds the Role registry's computed years-of-experience like employments and
   * projects do. Mirrors {@link WorkExperience.role_ids}. Additive/optional —
   * absent reads as `[]`. Registry merges rewrite these ids. Not shown in exports.
   */
  role_ids?: string[]
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
  /** Single-line summary shown in SUMMARY mode. Additive/optional. */
  short_description?: LocalizedString
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
  /** Single-line summary shown in SUMMARY mode. Additive/optional. */
  short_description?: LocalizedString
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
  /** Single-line summary shown in SUMMARY mode (in place of the abstract). Additive/optional. */
  short_description?: LocalizedString
  url: string | null
  date: YearMonth | null
  publication_type: 'article' | 'research' | 'whitepaper' | 'book' | 'book_chapter' | 'blog_post' | 'report' | 'thesis'
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

/**
 * Order of the three summary-line slots — Title, Organization, Date — on a
 * section rendered at `summary` detail (HTML/PDF). "Organization" is the item's
 * secondary descriptor (employer / publisher / school / event / role); "Date"
 * is its date or start–end range. Only affects the one-line summary layout.
 */
export type SummaryLayout =
  | 'title-org-date' | 'title-date-org'
  | 'org-title-date' | 'org-date-title'
  | 'date-title-org' | 'date-org-title'

/**
 * Layout of a `full`-detail item's title vs. its details line (HTML preview).
 * Two orthogonal axes folded into one enum:
 *  - title position — `title-*` = title first, then the details line;
 *    `lead-*` = the details line above the title.
 *  - meta order within the details line — `*-org-date` = organisation then date;
 *    `*-date-org` = date then organisation.
 * (The description/body always follows the head block, whichever order.)
 * Legacy values `'default'`/`'leading'` are normalised via
 * `viewStyle.normalizeFullLayout` (→ `title-org-date` / `lead-org-date`).
 */
export type FullLayout =
  | 'title-org-date' | 'title-date-org'
  | 'lead-org-date'  | 'lead-date-org'

/**
 * How a month-precision date renders in an exported view. The month is either a
 * word ("Mar") or a zero-padded number ("03"); the year can lead or trail:
 *  - 'month-year'     — "Mar 2021" (the default)
 *  - 'year-month'     — "2021 Mar"
 *  - 'month-year-num' — "03/2021"
 *  - 'year-month-num' — "2021/03"
 *  - 'year-only'      — "2021" (month suppressed even when known)
 */
export type DateFormat =
  | 'month-year' | 'year-month'
  | 'month-year-num' | 'year-month-num'
  | 'year-only'

/**
 * Visual treatment of the hairline drawn between items in a section (HTML/PDF).
 *  - line   — full-width hairline (the default)
 *  - thick  — heavier full-width rule
 *  - dashed / dotted / double — patterned full-width rules
 *  - short  — a short left-aligned rule
 *  - space  — no line, gap only
 */
export type DividerStyle = 'line' | 'thick' | 'dashed' | 'dotted' | 'double' | 'short' | 'space'

/** View-wide styling defaults — applied unless a section overrides. */
export interface ViewStyle {
  density: Density
  body_size: BodySize
  /**
   * Heading font — a font-catalog id (`lib/fonts.ts`) or the sentinel
   * `'inherit'` (use the app-wide default). The legacy `HeadingFont` ids
   * (`condensed`/`sans`/`serif`) are kept in the catalog so old views resolve
   * unchanged. Widened from the old `HeadingFont` enum.
   */
  heading_font: string
  /**
   * Body font — a font-catalog id or `'inherit'`. Additive/optional; absent
   * reads as the brand body font (Ubuntu). Previously the body font was fixed.
   */
  body_font?: string
  /** CSS hex color (with leading '#') for the ACCENT — section-heading
   *  underline, icons, dividers, tags. Defaults to Cartavio navy. */
  accent_color: string
  /**
   * CSS hex color for HEADING TEXT (name + all section/item headings). Additive/
   * optional — when absent it falls back to `accent_color`, so existing views
   * are unchanged. Lets headings use a different colour from the accent.
   */
  heading_color?: string
  page_margin: PageMargin
  tag_style: TagStyle
  /** Draw dividers between items view-wide (default true). Additive — consumers default to true. */
  item_divider?: boolean
  /** View-wide divider style (default 'line'). Additive — consumers default to 'line'. */
  divider_style?: DividerStyle
  /** View-wide default order of a summary line's slots (default 'title-org-date'). */
  summary_layout?: SummaryLayout
  /** View-wide default placement of a full item's date block (default 'default'). */
  date_position?: FullLayout
  /** View-wide default: lay summary items out as aligned columns (HTML/PDF). */
  tabulate?: boolean
  /** View-wide default date format (default 'month-year'). */
  date_format?: DateFormat
  /** Show the section's icon before its heading, view-wide (default false). */
  section_icons?: boolean
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
  /**
   * Replace the section heading with custom localized text (e.g. show Projects
   * under "Selected engagements"). Empty/absent → the canonical section label.
   * Ignored when hide_heading is set. Untrusted-import surface — resolved and
   * escaped at the render boundary like any other localized string.
   */
  heading_text?: LocalizedString
  /** Hide dates on items in this section. */
  hide_dates?: boolean
  /** Override the global tag chip / inline choice for projects + tech cats. */
  tag_style?: TagStyle
  /** Override whether a divider is drawn between items in this section. Undefined = inherit the view default. */
  item_divider?: boolean
  /** Override the divider style for this section. Undefined = inherit the view default. */
  divider_style?: DividerStyle
  /** Order of a summary line's slots for this section (overrides the view default). */
  summary_layout?: SummaryLayout
  /**
   * Where the date/details block sits on a full item (overrides the view
   * default). See {@link FullLayout}.
   */
  date_position?: FullLayout
  /**
   * Lay the section's SUMMARY items out as aligned columns (one column per
   * field — title, role, organization, start, end) instead of free-flowing
   * lines. HTML/PDF only. Overrides the view default.
   */
  tabulate?: boolean
  /** Override the date format for this section. Undefined = inherit the view default. */
  date_format?: DateFormat
  /**
   * In plain (non-tabulated) SUMMARY mode, where an item's `short_description`
   * sits relative to the core one-line summary: `'below'` on its own line
   * (default), or `'inline'` appended to the summary line. Undefined → 'below'.
   */
  short_desc_line?: 'inline' | 'below'
  /** Show/hide the section icon before its heading (overrides the view default). */
  show_icon?: boolean
  // ── Professional-summary (key_qualifications) part toggles ──
  // Which parts of each profile block render. Only read by the
  // key_qualifications renderer. Undefined defaults: label/tagline/long shown,
  // short hidden — so existing views are unchanged.
  /** Show the block's "about" heading (its label). Default true. */
  kq_show_label?: boolean
  /** Show the tag line. Default true. */
  kq_show_tagline?: boolean
  /** Show the short-form summary. Default false. */
  kq_show_short?: boolean
  /** Show the long-form summary. Default true. */
  kq_show_long?: boolean
}

/**
 * How a section's items are ordered — the persisted order is always `sort_order`
 * ("custom"); the rest are computed views (see `lib/sectionSort.ts`). Defined
 * here (a pure type) so `ViewSection.sort` can reference it; `sectionSort.ts`
 * re-exports it.
 */
export type SortMode =
  | 'custom' | 'alpha'
  | 'start' | 'start_asc'
  | 'end' | 'end_asc'
  | 'date' | 'date_asc'

export interface ViewSection {
  key: string
  detail: SectionDetail
  sort_order: number
  /** Optional per-section styling override. Sparse — only set fields override the view default. */
  style?: SectionStyle
  /**
   * Per-view item sort for this section (independent of the editor's own sort
   * mode). Absent = 'custom' (the resume's arranged `sort_order`). Lets one view
   * list e.g. courses newest-first while the master order stays hand-tuned.
   */
  sort?: SortMode
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

/**
 * Where the profile photo sits relative to the identity block.
 *  - left/right/above/below — beside/around the whole identity (name, title, contact)
 *  - left_of_name / right_of_name — beside the NAME + TITLE only, so the contact
 *    details drop below and use the full page width
 */
export type PhotoPlacement = 'none' | 'left' | 'right' | 'above' | 'below' | 'left_of_name' | 'right_of_name'

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
  /** Font family — a font-catalog id (`lib/fonts.ts`) or the sentinel `'body'`
   *  (use the view's body font). Widened from the old `HeadingFont` enum. */
  font: string
}

export interface ViewHeaderConfig {
  /** Configurable detail rows, in display order. */
  fields: HeaderField[]
  /** Separator string for fields sharing a line, e.g. ' | ' or ' · '. */
  separator: string
  name_style: HeaderTextStyle
  title_style: HeaderTextStyle
  /**
   * Override the professional title/headline shown under the name for this view
   * (localized). Empty/absent → the resume's Personal Details title. Lets a
   * Board CV read "Board Member" while a Consultant CV keeps the master title.
   */
  title_override?: LocalizedString
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
  positions: Position[]
  presentations: Presentation[]
  honor_awards: HonorAward[]
  publications: Publication[]
  references: Reference[]
  views: ResumeView[]
  /**
   * Skill-category entities (shape v6), kept independent of skill assignments
   * so an emptied category (last skill removed or recategorized) persists in
   * the By-category view and filters until it's EXPLICITLY deleted (the
   * header trash button / "Delete category…"). Additive/optional; the
   * displayed list is the union of this and the categories actually used by
   * skills (`lib/skillCategorize.ts → skillCategoryList`). Not a CRUD section
   * — see `SectionKey` below. Also the source of the Skills Showcase export
   * section (`lib/showcase.ts`) — a former, separate `technology_categories`
   * structure was unified into this.
   */
  skill_categories?: SkillCategory[]
}

// ─── UI state ────────────────────────────────────────────────────────────────

/**
 * The item-array sections of the store — everything except the singular
 * `resume` object and non-content metadata like `shape_version`. This is the
 * canonical "all sections" type; generic CRUD and sortable components alias it.
 */
export type SectionKey = Exclude<keyof ResumeStore, 'resume' | 'shape_version' | 'skill_categories'>

export interface UIState {
  activeSection: string
  primaryLocale: string
  secondaryLocale: string | null
  expandedItemId: string | null
}
