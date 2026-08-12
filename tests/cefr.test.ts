import { describe, it, expect } from 'vitest'
import {
  cefrSummary, cefrGrouped, hasCefr, cefrLines,
  CEFR_CATEGORIES, CEFR_GROUPS, CEFR_LEVELS, CEFR_LEVEL_DESC,
} from '../src/lib/cefr'
import { LOCALE_CODES } from '../src/lib/locales'

describe('cefrSummary()', () => {
  it('collapses to a single level when all five categories match', () => {
    expect(cefrSummary({
      listening: 'B2', reading: 'B2', spoken_interaction: 'B2', spoken_production: 'B2', writing: 'B2',
    })).toBe('B2')
  })

  it('groups categories by level (deduped) in level order', () => {
    expect(cefrSummary({ listening: 'B2', reading: 'B2', writing: 'C1' }))
      .toBe('B2 (Listening, Reading) · C1 (Writing)')
  })

  /**
   * A bare "B2" claims all five categories. When only two are filled in, the
   * summary has to say which — otherwise a half-finished entry reads as a
   * complete assessment.
   */
  it('spells out which categories a lone level covers when not all are set', () => {
    expect(cefrSummary({ listening: 'B2', reading: 'B2' })).toBe('B2 (Listening, Reading)')
    expect(cefrSummary({ writing: 'C1' })).toBe('C1 (Writing)')
  })

  it('is empty for no set levels', () => {
    expect(cefrSummary(undefined)).toBe('')
    expect(cefrSummary({})).toBe('')
    expect(hasCefr({})).toBe(false)
    expect(hasCefr({ reading: 'A1' })).toBe(true)
  })
})

describe('cefrGrouped()', () => {
  it('orders groups by level and keeps category order', () => {
    expect(cefrGrouped({ writing: 'C1', listening: 'B2', reading: 'B2' })).toEqual([
      { level: 'B2', categories: ['Listening', 'Reading'] },
      { level: 'C1', categories: ['Writing'] },
    ])
  })
})

describe('cefrLines()', () => {
  it('is a single unlabelled value when every category matches', () => {
    expect(cefrLines({
      listening: 'B2', reading: 'B2', spoken_interaction: 'B2', spoken_production: 'B2', writing: 'B2',
    })).toEqual(['B2'])
  })

  it('splits into understanding / spoken / written lines when they differ', () => {
    expect(cefrLines({
      listening: 'B2', reading: 'B2',
      spoken_interaction: 'B2', spoken_production: 'B2',
      writing: 'C1',
    })).toEqual(['Understanding: B2', 'Spoken: B2', 'Written: C1'])
  })

  it('spells out a group whose own categories disagree', () => {
    expect(cefrLines({
      listening: 'B1', reading: 'B2',
      writing: 'C1',
    })).toEqual(['Understanding: B1 (Listening) · B2 (Reading)', 'Written: C1'])
  })

  it('omits a group with nothing set rather than showing it blank', () => {
    expect(cefrLines({ listening: 'B1', writing: 'C2' }))
      .toEqual(['Understanding: B1', 'Written: C2'])
  })

  it('is empty when nothing is set', () => {
    expect(cefrLines(undefined)).toEqual([])
    expect(cefrLines({})).toEqual([])
  })

  it('collapses to one value even when only some categories are set', () => {
    // Two categories, same level — still nothing to distinguish.
    expect(cefrLines({ listening: 'A2', writing: 'A2' })).toEqual(['A2'])
  })
})

describe('the CEFR label tables cover every offered locale', () => {
  /**
   * A missing label renders as a blank column heading in the Europass export,
   * which is why the locale set is asserted against LOCALE_CODES rather than a
   * copy of the list.
   */
  it('names each of the five assessed categories in every locale', () => {
    expect(CEFR_CATEGORIES).toHaveLength(5)
    for (const c of CEFR_CATEGORIES) {
      expect(c.key).toBeTruthy()
      expect(c.label).toBeTruthy()
      for (const code of LOCALE_CODES) expect(c.labels[code], `${c.key}/${code}`).toBeTruthy()
    }
  })

  it('names each of the three Europass groups in every locale', () => {
    expect(CEFR_GROUPS.map((g) => g.keys.flat())).toEqual([
      ['listening', 'reading'],
      ['spoken_interaction', 'spoken_production'],
      ['writing'],
    ])
    for (const g of CEFR_GROUPS) {
      expect(g.label).toBeTruthy()
      for (const code of LOCALE_CODES) expect(g.labels[code], `${g.label}/${code}`).toBeTruthy()
    }
  })

  it('covers all five categories across the three groups, without overlap', () => {
    const keys = CEFR_GROUPS.flatMap((g) => g.keys)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.sort()).toEqual(CEFR_CATEGORIES.map((c) => c.key).sort())
  })

  it('describes every level', () => {
    for (const level of CEFR_LEVELS) expect(CEFR_LEVEL_DESC[level], level).toBeTruthy()
  })
})

describe('cefrSummary — the collapse rule', () => {
  const all = (level: string) => Object.fromEntries(CEFR_CATEGORIES.map((c) => [c.key, level]))

  it('collapses to a bare level only when EVERY category is set to it', () => {
    expect(cefrSummary(all('B2') as never)).toBe('B2')
  })

  it('keeps the category list when one level covers only some categories', () => {
    // Same single level, but two of five set: the reader must not read it as
    // "B2 in everything".
    expect(cefrSummary({ listening: 'B2', reading: 'B2' } as never)).toBe('B2 (Listening, Reading)')
  })

  it('joins several levels in level order', () => {
    const out = cefrSummary({ listening: 'C1', reading: 'B2', writing: 'B2' } as never)
    expect(out).toBe('B2 (Reading, Writing) · C1 (Listening)')
  })

  it('is empty for nothing set at all', () => {
    expect(cefrSummary(undefined)).toBe('')
    expect(cefrSummary({} as never)).toBe('')
  })
})

describe('cefrSummary — a full grid at mixed levels', () => {
  it('does not collapse to one level just because every category is set', () => {
    // All five set, but at two levels: reporting the first level alone would
    // claim a competence the CV does not.
    expect(cefrSummary({
      listening: 'C1', reading: 'C1', spoken_interaction: 'B2',
      spoken_production: 'B2', writing: 'B2',
    })).toBe('B2 (Spoken interaction, Spoken production, Writing) \u00b7 C1 (Listening, Reading)')
  })
})
