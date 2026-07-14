/**
 * PURE: the font catalog shared by the view editor and every export path.
 *
 * Each entry maps one selectable font to the concrete values the three render
 * engines need:
 *  - `cssStack` — the HTML preview / print `font-family` (brand fonts are
 *    self-hosted; the rest fall back through common OS aliases).
 *  - `docxName` — the Word font name. `docx` references fonts by name (it can't
 *    embed them), so Word matches only if the reader has the font installed —
 *    hence `installUrl` for the ones that aren't ubiquitous.
 *  - `pdfFont` — pdfmake renders from embedded font files only, so a free-form
 *    family can't be embedded here. We map every choice onto one of the PDF
 *    standard-14 base fonts (Times / Helvetica / Courier — always available, no
 *    embedding) or the bundled Roboto, picked to match the family's category.
 *
 * The three legacy ids `condensed` / `sans` / `serif` are kept (they were the
 * old `HeadingFont` enum) so existing saved views resolve unchanged.
 */

export type FontCategory = 'sans' | 'serif' | 'mono'
/** The base fonts pdfmake can render without embedding a font file. */
export type PdfBaseFont = 'Roboto' | 'Times' | 'Helvetica' | 'Courier'

export interface FontDef {
  id: string
  label: string
  category: FontCategory
  /** HTML/print font-family stack. */
  cssStack: string
  /** Word font name (referenced, not embedded). */
  docxName: string
  /** pdfmake base font this choice renders as (no embedding needed). */
  pdfFont: PdfBaseFont
  /** When set, the font isn't guaranteed on every machine — offer to install it
   *  so Word/on-screen output matches. */
  installUrl?: string
}

export const FONT_CATALOG: FontDef[] = [
  // ── Brand (self-hosted for HTML; need install for exact Word match). PDF
  //    keeps the bundled Roboto — a safe, unicode-complete sans stand-in and
  //    the historical default output. ──
  { id: 'condensed', label: 'Open Sans Condensed (brand)', category: 'sans', cssStack: `'Open Sans Condensed', 'Arial Narrow', sans-serif`, docxName: 'Open Sans Condensed', pdfFont: 'Roboto', installUrl: 'https://fonts.google.com/specimen/Open+Sans+Condensed' },
  { id: 'sans', label: 'Ubuntu (brand)', category: 'sans', cssStack: `'Ubuntu', -apple-system, Segoe UI, sans-serif`, docxName: 'Ubuntu', pdfFont: 'Roboto', installUrl: 'https://fonts.google.com/specimen/Ubuntu' },
  // ── Serif ──
  { id: 'serif', label: 'Georgia', category: 'serif', cssStack: `Georgia, 'Times New Roman', serif`, docxName: 'Georgia', pdfFont: 'Times' },
  { id: 'times', label: 'Times New Roman', category: 'serif', cssStack: `'Times New Roman', Times, serif`, docxName: 'Times New Roman', pdfFont: 'Times' },
  { id: 'cambria', label: 'Cambria', category: 'serif', cssStack: `Cambria, Georgia, serif`, docxName: 'Cambria', pdfFont: 'Times' },
  { id: 'garamond', label: 'Garamond', category: 'serif', cssStack: `Garamond, 'EB Garamond', 'Times New Roman', serif`, docxName: 'Garamond', pdfFont: 'Times', installUrl: 'https://fonts.google.com/specimen/EB+Garamond' },
  { id: 'palatino', label: 'Palatino', category: 'serif', cssStack: `'Palatino Linotype', Palatino, 'Book Antiqua', serif`, docxName: 'Palatino Linotype', pdfFont: 'Times' },
  // ── Sans ──
  { id: 'arial', label: 'Arial', category: 'sans', cssStack: `Arial, Helvetica, sans-serif`, docxName: 'Arial', pdfFont: 'Helvetica' },
  { id: 'helvetica', label: 'Helvetica', category: 'sans', cssStack: `Helvetica, Arial, sans-serif`, docxName: 'Helvetica', pdfFont: 'Helvetica' },
  { id: 'calibri', label: 'Calibri', category: 'sans', cssStack: `Calibri, 'Segoe UI', sans-serif`, docxName: 'Calibri', pdfFont: 'Helvetica' },
  { id: 'verdana', label: 'Verdana', category: 'sans', cssStack: `Verdana, Geneva, sans-serif`, docxName: 'Verdana', pdfFont: 'Helvetica' },
  { id: 'tahoma', label: 'Tahoma', category: 'sans', cssStack: `Tahoma, Geneva, sans-serif`, docxName: 'Tahoma', pdfFont: 'Helvetica' },
  { id: 'trebuchet', label: 'Trebuchet MS', category: 'sans', cssStack: `'Trebuchet MS', Tahoma, sans-serif`, docxName: 'Trebuchet MS', pdfFont: 'Helvetica' },
  // ── Monospace ──
  { id: 'courier', label: 'Courier New', category: 'mono', cssStack: `'Courier New', Courier, monospace`, docxName: 'Courier New', pdfFont: 'Courier' },
]

/** Default heading + body fonts (the Cartavio brand) when nothing is chosen. */
export const DEFAULT_HEADING_FONT = 'condensed'
export const DEFAULT_BODY_FONT = 'sans'

/** A pair of default font ids — the app-wide setting a view inherits. */
export interface GlobalFonts { heading: string; body: string }
export const CATALOG_DEFAULT_FONTS: GlobalFonts = { heading: DEFAULT_HEADING_FONT, body: DEFAULT_BODY_FONT }

const BY_ID = new Map(FONT_CATALOG.map((f) => [f.id, f]))

/** The FontDef for an id, falling back to `fallback` (then to Ubuntu). */
export function fontById(id: string | null | undefined, fallback = DEFAULT_BODY_FONT): FontDef {
  return BY_ID.get(id ?? '') ?? BY_ID.get(fallback) ?? BY_ID.get(DEFAULT_BODY_FONT)!
}

/** Resolve a stored font value, mapping the `'inherit'` sentinel to the global default. */
export function resolveFontId(value: string | null | undefined, globalDefault: string): string {
  if (!value || value === 'inherit') return globalDefault
  return value
}

/** Install info for a font that may not be present on the reader's machine. */
export function fontInstallInfo(id: string): { label: string; url: string } | null {
  const f = BY_ID.get(id)
  return f?.installUrl ? { label: f.label, url: f.installUrl } : null
}

/** Options for a font `<select>`, grouped by category then alphabetised. */
export function fontOptions(): Array<{ id: string; label: string; category: FontCategory }> {
  const order: Record<FontCategory, number> = { sans: 0, serif: 1, mono: 2 }
  return [...FONT_CATALOG]
    .sort((a, b) => order[a.category] - order[b.category] || a.label.localeCompare(b.label))
    .map((f) => ({ id: f.id, label: f.label, category: f.category }))
}
