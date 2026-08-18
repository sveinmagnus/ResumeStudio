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
  TableBorders, WidthType, VerticalAlign, LineRuleType, ShadingType,
} from 'docx'
import type {
  ResumeStore, ResumeView, Resume, LocalizedString, SectionDetail,
  ViewHeaderConfig, FooterSeparator, CoverLetter, FullLayout, SummaryLayout,
} from '../types'
import { resolveLetterParts } from './coverLetter'
import { localizedSectionHeading } from './sections'
import { resolve, type DateFormat } from './locales'
import {
  SECTION_CATALOG,
  type AnyItem as CatalogItem, type CatalogCtx, type ItemView,
  type SummaryView, type SummaryPartKey,
} from './sectionCatalog'
import {
  summarySegments, fullItemLayout, summaryColumns, tabulatedColumns,
  type SummarySegment,
} from './itemLayout'
import { skillMatrixRows, fmtLastUsed, fmtProficiency, type SkillMatrixRow } from './skillMatrix'
import { xs, fmtYears } from './exportStrings'
import { applyView, viewProfileTagLine } from './viewFilter'
import { planViewSections, sectionItems, renderKeyFor } from './viewSectionPlan'
import { parseRichBlocks, plainParagraphs, type RichRun } from './richText'
import { sectionIconDataUri, BLANK_PNG_URI } from './sectionIcon'
import { deriveTokens, dividerSpec, tagChipHex, resolveSectionStyle, sectionHeadingText, kqVisibility, bulletGlyph, withDefaults, withResolvedFonts, resolveFontDocx, type ResolvedSectionStyle, type StyleTokens, type DividerSpec, type DividerKind } from './viewStyle'
import type { GlobalFonts } from './fonts'
import { withHeaderDefaults, withFooterDefaults, buildHeaderLines, buildCopyrightLine, footerLines } from './viewHeader'
import { imageInfoFromDataUrl, applyShapeMaskToDataUrl, type ImageInfo } from './image'
import { exportFilename } from './exportFilename'
import { downloadBlob } from './download'

const SUBTLE_HEX = '666666'
const FAINT_HEX  = '888888'

// ─── Context plumbed through every renderer ─────────────────────────────────

