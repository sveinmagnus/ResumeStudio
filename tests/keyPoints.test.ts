/**
 * @vitest-environment jsdom
 *
 * jsdom: the prompt builder flattens rich text via richToPlain (DOMParser).
 */
import { describe, it, expect } from 'vitest'
import {
  buildKeyPointsPrompt, validateKeyPoints, toHighlights,
  InvalidKeyPointsError, KEY_POINTS_SCHEMA,
} from '../src/lib/keyPoints'

const src = { en: '<p>Led a team of five. Cut build times by 40%.</p>' }

describe('buildKeyPointsPrompt()', () => {
  it('includes the flattened source and the schema', () => {
    const p = buildKeyPointsPrompt(src, 'en', 'highlights')
    expect(p).toContain('Led a team of five.')
    expect(p).not.toContain('<p>')
    expect(p).toContain(KEY_POINTS_SCHEMA)
  })

  it('forbids invention in the strongest terms — this is reshaping, not writing', () => {
    const p = buildKeyPointsPrompt(src, 'en', 'highlights')
    expect(p).toMatch(/never add, infer or embellish/i)
    expect(p).toMatch(/reshaping, not rewriting/i)
  })

  it('asks for labels only in the labelled style', () => {
    expect(buildKeyPointsPrompt(src, 'en', 'labelled')).toMatch(/1–3 word label/i)
    expect(buildKeyPointsPrompt(src, 'en', 'highlights')).toMatch(/no labels/i)
  })

  it('shows the reply SHAPE that matches the style, not just the instruction', () => {
    // The example JSON is what a small model actually copies; a labelled run
    // whose example has no "label" key comes back unlabelled however firmly
    // the prose asked.
    const labelled = buildKeyPointsPrompt(src, 'en', 'labelled')
    expect(labelled).toContain('"label":')
    expect(labelled).toContain('"body":')

    const highlights = buildKeyPointsPrompt(src, 'en', 'highlights')
    expect(highlights).toContain('"body":')
    expect(highlights).not.toContain('"label":')
  })

  it('flattens the source rather than sending markup, and trims it', () => {
    const padded = { en: '  <p>Led a team of <strong>five</strong>.</p>  ' }
    const p = buildKeyPointsPrompt(padded, 'en', 'highlights')
    expect(p).toContain('Led a team of five.')
    expect(p).not.toContain('<strong>')
    expect(p).not.toMatch(/\n\s+Led a team/)
  })

  it('keeps the source language rather than defaulting to English', () => {
    expect(buildKeyPointsPrompt(src, 'en', 'highlights')).toMatch(/same language as the source/i)
  })

  it('handles an empty source without throwing', () => {
    expect(buildKeyPointsPrompt({}, 'en', 'highlights')).toContain('(empty)')
  })
})

describe('validateKeyPoints()', () => {
  it('accepts labelled points', () => {
    expect(validateKeyPoints({ points: [{ label: 'Leadership', body: 'Led five people.' }] }))
      .toEqual([{ label: 'Leadership', body: 'Led five people.' }])
  })

  it('accepts body-only points', () => {
    expect(validateKeyPoints({ points: [{ body: 'Cut build times.' }] }))
      .toEqual([{ label: '', body: 'Cut build times.' }])
  })

  it('accepts a plain string list — models drop the object shape', () => {
    expect(validateKeyPoints({ points: ['Did a thing'] })).toEqual([{ label: '', body: 'Did a thing' }])
  })

  it('drops entries with no body', () => {
    expect(validateKeyPoints({ points: [{ label: 'x' }, { body: '  ' }, { body: 'Real' }] }))
      .toEqual([{ label: '', body: 'Real' }])
  })

  it('rejects a malformed reply', () => {
    expect(() => validateKeyPoints({})).toThrow(InvalidKeyPointsError)
    expect(() => validateKeyPoints('nope')).toThrow(InvalidKeyPointsError)
  })

  it('rejects an empty list rather than reporting success with nothing', () => {
    expect(() => validateKeyPoints({ points: [] })).toThrow(InvalidKeyPointsError)
  })
})

describe('toHighlights()', () => {
  it('writes into the primary locale only', () => {
    // The source was one locale's prose — anything else would be an unasked-for
    // translation; the Draft-translation path owns that.
    expect(toHighlights([{ label: '', body: 'Cut build times.' }], 'no'))
      .toEqual([{ no: 'Cut build times.' }])
  })

  it('keeps a label by folding it into the line', () => {
    expect(toHighlights([{ label: 'Speed', body: 'Cut build times.' }], 'en'))
      .toEqual([{ en: 'Speed: Cut build times.' }])
  })
})
