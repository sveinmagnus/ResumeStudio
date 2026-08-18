/**
 * Style derivation for Resume Views.
 *
 * The editor stores high-level choices (density, body size, accent, etc.) on
 * a ViewStyle. The HTML and DOCX renderers need concrete values (pt sizes,
 * twip spacing, hex colors) — this module is the single place that maps the
 * choices to those concrete values.
 *
 * Per-section overrides are resolved here too: `resolveSectionStyle(view,
 * section)` returns a fully-populated style for that one section. The
 * renderers only consume resolved styles.
 *
 * Pure module — no React, no DOM. Used by both viewFilter (HTML/PDF) and
 * exporter (DOCX).
 */

import type {
  ViewStyle, SectionStyle, Density, BodySize, PageMargin, TagStyle, DividerStyle,
  SummaryLayout, FullLayout, DateFormat, LocalizedString, BulletStyle,
} from '../types'
import {
  fontById, resolveFontId, CATALOG_DEFAULT_FONTS,
  DEFAULT_HEADING_FONT, DEFAULT_BODY_FONT,
  type GlobalFonts, type PdfBaseFont,
} from './fonts'
import { PARA_GAP_LINES, paraGapEm } from './richText'
import { normalizeExtras, NO_EXTRAS } from './sectionExtras'
import { lookup } from './lookup'

// ─── Defaults ───────────────────────────────────────────────────────────────

/**
 * Cartavio brand defaults — what every view inherits unless the user changed
 * something. Match the original hardcoded styling so a fresh view looks
 * identical to the pre-styling-options output.
 */
export const DEFAULT_VIEW_STYLE: ViewStyle = {
  density: 'normal',
  body_size: 'normal',
  // Fonts inherit the app-wide default (which defaults to the brand fonts), so
  // changing the global default in Settings flows through to views that didn't
  // pick their own. `withResolvedFonts` maps 'inherit' → the concrete id.
  heading_font: 'inherit',
  body_font: 'inherit',
  accent_color: '#002E6E',
  page_margin: 'normal',
  tag_style: 'chips',
  item_divider: true,
  divider_style: 'line',
  item_bullets: false,
  bullet_style: 'disc',
}

/**
 * Merge a possibly-undefined ViewStyle with defaults. Used at the boundary
 * (e.g. loading legacy data, defensive renderers) so the rest of the code
 * sees a populated style.
 */
export function withDefaults(style: Partial<ViewStyle> | undefined): ViewStyle {
  return { ...DEFAULT_VIEW_STYLE, ...(style ?? {}) }
}

/**
 * Validate an accent color down to a safe 6-hex-digit string (no leading '#').
 * Accepts '#rgb' / '#rrggbb' (with or without '#'); anything else falls back
 * to the Cartavio navy default.
 *
 * SECURITY: `accent_color` flows verbatim into the `<style>` block of the
 * exported / previewed document (see viewFilter.buildViewHtml). The editor UI
 * constrains it to a hex value, but a crafted backup / snapshot import does
 * not — an unvalidated value such as `</style><img src=x onerror=…>` would
 * break out of the `<style>` element. Validating at this single render-boundary
 * chokepoint neutralises that for every interpolation site (HTML + DOCX).
 */
