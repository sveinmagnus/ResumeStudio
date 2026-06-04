/**
 * Resume Studio — DOCX export
 *
 * Renders a ResumeView as a .docx file using the `docx` library. The view
 * filter (lib/viewFilter) is applied first to drop hidden sections and
 * excluded items; this exporter then walks the surviving content in the
 * view's section order, honouring per-section detail (off/summary/full)
 * and style overrides, and emits one paragraph stream that mirrors the
 * structure of the HTML export in buildViewHtml().
 *
 * Visual style is derived from `view.style` via `lib/viewStyle.ts`. The
 * defaults match the Cartavio brand so an untouched view exports the same
 * navy/Open Sans Condensed/Ubuntu look as before.
 *
 * This module is intentionally heavy (~400 kB of docx) so it should be
 * lazy-imported by the caller, e.g.:
 *   const { exportDocx } = await import('./exporter')
 */

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  PageOrientation, BorderStyle,
} from 'docx'
import type {
  ResumeStore, ResumeView, LocalizedString, SectionDetail, SectionStyle,
} from '../types'
import { SECTIONS } from './sections'
import { resolve, fmtRange, fmtDate } from './locales'
import { applyView, isExportableSection } from './viewFilter'
import { parseRichBlocks, type RichRun } from './richText'
import { deriveTokens, resolveSectionStyle, withDefaults, type ResolvedSectionStyle, type StyleTokens } from './viewStyle'

const SUBTLE_HEX = '666666'
const FAINT_HEX  = '888888'

// ─── Context plumbed through every renderer ─────────────────────────────────

