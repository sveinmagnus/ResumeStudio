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
  bodyFontSizePt: number          // e.g. 11
  smallFontSizePt: number         // dates, meta — usually bodyFontSizePt - 1
  metaFontSizePt: number          // body - 2 (e.g. ve-meta, tag chip)
  h1Pt: number                    // resume name
  h2Pt: number                    // section heading
  h3Pt: number                    // item heading
  lineHeight: number              // 1.35 .. 1.6
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
  /** Bottom margin under section headings. */
  sectionHeadingAfterPx: number
  sectionHeadingAfterTwips: number
  /** Page padding (HTML body padding / DOCX margins). DOCX uses twips, HTML uses px. */
  pagePadCss: string              // e.g. "32px 48px"
  pageMarginTwips: { top: number; bottom: number; left: number; right: number }
  // Colors
  accentHex: string               // 'RRGGBB' (no '#') — DOCX format (underline/icons/dividers)
  accentCss: string               // '#RRGGBB' — HTML format
  headingHex: string              // heading TEXT colour (falls back to accent)
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
  tight:    { cssPadding: '20px 36px', marginTwips: { top:  720, bottom:  720, left:  864, right:  864 } },  // 0.5", 0.6"
  normal:   { cssPadding: '32px 48px', marginTwips: { top: 1080, bottom: 1080, left: 1224, right: 1224 } },  // 0.75", 0.85"
  generous: { cssPadding: '48px 72px', marginTwips: { top: 1440, bottom: 1440, left: 1584, right: 1584 } },  // 1", 1.1"
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
  const density = DENSITY_SCALE[style.density] ?? DENSITY_SCALE.normal
  const sizes = BODY_SCALE[style.body_size] ?? BODY_SCALE.normal
  const headingFont = fontById(style.heading_font, DEFAULT_HEADING_FONT)
  const bodyFont = fontById(style.body_font, DEFAULT_BODY_FONT)
  const pageMargin = PAGE_MARGIN_MAP[style.page_margin] ?? PAGE_MARGIN_MAP.normal
  const accentHex = sanitizeHexColor(style.accent_color)
  // Heading text colour falls back to the accent when unset (back-compat).
  const headingHex = sanitizeHexColor(style.heading_color ?? style.accent_color, accentHex)
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
  /** Profile label/tagline toggles (see SectionStyle.kq_show_*). The deprecated
   *  kq_show_short/long stay on SectionStyle for parse tolerance but are never
   *  resolved — the section MODE owns that choice (see kqVisibility). */
  kq_show_label?: boolean
  kq_show_tagline?: boolean
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
  return DEFAULT_FULL_LAYOUT // 'default' + unknown/undefined
}

/** Which professional-summary parts to render, with the documented defaults. */
/**
 * Which parts of a profile block render. `short`/`long` are now driven by the
 * section MODE, not by style toggles: Summary mode shows the short summary,
 * Full mode ("Full profile") shows the long one. `label`/`tagline` remain
 * independent toggles.
 *
 * The old `kq_show_short`/`kq_show_long` style fields are deprecated and no
 * longer read — mode owns that choice (a section could otherwise be in Summary
 * mode yet configured to show the long text, which never made sense). The
 * fields stay on the type so pre-existing serialized views still parse; they're
 * simply ignored. Default mode is 'full' so any caller that doesn't pass one
 * (and every legacy path) behaves exactly as "Full" did before.
 */
export function kqVisibility(
  r: ResolvedSectionStyle,
  mode: 'summary' | 'full' = 'full',
): { label: boolean; tagline: boolean; short: boolean; long: boolean } {
  return {
    label: r.kq_show_label ?? true,
    tagline: r.kq_show_tagline ?? true,
    short: mode === 'summary',
    long: mode === 'full',
  }
}

/**
 * The concrete character for each bullet style. One source so HTML, PDF, DOCX
 * and ATS-text all draw the same glyph. All four are single BMP characters that
 * exist in the standard PDF/DOCX fonts, so no font embedding is needed.
 */
const BULLET_GLYPHS: Record<BulletStyle, string> = {
  disc: '•',   // •
  dash: '–',   // –
  arrow: '›',  // ›
  square: '▪', // ▪
}

/** The glyph a resolved section style draws before each item heading. */
export function bulletGlyph(r: { item_bullets: boolean; bullet_style: BulletStyle }): string {
  return BULLET_GLYPHS[r.bullet_style] ?? BULLET_GLYPHS.disc
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
    kq_show_label: section?.kq_show_label,
    kq_show_tagline: section?.kq_show_tagline,
  }
}
