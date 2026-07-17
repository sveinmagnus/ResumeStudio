/**
 * @vitest-environment jsdom
 *
 * jsdom: the prompt builder flattens rich text via richToPlain (DOMParser).
 */
import { describe, it, expect } from 'vitest'
import {
  WRITING_COACH_SCHEMA, buildCoachPrompt, validateCoachResponse, hasCoachableSource,
  InvalidCoachResponseError,
} from '../src/lib/writingCoach'

describe('hasCoachableSource', () => {
  it('is true when the locale has prose', () => {
    expect(hasCoachableSource({ en: 'Built a thing.' }, 'en')).toBe(true)
  })
  it('is false for a missing locale, empty text, or markup with no words', () => {
    expect(hasCoachableSource({ en: 'x' }, 'no')).toBe(false)
    expect(hasCoachableSource({ en: '   ' }, 'en')).toBe(false)
    expect(hasCoachableSource({ en: '<p></p>' }, 'en')).toBe(false)
  })
})

describe('buildCoachPrompt', () => {
  it('flattens rich text so the model never sees markup to echo back', () => {
    const prompt = buildCoachPrompt({ en: '<p>Led the <strong>migration</strong></p>' }, 'en')
    expect(prompt).toContain('Led the migration')
    expect(prompt).not.toContain('<strong>')
  })

  it('asks for the schema and both halves of the answer', () => {
    const prompt = buildCoachPrompt({ en: 'Some prose' }, 'en')
    expect(prompt).toContain(WRITING_COACH_SCHEMA)
    expect(prompt).toContain('"rewrite"')
    expect(prompt).toContain('"asks"')
  })

  it('forbids invention in the strongest terms — the whole point of the split', () => {
    // If this instruction ever softens, the assist starts fabricating metrics
    // onto a CV the user then has to defend. Pin it.
    const prompt = buildCoachPrompt({ en: 'Helped improve performance' }, 'en')
    expect(prompt).toMatch(/use ONLY facts that appear in the text/i)
    expect(prompt).toMatch(/do not add[\s\S]*numbers/i)
    expect(prompt).toMatch(/never guess/i)
  })

  it('pins the source language so a rewrite is not a translation', () => {
    expect(buildCoachPrompt({ no: 'Bygde en løsning' }, 'no')).toMatch(/SAME LANGUAGE/i)
  })

  it('caps a huge source rather than shipping a document', () => {
    const prompt = buildCoachPrompt({ en: 'x'.repeat(20_000) }, 'en')
    expect(prompt.length).toBeLessThan(10_000)
  })

  it('does not throw on an empty locale (the button is what gates this)', () => {
    expect(() => buildCoachPrompt({}, 'en')).not.toThrow()
  })
})

describe('validateCoachResponse', () => {
  it('reads a full reply', () => {
    const res = validateCoachResponse({
      $schema: WRITING_COACH_SCHEMA,
      rewrite: 'Led the migration of 12 services.',
      asks: ['What was the team size?', 'What did it save?'],
    })
    expect(res.rewrite).toBe('Led the migration of 12 services.')
    expect(res.asks).toEqual(['What was the team size?', 'What did it save?'])
  })

  it('treats a missing or empty asks list as "nothing missing"', () => {
    expect(validateCoachResponse({ rewrite: 'Fine as is.' }).asks).toEqual([])
    expect(validateCoachResponse({ rewrite: 'Fine.', asks: [] }).asks).toEqual([])
  })

  it('drops junk entries from asks and caps the list', () => {
    const res = validateCoachResponse({
      rewrite: 'Text',
      asks: ['Real question?', '', '   ', 42, null, 'Another?', 'a', 'b', 'c', 'd', 'e'],
    })
    expect(res.asks.length).toBeLessThanOrEqual(6)
    expect(res.asks).not.toContain('')
    expect(res.asks[0]).toBe('Real question?')
  })

  it('throws when there is no usable rewrite', () => {
    expect(() => validateCoachResponse({ asks: ['x'] })).toThrow(InvalidCoachResponseError)
    expect(() => validateCoachResponse({ rewrite: '   ' })).toThrow(InvalidCoachResponseError)
    expect(() => validateCoachResponse('a string')).toThrow(InvalidCoachResponseError)
    expect(() => validateCoachResponse(null)).toThrow(InvalidCoachResponseError)
  })
})
