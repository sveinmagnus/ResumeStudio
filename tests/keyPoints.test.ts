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

describe('validateKeyPoints — the shapes a model actually returns', () => {
  it('names what was wrong: not an object, versus no points array', () => {
    // Two different repairs for the user, so the two messages must differ.
    expect(() => validateKeyPoints('a string')).toThrow(/not a JSON object/)
    expect(() => validateKeyPoints(null)).toThrow(/not a JSON object/)
    expect(() => validateKeyPoints({ result: [] })).toThrow(/no "points" array/)
  })

  it('trims a plain-string point rather than carrying the model’s padding', () => {
    expect(validateKeyPoints({ points: ['  Led the migration  '] }))
      .toEqual([{ label: '', body: 'Led the migration' }])
  })

  it('trims a label as well as a body', () => {
    expect(validateKeyPoints({ points: [{ label: '  Scale  ', body: '  Ran it  ' }] }))
      .toEqual([{ label: 'Scale', body: 'Ran it' }])
  })

  it('skips a null or primitive entry among good ones instead of throwing', () => {
    expect(validateKeyPoints({ points: [null, 42, { body: 'Real point' }] }))
      .toEqual([{ label: '', body: 'Real point' }])
  })

  it('drops a whitespace-only body — a bullet with nothing in it', () => {
    expect(() => validateKeyPoints({ points: [{ body: '   ' }] })).toThrow(/no points/)
  })
})

describe('key points — the source text and the reply shapes', () => {
  it('trims the flattened source before quoting it in the prompt', () => {
    const prompt = buildKeyPointsPrompt({ en: '<p>  Ran the rebuild.  </p>' }, 'en', 'highlights')
    expect(prompt).toContain('Ran the rebuild.')
    expect(prompt).not.toContain(' Ran the rebuild. ')
  })

  it('reads a bare string entry as a point with no label', () => {
    // Small models answer with a list of strings however the shape is asked
    // for; refusing them would throw away a usable reply.
    const out = validateKeyPoints({ points: ['One line.', { body: 'Another.' }] })
    expect(out).toEqual([
      { label: '', body: 'One line.' },
      { label: '', body: 'Another.' },
    ])
  })

  it('drops an entry that is neither a string nor an object', () => {
    const out = validateKeyPoints({ points: [42, null, true, { body: 'Kept.' }] })
    expect(out).toEqual([{ label: '', body: 'Kept.' }])
  })
})

describe('buildKeyPointsPrompt — the source it shows the model', () => {
  it('trims the flattened source rather than carrying its padding', () => {
    // The source is interpolated straight into the prompt; leading blank lines
    // push the instruction away from the text it applies to, which is exactly
    // what a small model loses track of.
    const prompt = buildKeyPointsPrompt({ en: '   Ran the platform rebuild.   ' }, 'en', 'highlights')
    expect(prompt).toContain('Ran the platform rebuild.')
    expect(prompt).not.toContain('   Ran the platform rebuild.')
  })

  it('reads the requested locale, not whichever slot is filled', () => {
    const prompt = buildKeyPointsPrompt({ en: 'English text.', no: 'Norsk tekst.' }, 'no', 'highlights')
    expect(prompt).toContain('Norsk tekst.')
    expect(prompt).not.toContain('English text.')
  })
})
