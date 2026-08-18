/**
 * PURE: the section-descriptor catalog (roadmap A5). One entry per content
 * section declaring how its items present as *data* — editor title/subtitle,
 * one-line summary, and the full item view. Every render adapter
 * (`viewFilter.renderItem`, `viewFilter.getItemTitle/getItemSubtitle`,
 * `exporter.renderSection`) reads this catalog rather than enumerating sections
 * in a switch of its own.
 *
 * SECURITY: descriptors return plain text or allowlisted rich-text *strings* —
 * never HTML/XML markup. The two render adapters own the escape boundary:
 * `viewFilter.ts` (escapeHtml / renderRichHtml) for the HTML/PDF path and
 * `exporter.ts` (TextRun, which XML-escapes) for DOCX. Do not concatenate
 * markup in this file.
 *
 * The HTML and DOCX paths differ in small ways. Every deliberate difference is
 * made *visible*: descriptors branch on `ctx.target`, so it lives here in one
 * reviewed file rather than drifting between two parallel switch statements.
 */

import type { LocalizedString } from '../types'
import { publicationTypeLabel } from './publicationTypes'
import { positionTypeLabel } from './positionTypes'
import { resolve, fmtRange, fmtDate, presentLabel, bcp47, type DateFormat } from './locales'
import { xs, xt } from './exportStrings'
import { cefrLines, type CefrMap } from './cefr'

export type AnyItem = Record<string, unknown>
type YM = { year: number; month: number | null } | null

export interface CatalogCtx {
  locale: string
  /** Section style's hide_dates — blank all date output when true. */
  hideDates: boolean
  /** Resolved date format for the section (default 'month-year'). */
  dateFormat?: DateFormat
  /**
   * Which render pipeline is asking. It selects LAYOUT ONLY — title sizing,
   * spacing, and how a title/meta pair is composed. It must never select which
   * FACTS an item carries: that drift is what let the DOCX export print a
   * project's team size and highlights while the preview and the ATS text
   * silently dropped them, so the consultant could not see what they were
   * sending. Optional facts are chosen per view via `extras`, not per target.
   */
  target: 'html' | 'docx'
  /**
   * Optional content groups this view switched on for the section
   * (lib/sectionExtras). Absent = none: every group is opt-in.
   */
  extras?: ReadonlySet<string>
  /**
   * Which detail mode is asking for this summary — 'plain' for a free-flowing
   * line, 'tabulated' for the column grid. Almost every descriptor ignores it:
   * the same parts serve both, and the renderer decides the arrangement.
   *
   * Languages is the exception. Its Europass levels belong in their own COLUMN
   * when tabulated, but would bloat a plain summary line, so its descriptor
   * emits them only when the grid asks. Absent → 'plain'.
   */
  detail?: 'plain' | 'tabulated'
  /** Professional-summary (key_qualifications) part visibility. Only the KQ
   *  descriptor reads this; absent → its documented defaults. */
  kq?: { tagline: boolean; short: boolean; long: boolean }
}

/** One bullet point under an item. `label` is plain text, `body` is rich text. */
export interface ItemPoint { label: string; body: string }

/**
 * The full-detail data view of one item. All strings are data (plain unless
 * noted rich); the adapters decide markup, escaping, fonts and spacing.
 */