interface ExportCtx {
  locale: string
  detail: SectionDetail
  /** The section's lucide icon name, drawn before the heading when enabled. */
  icon: string
  /** Resolved style for this section (view defaults overlaid with section overrides). */
  resolved: ResolvedSectionStyle
  /** Tokens derived from `resolved` — pre-computed for cheap reads. */
  tokens: StyleTokens
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function L(ls: LocalizedString | undefined, locale: string): string {
  return resolve(ls, locale)
}

interface PStyle {
  italic?: boolean; bold?: boolean; color?: string; after?: number; before?: number
  /** Paragraph left / hanging indent in twips (used by the item-bullet layout). */
  indent?: { left?: number; hanging?: number }
}

function para(text: string, ctx: ExportCtx, opts: PStyle = {}): Paragraph {
  return new Paragraph({
    spacing: { before: opts.before, after: opts.after ?? 60 },
    indent: opts.indent,
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
  blocks.forEach((block, i) => {
    const runs = renderRuns(block.runs, ctx, opts, fontSize)
    // Between two paragraphs of the same body: the shared 1.5-line gap. After
    // the LAST one: the caller's gap to whatever follows the block (the DOCX
    // twin of `p:last-child { margin-bottom: 0 }` plus a container margin).
    const last = i === blocks.length - 1
    if (block.kind === 'paragraph') {
      out.push(new Paragraph({
        spacing: {
          before: i === 0 ? opts.before : undefined,
          after: last ? (opts.after ?? ctx.tokens.paraGapTwips) : ctx.tokens.paraGapTwips,
        },
        indent: opts.indent,
        children: runs,
      }))
      return
    }
    const marker = block.ordered ? `${block.index}. ` : '• '
    out.push(new Paragraph({
      spacing: { after: 30 },
      indent: { left: (opts.indent?.left ?? 0) + 360 + block.level * 360 },
      children: [
        new TextRun({ text: marker, font: ctx.tokens.bodyFontDocx, color: opts.color, size: fontSize }),
        ...runs,
      ],
    }))
  })
  return out
}

/**
 * Runs → docx TextRuns. A newline inside a run (a `<br>` in a list item, the
 * only place one survives canonicalisation) becomes a REAL Word break. A raw
 * "\n" in `<w:t>` is just XML whitespace: Word renders it as a SPACE while the
 * preview and the PDF show a line break.
 */
function renderRuns(runs: RichRun[], ctx: ExportCtx, opts: PStyle, fontSize: number): TextRun[] {
  const out: TextRun[] = []
  for (const r of runs) {
    const common = {
      bold: r.bold ?? opts.bold,
      italics: r.italic ?? opts.italic,
      underline: r.underline ? {} : undefined,
      color: opts.color,
      size: fontSize,
      font: ctx.tokens.bodyFontDocx,
    }
    r.text.split('\n').forEach((piece, i) => {
      if (!i && !piece) return
      out.push(new TextRun({ ...common, text: piece, ...(i ? { break: 1 } : {}) }))
    })
  }
  return out
}

/** Every block's runs as one inline sequence, paragraphs joined by a space. */
function flattenBlocks(blocks: ReturnType<typeof parseRichBlocks>): RichRun[] {
  const out: RichRun[] = []
  for (const block of blocks) {
    if (out.length) out.push({ text: ' ' })
    out.push(...block.runs)
  }
  return out
}

function sectionHeading(
  label: string, tokens: StyleTokens, icon: string | null = null,
): Paragraph {
  const svg = icon ? sectionIconDataUri(icon, tokens.accentHex) : null
  // Word draws the vector from Office 2016 on; the required raster fallback
  // is blank because an older Word has no way to draw the glyph at all, and
  // a missing icon beats a wrong-looking bitmap.
  const iconRuns = svg
    ? [
      new ImageRun({
        type: 'svg',
        data: svg,
        fallback: { type: 'png', data: BLANK_PNG_URI },
        transformation: { width: tokens.h2Pt, height: tokens.h2Pt },
      }),
      new TextRun({ text: '  ', size: tokens.h2Pt * 2, font: tokens.headingFontDocx }),
    ]
    : []
  return new Paragraph({
    spacing: { before: tokens.itemGapTwips * 2, after: tokens.sectionHeadingAfterTwips },
    border: { bottom: { color: tokens.accentHex, space: 1, style: BorderStyle.SINGLE, size: 8 } },
    children: [
      ...iconRuns,
      new TextRun({
        text: label.toUpperCase(),
        bold: true,
        color: tokens.headingHex,
        size: tokens.h2Pt * 2,
        font: tokens.headingFontDocx,
      }),
    ],
  })
}

/**
 * A near-invisible paragraph that only contributes `beforeTwips` of top space —
 * used when a section's heading is hidden, so the section keeps the top margin
 * the heading would have provided instead of crowding the previous one. The tiny
 * empty run keeps the spacer's own line height negligible.
 */
function topSpacer(beforeTwips: number): Paragraph {
  return new Paragraph({
    spacing: { before: beforeTwips, after: 0 },
    children: [new TextRun({ text: '', size: 2 })],
  })
}

/**
 * Emit a single-line summary paragraph: bold title plus an inline meta tail.
 */
function summaryLine(segments: SummarySegment[], trail: string, ctx: ExportCtx): Paragraph {
  const size = ctx.tokens.smallFontSizePt * 2
  const font = ctx.tokens.bodyFontDocx
  const children: TextRun[] = []
  for (const g of segments) {
    if (g.joiner) children.push(new TextRun({ text: g.joiner, size, font }))
    children.push(g.slot === 'title'
      ? new TextRun({ text: g.text, bold: true, size, font })
      : new TextRun({ text: g.text, color: SUBTLE_HEX, size, font }))
  }
  if (trail) {
    children.push(new TextRun({
      text: `${children.length ? ' — ' : ''}${trail}`, color: SUBTLE_HEX, size, font,
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
  view: ResumeView,
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
      font: resolveFontDocx(header.name_style.font, baseTokens.bodyFontId),
      color: baseTokens.headingHex,
    })],
  }))
  const titleText = L(header.title_override, locale) || viewProfileTagLine(store, view, locale) || L(r.title, locale)
  if (titleText) {
    out.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({
        text: titleText,
        size: (header.title_style.size_pt ?? baseTokens.smallFontSizePt + 1) * 2,
        font: resolveFontDocx(header.title_style.font, baseTokens.bodyFontId),
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
export async function exportDocx(store: ResumeStore, view: ResumeView, locale: string, globalFonts?: GlobalFonts): Promise<void> {
  const viewStyle = withResolvedFonts(withDefaults(view.style), globalFonts)
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

    const identity = buildIdentityParagraphs(r, header, store, view, locale, baseTokens)

    if (header.photo_placement !== 'none' && photoInfo) {
      const photoRun = imageRunScaled(photoInfo, 132, 156)
      const p = header.photo_placement
      if (p === 'left' || p === 'right' || p === 'left_of_name' || p === 'right_of_name') {
        // DOCX approximates the "…_of_name" variants as a side-by-side table
        // (splitting name/title from contact into Word tables isn't worth it).
        children.push(photoSideTable(photoRun, identity, p === 'right' || p === 'right_of_name' ? 'right' : 'left'))
      } else if (header.photo_placement === 'above') {
        children.push(new Paragraph({ spacing: { after: 100 }, children: [photoRun] }), ...identity)
      } else {
        // photo_placement === 'below'
        children.push(...identity, new Paragraph({ spacing: { before: 100, after: 120 }, children: [photoRun] }))
      }
    } else {
      children.push(...identity)
    }
  }

  // ── Introduction (view-specific) ────────────────────────────────────────
  const introParas = plainParagraphs(L(view.introduction, locale))
  introParas.forEach((text, i) => {
    children.push(new Paragraph({
      spacing: {
        before: i === 0 ? 80 : undefined,
        after: i === introParas.length - 1 ? 220 : baseTokens.paraGapTwips,
      },
      alignment: AlignmentType.LEFT,
      children: [new TextRun({
        text,
        italics: true,
        font: baseTokens.bodyFontDocx,
        color: '333333',
        size: baseTokens.bodyFontSizePt * 2,
      })],
    }))
  })

  // ── Content sections in the view's chosen order ─────────────────────────
  for (const def of planViewSections(view)) {
    if (!def.storeKey) continue
    // Synthetic skill matrix: a real Word table over the registry.
    if (def.key === 'skill_matrix') {
      const resolved = resolveSectionStyle(viewStyle, def.sectionStyle)
      const rows = skillMatrixRows(store, view, locale, { highlightedOnly: def.detail === 'summary' })
      if (!rows.length) continue
      const tokens = deriveTokens(resolved)
      if (!resolved.hide_heading) children.push(sectionHeading(sectionHeadingText(resolved, localizedSectionHeading(def.key, locale), locale), tokens, resolved.show_icon ? def.icon : null))
      else children.push(topSpacer(tokens.itemGapTwips * 2))
      children.push(skillMatrixTable(rows, !resolved.hide_dates, tokens, locale, resolved.date_format))
      continue
    }
    // Item source + the view's per-section sort — see lib/viewSectionPlan.
    const items = sectionItems(store, view, filtered, def, locale)
    if (!items.length) continue
    const resolved = resolveSectionStyle(viewStyle, def.sectionStyle, renderKeyFor(def.key))
    const ctx: ExportCtx = {
      locale,
      detail: def.detail,
      resolved,
      tokens: deriveTokens(resolved),
      icon: def.icon,
    }
    const renderKey = renderKeyFor(def.key)
    const block = renderSection(renderKey, sectionHeadingText(resolved, localizedSectionHeading(def.key, locale), locale), items, ctx)
    if (block.length) children.push(...block)
  }

  // ── Footer (closing visual) ─────────────────────────────────────────────
  if (r) {
    const lines = footerLines(footer, buildCopyrightLine(footer, r, new Date().getFullYear(), locale), L(footer.note, locale))
    const footerText = lines.length > 0
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
    // One paragraph per line: 'above'/'below' put the note on its own line.
    lines.forEach((line, i) => {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: i === 0 && footer.separator === 'none' ? 280 : 0 },
        children: [new TextRun({
          text: line,
          size: baseTokens.metaFontSizePt * 2,
          color: FAINT_HEX,
          font: baseTokens.bodyFontDocx,
        })],
      }))
    })
  }

