import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW_HEADER, DEFAULT_VIEW_FOOTER,
  withHeaderDefaults, withFooterDefaults, defaultHeaderFields,
  buildLanguageSummary, buildHeaderLines, resolveHeaderFieldValue,
  buildCopyrightLine, footerLines, headerFieldLabel, defaultFieldLabels,
} from '../src/lib/viewHeader'
import { LOCALE_CODES } from '../src/lib/locales'
import { emptyStore, makeResume, makeSpokenLanguage } from './fixtures'
import type { ViewHeaderConfig, ViewFooterConfig, HeaderField, SpokenLanguage } from '../src/types'

// ─── Defaults ─────────────────────────────────────────────────────────────────

describe('withHeaderDefaults()', () => {
  it('returns a fully-populated config for undefined input', () => {
    const h = withHeaderDefaults(undefined)
    expect(h.fields.length).toBeGreaterThan(0)
    expect(h.separator).toBe(DEFAULT_VIEW_HEADER.separator)
    expect(h.photo_placement).toBe('none')
    expect(h.logo_placement).toBe('none')
    expect(h.name_style.font).toBe('condensed')
  })

  it('merges partial name/title style over defaults', () => {
    const h = withHeaderDefaults({ name_style: { size_pt: 40, font: 'serif' } })
    expect(h.name_style).toEqual({ size_pt: 40, font: 'serif' })
    // untouched fields fall back to defaults
    expect(h.title_style.font).toBe(DEFAULT_VIEW_HEADER.title_style.font)
  })

  it('falls back to default fields when an empty fields array is given', () => {
    const h = withHeaderDefaults({ fields: [] })
    expect(h.fields.length).toBe(defaultHeaderFields().length)
  })

  it('does not share field-array references between calls', () => {
    const a = withHeaderDefaults(undefined)
    const b = withHeaderDefaults(undefined)
    expect(a.fields).not.toBe(b.fields)
  })
})

describe('withFooterDefaults()', () => {
  it('returns defaults for undefined input', () => {
    expect(withFooterDefaults(undefined)).toEqual(DEFAULT_VIEW_FOOTER)
  })
  it('keeps provided values', () => {
    const f = withFooterDefaults({ separator: 'double', copyright: 'company', note: { en: 'x' } })
    expect(f.separator).toBe('double')
    expect(f.copyright).toBe('company')
    expect(f.note).toEqual({ en: 'x' })
  })
})

// ─── Boundary validation (untrusted import hardening) ───────────────────────────
// View config can arrive from a crafted backup/snapshot, not just the editor.
// These fields flow into HTML class names / inline styles, so out-of-enum or
// wrong-typed values must be coerced at the withHeaderDefaults/withFooterDefaults
// boundary. See the end-to-end breakout tests in viewFilter.test.ts.

describe('withHeaderDefaults() — boundary validation', () => {
  it('coerces an out-of-enum photo_placement to none', () => {
    const h = withHeaderDefaults({ photo_placement: 'x"><img>' } as never)
    expect(h.photo_placement).toBe('none')
  })
  it('coerces an out-of-enum logo_placement to none', () => {
    const h = withHeaderDefaults({ logo_placement: 'evil' } as never)
    expect(h.logo_placement).toBe('none')
  })
  it('coerces an out-of-enum photo_shape to square (defends viewFilter class interpolation)', () => {
    // photo_shape is interpolated as part of an HTML class name (ve-photo-
    // shape-${shape}) in viewFilter — a crafted import like 'x"><script>'
    // would break out of the attribute if we didn't whitelist here.
    const h = withHeaderDefaults({ photo_shape: 'x"><script>' } as never)
    expect(h.photo_shape).toBe('square')
  })
  it('keeps a valid photo_shape value', () => {
    expect(withHeaderDefaults({ photo_shape: 'rounded' }).photo_shape).toBe('rounded')
    expect(withHeaderDefaults({ photo_shape: 'circle' }).photo_shape).toBe('circle')
  })
  it('defaults photo_shape to square when missing (legacy view config)', () => {
    expect(withHeaderDefaults({}).photo_shape).toBe('square')
  })
  it('coerces an unknown text font back to the default', () => {
    const h = withHeaderDefaults({ name_style: { size_pt: null, font: 'comic-sans' } } as never)
    expect(h.name_style.font).toBe(DEFAULT_VIEW_HEADER.name_style.font)
  })
  it('drops a non-numeric size_pt to null', () => {
    const h = withHeaderDefaults({ name_style: { size_pt: '99"><img>', font: 'serif' } } as never)
    expect(h.name_style.size_pt).toBeNull()
    expect(h.name_style.font).toBe('serif')
  })
  it('clamps an absurd numeric size_pt into range', () => {
    expect(withHeaderDefaults({ name_style: { size_pt: 99999, font: 'body' } }).name_style.size_pt).toBeLessThanOrEqual(200)
    expect(withHeaderDefaults({ name_style: { size_pt: -5, font: 'body' } }).name_style.size_pt).toBeGreaterThanOrEqual(4)
  })
  it('falls back to the default separator when given a non-string', () => {
    const h = withHeaderDefaults({ separator: 123 } as never)
    expect(h.separator).toBe(DEFAULT_VIEW_HEADER.separator)
  })

  /**
   * The allowlists are the boundary. A test that only rejects one bad value
   * cannot tell a working allowlist from an emptied one — an emptied set
   * coerces EVERYTHING to the fallback, which is safe but silently discards
   * every layout the user configured.
   */
  it('keeps every value the allowlists actually permit', () => {
    for (const v of ['none', 'left', 'right', 'above', 'below', 'left_of_name', 'right_of_name']) {
      expect(withHeaderDefaults({ photo_placement: v } as never).photo_placement, v).toBe(v)
    }
    for (const v of ['none', 'left', 'center', 'right']) {
      expect(withHeaderDefaults({ logo_placement: v } as never).logo_placement, v).toBe(v)
    }
    for (const v of ['square', 'rounded', 'circle']) {
      expect(withHeaderDefaults({ photo_shape: v } as never).photo_shape, v).toBe(v)
    }
    for (const v of ['condensed', 'sans', 'serif', 'body']) {
      expect(withHeaderDefaults({ name_style: { size_pt: null, font: v } } as never).name_style.font, v).toBe(v)
    }
  })

  it('keeps a size at each end of the permitted range', () => {
    // Only absurd values were tested, so the clamp bounds were free to move.
    expect(withHeaderDefaults({ name_style: { size_pt: 4, font: 'body' } }).name_style.size_pt).toBe(4)
    expect(withHeaderDefaults({ name_style: { size_pt: 200, font: 'body' } }).name_style.size_pt).toBe(200)
    // NaN and Infinity are numbers but not sizes.
    expect(withHeaderDefaults({ name_style: { size_pt: NaN, font: 'body' } }).name_style.size_pt).toBeNull()
    expect(withHeaderDefaults({ name_style: { size_pt: Infinity, font: 'body' } }).name_style.size_pt).toBeNull()
  })
})

