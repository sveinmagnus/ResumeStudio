import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW_HEADER, DEFAULT_VIEW_FOOTER,
  withHeaderDefaults, withFooterDefaults, defaultHeaderFields,
  buildLanguageSummary, buildHeaderLines, resolveHeaderFieldValue,
  buildCopyrightLine,
} from '../src/lib/viewHeader'
import { emptyStore, makeResume, makeSpokenLanguage } from './fixtures'
import type { ViewHeaderConfig } from '../src/types'

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
    const store = emptyStore()
    const r = makeResume({ phone: null, linkedin_url: null })
    expect(resolveHeaderFieldValue('phone', r, store, 'en')).toBe('')
    expect(resolveHeaderFieldValue('linkedin', r, store, 'en')).toBe('')
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