  // ── Page setup — A4 with style-driven margins ───────────────────────────
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: baseTokens.bodyFontDocx, size: baseTokens.bodyFontSizePt * 2 },
          // Density sets line height in the preview and the PDF; Word takes it
          // as a multiple of single spacing (240 twips), so the same three
          // densities read the same in all three rather than only two.
          paragraph: {
            spacing: { line: Math.round(baseTokens.lineHeight * 240), lineRule: LineRuleType.AUTO },
          },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          // A4 in twips.
          size: { orientation: PageOrientation.PORTRAIT, width: 11906, height: 16838 },
          margin: baseTokens.pageMarginTwips,
        },
      },
      children,
    }],
  })

  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, exportFilename(store.resume?.full_name, view.name, 'docx'))
}

// ─── Cover letter (DOCX) ──────────────────────────────────────────────────────

/**
 * A cover letter as a `.docx`. Reuses the referenced view's resolved fonts +
 * accent (like the PDF letter path) so letter and CV match, but it's a plain
 * letter layout that shares only `resolveLetterParts` and this module's docx
 * plumbing — not the CV section renderer. `docx` XML-escapes every `TextRun`,
 * so this is XSS-safe by construction (see the security skill).
 */
export async function exportCoverLetterDocx(
  store: ResumeStore, letter: CoverLetter, locale: string, globalFonts?: GlobalFonts,
): Promise<void> {
  const parts = resolveLetterParts(store, letter, locale)
  const style = withResolvedFonts(withDefaults(parts.view?.style ?? {} as ResumeView['style']), globalFonts)
  const tokens = deriveTokens(style)
  const font = tokens.bodyFontDocx
  // Doubled because docx sizes are half-points.
  const sz = tokens.bodyFontSizePt * 2
  const accent = tokens.accentHex

  const run = (text: string, o: { bold?: boolean; color?: string; size?: number } = {}) =>
    new TextRun({ text, bold: o.bold, color: o.color, size: o.size ?? sz, font })
  const line = (text: string, o: { bold?: boolean; color?: string; size?: number; after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
    new Paragraph({ spacing: { after: o.after ?? 120 }, alignment: o.align, children: [run(text, o)] })

  const children: Paragraph[] = []

  if (parts.senderName) children.push(line(parts.senderName, { bold: true, color: accent, size: sz + 10, after: 40 }))
  if (parts.senderContact.length) children.push(line(parts.senderContact.join('  ·  '), { color: '333333', size: sz - 2, after: 320 }))
  if (parts.dateline) children.push(line(parts.dateline, { after: 320 }))
  for (const rl of parts.recipient) children.push(line(rl, { after: 40 }))
  if (parts.recipient.length) children[children.length - 1] = line(parts.recipient[parts.recipient.length - 1], { after: 320 })
  if (parts.subject) children.push(line(parts.subject, { bold: true, after: 280 }))
  if (parts.greeting) children.push(line(parts.greeting, { after: 200 }))
  for (const p of parts.paragraphs) children.push(line(p, { after: 200, align: AlignmentType.JUSTIFIED }))
  if (parts.closing) children.push(line(parts.closing, { after: 40 }))
  if (parts.senderName) children.push(line(parts.senderName, { bold: true }))

  const doc = new Document({
    styles: { default: { document: { run: { font, size: sz } } } },
    sections: [{
      // A4, with ~2 cm margins all round. Letters use a fixed margin rather
      // than the view's page-margin token — a letter is not a CV page.
      properties: { page: {
        size: { orientation: PageOrientation.PORTRAIT, width: 11906, height: 16838 },
        margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
      } },
      children,
    }],
  })
  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, exportFilename(store.resume?.full_name, letter.name || 'cover-letter', 'docx'))
}

const DIVIDER_BORDER: Record<Exclude<DividerKind, 'none'>, (typeof BorderStyle)[keyof typeof BorderStyle]> = {
  solid: BorderStyle.SINGLE,
  dashed: BorderStyle.DASHED,
  dotted: BorderStyle.DOTTED,
  double: BorderStyle.DOUBLE,
}

/**
 * The rule drawn between two items, from the same {@link dividerSpec} the
 * preview and the PDF read.
 *
 * Word has no free-standing rule either: it is an empty paragraph carrying a
 * bottom border. The run is 1 half-point so the paragraph adds a hairline of
 * height rather than a blank line. A SHORT rule can't be a paragraph border
 * (those span the column), so it becomes a fixed-width one-cell table.
 */
function itemDivider(spec: DividerSpec, gapTwips: number): Paragraph | Table | null {
  if (spec.kind === 'none') return null
  const border = {
    style: DIVIDER_BORDER[spec.kind],
    // Word measures a border in EIGHTHS of a point.
    size: Math.max(1, Math.round(spec.weightPt * 8)),
    color: spec.colorHex,
    space: 1,
  }
  const gap = Math.round(gapTwips / 2)
  if (spec.widthPt !== null) {
    return new Table({
      width: { size: Math.round(spec.widthPt * 20), type: WidthType.DXA },
      borders: { ...TableBorders.NONE, bottom: border },
      rows: [new TableRow({
        children: [new TableCell({
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          children: [new Paragraph({ spacing: { before: gap, after: gap, line: 20 }, children: [new TextRun({ text: '', size: 1 })] })],
        })],
      })],
    })
  }
  return new Paragraph({
    border: { bottom: border },
    spacing: { before: gap, after: gap, line: 20 },
    children: [new TextRun({ text: '', size: 1 })],
  })
}

/** The separator glyph between a start and end date column. */
const MIDDOT = '·'
/** A hard line break inside a tabulated cell (Languages' Europass column). */
const NEWLINE = '\n'

/**
 * A summary section laid out as aligned columns — one column per present part,
 * in the view's slot order, from the same helpers the preview's CSS grid uses.
 *
 * A borderless Word table, because that is what aligns. The divider, if the
 * view draws one, becomes the row's bottom border rather than a paragraph
 * between rows, so the rules span the full width like the preview's.
 */
function tabulatedSummary(
  summaries: SummaryView[], tokens: StyleTokens, layout: SummaryLayout, divider: DividerSpec,
): Table | null {
  const partCols = summaryColumns(summaries, layout)
  if (!partCols.length) return null
  const cols = tabulatedColumns(partCols)
  const flexes = (c: SummaryPartKey | 'sep'): boolean => c === 'title' || c === 'role' || c === 'org'
  // Text columns share the width; the short date columns take a fixed slice.
  const narrow = cols.filter((c) => !flexes(c)).length
  const wide = cols.length - narrow
  const narrowPct = Math.min(12, narrow ? Math.floor(40 / narrow) : 0)
  const widePct = wide ? Math.floor((100 - narrowPct * narrow) / wide) : 0
  const size = tokens.smallFontSizePt * 2
  const border = divider.kind === 'none' ? undefined : {
    style: DIVIDER_BORDER[divider.kind],
    size: Math.max(1, Math.round(divider.weightPt * 8)),
    color: divider.colorHex,
    space: 1,
  }
  const rows = summaries.map((sum, ri) => {
    const map = new Map(sum.parts.map((pt) => [pt.key, pt.value]))
    const last = ri === summaries.length - 1
    return new TableRow({
      children: cols.map((c) => {
        const text = c === 'sep'
          ? (map.get('start') && map.get('end') ? MIDDOT : '')
          : map.get(c) ?? ''
        return new TableCell({
          width: { size: flexes(c) ? widePct : narrowPct, type: WidthType.PERCENTAGE },
          borders: last || !border ? TableBorders.NONE : { ...TableBorders.NONE, bottom: border },
          margins: { top: 20, bottom: 40, left: 0, right: 120 },
          children: text.split(NEWLINE).map((line) => new Paragraph({
            spacing: { after: 0 },
            children: [new TextRun({
              text: line, size, font: tokens.bodyFontDocx,
              bold: c === 'title' || undefined,
              color: c === 'title' ? undefined : SUBTLE_HEX,
            })],
          })),
        })
      }),
    })
  })
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: TableBorders.NONE, rows })
}

