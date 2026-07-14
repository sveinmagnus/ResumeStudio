import { describe, it, expect } from 'vitest'
import {
  FONT_CATALOG, fontById, resolveFontId, fontInstallInfo, fontOptions,
  CATALOG_DEFAULT_FONTS, DEFAULT_HEADING_FONT, DEFAULT_BODY_FONT,
} from '../src/lib/fonts'

describe('font catalog', () => {
  it('keeps the legacy ids so old views resolve unchanged', () => {
    expect(fontById('condensed').docxName).toBe('Open Sans Condensed')
    expect(fontById('sans').docxName).toBe('Ubuntu')
    expect(fontById('serif').docxName).toBe('Georgia')
  })

  it('maps every entry to a valid PDF base font', () => {
    const ok = new Set(['Roboto', 'Times', 'Helvetica', 'Courier'])
    for (const f of FONT_CATALOG) expect(ok.has(f.pdfFont)).toBe(true)
    // Serif families render as the PDF serif; brand keeps embedded Roboto.
    expect(fontById('serif').pdfFont).toBe('Times')
    expect(fontById('condensed').pdfFont).toBe('Roboto')
    expect(fontById('courier').pdfFont).toBe('Courier')
  })

  it('falls back to the body default for an unknown id', () => {
    expect(fontById('nope').id).toBe(DEFAULT_BODY_FONT)
  })

  it('resolveFontId maps "inherit"/empty to the given global default', () => {
    expect(resolveFontId('inherit', 'serif')).toBe('serif')
    expect(resolveFontId(undefined, 'times')).toBe('times')
    expect(resolveFontId('arial', 'serif')).toBe('arial')
  })

  it('offers install info only for fonts that need installing', () => {
    expect(fontInstallInfo('condensed')?.url).toContain('fonts.google.com')
    expect(fontInstallInfo('georgia')).toBeNull() // ubiquitous system font
  })

  it('lists options grouped sans → serif → mono', () => {
    const cats = fontOptions().map((o) => o.category)
    expect(cats.indexOf('sans')).toBeLessThan(cats.indexOf('serif'))
    expect(cats.indexOf('serif')).toBeLessThan(cats.indexOf('mono'))
  })

  it('has sensible defaults', () => {
    expect(CATALOG_DEFAULT_FONTS).toEqual({ heading: DEFAULT_HEADING_FONT, body: DEFAULT_BODY_FONT })
  })
})
