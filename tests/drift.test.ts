/**
 * @vitest-environment jsdom
 *
 * jsdom: richToPlain (used by the number/length heuristics) parses markup via
 * DOMParser, which the default node env lacks.
 */
import { describe, it, expect } from 'vitest'
import { computeDrift, extractNumbers, wordCount, numberDiff, driftDismissKey } from '../src/lib/drift'
import { emptyStore, makeProject, makeResume, makeEducation, makeKQ } from './fixtures'
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
    // Salient values (3+ digits) so the count mechanism is what's under test,
    // not the one-sided small-integer suppression added below.
    expect(numberDiff('100 and 100', 'bare 100')).toEqual({ onlyA: ['100'], onlyB: [] })
  })

  it('does NOT flag a bare small number spelled out as a word on the other side', () => {
    // The reported false positive: "6" ⇄ "seks"/"six" is the same content in a
    // different notation. A one-sided bare 1–2 digit integer is suppressed.
    expect(numberDiff('Led 6 people', 'Ledet seks personer')).toEqual({ onlyA: [], onlyB: [] })
    expect(numberDiff('3 teams', 'tre team')).toEqual({ onlyA: [], onlyB: [] })
    // Ordinal-as-word too: "6." (numeric) ⇄ "sixth" (word).
    expect(numberDiff('6. plass', 'sixth place')).toEqual({ onlyA: [], onlyB: [] })
  })

  it('does NOT flag a one-sided number embedded in a name/token (S3, 3D)', () => {
    // The digit is part of a product name, not a metric — suppress when it only
    // appears on one side (both-sided "3D" ⇄ "3D" already matched).
    expect(numberDiff('Hosted on AWS S3', 'Lagret i skyen')).toEqual({ onlyA: [], onlyB: [] })
  })

  it('STILL flags salient one-sided numbers (percent, decimal, 3+ digit, year)', () => {
    expect(numberDiff('cut costs 40%', 'kuttet kostnader')).toEqual({ onlyA: ['40'], onlyB: [] })
    expect(numberDiff('grew 3.5x', 'vokste')).toEqual({ onlyA: ['35'], onlyB: [] })
    expect(numberDiff('1200 users', 'brukere')).toEqual({ onlyA: ['1200'], onlyB: [] })
    expect(numberDiff('shipped in 2024', 'levert')).toEqual({ onlyA: ['2024'], onlyB: [] })
  })

  it('STILL flags numbers that genuinely differ, even when small (both sides)', () => {
    // Both sides carry a number and they disagree → a real discrepancy.
    expect(numberDiff('Led 5 people', 'Ledet 3 personer')).toEqual({ onlyA: ['5'], onlyB: ['3'] })
  })

  it('reads a percent sign only where it actually follows the number', () => {
    // "40 %" with a space is the Norwegian convention and still salient; a %
    // somewhere later in the sentence must not make a bare 5 salient.
    expect(numberDiff('cut costs 40 %', 'kuttet kostnader')).toEqual({ onlyA: ['40'], onlyB: [] })
    expect(numberDiff('5 people, all % of the team', 'personer')).toEqual({ onlyA: [], onlyB: [] })
  })

  it('reports both sides in a stable order when each has extras', () => {
    // The panel lists these; unsorted, the same disagreement reads differently
    // depending on the order the sentence happened to use.
    expect(numberDiff('300 and 200 and 7', 'Ledet 900 og 800 og 7'))
      .toEqual({ onlyA: ['200', '300'], onlyB: ['800', '900'] })
  })
})

describe('wordCount()', () => {
  it('counts plain words, collapsing whitespace and markup', () => {
    expect(wordCount('<p>one   two\nthree</p>')).toBe(3)
    expect(wordCount('   ')).toBe(0)
  })
})

/**
 * A store whose ONLY bilingual field is one project's text field — the fixtures
 * otherwise default several fields (resume.title, project.customer) to both
 * locales, which would pad comparedFields. Overriding them to a single locale
 * keeps each case about exactly the field under test.
 *
 * `prose` picks WHICH field: `long_description` (a PROSE field, the only kind
 * the LENGTH heuristic applies to) when true, else the short one-line
 * `description`. Number/metadata cases don't care (numbers fire on any field);
 * length cases must use prose.
 */