interface ExportCtx {
  locale: string
  detail: SectionDetail
  /** Resolved style for this section (view defaults overlaid with section overrides). */
  resolved: ResolvedSectionStyle
  /** Tokens derived from `resolved` — pre-computed for cheap reads. */
  tokens: StyleTokens
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function L(ls: LocalizedString | undefined, locale: string): string {
  return resolve(ls, locale)
}

interface PStyle { italic?: boolean; bold?: boolean; color?: string; after?: number; before?: number }

function para(text: string, ctx: ExportCtx, opts: PStyle = {}): Paragraph {
  return new Paragraph({
    spacing: { before: opts.before, after: opts.after ?? 60 },
    children: [new TextRun({
      text,
      italics: opts.italic,
      bold: opts.bold,
      color: opts.color,
      size: ctx.tokens.bodyFontSizePt * 2,
      font: ctx.tokens.bodyFontDocx,
    })],
  })
}

/**
 * Render a rich-text value (or plain text) as docx paragraphs.
 * Plain text becomes a single paragraph; markup becomes a stream of
 * paragraphs / bullet- or number-prefixed list-item paragraphs.
 */
function richParagraphs(html: string, ctx: ExportCtx, opts: PStyle = {}): Paragraph[] {
  const blocks = parseRichBlocks(html)
  if (!blocks.length) return []
  const out: Paragraph[] = []
  const fontSize = ctx.tokens.bodyFontSizePt * 2
  for (const block of blocks) {
    const runs = renderRuns(block.runs, ctx, opts, fontSize)
    if (block.kind === 'paragraph') {
      out.push(new Paragraph({
        spacing: { before: opts.before, after: opts.after ?? 60 },
        children: runs,
      }))
      continue
    }
    const marker = block.ordered ? `${block.index}. ` : '• '
    out.push(new Paragraph({
      spacing: { after: 30 },
      indent: { left: 360 + block.level * 360 },
      children: [
        new TextRun({ text: marker, font: ctx.tokens.bodyFontDocx, color: opts.color, size: fontSize }),
        ...runs,
      ],
    }))
  }
  return out
}

function renderRuns(runs: RichRun[], ctx: ExportCtx, opts: PStyle, fontSize: number): TextRun[] {
  return runs.map((r) => new TextRun({
    text: r.text,
    bold: r.bold ?? opts.bold,
    italics: r.italic ?? opts.italic,
    underline: r.underline ? {} : undefined,
    color: opts.color,
    size: fontSize,
    font: ctx.tokens.bodyFontDocx,
  }))
}

function sectionHeading(label: string, tokens: StyleTokens): Paragraph {
  return new Paragraph({
    spacing: { before: tokens.itemGapTwips * 2, after: tokens.sectionHeadingAfterTwips },
    border: { bottom: { color: tokens.accentHex, space: 1, style: BorderStyle.SINGLE, size: 8 } },
    children: [new TextRun({
      text: label.toUpperCase(),
      bold: true,
      color: tokens.accentHex,
      size: tokens.h2Pt * 2,
      font: tokens.headingFontDocx,
    })],
  })
}

/**
 * Emit a single-line summary paragraph: bold title plus an inline meta tail.
 */
function summaryLine(title: string, meta: string, ctx: ExportCtx): Paragraph {
  const children: TextRun[] = [
    new TextRun({
      text: title,
      bold: true,
      size: ctx.tokens.smallFontSizePt * 2,
      font: ctx.tokens.bodyFontDocx,
    }),
  ]
  if (meta) {
    children.push(new TextRun({
      text: ` — ${meta}`,
      color: SUBTLE_HEX,
      size: ctx.tokens.smallFontSizePt * 2,
      font: ctx.tokens.bodyFontDocx,
    }))
  }
  return new Paragraph({
    spacing: { after: Math.max(30, ctx.tokens.itemGapTwips / 3) },
    children,
  })
}

const ls = (it: AnyItem, field: string, locale: string): string =>
  resolve(it[field] as LocalizedString | undefined, locale)

const metaJoin = (parts: Array<string | undefined | null>) =>
  parts.filter((p): p is string => !!p && p.length > 0).join(' · ')

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Render a ResumeView to a .docx blob and trigger a browser download.
 * Caller decides the export locale (typically one of the resume's
 * supported_locales).
 */
export async function exportDocx(store: ResumeStore, view: ResumeView, locale: string): Promise<void> {
  const viewStyle = withDefaults(view.style)
  const baseTokens = deriveTokens(viewStyle)
  const filtered = applyView(store, view)
  const children: Paragraph[] = []

  // ── Header (resume identity) ────────────────────────────────────────────
  const r = filtered.resume
  if (r) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({
        text: r.full_name,
        bold: true,
        size: baseTokens.h1Pt * 2,
        font: baseTokens.headingFontDocx,
        color: baseTokens.accentHex,
      })],
    }))
    const titleText = L(r.title, locale)
    if (titleText) {
      children.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({
          text: titleText,
          size: (baseTokens.smallFontSizePt + 1) * 2,
          font: baseTokens.headingFontDocx,
          color: '444444',
        })],
      }))
    }
    const contactBits: string[] = []
    if (r.email)           contactBits.push(r.email)
    if (r.phone)           contactBits.push(r.phone)
    if (r.linkedin_url)    contactBits.push(r.linkedin_url)
    if (r.website_url)     contactBits.push(r.website_url)
    if (contactBits.length) {
      children.push(new Paragraph({
        spacing: { after: 220 },
        children: [new TextRun({
          text: contactBits.join('  •  '),
          size: baseTokens.metaFontSizePt * 2,
          color: SUBTLE_HEX,
          font: baseTokens.bodyFontDocx,
        })],
      }))
    }
  }

  // ── Introduction (view-specific) ────────────────────────────────────────
  const intro = L(view.introduction, locale)
  if (intro) {
    children.push(new Paragraph({
      spacing: { before: 80, after: 220 },
      alignment: AlignmentType.LEFT,
      children: [new TextRun({
        text: intro,
        italics: true,
        font: baseTokens.bodyFontDocx,
        color: '333333',
        size: baseTokens.bodyFontSizePt * 2,
      })],
    }))
  }

  // ── Content sections in the view's chosen order ─────────────────────────
  const contentSections = SECTIONS.filter(isExportableSection)
  const enabledSections = contentSections
    .map((s) => {
      const vs = view.sections.find((v) => v.key === s.key)
      return {
        ...s,
        sort_order: vs?.sort_order ?? 999,
        detail: vs?.detail ?? 'full' as SectionDetail,
        sectionStyle: vs?.style as SectionStyle | undefined,
      }
    })
    .filter((s) => s.detail !== 'off')
    .sort((a, b) => a.sort_order - b.sort_order)

  for (const def of enabledSections) {
    if (!def.storeKey) continue
    const items = filtered[def.storeKey] as unknown[]
    if (!items.length) continue
    const resolved = resolveSectionStyle(viewStyle, def.sectionStyle)
    const ctx: ExportCtx = {
      locale,
      detail: def.detail,
      resolved,
      tokens: deriveTokens(resolved),
    }
    const block = renderSection(def.key, def.label, items, ctx)
    if (block.length) children.push(...block)
  }

  // ── Page setup — A4 with style-driven margins ───────────────────────────
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: baseTokens.bodyFontDocx, size: baseTokens.bodyFontSizePt * 2 } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.PORTRAIT, width: 11906, height: 16838 }, // A4
          margin: baseTokens.pageMarginTwips,
        },
      },
      children,
    }],
  })

  const blob = await Packer.toBlob(doc)
  const slugName = (store.resume?.full_name || 'resume').replace(/\s+/g, '_')
  const slugView = view.name.replace(/\s+/g, '_')
  downloadBlob(blob, `${slugName}_${slugView}.docx`)
}