describe('withFooterDefaults() — boundary validation', () => {
  it('coerces an out-of-enum separator to none', () => {
    expect(withFooterDefaults({ separator: 'line"><img>' } as never).separator).toBe('none')
  })
  it('coerces an out-of-enum copyright holder to none', () => {
    expect(withFooterDefaults({ copyright: 'evil' } as never).copyright).toBe('none')
  })
})

// ─── Languages summary ──────────────────────────────────────────────────────

describe('buildLanguageSummary()', () => {
  it('joins "name (level)" in sort order, skipping disabled', () => {
    const store = emptyStore()
    store.spoken_languages = [
      makeSpokenLanguage({ name: { no: 'Norsk' }, level: { no: 'morsmål' }, sort_order: 0 }),
      makeSpokenLanguage({ name: { no: 'Engelsk' }, level: { no: 'flytende' }, sort_order: 1 }),
      makeSpokenLanguage({ name: { no: 'Skjult' }, level: { no: 'x' }, sort_order: 2, disabled: true }),
    ]
    expect(buildLanguageSummary(store, 'no')).toBe('Norsk (morsmål), Engelsk (flytende)')
  })

  it('omits the parenthetical when there is no level', () => {
    const store = emptyStore()
    store.spoken_languages = [makeSpokenLanguage({ name: { en: 'German' }, level: {} })]
    expect(buildLanguageSummary(store, 'en')).toBe('German')
  })

  it('returns empty string when there are no languages', () => {
    const store = emptyStore()
    store.spoken_languages = []
    expect(buildLanguageSummary(store, 'en')).toBe('')
  })

  it('respects sort_order regardless of array order', () => {
    const store = emptyStore()
    store.spoken_languages = [
      makeSpokenLanguage({ name: { en: 'Second' }, level: {}, sort_order: 5 }),
      makeSpokenLanguage({ name: { en: 'First' }, level: {}, sort_order: 1 }),
    ]
    expect(buildLanguageSummary(store, 'en')).toBe('First, Second')
  })
})

// ─── Field value resolution ───────────────────────────────────────────────────

