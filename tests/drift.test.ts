/**
 * @vitest-environment jsdom
 *
 * jsdom: richToPlain (used by the number/length heuristics) parses markup via
 * DOMParser, which the default node env lacks.
 */
import { describe, it, expect } from 'vitest'
import { computeDrift, extractNumbers, wordCount, numberDiff } from '../src/lib/drift'
import { emptyStore, makeProject, makeResume } from './fixtures'
import type { ResumeStore } from '../src/types'

describe('extractNumbers()', () => {
  it('pulls digit runs and canonicalizes separators', () => {
    expect(extractNumbers('Led a team of 12 over 3 years, +40% revenue')).toEqual(['12', '3', '40'])
  })
  it('treats 1,000 / 1.000 / 1000 as the same number', () => {
    expect(extractNumbers('1,000')).toEqual(['1000'])
    expect(extractNumbers('1.000')).toEqual(['1000'])
    expect(extractNumbers('1000')).toEqual(['1000'])
  })
  it('strips leading zeros but keeps a lone zero', () => {
    expect(extractNumbers('007 and 0')).toEqual(['0', '7'])
  })
  it('returns a sorted multiset (duplicates preserved)', () => {
    expect(extractNumbers('3 then 3 then 1')).toEqual(['1', '3', '3'])
  })
  it('ignores rich-text markup', () => {
    expect(extractNumbers('<p>Grew it <strong>5</strong>×</p>')).toEqual(['5'])
  })
})

describe('numberDiff()', () => {
  it('is empty when the numbers match', () => {
    expect(numberDiff('3 years, 40%', '40% over 3 år')).toEqual({ onlyA: [], onlyB: [] })
  })
  it('reports a number present on only one side', () => {
    expect(numberDiff('cut costs 40%', 'kuttet kostnader')).toEqual({ onlyA: ['40'], onlyB: [] })
  })
  it('reports the extra element in a long shared list (the NorBAN case)', () => {
    const en = 'events in 2024 2025 2026 2027'
    const no = 'arrangementer i 2024 2025 2026'
    expect(numberDiff(en, no)).toEqual({ onlyA: ['2027'], onlyB: [] })
  })
  it('is multiset-aware — a duplicated number counts', () => {
    expect(numberDiff('3 and 3', 'bare 3')).toEqual({ onlyA: ['3'], onlyB: [] })
  })
})

describe('wordCount()', () => {
  it('counts plain words, collapsing whitespace and markup', () => {
    expect(wordCount('<p>one   two\nthree</p>')).toBe(3)
    expect(wordCount('   ')).toBe(0)
  })
})

/**
 * A store whose ONLY bilingual field is one project's description — the
 * fixtures otherwise default several fields (resume.title, project.customer) to
 * both locales, which would pad comparedFields. Overriding them to a single
 * locale keeps each case about exactly the description under test.
 */
function storeWith(en: string, no: string): ResumeStore {
  return {
    ...emptyStore(),
    resume: makeResume({ title: { en: 'Consultant' }, nationality: {}, place_of_residence: {} }),
    projects: [makeProject({ customer: { en: 'Acme' }, long_description: {}, description: { en, no } })],
  }
}

