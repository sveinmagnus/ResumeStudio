import { describe, it, expect } from 'vitest'
import { resolve, fmtDate, fmtRange, LOCALE_LABELS } from '../src/lib/locales'

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
