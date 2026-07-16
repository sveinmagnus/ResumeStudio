/**
 * Resume Studio — PDF export (vector, client-side)
 *
 * Renders a ResumeView straight to a downloadable .pdf using `pdfmake`, so the
 * user gets a one-click file instead of the browser print dialog. It mirrors
 * the DOCX exporter (lib/exporter.ts): the view filter (lib/viewFilter) is
 * applied first, then the surviving content is walked in the view's section
 * order — honouring per-section detail (off/summary/full) and style overrides —
 * through the SAME section-descriptor catalog (lib/sectionCatalog). Section
 * semantics live in the catalog; this module only owns pdfmake layout.
 *
 * Like the DOCX path, the PDF is its OWN rendering engine (pdfmake, not the
 * browser), so the layout is close to but not pixel-identical with the HTML
 * preview — the same deliberate divergence DOCX has. Text stays vector and
 * selectable. Fonts use pdfmake's bundled Roboto (the brand's Open Sans
 * Condensed / Ubuntu aren't embedded); headings still carry the brand navy and
 * weight so the document reads on-brand.
 *
 * This module pulls in pdfmake (~1.5 MB with its font vfs), so it MUST be
 * lazy-imported by the caller:
 *   const { exportPdf } = await import('./pdfExporter')
 */

import type {
  ResumeStore, ResumeView, Resume, LocalizedString, SectionDetail, SectionStyle,
  ViewHeaderConfig, FooterSeparator,
} from '../types'
import { SECTIONS, localizedSectionHeading } from './sections'
import { resolve, type DateFormat } from './locales'
import { xs, fmtYears } from './exportStrings'
import { SECTION_CATALOG, summaryTitleMeta, type AnyItem as CatalogItem, type CatalogCtx, type ItemView } from './sectionCatalog'
import { skillMatrixRows, fmtLastUsed, fmtProficiency, type SkillMatrixRow } from './skillMatrix'
import { applyView, isExportableSection, defaultViewDetail, promotedProjectItems } from './viewFilter'
import { showcaseGroups } from './showcase'
import { parseRichBlocks } from './richText'
import { sortItems } from './sectionSort'
import {
  deriveTokens, resolveSectionStyle, sectionHeadingText, kqVisibility, withDefaults,
  withResolvedFonts, resolveFontPdf,
  type ResolvedSectionStyle, type StyleTokens,
} from './viewStyle'
import type { GlobalFonts } from './fonts'
import { withHeaderDefaults, withFooterDefaults, buildHeaderLines, buildCopyrightLine, footerLines } from './viewHeader'
import { imageInfoFromDataUrl, applyShapeMaskToDataUrl, type ImageInfo } from './image'
import { exportFilename } from './exportFilename'

// ─── Colors (match the DOCX exporter's subtle/faint greys) ──────────────────
const INK = '#222222'
const META = '#333333'
const SUBTLE = '#666666'
const FAINT = '#888888'
const TITLE_INK = '#444444'

// A4 width in points; content width is derived from the page margins.
const A4_WIDTH_PT = 595.28

// pdfmake's doc definition is a loose, self-validating shape — model nodes as
// records rather than pulling in @types/pdfmake for its sprawling union.
type PdfNode = Record<string, unknown> | string
type Margin = [number, number, number, number]

interface ExportCtx {
  locale: string
  detail: SectionDetail
  resolved: ResolvedSectionStyle
  tokens: StyleTokens
}

const twip = (t: number): number => t / 20 // twips → points

function L(ls: LocalizedString | undefined, locale: string): string {
  return resolve(ls, locale)
}

// ─── Text helpers ───────────────────────────────────────────────────────────

interface PStyle { italics?: boolean; bold?: boolean; color?: string; bottom?: number; size?: number }

function para(text: string, tokens: StyleTokens, opts: PStyle = {}): PdfNode {
  return {
    text,
    italics: opts.italics,
    bold: opts.bold,
    color: opts.color ?? INK,
    fontSize: opts.size ?? tokens.bodyFontSizePt,
    margin: [0, 0, 0, opts.bottom ?? 4] as Margin,
  }
}