describe('resolveHeaderFieldValue()', () => {
  it('resolves each scalar / localized field', () => {
    const store = emptyStore()
    const r = makeResume({
      phone: '+47 913 04 810',
      email: 'a@b.no',
      place_of_residence: { no: 'Oslo' },
      nationality: { no: 'Norsk' },
      linkedin_url: 'https://lnkd/x',
      website_url: 'https://w',
      twitter: '@x',
      date_of_birth: '1980-01-01',
    })
    store.resume = r
    expect(resolveHeaderFieldValue('phone', r, store, 'no')).toBe('+47 913 04 810')
    expect(resolveHeaderFieldValue('email', r, store, 'no')).toBe('a@b.no')
    expect(resolveHeaderFieldValue('location', r, store, 'no')).toBe('Oslo')
    expect(resolveHeaderFieldValue('nationality', r, store, 'no')).toBe('Norsk')
    expect(resolveHeaderFieldValue('linkedin', r, store, 'no')).toBe('https://lnkd/x')
    expect(resolveHeaderFieldValue('website', r, store, 'no')).toBe('https://w')
    expect(resolveHeaderFieldValue('twitter', r, store, 'no')).toBe('@x')
    expect(resolveHeaderFieldValue('date_of_birth', r, store, 'no')).toBe('1980-01-01')
  })

  it('returns "" for null scalars', () => {
    // Every scalar slot, not a sample of two: an unset field must drop out of
    // the header line, and each slot reads its own resume field.
    const store = emptyStore()
    const r = makeResume({
      // `email` is typed non-null, but the renderer guards it with `?? ''`
      // because imported and legacy data carries one — that guard is the
      // subject here, so the null has to survive into the call.
      phone: null, email: null as unknown as string, linkedin_url: null,
      website_url: null, twitter: null, date_of_birth: null,
    })
    for (const key of ['phone', 'email', 'linkedin', 'website', 'twitter', 'date_of_birth'] as const) {
      expect(resolveHeaderFieldValue(key, r, store, 'en'), key).toBe('')
    }
  })
})

// ─── Header line grouping ─────────────────────────────────────────────────────

function headerWith(fields: ViewHeaderConfig['fields']): ViewHeaderConfig {
  return { ...withHeaderDefaults(undefined), fields }
}

describe('buildHeaderLines()', () => {
  it('drops hidden fields and fields that resolve to empty', () => {
    const store = emptyStore()
    const r = makeResume({ phone: '111', email: '', place_of_residence: {} })
    store.resume = r
    const header = headerWith([
      { key: 'phone', show: true, label: { en: 'Phone: ' }, same_line: false, sort_order: 0 },
      { key: 'email', show: true, label: { en: 'Email: ' }, same_line: true, sort_order: 1 },     // empty value → dropped
      { key: 'location', show: false, label: { en: 'Loc: ' }, same_line: false, sort_order: 2 },  // hidden → dropped
    ])
    const lines = buildHeaderLines(header, r, store, 'en')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([{ label: 'Phone: ', value: '111' }])
  })

  it('groups same_line fields onto one line and others onto new lines', () => {
    const store = emptyStore()
    const r = makeResume({ phone: '111', email: 'a@b', place_of_residence: { en: 'Oslo' } })
    store.resume = r
    const header = headerWith([
      { key: 'phone', show: true, label: { en: 'Phone: ' }, same_line: false, sort_order: 0 },
      { key: 'email', show: true, label: { en: 'Email: ' }, same_line: true, sort_order: 1 },
      { key: 'location', show: true, label: { en: 'Loc: ' }, same_line: false, sort_order: 2 },
    ])
    const lines = buildHeaderLines(header, r, store, 'en')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual([
      { label: 'Phone: ', value: '111' },
      { label: 'Email: ', value: 'a@b' },
    ])
    expect(lines[1]).toEqual([{ label: 'Loc: ', value: 'Oslo' }])
  })

  it('forces the first surviving field onto its own line even if same_line is true', () => {
    const store = emptyStore()
    const r = makeResume({ phone: '', email: 'a@b' })
    store.resume = r
    const header = headerWith([
      { key: 'phone', show: true, label: {}, same_line: false, sort_order: 0 }, // empty → dropped
      { key: 'email', show: true, label: { en: 'Email: ' }, same_line: true, sort_order: 1 },
    ])
    const lines = buildHeaderLines(header, r, store, 'en')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([{ label: 'Email: ', value: 'a@b' }])
  })

  it('orders by sort_order, not array order', () => {
    const store = emptyStore()
    const r = makeResume({ phone: '111', email: 'a@b' })
    store.resume = r
    const header = headerWith([
      { key: 'email', show: true, label: { en: 'E: ' }, same_line: false, sort_order: 5 },
      { key: 'phone', show: true, label: { en: 'P: ' }, same_line: false, sort_order: 1 },
    ])
    const lines = buildHeaderLines(header, r, store, 'en')
    expect(lines.map((l) => l[0].value)).toEqual(['111', 'a@b'])
  })

  it('includes the languages summary as a field value', () => {
    const store = emptyStore()
    store.resume = makeResume()
    store.spoken_languages = [makeSpokenLanguage({ name: { en: 'English' }, level: { en: 'Native' } })]
    const header = headerWith([
      { key: 'languages', show: true, label: { en: 'Languages: ' }, same_line: false, sort_order: 0 },
    ])
    const lines = buildHeaderLines(header, store.resume!, store, 'en')
    expect(lines[0][0]).toEqual({ label: 'Languages: ', value: 'English (Native)' })
  })
})

// ─── Copyright ─────────────────────────────────────────────────────────────