export interface ItemView {
  layout: 'default' | 'inline' | 'quote'
  /** Plain title. Empty string = the adapter skips the title block. */
  title: string
  /** Plain date string kept SEPARATE from `meta` so each adapter can place it:
   *  the DOCX/PDF adapters set it faintly after the title; the HTML adapter
   *  composes it into the details line at the position the view's full-item
   *  layout asks for (before or after the organisation meta). */
  date: string
  /** Plain meta segments, joined with ' · ' by the adapters. */
  meta: string[]
  /** Rich-text main body (allowlisted markup from lib/richText). */
  body: string
  /** Plain paragraph rendered before `body` (DOCX project short description). */
  plainBody: string
  /** Plain secondary lines (URLs, grades, contact details) — subtle styling. */
  extraLines: string[]
  /** Plain tag names (skills). Suppressed in summary mode by the adapters. */
  tags: string[]
  /** Label prefixed to the DOCX tags line ('Skills: ' on projects, '' on tech categories). */
  tagsLabel: string
  points: ItemPoint[]
  /** quote layout: plain attribution ("Name, Title, Company"). */
  attribution: string
  /** quote layout: plain trailing segments ("(relationship)", date). */
  attributionMeta: string[]
  /** DOCX title sizing: 'large' = h3+1pt (projects/work), 'body' = body-size bold. */
  titleStyle: 'large' | 'body'
  /** DOCX spacing before the title paragraph, in twips. 0 = library default. */
  spacingBefore: number
}

/**
 * One-line summary, expressed as ordered semantic parts rather than a fixed
 * title + meta. The HTML adapter reorders and column-tabulates these per the
 * view's item-layout config; the DOCX / text adapters flatten them back to a
 * title + meta line via {@link summaryTitleMeta} (unchanged output).
 *
 *  - title — the item's primary name (anchor; always present)
 *  - role  — a role / degree / position-type descriptor
 *  - org   — the organisation / publisher / school / event / issuer
 *  - start / end — a date range, split so tabulate can column each
 *  - date  — a single date (sections without a range)
 */
export type SummaryPartKey = 'title' | 'role' | 'org' | 'date' | 'start' | 'end'
/**
 * `value` is PLAIN TEXT — never markup (adapters own escaping). A '\n' in it
 * means a hard line break within that part: the tabulated grid renders one per
 * line inside the cell (Languages' Europass column is the only user today).
 * Plain summary lines flatten it back to a space.
 */
export interface SummaryPart { key: SummaryPartKey; value: string }
/** `sep` only affects the HTML adapter ('—' vs ':'). */
export interface SummaryView { parts: SummaryPart[]; sep: '—' | ':' }

/**
 * Flatten a structured summary back to the legacy title + meta line, in the
 * catalog's default part order. The DOCX and plain-text adapters use this so
 * their output is unaffected by the HTML-only item-layout / tabulate features.
 * A start/end pair is re-joined into a single "start – end" range segment.
 */
export function summaryTitleMeta(v: SummaryView): { title: string; meta: string[] } {
  let title = ''
  let start = ''
  let end = ''
  const meta: string[] = []
  for (const p of v.parts) {
    if (p.key === 'title') { title = p.value; continue }
    if (p.key === 'start') { start = p.value; continue }
    if (p.key === 'end') { end = p.value; continue }
    if (p.value) meta.push(p.value)
  }
  const range = [start, end].filter(Boolean).join(' – ')
  if (range) meta.push(range)
  return { title, meta }
}

export interface SectionDescriptor {
  /** Editor-facing title (View editor item list). Shows raw data — no anonymization. */
  title(it: AnyItem, locale: string): string
  /** Editor-facing subtitle. */
  subtitle?(it: AnyItem, locale: string): string
  /** Render data for detail='summary'. null = skip this item. */
  summary?(it: AnyItem, ctx: CatalogCtx): SummaryView | null
  /** Render data for detail='full'. null = skip this item. */
  full?(it: AnyItem, ctx: CatalogCtx): ItemView | null
  /** Render the full layout even when the view says summary (spoken languages). */
  alwaysFull?: boolean
  /** DOCX sorts these by start date, newest first. The HTML path keeps store
   *  order (what the user arranged) — historical drift, kept deliberately. */
  docxSortByStart?: boolean
}

// ─── Field helpers ────────────────────────────────────────────────────────────

const ls = (it: AnyItem, field: string, locale: string): string =>
  resolve(it[field] as LocalizedString | undefined, locale)

const range = (it: AnyItem, ctx: CatalogCtx): string =>
  ctx.hideDates ? '' : fmtRange(it.start as YM, it.end as YM, ctx.dateFormat, ctx.locale)

