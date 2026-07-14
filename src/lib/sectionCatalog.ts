/**
 * PURE: the section-descriptor catalog (roadmap A5). One entry per content
 * section declaring how its items present as *data* — editor title/subtitle,
 * one-line summary, and the full item view. The three switches that used to
 * enumerate sections (`viewFilter.renderItem`, `viewFilter.getItemTitle/
 * getItemSubtitle`, `exporter.renderSection`) all read this catalog instead.
 *
 * SECURITY: descriptors return plain text or allowlisted rich-text *strings* —
 * never HTML/XML markup. The two render adapters own the escape boundary:
 * `viewFilter.ts` (escapeHtml / renderRichHtml) for the HTML/PDF path and
 * `exporter.ts` (TextRun, which XML-escapes) for DOCX. Do not concatenate
 * markup in this file.
 *
 * The HTML and DOCX paths historically drifted apart in small ways. Where the
 * drift is deliberate it is kept, but made *visible*: descriptors branch on
 * `ctx.target` so every per-path difference lives here, in one reviewed file,
 * instead of in two parallel switch statements.
 */

import type { LocalizedString } from '../types'
import { publicationTypeLabel } from './publicationTypes'
import { positionTypeLabel } from './positionTypes'
import { resolve, fmtRange, fmtDate, type DateFormat } from './locales'

export type AnyItem = Record<string, unknown>
type YM = { year: number; month: number | null } | null

