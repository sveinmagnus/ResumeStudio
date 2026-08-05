import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW_STYLE, withDefaults, deriveTokens, sanitizeHexColor,
  resolveFontCss, resolveFontDocx, resolveFontPdf, withResolvedFonts,
  resolveSectionStyle, sectionHeadingText,
  normalizeFullLayout, kqVisibility, bulletGlyph,
} from '../src/lib/viewStyle'
import type { ViewStyle } from '../src/types'

// ─── Item bullets (resolve + glyph) ──────────────────────────────────────────

describe('item bullets', () => {
  it('default off, disc glyph', () => {
    const r = resolveSectionStyle(DEFAULT_VIEW_STYLE, null)
    expect(r.item_bullets).toBe(false)
    expect(r.bullet_style).toBe('disc')
  })

  it('inherits the view-wide default when the section is silent', () => {
    const r = resolveSectionStyle({ ...DEFAULT_VIEW_STYLE, item_bullets: true, bullet_style: 'arrow' }, null)
    expect(r.item_bullets).toBe(true)
    expect(r.bullet_style).toBe('arrow')
  })

  it('a section override wins over the view default (either direction)', () => {
    const viewOn = { ...DEFAULT_VIEW_STYLE, item_bullets: true, bullet_style: 'dash' as const }
    expect(resolveSectionStyle(viewOn, { item_bullets: false }).item_bullets).toBe(false)
    expect(resolveSectionStyle(DEFAULT_VIEW_STYLE, { item_bullets: true, bullet_style: 'square' }))
      .toMatchObject({ item_bullets: true, bullet_style: 'square' })
  })

  it('maps each style to its glyph, falling back to the disc', () => {
    expect(bulletGlyph({ item_bullets: true, bullet_style: 'disc' })).toBe('•')
    expect(bulletGlyph({ item_bullets: true, bullet_style: 'dash' })).toBe('–')
    expect(bulletGlyph({ item_bullets: true, bullet_style: 'arrow' })).toBe('›')
    expect(bulletGlyph({ item_bullets: true, bullet_style: 'square' })).toBe('▪')
    // Unknown → disc.
    expect(bulletGlyph({ item_bullets: true, bullet_style: 'nope' as never })).toBe('•')
  })
})

// ─── kqVisibility (profile Summary/Full mode) ─────────────────────────────────

describe('kqVisibility()', () => {
  const style = resolveSectionStyle(DEFAULT_VIEW_STYLE, null)

  it('Summary mode shows the short summary, not the long one', () => {
    const v = kqVisibility(style, 'summary')
    expect(v.short).toBe(true)
    expect(v.long).toBe(false)
  })

  it('Full mode shows the long "Full profile", not the short one', () => {
    const v = kqVisibility(style, 'full')
    expect(v.short).toBe(false)
    expect(v.long).toBe(true)
  })

  it('defaults to Full when no mode is passed (legacy behaviour)', () => {
    expect(kqVisibility(style)).toMatchObject({ short: false, long: true })
  })

  it('hides the tag line by default (it doubles as the resume title)', () => {
    expect(kqVisibility(style, 'full').tagline).toBe(false)
    expect(kqVisibility(style, 'summary').tagline).toBe(false)
  })

  it('shows the tag line only when kq_show_tagline is opted in', () => {
    const s = resolveSectionStyle(DEFAULT_VIEW_STYLE, { kq_show_tagline: true })
    expect(kqVisibility(s, 'full').tagline).toBe(true)
    expect(kqVisibility(s, 'summary').tagline).toBe(true)
  })

  it('ignores the deprecated kq_show_short/kq_show_long fields (mode owns it)', () => {
    const s = resolveSectionStyle(DEFAULT_VIEW_STYLE, { kq_show_short: true, kq_show_long: true })
    // Even with both legacy flags set, the mode alone decides.
    expect(kqVisibility(s, 'summary')).toMatchObject({ short: true, long: false })
    expect(kqVisibility(s, 'full')).toMatchObject({ short: false, long: true })
  })
})

