import { describe, it, expect } from 'vitest'
import { resolve, fmtDate, fmtRange, fmtRelativeTime, LOCALE_LABELS, detectLocalesInData, sortLocales, bcp47 } from '../src/lib/locales'
import { emptyStore, makeProject, makeWork } from './fixtures'

describe('fmtRelativeTime()', () => {
  const now = new Date('2026-05-31T12:00:00Z').getTime()

  it('reports recent times as "just now"', () => {
    expect(fmtRelativeTime('2026-05-31T11:59:40Z', now)).toBe('just now')
  })

  it('reports minutes and hours', () => {
    expect(fmtRelativeTime('2026-05-31T11:30:00Z', now)).toBe('30 min ago')
    expect(fmtRelativeTime('2026-05-31T10:00:00Z', now)).toBe('2 hours ago')
    expect(fmtRelativeTime('2026-05-31T11:00:00Z', now)).toBe('1 hour ago')
  })

  it('falls back to an absolute date string beyond a day', () => {
    const out = fmtRelativeTime('2026-05-28T12:00:00Z', now)
    expect(out).not.toMatch(/ago|just now/)
    expect(out.length).toBeGreaterThan(0)
  })

  it('handles future timestamps and invalid input gracefully', () => {
    expect(fmtRelativeTime('2026-06-01T12:00:00Z', now)).toBe('just now')
    expect(fmtRelativeTime('not-a-date', now)).toBe('')
  })
})

describe('bcp47()', () => {
  it('maps the CVpartner country-style codes to language tags', () => {
    expect(bcp47('se')).toBe('sv') // BCP-47 `se` would be Northern Sami
    expect(bcp47('dk')).toBe('da')
  })

  it('passes valid ISO 639-1 codes through untouched', () => {
    expect(bcp47('en')).toBe('en')
    expect(bcp47('no')).toBe('no')
    expect(bcp47('de')).toBe('de')
  })
})

describe('resolve()', () => {
  it('returns the requested locale when present', () => {
    expect(resolve({ en: 'Hello', no: 'Hei' }, 'en')).toBe('Hello')
    expect(resolve({ en: 'Hello', no: 'Hei' }, 'no')).toBe('Hei')
  })

  it('falls back to the configured fallback locale', () => {
    expect(resolve({ en: 'Hello' }, 'se')).toBe('Hello')
    expect(resolve({ no: 'Hei' }, 'se', 'no')).toBe('Hei')
  })

  it('falls back to first available key when fallback locale is missing', () => {
    expect(resolve({ se: 'Hej', dk: 'Hej' }, 'no')).toBe('Hej')
  })

  it('returns empty string for undefined or empty input', () => {
    expect(resolve(undefined, 'en')).toBe('')
    expect(resolve({}, 'en')).toBe('')
  })

  it('does not coerce empty string values — first non-empty wins', () => {
    // empty string for primary locale is falsy → falls through to fallback
    expect(resolve({ en: '', no: 'Hei' }, 'en')).toBe('Hei')
  })

  it('uses Object.values order when nothing matches the chain', () => {
    // Only `de` is present; not requested locale, not fallback
    expect(resolve({ de: 'Hallo' }, 'fr', 'en')).toBe('Hallo')
  })
})

describe('fmtDate()', () => {
  it('formats year + month as "Mon YYYY"', () => {
    expect(fmtDate({ year: 2021, month: 3 })).toBe('Mar 2021')
    expect(fmtDate({ year: 2024, month: 12 })).toBe('Dec 2024')
    expect(fmtDate({ year: 2020, month: 1 })).toBe('Jan 2020')
  })

  it('formats year-only when month is null', () => {
    expect(fmtDate({ year: 2021, month: null })).toBe('2021')
  })

  it('returns empty string for null', () => {
    expect(fmtDate(null)).toBe('')
  })
})

describe('fmtRange()', () => {
  it('formats start–end with both endpoints', () => {
    expect(fmtRange({ year: 2020, month: 3 }, { year: 2022, month: 6 }))
      .toBe('Mar 2020 – Jun 2022')
  })

  it('renders end="Present" when end is null', () => {
    expect(fmtRange({ year: 2020, month: 3 }, null)).toBe('Mar 2020 – Present')
  })

  it('returns empty string when start is null and end is null', () => {
    expect(fmtRange(null, null)).toBe('')
  })

  it('returns the end alone when only end is provided', () => {
    expect(fmtRange(null, { year: 2022, month: 6 })).toBe('Jun 2022')
  })

  it('mixes year-only with year+month dates', () => {
    expect(fmtRange({ year: 2020, month: null }, { year: 2022, month: 6 }))
      .toBe('2020 – Jun 2022')
  })
})

describe('LOCALE_LABELS', () => {
  it('contains canonical locales used by the app', () => {
    for (const code of ['en', 'no', 'se', 'dk']) {
      expect(LOCALE_LABELS[code]).toBeDefined()
      expect(LOCALE_LABELS[code].name).toBeTruthy()
      expect(LOCALE_LABELS[code].flag).toBeTruthy()
    }
  })
})

describe('detectLocalesInData()', () => {
  it('returns an empty list for a store with no localized content', () => {
    const store = emptyStore()
    if (store.resume) {
      store.resume.title = {}
      store.resume.nationality = {}
      store.resume.place_of_residence = {}
    }
    expect(detectLocalesInData(store)).toEqual([])
  })

  it('finds locales from nested entity fields', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ customer: { no: 'X', se: 'Y' } }))
    store.work_experiences.push(makeWork({ employer: { dk: 'Z' } }))
    const found = new Set(detectLocalesInData(store))
    // resume fixture has { en, no } in title — those count too
    for (const l of ['en', 'no', 'se', 'dk']) {
      expect(found.has(l)).toBe(true)
    }
  })

  it('ignores keys that are not in LOCALE_LABELS', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      customer: { en: 'X', not_a_locale: 'Y' } as Record<string, string>,
    }))
    expect(detectLocalesInData(store)).not.toContain('not_a_locale')
  })

  it('normalises "int" to "en"', () => {
    const store = emptyStore()
    if (store.resume) store.resume.title = { int: 'Consultant' } as Record<string, string>
    expect(detectLocalesInData(store)).toContain('en')
    expect(detectLocalesInData(store)).not.toContain('int')
  })

  it('ignores empty/whitespace-only values', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ customer: { se: '   ', dk: '' } }))
    const found = detectLocalesInData(store)
    expect(found).not.toContain('se')
    expect(found).not.toContain('dk')
  })
})

describe('sortLocales()', () => {
  it('puts no first, then en, then others alphabetically-stable', () => {
    expect(sortLocales(['se', 'en', 'no', 'dk'])).toEqual(['no', 'en', 'se', 'dk'])
  })

  it('deduplicates input', () => {
    expect(sortLocales(['en', 'en', 'no', 'no'])).toEqual(['no', 'en'])
  })

  it('leaves a single-locale list alone', () => {
    expect(sortLocales(['en'])).toEqual(['en'])
  })
})