/** Rich-text value → pdfmake paragraphs / bullet lines (mirrors richParagraphs). */
function richToPdf(html: string, tokens: StyleTokens, opts: PStyle = {}): PdfNode[] {
  const blocks = parseRichBlocks(html)
  if (!blocks.length) return []
  const out: PdfNode[] = []
  const fontSize = tokens.bodyFontSizePt
  for (const block of blocks) {
    const runs = block.runs.map((r) => ({
      text: r.text,
      bold: r.bold ?? opts.bold,
      italics: r.italic ?? opts.italics,
      decoration: r.underline ? 'underline' : undefined,
    }))
    if (block.kind === 'paragraph') {
      out.push({ text: runs, fontSize, color: opts.color ?? INK, margin: [0, 0, 0, opts.bottom ?? 4] as Margin })
      continue
    }
    const marker = block.ordered ? `${block.index}. ` : '• '
    out.push({
      text: [{ text: marker }, ...runs],
      fontSize,
      color: opts.color ?? INK,
      margin: [10 + block.level * 12, 0, 0, 3] as Margin,
    })
  }
  return out
}

function sectionHeading(label: string, tokens: StyleTokens): PdfNode {
  const accent = `#${tokens.accentHex}`
  return {
    table: {
      widths: ['*'],
      body: [[{ text: label.toUpperCase(), bold: true, color: `#${tokens.headingHex}`, fontSize: tokens.h2Pt, font: tokens.headingPdfFont, border: [false, false, false, true] }]],
    },
    layout: {
      hLineWidth: (i: number) => (i === 1 ? 0.8 : 0),
      vLineWidth: () => 0,
      hLineColor: () => accent,
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 2,
    },
    margin: [0, twip(tokens.itemGapTwips), 0, twip(tokens.sectionHeadingAfterTwips) + 2] as Margin,
  }
}

function summaryLine(title: string, meta: string, tokens: StyleTokens): PdfNode {
  const runs: PdfNode[] = [{ text: title, bold: true }]
  if (meta) runs.push({ text: ` — ${meta}`, color: SUBTLE })
  return { text: runs, fontSize: tokens.smallFontSizePt, margin: [0, 0, 0, 2] as Margin }
}

// ─── Item rendering (mirrors renderItemDocx) ────────────────────────────────

function renderItemPdf(v: ItemView, tokens: StyleTokens): PdfNode[] {
  const fs = tokens.bodyFontSizePt
  const out: PdfNode[] = []

  if (v.layout === 'inline') {
    const runs: PdfNode[] = [{ text: v.title, bold: true }]
    if (v.meta.length) runs.push({ text: ` — ${v.meta.join(' · ')}` })
    out.push({ text: runs, fontSize: fs, color: INK, margin: [0, 0, 0, 3] as Margin })
    return out
  }

  if (v.layout === 'quote') {
    if (v.body) out.push(...richToPdf(v.body, tokens, { italics: true, bottom: 3 }))
    const tail = [v.attribution, ...v.attributionMeta].filter(Boolean).join(' · ')
    if (tail) out.push({ text: `— ${tail}`, color: SUBTLE, fontSize: fs, margin: [0, 0, 0, 8] as Margin })
    return out
  }

  if (v.title) {
    const titleSize = v.titleStyle === 'large' ? tokens.h3Pt + 1 : fs
    const runs: PdfNode[] = [{ text: v.title, bold: true, fontSize: titleSize }]
    if (v.date) runs.push({ text: `   ${v.date}`, fontSize: tokens.smallFontSizePt, color: FAINT })
    out.push({ text: runs, color: INK, margin: [0, v.spacingBefore ? twip(v.spacingBefore) : 0, 0, 3] as Margin })
  }
  const metaTxt = v.meta.filter(Boolean).join(' · ')
  if (metaTxt) out.push(para(metaTxt, tokens, { italics: true, color: SUBTLE, bottom: 5 }))
  if (v.plainBody) out.push(para(v.plainBody, tokens, { bottom: 5 }))
  if (v.body) out.push(...richToPdf(v.body, tokens, { bottom: 6 }))
  for (const p of v.points) {
    const blocks = parseRichBlocks(p.body)
    const runs = blocks.length
      ? blocks[0].runs.map((r) => ({ text: r.text, bold: r.bold, italics: r.italic, decoration: r.underline ? 'underline' : undefined }))
      : []
    const line: PdfNode[] = [{ text: p.label ? `• ${p.label}` : '• ', bold: !!p.label }]
    if (p.label && runs.length) line.push({ text: ' — ' })
    line.push(...runs)
    out.push({ text: line, fontSize: fs, color: INK, margin: [0, 0, 0, 4] as Margin })
  }
  if (v.tags.length) {
    const runs: PdfNode[] = []
    if (v.tagsLabel) runs.push({ text: v.tagsLabel, italics: true })
    runs.push({ text: v.tags.join(', ') })
    out.push({ text: runs, color: SUBTLE, fontSize: tokens.metaFontSizePt, margin: [0, 3, 0, 6] as Margin })
  }
  for (const line of v.extraLines) out.push(para(line, tokens, { color: SUBTLE, bottom: 3 }))
  return out
}