// ─── Section dispatcher ───────────────────────────────────────────────────────

function renderSection(key: string, label: string, items: unknown[], ctx: ExportCtx): Paragraph[] {
  switch (key) {
    case 'key_qualifications':    return wrap(label, renderKQs(items, ctx), ctx)
    case 'projects':              return wrap(label, renderProjects(items, ctx), ctx)
    case 'work_experiences':      return wrap(label, renderWork(items, ctx), ctx)
    case 'educations':            return wrap(label, renderEducations(items, ctx), ctx)
    case 'courses':               return wrap(label, renderCourses(items, ctx), ctx)
    case 'certifications':        return wrap(label, renderCertifications(items, ctx), ctx)
    case 'technology_categories': return wrap(label, renderTechCategories(items, ctx), ctx)
    case 'spoken_languages':      return wrap(label, renderLanguages(items, ctx), ctx)
    case 'positions':             return wrap(label, renderPositions(items, ctx), ctx)
    case 'presentations':         return wrap(label, renderPresentations(items, ctx), ctx)
    case 'publications':          return wrap(label, renderPublications(items, ctx), ctx)
    case 'honor_awards':          return wrap(label, renderAwards(items, ctx), ctx)
    case 'references':            return wrap(label, renderReferences(items, ctx), ctx)
    case 'skills':                return []  // skill registry never exported directly
    case 'roles':                 return []  // role registry never exported directly
    default:                      return []
  }
}

function wrap(label: string, body: Paragraph[], ctx: ExportCtx): Paragraph[] {
  if (!body.length) return []
  if (ctx.resolved.hide_heading) return body
  return [sectionHeading(label, ctx.tokens), ...body]
}

// ─── Per-section renderers (typed inline to avoid coupling to type names) ───

type AnyItem = Record<string, unknown>
type YM = { year: number; month: number | null } | null

function dateRange(it: AnyItem, ctx: ExportCtx): string {
  if (ctx.resolved.hide_dates) return ''
  return fmtRange(it.start as YM, it.end as YM)
}

function dateAt(it: AnyItem, field: string, ctx: ExportCtx): string {
  if (ctx.resolved.hide_dates) return ''
  return fmtDate(it[field] as YM)
}