const dateAt = (it: AnyItem, field: string, ctx: CatalogCtx): string =>
  ctx.hideDates ? '' : fmtDate(it[field] as YM, ctx.dateFormat, ctx.locale)

/** Split a start/end range into separately-formatted parts (for tabulation). */
const rangeParts = (it: AnyItem, ctx: CatalogCtx): { start: string; end: string } => {
  if (ctx.hideDates) return { start: '', end: '' }
  const start = fmtDate(it.start as YM, ctx.dateFormat, ctx.locale)
  const end = it.end ? fmtDate(it.end as YM, ctx.dateFormat, ctx.locale) : (start ? presentLabel(ctx.locale) : '')
  return { start, end }
}

const rawRange = (it: AnyItem): string => fmtRange(it.start as YM, it.end as YM)

/** Is this optional content group switched on for the section being rendered? */
const on = (ctx: CatalogCtx, group: string): boolean => !!ctx.extras?.has(group)

/** A plain string field, trimmed. Empty for anything that isn't one. */
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * A country code as its name in the reader's language, via Intl — so the
 * fifteen offered locales need no country table of their own. Falls back to
 * the code itself: "NO" is still information, a blank line is not.
 */
const countryName = (code: unknown, locale: string): string => {
  const c = str(code)
  if (c.length !== 2) return c
  try {
    return new Intl.DisplayNames([bcp47(locale)], { type: 'region' }).of(c.toUpperCase()) ?? c
  } catch {
    return c
  }
}

const view = (partial: Partial<ItemView>): ItemView => ({
  layout: 'default', title: '', date: '', meta: [], body: '', plainBody: '',
  extraLines: [], tags: [], tagsLabel: '', points: [], attribution: '',
  attributionMeta: [], titleStyle: 'body', spacingBefore: 0, ...partial,
})

/**
 * Build a structured summary from named slots. Emits parts in the catalog's
 * DEFAULT order (title, role, org, then date/range); the HTML renderer reorders
 * them per the view's item-layout config. Empty slots are dropped.
 */
const summaryOf = (opts: {
  title: string
  role?: string
  org?: string
  date?: string
  start?: string
  end?: string
  sep?: '—' | ':'
}): SummaryView => {
  const parts: SummaryPart[] = [{ key: 'title', value: opts.title }]
  if (opts.role)  parts.push({ key: 'role',  value: opts.role })
  if (opts.org)   parts.push({ key: 'org',   value: opts.org })
  if (opts.start) parts.push({ key: 'start', value: opts.start })
  if (opts.end)   parts.push({ key: 'end',   value: opts.end })
  if (opts.date)  parts.push({ key: 'date',  value: opts.date })
  return { parts, sep: opts.sep ?? '—' }
}

/** Publication publisher with its type in parentheses, e.g. "IEEE (Research Publication)". */
const publisherWithType = (it: AnyItem, locale: string): string => {
  const pub = ls(it, 'publisher', locale)
  const type = publicationTypeLabel(it.publication_type as string | undefined, locale)
  if (pub && type) return `${pub} (${type})`
  return pub || (type ? `(${type})` : '')
}

/** Comma-joined co-author names for a publication, or '' when none. */
const coAuthorsLine = (it: AnyItem): string => {
  const authors = Array.isArray(it.co_authors) ? (it.co_authors as string[]).filter(Boolean) : []
  return authors.length ? `With ${authors.join(', ')}` : ''
}

/**
 * The exported customer name for a project: the anonymized alias when the
 * project asks for it. Both render paths use this — the editor title() below
 * deliberately does not, so the consultant always recognizes the real client
 * in the View editor's item list.
 */
function projectCustomer(it: AnyItem, locale: string): string {
  const anon = it.use_anonymized ? ls(it, 'customer_anonymized', locale) : ''
  return anon || (it.use_anonymized ? '' : ls(it, 'customer', locale))
}

function projectRoleNames(it: AnyItem, locale: string): string[] {
  return ((it.roles as Array<AnyItem & { disabled?: boolean }> | undefined) ?? [])
    .filter((role) => !role.disabled)
    .map((role) => ls(role, 'name', locale))
    .filter(Boolean)
}