// ─── Section dispatcher (mirrors renderSection) ─────────────────────────────

function renderSection(key: string, label: string, items: unknown[], ctx: ExportCtx): PdfNode[] {
  const desc = SECTION_CATALOG[key]
  if (!desc || (!desc.full && !desc.summary)) return []
  const cctx: CatalogCtx = {
    locale: ctx.locale, hideDates: !!ctx.resolved.hide_dates, dateFormat: ctx.resolved.date_format,
    target: 'docx', kq: kqVisibility(ctx.resolved, ctx.detail === 'summary' ? 'summary' : 'full'),
  }
  // Items arrive already ordered by the caller (the view's per-section sort).
  const list = items as CatalogItem[]
  const body: PdfNode[] = []
  for (const it of list) {
    if (ctx.detail === 'summary' && !desc.alwaysFull) {
      const s = desc.summary?.(it, cctx)
      if (s) {
        const { title, meta } = summaryTitleMeta(s)
        const short = L((it as Record<string, unknown>).short_description as LocalizedString | undefined, ctx.locale).trim()
        const metaStr = meta.join(' · ')
        const below = !!short && ctx.resolved.short_desc_line !== 'inline'
        const line = short && !below ? [metaStr, short].filter(Boolean).join(' — ') : metaStr
        body.push(summaryLine(title, line, ctx.tokens))
        if (below) body.push(para(short, ctx.tokens, { color: SUBTLE, bottom: 3 }))
      }
      continue
    }
    const v = desc.full?.(it, cctx)
    if (v) body.push(...renderItemPdf(v, ctx.tokens))
  }
  if (!body.length) return []
  return ctx.resolved.hide_heading ? body : [sectionHeading(label, ctx.tokens), ...body]
}

// ─── Skill matrix table (mirrors skillMatrixTable) ──────────────────────────

