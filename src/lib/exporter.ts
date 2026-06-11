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
  PageOrientation, BorderStyle, ImageRun, Table, TableRow, TableCell,
  TableBorders, WidthType, VerticalAlign,
} from 'docx'
import type {
  ResumeStore, ResumeView, Resume, LocalizedString, SectionDetail, SectionStyle,
  ViewHeaderConfig, FooterSeparator,
} from '../types'
import { SECTIONS } from './sections'
import { resolve } from './locales'
import { SECTION_CATALOG, type AnyItem as CatalogItem, type CatalogCtx, type ItemView } from './sectionCatalog'
import { skillMatrixRows, fmtLastUsed, fmtProficiency, type SkillMatrixRow } from './skillMatrix'
import { applyView, isExportableSection, defaultViewDetail, promotedProjectItems } from './viewFilter'
import { parseRichBlocks, type RichRun } from './richText'
import { deriveTokens, resolveSectionStyle, withDefaults, resolveFontDocx, type ResolvedSectionStyle, type StyleTokens } from './viewStyle'
import { withHeaderDefaults, withFooterDefaults, buildHeaderLines, buildCopyrightLine } from './viewHeader'
import { imageInfoFromDataUrl, applyShapeMaskToDataUrl, type ImageInfo } from './image'

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

// ─── Header image / identity helpers ─────────────────────────────────────────

/** Build an ImageRun scaled to fit within maxW × maxH px, preserving aspect. */
function imageRunScaled(info: ImageInfo, maxW: number, maxH: number): ImageRun {
  const safeW = info.width > 0 ? info.width : maxW
  const safeH = info.height > 0 ? info.height : maxH
  const scale = Math.min(1, maxW / safeW, maxH / safeH)
  return new ImageRun({
    type: info.type,
    data: info.bytes,
    transformation: {
      width: Math.max(1, Math.round(safeW * scale)),
      height: Math.max(1, Math.round(safeH * scale)),
    },
  })
}

function logoAlign(placement: 'left' | 'center' | 'right'): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (placement === 'center') return AlignmentType.CENTER
  if (placement === 'right') return AlignmentType.RIGHT
  return AlignmentType.LEFT
}

/** Build the name / title / contact-line paragraphs for the header. */
function buildIdentityParagraphs(
  r: Resume,
  header: ViewHeaderConfig,
  store: ResumeStore,
  locale: string,
  baseTokens: StyleTokens,
): Paragraph[] {
  const out: Paragraph[] = []
  out.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({
      text: r.full_name,
      bold: true,
      size: (header.name_style.size_pt ?? baseTokens.h1Pt) * 2,
      font: resolveFontDocx(header.name_style.font),
      color: baseTokens.accentHex,
    })],
  }))
  const titleText = L(r.title, locale)
  if (titleText) {
    out.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({
        text: titleText,
        size: (header.title_style.size_pt ?? baseTokens.smallFontSizePt + 1) * 2,
        font: resolveFontDocx(header.title_style.font),
        color: '444444',
      })],
    }))
  }
  const lines = buildHeaderLines(header, r, store, locale)
  const sz = baseTokens.metaFontSizePt * 2
  lines.forEach((line, li) => {
    const runs: TextRun[] = []
    line.forEach((seg, i) => {
      if (i > 0) runs.push(new TextRun({ text: header.separator, color: FAINT_HEX, size: sz, font: baseTokens.bodyFontDocx }))
      if (seg.label) runs.push(new TextRun({ text: seg.label, color: FAINT_HEX, size: sz, font: baseTokens.bodyFontDocx }))
      runs.push(new TextRun({ text: seg.value, color: SUBTLE_HEX, size: sz, font: baseTokens.bodyFontDocx }))
    })
    out.push(new Paragraph({ spacing: { after: li === lines.length - 1 ? 200 : 30 }, children: runs }))
  })
  return out
}