function projectIndustryNames(it: AnyItem, locale: string): string[] {
  return ((it.industries as AnyItem[] | undefined) ?? [])
    .map((pi) => ls(pi, 'name', locale))
    .filter(Boolean)
}

function skillNames(it: AnyItem, locale: string): string[] {
  return ((it.skills as AnyItem[] | undefined) ?? [])
    .map((s) => ls(s, 'name', locale))
    .filter(Boolean)
}

// ─── The catalog ──────────────────────────────────────────────────────────────

export const SECTION_CATALOG: Record<string, SectionDescriptor> = {
  projects: {
    title: (it, locale) =>
      ls(it, 'customer', locale) || ls(it, 'description', locale) || 'Untitled project',
    subtitle: (it) => rawRange(it),
    docxSortByStart: true,
    summary(it, ctx) {
      const { start, end } = rangeParts(it, ctx)
      // Title = the role(s) held; Org = the client — matching the slot labels.
      // Fall back to the project description, then the client, so the line
      // always has an anchor.
      const roles = projectRoleNames(it, ctx.locale).join(', ')
      const customer = projectCustomer(it, ctx.locale)
      const desc = ls(it, 'description', ctx.locale)
      const title = roles || desc || customer || 'Project'
      return summaryOf({ title, org: (roles || desc) ? customer : '', start, end })
    },
    full(it, ctx) {
      const { locale } = ctx
      const title = projectCustomer(it, locale) || ls(it, 'description', locale) || 'Untitled project'
      const roles = projectRoleNames(it, locale).join(', ')
      const industry = projectIndustryNames(it, locale).join(', ')
      const shortDesc = ls(it, 'description', locale)
      const longDesc = ls(it, 'long_description', locale)
      const docx = ctx.target === 'docx'
      const highlights = on(ctx, 'highlights')
        ? ((it.highlights as LocalizedString[] | undefined) ?? []).map((h) => resolve(h, locale)).filter(Boolean)
        : []
      // The lead-in is the short description promoted above the long one. With
      // the group off, it still stands in for a missing long description —
      // otherwise a project written only in short form renders as a bare title.
      const lead = on(ctx, 'lead') && shortDesc && shortDesc !== title ? shortDesc : ''
      return view({
        title,
        titleStyle: docx ? 'large' : 'body',
        spacingBefore: docx ? 200 : 0,
        date: range(it, ctx),
        meta: [
          roles, industry,
          on(ctx, 'location') ? countryName(it.location_country_code, locale) : '',
          on(ctx, 'metrics') && it.team_size ? xt('team_of', locale, { n: it.team_size as number }) : '',
          on(ctx, 'metrics') && it.percent_allocated ? xt('allocation', locale, { n: it.percent_allocated as number }) : '',
        ].filter(Boolean),
        plainBody: lead,
        body: lead ? longDesc : (longDesc || shortDesc),
        points: highlights.map((h) => ({ label: '', body: h })),
        tags: skillNames(it, locale),
        // Read by every adapter that writes tags as TEXT (DOCX, PDF, ATS); the
        // HTML renderer draws chips and ignores it. It is a fact about the tags,
        // so it is carried unconditionally — leaving it off one shape printed
        // the skills as a bare comma list with nothing saying what they were.
        tagsLabel: `${xs('skills', locale)}: `,
        extraLines: on(ctx, 'links') ? [str(it.external_url)].filter(Boolean) : [],
      })
    },
  },

  key_qualifications: {
    // Profile blocks are prose, not a one-line summary, so BOTH modes render
    // through `full()` (alwaysFull). The Summary/Full mode selects which prose
    // field: Summary → the short summary, Full → the long "Full profile". The
    // mode reaches here as kq.short/kq.long (see kqVisibility); there is no
    // separate `summary()` to reach.
    //
    // The tag line is the profile's identity (title in the editor + view
    // config). In an export it is HIDDEN by default (it doubles as the resume
    // title, set from the header); a view can show it via kq.tagline, and then
    // it renders like a heading beside the description.
    alwaysFull: true,
    title: (it, locale) => ls(it, 'tag_line', locale) || 'Untitled profile',
    full(it, ctx) {
      const { locale } = ctx
      const kq = ctx.kq ?? { tagline: false, short: false, long: true }
      // Key points are the profile's detail bullets — they belong to the Full
      // profile (long), not the compact Summary. `kq.long` is the Full-mode
      // signal (see kqVisibility), so summary mode omits them.
      const points = kq.long
        ? ((it.key_points as Array<AnyItem & { disabled?: boolean }> | undefined) ?? [])
            .filter((kp) => !kp.disabled)
            .map((kp) => ({ label: ls(kp, 'name', locale), body: ls(kp, 'long_description', locale) }))
            .filter((p) => p.label || p.body)
        : []
      // Body = the mode's summary variant: Summary→short, Full→long. Exactly one
      // of short/long is set by the section mode, so this is one field.
      const body = [
        kq.short ? ls(it, 'summary_short', locale) : '',
        kq.long ? ls(it, 'summary', locale) : '',
      ].filter(Boolean).join('')
      const tagLine = ls(it, 'tag_line', locale)
      return view({ title: kq.tagline ? tagLine : '', meta: [], body, points })
    },
  },

  key_competencies: {
    title: (it, locale) => ls(it, 'title', locale) || 'Untitled competency',
    summary: (it, ctx) => summaryOf({ title: ls(it, 'title', ctx.locale) || 'Competency' }),
    full(it, ctx) {
      const title = ls(it, 'title', ctx.locale)
      const body = ls(it, 'description', ctx.locale)
      if (!title && !body) return null
      return view({ title, body, spacingBefore: 60 })
    },
  },

  recommendations: {
    title: (it) => (it.recommender_name as string) || 'Recommendation',
    subtitle: (it, locale) =>
      [ls(it, 'recommender_title', locale), it.recommender_company].filter(Boolean).join(', '),
    summary(it, ctx) {
      const attrib = [ls(it, 'recommender_title', ctx.locale), it.recommender_company as string]
        .filter(Boolean).join(', ')
      const rel = ls(it, 'relationship', ctx.locale)
      // Relationship trails the title/company in parentheses, mirroring the
      // full quote's attribution meta.
      const attribWithRel = rel ? `${attrib}${attrib ? ' ' : ''}(${rel})` : attrib
      return summaryOf({
        title: String(it.recommender_name ?? '') || 'Recommendation',
        org: attribWithRel,
        date: dateAt(it, 'date', ctx),
      })
    },
    full(it, ctx) {
      const attrib = [ls(it, 'recommender_title', ctx.locale), it.recommender_company as string]
        .filter(Boolean).join(', ')
      const rel = ls(it, 'relationship', ctx.locale)
      return view({
        layout: 'quote',
        body: ls(it, 'text', ctx.locale),
        attribution: [String(it.recommender_name ?? ''), attrib].filter(Boolean).join(', '),
        attributionMeta: [
          rel ? `(${rel})` : '',
          dateAt(it, 'date', ctx),
          on(ctx, 'links') ? str(it.contact_url) : '',
        ].filter(Boolean),
      })
    },
  },

  work_experiences: {
    title: (it, locale) => ls(it, 'employer', locale) || 'Untitled employer',
    subtitle: (it, locale) => {
      const r = rawRange(it)
      return `${ls(it, 'role_title', locale)}${r ? ' · ' + r : ''}`
    },
    docxSortByStart: true,
    summary: (it, ctx) => {
      const { start, end } = rangeParts(it, ctx)
      // Slots follow their labels: the position title is the Title, the employer
      // is the Organisation. Fall back to the employer as Title when no role is
      // recorded, so the line is never anchorless.
      const role = ls(it, 'role_title', ctx.locale)
      const employer = ls(it, 'employer', ctx.locale)
      return summaryOf({
        title: role || employer || 'Role',
        org: role ? employer : '',
        start, end,
      })
    },
    full(it, ctx) {
      const { locale } = ctx
      const employer = ls(it, 'employer', locale)
      const role = ls(it, 'role_title', locale)
      const body = ls(it, 'long_description', locale) || ls(it, 'description', locale)
      const docx = ctx.target === 'docx'
      // Headcounts read as one line rather than three: the qualifier belongs to
      // its number, and three separate lines for one fact crowds the item.
      const sizes = on(ctx, 'company_size')
        ? ([
            [str(it.company_size_local) || str(it.company_size), 'size_local'],
            [str(it.company_size_national), 'size_national'],
            [str(it.company_size_global), 'size_global'],
          ] as const)
            .filter(([v]) => v)
            .map(([v, key]) => `${v} (${xs(key, locale)})`)
        : []
      return view({
        title: employer || 'Employer',
        titleStyle: docx ? 'large' : 'body',
        spacingBefore: docx ? 180 : 0,
        date: range(it, ctx),
        meta: [
          role,
          on(ctx, 'employment_type') && it.employment_type ? String(it.employment_type).replace('_', ' ') : '',
        ].filter(Boolean),
        body,
        extraLines: [
          sizes.length ? `${xs('company_size', locale)}: ${sizes.join(' · ')}` : '',
          on(ctx, 'links') ? str(it.company_url) : '',
        ].filter(Boolean),
      })
    },
  },

  educations: {
    title: (it, locale) => ls(it, 'school', locale) || 'Untitled school',
    subtitle: (it, locale) => {
      const r = rawRange(it)
      return `${ls(it, 'degree', locale)}${r ? ' · ' + r : ''}`
    },
    summary: (it, ctx) => {
      const { start, end } = rangeParts(it, ctx)
      // Degree is the Title, school the Organisation (matching the slot labels).
      const degree = ls(it, 'degree', ctx.locale)
      const school = ls(it, 'school', ctx.locale)
      return summaryOf({
        title: degree || school || 'Education',
        org: degree ? school : '',
        start, end,
      })
    },
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'school', locale), body: ls(it, 'description', locale) }
      return view({
        ...common,
        spacingBefore: ctx.target === 'docx' ? 140 : 0,
        date: range(it, ctx),
        meta: [
          ls(it, 'degree', locale),
          on(ctx, 'exchange') && it.exchange ? xs('study_abroad', locale) : '',
        ].filter(Boolean),
        extraLines: on(ctx, 'grade') && it.grade ? [`${xs('grade', locale)}: ${it.grade as string}`] : [],
      })
    },
  },

  courses: {
    title: (it, locale) => ls(it, 'name', locale) || 'Untitled',
    subtitle: (it) => rawRange(it),
    summary(it, ctx) {
      const { start, end } = rangeParts(it, ctx)
      return summaryOf({
        title: ls(it, 'name', ctx.locale) || 'Course',
        org: ls(it, 'program', ctx.locale),
        start, end,
      })
    },
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      return view({ ...common, date: range(it, ctx), meta: [ls(it, 'program', locale)].filter(Boolean) })
    },
  },

  certifications: {
    title: (it, locale) => ls(it, 'name', locale) || 'Untitled',
    subtitle: (it, locale) => ls(it, 'organiser', locale),
    summary: (it, ctx) =>
      summaryOf({
        title: ls(it, 'name', ctx.locale) || 'Certification',
        org: ls(it, 'organiser', ctx.locale),
        date: dateAt(it, 'issued', ctx),
      }),
    full(it, ctx) {
      const { locale } = ctx
      const issued = dateAt(it, 'issued', ctx)
      // Localized, unlike the English "(expires …)" this replaced — it lands in
      // a client's PDF, so it is export chrome like any other.
      const expires = on(ctx, 'expiry') && !ctx.hideDates && it.expires
        ? ` (${xs('expires', locale).toLocaleLowerCase(bcp47(locale))} ${fmtDate(it.expires as YM, ctx.dateFormat, locale)})`
        : ''
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      return view({
        ...common,
        date: issued ? `${issued}${expires}` : '',
        meta: [ls(it, 'organiser', locale)].filter(Boolean),
        extraLines: on(ctx, 'links') ? [str(it.credential_url)].filter(Boolean) : [],
      })
    },
  },

  positions: {
    // Match Projects/Employment/Education: the ORGANISATION is the heading, with
    // the role name + type on the line below.
    title: (it, locale) => ls(it, 'organisation', locale) || ls(it, 'name', locale) || 'Untitled',
    subtitle: (it, locale) => {
      const r = rawRange(it)
      const role = [ls(it, 'name', locale), positionTypeLabel(it.position_type as string | undefined, locale)].filter(Boolean).join(' · ')
      return `${role}${r ? ' · ' + r : ''}`
    },
    summary: (it, ctx) => {
      const { start, end } = rangeParts(it, ctx)
      // Slots follow the other sections: the role NAME is the Title anchor, the
      // organisation is the Org slot. position_type is left out (it would get a
      // surprise tabulation column); it shows in the full render.
      return summaryOf({
        title: ls(it, 'name', ctx.locale) || 'Role',
        org: ls(it, 'organisation', ctx.locale),
        start, end,
      })
    },
    full(it, ctx) {
      const { locale } = ctx
      const org = ls(it, 'organisation', locale)
      const name = ls(it, 'name', locale)
      // Organisation as the heading; role name below. The position TYPE is an
      // editor-only organizing field and is never exported — so it is not part
      // of `meta` (nor the summary). Drop the name from meta when it's already
      // the heading (no organisation).
      const title = org || name
      const meta = (org ? [name] : []).filter(Boolean)
      const common = { title, body: ls(it, 'description', locale) }
      return view({ ...common, date: range(it, ctx), meta })
    },
  },

  // Languages is a deliberate special case: a language and its level is a
  // fact, not a story, so no mode gives it a block of prose. The modes are
  // three densities of the same line (see the .ve-sec-spoken_languages rules
  // in viewFilter for the summary flow):
  //
  //   summary   — "Norwegian — Native", every language flowing side by side on
  //               one wrapped line. The scan line; no passport detail.
  //   full      — one line per language, WITH the Europass levels: appended to
  //               the line when they're a single value, split onto their own
  //               lines when understanding/spoken/written disagree (cefrLines).
  //   tabulated — name | level | Europass, each its own column.
  spoken_languages: {
    title: (it, locale) => ls(it, 'name', locale) || 'Untitled',
    summary: (it, ctx) => summaryOf({
      title: ls(it, 'name', ctx.locale) || 'Language',
      // `role`, not `org`: it keeps the level in its own tabulate column and
      // its own summary-layout slot, instead of glued onto the CEFR text.
      role: ls(it, 'level', ctx.locale),
      // Only the grid gets the passport, and it owns a column of its own.
      // '\n' marks a line break inside the cell — see SummaryPart.
      org: ctx.detail === 'tabulated'
        ? cefrLines((it as AnyItem).cefr as CefrMap | undefined, ctx.locale).join('\n')
        : '',
    }),
    full(it, ctx) {
      const lines = cefrLines((it as AnyItem).cefr as CefrMap | undefined, ctx.locale)
      const level = ls(it, 'level', ctx.locale)
      // One value stays on the line; a split passport drops below it.
      const inlineCefr = lines.length === 1 ? lines[0] : ''
      return view({
        layout: 'inline',
        title: ls(it, 'name', ctx.locale) || 'Language',
        meta: [level, inlineCefr].filter(Boolean),
        extraLines: lines.length > 1 ? lines : [],
      })
    },
  },

  // Skills Showcase — items are `ShowcaseGroup`s (lib/showcase.ts), a
  // projection of the skill-category system: `name` is the category's
  // localized name, `skills` its highlighted members. Same shape as the old
  // TechnologyCategory/CategorySkill it replaced, so this descriptor is
  // unchanged.
  technology_categories: {
    title: (it, locale) => ls(it, 'name', locale) || 'Untitled',
    summary: (it, ctx) =>
      summaryOf({
        title: ls(it, 'name', ctx.locale) || 'Category',
        org: skillNames(it, ctx.locale).join(', '),
        sep: ':',
      }),
    full(it, ctx) {
      const name = ls(it, 'name', ctx.locale)
      const tags = skillNames(it, ctx.locale)
      if (!name && !tags.length) return null
      return view({ title: name, tags, tagsLabel: '' })
    },
  },

  presentations: {
    title: (it, locale) => ls(it, 'title', locale) || 'Untitled',
    subtitle: (it, locale) => ls(it, 'event', locale),
    summary(it, ctx) {
      const { start, end } = rangeParts(it, ctx)
      return summaryOf({
        title: ls(it, 'title', ctx.locale) || 'Presentation',
        org: ls(it, 'event', ctx.locale),
        start, end,
      })
    },
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'title', locale), body: ls(it, 'description', locale) }
      return view({
        ...common,
        date: range(it, ctx),
        meta: [ls(it, 'event', locale)].filter(Boolean),
        extraLines: on(ctx, 'links') ? [str(it.url)].filter(Boolean) : [],
      })
    },
  },

  honor_awards: {
    title: (it, locale) => ls(it, 'name', locale) || 'Untitled',
    summary: (it, ctx) =>
      summaryOf({
        title: ls(it, 'name', ctx.locale) || 'Award',
        org: ls(it, 'issuer', ctx.locale),
        date: dateAt(it, 'date', ctx),
      }),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      return view({
        ...common,
        date: dateAt(it, 'date', ctx),
        meta: [
          ls(it, 'issuer', locale),
          on(ctx, 'for_work') ? ls(it, 'for_work', locale) : '',
        ].filter(Boolean),
      })
    },
  },

  publications: {
    title: (it, locale) => ls(it, 'title', locale) || 'Untitled',
    subtitle: (it, locale) => publisherWithType(it, locale),
    summary: (it, ctx) =>
      summaryOf({
        title: ls(it, 'title', ctx.locale) || 'Publication',
        org: publisherWithType(it, ctx.locale),
        date: dateAt(it, 'date', ctx),
      }),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'title', locale), body: ls(it, 'abstract', locale) }
      const authors = coAuthorsLine(it)
      return view({
        ...common,
        date: dateAt(it, 'date', ctx),
        meta: [publisherWithType(it, locale), authors].filter(Boolean),
        extraLines: on(ctx, 'links') ? [str(it.url)].filter(Boolean) : [],
      })
    },
  },

  references: {
    title: (it) => (it.name as string) || 'Unnamed',
    summary(it) {
      if (!it.include_in_exports) return null
      return summaryOf({
        title: String(it.name ?? '') || 'Reference',
        org: [it.title as string, it.company as string].filter(Boolean).join(', '),
      })
    },
    full(it, ctx) {
      if (!it.include_in_exports) return null
      const meta = [it.title as string, it.company as string].filter(Boolean)
      const rel = ls(it, 'relationship', ctx.locale)
      // A referee's phone number and inbox are someone ELSE's personal data, so
      // they ship only when this view asks for them.
      return view({
        title: String(it.name ?? ''),
        meta,
        extraLines: [
          ...(on(ctx, 'contact') ? [rel, str(it.email), str(it.phone)] : []),
          on(ctx, 'links') ? str(it.linkedin_url) : '',
        ].filter(Boolean),
      })
    },
  },

  // Registries — present for editor / search titles only, never rendered as sections.
  skills:     { title: (it, locale) => ls(it, 'name', locale) || 'Unnamed skill' },
  roles:      { title: (it, locale) => ls(it, 'name', locale) || 'Unnamed role' },
  industries: { title: (it, locale) => ls(it, 'name', locale) || 'Unnamed industry' },
}
