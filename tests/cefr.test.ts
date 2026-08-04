import { describe, it, expect } from 'vitest'
import { cefrSummary, cefrGrouped, hasCefr, cefrLines } from '../src/lib/cefr'

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
