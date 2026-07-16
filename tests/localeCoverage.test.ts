/**
 * The locale-coverage contract: every locale the app OFFERS must be translated
 * in every surface an exported view renders.
 *
 * Why this file exists rather than per-surface assertions: a missing locale
 * never throws — `resolve()` quietly falls back to English — so an untranslated
 * language ships as a plausible-looking export with English section headings.
 * That is exactly how the app came to offer 19 languages while translating 4.
 * These tests make the failure loud: add a code to LOCALE_LABELS and the suite
 * fails until every surface below has a word for it. Don't relax them by
 * skipping a locale — either translate it or don't offer it.
 */

import { describe, it, expect } from 'vitest'
import { LOCALE_LABELS, LOCALE_CODES, MONTH_ABBR, PRESENT, fmtRange } from '../src/lib/locales'
import { SECTION_HEADINGS } from '../src/lib/sections'
import { EXPORT_STRINGS, xs, xt, fmtYears } from '../src/lib/exportStrings'
import { CEFR_CATEGORIES, CEFR_GROUPS } from '../src/lib/cefr'
import { POSITION_TYPES } from '../src/lib/positionTypes'
import { PUBLICATION_TYPES } from '../src/lib/publicationTypes'
import { RELATIONSHIP_OPTIONS } from '../src/lib/recommendationRelationships'
import { defaultHeaderFields, headerFieldLabel } from '../src/lib/viewHeader'
import type { LocalizedString, HeaderField } from '../src/types'

const CODES = Object.keys(LOCALE_LABELS)

/** Every offered locale has a non-empty value in this label set. */
function expectFullCoverage(labels: LocalizedString, what: string): void {
  for (const code of CODES) {
    expect(labels[code]?.trim(), `${what} is missing a ${code} translation`).toBeTruthy()
  }
}

describe('offered locales', () => {
  it('offers exactly the 15 supported languages', () => {
    expect(CODES).toHaveLength(15)
    expect(LOCALE_CODES).toEqual(CODES)
  })

  it('does not offer the languages we cannot structurally support', () => {
    // Removed in v0.7.4: CJK/Arabic/Indic never had chrome translations, and
    // Arabic additionally needs RTL the render path doesn't implement.
    for (const code of ['zh', 'ja', 'ar', 'hi']) {
      expect(LOCALE_LABELS[code], `${code} should not be offered`).toBeUndefined()
    }
  })

  it('gives every offered locale a name and a flag', () => {
    for (const code of CODES) {
      expect(LOCALE_LABELS[code].name, code).toBeTruthy()
      expect(LOCALE_LABELS[code].flag, code).toBeTruthy()
    }
  })
})

describe('locale coverage — dates', () => {
  it('has 12 month abbreviations for every offered locale', () => {
    for (const code of CODES) {
      const months = MONTH_ABBR[code]
      expect(months, `${code} has no month names`).toBeDefined()
      expect(months, `${code} month count`).toHaveLength(12)
      for (const [i, m] of months.entries()) {
        expect(m?.trim(), `${code} month ${i + 1}`).toBeTruthy()
      }
    }
  })

  it('has a "Present" word for every offered locale', () => {
    for (const code of CODES) {
      expect(PRESENT[code]?.trim(), `${code} has no "Present"`).toBeTruthy()
    }
  })

  it('renders an ongoing range in the locale, not English', () => {
    // Spot-check the whole chain (month + separator + Present) on locales that
    // had no month names before this change.
    const start = { year: 2021, month: 3 }
    expect(fmtRange(start, null, 'month-year', 'de')).toBe('März 2021 – Heute')
    expect(fmtRange(start, null, 'month-year', 'fi')).toBe('maalisk. 2021 – Nykyinen')
    expect(fmtRange(start, null, 'month-year', 'ru')).toBe('март 2021 – Настоящее время')
    expect(fmtRange(start, null, 'month-year', 'pl')).toBe('mar. 2021 – Obecnie')
  })
})

describe('locale coverage — export chrome', () => {
  it('translates every export string for every offered locale', () => {
    for (const [key, labels] of Object.entries(EXPORT_STRINGS)) {
      expectFullCoverage(labels, `export string '${key}'`)
    }
  })

  it('translates every section heading for every offered locale', () => {
    for (const [key, labels] of Object.entries(SECTION_HEADINGS)) {
      expectFullCoverage(labels, `section heading '${key}'`)
    }
  })

  it('translates every header field label for every offered locale', () => {
    // These render at the top of every export — the most-read chrome there is.
    for (const field of defaultHeaderFields()) {
      expectFullCoverage(field.label, `header label '${field.key}'`)
    }
  })

  it('keeps recommendations and references distinct in every locale', () => {
    // Two different sections — written endorsements vs contactable referees.
    // A translation that collapses them would silently produce a CV with two
    // identically-titled sections.
    for (const code of CODES) {
      expect(
        SECTION_HEADINGS.recommendations[code],
        `recommendations/references collide in ${code}`,
      ).not.toBe(SECTION_HEADINGS.references[code])
    }
  })
})