/** What a section contributes to the document: paragraphs, plus the tables a
 *  short divider rule and the skill matrix need. */
type DocBlock = Paragraph | Table

// ─── Section dispatcher ───────────────────────────────────────────────────────

/**
 * Generic DOCX section renderer (roadmap A5): walks the section's catalog
 * descriptor (lib/sectionCatalog.ts) and lays out the returned data views.
 * Section semantics (which fields, fallbacks, per-path drift) live in the
 * catalog; this file only owns DOCX layout. The skill/role registries have no
 * `full` renderer in the catalog, so they fall through to [] as before.
 */
function renderSection(key: string, label: string, items: unknown[], ctx: ExportCtx): DocBlock[] {
  const desc = SECTION_CATALOG[key]
  if (!desc || (!desc.full && !desc.summary)) return []
  const cctx: CatalogCtx = { locale: ctx.locale, hideDates: !!ctx.resolved.hide_dates, dateFormat: ctx.resolved.date_format, target: 'docx', extras: ctx.resolved.extras, kq: kqVisibility(ctx.resolved, ctx.detail === 'summary' ? 'summary' : 'full') }
  // Items arrive already ordered by the caller (the view's per-section sort).
  const list = items as CatalogItem[]
  const spec = dividerSpec(ctx.resolved, ctx.tokens.accentHex)
  if (ctx.detail === 'summary' && !desc.alwaysFull && ctx.resolved.tabulate && desc.summary) {
    const summaries = list.map((it) => desc.summary!(it, { ...cctx, detail: 'tabulated' }))
      .filter((v): v is SummaryView => !!v)
    const table = summaries.length
      ? tabulatedSummary(summaries, ctx.tokens, ctx.resolved.summary_layout,
        ctx.resolved.item_divider ? spec : { ...spec, kind: 'none' })
      : null
    return table ? wrap(label, [table], ctx) : []
  }
  // One item's paragraphs per entry, so a divider can go BETWEEN items
  // rather than after every paragraph.
  const blocks: Paragraph[][] = []
  for (const it of list) {
    const out: Paragraph[] = []
    if (ctx.detail === 'summary' && !desc.alwaysFull) {
      const s = desc.summary?.(it, cctx)
      if (s) {
        const segments = summarySegments(s, ctx.resolved.summary_layout)
        const short = L((it as Record<string, unknown>).short_description as LocalizedString | undefined, ctx.locale).trim()
        const below = !!short && ctx.resolved.short_desc_line !== 'inline'
        out.push(summaryLine(segments, below ? '' : short, ctx))
        if (below) out.push(para(short, ctx, { color: SUBTLE_HEX, after: 60 }))
      }
      if (out.length) blocks.push(out)
      continue
    }
    const v = desc.full?.(it, cctx)
    if (v) {
      out.push(...renderItemDocx(
        v, ctx, ctx.resolved.date_position,
        ctx.resolved.item_bullets ? bulletGlyph(ctx.resolved) : null,
      ))
    }
    if (out.length) blocks.push(out)
  }
  const divider = ctx.resolved.item_divider
    ? itemDivider(spec, ctx.tokens.itemGapTwips)
    : null
  return wrap(label, blocks.flatMap((b, i) =>
    divider && i < blocks.length - 1 ? [...b, divider] : b), ctx)
}