describe('buildCopyrightLine()', () => {
  it('uses the person name', () => {
    const r = makeResume({ full_name: 'Ada Lovelace' })
    const footer = withFooterDefaults({ copyright: 'person' })
    expect(buildCopyrightLine(footer, r, 2026, 'en')).toBe('© 2026 Ada Lovelace')
  })
  it('returns empty when the chosen holder is unset rather than blank', () => {
    // A resume with no name at all must not print a bare "© 2026".
    const r = makeResume({ full_name: null as unknown as string, company_name: null })
    expect(buildCopyrightLine(withFooterDefaults({ copyright: 'person' }), r, 2026, 'en')).toBe('')
    expect(buildCopyrightLine(withFooterDefaults({ copyright: 'company' }), r, 2026, 'en')).toBe('')
  })
  it('uses the company name', () => {
    const r = makeResume({ company_name: 'Cartavio AS' })
    const footer = withFooterDefaults({ copyright: 'company' })
    expect(buildCopyrightLine(footer, r, 2026, 'en')).toBe('© 2026 Cartavio AS')
  })
  it('uses the per-view custom holder, resolved in the export locale', () => {
    const r = makeResume({ full_name: 'Ada', company_name: 'Cartavio AS' })
    const footer = withFooterDefaults({
      copyright: 'custom',
      copyright_custom: { en: 'Partner Consulting Ltd', no: 'Partner Rådgivning AS' },
    })
    expect(buildCopyrightLine(footer, r, 2026, 'no')).toBe('© 2026 Partner Rådgivning AS')
    expect(buildCopyrightLine(footer, r, 2026, 'en')).toBe('© 2026 Partner Consulting Ltd')
  })
  it('returns empty for none', () => {
    expect(buildCopyrightLine(withFooterDefaults({ copyright: 'none' }), makeResume(), 2026, 'en')).toBe('')
  })
  it('returns empty when the chosen holder name is blank', () => {
    const r = makeResume({ company_name: '   ' })
    expect(buildCopyrightLine(withFooterDefaults({ copyright: 'company' }), r, 2026, 'en')).toBe('')
  })
  it('returns empty for custom when the custom text is blank', () => {
    const footer = withFooterDefaults({ copyright: 'custom', copyright_custom: {} })
    expect(buildCopyrightLine(footer, makeResume(), 2026, 'en')).toBe('')
  })
})

// ─── Footer note placement ──────────────────────────────────────────────────

describe('footerLines()', () => {
  const f = (placement?: string) =>
    withFooterDefaults({ copyright: 'person', note_placement: placement as never })

  it("defaults to the note after the copyright on one line — how it always rendered", () => {
    expect(footerLines(f(), '© 2026 Ada', 'Confidential')).toEqual(['© 2026 Ada  ·  Confidential'])
    expect(withFooterDefaults({}).note_placement).toBe('after')
  })

  it('puts the note before the copyright on the same line', () => {
    expect(footerLines(f('before'), '© 2026 Ada', 'Confidential')).toEqual(['Confidential  ·  © 2026 Ada'])
  })

  it('puts the note on its own line above or below', () => {
    expect(footerLines(f('above'), '© 2026 Ada', 'Confidential')).toEqual(['Confidential', '© 2026 Ada'])
    expect(footerLines(f('below'), '© 2026 Ada', 'Confidential')).toEqual(['© 2026 Ada', 'Confidential'])
  })

  it('collapses to whichever part exists — placement is then irrelevant', () => {
    for (const p of ['after', 'before', 'above', 'below']) {
      expect(footerLines(f(p), '© 2026 Ada', '')).toEqual(['© 2026 Ada'])
      expect(footerLines(f(p), '', 'Confidential')).toEqual(['Confidential'])
    }
    expect(footerLines(f(), '', '')).toEqual([])
  })

  it('trims, so a whitespace-only note does not produce a blank line', () => {
    expect(footerLines(f('below'), '© 2026 Ada', '   ')).toEqual(['© 2026 Ada'])
  })

  it('falls back to the original layout for a junk placement from an import', () => {
    expect(footerLines(f('sideways'), '© 2026 Ada', 'Note')).toEqual(['© 2026 Ada  ·  Note'])
    expect(withFooterDefaults({ note_placement: 'sideways' as never }).note_placement).toBe('after')
  })
})
/**
 * The header style boundary validator (§7.8: view config is untrusted-import
 * surface, sanitised at the render boundary).
 */
describe('withHeaderDefaults — the text style clamp', () => {
  const styleOf = (over: unknown) =>
    withHeaderDefaults({ name_style: over } as never).name_style

  it('clamps an out-of-range size into 4..200', () => {
    // A crafted import can carry any number; 0 renders nothing and 10000 makes
    // one glyph fill the page.
    expect(styleOf({ size_pt: 0, font: 'body' }).size_pt).toBe(4)
    expect(styleOf({ size_pt: 10_000, font: 'body' }).size_pt).toBe(200)
    expect(styleOf({ size_pt: 18, font: 'body' }).size_pt).toBe(18)
  })

  it('rejects a non-finite or non-numeric size, falling back to the default', () => {
    for (const bad of [NaN, Infinity, -Infinity, '18', null, {}]) {
      expect(styleOf({ size_pt: bad, font: 'body' }).size_pt, JSON.stringify(bad)).toBeNull()
    }
  })

  it('rejects a font outside the allowed set', () => {
    expect(styleOf({ size_pt: null, font: 'Comic Sans' }).font).toBe('condensed')
    expect(styleOf({ size_pt: null, font: 'body' }).font).toBe('body')
  })

  it('survives a missing style object entirely', () => {
    expect(styleOf(undefined)).toEqual({ size_pt: null, font: 'condensed' })
  })

  it('rejects a non-string separator', () => {
    expect(withHeaderDefaults({ separator: 42 } as never).separator).toBe(' | ')
    expect(withHeaderDefaults({ separator: ' · ' } as never).separator).toBe(' · ')
  })

  it('normalizes an absent logo override to null rather than undefined', () => {
    expect(withHeaderDefaults({}).logo_override).toBeNull()
  })
})