/** Lay identity text beside a photo using a borderless 2-cell table. */
function photoSideTable(photoRun: ImageRun, identity: Paragraph[], placement: 'left' | 'right'): Table {
  const photoCell = new TableCell({
    width: { size: 22, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    margins: { right: placement === 'left' ? 200 : 0, left: placement === 'right' ? 200 : 0 },
    children: [new Paragraph({ children: [photoRun] })],
  })
  const textCell = new TableCell({
    width: { size: 78, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    children: identity,
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    rows: [new TableRow({ children: placement === 'right' ? [textCell, photoCell] : [photoCell, textCell] })],
  })
}

const FOOTER_BORDER: Record<Exclude<FooterSeparator, 'none'>, (typeof BorderStyle)[keyof typeof BorderStyle]> = {
  line:   BorderStyle.SINGLE,
  double: BorderStyle.DOUBLE,
  dotted: BorderStyle.DOTTED,
  dashed: BorderStyle.DASHED,
  thick:  BorderStyle.SINGLE,
}

function footerBorderStyle(sep: FooterSeparator): (typeof BorderStyle)[keyof typeof BorderStyle] {
  return sep === 'none' ? BorderStyle.NONE : FOOTER_BORDER[sep]
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Render a ResumeView to a .docx blob and trigger a browser download.
 * Caller decides the export locale (typically one of the resume's
 * supported_locales).
 */
export async function exportDocx(store: ResumeStore, view: ResumeView, locale: string): Promise<void> {
  const viewStyle = withDefaults(view.style)
  const baseTokens = deriveTokens(viewStyle)
  const header = withHeaderDefaults(view.header)
  const footer = withFooterDefaults(view.footer)
  const filtered = applyView(store, view)
  const children: Array<Paragraph | Table> = []

  // ── Header (configurable identity block + images) ───────────────────────
  const r = filtered.resume
  if (r) {
    // Word can't apply a CSS-style border-radius to an ImageRun, so for the
    // 'rounded' / 'circle' shapes we pre-mask the source data URL into a
    // transparent PNG via canvas. 'square' is the original bytes (no work).
    // Mask failures are tolerated — we fall back to the raw image rather
    // than blocking the whole export.
    const rawPhotoUrl = header.photo_override ?? r.profile_photo ?? null
    let maskedPhotoUrl = rawPhotoUrl
    if (rawPhotoUrl && header.photo_placement !== 'none' && header.photo_shape !== 'square') {
      try {
        maskedPhotoUrl = await applyShapeMaskToDataUrl(rawPhotoUrl, header.photo_shape)
      } catch {
        maskedPhotoUrl = rawPhotoUrl
      }
    }
    const photoInfo = imageInfoFromDataUrl(maskedPhotoUrl)
    const logoInfo  = imageInfoFromDataUrl(header.logo_override ?? r.company_logo ?? null)

    // Logo banner sits at the very top, aligned per its placement.
    if (header.logo_placement !== 'none' && logoInfo) {
      children.push(new Paragraph({
        alignment: logoAlign(header.logo_placement),
        spacing: { after: 140 },
        children: [imageRunScaled(logoInfo, 240, 64)],
      }))
    }

    const identity = buildIdentityParagraphs(r, header, store, locale, baseTokens)

    if (header.photo_placement !== 'none' && photoInfo) {
      const photoRun = imageRunScaled(photoInfo, 132, 156)
      if (header.photo_placement === 'left' || header.photo_placement === 'right') {
        children.push(photoSideTable(photoRun, identity, header.photo_placement))
      } else if (header.photo_placement === 'above') {
        children.push(new Paragraph({ spacing: { after: 100 }, children: [photoRun] }), ...identity)
      } else { // below
        children.push(...identity, new Paragraph({ spacing: { before: 100, after: 120 }, children: [photoRun] }))
      }
    } else {
      children.push(...identity)
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
        detail: vs?.detail ?? defaultViewDetail(s.key),
        sectionStyle: vs?.style as SectionStyle | undefined,
      }
    })
    .filter((s) => s.detail !== 'off')
    .sort((a, b) => a.sort_order - b.sort_order)

  for (const def of enabledSections) {
    if (!def.storeKey) continue
    // Synthetic skill matrix: a real Word table over the registry.
    if (def.key === 'skill_matrix') {
      const resolved = resolveSectionStyle(viewStyle, def.sectionStyle)
      const rows = skillMatrixRows(store, view, locale, { highlightedOnly: def.detail === 'summary' })
      if (!rows.length) continue
      const tokens = deriveTokens(resolved)
      if (!resolved.hide_heading) children.push(sectionHeading(def.label, tokens))
      children.push(skillMatrixTable(rows, !resolved.hide_dates, tokens))
      continue
    }
    // Virtual promoted_projects derives from the starred projects; everything
    // else reads its filtered store array. The label stays "Promoted Projects"
    // but it renders through the project renderer.
    const items = def.key === 'promoted_projects'
      ? promotedProjectItems(store, view)
      : (filtered[def.storeKey] as unknown[])
    if (!items.length) continue
    const resolved = resolveSectionStyle(viewStyle, def.sectionStyle)
    const ctx: ExportCtx = {
      locale,
      detail: def.detail,
      resolved,
      tokens: deriveTokens(resolved),
    }
    const renderKey = def.key === 'promoted_projects' ? 'projects' : def.key
    const block = renderSection(renderKey, def.label, items, ctx)
    if (block.length) children.push(...block)
  }

  // ── Footer (closing visual) ─────────────────────────────────────────────
  if (r) {
    const copyright = buildCopyrightLine(footer, r, new Date().getFullYear(), locale)
    const footerNote = L(footer.note, locale)
    const footerText = [copyright, footerNote].filter(Boolean).join('  ·  ')
    if (footer.separator !== 'none') {
      children.push(new Paragraph({
        spacing: { before: 280, after: footerText ? 60 : 0 },
        border: {
          top: {
            style: footerBorderStyle(footer.separator),
            color: baseTokens.accentHex,
            space: 1,
            size: footer.separator === 'thick' ? 18 : 6,
          },
        },
        children: [],
      }))
    }
    if (footerText) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: footer.separator === 'none' ? 280 : 0 },
        children: [new TextRun({
          text: footerText,
          size: baseTokens.metaFontSizePt * 2,
          color: FAINT_HEX,
          font: baseTokens.bodyFontDocx,
        })],
      }))
    }
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