/** Lay out one catalog ItemView as DOCX paragraphs. All text rides in TextRun (XML-escaped by docx). */
function renderItemDocx(
  v: ItemView, ctx: ExportCtx, layout: FullLayout, bullet: string | null = null,
): Paragraph[] {
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

  // Item bullets (opt-in): a hanging indent puts the glyph in the margin and
  // indents every content paragraph so it lines up under the heading. `IND` is
  // ~0.18". The glyph rides the title line via a leading run + tab; with no
  // title (rare — only a heading-less profile block) the content is still
  // indented, just without a glyph.
  const IND = bullet ? 260 : 0
  const bodyIndent = IND ? { left: IND } : undefined

  // The date rides the details line, in the slot the view's full-item layout
  // asks for — not hung off the end of the title, which ignored the setting.
  const { metaParts, metaFirst } = fullItemLayout(v, layout)
  const metaTxt = metaParts.join(' · ')
  const head: Paragraph[] = []
  if (v.title) {
    const titleSize = v.titleStyle === 'large' ? (ctx.tokens.h3Pt + 1) * 2 : sz
    head.push(new Paragraph({
      spacing: { before: v.spacingBefore || undefined, after: 40 },
      indent: IND ? { left: IND, hanging: IND } : undefined,
      children: [
        ...(bullet ? [new TextRun({ text: `${bullet}\t`, bold: true, size: titleSize, font })] : []),
        new TextRun({ text: v.title, bold: true, size: titleSize, font }),
      ],
    }))
  }
  const metaPara = metaTxt
    ? [para(metaTxt, ctx, { italic: true, color: SUBTLE_HEX, after: 80, indent: bodyIndent })]
    : []
  out.push(...(metaFirst ? [...metaPara, ...head] : [...head, ...metaPara]))
  if (v.plainBody) out.push(para(v.plainBody, ctx, { after: 80, indent: bodyIndent }))
  if (v.body) out.push(...richParagraphs(v.body, ctx, { after: 100, indent: bodyIndent }))
  for (const p of v.points) {
    // A point is one bullet line: flatten every paragraph of its body into it
    // rather than dropping all but the first.
    const runs = renderRuns(flattenBlocks(parseRichBlocks(p.body)), ctx, {}, sz)
    out.push(new Paragraph({
      spacing: { after: 60 },
      indent: bodyIndent,
      children: [
        new TextRun({ text: p.label ? `• ${p.label}` : '• ', bold: !!p.label, font, size: sz }),
        ...(p.label && runs.length ? [new TextRun({ text: ' — ', font, size: sz })] : []),
        ...runs,
      ],
    }))
  }
  if (v.tags.length) {
    const szm = ctx.tokens.metaFontSizePt * 2
    // Chips carry the affordance visually, so they drop the label the inline
    // list needs — the same trade the preview makes. Word shades a RUN rather
    // than drawing a box, so a chip is a shaded run padded with spaces.
    const chip = tagChipHex(ctx.tokens.accentHex)
    const children = ctx.tokens.tagStyle === 'chips'
      ? v.tags.flatMap((t, i) => [
        ...(i ? [new TextRun({ text: ' ', font, size: szm })] : []),
        new TextRun({
          text: ` ${t} `, color: ctx.tokens.accentHex, font, size: szm,
          shading: { type: ShadingType.SOLID, fill: chip, color: 'auto' },
        }),
      ])
      : [
        ...(v.tagsLabel ? [new TextRun({ text: v.tagsLabel, italics: true, color: SUBTLE_HEX, font, size: szm })] : []),
        new TextRun({ text: v.tags.join(', '), color: SUBTLE_HEX, font, size: szm }),
      ]
    out.push(new Paragraph({ spacing: { before: 60, after: 100 }, indent: bodyIndent, children }))
  }
  for (const line of v.extraLines) {
    out.push(para(line, ctx, { color: SUBTLE_HEX, after: 40, indent: bodyIndent }))
  }
  return out
}