// ─── normalizeFullLayout ──────────────────────────────────────────────────────

describe('normalizeFullLayout()', () => {
  it('passes through the four current values', () => {
    for (const v of ['title-org-date', 'title-date-org', 'lead-org-date', 'lead-date-org'] as const) {
      expect(normalizeFullLayout(v)).toBe(v)
    }
  })
  it('maps the legacy values forward', () => {
    expect(normalizeFullLayout('default')).toBe('title-org-date')
    expect(normalizeFullLayout('leading')).toBe('lead-org-date')
  })
  it('falls back to the default for unknown / empty input', () => {
    expect(normalizeFullLayout(undefined)).toBe('title-org-date')
    expect(normalizeFullLayout('garbage')).toBe('title-org-date')
  })
  it('is applied by resolveSectionStyle (legacy value resolves)', () => {
    const resolved = resolveSectionStyle(DEFAULT_VIEW_STYLE, { date_position: 'leading' as never })
    expect(resolved.date_position).toBe('lead-org-date')
  })
})

// ─── sanitizeHexColor ─────────────────────────────────────────────────────────

describe('sanitizeHexColor()', () => {
  it('accepts a 6-digit hex with or without the leading #', () => {
    expect(sanitizeHexColor('#00B8DE')).toBe('00B8DE')
    expect(sanitizeHexColor('00b8de')).toBe('00B8DE')
  })
  it('expands a 3-digit shorthand to 6', () => {
    expect(sanitizeHexColor('#0af')).toBe('00AAFF')
  })
  it('falls back to the default for non-hex input', () => {
    expect(sanitizeHexColor('rebeccapurple')).toBe('002E6E')
    expect(sanitizeHexColor('')).toBe('002E6E')
    expect(sanitizeHexColor(null)).toBe('002E6E')
    expect(sanitizeHexColor(undefined)).toBe('002E6E')
  })
  it('falls back for a CSS-injection payload (never returns the raw string)', () => {
    const payload = '</style><img src=x onerror=alert(1)>'
    const out = sanitizeHexColor(payload)
    expect(out).toBe('002E6E')
    expect(out).not.toContain('<')
    expect(out).not.toContain('/')
  })
  it('honours a custom fallback', () => {
    expect(sanitizeHexColor('nope', 'ABCDEF')).toBe('ABCDEF')
  })

  /**
   * This is a security boundary, and both of its patterns are anchored at BOTH
   * ends. An unanchored test accepts a payload that merely CONTAINS six hex
   * digits — "00B8DE;}</style><script>" — and returns it into a `<style>`
   * element. The suffix cases below are the ones that matter.
   */
  it('refuses anything with hex in it rather than anything that IS hex', () => {
    expect(sanitizeHexColor('00B8DE;}</style><script>alert(1)</script>')).toBe('002E6E')
    expect(sanitizeHexColor('</style>00B8DE')).toBe('002E6E')
    expect(sanitizeHexColor('0af;x')).toBe('002E6E')
    expect(sanitizeHexColor('x0af')).toBe('002E6E')
    // Wrong lengths are not silently truncated or padded either.
    expect(sanitizeHexColor('00B8D')).toBe('002E6E')
    expect(sanitizeHexColor('00B8DEE')).toBe('002E6E')
    expect(sanitizeHexColor('0a')).toBe('002E6E')
  })

  it('strips only a leading #, and only one', () => {
    // The strip is anchored; without that, '00B8DE#' would pass as hex.
    expect(sanitizeHexColor('  #00B8DE  ')).toBe('00B8DE')
    expect(sanitizeHexColor('00B8DE#')).toBe('002E6E')
    expect(sanitizeHexColor('##00B8DE')).toBe('002E6E')
  })
})

// ─── deriveTokens ─────────────────────────────────────────────────────────────

