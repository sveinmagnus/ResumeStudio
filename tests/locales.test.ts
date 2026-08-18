import { describe, it, expect } from 'vitest'
import { resolve, fmtDate, fmtRange, fmtRelativeTime, LOCALE_LABELS, detectLocalesInData, sortLocales, bcp47 } from '../src/lib/locales'
import { emptyStore, makeProject, makeWork } from './fixtures'
import type { ResumeStore } from '../src/types'

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

  it('prefers the fallback locale over whatever key happens to come first', () => {
    // With only one other key present, "fall back to en" and "take the first
    // value" give the same answer — so the middle rung of the chain has to be
    // tested with the fallback NOT in first position.
    expect(resolve({ no: 'Hei', en: 'Hello' }, 'se')).toBe('Hello')
    expect(resolve({ dk: 'Hej', no: 'Hei' }, 'se', 'no')).toBe('Hei')
    // …and an empty fallback value still drops through to the next rung.
    expect(resolve({ no: 'Hei', en: '' }, 'se')).toBe('Hei')
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

  it('localizes the month abbreviation (defaults to English)', () => {
    expect(fmtDate({ year: 2021, month: 3 }, 'month-year', 'no')).toBe('mar. 2021')
    expect(fmtDate({ year: 2021, month: 5 }, 'month-year', 'se')).toBe('maj 2021')
    expect(fmtDate({ year: 2021, month: 12 }, 'month-year', 'dk')).toBe('dec. 2021')
    expect(fmtDate({ year: 2021, month: 3 }, 'month-year')).toBe('Mar 2021') // en default
  })

  it('localizes the "Present" end of an open range', () => {
    expect(fmtRange({ year: 2020, month: 1 }, null, 'month-year', 'no')).toBe('jan. 2020 – Nå')
    expect(fmtRange({ year: 2020, month: 1 }, null, 'month-year')).toBe('Jan 2020 – Present')
  })

  it('returns empty string for null', () => {
    expect(fmtDate(null)).toBe('')
  })

  it('honours the date format argument', () => {
    const ym = { year: 2021, month: 3 }
    expect(fmtDate(ym, 'month-year')).toBe('Mar 2021')
    expect(fmtDate(ym, 'year-month')).toBe('2021 Mar')
    expect(fmtDate(ym, 'year-only')).toBe('2021')
    // year-only drops the month even when known; a month-less date is unaffected.
    expect(fmtDate({ year: 2021, month: null }, 'year-month')).toBe('2021')
  })

  it('formats numeric months zero-padded, year leading or trailing', () => {
    const ym = { year: 2021, month: 3 }
    expect(fmtDate(ym, 'month-year-num')).toBe('03/2021')
    expect(fmtDate(ym, 'year-month-num')).toBe('2021/03')
    expect(fmtDate({ year: 2021, month: 12 }, 'month-year-num')).toBe('12/2021')
    // A month-less date is still just the year in numeric formats.
    expect(fmtDate({ year: 2021, month: null }, 'month-year-num')).toBe('2021')
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

  it('applies the date format to both endpoints', () => {
    expect(fmtRange({ year: 2020, month: 3 }, { year: 2022, month: 6 }, 'year-month'))
      .toBe('2020 Mar – 2022 Jun')
    expect(fmtRange({ year: 2020, month: 3 }, { year: 2022, month: 6 }, 'year-only'))
      .toBe('2020 – 2022')
    expect(fmtRange({ year: 2020, month: 3 }, { year: 2022, month: 6 }, 'month-year-num'))
      .toBe('03/2020 – 06/2022')
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

describe('fmtRelativeTime — the boundaries between phrasings', () => {
  const NOW = Date.parse('2026-08-12T12:00:00Z')
  const ago = (ms: number) => fmtRelativeTime(new Date(NOW - ms).toISOString(), NOW)

  it('reads "just now" right up to 45 seconds, and switches at 45', () => {
    expect(ago(44_000)).toBe('just now')
    expect(ago(45_000)).toBe('1 min ago')
  })

  it('treats a future timestamp as just now rather than a negative age', () => {
    // Two machines' clocks disagree; a "-3 min ago" would look like a bug.
    expect(fmtRelativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now')
  })

  it('counts minutes up to the hour, then hours', () => {
    expect(ago(59 * 60_000)).toBe('59 min ago')
    expect(ago(60 * 60_000)).toBe('1 hour ago')
    expect(ago(2 * 3600_000)).toBe('2 hours ago')
  })

  it('hands anything a full day old to the locale date format, at exactly 24 hours', () => {
    expect(ago(23 * 3600_000)).toBe('23 hours ago')
    const full = ago(24 * 3600_000)
    expect(full).not.toMatch(/hour|min|just now/)
    expect(full).toBe(new Date(NOW - 24 * 3600_000).toLocaleString())
  })

  it('returns nothing for an unparseable timestamp', () => {
    expect(fmtRelativeTime('not a date', NOW)).toBe('')
  })
})

describe('detectLocalesInData — malformed values', () => {
  it('does not treat a locale key holding an OBJECT as a filled locale', () => {
    // An import can produce { en: { … } } where a string was expected; the
    // walker must recurse rather than take the key's presence as content.
    const data = { resume: { title: { en: { nested: 'Consultant' } } } } as unknown as ResumeStore
    expect(detectLocalesInData(data)).toEqual([])
  })

  it('still finds a locale nested under a malformed sibling', () => {
    const data = {
      resume: { title: { en: { nested: 'Consultant' } }, nationality: { no: 'Norsk' } },
    } as unknown as ResumeStore
    expect(detectLocalesInData(data)).toEqual(['no'])
  })
})

describe('detectLocalesInData — what the scan must not mistake for a locale', () => {
  it('does not walk INTO a string value', () => {
    // Recursing into a string yields character indexes as keys; the detector
    // would then offer '0' and '1' as languages in the switcher.
    const s: ResumeStore = { ...emptyStore(), projects: [makeProject({ id: 'p1', customer: { en: 'Acme' } })] }
    s.projects[0].external_url = 'https://example.test/en/no'
    const found = detectLocalesInData(s)
    expect(found).toContain('en')
    expect(found.some((l) => /^[0-9]+$/.test(l))).toBe(false)
  })

  it('finds a locale nested inside an array of localized values', () => {
    const s: ResumeStore = {
      ...emptyStore(),
      projects: [makeProject({ id: 'p1', customer: {}, highlights: [{ no: 'Ett punkt' }] })],
    }
    expect(detectLocalesInData(s)).toContain('no')
  })

  it('ignores a locale key whose value is blank', () => {
    // An empty slot is not evidence the resume is written in that language;
    // offering it puts an empty column in the editor.
    // A bare object, not a full store: the fixtures fill several fields in
    // both languages, which would mask the blank one under test.
    const found = detectLocalesInData({ customer: { en: 'Acme', no: '   ' } } as never)
    expect(found).toEqual(['en'])
  })
})