function wrap(label: string, body: DocBlock[], ctx: ExportCtx): DocBlock[] {
  if (!body.length) return []
  if (ctx.resolved.hide_heading) return [topSpacer(ctx.tokens.itemGapTwips * 2), ...body]
  return [sectionHeading(label, ctx.tokens, ctx.resolved.show_icon ? ctx.icon : null), ...body]
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

/** The competency-matrix table: skill × [category] × experience × proficiency × last used. */
function skillMatrixTable(
  rows: SkillMatrixRow[], showDates: boolean, tokens: StyleTokens,
  locale: string, dateFormat: DateFormat,
): Table {
  const showCategory = rows.some((r) => r.category)
  // Column widths, dropping the columns that aren't shown and re-normalising.
  const cols: Array<{ key: 'skill' | 'category' | 'exp' | 'prof' | 'date'; label: string }> = [
    { key: 'skill', label: xs('matrix_skill', locale) },
    ...(showCategory ? [{ key: 'category' as const, label: xs('matrix_category', locale) }] : []),
    { key: 'exp', label: xs('matrix_experience', locale) },
    { key: 'prof', label: xs('matrix_proficiency', locale) },
    ...(showDates ? [{ key: 'date' as const, label: xs('matrix_last_used', locale) }] : []),
  ]
  const width = Math.round(100 / cols.length)
  const cell = (key: typeof cols[number]['key'], r: SkillMatrixRow): string => {
    switch (key) {
      case 'skill':    return r.name
      case 'category': return r.category
      case 'exp':      return fmtYears(r.years, locale)
      case 'prof':     return fmtProficiency(r.proficiency)
      case 'date':     return fmtLastUsed(r, locale, dateFormat)
    }
  }
  const header = new TableRow({
    tableHeader: true,
    children: cols.map((c) => matrixCell(c.label, tokens, { bold: true, width })),
  })
  const body = rows.map((r) => new TableRow({
    children: cols.map((c) => matrixCell(cell(c.key, r), tokens, { width })),
  }))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    rows: [header, ...body],
  })
}