function skillMatrixTable(
  rows: SkillMatrixRow[], showDates: boolean, tokens: StyleTokens,
  locale: string, dateFormat: DateFormat,
): PdfNode {
  const showCategory = rows.some((r) => r.category)
  const cols: Array<{ key: 'skill' | 'category' | 'exp' | 'prof' | 'date'; label: string }> = [
    { key: 'skill', label: xs('matrix_skill', locale) },
    ...(showCategory ? [{ key: 'category' as const, label: xs('matrix_category', locale) }] : []),
    { key: 'exp', label: xs('matrix_experience', locale) },
    { key: 'prof', label: xs('matrix_proficiency', locale) },
    ...(showDates ? [{ key: 'date' as const, label: xs('matrix_last_used', locale) }] : []),
  ]
  const accent = `#${tokens.accentHex}`
  const cellText = (key: typeof cols[number]['key'], r: SkillMatrixRow): string => {
    switch (key) {
      case 'skill':    return r.name
      case 'category': return r.category
      case 'exp':      return fmtYears(r.years, locale)
      case 'prof':     return fmtProficiency(r.proficiency)
      case 'date':     return fmtLastUsed(r, locale, dateFormat)
    }
  }
  const headerRow: PdfNode[] = cols.map((c) => ({ text: c.label, bold: true, color: accent, fontSize: tokens.smallFontSizePt }))
  const bodyRows: PdfNode[][] = rows.map((r) =>
    cols.map((c) => ({ text: cellText(c.key, r), color: '#374151', fontSize: tokens.smallFontSizePt } as PdfNode)),
  )
  return {
    table: { headerRows: 1, widths: cols.map(() => '*'), body: [headerRow, ...bodyRows] },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0.5 : 0),
      vLineWidth: () => 0,
      hLineColor: () => '#d1d5db',
      paddingLeft: () => 0, paddingRight: (i: number) => (i === cols.length - 1 ? 0 : 8), paddingTop: () => 3, paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 6] as Margin,
  }
}

// ─── Header identity / images ───────────────────────────────────────────────

