/**
 * The section-heading glyph the PDF and the Word file draw (CLAUDE.md §7).
 *
 * The preview inlines the inner markup and colours it with CSS, so its shape is
 * asserted through the HTML. The other two need a complete, self-contained
 * `<svg>` with the colour already resolved — and the Word path needs it base64,
 * beside a raster fallback Word requires but never draws. None of that was
 * pinned anywhere: the exporters assert that an icon block exists, not that the
 * document inside it is one.
 */
import { describe, it, expect } from 'vitest'
import { sectionIconSvg, sectionIconDataUri, BLANK_PNG_URI } from '../src/lib/sectionIcon'
import { SECTION_ICON_INNER } from '../src/generated/sectionIcons'

describe('sectionIconSvg', () => {
  it('wraps the generated glyph in a standalone, stroked SVG document', () => {
    const svg = sectionIconSvg('Briefcase', '002E6E')!
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    // Namespaced and sized, because neither Word nor pdfmake inherits a thing.
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).toContain('width="24"')
    expect(svg).toContain('height="24"')
    expect(svg).toContain(SECTION_ICON_INNER.Briefcase)
  })

  it('resolves the stroke colour rather than leaving it to inherit', () => {
    expect(sectionIconSvg('Briefcase', '002E6E')).toContain('stroke="#002E6E"')
    expect(sectionIconSvg('Briefcase', 'b30000')).toContain('stroke="#b30000"')
    // currentColor is what the generated markup carries for the preview; a
    // document with no cascade above it must not keep it.
    expect(sectionIconSvg('Briefcase', '002E6E')).not.toContain('stroke="currentColor"')
  })

  it('draws at the same weight as the preview', () => {
    const svg = sectionIconSvg('Star', '002E6E')!
    expect(svg).toContain('fill="none"')
    expect(svg).toContain('stroke-width="2"')
    expect(svg).toContain('stroke-linecap="round"')
    expect(svg).toContain('stroke-linejoin="round"')
  })

  it('has no icon for a name with no generated glyph', () => {
    expect(sectionIconSvg('NotAnIcon', '002E6E')).toBeNull()
    expect(sectionIconSvg('', '002E6E')).toBeNull()
  })
})

describe('sectionIconDataUri', () => {
  it('base64-encodes the same document Word decodes back', () => {
    const uri = sectionIconDataUri('Briefcase', '002E6E')!
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(atob(uri.slice('data:image/svg+xml;base64,'.length)))
      .toBe(sectionIconSvg('Briefcase', '002E6E'))
  })

  it('has no picture for a name with no generated glyph', () => {
    expect(sectionIconDataUri('NotAnIcon', '002E6E')).toBeNull()
  })
})

describe('BLANK_PNG_URI', () => {
  it('is a real 1x1 PNG, since Word rejects a picture part with no raster', () => {
    const bytes = Uint8Array.from(
      atob(BLANK_PNG_URI.slice('data:image/png;base64,'.length)),
      (c) => c.charCodeAt(0),
    )
    // PNG signature, then the IHDR width/height as big-endian 32-bit ints.
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(16)).toBe(1)
    expect(view.getUint32(20)).toBe(1)
  })
})
