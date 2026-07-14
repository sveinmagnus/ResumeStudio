/**
 * Client-only app preferences (localStorage) — presentation choices that aren't
 * resume data and aren't server/env settings. Currently the app-wide DEFAULT
 * fonts a view inherits when its own font is left on "inherit".
 *
 * Kept out of the pure export libs: components read the value and pass it into
 * the (pure) renderers, so exports stay deterministic and jsdom-testable.
 */

import { CATALOG_DEFAULT_FONTS, type GlobalFonts } from './fonts'

const KEY = 'rs.defaultFonts'
const EVENT = 'rs-default-fonts-changed'

/** The app-wide default heading + body fonts (brand defaults when unset). */
export function getDefaultFonts(): GlobalFonts {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return CATALOG_DEFAULT_FONTS
    const o = JSON.parse(raw) as Partial<GlobalFonts>
    return {
      heading: typeof o.heading === 'string' ? o.heading : CATALOG_DEFAULT_FONTS.heading,
      body: typeof o.body === 'string' ? o.body : CATALOG_DEFAULT_FONTS.body,
    }
  } catch {
    return CATALOG_DEFAULT_FONTS
  }
}

/** Persist the default fonts and notify listeners (so open previews refresh). */
export function setDefaultFonts(fonts: GlobalFonts): void {
  try { localStorage.setItem(KEY, JSON.stringify(fonts)) } catch { /* storage disabled */ }
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* non-DOM env */ }
}

/** Subscribe to default-font changes; returns an unsubscribe function. */
export function onDefaultFontsChanged(cb: () => void): () => void {
  const handler = () => cb()
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