function storeWith(en: string, no: string, prose = false): ResumeStore {
  const text = prose
    ? { long_description: { en, no }, description: {} }
    : { long_description: {}, description: { en, no } }
  return {
    ...emptyStore(),
    resume: makeResume({ title: { en: 'Consultant' }, nationality: {}, place_of_residence: {} }),
    projects: [makeProject({ customer: { en: 'Acme' }, ...text })],
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

  it('flags a large length divergence as low severity (prose only)', () => {
    const long = 'Architected and delivered the entire platform rebuild across many teams and quarters'
    const short = 'Bygde plattformen'
    const rep = computeDrift(storeWith(long, short, true), 'en', 'no')
    expect(rep.findings).toHaveLength(1)
    expect(rep.findings[0].kind).toBe('length')
    expect(rep.findings[0].severity).toBe('low')
  })

  it('does not flag short PROSE for length (below the min-words floor)', () => {
    // "Lead Architect" vs "Ledende arkitekt" — prose field, but below the floor.
    const rep = computeDrift(storeWith('Lead Architect', 'Ledende arkitekt', true), 'en', 'no')
    expect(rep.findings).toHaveLength(0)
  })

  it('never flags length on SHORT STRUCTURED fields, even when word counts diverge wildly', () => {
    // The reported bug: a Norwegian degree/school is a terse compound word or
    // abbreviation while English spells it out — a 6× word-count gap that is not
    // drift. School/degree are non-prose, so length is skipped entirely.
    const data: ResumeStore = {
      ...emptyStore(),
      resume: makeResume({ title: { en: 'Consultant' }, nationality: {}, place_of_residence: {} }),
      educations: [makeEducation({
        school: { en: 'Norwegian University of Science and Technology', no: 'NTNU' },
        degree: { en: 'Master of Science in Computer Engineering', no: 'Sivilingeniør' },
      })],
    }
    const rep = computeDrift(data, 'en', 'no')
    expect(rep.findings.filter((f) => f.kind === 'length')).toHaveLength(0)
  })

  it('prefers the number signal over length when both would fire', () => {
    const long = 'Managed 5 people delivering many features across the platform every single quarter'
    const short = 'Ledet 3 personer'
    const rep = computeDrift(storeWith(long, short, true), 'en', 'no')
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
    const data: ResumeStore = {
      ...emptyStore(),
      resume: makeResume({ title: { en: 'Consultant' } }),
      projects: [
        // numbers → high (on the short description field)
        makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: {}, description: { en: 'Grew revenue 30%', no: 'Økte inntekten' } }),
        // length → low (must be a PROSE field, so long_description)
        makeProject({ id: 'p2', customer: { en: 'Acme' }, description: {}, long_description: {
          en: 'Delivered the platform rebuild across every team over many quarters of work',
          no: 'Bygde plattformen',
        } }),
      ],
    }
    const rep = computeDrift(data, 'en', 'no')
    expect(rep.findings.map((f) => f.severity)).toEqual(['high', 'low'])
  })

  it('carries a dismissKey keyed by field AND kind', () => {
    const rep = computeDrift(storeWith('Led 5 people', 'Ledet 3'), 'en', 'no')
    const f = rep.findings[0]
    expect(f.dismissKey).toBe(driftDismissKey(f.meta, f.kind))
    expect(f.dismissKey).toContain('numbers')
  })

  it('omits a finding the user has permanently ignored', () => {
    const store = storeWith('Led 5 people', 'Ledet 3')
    const key = computeDrift(store, 'en', 'no').findings[0].dismissKey
    // With that key in the dismissed set, the finding is gone…
    const after = computeDrift(store, 'en', 'no', [key])
    expect(after.findings).toHaveLength(0)
    // …but the field was still compared (the count reflects the pool, not the
    // hidden finding).
    expect(after.comparedFields).toBe(1)
  })

  it('only silences the ignored KIND, not another kind on the same field', () => {
    // Ignore a hypothetical "length" key; the real "numbers" finding still shows.
    const store = storeWith('Led 5 people', 'Ledet 3')
    const numbersKey = computeDrift(store, 'en', 'no').findings[0].dismissKey
    const lengthKey = numbersKey.replace(/:numbers$/, ':length')
    const after = computeDrift(store, 'en', 'no', [lengthKey])
    expect(after.findings).toHaveLength(1)
    expect(after.findings[0].kind).toBe('numbers')
  })
})
/**
 * drift's length signal — 8 mutants, none killed.
 *
 * It flags one language column saying materially more than the other. Both
 * thresholds exist to stop it firing on things that are not drift: short
 * identity fields differ in word count for grammatical reasons, and a ratio
 * below 2 is ordinary translation expansion.
 */
describe('drift — the length signal', () => {
  const store = (en: string, no: string): ResumeStore => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p1', customer: {}, description: {}, long_description: { en, no } })]
    return s
  }
  const words = (n: number, w = 'word') => Array(n).fill(w).join(' ')
  const findings = (en: string, no: string) => computeDrift(store(en, no), 'en', 'no').findings

  it('flags a column saying twice as much as the other', () => {
    expect(findings(words(12), words(6)).length).toBeGreaterThan(0)
  })

  it('stays quiet below the 2x ratio', () => {
    // Ordinary translation expansion, not drift.
    expect(findings(words(11), words(6))).toEqual([])
  })

  it('stays quiet on SHORT fields whatever the ratio', () => {
    // "Lead Architect" ⇄ "Ledende arkitekt" — neither side reaches the minimum,
    // and word counts differ there for grammatical reasons, not editorial ones.
    expect(findings(words(5), words(1))).toEqual([])
  })

  it('fires at the boundary, in both directions', () => {
    expect(findings(words(6), words(3)).length).toBeGreaterThan(0)
    expect(findings(words(3), words(6)).length).toBeGreaterThan(0)
  })

  it('says nothing when only one side has content', () => {
    // A missing translation is a different report; this one compares what is
    // there against what is there.
    expect(findings(words(20), '')).toEqual([])
  })
})