describe('computeDrift()', () => {
  it('returns nothing when the two versions agree on numbers and length', () => {
    const rep = computeDrift(storeWith('Delivered 3 releases in 2 years', 'Leverte 3 utgivelser på 2 år'), 'en', 'no')
    expect(rep.findings).toHaveLength(0)
    expect(rep.comparedFields).toBe(1)
  })

  it('flags a number mismatch as high severity', () => {
    const rep = computeDrift(storeWith('Led 5 people', 'Ledet 3 personer'), 'en', 'no')
    expect(rep.findings).toHaveLength(1)
    expect(rep.findings[0].kind).toBe('numbers')
    expect(rep.findings[0].severity).toBe('high')
    expect(rep.findings[0].detail).toMatch(/5 only in EN/)
    expect(rep.findings[0].detail).toMatch(/3 only in NO/)
  })

  it('flags a dropped number and names the side it is missing from', () => {
    const rep = computeDrift(storeWith('Cut costs by 40%', 'Kuttet kostnader'), 'en', 'no')
    expect(rep.findings[0].kind).toBe('numbers')
    expect(rep.findings[0].detail).toMatch(/40 only in EN/)
  })

  it('describes only the difference for a many-number field, not both full lists', () => {
    const en = 'Events across 2021 2022 2023 2024 2025 2026 2027'
    const no = 'Arrangementer i 2021 2022 2023 2024 2025 2026'
    const rep = computeDrift(storeWith(en, no), 'en', 'no')
    expect(rep.findings[0].detail).toBe('Numbers differ — 2027 only in EN.')
    // The old behaviour dumped every shared year; the new detail must not.
    expect(rep.findings[0].detail).not.toContain('2021')
  })

  it('does not flag numbers written as words (avoids false positives)', () => {
    const rep = computeDrift(storeWith('Led five people over three years', 'Ledet fem personer over tre år'), 'en', 'no')
    expect(rep.findings).toHaveLength(0)
  })

  it('flags a large length divergence as low severity', () => {
    const long = 'Architected and delivered the entire platform rebuild across many teams and quarters'
    const short = 'Bygde plattformen'
    const rep = computeDrift(storeWith(long, short), 'en', 'no')
    expect(rep.findings).toHaveLength(1)
    expect(rep.findings[0].kind).toBe('length')
    expect(rep.findings[0].severity).toBe('low')
  })

  it('does not flag short fields for length (title-like content)', () => {
    // "Lead Architect" vs "Ledende arkitekt" — below the min-words floor.
    const rep = computeDrift(storeWith('Lead Architect', 'Ledende arkitekt'), 'en', 'no')
    expect(rep.findings).toHaveLength(0)
  })

  it('prefers the number signal over length when both would fire', () => {
    const long = 'Managed 5 people delivering many features across the platform every single quarter'
    const short = 'Ledet 3 personer'
    const rep = computeDrift(storeWith(long, short), 'en', 'no')
    expect(rep.findings).toHaveLength(1)
    expect(rep.findings[0].kind).toBe('numbers')
  })

  it('only compares fields present in BOTH locales', () => {
    // English only — completeness's job, not drift's.
    const rep = computeDrift(storeWith('Led 5 people', ''), 'en', 'no')
    expect(rep.comparedFields).toBe(0)
    expect(rep.findings).toHaveLength(0)
  })

  it('is a no-op when both locales are the same', () => {
    const rep = computeDrift(storeWith('Led 5 people', 'x'), 'en', 'en')
    expect(rep.comparedFields).toBe(0)
    expect(rep.findings).toHaveLength(0)
  })

  it('carries navigation metadata from the tracked field', () => {
    const rep = computeDrift(storeWith('Led 5 people', 'Ledet 3'), 'en', 'no')
    expect(rep.findings[0].meta.section).toBe('projects')
    expect(rep.findings[0].meta.fieldLabel).toBe('Description')
    expect(rep.findings[0].meta.itemId).toBeTruthy()
  })

  it('sorts high-severity findings ahead of low', () => {
    const single = { customer: { en: 'Acme' }, long_description: {} }
    const data: ResumeStore = {
      ...emptyStore(),
      resume: makeResume({ title: { en: 'Consultant' } }),
      projects: [
        makeProject({ id: 'p1', ...single, description: { en: 'Grew revenue 30%', no: 'Økte inntekten' } }), // numbers → high
        makeProject({ id: 'p2', ...single, description: {
          en: 'Delivered the platform rebuild across every team over many quarters of work',
          no: 'Bygde plattformen',
        } }), // length → low
      ],
    }
    const rep = computeDrift(data, 'en', 'no')
    expect(rep.findings.map((f) => f.severity)).toEqual(['high', 'low'])
  })
})