function renderKQs(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const k of items as AnyItem[]) {
    const label   = ls(k, 'label', ctx.locale)
    const tag     = ls(k, 'tag_line', ctx.locale)
    const summary = ls(k, 'summary',  ctx.locale)
    if (ctx.detail === 'summary') {
      out.push(summaryLine(label || 'Profile', tag, ctx))
      continue
    }
    if (tag)     out.push(para(tag, ctx, { italic: true, after: 80 }))
    if (summary) out.push(...richParagraphs(summary, ctx, { after: 120 }))
    const points = (k.key_points as Array<AnyItem & { disabled?: boolean }> | undefined) ?? []
    for (const kp of points) {
      if (kp.disabled) continue
      const name = ls(kp, 'name', ctx.locale)
      const desc = ls(kp, 'long_description', ctx.locale)
      if (!name && !desc) continue
      const sz = ctx.tokens.bodyFontSizePt * 2
      out.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          ...(name ? [new TextRun({ text: `• ${name}`, bold: true, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
          ...(name && desc ? [new TextRun({ text: ' — ', font: ctx.tokens.bodyFontDocx, size: sz })] : []),
          ...(desc ? [new TextRun({ text: desc, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
        ],
      }))
    }
  }
  return out
}

function renderProjects(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  const sorted = [...items as AnyItem[]].sort(byStartDescending)
  for (const p of sorted) {
    const customer = p.use_anonymized ? ls(p, 'customer_anonymized', ctx.locale) : ls(p, 'customer', ctx.locale)
    const title = customer || ls(p, 'description', ctx.locale) || 'Project'
    const dateStr = dateRange(p, ctx)
    const roleNames = ((p.roles as Array<AnyItem & { disabled?: boolean }> | undefined) ?? [])
      .filter((role) => !role.disabled)
      .map((role) => ls(role, 'name', ctx.locale))
      .filter(Boolean)
    if (ctx.detail === 'summary') {
      out.push(summaryLine(title, metaJoin([dateStr, roleNames.join(', ')]), ctx))
      continue
    }
    const titleSize = (ctx.tokens.h3Pt + 1) * 2
    const dateSize  = ctx.tokens.smallFontSizePt * 2
    out.push(new Paragraph({
      spacing: { before: 200, after: 40 },
      children: [
        new TextRun({ text: title, bold: true, size: titleSize, font: ctx.tokens.bodyFontDocx }),
        ...(dateStr ? [new TextRun({ text: `   ${dateStr}`, size: dateSize, color: FAINT_HEX, font: ctx.tokens.bodyFontDocx })] : []),
      ],
    }))
    const sub: string[] = []
    if (roleNames.length)                       sub.push(roleNames.join(', '))
    if (ls(p, 'industry', ctx.locale))          sub.push(ls(p, 'industry', ctx.locale))
    if (p.team_size)                            sub.push(`Team of ${p.team_size as number}`)
    if (p.percent_allocated)                    sub.push(`${p.percent_allocated as number}% allocation`)
    if (sub.length) out.push(para(sub.join(' · '), ctx, { italic: true, color: SUBTLE_HEX, after: 80 }))

    const shortDesc = ls(p, 'description', ctx.locale)
    const longDesc  = ls(p, 'long_description', ctx.locale)
    if (shortDesc && shortDesc !== title) out.push(para(shortDesc, ctx, { after: 80 }))
    if (longDesc)                          out.push(...richParagraphs(longDesc, ctx, { after: 100 }))

    const highlights = (p.highlights as LocalizedString[] | undefined) ?? []
    for (const h of highlights) {
      const txt = resolve(h, ctx.locale)
      if (txt) out.push(para(`• ${txt}`, ctx, { after: 40 }))
    }

    const skills = (p.skills as AnyItem[] | undefined) ?? []
    const skillNames = skills.map((s) => ls(s, 'name', ctx.locale)).filter(Boolean)
    if (skillNames.length) {
      const sz = ctx.tokens.metaFontSizePt * 2
      out.push(new Paragraph({
        spacing: { before: 60, after: 100 },
        children: [
          new TextRun({ text: 'Skills: ', italics: true, color: SUBTLE_HEX, font: ctx.tokens.bodyFontDocx, size: sz }),
          new TextRun({ text: skillNames.join(', '),   color: SUBTLE_HEX, font: ctx.tokens.bodyFontDocx, size: sz }),
        ],
      }))
    }
  }
  return out
}

function renderWork(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  const sorted = [...items as AnyItem[]].sort(byStartDescending)
  for (const w of sorted) {
    const employer = ls(w, 'employer', ctx.locale)
    const role     = ls(w, 'role_title', ctx.locale)
    const title    = [employer, role].filter(Boolean).join(' — ')
    const dateStr  = dateRange(w, ctx)
    if (ctx.detail === 'summary') {
      out.push(summaryLine(employer || title || 'Employer', metaJoin([role, dateStr]), ctx))
      continue
    }
    const titleSize = (ctx.tokens.h3Pt + 1) * 2
    const dateSize  = ctx.tokens.smallFontSizePt * 2
    out.push(new Paragraph({
      spacing: { before: 180, after: 40 },
      children: [
        new TextRun({ text: title, bold: true, size: titleSize, font: ctx.tokens.bodyFontDocx }),
        ...(dateStr ? [new TextRun({ text: `   ${dateStr}`, size: dateSize, color: FAINT_HEX, font: ctx.tokens.bodyFontDocx })] : []),
      ],
    }))
    if (w.employment_type) {
      out.push(para(String(w.employment_type).replace('_', ' '), ctx, { italic: true, color: SUBTLE_HEX, after: 80 }))
    }
    const longDesc = ls(w, 'long_description', ctx.locale)
    if (longDesc) out.push(...richParagraphs(longDesc, ctx, { after: 80 }))
  }
  return out
}

function renderEducations(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const e of items as AnyItem[]) {
    const school = ls(e, 'school', ctx.locale)
    const degree = ls(e, 'degree', ctx.locale)
    const dateStr = dateRange(e, ctx)
    if (ctx.detail === 'summary') {
      out.push(summaryLine(school || 'School', metaJoin([degree, dateStr]), ctx))
      continue
    }
    const sz = ctx.tokens.bodyFontSizePt * 2
    out.push(new Paragraph({
      spacing: { before: 140, after: 30 },
      children: [
        new TextRun({ text: school, bold: true, font: ctx.tokens.bodyFontDocx, size: sz }),
        ...(degree  ? [new TextRun({ text: ` — ${degree}`, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
        ...(dateStr ? [new TextRun({ text: `   ${dateStr}`, color: FAINT_HEX, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
      ],
    }))
    const desc = ls(e, 'description', ctx.locale)
    if (desc)    out.push(...richParagraphs(desc, ctx, { after: 40 }))
    if (e.grade) out.push(para(`Grade: ${e.grade as string}`, ctx, { italic: true, color: SUBTLE_HEX, after: 40 }))
  }
  return out
}

function renderCourses(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const c of items as AnyItem[]) {
    const name    = ls(c, 'name', ctx.locale)
    const program = ls(c, 'program', ctx.locale)
    const completed = dateAt(c, 'completed', ctx)
    if (ctx.detail === 'summary') {
      out.push(summaryLine(name || 'Course', metaJoin([program, completed]), ctx))
      continue
    }
    const sz = ctx.tokens.bodyFontSizePt * 2
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: name, bold: true, font: ctx.tokens.bodyFontDocx, size: sz }),
        ...(program ? [new TextRun({ text: ` — ${program}`, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
        ...(completed ? [new TextRun({ text: `   ${completed}`, color: FAINT_HEX, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
      ],
    }))
    const desc = ls(c, 'description', ctx.locale)
    if (desc) out.push(...richParagraphs(desc, ctx, { after: 50 }))
  }
  return out
}

function renderCertifications(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const c of items as AnyItem[]) {
    const name      = ls(c, 'name', ctx.locale)
    const organiser = ls(c, 'organiser', ctx.locale)
    const issued    = dateAt(c, 'issued', ctx)
    const expires   = !ctx.resolved.hide_dates && c.expires ? ` (expires ${fmtDate(c.expires as YM)})` : ''
    if (ctx.detail === 'summary') {
      out.push(summaryLine(name || 'Certification', metaJoin([organiser, issued]), ctx))
      continue
    }
    const sz = ctx.tokens.bodyFontSizePt * 2
    out.push(new Paragraph({
      spacing: { after: 50 },
      children: [
        new TextRun({ text: name, bold: true, font: ctx.tokens.bodyFontDocx, size: sz }),
        ...(organiser ? [new TextRun({ text: ` — ${organiser}`, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
        ...(issued  ? [new TextRun({ text: `   ${issued}${expires}`, color: FAINT_HEX, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
      ],
    }))
    if (c.credential_url) out.push(para(c.credential_url as string, ctx, { color: SUBTLE_HEX, after: 30 }))
  }
  return out
}

function renderTechCategories(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const cat of items as AnyItem[]) {
    const catName = ls(cat, 'name', ctx.locale)
    const skills  = (cat.skills as AnyItem[] | undefined) ?? []
    const names   = skills.map((s) => ls(s, 'name', ctx.locale)).filter(Boolean)
    if (!catName && !names.length) continue
    if (ctx.detail === 'summary') {
      out.push(summaryLine(catName || 'Category', names.join(', '), ctx))
      continue
    }
    const sz = ctx.tokens.bodyFontSizePt * 2
    out.push(new Paragraph({
      spacing: { after: 60 },
      children: [
        ...(catName ? [new TextRun({ text: `${catName}: `, bold: true, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
        new TextRun({ text: names.join(', '), font: ctx.tokens.bodyFontDocx, size: sz }),
      ],
    }))
  }
  return out
}

function renderLanguages(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const l of items as AnyItem[]) {
    const name  = ls(l, 'name', ctx.locale)
    const level = ls(l, 'level', ctx.locale)
    const sz = ctx.tokens.bodyFontSizePt * 2
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: name, bold: true, font: ctx.tokens.bodyFontDocx, size: sz }),
        ...(level ? [new TextRun({ text: ` — ${level}`, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
      ],
    }))
  }
  return out
}

function renderPositions(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const p of items as AnyItem[]) {
    const name = ls(p, 'name', ctx.locale)
    const org  = ls(p, 'organisation', ctx.locale)
    const dateStr = dateRange(p, ctx)
    if (ctx.detail === 'summary') {
      out.push(summaryLine(name || 'Role', metaJoin([org, dateStr]), ctx))
      continue
    }
    const sz = ctx.tokens.bodyFontSizePt * 2
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: name, bold: true, font: ctx.tokens.bodyFontDocx, size: sz }),
        ...(org     ? [new TextRun({ text: ` — ${org}`, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
        ...(dateStr ? [new TextRun({ text: `   ${dateStr}`, color: FAINT_HEX, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
      ],
    }))
    const desc = ls(p, 'description', ctx.locale)
    if (desc) out.push(...richParagraphs(desc, ctx, { after: 50 }))
  }
  return out
}

function renderPresentations(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const p of items as AnyItem[]) {
    const title = ls(p, 'title', ctx.locale)
    const event = ls(p, 'event', ctx.locale)
    const date  = dateAt(p, 'date', ctx)
    if (ctx.detail === 'summary') {
      out.push(summaryLine(title || 'Presentation', metaJoin([event, date]), ctx))
      continue
    }
    const sz = ctx.tokens.bodyFontSizePt * 2
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: title, bold: true, font: ctx.tokens.bodyFontDocx, size: sz }),
        ...(event ? [new TextRun({ text: ` — ${event}`, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
        ...(date ? [new TextRun({ text: `   ${date}`, color: FAINT_HEX, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
      ],
    }))
    const desc = ls(p, 'description', ctx.locale)
    if (desc)   out.push(...richParagraphs(desc, ctx, { after: 30 }))
    if (p.url)  out.push(para(p.url as string, ctx, { color: SUBTLE_HEX, after: 40 }))
  }
  return out
}

function renderPublications(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const p of items as AnyItem[]) {
    const title     = ls(p, 'title', ctx.locale)
    const publisher = ls(p, 'publisher', ctx.locale)
    const date      = dateAt(p, 'date', ctx)
    if (ctx.detail === 'summary') {
      out.push(summaryLine(title || 'Publication', metaJoin([publisher, date]), ctx))
      continue
    }
    const sz = ctx.tokens.bodyFontSizePt * 2
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: title, bold: true, font: ctx.tokens.bodyFontDocx, size: sz }),
        ...(publisher ? [new TextRun({ text: ` — ${publisher}`, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
        ...(date      ? [new TextRun({ text: `   ${date}`, color: FAINT_HEX, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
      ],
    }))
    const abstract = ls(p, 'abstract', ctx.locale)
    if (abstract) out.push(...richParagraphs(abstract, ctx, { after: 30 }))
    if (p.url)    out.push(para(p.url as string, ctx, { color: SUBTLE_HEX, after: 40 }))
  }
  return out
}

function renderAwards(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const a of items as AnyItem[]) {
    const name   = ls(a, 'name', ctx.locale)
    const issuer = ls(a, 'issuer', ctx.locale)
    const date   = dateAt(a, 'date', ctx)
    if (ctx.detail === 'summary') {
      out.push(summaryLine(name || 'Award', metaJoin([issuer, date]), ctx))
      continue
    }
    const sz = ctx.tokens.bodyFontSizePt * 2
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: name, bold: true, font: ctx.tokens.bodyFontDocx, size: sz }),
        ...(issuer ? [new TextRun({ text: ` — ${issuer}`, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
        ...(date ? [new TextRun({ text: `   ${date}`, color: FAINT_HEX, font: ctx.tokens.bodyFontDocx, size: sz })] : []),
      ],
    }))
    const desc = ls(a, 'description', ctx.locale)
    if (desc) out.push(...richParagraphs(desc, ctx, { after: 50 }))
  }
  return out
}

function renderReferences(items: unknown[], ctx: ExportCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const ref of items as AnyItem[]) {
    if (!ref.include_in_exports) continue
    if (ctx.detail === 'summary') {
      const meta = [ref.title as string, ref.company as string].filter(Boolean).join(', ')
      out.push(summaryLine(String(ref.name ?? 'Reference'), meta, ctx))
      continue
    }
    const head: TextRun[] = []
    const sz = ctx.tokens.bodyFontSizePt * 2
    if (ref.name)    head.push(new TextRun({ text: String(ref.name),  bold: true, font: ctx.tokens.bodyFontDocx, size: sz }))
    if (ref.title)   head.push(new TextRun({ text: `, ${ref.title as string}`,    font: ctx.tokens.bodyFontDocx, size: sz }))
    if (ref.company) head.push(new TextRun({ text: `, ${ref.company as string}`,  font: ctx.tokens.bodyFontDocx, size: sz }))
    if (head.length) out.push(new Paragraph({ spacing: { after: 30 }, children: head }))
    const ctxBits: string[] = []
    const rel = ls(ref, 'relationship', ctx.locale)
    if (rel)       ctxBits.push(rel)
    if (ref.email) ctxBits.push(String(ref.email))
    if (ref.phone) ctxBits.push(String(ref.phone))
    if (ctxBits.length) out.push(para(ctxBits.join(' · '), ctx, { color: SUBTLE_HEX, after: 50 }))
  }
  return out
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

function byStartDescending(a: AnyItem, b: AnyItem): number {
  const aS = a.start as YM
  const bS = b.start as YM
  const aD = aS ? aS.year * 12 + (aS.month ?? 0) : 0
  const bD = bS ? bS.year * 12 + (bS.month ?? 0) : 0
  return bD - aD
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