describe('computeDrift — the both-sides-present gate', () => {
  // One tracked field only: a single-locale title and customer are skipped by
  // the same gate under test, so comparedFields counts the description alone.
  const withDesc = (en: string | undefined, no: string | undefined): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ supported_locales: ['en', 'no'], title: { en: 'Consultant' } })
    const ls: Record<string, string> = {}
    if (en !== undefined) ls.en = en
    if (no !== undefined) ls.no = no
    s.projects = [makeProject({ customer: { en: 'Acme' }, description: {}, long_description: ls })]
    return s
  }

  it('compares a field only when BOTH locales hold real text', () => {
    expect(computeDrift(withDesc('<p>Ran 3 teams</p>', '<p>Ledet 3 team</p>'), 'en', 'no').comparedFields).toBe(1)
  })

  it('skips a field missing on either side — that is completeness’s job', () => {
    expect(computeDrift(withDesc('<p>Ran 3 teams</p>', undefined), 'en', 'no').comparedFields).toBe(0)
    expect(computeDrift(withDesc(undefined, '<p>Ledet 3 team</p>'), 'en', 'no').comparedFields).toBe(0)
  })

  it('skips a side whose markup carries no TEXT, not just no value', () => {
    // '<p>   </p>' is a non-empty string, so only the trimmed plain text can
    // tell it apart from real content.
    expect(computeDrift(withDesc('<p>Ran 3 teams</p>', '<p>   </p>'), 'en', 'no').comparedFields).toBe(0)
    expect(computeDrift(withDesc('<p> </p>', '<p>Ledet 3 team</p>'), 'en', 'no').comparedFields).toBe(0)
  })
})

describe('computeDrift — finding order and number phrasing', () => {
  const oneField = (en: string, no: string): ReturnType<typeof computeDrift> => {
    const s = emptyStore()
    s.resume = makeResume({ supported_locales: ['en', 'no'], title: { en: 'Consultant' } })
    s.projects = [makeProject({ customer: { en: 'Acme' }, description: {}, long_description: { en: en, no: no } })]
    return computeDrift(s, 'en', 'no')
  }

  it('puts every HIGH finding before every LOW one, whatever the section order', () => {
    const s = emptyStore()
    s.resume = makeResume({ supported_locales: ['en', 'no'], title: { en: 'Consultant' } })
    // A length gap on the FIRST-walked section, a number mismatch on the later one.
    s.key_qualifications = [makeKQ({
      summary: {
        en: '<p>one two three four five six seven eight nine ten eleven twelve</p>',
        no: '<p>kort</p>',
      },
    })]
    s.projects = [makeProject({
      customer: { en: 'Acme' }, description: {},
      long_description: { en: '<p>Graduated 2019</p>', no: '<p>Fullførte 2020</p>' },
    })]
    const { findings } = computeDrift(s, 'en', 'no')
    expect(findings.map((f) => f.severity)).toEqual(['high', 'low'])
    expect(findings[0].kind).toBe('numbers')
  })

  it('orders two findings of the SAME severity by section', () => {
    // The comparator falls through to the section name; without that step the
    // two rows come out in whichever order the walk produced.
    const s = emptyStore()
    s.resume = makeResume({ supported_locales: ['en', 'no'], title: { en: 'Consultant' } })
    // Both findings are HIGH, so only the section step can separate them.
    s.projects = [makeProject({ customer: { en: 'Acme' }, description: {}, long_description: { en: '<p>2019</p>', no: '<p>2020</p>' } })]
    s.key_qualifications = [makeKQ({ summary: { en: '<p>2021</p>', no: '<p>2022</p>' } })]
    const { findings } = computeDrift(s, 'en', 'no')
    expect(findings.map((f) => f.severity)).toEqual(['high', 'high'])
    expect(findings.map((f) => f.meta.section)).toEqual(['key_qualifications', 'projects'])
  })

  it('names only the side that actually has the extra numbers', () => {
    const detail = oneField('<p>Ran it</p>', '<p>Ledet fra 2019</p>').findings[0].detail
    expect(detail).toContain('2019 only in NO')
    expect(detail).not.toContain('only in EN')
  })

  it('lists up to four numbers in full, then counts the remainder', () => {
    // Exactly four unique-to-EN numbers: all shown, no tail.
    const four = oneField('<p>2019 2020 2021 2022</p>', '<p>ingen</p>').findings[0].detail
    expect(four).toContain('2019, 2020, 2021, 2022 only in EN')
    expect(four).not.toContain('more')
    // Six: four shown and the count of what was dropped.
    expect(oneField('<p>2019 2020 2021 2022 2023 2024</p>', '<p>ingen</p>').findings[0].detail)
      .toContain('2019, 2020, 2021, 2022, +2 more only in EN')
  })
})