describe('deriveTokens()', () => {
  it('derives Cartavio-navy accent css/hex from the default style', () => {
    const t = deriveTokens(DEFAULT_VIEW_STYLE)
    expect(t.accentHex).toBe('002E6E')
    expect(t.accentCss).toBe('#002E6E')
  })

  it('sanitizes a malicious accent_color before it reaches the tokens', () => {
    const style: ViewStyle = { ...DEFAULT_VIEW_STYLE, accent_color: '</style><svg onload=alert(1)>' }
    const t = deriveTokens(style)
    expect(t.accentHex).toBe('002E6E')
    expect(t.accentCss).toBe('#002E6E')
    expect(t.accentCss).not.toContain('<')
  })

  it('does not throw on out-of-enum density/body_size/heading_font/page_margin', () => {
    const style = {
      density: 'evil', body_size: 'evil', heading_font: 'evil',
      accent_color: '#002E6E', page_margin: 'evil', tag_style: 'chips',
    } as unknown as ViewStyle
    expect(() => deriveTokens(style)).not.toThrow()
    const t = deriveTokens(style)
    // Falls back to the 'normal'/'condensed' presets.
    expect(t.lineHeight).toBe(deriveTokens(DEFAULT_VIEW_STYLE).lineHeight)
    expect(t.headingFontCss).toContain('Open Sans Condensed')
  })
})

// ─── resolveFontCss / resolveFontDocx ──────────────────────────────────────────

describe('resolveFontCss() / resolveFontDocx()', () => {
  it('maps a catalog id to its css / docx name', () => {
    expect(resolveFontCss('serif', 'sans')).toContain('Georgia')
    expect(resolveFontDocx('serif', 'sans')).toBe('Georgia')
  })
  it("'body' resolves to the supplied body-font id", () => {
    expect(resolveFontCss('body', 'sans')).toContain('Ubuntu')
    expect(resolveFontCss('body', 'serif')).toContain('Georgia')
    expect(resolveFontDocx('body', 'times')).toBe('Times New Roman')
  })
  it('falls back safely for unknown values (no throw)', () => {
    expect(() => resolveFontCss('evil' as never, 'sans')).not.toThrow()
    expect(resolveFontCss('evil' as never, 'sans')).toContain('Ubuntu')
    expect(resolveFontDocx('evil' as never, 'sans')).toBe('Ubuntu')
  })
})

describe('resolveFontPdf()', () => {
  /**
   * The third twin, and the only one that CANNOT carry the chosen family: pdf
   * output uses the standard-14 bases plus embedded Roboto, so every catalog
   * font maps onto one of four names. Untested until now, which meant a family
   * could quietly land on the wrong base — a serif choice rendering as
   * Helvetica is not a crash, just a wrong-looking PDF.
   */
  it('collapses each family onto its standard-14 base', () => {
    expect(resolveFontPdf('serif', 'sans')).toBe('Times')
    expect(resolveFontPdf('garamond', 'sans')).toBe('Times')
    expect(resolveFontPdf('arial', 'serif')).toBe('Helvetica')
    expect(resolveFontPdf('courier', 'serif')).toBe('Courier')
  })

  it('keeps the brand fonts on embedded Roboto', () => {
    // The two brand families are the ones pdfmake actually has glyphs for.
    expect(resolveFontPdf('condensed', 'serif')).toBe('Roboto')
    expect(resolveFontPdf('sans', 'serif')).toBe('Roboto')
  })

  it("'body' resolves against the supplied body-font id, not a fixed default", () => {
    expect(resolveFontPdf('body', 'times')).toBe('Times')
    expect(resolveFontPdf('body', 'arial')).toBe('Helvetica')
  })

  it('falls back rather than throwing on an unknown id', () => {
    expect(resolveFontPdf('evil' as never, 'sans')).toBe('Roboto')
  })
})