describe('the default field spec', () => {
  /**
   * Order and default visibility are what a fresh view prints, so each field is
   * pinned by key: a flipped `show` silently adds a date of birth to every new
   * export, and a flipped `same_line` rearranges the block.
   */
  const spec = () => defaultHeaderFields().map((f) => [f.key, f.show, f.same_line])

  it('shows phone, email, location and languages, and nothing else, by default', () => {
    expect(defaultHeaderFields().filter((f) => f.show).map((f) => f.key))
      .toEqual(['phone', 'email', 'location', 'languages'])
  })

  it('hides the personal and social fields until asked for', () => {
    const hidden = defaultHeaderFields().filter((f) => !f.show).map((f) => f.key)
    for (const key of ['nationality', 'date_of_birth', 'linkedin']) expect(hidden).toContain(key)
  })

  it('puts email on the phone\u2019s line and starts a new line for the rest', () => {
    const sameLine = defaultHeaderFields().filter((f) => f.same_line).map((f) => f.key)
    expect(sameLine).toEqual(['email', 'website', 'personal_website', 'twitter'])
  })

  it('numbers the fields in spec order with no gaps or duplicates', () => {
    const fields = defaultHeaderFields()
    expect(fields.map((f) => f.sort_order)).toEqual(fields.map((_, i) => i))
    expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length)
  })

  it('gives a fresh spec each call — one view\u2019s edits cannot reach another', () => {
    const a = defaultHeaderFields()
    a[0].show = false
    expect(defaultHeaderFields()[0].show).toBe(true)
    expect(spec()[0]).toEqual(['phone', true, false])
  })
})

describe('headerFieldLabel — a present key is an opinion', () => {
  // `label` absent is a real stored shape (an older view), which the type
  // does not admit but `headerFieldLabel` handles.
  const field = (label?: Record<string, string>): HeaderField =>
    ({ key: 'phone', show: true, same_line: false, sort_order: 0, label }) as HeaderField

  it('uses the stored label for the requested locale', () => {
    expect(headerFieldLabel(field({ en: 'Tel: ' }), 'en')).toBe('Tel: ')
  })

  it('returns a BLANKED label verbatim rather than falling back', () => {
    // "Just print the number" is a real choice; falling back here would print
    // some other language's label instead.
    expect(headerFieldLabel(field({ en: '' }), 'en')).toBe('')
    expect(headerFieldLabel(field({ en: '', no: 'Telefon: ' }), 'en')).toBe('')
  })

  it('falls back to the default label when the locale key is ABSENT', () => {
    expect(headerFieldLabel(field({ no: 'Tlf: ' }), 'en')).toBe(defaultFieldLabels('phone').en)
    expect(headerFieldLabel(field(), 'en')).toBe(defaultFieldLabels('phone').en)
  })

  it('prefers another language\u2019s STORED label over the default, as resolve does', () => {
    // No 'de' anywhere in the stored labels, so the merged map answers with the
    // default for de — which exists for every offered locale.
    expect(headerFieldLabel(field({ no: 'Tlf: ' }), 'de')).toBe(defaultFieldLabels('phone').de)
  })

  it('names every header field in every offered locale', () => {
    for (const field of defaultHeaderFields()) {
      const labels = defaultFieldLabels(field.key)
      for (const code of LOCALE_CODES) expect(labels[code], `${field.key}/${code}`).toBeTruthy()
    }
  })

  it('copies the defaults out, so a caller cannot mutate the table', () => {
    const labels = defaultFieldLabels('phone')
    const original = labels.en
    labels.en = 'tampered'
    expect(defaultFieldLabels('phone').en).toBe(original)
  })

  it('returns an empty map for a key with no defaults', () => {
    expect(defaultFieldLabels('nonsense' as never)).toEqual({})
  })
})