export function sanitizeHexColor(input: string | null | undefined, fallback = '002E6E'): string {
  const raw = (input ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase()
  if (/^[0-9a-fA-F]{3}$/.test(raw)) return raw.split('').map((c) => c + c).join('').toUpperCase()
  return fallback
}

// ─── Concrete style tokens ──────────────────────────────────────────────────

/**
 * The values the renderers actually consume. The mapping from the user's
 * high-level ViewStyle to these tokens lives in `deriveTokens` below.
 */
export interface StyleTokens {
  // Typography (HTML uses pt strings; DOCX uses half-points (number) so we
  // expose both so each path picks the form it wants).
  bodyFontSizePt: number
  /** Dates and meta lines — usually `bodyFontSizePt - 1`. */
  smallFontSizePt: number
  /** `bodyFontSizePt - 2`, for `ve-meta` and tag chips. */
  metaFontSizePt: number
  /** The resume name. */
  h1Pt: number
  /** Section heading. */
  h2Pt: number
  /** Item heading. */
  h3Pt: number
  /** Ranges 1.35 – 1.6. */
  lineHeight: number
  // Resolved font catalog ids (for further per-element resolution).
  headingFontId: string
  bodyFontId: string
  // CSS family strings (HTML path)
  headingFontCss: string
  bodyFontCss: string
  // DOCX font names (the docx package expects bare names)
  headingFontDocx: string
  bodyFontDocx: string
  // pdfmake base fonts (standard-14, no embedding)
  headingPdfFont: PdfBaseFont
  bodyPdfFont: PdfBaseFont
  // Spacing
  /** Vertical gap between top-level items in the section (CSS px, DOCX twips). */
  itemGapPx: number
  itemGapTwips: number
  /**
   * Gap between PARAGRAPHS inside one item's body — `PARA_GAP_LINES` of a line
   * box, so paragraphs sit one-and-a-half lines apart in every target. `Em` is
   * for CSS (scales with whatever font size the element uses), `Pt` for pdfmake
   * and `Twips` for DOCX (both fixed to the body size the renderers set).
   */
  paraGapEm: number
  paraGapPt: number
  paraGapTwips: number
  /** Bottom margin under section headings. */
  sectionHeadingAfterPx: number
  sectionHeadingAfterTwips: number
  /** Page padding (HTML body padding / DOCX margins), e.g. "32px 48px". */
  pagePadCss: string
  pageMarginTwips: { top: number; bottom: number; left: number; right: number }
  // Colors
  /** 'RRGGBB' with no '#' — the DOCX form, used for underlines/icons/dividers. */
  accentHex: string
  /** '#RRGGBB' — the HTML form. */
  accentCss: string
  /** Heading TEXT colour; falls back to the accent. */
  headingHex: string
  headingCss: string
  // Tag rendering
  tagStyle: TagStyle
}

const DENSITY_SCALE: Record<Density, { lineHeight: number; itemGapPx: number; itemGapTwips: number; sectionGapPx: number; sectionGapTwips: number }> = {
  compact:  { lineHeight: 1.35, itemGapPx:  9, itemGapTwips:  90, sectionGapPx:  6, sectionGapTwips:  80 },
  normal:   { lineHeight: 1.55, itemGapPx: 14, itemGapTwips: 140, sectionGapPx: 10, sectionGapTwips: 120 },
  spacious: { lineHeight: 1.75, itemGapPx: 20, itemGapTwips: 200, sectionGapPx: 16, sectionGapTwips: 180 },
}

const BODY_SCALE: Record<BodySize, { bodyPt: number; h1Pt: number; h2Pt: number; h3Pt: number }> = {
  small:  { bodyPt:  9, h1Pt: 24, h2Pt: 13, h3Pt: 10 },
  normal: { bodyPt: 11, h1Pt: 30, h2Pt: 15, h3Pt: 11 },
  large:  { bodyPt: 12, h1Pt: 34, h2Pt: 17, h3Pt: 12 },
}

const PAGE_MARGIN_MAP: Record<PageMargin, {
  cssPadding: string
  // twips for DOCX (1 inch = 1440 twips)
  marginTwips: { top: number; bottom: number; left: number; right: number }
}> = {
  // Vertical / horizontal in inches: 0.5/0.6, 0.75/0.85, 1/1.1.
  tight:    { cssPadding: '20px 36px', marginTwips: { top:  720, bottom:  720, left:  864, right:  864 } },
  normal:   { cssPadding: '32px 48px', marginTwips: { top: 1080, bottom: 1080, left: 1224, right: 1224 } },
  generous: { cssPadding: '48px 72px', marginTwips: { top: 1440, bottom: 1440, left: 1584, right: 1584 } },
}

/**
 * Resolve a header text-style font choice (a font id or the sentinel `'body'`)
 * to a CSS family string. `'body'` uses the view's body font. Used by the
 * configurable view header (name / title).
 */
export function resolveFontCss(font: string, bodyFontId: string): string {
  return fontById(font === 'body' ? bodyFontId : font).cssStack
}

/** DOCX equivalent of resolveFontCss — returns the bare font name docx expects. */
export function resolveFontDocx(font: string, bodyFontId: string): string {
  return fontById(font === 'body' ? bodyFontId : font).docxName
}

/** pdfmake equivalent — the standard-14 base font the choice renders as. */
export function resolveFontPdf(font: string, bodyFontId: string): PdfBaseFont {
  return fontById(font === 'body' ? bodyFontId : font).pdfFont
}

/**
 * Replace the `'inherit'` sentinel on a view style's fonts with the app-wide
 * defaults, so the pure renderers only ever see a concrete font id. Called at
 * the top of each export path with the caller's global-default fonts.
 */
export function withResolvedFonts(style: ViewStyle, globals: GlobalFonts = CATALOG_DEFAULT_FONTS): ViewStyle {
  return {
    ...style,
    heading_font: resolveFontId(style.heading_font, globals.heading),
    body_font: resolveFontId(style.body_font, globals.body),
  }
}

/**
 * Resolve a ViewStyle (or section override merged with view) to the concrete
 * tokens that renderers consume. Pure — same input gives the same tokens.
 */
export function deriveTokens(style: ViewStyle): StyleTokens {
  // `?? default` on every map lookup: a crafted import (or stale data) can carry
  // an out-of-enum value that would otherwise index to undefined and throw when
  // a property is read. Renderers must never crash on untrusted view config.
  const density = lookup(DENSITY_SCALE, style.density, DENSITY_SCALE.normal)
  const sizes = lookup(BODY_SCALE, style.body_size, BODY_SCALE.normal)
  const headingFont = fontById(style.heading_font, DEFAULT_HEADING_FONT)
  const bodyFont = fontById(style.body_font, DEFAULT_BODY_FONT)
  const pageMargin = lookup(PAGE_MARGIN_MAP, style.page_margin, PAGE_MARGIN_MAP.normal)
  const accentHex = sanitizeHexColor(style.accent_color)
  // Heading text colour falls back to the accent when unset (back-compat).
  const headingHex = sanitizeHexColor(style.heading_color ?? style.accent_color, accentHex)
  const paraGapPt = Math.round(PARA_GAP_LINES * density.lineHeight * sizes.bodyPt * 10) / 10
  return {
    bodyFontSizePt: sizes.bodyPt,
    smallFontSizePt: Math.max(7, sizes.bodyPt - 1),
    metaFontSizePt: Math.max(7, sizes.bodyPt - 2),
    h1Pt: sizes.h1Pt,
    h2Pt: sizes.h2Pt,
    h3Pt: sizes.h3Pt,
    lineHeight: density.lineHeight,
    headingFontId: headingFont.id,
    bodyFontId: bodyFont.id,
    headingFontCss: headingFont.cssStack,
    bodyFontCss: bodyFont.cssStack,
    headingFontDocx: headingFont.docxName,
    bodyFontDocx: bodyFont.docxName,
    headingPdfFont: headingFont.pdfFont,
    bodyPdfFont: bodyFont.pdfFont,
    itemGapPx: density.itemGapPx,
    itemGapTwips: density.itemGapTwips,
    paraGapEm: paraGapEm(density.lineHeight),
    paraGapPt: paraGapPt,
    paraGapTwips: Math.round(paraGapPt * 20),
    sectionHeadingAfterPx: density.sectionGapPx,
    sectionHeadingAfterTwips: density.sectionGapTwips,
    pagePadCss: pageMargin.cssPadding,
    pageMarginTwips: pageMargin.marginTwips,
    accentHex,
    accentCss: `#${accentHex}`,
    headingHex,
    headingCss: `#${headingHex}`,
    tagStyle: style.tag_style,
  }
}

/**
 * Resolve a per-section style by merging the section override into the view
 * default. Result is a fully populated ViewStyle plus the section-only flags
 * (hide_heading, hide_dates, item_divider).
 */
export interface ResolvedSectionStyle extends ViewStyle {
  hide_heading: boolean
  hide_dates: boolean
  item_divider: boolean
  divider_style: DividerStyle
  /** Draw a bullet before each item heading (resolved: section → view → false). */
  item_bullets: boolean
  /** The bullet glyph (resolved: section → view → 'disc'). */
  bullet_style: BulletStyle
  /** Custom heading text (localized), or undefined to use the section label. */
  heading_text?: LocalizedString
  /** Summary-line slot order (resolved: section → view → 'date-title-org'). */
  summary_layout: SummaryLayout
  /** Full-item title/meta layout (resolved + legacy-normalised: section → view → 'title-org-date'). */
  date_position: FullLayout
  /** Lay summary items out in aligned columns (resolved: section → view → false). */
  tabulate: boolean
  /** Date format (resolved: section → view → 'month-year'). */
  date_format: DateFormat
  /** Plain-summary short-description placement (resolved: section → 'below'). */
  short_desc_line: 'inline' | 'below'
  /** Show the section icon before its heading (resolved: section → view → false). */
  show_icon: boolean
  /** Profile tag-line toggle (see SectionStyle.kq_show_tagline). The deprecated
   *  kq_show_label / kq_show_short / kq_show_long stay on SectionStyle for parse
   *  tolerance but are never resolved — label is gone (the tag line is the
   *  profile's identity now) and short/long are owned by the section MODE. */
  kq_show_tagline?: boolean
  /** Optional content groups enabled for this section, already normalised
   *  against the keys the section declares. Empty = core facts only. */
  extras: ReadonlySet<string>
}

/** The default full-item layout when nothing is set (title first, org then date). */
export const DEFAULT_FULL_LAYOUT: FullLayout = 'title-org-date'
/** The default summary-line slot order when nothing is set. */
export const DEFAULT_SUMMARY_LAYOUT: SummaryLayout = 'date-title-org'

const FULL_LAYOUTS = new Set<string>(['title-org-date', 'title-date-org', 'lead-org-date', 'lead-date-org'])

/**
 * Coerce a stored full-item layout to a valid {@link FullLayout}, mapping the
 * legacy `'default'`/`'leading'` values (and anything unknown) forward. The
 * render boundary calls this so old saved views keep working.
 */
export function normalizeFullLayout(v: string | null | undefined): FullLayout {
  if (v && FULL_LAYOUTS.has(v)) return v as FullLayout
  if (v === 'leading') return 'lead-org-date'
  // Catches the legacy 'default' as well as unknown/undefined.
  return DEFAULT_FULL_LAYOUT
}

/**
 * Which parts of a profile block render. `short`/`long` are driven by the
 * section MODE (Summary → short summary, Full → the long "Full profile"), not
 * by style toggles.
 *
 * The tag line is the profile's identity and doubles as the resume title, so it
 * is HIDDEN in the profile body by default (`kq_show_tagline` absent/false); a
 * view sets it true to show the tag line alongside the description (e.g. when
 * the resume title is overridden). The old per-item "label" is gone entirely.
 *
 * The deprecated `kq_show_label`/`kq_show_short`/`kq_show_long` style fields
 * stay on the type so pre-existing serialized views still parse; they're
 * simply ignored. Default mode is 'full' so legacy callers behave as before.
 */
export function kqVisibility(
  r: ResolvedSectionStyle,
  mode: 'summary' | 'full' = 'full',
): { tagline: boolean; short: boolean; long: boolean } {
  return {
    tagline: r.kq_show_tagline ?? false,
    short: mode === 'summary',
    long: mode === 'full',
  }
}

/**
 * The chip fill behind a skill tag, flattened onto white.
 *
 * The preview draws `accent` at 8% alpha; the PDF and the Word file have no
 * alpha behind a run, so they take the composited colour. One number, so a
 * chip is the same shade in all three rather than a preview-only affordance.
 */
export const TAG_CHIP_ALPHA = 0x14 / 255

export function tagChipHex(accentHex: string): string {
  return flattenOnWhite(accentHex, TAG_CHIP_ALPHA)
}

// ─── Item dividers ───────────────────────────────────────────────

/** The rule a divider draws, in terms every target can express. */
export type DividerKind = 'none' | 'solid' | 'dashed' | 'dotted' | 'double'

export interface DividerSpec {
  kind: DividerKind
  /** Rule thickness in points. */
  weightPt: number
  /** Rule width in points, or null to span the content column. */
  widthPt: number | null
  /** CSS colour, alpha included — what the preview draws. */
  colorCss: string
  /** The same colour flattened onto white, 'RRGGBB' with no '#'. PDF and Word
   *  have no alpha channel on a rule, so they take the composited result. */
  colorHex: string
}

/** Alpha each divider style draws its rule at, over the page. */
const DIVIDER_ALPHA: Record<DividerStyle, number> = {
  line: 0x1a / 255, thick: 0x1a / 255, dashed: 0x40 / 255,
  dotted: 0x55 / 255, double: 0x40 / 255, short: 0x55 / 255, space: 0,
}

const DIVIDER_KIND: Record<DividerStyle, DividerKind> = {
  line: 'solid', thick: 'solid', dashed: 'dashed',
  dotted: 'dotted', double: 'double', short: 'solid', space: 'none',
}

const DIVIDER_WEIGHT: Record<DividerStyle, number> = {
  line: 1, thick: 2, dashed: 1, dotted: 1, double: 3, short: 1, space: 0,
}

/** The short rule's fixed width, in points. */
const SHORT_RULE_PT = 48

/** Composite `hex` at `alpha` over white — the opaque twin of an rgba() rule. */
export function flattenOnWhite(hex: string, alpha: number): string {
  const ch = (i: number): string => {
    const v = parseInt(hex.slice(i, i + 2), 16)
    const mixed = Math.round(v * alpha + 255 * (1 - alpha))
    return Math.max(0, Math.min(255, mixed)).toString(16).padStart(2, '0').toUpperCase()
  }
  return `${ch(0)}${ch(2)}${ch(4)}`
}

/**
 * The between-items rule a resolved section style draws.
 *
 * One description, four targets: the preview builds CSS from it, the PDF a
 * table hairline, the Word file a paragraph border. It used to be CSS only, so
 * eight divider choices moved the preview and left the PDF and the Word file
 * with no rule at all whatever the view said.
 */
export function dividerSpec(
  r: { item_divider: boolean; divider_style: DividerStyle }, accentHex: string,
): DividerSpec {
  // `lookup`, not `MAP[style]`: `divider_style` comes from stored view JSON, and
  // an inherited key reads a FUNCTION back out of each of these maps — which a
  // `??` would pass through, to be stringified into the `<style>` block below.
  const kind = r.item_divider ? lookup(DIVIDER_KIND, r.divider_style, 'solid') : 'none'
  const alpha = lookup(DIVIDER_ALPHA, r.divider_style, DIVIDER_ALPHA.line)
  const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return {
    kind,
    weightPt: kind === 'none' ? 0 : lookup(DIVIDER_WEIGHT, r.divider_style, DIVIDER_WEIGHT.line),
    widthPt: r.divider_style === 'short' ? SHORT_RULE_PT : null,
    colorCss: `#${accentHex}${alphaHex}`,
    colorHex: flattenOnWhite(accentHex, alpha),
  }
}

/**
 * The concrete character for each bullet style. One source so HTML, PDF, DOCX
 * and ATS-text all draw the same glyph. All four are single BMP characters that
 * exist in the standard PDF/DOCX fonts, so no font embedding is needed.
 */
const BULLET_GLYPHS: Record<BulletStyle, string> = {
  disc: '•',
  dash: '–',
  arrow: '›',
  square: '▪',
}

/** The glyph a resolved section style draws before each item heading. */
export function bulletGlyph(r: { item_bullets: boolean; bullet_style: BulletStyle }): string {
  return lookup(BULLET_GLYPHS, r.bullet_style, BULLET_GLYPHS.disc)
}

/**
 * The heading text a section should render: the custom localized override when
 * set, else the canonical section label. All render paths (HTML/PDF, DOCX,
 * text) go through this so a view's custom heading is applied consistently.
 */
export function sectionHeadingText(
  resolved: ResolvedSectionStyle,
  fallbackLabel: string,
  locale: string,
): string {
  return resolveLocalized(resolved.heading_text, locale) || fallbackLabel
}

// Tiny inline localized resolver (requested-locale → any non-empty) to avoid a
// dependency from this render-boundary module onto the locale UI helpers.
function resolveLocalized(ls: LocalizedString | undefined, locale: string): string {
  if (!ls) return ''
  const direct = (ls[locale] ?? '').trim()
  if (direct) return direct
  for (const v of Object.values(ls)) { const t = (v ?? '').trim(); if (t) return t }
  return ''
}

export function resolveSectionStyle(
  view: ViewStyle,
  section: SectionStyle | undefined,
  sectionKey?: string,
): ResolvedSectionStyle {
  const merged: ViewStyle = {
    density: section?.density ?? view.density,
    body_size: view.body_size,
    heading_font: view.heading_font,
    body_font: view.body_font,
    accent_color: view.accent_color,
    heading_color: view.heading_color,
    page_margin: view.page_margin,
    tag_style: section?.tag_style ?? view.tag_style,
  }
  return {
    ...merged,
    // Divider: section override → view-wide default → on/'line'.
    item_divider: section?.item_divider ?? view.item_divider ?? true,
    divider_style: section?.divider_style ?? view.divider_style ?? 'line',
    // Bullets: section override → view-wide default → off/'disc'.
    item_bullets: section?.item_bullets ?? view.item_bullets ?? false,
    bullet_style: section?.bullet_style ?? view.bullet_style ?? 'disc',
    hide_heading: section?.hide_heading ?? false,
    hide_dates: section?.hide_dates ?? false,
    heading_text: section?.heading_text,
    // Item-layout controls resolve section override → view-wide default → base.
    summary_layout: section?.summary_layout ?? view.summary_layout ?? DEFAULT_SUMMARY_LAYOUT,
    date_position: normalizeFullLayout(section?.date_position ?? view.date_position),
    tabulate: section?.tabulate ?? view.tabulate ?? false,
    date_format: section?.date_format ?? view.date_format ?? 'month-year',
    short_desc_line: section?.short_desc_line ?? 'below',
    show_icon: section?.show_icon ?? view.section_icons ?? false,
    kq_show_tagline: section?.kq_show_tagline,
    // Without a section key there is nothing to validate the stored keys
    // against, so the safe reading is "nothing enabled" — matching the default.
    extras: sectionKey ? normalizeExtras(section?.extras, sectionKey) : NO_EXTRAS,
  }
}
