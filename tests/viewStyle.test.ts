import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW_STYLE, withDefaults, deriveTokens, sanitizeHexColor,
  resolveFontCss, resolveFontDocx,
} from '../src/lib/viewStyle'
import type { ViewStyle } from '../src/types'

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
  it('maps known fonts', () => {
    expect(resolveFontCss('serif')).toContain('Georgia')
    expect(resolveFontDocx('serif')).toBe('Georgia')
    expect(resolveFontCss('body')).toContain('Ubuntu')
  })
  it('falls back to the default heading font for unknown values (no throw)', () => {
    expect(() => resolveFontCss('evil' as never)).not.toThrow()
    expect(resolveFontCss('evil' as never)).toContain('Open Sans Condensed')
    expect(resolveFontDocx('evil' as never)).toBe('Open Sans Condensed')
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