/**
 * Generic DOCX section renderer (roadmap A5): walks the section's catalog
 * descriptor (lib/sectionCatalog.ts) and lays out the returned data views.
 * Section semantics (which fields, fallbacks, per-path drift) live in the
 * catalog; this file only owns DOCX layout. The skill/role registries have no
 * `full` renderer in the catalog, so they fall through to [] as before.
 */
function renderSection(key: string, label: string, items: unknown[], ctx: ExportCtx): Paragraph[] {
  const desc = SECTION_CATALOG[key]
  if (!desc || (!desc.full && !desc.summary)) return []
  const cctx: CatalogCtx = { locale: ctx.locale, hideDates: !!ctx.resolved.hide_dates, target: 'docx' }
  let list = items as CatalogItem[]
  if (desc.docxSortByStart) list = [...list].sort(byStartDescending)
  const out: Paragraph[] = []
  for (const it of list) {
    if (ctx.detail === 'summary' && !desc.alwaysFull) {
      const s = desc.summary?.(it, cctx)
      if (s) out.push(summaryLine(s.title, s.meta.filter(Boolean).join(' · '), ctx))
      continue
    }
    const v = desc.full?.(it, cctx)
    if (v) out.push(...renderItemDocx(v, ctx))
  }
  return wrap(label, out, ctx)
}

