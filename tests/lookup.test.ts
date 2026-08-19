/**
 * `lookup` and the sweep it exists for.
 *
 * SECURITY: every object literal inherits `toString`, `constructor`, `valueOf`
 * and friends from `Object.prototype`, so `MAP[key] ?? fallback` returns a
 * FUNCTION when `key` is one of those — a value that is neither null nor
 * undefined, so `??` passes it straight through to a caller expecting a string,
 * a number or an array. No prototype pollution required; the key is enough.
 *
 * Keys reach these maps from stored resume/view JSON, which arrives from
 * imports and backups. The second block below is the part that matters: it
 * checks the CALLERS, not just the helper, because the helper being correct is
 * worth nothing if a render path still indexes its map directly.
 */
import { describe, it, expect } from 'vitest'
import { lookup } from '../src/lib/lookup'
import { presentLabel, fmtDate, localeName } from '../src/lib/locales'
import { fmtYears } from '../src/lib/exportStrings'
import { dividerSpec, deriveTokens, bulletGlyph, DEFAULT_VIEW_STYLE } from '../src/lib/viewStyle'
import { slotsFor } from '../src/lib/itemLayout'
import { sectionIconSvg } from '../src/lib/sectionIcon'
import { renderKeyFor } from '../src/lib/viewSectionPlan'
import { extrasFor } from '../src/lib/sectionExtras'
import { availableSortModes } from '../src/lib/sectionSort'
import type { ViewStyle } from '../src/types'

/** The inherited names a crafted import can name for free. */
const INHERITED = [
  'toString', 'constructor', 'valueOf', 'hasOwnProperty',
  'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
]

describe('lookup()', () => {
  const map = { a: 'A', b: 'B' }

  it('reads an own property', () => {
    expect(lookup(map, 'a', 'X')).toBe('A')
  })

  it('falls back for a key that is simply absent', () => {
    expect(lookup(map, 'zz', 'X')).toBe('X')
  })

  it('falls back for an INHERITED key, which `??` would not', () => {
    for (const key of INHERITED) {
      // The idiom this replaces, shown failing.
      expect(typeof (map as Record<string, unknown>)[key], key).toBe('function')
      expect(lookup(map, key, 'X'), key).toBe('X')
    }
  })

  it('falls back for __proto__ without reading the prototype', () => {
    expect(lookup(map, '__proto__', 'X')).toBe('X')
  })

  it('keeps a legitimately falsy own value rather than taking the fallback', () => {
    // `??` semantics, not `||` — an own '' or 0 is an answer, not a miss.
    expect(lookup({ a: '' }, 'a', 'X')).toBe('')
    expect(lookup({ a: 0 }, 'a', 9)).toBe(0)
  })
})

describe('the callers cannot be handed a function', () => {
  // Each of these takes a key that a crafted resume/view JSON can name, and
  // each used to index its map directly.

  it('export chrome returns a string, never a function body', () => {
    for (const key of INHERITED) {
      expect(typeof presentLabel(key), key).toBe('string')
      expect(presentLabel(key), key).not.toContain('native code')
      expect(fmtYears(3, key), key).not.toContain('native code')
      // Dates render through the month table keyed by the same locale.
      expect(fmtDate({ year: 2024, month: 3 }, key), key).not.toContain('native code')
    }
  })

  it('style tokens stay numeric under an inherited enum value', () => {
    for (const key of INHERITED) {
      const t = deriveTokens({
        ...DEFAULT_VIEW_STYLE, density: key, body_size: key, page_margin: key,
      } as unknown as ViewStyle)
      expect(typeof t.lineHeight, key).toBe('number')
      expect(Number.isFinite(t.lineHeight), key).toBe(true)
      expect(Number.isFinite(t.bodyFontSizePt), key).toBe(true)
      expect(Number.isFinite(t.itemGapTwips), key).toBe(true)
      expect(typeof t.pagePadCss, key).toBe('string')

      const d = dividerSpec({ item_divider: true, divider_style: key as never }, '002E6E')
      expect(typeof d.weightPt, key).toBe('number')
      expect(typeof d.kind, key).toBe('string')

      expect(typeof bulletGlyph({ item_bullets: true, bullet_style: key as never }), key).toBe('string')
    }
  })

  it('the layout and plan helpers return usable values, not functions', () => {
    for (const key of INHERITED) {
      // A function here was a TypeError at `.map(…)`, i.e. a crafted view
      // crashed the exporter instead of falling back to a default layout.
      expect(Array.isArray(slotsFor(key as never)), key).toBe(true)
      expect(typeof renderKeyFor(key), key).toBe('string')
      expect(Array.isArray(extrasFor(key)), key).toBe(true)
      expect(sectionIconSvg(key, '002E6E'), key).toBeNull()
    }
  })
})

// A later sweep found four more call sites still indexing their map directly.
// Three were the same one-liner copied around (`LOCALE_LABELS[c]?.name ?? c`),
// which is why there is now one `localeName` for all of them.
describe('the locale and sort helpers cannot be handed a function', () => {
  it('localeName falls back to the bare code', () => {
    for (const key of INHERITED) {
      // The live case is `constructor`: `LOCALE_LABELS['constructor'].name` is
      // 'Object', so the optional chain never fires, the `?? code` fallback
      // never runs, and 'Object' is laundered into a prompt as a language name.
      // The other inherited names alias their own `.name`, which is how this
      // hid — it looked correct for six keys out of seven.
      expect(localeName(key), key).toBe(key)
    }
    expect(localeName('en')).toBe('English')
    expect(localeName('zz')).toBe('zz')
  })

  it('availableSortModes offers only the two universal modes', () => {
    // Unlike localeName this one is a CONSISTENCY fix, not a live bug: the
    // function read out of DATE_CAPS has no `.start`/`.end`/`.single`, so the
    // old direct index already degraded correctly. Pinned because that is an
    // accident of which sub-fields happen to exist on Function.prototype — add
    // a `name` or a `length` cap to DATE_CAPS and the accident stops holding.
    for (const key of INHERITED) {
      expect(availableSortModes(key), key).toEqual(['custom', 'alpha'])
    }
    expect(availableSortModes('projects')).toEqual(
      ['custom', 'alpha', 'start', 'start_asc', 'end', 'end_asc'],
    )
  })
})
