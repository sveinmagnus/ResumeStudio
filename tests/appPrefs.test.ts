/**
 * @vitest-environment jsdom
 *
 * The app-wide default fonts a view inherits when its own font is "inherit" —
 * localStorage plus a window event, so both need a DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getDefaultFonts, setDefaultFonts, onDefaultFontsChanged } from '../src/lib/appPrefs'
import { CATALOG_DEFAULT_FONTS } from '../src/lib/fonts'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('getDefaultFonts()', () => {
  it('falls back to the brand defaults when nothing is stored', () => {
    expect(getDefaultFonts()).toEqual(CATALOG_DEFAULT_FONTS)
  })

  it('reads a stored pair back', () => {
    setDefaultFonts({ heading: 'serif', body: 'sans' })
    expect(getDefaultFonts()).toEqual({ heading: 'serif', body: 'sans' })
  })

  it('replaces only the half that is unusable', () => {
    // A partially-written value (an older build, a hand-edited key) must not
    // take the whole preference down with it.
    localStorage.setItem('rs.defaultFonts', JSON.stringify({ heading: 'serif' }))
    expect(getDefaultFonts()).toEqual({ heading: 'serif', body: CATALOG_DEFAULT_FONTS.body })

    localStorage.setItem('rs.defaultFonts', JSON.stringify({ heading: 42, body: 'sans' }))
    expect(getDefaultFonts()).toEqual({ heading: CATALOG_DEFAULT_FONTS.heading, body: 'sans' })
  })

  it('falls back for corrupt JSON rather than throwing into a render', () => {
    localStorage.setItem('rs.defaultFonts', '{not json')
    expect(getDefaultFonts()).toEqual(CATALOG_DEFAULT_FONTS)
  })

  it('survives storage being unavailable', () => {
    // Private-mode browsers throw on access rather than returning null.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(getDefaultFonts()).toEqual(CATALOG_DEFAULT_FONTS)
  })
})

describe('setDefaultFonts()', () => {
  it('notifies subscribers so an open preview refreshes', () => {
    const seen: number[] = []
    const off = onDefaultFontsChanged(() => seen.push(1))
    setDefaultFonts({ heading: 'serif', body: 'sans' })
    expect(seen).toHaveLength(1)

    // …and stops notifying once unsubscribed, or a closed preview keeps
    // re-rendering for the life of the session.
    off()
    setDefaultFonts({ heading: 'sans', body: 'sans' })
    expect(seen).toHaveLength(1)
  })

  it('still writes when the event cannot be dispatched, and vice versa', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const seen: number[] = []
    const off = onDefaultFontsChanged(() => seen.push(1))
    // Storage refused, but the live UI should still follow the change.
    expect(() => setDefaultFonts({ heading: 'serif', body: 'sans' })).not.toThrow()
    expect(seen).toHaveLength(1)
    off()
  })
})