/** Lay out one catalog ItemView as DOCX paragraphs. All text rides in TextRun (XML-escaped by docx). */
function renderItemDocx(v: ItemView, ctx: ExportCtx): Paragraph[] {
  const sz = ctx.tokens.bodyFontSizePt * 2
  const font = ctx.tokens.bodyFontDocx
  const out: Paragraph[] = []

  if (v.layout === 'inline') {
    out.push(new Paragraph({
      spacing: { after: 30 },
      children: [
        new TextRun({ text: v.title, bold: true, font, size: sz }),
        ...(v.meta.length ? [new TextRun({ text: ` — ${v.meta.join(' · ')}`, font, size: sz })] : []),
      ],
    }))
    return out
  }

  if (v.layout === 'quote') {
    if (v.body) out.push(...richParagraphs(v.body, ctx, { italic: true, after: 40 }))
    const tail = [v.attribution, ...v.attributionMeta].filter(Boolean).join(' · ')
    if (tail) {
      out.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: `— ${tail}`, color: SUBTLE_HEX, font, size: sz })],
      }))
    }
    return out
  }

  if (v.title) {
    const titleSize = v.titleStyle === 'large' ? (ctx.tokens.h3Pt + 1) * 2 : sz
    out.push(new Paragraph({
      spacing: { before: v.spacingBefore || undefined, after: 40 },
      children: [
        new TextRun({ text: v.title, bold: true, size: titleSize, font }),
        ...(v.date ? [new TextRun({
          text: `   ${v.date}`, size: ctx.tokens.smallFontSizePt * 2, color: FAINT_HEX, font,
        })] : []),
      ],
    }))
  }
  const metaTxt = v.meta.filter(Boolean).join(' · ')
  if (metaTxt) out.push(para(metaTxt, ctx, { italic: true, color: SUBTLE_HEX, after: 80 }))
  if (v.plainBody) out.push(para(v.plainBody, ctx, { after: 80 }))
  if (v.body) out.push(...richParagraphs(v.body, ctx, { after: 100 }))
  for (const p of v.points) {
    const blocks = parseRichBlocks(p.body)
    const runs = blocks.length ? renderRuns(blocks[0].runs, ctx, {}, sz) : []
    out.push(new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: p.label ? `• ${p.label}` : '• ', bold: !!p.label, font, size: sz }),
        ...(p.label && runs.length ? [new TextRun({ text: ' — ', font, size: sz })] : []),
        ...runs,
      ],
    }))
  }
  if (v.tags.length) {
    const szm = ctx.tokens.metaFontSizePt * 2
    out.push(new Paragraph({
      spacing: { before: 60, after: 100 },
      children: [
        ...(v.tagsLabel ? [new TextRun({ text: v.tagsLabel, italics: true, color: SUBTLE_HEX, font, size: szm })] : []),
        new TextRun({ text: v.tags.join(', '), color: SUBTLE_HEX, font, size: szm }),
      ],
    }))
  }
  for (const line of v.extraLines) {
    out.push(para(line, ctx, { color: SUBTLE_HEX, after: 40 }))
  }
  return out
}

function wrap(label: string, body: Paragraph[], ctx: ExportCtx): Paragraph[] {
  if (!body.length) return []
  if (ctx.resolved.hide_heading) return body
  return [sectionHeading(label, ctx.tokens), ...body]
}

// ─── Skill matrix table (F9) ──────────────────────────────────────────────────

function matrixCell(text: string, tokens: StyleTokens, opts: { bold?: boolean; width: number }): TableCell {
  return new TableCell({
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    margins: { top: 40, bottom: 40, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({
        text,
        bold: opts.bold,
        size: tokens.smallFontSizePt * 2,
        font: tokens.bodyFontDocx,
        color: opts.bold ? tokens.accentHex : '374151',
      })],
    })],
  })
}

/** The competency-matrix table: skill × experience × proficiency × last used. */
function skillMatrixTable(rows: SkillMatrixRow[], showDates: boolean, tokens: StyleTokens): Table {
  const widths = showDates ? [40, 20, 20, 20] : [50, 25, 25]
  const header = new TableRow({
    tableHeader: true,
    children: [
      matrixCell('Skill', tokens, { bold: true, width: widths[0] }),
      matrixCell('Experience', tokens, { bold: true, width: widths[1] }),
      matrixCell('Proficiency', tokens, { bold: true, width: widths[2] }),
      ...(showDates ? [matrixCell('Last used', tokens, { bold: true, width: widths[3] })] : []),
    ],
  })
  const body = rows.map((r) => new TableRow({
    children: [
      matrixCell(r.name, tokens, { width: widths[0] }),
      matrixCell(r.years > 0 ? `${r.years} yrs` : '', tokens, { width: widths[1] }),
      matrixCell(fmtProficiency(r.proficiency), tokens, { width: widths[2] }),
      ...(showDates ? [matrixCell(fmtLastUsed(r), tokens, { width: widths[3] })] : []),
    ],
  }))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    rows: [header, ...body],
  })
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

type AnyItem = Record<string, unknown>
type YM = { year: number; month: number | null } | null


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
