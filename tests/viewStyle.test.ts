import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW_STYLE, withDefaults, deriveTokens, sanitizeHexColor,
  resolveFontCss, resolveFontDocx, resolveSectionStyle, sectionHeadingText,
  normalizeFullLayout, kqVisibility,
} from '../src/lib/viewStyle'
import type { ViewStyle } from '../src/types'

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

  it('keeps label/tagline as independent toggles regardless of mode', () => {
    const s = resolveSectionStyle(DEFAULT_VIEW_STYLE, { kq_show_label: false, kq_show_tagline: false })
    expect(kqVisibility(s, 'full')).toMatchObject({ label: false, tagline: false })
    expect(kqVisibility(s, 'summary')).toMatchObject({ label: false, tagline: false })
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