function scaleImage(info: ImageInfo, maxW: number, maxH: number): { width: number; height: number } {
  const w = info.width > 0 ? info.width : maxW
  const h = info.height > 0 ? info.height : maxH
  const scale = Math.min(1, maxW / w, maxH / h)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

function buildIdentity(
  r: Resume, header: ViewHeaderConfig, store: ResumeStore, locale: string, tokens: StyleTokens,
): PdfNode[] {
  const accent = `#${tokens.headingHex}`
  const out: PdfNode[] = [{
    text: r.full_name, bold: true, color: accent, font: resolveFontPdf(header.name_style.font, tokens.bodyFontId),
    fontSize: header.name_style.size_pt ?? tokens.h1Pt, margin: [0, 0, 0, 3] as Margin,
  }]
  const titleText = L(header.title_override, locale) || L(r.title, locale)
  if (titleText) {
    out.push({
      text: titleText, color: TITLE_INK, font: resolveFontPdf(header.title_style.font, tokens.bodyFontId),
      fontSize: header.title_style.size_pt ?? tokens.smallFontSizePt + 1, margin: [0, 0, 0, 6] as Margin,
    })
  }
  const lines = buildHeaderLines(header, r, store, locale)
  lines.forEach((line, li) => {
    const runs: PdfNode[] = []
    line.forEach((seg, i) => {
      if (i > 0) runs.push({ text: header.separator, color: FAINT })
      if (seg.label) runs.push({ text: seg.label, color: FAINT })
      runs.push({ text: seg.value, color: SUBTLE })
    })
    out.push({ text: runs, fontSize: tokens.metaFontSizePt, margin: [0, 0, 0, li === lines.length - 1 ? 10 : 1.5] as Margin })
  })
  return out
}

const FOOTER_LINE_WIDTH: Record<Exclude<FooterSeparator, 'none'>, number> = {
  line: 0.6, double: 0.6, dotted: 0.6, dashed: 0.6, thick: 1.6,
}
const FOOTER_DASH: Partial<Record<FooterSeparator, { length: number; space?: number }>> = {
  dotted: { length: 1, space: 2 }, dashed: { length: 4, space: 3 },
}

// ─── Public entry points ─────────────────────────────────────────────────────

/**
 * Build the pdfmake document definition for a view. Pure enough to unit-test
 * (only touches the DOM for rich-text parsing and, when a shaped photo is
 * present, canvas masking). Exported so tests can assert structure without
 * loading pdfmake itself.
 */
export async function buildPdfDocDefinition(
  store: ResumeStore, view: ResumeView, locale: string, globalFonts?: GlobalFonts,
): Promise<Record<string, unknown>> {
  const viewStyle = withResolvedFonts(withDefaults(view.style), globalFonts)
  const baseTokens = deriveTokens(viewStyle)
  const header = withHeaderDefaults(view.header)
  const footer = withFooterDefaults(view.footer)
  const filtered = applyView(store, view)
  const accent = `#${baseTokens.accentHex}`

  const margins = baseTokens.pageMarginTwips
  const pageMargins: Margin = [twip(margins.left), twip(margins.top), twip(margins.right), twip(margins.bottom)]
  const contentWidth = A4_WIDTH_PT - twip(margins.left) - twip(margins.right)

  const content: PdfNode[] = []

  // ── Header (logo, identity, photo) ──────────────────────────────────────
  const r = filtered.resume
  if (r) {
    const rawPhotoUrl = header.photo_override ?? r.profile_photo ?? null
    let photoUrl = rawPhotoUrl
    if (rawPhotoUrl && header.photo_placement !== 'none' && header.photo_shape !== 'square') {
      try { photoUrl = await applyShapeMaskToDataUrl(rawPhotoUrl, header.photo_shape) } catch { photoUrl = rawPhotoUrl }
    }
    const photoInfo = imageInfoFromDataUrl(photoUrl)
    const logoUrl = header.logo_override ?? r.company_logo ?? null
    const logoInfo = imageInfoFromDataUrl(logoUrl)

    if (header.logo_placement !== 'none' && logoInfo && logoUrl) {
      const { width, height } = scaleImage(logoInfo, 160, 48)
      content.push({ image: logoUrl, width, height, alignment: header.logo_placement, margin: [0, 0, 0, 10] as Margin })
    }

    const identity = buildIdentity(r, header, store, locale, baseTokens)
    const p = header.photo_placement

    if (p !== 'none' && photoInfo && photoUrl) {
      const { width, height } = scaleImage(photoInfo, 100, 120)
      const photoNode: PdfNode = { image: photoUrl, width, height }
      if (p === 'left' || p === 'left_of_name') {
        content.push({ columns: [{ width, stack: [photoNode] }, { width: '*', stack: identity }], columnGap: 14, margin: [0, 0, 0, 6] as Margin })
      } else if (p === 'right' || p === 'right_of_name') {
        content.push({ columns: [{ width: '*', stack: identity }, { width, stack: [photoNode] }], columnGap: 14, margin: [0, 0, 0, 6] as Margin })
      } else if (p === 'above') {
        content.push({ ...photoNode, margin: [0, 0, 0, 8] as Margin }, ...identity)
      } else { // below
        content.push(...identity, { ...photoNode, margin: [0, 6, 0, 8] as Margin })
      }
    } else {
      content.push(...identity)
    }
  }

  // ── Introduction ────────────────────────────────────────────────────────
  const intro = L(view.introduction, locale)
  if (intro) {
    content.push({ text: intro, italics: true, color: META, fontSize: baseTokens.bodyFontSizePt, margin: [0, 4, 0, 12] as Margin })
  }

  // ── Content sections in the view's chosen order ─────────────────────────
  const contentSections = SECTIONS.filter(isExportableSection)
  const enabledSections = contentSections
    .map((s) => {
      const vs = view.sections.find((v) => v.key === s.key)
      return {
        ...s,
        sort_order: vs?.sort_order ?? 999,
        detail: vs?.detail ?? defaultViewDetail(s.key),
        sectionStyle: vs?.style as SectionStyle | undefined,
        sort: vs?.sort ?? 'custom',
      }
    })
    .filter((s) => s.detail !== 'off')
    .sort((a, b) => a.sort_order - b.sort_order)

  for (const def of enabledSections) {
    if (!def.storeKey) continue
    if (def.key === 'skill_matrix') {
      const resolved = resolveSectionStyle(viewStyle, def.sectionStyle)
      const rows = skillMatrixRows(store, view, locale, { highlightedOnly: def.detail === 'summary' })
      if (!rows.length) continue
      const tokens = deriveTokens(resolved)
      if (!resolved.hide_heading) content.push(sectionHeading(sectionHeadingText(resolved, localizedSectionHeading(def.key, locale), locale), tokens))
      content.push(skillMatrixTable(rows, !resolved.hide_dates, tokens, locale, resolved.date_format))
      continue
    }
    const rawItems = def.key === 'promoted_projects'
      ? promotedProjectItems(store, view)
      : def.key === 'technology_categories'
        ? showcaseGroups(store, view, locale)
        : (filtered[def.storeKey] as unknown[])
    if (!rawItems.length) continue
    const resolved = resolveSectionStyle(viewStyle, def.sectionStyle)
    const ctx: ExportCtx = { locale, detail: def.detail, resolved, tokens: deriveTokens(resolved) }
    const renderKey = def.key === 'promoted_projects' ? 'projects' : def.key
    const items = def.key === 'technology_categories'
      ? rawItems
      : sortItems(renderKey, rawItems as Array<{ id: string; sort_order: number }>, def.sort, locale)
    content.push(...renderSection(renderKey, sectionHeadingText(resolved, localizedSectionHeading(def.key, locale), locale), items, ctx))
  }

  // ── Footer (closing visual at the end of the document) ──────────────────
  if (r) {
    const lines = footerLines(footer, buildCopyrightLine(footer, r, new Date().getFullYear(), locale), L(footer.note, locale))
    const footerText = lines.length > 0
    if (footer.separator !== 'none') {
      content.push({
        canvas: [{
          type: 'line', x1: 0, y1: 0, x2: contentWidth, y2: 0,
          lineWidth: FOOTER_LINE_WIDTH[footer.separator], lineColor: accent,
          ...(FOOTER_DASH[footer.separator] ? { dash: FOOTER_DASH[footer.separator] } : {}),
        }],
        margin: [0, 16, 0, footerText ? 6 : 0] as Margin,
      })
    }
    // One block per line: 'above'/'below' put the note on its own line.
    lines.forEach((line, i) => {
      content.push({
        text: line, alignment: 'center', color: FAINT, fontSize: baseTokens.metaFontSizePt,
        margin: [0, i === 0 && footer.separator === 'none' ? 16 : 0, 0, 0] as Margin,
      })
    })
  }

  return {
    pageSize: 'A4',
    pageMargins,
    defaultStyle: { font: baseTokens.bodyPdfFont, fontSize: baseTokens.bodyFontSizePt, lineHeight: baseTokens.lineHeight, color: INK },
    content,
  }
}

/**
 * Render a ResumeView straight to a downloadable .pdf. Lazy-loads pdfmake and
 * its font vfs, then hands the browser the file — no print dialog.
 */
export async function exportPdf(store: ResumeStore, view: ResumeView, locale: string, globalFonts?: GlobalFonts): Promise<void> {
  const docDefinition = await buildPdfDocDefinition(store, view, locale, globalFonts)
  const [pdfMakeMod, fontsMod] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  const pdfMake = pdfMakeMod.default
  // pdfmake 0.2.x ships the vfs as the module default; tolerate a namespace
  // wrapper too so a bundler interop quirk doesn't break the export.
  const fonts = fontsMod as unknown as { default?: Record<string, string> } & Record<string, string>
  pdfMake.vfs = fonts.default ?? fonts
  // Roboto is embedded (bundled vfs); Times / Helvetica / Courier are the PDF
  // standard-14 base fonts — pdfkit renders them without any embedded file, so a
  // font choice maps onto one of these (see lib/fonts.ts) and the PDF matches
  // the family's look without shipping extra font binaries.
  pdfMake.fonts = {
    Roboto: { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf' },
    Times: { normal: 'Times-Roman', bold: 'Times-Bold', italics: 'Times-Italic', bolditalics: 'Times-BoldItalic' },
    Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
    Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' },
  }
  pdfMake.createPdf(docDefinition).download(exportFilename(store.resume?.full_name, view.name, 'pdf'))
}