describe('withHeaderDefaults — the untrusted-import boundary', () => {
  it('replaces an EMPTY field list with the default spec', () => {
    // An empty list would render a header with no contact details at all.
    expect(withHeaderDefaults({ fields: [] }).fields.map((f) => f.key))
      .toEqual(defaultHeaderFields().map((f) => f.key))
  })

  it('keeps a supplied field list, appending only the default keys it predates — hidden', () => {
    // The append is what lets a view saved before a field key existed still
    // OFFER it (the header controls iterate the stored list); hidden + last,
    // so nothing the saved view renders changes until the user turns it on.
    const fields = [{ key: 'email' as const, show: true, same_line: false, sort_order: 0, label: {} }]
    const out = withHeaderDefaults({ fields }).fields
    expect(out[0]).toEqual(fields[0])
    const appended = out.slice(1)
    expect(appended.every((f) => !f.show)).toBe(true)
    expect(new Set(out.map((f) => f.key)).size).toBe(defaultHeaderFields().length)
    expect(appended.map((f) => f.sort_order)).toEqual(appended.map((_, i) => i + 1))
  })

  it('a complete stored list is returned exactly as supplied', () => {
    const fields = defaultHeaderFields().map((f) => ({ ...f, show: true }))
    expect(withHeaderDefaults({ fields }).fields).toEqual(fields)
  })

  it('takes a separator only when it is a string', () => {
    expect(withHeaderDefaults({ separator: ' | ' }).separator).toBe(' | ')
    expect(withHeaderDefaults({ separator: 42 as never }).separator)
      .toBe(withHeaderDefaults({}).separator)
    expect(withHeaderDefaults({ separator: '' }).separator).toBe('')
  })

  it('normalises a missing photo or logo override to null, not undefined', () => {
    const h = withHeaderDefaults({})
    expect(h.photo_override).toBeNull()
    expect(h.logo_override).toBeNull()
    expect(withHeaderDefaults({ photo_override: 'data:image/png;base64,AAA' }).photo_override)
      .toBe('data:image/png;base64,AAA')
  })

  it('clamps a text size into the printable range and drops a non-number', () => {
    const size = (size_pt: unknown) =>
      withHeaderDefaults({ name_style: { size_pt, font: 'body' } as never }).name_style.size_pt
    expect(size(18)).toBe(18)
    expect(size(1)).toBe(4)
    expect(size(9999)).toBe(200)
    expect(size('18')).toBeNull()
    expect(size(Number.NaN)).toBeNull()
    expect(size(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('falls back to the default font for an unknown font id', () => {
    expect(withHeaderDefaults({ name_style: { size_pt: null, font: 'comic' } as never }).name_style.font)
      .toBe(withHeaderDefaults({}).name_style.font)
    expect(withHeaderDefaults({ name_style: { size_pt: null, font: 'serif' } as never }).name_style.font)
      .toBe('serif')
  })
})

describe('buildLanguageSummary', () => {
  const lang = (over: Partial<SpokenLanguage>): SpokenLanguage =>
    makeSpokenLanguage({ ...over })

  it('lists name and level in sort order', () => {
    const s = emptyStore()
    s.spoken_languages = [
      lang({ id: 'b', name: { en: 'English' }, level: { en: 'fluent' }, sort_order: 1 }),
      lang({ id: 'a', name: { en: 'Norwegian' }, level: { en: 'native' }, sort_order: 0 }),
    ]
    expect(buildLanguageSummary(s, 'en')).toBe('Norwegian (native), English (fluent)')
  })

  it('prints a name with no level as the bare name', () => {
    const s = emptyStore()
    s.spoken_languages = [lang({ name: { en: 'Norwegian' }, level: {} })]
    expect(buildLanguageSummary(s, 'en')).toBe('Norwegian')
  })

  it('drops an entry with no NAME, level or not — a bare "(fluent)" says nothing', () => {
    const s = emptyStore()
    s.spoken_languages = [
      lang({ id: 'a', name: {}, level: { en: 'fluent' }, sort_order: 0 }),
      lang({ id: 'b', name: { en: 'English' }, level: { en: 'fluent' }, sort_order: 1 }),
    ]
    expect(buildLanguageSummary(s, 'en')).toBe('English (fluent)')
  })

  it('skips a disabled language', () => {
    const s = emptyStore()
    s.spoken_languages = [
      lang({ id: 'a', name: { en: 'Latin' }, level: {}, disabled: true, sort_order: 0 }),
      lang({ id: 'b', name: { en: 'English' }, level: {}, sort_order: 1 }),
    ]
    expect(buildLanguageSummary(s, 'en')).toBe('English')
  })

  it('resolves in the requested locale', () => {
    const s = emptyStore()
    s.spoken_languages = [lang({ name: { en: 'Norwegian', no: 'Norsk' }, level: { en: 'native', no: 'morsmål' } })]
    expect(buildLanguageSummary(s, 'no')).toBe('Norsk (morsmål)')
  })

  it('is empty with nothing to say', () => {
    expect(buildLanguageSummary(emptyStore(), 'en')).toBe('')
  })
})

describe('buildHeaderLines — visibility and line grouping', () => {
  const resume = () => makeResume({
    full_name: 'A B', phone: '+47 123', email: 'a@b.no', place_of_residence: { en: 'Oslo' },
  })
  const fields = (over: Array<Partial<HeaderField>>): HeaderField[] =>
    over.map((f, i) => ({ key: 'phone', show: true, same_line: false, sort_order: i, ...f } as HeaderField))

  it('skips a hidden field even when it has a value', () => {
    const header = withHeaderDefaults({ fields: fields([{ key: 'phone', show: false }, { key: 'email' }]) })
    const lines = buildHeaderLines(header, resume(), emptyStore(), 'en')
    expect(lines.flat().map((s) => s.value)).toEqual(['a@b.no'])
  })

  it('skips a shown field with no value', () => {
    const header = withHeaderDefaults({ fields: fields([{ key: 'phone' }, { key: 'linkedin' }]) })
    const lines = buildHeaderLines(header, resume(), emptyStore(), 'en')
    expect(lines.flat().map((s) => s.value)).toEqual(['+47 123'])
  })

  it('joins a same_line field onto the previous line', () => {
    const header = withHeaderDefaults({
      fields: fields([{ key: 'phone' }, { key: 'email', same_line: true }, { key: 'location' }]),
    })
    const lines = buildHeaderLines(header, resume(), emptyStore(), 'en')
    expect(lines.map((l) => l.map((s) => s.value))).toEqual([['+47 123', 'a@b.no'], ['Oslo']])
  })

  it('starts a line when a same_line field is FIRST — nothing to join onto', () => {
    const header = withHeaderDefaults({ fields: fields([{ key: 'email', same_line: true }, { key: 'phone' }]) })
    const lines = buildHeaderLines(header, resume(), emptyStore(), 'en')
    expect(lines.map((l) => l.map((s) => s.value))).toEqual([['a@b.no'], ['+47 123']])
  })

  it('renders in sort_order, not array order', () => {
    const header = withHeaderDefaults({
      fields: [
        { key: 'email', show: true, same_line: false, sort_order: 1, label: {} },
        { key: 'phone', show: true, same_line: false, sort_order: 0, label: {} },
      ],
    })
    expect(buildHeaderLines(header, resume(), emptyStore(), 'en').flat().map((s) => s.value))
      .toEqual(['+47 123', 'a@b.no'])
  })

  it('carries each field\u2019s label beside its value', () => {
    const header = withHeaderDefaults({ fields: fields([{ key: 'phone', label: { en: 'Tel: ' } }]) })
    expect(buildHeaderLines(header, resume(), emptyStore(), 'en')).toEqual([[{ label: 'Tel: ', value: '+47 123' }]])
  })
})

describe('buildCopyrightLine and footerLines', () => {
  const footer = (over: Partial<ViewFooterConfig> = {}) => withFooterDefaults(over)
  const resume = () => makeResume({ full_name: 'Ada Lovelace', company_name: 'Cartavio AS' })

  it('names the person, the company or a custom holder', () => {
    expect(buildCopyrightLine(footer({ copyright: 'person' }), resume(), 2026, 'en')).toBe('© 2026 Ada Lovelace')
    expect(buildCopyrightLine(footer({ copyright: 'company' }), resume(), 2026, 'en')).toBe('© 2026 Cartavio AS')
    expect(buildCopyrightLine(footer({ copyright: 'custom', copyright_custom: { en: 'Someone' } }), resume(), 2026, 'en'))
      .toBe('© 2026 Someone')
  })

  it('is empty when disabled, and for an unrecognised holder', () => {
    expect(buildCopyrightLine(footer({ copyright: 'none' }), resume(), 2026, 'en')).toBe('')
    expect(buildCopyrightLine(footer({ copyright: 'bogus' as never }), resume(), 2026, 'en')).toBe('')
  })

  it('is empty when the holder name is blank or whitespace', () => {
    const blank = makeResume({ full_name: '   ', company_name: '' })
    expect(buildCopyrightLine(footer({ copyright: 'person' }), blank, 2026, 'en')).toBe('')
    expect(buildCopyrightLine(footer({ copyright: 'company' }), blank, 2026, 'en')).toBe('')
  })

  it('trims the holder name it prints', () => {
    const padded = makeResume({ full_name: '  Ada  ' })
    expect(buildCopyrightLine(footer({ copyright: 'person' }), padded, 2026, 'en')).toBe('© 2026 Ada')
  })

  it('places the note around the copyright per the placement', () => {
    const c = '© 2026 Ada'
    const n = 'Confidential'
    expect(footerLines(footer({ note_placement: 'after' }), c, n)).toEqual([`${c}  ·  ${n}`])
    expect(footerLines(footer({ note_placement: 'before' }), c, n)).toEqual([`${n}  ·  ${c}`])
    expect(footerLines(footer({ note_placement: 'above' }), c, n)).toEqual([n, c])
    expect(footerLines(footer({ note_placement: 'below' }), c, n)).toEqual([c, n])
    expect(footerLines(footer({ note_placement: 'sideways' as never }), c, n)).toEqual([`${c}  ·  ${n}`])
  })

  it('collapses to whichever part has text, treating whitespace as empty', () => {
    expect(footerLines(footer(), '© 2026 Ada', '   ')).toEqual(['© 2026 Ada'])
    expect(footerLines(footer(), '  ', 'Confidential')).toEqual(['Confidential'])
    expect(footerLines(footer(), '   ', '  ')).toEqual([])
  })
})

describe('the header defaults a fresh view inherits', () => {
  it('sets the name in the brand condensed face and the title in the body face', () => {
    const h = withHeaderDefaults({})
    expect(h.name_style).toEqual({ size_pt: null, font: 'condensed' })
    expect(h.title_style).toEqual({ size_pt: null, font: 'body' })
  })

  it('starts with no photo, no logo and the pipe separator', () => {
    const h = withHeaderDefaults({})
    expect([h.photo_placement, h.logo_placement, h.photo_shape]).toEqual(['none', 'none', 'square'])
    expect(h.separator).toBe(' | ')
  })
})

describe('resolveHeaderFieldValue', () => {
  const resume = () => makeResume({
    phone: '+47 1', email: 'a@b.no', place_of_residence: { en: 'Oslo', no: 'Oslo NO' },
    nationality: { en: 'Norwegian' }, date_of_birth: '1980-01-01',
    linkedin_url: 'https://li/x', website_url: 'https://x.no', twitter: '@x',
  })

  it('reads each field off the resume', () => {
    const at = (key: Parameters<typeof resolveHeaderFieldValue>[0]) =>
      resolveHeaderFieldValue(key, resume(), emptyStore(), 'en')
    expect(at('phone')).toBe('+47 1')
    expect(at('email')).toBe('a@b.no')
    expect(at('location')).toBe('Oslo')
    expect(at('nationality')).toBe('Norwegian')
    expect(at('date_of_birth')).toBe('1980-01-01')
    expect(at('linkedin')).toBe('https://li/x')
    expect(at('website')).toBe('https://x.no')
    expect(at('twitter')).toBe('@x')
  })

  it('resolves a localized field in the requested locale', () => {
    expect(resolveHeaderFieldValue('location', resume(), emptyStore(), 'no')).toBe('Oslo NO')
  })

  it('returns an empty STRING for an unknown key, never undefined', () => {
    // Callers test the value for emptiness; undefined would print as "undefined".
    expect(resolveHeaderFieldValue('made_up' as never, resume(), emptyStore(), 'en')).toBe('')
  })

  it('returns an empty string for a field the resume never filled', () => {
    expect(resolveHeaderFieldValue('phone', makeResume({ phone: undefined }), emptyStore(), 'en')).toBe('')
  })

  it('reads the personal website off its own field, absent tolerated', () => {
    expect(resolveHeaderFieldValue(
      'personal_website', makeResume({ personal_website_url: 'https://me.example' }), emptyStore(), 'en',
    )).toBe('https://me.example')
    expect(resolveHeaderFieldValue('personal_website', makeResume(), emptyStore(), 'en')).toBe('')
  })
})

describe('per-view contact overrides (email/phone)', () => {
  // A role that wants its own communication channel: the view's override wins
  // over the master value in every render target — buildHeaderLines is the one
  // place all four read.
  const showAll = (h: ViewHeaderConfig): ViewHeaderConfig => ({
    ...h,
    fields: h.fields.map((f) => ({ ...f, show: f.key === 'phone' || f.key === 'email' })),
  })
  const r = () => makeResume({ phone: '+47 1', email: 'master@x.no' })

  const values = (over: Partial<ViewHeaderConfig>): string[] =>
    buildHeaderLines(showAll(withHeaderDefaults(over)), r(), emptyStore(), 'en')
      .flat().map((s) => s.value)

  it('an override replaces the master value; blank falls back', () => {
    expect(values({})).toEqual(['+47 1', 'master@x.no'])
    expect(values({ email_override: 'board@x.no', phone_override: '+47 2' }))
      .toEqual(['+47 2', 'board@x.no'])
    expect(values({ email_override: '  ', phone_override: null }))
      .toEqual(['+47 1', 'master@x.no'])
  })

  it('an override even supplies a value the master never had', () => {
    const bare = makeResume({ phone: null, email: '' })
    const lines = buildHeaderLines(
      showAll(withHeaderDefaults({ phone_override: '+47 9' })), bare, emptyStore(), 'en',
    )
    expect(lines.flat().map((s) => s.value)).toEqual(['+47 9'])
  })

  it('the untrusted-import boundary reads a non-string override as none', () => {
    expect(withHeaderDefaults({ email_override: 42 as never }).email_override).toBeNull()
    expect(withHeaderDefaults({ phone_override: ['x'] as never }).phone_override).toBeNull()
    expect(withHeaderDefaults({ email_override: 'a@b.no' }).email_override).toBe('a@b.no')
  })
})

describe('safeTextStyle — a size that is not a number', () => {
  it('drops a non-numeric size rather than writing it into the CSS', () => {
    // The value lands in a style attribute at the render boundary; a string
    // from an imported view config would emit `font-size:12ptpt`.
    const h = withHeaderDefaults({ name_style: { size_pt: '12', font: 'heading' } } as never)
    expect(h.name_style.size_pt).toBeNull()

    const num = withHeaderDefaults({ name_style: { size_pt: 12, font: 'heading' } } as never)
    expect(num.name_style.size_pt).toBe(12)
  })

  it('drops a non-finite size too', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(withHeaderDefaults({ name_style: { size_pt: bad, font: 'heading' } } as never).name_style.size_pt, String(bad))
        .toBeNull()
    }
  })
})
