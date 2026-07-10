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
import { resolve, fmtRange, fmtDate } from './locales'

export type AnyItem = Record<string, unknown>
type YM = { year: number; month: number | null } | null

export interface CatalogCtx {
  locale: string
  /** Section style's hide_dates — blank all date output when true. */
  hideDates: boolean
  /** Which render pipeline is asking. Keeps deliberate per-path differences explicit. */
  target: 'html' | 'docx'
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
  /** Plain date string the DOCX adapter sets faintly after the title. The HTML
   *  adapter ignores it — HTML descriptors fold dates into `meta` so each
   *  section keeps its historical meta ordering. */
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

/** One-line summary view. `sep` only affects the HTML adapter ('—' vs ':'). */
export interface SummaryView { title: string; meta: string[]; sep: '—' | ':' }

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
  ctx.hideDates ? '' : fmtRange(it.start as YM, it.end as YM)

const dateAt = (it: AnyItem, field: string, ctx: CatalogCtx): string =>
  ctx.hideDates ? '' : fmtDate(it[field] as YM)

const rawRange = (it: AnyItem): string => fmtRange(it.start as YM, it.end as YM)

const view = (partial: Partial<ItemView>): ItemView => ({
  layout: 'default', title: '', date: '', meta: [], body: '', plainBody: '',
  extraLines: [], tags: [], tagsLabel: '', points: [], attribution: '',
  attributionMeta: [], titleStyle: 'body', spacingBefore: 0, ...partial,
})

const summaryOf = (title: string, meta: Array<string | null | undefined>, sep: '—' | ':' = '—'): SummaryView =>
  ({ title, meta: meta.filter((m): m is string => !!m), sep })

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
      const title = projectCustomer(it, ctx.locale) || ls(it, 'description', ctx.locale) || 'Untitled project'
      return summaryOf(title, [range(it, ctx), projectRoleNames(it, ctx.locale).join(', ')])
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
          meta: [range(it, ctx), industry, roles].filter(Boolean),
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
    summary: (it, ctx) =>
      summaryOf(ls(it, 'label', ctx.locale) || 'Profile', [ls(it, 'tag_line', ctx.locale)]),
    full(it, ctx) {
      const { locale } = ctx
      const points = ((it.key_points as Array<AnyItem & { disabled?: boolean }> | undefined) ?? [])
        .filter((kp) => !kp.disabled)
        .map((kp) => ({ label: ls(kp, 'name', locale), body: ls(kp, 'long_description', locale) }))
        .filter((p) => p.label || p.body)
      // DOCX historically renders the tag line instead of the label heading.
      if (ctx.target === 'docx') {
        return view({ meta: [ls(it, 'tag_line', locale)].filter(Boolean), body: ls(it, 'summary', locale), points })
      }
      return view({ title: ls(it, 'label', locale), body: ls(it, 'summary', locale), points })
    },
  },

  key_competencies: {
    title: (it, locale) => ls(it, 'title', locale) || 'Untitled competency',
    summary: (it, ctx) => summaryOf(ls(it, 'title', ctx.locale) || 'Competency', []),
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
      return summaryOf(
        String(it.recommender_name ?? '') || 'Recommendation',
        [attribWithRel, dateAt(it, 'date', ctx)],
      )
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
    summary: (it, ctx) =>
      summaryOf(ls(it, 'employer', ctx.locale) || 'Employer',
        [ls(it, 'role_title', ctx.locale), range(it, ctx)]),
    full(it, ctx) {
      const { locale } = ctx
      const employer = ls(it, 'employer', locale)
      const role = ls(it, 'role_title', locale)
      const body = ls(it, 'long_description', locale) || ls(it, 'description', locale)
      if (ctx.target === 'html') {
        return view({ title: employer, meta: [role, range(it, ctx)].filter(Boolean), body })
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
    summary: (it, ctx) =>
      summaryOf(ls(it, 'school', ctx.locale) || 'School',
        [ls(it, 'degree', ctx.locale), range(it, ctx)]),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'school', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, meta: [ls(it, 'degree', locale), range(it, ctx)].filter(Boolean) })
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
      summaryOf(ls(it, 'name', ctx.locale) || 'Course',
        [ls(it, 'program', ctx.locale), dateAt(it, 'completed', ctx)]),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, meta: [ls(it, 'program', locale), dateAt(it, 'completed', ctx)].filter(Boolean) })
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
      summaryOf(ls(it, 'name', ctx.locale) || 'Certification',
        [ls(it, 'organiser', ctx.locale), dateAt(it, 'issued', ctx)]),
    full(it, ctx) {
      const { locale } = ctx
      const issued = dateAt(it, 'issued', ctx)
      const expires = !ctx.hideDates && it.expires ? ` (expires ${fmtDate(it.expires as YM)})` : ''
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, meta: [ls(it, 'organiser', locale), issued].filter(Boolean) })
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
      return `${ls(it, 'organisation', locale)}${r ? ' · ' + r : ''}`
    },
    summary: (it, ctx) =>
      summaryOf(ls(it, 'name', ctx.locale) || 'Role',
        [ls(it, 'organisation', ctx.locale), range(it, ctx)]),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, meta: [ls(it, 'organisation', locale), range(it, ctx)].filter(Boolean) })
      }
      return view({
        ...common,
        date: range(it, ctx),
        meta: [ls(it, 'organisation', locale)].filter(Boolean),
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
      summaryOf(ls(it, 'name', ctx.locale) || 'Category',
        [skillNames(it, ctx.locale).join(', ')], ':'),
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
      summaryOf(ls(it, 'title', ctx.locale) || 'Presentation',
        [ls(it, 'event', ctx.locale), dateAt(it, 'date', ctx)]),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'title', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, meta: [ls(it, 'event', locale), dateAt(it, 'date', ctx)].filter(Boolean) })
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
      summaryOf(ls(it, 'name', ctx.locale) || 'Award',
        [ls(it, 'issuer', ctx.locale), dateAt(it, 'date', ctx)]),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'name', locale), body: ls(it, 'description', locale) }
      if (ctx.target === 'html') {
        return view({ ...common, meta: [ls(it, 'issuer', locale), dateAt(it, 'date', ctx)].filter(Boolean) })
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
      summaryOf(ls(it, 'title', ctx.locale) || 'Publication',
        [publisherWithType(it, ctx.locale), dateAt(it, 'date', ctx)]),
    full(it, ctx) {
      const { locale } = ctx
      const common = { title: ls(it, 'title', locale), body: ls(it, 'abstract', locale) }
      const authors = coAuthorsLine(it)
      if (ctx.target === 'html') {
        return view({ ...common, meta: [publisherWithType(it, locale), authors, dateAt(it, 'date', ctx)].filter(Boolean) })
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
      return summaryOf(String(it.name ?? '') || 'Reference',
        [[it.title as string, it.company as string].filter(Boolean).join(', ')])
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