export interface CatalogCtx {
  locale: string
  /** Section style's hide_dates — blank all date output when true. */
  hideDates: boolean
  /** Resolved date format for the section (default 'month-year'). */
  dateFormat?: DateFormat
  /** Which render pipeline is asking. Keeps deliberate per-path differences explicit. */
  target: 'html' | 'docx'
  /** Professional-summary (key_qualifications) part visibility. Only the KQ
   *  descriptor reads this; absent → its documented defaults. */
  kq?: { label: boolean; tagline: boolean; short: boolean; long: boolean }
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
  ctx.hideDates ? '' : fmtRange(it.start as YM, it.end as YM, ctx.dateFormat)

const dateAt = (it: AnyItem, field: string, ctx: CatalogCtx): string =>
  ctx.hideDates ? '' : fmtDate(it[field] as YM, ctx.dateFormat)

/** Split a start/end range into separately-formatted parts (for tabulation). */
const rangeParts = (it: AnyItem, ctx: CatalogCtx): { start: string; end: string } => {
  if (ctx.hideDates) return { start: '', end: '' }
  const start = fmtDate(it.start as YM, ctx.dateFormat)
  const end = it.end ? fmtDate(it.end as YM, ctx.dateFormat) : (start ? 'Present' : '')
  return { start, end }
}

const rawRange = (it: AnyItem): string => fmtRange(it.start as YM, it.end as YM)

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
  const type = publicationTypeLabel(it.publication_type as string | undefined)
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
      if (ctx.target === 'html') {
        return view({
          title,
          date: range(it, ctx),
          meta: [industry, roles].filter(Boolean),
          body: longDesc || shortDesc,
          tags: skillNames(it, locale),
        })
      }
      // DOCX renders more project facts (team size, allocation, highlights,
      // the short description as a lead-in) — kept from the original exporter.
      const highlights = ((it.highlights as LocalizedString[] | undefined) ?? [])
        .map((h) => resolve(h, locale))
        .filter(Boolean)
      return view({
        title,
        titleStyle: 'large',
        spacingBefore: 200,
        date: range(it, ctx),
        meta: [
          roles, industry,
          it.team_size ? `Team of ${it.team_size as number}` : '',
          it.percent_allocated ? `${it.percent_allocated as number}% allocation` : '',
        ].filter(Boolean),
        plainBody: shortDesc && shortDesc !== title ? shortDesc : '',
        body: longDesc,
        points: highlights.map((h) => ({ label: '', body: h })),
        tags: skillNames(it, locale),
        tagsLabel: 'Skills: ',
      })
    },
  },

  key_qualifications: {
    title: (it, locale) => ls(it, 'label', locale) || 'Untitled profile',
    summary: (it, ctx) => {
      const kq = ctx.kq ?? { label: true, tagline: true, short: false, long: true }
      return summaryOf({
        title: (kq.label && ls(it, 'label', ctx.locale)) || 'Profile',
        org: kq.tagline ? ls(it, 'tag_line', ctx.locale) : '',
      })
    },
    full(it, ctx) {
      const { locale } = ctx
      const kq = ctx.kq ?? { label: true, tagline: true, short: false, long: true }
      const points = ((it.key_points as Array<AnyItem & { disabled?: boolean }> | undefined) ?? [])
        .filter((kp) => !kp.disabled)
        .map((kp) => ({ label: ls(kp, 'name', locale), body: ls(kp, 'long_description', locale) }))
        .filter((p) => p.label || p.body)
      // Body = the enabled summary variant(s); short precedes long when both show.
      const body = [
        kq.short ? ls(it, 'summary_short', locale) : '',
        kq.long ? ls(it, 'summary', locale) : '',
      ].filter(Boolean).join('')
      const tagMeta = kq.tagline ? [ls(it, 'tag_line', locale)].filter(Boolean) : []
      // DOCX historically renders the tag line as meta rather than a heading.
      if (ctx.target === 'docx') {
        return view({ meta: tagMeta, body, points })
      }
      return view({ title: kq.label ? ls(it, 'label', locale) : '', meta: tagMeta, body, points })
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
        attributionMeta: [rel ? `(${rel})` : '', dateAt(it, 'date', ctx)].filter(Boolean),
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
      if (ctx.target === 'html') {
        return view({ title: employer, date: range(it, ctx), meta: [role].filter(Boolean), body })
      }
      return view({
        title: [employer, role].filter(Boolean).join(' — ') || 'Employer',
        titleStyle: 'large',
        spacingBefore: 180,
        date: range(it, ctx),
        meta: it.employment_type ? [String(it.employment_type).replace('_', ' ')] : [],
        body,
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
      if (ctx.target === 'html') {
        return view({ ...common, date: range(it, ctx), meta: [ls(it, 'degree', locale)].filter(Boolean) })
      }
      return view({
        ...common,
        spacingBefore: 140,
        date: range(it, ctx),
        meta: [ls(it, 'degree', locale)].filter(Boolean),
        extraLines: it.grade ? [`Grade: ${it.grade as string}`] : [],
      })
    },
  },

  courses: {
    title: (it, locale) => ls(it, 'name', locale) || 'Untitled',
    subtitle: (it, locale) => ls(it, 'program', locale),
    summary: (it, ctx) =>
      summaryOf({
        title: ls(it, 'name', ctx.locale) || 'Course',
        org: ls(it, 'program', ctx.locale),
        date: dateAt(it, 'completed', ctx),
      }),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, date: dateAt(it, 'completed', ctx), meta: [ls(it, 'program', locale)].filter(Boolean) })
      }
      return view({
        ...common,
        date: dateAt(it, 'completed', ctx),
        meta: [ls(it, 'program', locale)].filter(Boolean),
      })
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
      const expires = !ctx.hideDates && it.expires ? ` (expires ${fmtDate(it.expires as YM, ctx.dateFormat)})` : ''
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, date: issued, meta: [ls(it, 'organiser', locale)].filter(Boolean) })
      }
      return view({
        ...common,
        date: issued ? `${issued}${expires}` : '',
        meta: [ls(it, 'organiser', locale)].filter(Boolean),
        extraLines: it.credential_url ? [it.credential_url as string] : [],
      })
    },
  },

  positions: {
    title: (it, locale) => ls(it, 'name', locale) || 'Untitled',
    subtitle: (it, locale) => {
      const r = rawRange(it)
      const org = [positionTypeLabel(it.position_type as string | undefined), ls(it, 'organisation', locale)].filter(Boolean).join(' · ')
      return `${org}${r ? ' · ' + r : ''}`
    },
    summary: (it, ctx) => {
      const { start, end } = rangeParts(it, ctx)
      // The position_type ("Board member", "Volunteer", …) is a categorisation,
      // not one of the item-layout slots (Title / Organisation / Date), so it is
      // deliberately left OUT of the summary — otherwise tabulation gave it its
      // own surprise column. It still shows in the full-detail render below.
      return summaryOf({
        title: ls(it, 'name', ctx.locale) || 'Role',
        org: ls(it, 'organisation', ctx.locale),
        start, end,
      })
    },
    full(it, ctx) {
      const { locale } = ctx
      const type = positionTypeLabel(it.position_type as string | undefined)
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, date: range(it, ctx), meta: [type, ls(it, 'organisation', locale)].filter(Boolean) })
      }
      return view({
        ...common,
        date: range(it, ctx),
        meta: [type, ls(it, 'organisation', locale)].filter(Boolean),
      })
    },
  },

  spoken_languages: {
    title: (it, locale) => ls(it, 'name', locale) || 'Untitled',
    alwaysFull: true,
    full: (it, ctx) => view({
      layout: 'inline',
      title: ls(it, 'name', ctx.locale),
      meta: [ls(it, 'level', ctx.locale)].filter(Boolean),
    }),
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
    summary: (it, ctx) =>
      summaryOf({
        title: ls(it, 'title', ctx.locale) || 'Presentation',
        org: ls(it, 'event', ctx.locale),
        date: dateAt(it, 'date', ctx),
      }),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'title', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, date: dateAt(it, 'date', ctx), meta: [ls(it, 'event', locale)].filter(Boolean) })
      }
      return view({
        ...common,
        date: dateAt(it, 'date', ctx),
        meta: [ls(it, 'event', locale)].filter(Boolean),
        extraLines: it.url ? [it.url as string] : [],
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
      if (ctx.target === 'html') {
        return view({ ...common, date: dateAt(it, 'date', ctx), meta: [ls(it, 'issuer', locale)].filter(Boolean) })
      }
      return view({
        ...common,
        date: dateAt(it, 'date', ctx),
        meta: [ls(it, 'issuer', locale)].filter(Boolean),
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
      if (ctx.target === 'html') {
        return view({ ...common, date: dateAt(it, 'date', ctx), meta: [publisherWithType(it, locale), authors].filter(Boolean) })
      }
      return view({
        ...common,
        date: dateAt(it, 'date', ctx),
        meta: [publisherWithType(it, locale), authors].filter(Boolean),
        extraLines: it.url ? [it.url as string] : [],
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
      if (ctx.target === 'html') {
        return view({ title: String(it.name ?? ''), meta })
      }
      const rel = ls(it, 'relationship', ctx.locale)
      return view({
        title: String(it.name ?? ''),
        meta,
        extraLines: [rel, it.email as string, it.phone as string].filter(Boolean),
      })
    },
  },

  // Registries — present for editor / search titles only, never rendered as sections.
  skills:     { title: (it, locale) => ls(it, 'name', locale) || 'Unnamed skill' },
  roles:      { title: (it, locale) => ls(it, 'name', locale) || 'Unnamed role' },
  industries: { title: (it, locale) => ls(it, 'name', locale) || 'Unnamed industry' },
}
