import { describe, it, expect } from 'vitest'
import { xs, xt, fmtYears, EXPORT_STRINGS } from '../src/lib/exportStrings'
import { LOCALE_CODES } from '../src/lib/locales'

/**
 * Export chrome is the one localized layer in the app (CLAUDE.md §12): these
 * words land in a `.pdf` / `.docx` / `.txt` a consultant sends to a client, so a
 * missing entry is not a cosmetic gap — it is an English word in the middle of a
 * Norwegian CV.
 */

describe('xs — the localized lookup', () => {
  it('answers in the requested locale', () => {
    expect(xs('matrix_skill', 'no')).toBe(EXPORT_STRINGS.matrix_skill.no)
    expect(xs('matrix_skill', 'en')).toBe(EXPORT_STRINGS.matrix_skill.en)
  })

  it('falls back to English for a locale the table does not name', () => {
    expect(xs('matrix_skill', 'zz')).toBe(EXPORT_STRINGS.matrix_skill.en)
  })
})

describe('xt — placeholder substitution', () => {
  it('substitutes a named placeholder wherever the language puts it', () => {
    // Finnish leads with the count, English trails it: the same call has to
    // work for both, which is why this is a template rather than concatenation.
    expect(xt('team_of', 'en', { n: 5 })).toBe('Team of 5')
    expect(xt('team_of', 'fi', { n: 5 })).toBe('5 hengen tiimi')
  })

  it('substitutes a MULTI-character placeholder name, not just one letter', () => {
    expect(xt('allocation', 'en', { n: 50 })).toBe('50% allocation')
    expect(xt('allocation', 'ru', { n: 50 })).toContain('50')
  })

  it('renders an unknown placeholder as nothing rather than leaving braces visible', () => {
    // A literal "{n}" in a client's PDF is the worst outcome here.
    expect(xt('team_of', 'en', {})).toBe('Team of ')
    expect(xt('team_of', 'en', { other: 5 })).toBe('Team of ')
  })

  it('accepts a number or a string for the value', () => {
    expect(xt('team_of', 'en', { n: '5' })).toBe('Team of 5')
  })
})

describe('fmtYears — the unit noun per plural category', () => {
  it('is blank for a non-positive count, so the cell stays empty', () => {
    for (const n of [0, -1, Number.NaN]) expect(fmtYears(n, 'en'), String(n)).toBe('')
  })

  it('inflects English between one and many', () => {
    expect(fmtYears(1, 'en')).toBe('1 yr')
    expect(fmtYears(5, 'en')).toBe('5 yrs')
  })

  it('inflects the Slavic languages by count, which is the reason for the table', () => {
    // Polish: 1 rok / 2 lata / 5 lat. A single noun renders "1 lat", which is
    // visibly wrong in the one place a reader checks carefully.
    expect(fmtYears(1, 'pl')).toBe('1 rok')
    expect(fmtYears(2, 'pl')).toBe('2 lata')
    expect(fmtYears(5, 'pl')).toBe('5 lat')
    expect(fmtYears(1, 'ru')).toBe('1 год')
    expect(fmtYears(2, 'ru')).toBe('2 года')
    expect(fmtYears(5, 'ru')).toBe('5 лет')
    expect(fmtYears(1, 'uk')).toBe('1 рік')
    expect(fmtYears(5, 'uk')).toBe('5 років')
  })

  it('uses one noun for the languages that do not inflect here', () => {
    expect(fmtYears(1, 'no')).toBe('1 år')
    expect(fmtYears(5, 'no')).toBe('5 år')
    expect(fmtYears(1, 'fi')).toBe('1 v.')
    expect(fmtYears(5, 'is')).toBe('5 ár')
  })

  it('inflects the Romance and Germanic singulars', () => {
    expect(fmtYears(1, 'de')).toBe('1 Jahr')
    expect(fmtYears(2, 'de')).toBe('2 Jahre')
    expect(fmtYears(1, 'fr')).toBe('1 an')
    expect(fmtYears(2, 'fr')).toBe('2 ans')
    expect(fmtYears(1, 'es')).toBe('1 año')
    expect(fmtYears(2, 'es')).toBe('2 años')
    expect(fmtYears(1, 'it')).toBe('1 anno')
    expect(fmtYears(2, 'it')).toBe('2 anni')
    expect(fmtYears(1, 'pt')).toBe('1 ano')
    expect(fmtYears(2, 'pt')).toBe('2 anos')
    expect(fmtYears(2, 'nl')).toBe('2 jaar')
  })

  it('names a year unit in every offered locale, in both singular and plural', () => {
    for (const code of LOCALE_CODES) {
      for (const n of [1, 2, 5]) {
        const out = fmtYears(n, code)
        expect(out.startsWith(`${n} `), `${code}/${n}`).toBe(true)
        expect(out.slice(String(n).length + 1).length, `${code}/${n}`).toBeGreaterThan(0)
      }
    }
  })

  it('falls back to English for a locale with no unit at all', () => {
    expect(fmtYears(5, 'zz')).toBe('5 yrs')
  })
})
