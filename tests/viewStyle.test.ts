import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW_STYLE, withDefaults, deriveTokens, sanitizeHexColor,
  resolveFontCss, resolveFontDocx, resolveFontPdf, withResolvedFonts,
  resolveSectionStyle, sectionHeadingText,
  normalizeFullLayout, kqVisibility, bulletGlyph, DEFAULT_SUMMARY_LAYOUT,
  dividerSpec, flattenOnWhite, tagChipHex,
} from '../src/lib/viewStyle'
import { PARA_GAP_LINES } from '../src/lib/richText'
import type { ViewStyle } from '../src/types'
import type { ResolvedSectionStyle } from '../src/lib/viewStyle'

// ─── Item bullets (resolve + glyph) ──────────────────────────────────────────

describe('item bullets', () => {
  it('default off, disc glyph', () => {
    const r = resolveSectionStyle(DEFAULT_VIEW_STYLE, undefined)
    expect(r.item_bullets).toBe(false)
    expect(r.bullet_style).toBe('disc')
  })

  it('inherits the view-wide default when the section is silent', () => {
    const r = resolveSectionStyle({ ...DEFAULT_VIEW_STYLE, item_bullets: true, bullet_style: 'arrow' }, undefined)
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
  const style = resolveSectionStyle(DEFAULT_VIEW_STYLE, undefined)

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
    expect(resolveFontCss(out.body_font!, out.body_font!)).toContain('Ubuntu')
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

describe('resolveSectionStyle — section override, then view, then base', () => {
  /**
   * Three layers, resolved per field. Getting one field's chain wrong is
   * invisible until an export comes out styled like a different section, so each
   * field is checked at all three layers rather than in aggregate.
   */
  const view = (over: Partial<ViewStyle> = {}): ViewStyle => ({ ...DEFAULT_VIEW_STYLE, ...over })

  const CHAINS: Array<{
    field: keyof ResolvedSectionStyle
    section: unknown
    viewValue: unknown
    viewKey?: string
    base: unknown
  }> = [
    { field: 'density', section: 'compact', viewValue: 'spacious', base: undefined },
    { field: 'tag_style', section: 'plain', viewValue: 'chips', base: undefined },
    { field: 'item_divider', section: false, viewValue: false, base: true },
    { field: 'divider_style', section: 'dots', viewValue: 'rule', base: 'line' },
    { field: 'item_bullets', section: true, viewValue: true, base: false },
    { field: 'bullet_style', section: 'dash', viewValue: 'circle', base: 'disc' },
    { field: 'summary_layout', section: 'inline', viewValue: 'stacked', base: DEFAULT_SUMMARY_LAYOUT },
    { field: 'tabulate', section: true, viewValue: true, base: false },
    { field: 'date_format', section: 'year', viewValue: 'full', base: 'month-year' },
    { field: 'show_icon', section: true, viewValue: true, viewKey: 'section_icons', base: false },
  ]

  for (const c of CHAINS) {
    it(`resolves ${String(c.field)}: section wins over view, view over the base default`, () => {
      const viewKey = c.viewKey ?? String(c.field)
      const withView = view({ [viewKey]: c.viewValue } as Partial<ViewStyle>)

      // 1. The section override wins even when the view says otherwise.
      expect(resolveSectionStyle(withView, { [String(c.field)]: c.section } as never)[c.field])
        .toEqual(c.section)
      // 2. With no section override, the view's own value is used.
      expect(resolveSectionStyle(withView, undefined)[c.field]).toEqual(c.viewValue)
      // 3. With neither, the base default.
      if (c.base !== undefined) {
        expect(resolveSectionStyle(view({ [viewKey]: undefined } as Partial<ViewStyle>), {} as never)[c.field])
          .toEqual(c.base)
      }
    })
  }

  it('takes no section at all — every field still resolves', () => {
    // The section argument is optional; reading through it unguarded would throw.
    const r = resolveSectionStyle(DEFAULT_VIEW_STYLE, undefined)
    expect(r.item_divider).toBe(true)
    expect(r.hide_heading).toBe(false)
    expect(r.hide_dates).toBe(false)
    expect(r.heading_text).toBeUndefined()
    expect(r.short_desc_line).toBe('below')
  })

  it('hides a heading or dates only when the SECTION asks — never view-wide', () => {
    expect(resolveSectionStyle(DEFAULT_VIEW_STYLE, { hide_heading: true } as never).hide_heading).toBe(true)
    expect(resolveSectionStyle(DEFAULT_VIEW_STYLE, { hide_dates: true } as never).hide_dates).toBe(true)
    expect(resolveSectionStyle(DEFAULT_VIEW_STYLE, {} as never).hide_heading).toBe(false)
    expect(resolveSectionStyle(DEFAULT_VIEW_STYLE, {} as never).hide_dates).toBe(false)
  })

  it('keeps the view in charge of the page-wide choices a section cannot override', () => {
    // Font, size, colour and margin are page properties: one section rendering
    // in another font would look like a bug, not a style.
    const v = view({ body_size: 'large', accent_color: '#123456', page_margin: 'tight' })
    const r = resolveSectionStyle(v, { density: 'compact' } as never)
    expect([r.body_size, r.accent_color, r.page_margin, r.heading_font, r.body_font])
      .toEqual(['large', '#123456', 'tight', v.heading_font, v.body_font])
  })

  it('carries the section heading text and tag-line flag through untouched', () => {
    const r = resolveSectionStyle(DEFAULT_VIEW_STYLE, { heading_text: { en: 'Selected work' }, kq_show_tagline: false } as never)
    expect(r.heading_text).toEqual({ en: 'Selected work' })
    expect(r.kq_show_tagline).toBe(false)
  })
})

describe('deriveTokens — the numbers renderers consume', () => {
  const style = (over: Partial<ViewStyle> = {}): ViewStyle => ({ ...DEFAULT_VIEW_STYLE, ...over })

  it('scales body, small and meta sizes off one body size', () => {
    const t = deriveTokens(style({ body_size: 'normal' }))
    expect([t.bodyFontSizePt, t.smallFontSizePt, t.metaFontSizePt]).toEqual([11, 10, 9])
    const large = deriveTokens(style({ body_size: 'large' }))
    expect([large.bodyFontSizePt, large.smallFontSizePt, large.metaFontSizePt]).toEqual([12, 11, 10])
  })

  it('never lets the derived sizes fall below the 7pt floor', () => {
    // 'small' is 9pt, so meta would be 7 — the floor has to hold, not subtract.
    const t = deriveTokens(style({ body_size: 'small' }))
    expect([t.bodyFontSizePt, t.smallFontSizePt, t.metaFontSizePt]).toEqual([9, 8, 7])
    expect(t.metaFontSizePt).toBeGreaterThanOrEqual(7)
  })

  it('gives each body size its own heading scale', () => {
    const at = (body_size: ViewStyle['body_size']) => {
      const t = deriveTokens(style({ body_size }))
      return [t.h1Pt, t.h2Pt, t.h3Pt]
    }
    expect(at('small')).toEqual([24, 13, 10])
    expect(at('normal')).toEqual([30, 15, 11])
    expect(at('large')).toEqual([34, 17, 12])
  })

  it('gives each density its own line height and gaps', () => {
    const at = (density: ViewStyle['density']) => {
      const t = deriveTokens(style({ density }))
      return [t.lineHeight, t.itemGapPx, t.itemGapTwips, t.sectionHeadingAfterPx, t.sectionHeadingAfterTwips]
    }
    expect(at('compact')).toEqual([1.35, 9, 90, 6, 80])
    expect(at('normal')).toEqual([1.55, 14, 140, 10, 120])
    expect(at('spacious')).toEqual([1.75, 20, 200, 16, 180])
  })

  it('derives the paragraph gap from line height AND body size, one number in three units', () => {
    // PARA_GAP_LINES is 0.5 of a line box: 0.5 * 1.55 * 11pt = 8.525 → 8.5pt.
    const t = deriveTokens(style({ density: 'normal', body_size: 'normal' }))
    expect(t.paraGapPt).toBeCloseTo(PARA_GAP_LINES * 1.55 * 11, 1)
    expect(t.paraGapPt).toBe(8.5)
    expect(t.paraGapTwips).toBe(Math.round(8.5 * 20))
    expect(t.paraGapEm).toBeCloseTo(PARA_GAP_LINES * 1.55, 3)
  })

  it('grows the paragraph gap with density and with body size, independently', () => {
    const base = deriveTokens(style({ density: 'normal', body_size: 'normal' })).paraGapPt
    expect(deriveTokens(style({ density: 'spacious', body_size: 'normal' })).paraGapPt).toBeGreaterThan(base)
    expect(deriveTokens(style({ density: 'normal', body_size: 'large' })).paraGapPt).toBeGreaterThan(base)
    expect(deriveTokens(style({ density: 'compact', body_size: 'small' })).paraGapPt).toBeLessThan(base)
  })

  it('gives each page margin its own CSS padding and DOCX twips', () => {
    const at = (page_margin: ViewStyle['page_margin']) => {
      const t = deriveTokens(style({ page_margin }))
      return [t.pagePadCss, t.pageMarginTwips]
    }
    expect(at('tight')).toEqual(['20px 36px', { top: 720, bottom: 720, left: 864, right: 864 }])
    expect(at('normal')).toEqual(['32px 48px', { top: 1080, bottom: 1080, left: 1224, right: 1224 }])
    expect(at('generous')).toEqual(['48px 72px', { top: 1440, bottom: 1440, left: 1584, right: 1584 }])
  })

  it('falls back to the heading colour on the accent, and to the accent hex when both are junk', () => {
    expect(deriveTokens(style({ accent_color: '#112233' })).headingHex).toBe('112233')
    expect(deriveTokens(style({ accent_color: '#112233', heading_color: '#445566' })).headingHex).toBe('445566')
    expect(deriveTokens(style({ accent_color: '#112233', heading_color: 'javascript:x' })).headingHex).toBe('112233')
  })

  it('carries the brand defaults a fresh view inherits', () => {
    expect(DEFAULT_VIEW_STYLE.accent_color).toBe('#002E6E')
    expect([DEFAULT_VIEW_STYLE.density, DEFAULT_VIEW_STYLE.body_size, DEFAULT_VIEW_STYLE.page_margin])
      .toEqual(['normal', 'normal', 'normal'])
    // Fonts stay on the 'inherit' sentinel so the app-wide default flows through.
    expect([DEFAULT_VIEW_STYLE.heading_font, DEFAULT_VIEW_STYLE.body_font]).toEqual(['inherit', 'inherit'])
    expect(DEFAULT_VIEW_STYLE.item_divider).toBe(true)
    expect(DEFAULT_VIEW_STYLE.item_bullets).toBe(false)
    expect([DEFAULT_VIEW_STYLE.tag_style, DEFAULT_VIEW_STYLE.divider_style, DEFAULT_VIEW_STYLE.bullet_style])
      .toEqual(['chips', 'line', 'disc'])
  })
})

describe('font resolution at the render boundary', () => {
  it('maps the "body" sentinel onto the view body font, in all three targets', () => {
    const body = 'sans'
    expect(resolveFontCss('body', body)).toBe(resolveFontCss(body, body))
    expect(resolveFontDocx('body', body)).toBe(resolveFontDocx(body, body))
    expect(resolveFontPdf('body', body)).toBe(resolveFontPdf(body, body))
  })

  it('uses the named font when it is not the sentinel', () => {
    expect(resolveFontDocx('times', 'sans')).not.toBe(resolveFontDocx('sans', 'sans'))
  })

  it('replaces the inherit sentinel with the caller\u2019s global defaults', () => {
    const out = withResolvedFonts({ ...DEFAULT_VIEW_STYLE }, { heading: 'times', body: 'courier' })
    expect([out.heading_font, out.body_font]).toEqual(['times', 'courier'])
  })

  it('leaves a view\u2019s own font choice alone', () => {
    const out = withResolvedFonts({ ...DEFAULT_VIEW_STYLE, heading_font: 'serif', body_font: 'serif' },
      { heading: 'times', body: 'courier' })
    expect([out.heading_font, out.body_font]).toEqual(['serif', 'serif'])
  })
})

describe('sectionHeadingText — fallbacks', () => {
  const resolved = (heading_text: Record<string, string> | undefined) =>
    resolveSectionStyle(DEFAULT_VIEW_STYLE, { heading_text } as never)

  it('uses the requested locale when it has text', () => {
    expect(sectionHeadingText(resolved({ en: 'Selected work', no: 'Utvalgt' }), 'Projects', 'en'))
      .toBe('Selected work')
  })

  it('skips an EMPTY locale slot and takes the next language that has text', () => {
    // An empty string is a filled key with nothing in it — taking it would blank
    // the heading rather than fall back.
    expect(sectionHeadingText(resolved({ en: '', no: 'Utvalgt' }), 'Projects', 'en')).toBe('Utvalgt')
    expect(sectionHeadingText(resolved({ en: '   ', no: 'Utvalgt' }), 'Projects', 'en')).toBe('Utvalgt')
  })

  it('falls back to the section label when there is no override at all', () => {
    expect(sectionHeadingText(resolved(undefined), 'Projects', 'en')).toBe('Projects')
    expect(sectionHeadingText(resolved({}), 'Projects', 'en')).toBe('Projects')
    expect(sectionHeadingText(resolved({ en: '  ' }), 'Projects', 'en')).toBe('Projects')
  })
})


// ─── dividerSpec ─────────────────────────────────────────────────────────

describe('dividerSpec()', () => {
  const spec = (divider_style: string, item_divider = true) =>
    dividerSpec({ item_divider, divider_style: divider_style as never }, '002E6E')

  it('describes each style in terms every target can draw', () => {
    expect(spec('line')).toMatchObject({ kind: 'solid', weightPt: 1, widthPt: null })
    expect(spec('thick')).toMatchObject({ kind: 'solid', weightPt: 2 })
    expect(spec('dashed').kind).toBe('dashed')
    expect(spec('dotted').kind).toBe('dotted')
    expect(spec('double').kind).toBe('double')
    // The short rule is the only width-limited one.
    expect(spec('short')).toMatchObject({ kind: 'solid', widthPt: 48 })
    expect(spec('space').kind).toBe('none')
    expect(spec('line', false).kind).toBe('none')
  })

  it('gives the alpha rule an opaque twin for the targets without alpha', () => {
    const s = spec('line')
    // CSS keeps the alpha; PDF and Word take it composited onto the page.
    expect(s.colorCss).toMatch(/^#002E6E[0-9a-f]{2}$/)
    expect(s.colorHex).toMatch(/^[0-9A-F]{6}$/)
    expect(s.colorHex).not.toBe('002E6E')
  })

  it('tints each style at its own strength, faintest first', () => {
    // The alpha table is what separates a hairline from a heavy rule visually,
    // and the flattened twin is the only colour the PDF and Word ever see. A
    // single alpha for all of them makes six choices look like two.
    const alphaOf = (style: string) => spec(style).colorCss.slice(-2)
    expect(alphaOf('line')).toBe('1a')
    expect(alphaOf('thick')).toBe('1a')
    expect(alphaOf('dashed')).toBe('40')
    expect(alphaOf('double')).toBe('40')
    expect(alphaOf('dotted')).toBe('55')
    expect(alphaOf('short')).toBe('55')
    // Composited, a stronger alpha is a DARKER opaque colour on white.
    const lum = (style: string) => parseInt(spec(style).colorHex.slice(0, 2), 16)
    expect(lum('dotted')).toBeLessThan(lum('line'))
    expect(lum('dashed')).toBeLessThan(lum('line'))
  })

  it('rejects an INHERITED key, not just an unknown one', () => {
    // SECURITY: `divider_style` comes from stored view JSON, so a crafted
    // import can name 'toString'. Every lookup map inherits that key and
    // returns a FUNCTION for it — truthy, so a `??` or truthiness guard lets it
    // through, and the function's source is then interpolated into the
    // preview's `<style>` block as a border width. Membership rejects it.
    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const s = spec(key)
      expect(s, key).toEqual(spec('line'))
      expect(typeof s.weightPt, key).toBe('number')
      expect(typeof s.kind, key).toBe('string')
    }
  })
})

describe('flattenOnWhite() / tagChipHex()', () => {
  it('composites a colour onto the page at the given alpha', () => {
    expect(flattenOnWhite('000000', 1)).toBe('000000')
    expect(flattenOnWhite('000000', 0)).toBe('FFFFFF')
    expect(flattenOnWhite('000000', 0.5)).toBe('808080')
  })

  it('gives the chip a fill lighter than the accent it comes from', () => {
    const chip = tagChipHex('002E6E')
    expect(chip).toMatch(/^[0-9A-F]{6}$/)
    expect(parseInt(chip, 16)).toBeGreaterThan(0x002e6e)
  })
})