describe('withResolvedFonts()', () => {
  /**
   * The §6 boundary: `'inherit'` is a sentinel meaning "the app-wide default",
   * and the pure renderers must never see it — `fontById('inherit')` is not a
   * catalog entry, so an unresolved sentinel silently becomes the fallback font
   * and the user's global choice is lost on every export.
   */
  const style = (heading: string, body: string): ViewStyle =>
    ({ ...DEFAULT_VIEW_STYLE, heading_font: heading, body_font: body })

  it('replaces the sentinel with the caller’s globals, per slot', () => {
    const out = withResolvedFonts(style('inherit', 'inherit'), { heading: 'times', body: 'arial' })
    expect(out.heading_font).toBe('times')
    expect(out.body_font).toBe('arial')
  })

  it('leaves an explicitly chosen font alone', () => {
    const out = withResolvedFonts(style('garamond', 'verdana'), { heading: 'times', body: 'arial' })
    expect(out.heading_font).toBe('garamond')
    expect(out.body_font).toBe('verdana')
  })

  it('resolves the two slots independently', () => {
    // One inheriting and one chosen is the common case, and a crossed pair
    // would look plausible in the output.
    const out = withResolvedFonts(style('inherit', 'courier'), { heading: 'serif', body: 'arial' })
    expect(out.heading_font).toBe('serif')
    expect(out.body_font).toBe('courier')
  })

  it('falls back to the catalog defaults when the caller passes no globals', () => {
    const out = withResolvedFonts(style('inherit', 'inherit'))
    expect(out.heading_font).not.toBe('inherit')
    expect(out.body_font).not.toBe('inherit')
    expect(resolveFontCss(out.body_font, out.body_font)).toContain('Ubuntu')
  })

  it('carries every other style field through untouched', () => {
    const src = { ...style('inherit', 'inherit'), accent: '#123456', density: 'compact' as const }
    expect(withResolvedFonts(src)).toMatchObject({ accent: '#123456', density: 'compact' })
  })
})

// ─── withDefaults ─────────────────────────────────────────────────────────────

describe('withDefaults()', () => {
  it('returns the brand defaults for undefined', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_VIEW_STYLE)
  })
  it('overlays partial values', () => {
    expect(withDefaults({ density: 'compact' }).density).toBe('compact')
  })
})

// ─── resolveSectionStyle: item dividers (global + per-section) ─────────────────

describe('resolveSectionStyle() dividers', () => {
  const view: ViewStyle = { ...DEFAULT_VIEW_STYLE, item_divider: true, divider_style: 'dashed' }

  it('inherits the view-wide divider on/off and style when the section is silent', () => {
    const r = resolveSectionStyle(view, undefined)
    expect(r.item_divider).toBe(true)
    expect(r.divider_style).toBe('dashed')
  })
  it('lets a section override the style', () => {
    expect(resolveSectionStyle(view, { divider_style: 'dotted' }).divider_style).toBe('dotted')
  })
  it('lets a section turn dividers off even when the view has them on', () => {
    expect(resolveSectionStyle(view, { item_divider: false }).item_divider).toBe(false)
  })
  it('falls back to on/line when neither view nor section sets them', () => {
    const bare = { ...DEFAULT_VIEW_STYLE }
    delete (bare as { item_divider?: unknown }).item_divider
    delete (bare as { divider_style?: unknown }).divider_style
    const r = resolveSectionStyle(bare, undefined)
    expect(r.item_divider).toBe(true)
    expect(r.divider_style).toBe('line')
  })
})

describe('sectionHeadingText()', () => {
  const r = (heading?: Record<string, string>) =>
    resolveSectionStyle(DEFAULT_VIEW_STYLE, heading ? { heading_text: heading } : undefined)

  it('uses the custom heading in the requested locale', () => {
    expect(sectionHeadingText(r({ en: 'Selected engagements', no: 'Utvalgte oppdrag' }), 'Projects', 'no'))
      .toBe('Utvalgte oppdrag')
  })
  it('falls back to any non-empty locale, then to the section label', () => {
    expect(sectionHeadingText(r({ en: 'Selected engagements' }), 'Projects', 'no')).toBe('Selected engagements')
    expect(sectionHeadingText(r(), 'Projects', 'en')).toBe('Projects')
    expect(sectionHeadingText(r({ en: '  ' }), 'Projects', 'en')).toBe('Projects')
  })
})