describe('locale coverage — picked vocabularies', () => {
  // These are PICKS, not typed text: the consultant never gets a chance to
  // supply the word themselves, so a gap can only be filled here.
  it('translates every position type', () => {
    for (const t of POSITION_TYPES) expectFullCoverage(t.labels, `position type '${t.value}'`)
  })

  it('translates every publication type', () => {
    for (const t of PUBLICATION_TYPES) expectFullCoverage(t.labels, `publication type '${t.value}'`)
  })

  it('translates every recommendation relationship', () => {
    for (const o of RELATIONSHIP_OPTIONS) expectFullCoverage(o.labels, `relationship '${o.key}'`)
  })

  it('translates every CEFR category and group', () => {
    for (const c of CEFR_CATEGORIES) expectFullCoverage(c.labels, `CEFR category '${c.key}'`)
    for (const g of CEFR_GROUPS) expectFullCoverage(g.labels, `CEFR group '${g.label}'`)
  })

  it('keeps the English `label` twin in sync with `labels.en`', () => {
    // The editor renders `label`; the export renders `labels`. If they drift,
    // a consultant picks one word and their client reads another.
    for (const t of POSITION_TYPES) expect(t.label, t.value).toBe(t.labels.en)
    for (const t of PUBLICATION_TYPES) expect(t.label, t.value).toBe(t.labels.en)
    for (const c of CEFR_CATEGORIES) expect(c.label, c.key).toBe(c.labels.en)
    for (const g of CEFR_GROUPS) expect(g.label).toBe(g.labels.en)
  })
})

describe('headerFieldLabel', () => {
  const field = (label: LocalizedString): HeaderField =>
    ({ key: 'phone', show: true, label, same_line: false, sort_order: 0 })

  it('uses the stored label for the locales it fills', () => {
    expect(headerFieldLabel(field({ en: 'Tel: ' }), 'en')).toBe('Tel: ')
  })

  it('falls back to the current defaults for locales a saved view predates', () => {
    // The regression this guards: a view saved when the defaults were en/no
    // only has just those two stamped into its data. Resolving that alone
    // would hand a German export the English label forever.
    const stale = field({ en: 'Phone: ', no: 'Telefon: ' })
    expect(headerFieldLabel(stale, 'de')).toBe('Telefon: ')
    expect(headerFieldLabel(stale, 'fi')).toBe('Puhelin: ')
    expect(headerFieldLabel(stale, 'uk')).toBe('Телефон: ')
  })

  it('lets a stored label win over the default in its own locale', () => {
    const custom = field({ en: 'Phone: ', de: 'Mobil: ' })
    expect(headerFieldLabel(custom, 'de')).toBe('Mobil: ')
  })

  it('honours a deliberately blanked label instead of falling back', () => {
    // A present key is an opinion, even an empty one: the user asked for the
    // bare value. Naive `resolve({...defaults, ...label})` treats '' as missing
    // and answers with another language's label — don't reintroduce that.
    expect(headerFieldLabel(field({ en: '' }), 'en')).toBe('')
    expect(headerFieldLabel(field({ en: 'Phone: ', de: '' }), 'de')).toBe('')
  })

  it('still defaults the locales a blanked label says nothing about', () => {
    expect(headerFieldLabel(field({ en: '' }), 'de')).toBe('Telefon: ')
  })
})

describe('xs / xt', () => {
  it('falls back to English for a locale we do not offer', () => {
    expect(xs('matrix_skill', 'ja')).toBe('Skill')
  })

  it('substitutes template placeholders', () => {
    expect(xt('team_of', 'en', { n: 5 })).toBe('Team of 5')
    expect(xt('allocation', 'en', { n: 50 })).toBe('50% allocation')
  })

  it('places the value where the language puts it, not at the end', () => {
    // The reason templates exist rather than concatenation.
    expect(xt('team_of', 'fi', { n: 5 })).toBe('5 hengen tiimi')
    expect(xt('allocation', 'ru', { n: 50 })).toBe('Загрузка 50%')
  })

  it('never leaves a raw placeholder in output', () => {
    expect(xt('team_of', 'en', {})).not.toContain('{')
  })
})

describe('fmtYears', () => {
  it('is blank for an unknown count', () => {
    expect(fmtYears(0, 'en')).toBe('')
    expect(fmtYears(-1, 'en')).toBe('')
  })

  it('pluralizes English', () => {
    expect(fmtYears(1, 'en')).toBe('1 yr')
    expect(fmtYears(5, 'en')).toBe('5 yrs')
  })

  it('applies Slavic plural categories rather than one fixed form', () => {
    // The bug this guards: a single 'lat'/'лет' renders "1 lat" / "1 лет".
    expect(fmtYears(1, 'pl')).toBe('1 rok')
    expect(fmtYears(2, 'pl')).toBe('2 lata')
    expect(fmtYears(5, 'pl')).toBe('5 lat')
    expect(fmtYears(1, 'ru')).toBe('1 год')
    expect(fmtYears(2, 'ru')).toBe('2 года')
    expect(fmtYears(5, 'ru')).toBe('5 лет')
    expect(fmtYears(1, 'uk')).toBe('1 рік')
    expect(fmtYears(5, 'uk')).toBe('5 років')
  })

  it('resolves plural rules through bcp47, not the raw app code', () => {
    // `se`/`dk` are not Swedish/Danish in BCP-47 — Intl would pick the wrong
    // (or no) rule set without the mapping.
    expect(fmtYears(1, 'se')).toBe('1 år')
    expect(fmtYears(5, 'dk')).toBe('5 år')
  })

  it('has a year unit for every offered locale', () => {
    for (const code of CODES) {
      expect(fmtYears(3, code), `${code} year unit`).toMatch(/^3 \S/)
    }
  })
})
