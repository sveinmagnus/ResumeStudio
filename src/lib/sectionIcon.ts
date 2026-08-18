/**
 * The section-heading icon, as a standalone SVG document.
 *
 * The preview inlines the icon's inner markup into the page and lets CSS colour
 * it; the PDF and the Word file need a complete `<svg>` element with the colour
 * already resolved, because neither inherits anything. One builder, so the three
 * draw the same glyph at the same weight — the icon toggle used to move the
 * preview alone, and a view with icons on exported without them.
 *
 * The markup comes from `generated/sectionIcons` — a build-time map of lucide
 * paths, never user data — so nothing here needs escaping.
 *
 * Pure module: no DOM, no React.
 */

import { SECTION_ICON_INNER } from '../generated/sectionIcons'

/**
 * A complete 24×24 SVG for `iconName`, stroked in `colorHex` ('RRGGBB', no
 * '#'), or null when the name has no generated glyph.
 */
export function sectionIconSvg(iconName: string, colorHex: string): string | null {
  const inner = SECTION_ICON_INNER[iconName]
  // Typed, not merely truthy: an INHERITED key ('toString') reads a function
  // back out of the map, whose source would land inside the emitted `<svg>`.
  // Callers pass a name from the static SECTIONS table today, so this guards
  // the boundary rather than fixing a live bug.
  if (typeof inner !== 'string' || !inner) return null
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"`
    + ` fill="none" stroke="#${colorHex}" stroke-width="2"`
    + ` stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}

/**
 * The same SVG as a base64 data URI — the form Word's picture part takes.
 *
 * A data URI rather than raw bytes on purpose: `docx` decodes a string itself,
 * so the byte array is built inside its own realm. A `Uint8Array` handed in
 * from here is a different realm's under jsdom, and the zip writer rejects it.
 * The generated markup is ASCII, so plain `btoa` is safe.
 */
export function sectionIconDataUri(iconName: string, colorHex: string): string | null {
  const svg = sectionIconSvg(iconName, colorHex)
  return svg ? `data:image/svg+xml;base64,${btoa(svg)}` : null
}

/**
 * A 1×1 transparent PNG, as a data URI.
 *
 * Word's SVG picture part REQUIRES a raster fallback. Word 2016 and later draw
 * the SVG and never look at it; older versions have no way to draw a vector
 * icon at all, so the honest fallback is nothing rather than a wrong-looking
 * bitmap.
 */
export const BLANK_PNG_URI = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
  + 'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
