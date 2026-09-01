/**
 * @vitest-environment jsdom
 *
 * jsdom: the prompt builder flattens rich text via richToPlain (DOMParser).
 */
import { describe, it, expect } from 'vitest'
import {
  WRITING_COACH_SCHEMA, buildCoachPrompt, validateCoachResponse, hasCoachableSource,
  hasDraftableFacts, isUnchangedRewrite,
  InvalidCoachResponseError,
  buildDraftPrompt,
} from '../src/lib/writingCoach'
import type { LocalizedString } from '../src/types'

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
    // Named concretely: `toContain(CONST)` passes for an emptied constant,
    // and the schema id is the contract the reply is read against.
    expect(WRITING_COACH_SCHEMA).toBe('resumestudio-rewrite/v1')
    expect(prompt).toContain('resumestudio-rewrite/v1')
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

  it("carries the entry's structured fields, so the model knows what is already shown", () => {
    // The reported failure this pins: shown only a course description, the
    // model asked "when was it completed?" and "which certification was
    // obtained?" — answers that live in the date and name fields beside it.
    const facts = ['Course: Project management', 'Programme: Metier Academy', 'Dates: 2019 → 2021']
    const prompt = buildCoachPrompt({ en: 'Accredited part-time study.' }, 'en', facts)
    expect(prompt).toContain('Course: Project management')
    expect(prompt).toContain('Dates: 2019 → 2021')
    expect(prompt).toMatch(/restat/i)
  })

  it('omits the facts block entirely when there are none', () => {
    expect(buildCoachPrompt({ en: 'Prose.' }, 'en')).not.toMatch(/FROM ITS OWN FIELDS/)
    expect(buildCoachPrompt({ en: 'Prose.' }, 'en', [])).not.toMatch(/FROM ITS OWN FIELDS/)
  })

  it('bans asks about facts that have dedicated fields', () => {
    // Even with no facts supplied (or the fields still empty), a question
    // about a date or credential belongs in those fields, not the description.
    const prompt = buildCoachPrompt({ en: 'Some prose' }, 'en')
    expect(prompt).toMatch(/NEVER ask for dates/i)
    expect(prompt).toMatch(/dedicated fields/i)
  })

  it('names "return it unchanged" as the honest answer to good text', () => {
    // Without this, a model with nothing to improve reshuffles words to have
    // something to show — a cosmetic reword the person still has to review.
    expect(buildCoachPrompt({ en: 'Some prose' }, 'en')).toMatch(/return it UNCHANGED/)
  })

  it('says the description is empty rather than handing over a blank', () => {
    // A prompt that ends "--- DESCRIPTION ---" with nothing under it reads as
    // a truncated message, and a model asked to rewrite nothing invents.
    const sources: LocalizedString[] = [{}, { en: '' }, { en: '<p></p>' }, { no: 'Norsk' }]
    for (const source of sources) {
      expect(buildCoachPrompt(source, 'en')).toContain('(empty)')
    }
    expect(buildCoachPrompt({ en: 'Real prose.' }, 'en')).not.toContain('(empty)')
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
    // The whole list, not its first entry and its length: a non-string coerced
    // to anything truthy survives the filter and fills the cap with rubbish,
    // pushing the real questions out.
    expect(res.asks).toEqual(['Real question?', 'Another?', 'a', 'b', 'c', 'd'])
  })

  it('trims each ask, and keeps exactly six when more are offered', () => {
    // The panel renders these as buttons; padded text misaligns them, and an
    // uncapped list turns a review into a questionnaire.
    const res = validateCoachResponse({
      rewrite: 'Text',
      asks: ['  Padded?  ', 'b?', 'c?', 'd?', 'e?', 'f?', 'g?', 'h?'],
    })
    expect(res.asks[0]).toBe('Padded?')
    expect(res.asks).toHaveLength(6)
    expect(res.asks).not.toContain('g?')
  })

  it('refuses a reply that is not an object at all', () => {
    expect(() => validateCoachResponse(null)).toThrow(InvalidCoachResponseError)
    expect(() => validateCoachResponse('Led the migration.')).toThrow(InvalidCoachResponseError)
  })

  it('throws when there is no usable rewrite', () => {
    expect(() => validateCoachResponse({ asks: ['x'] })).toThrow(InvalidCoachResponseError)
    expect(() => validateCoachResponse({ rewrite: '   ' })).toThrow(InvalidCoachResponseError)
    expect(() => validateCoachResponse('a string')).toThrow(InvalidCoachResponseError)
    expect(() => validateCoachResponse(null)).toThrow(InvalidCoachResponseError)
  })
})

describe('isUnchangedRewrite', () => {
  it('recognises a verbatim return, ignoring whitespace differences', () => {
    // The source was flattened from rich text, so the reply's line breaks are
    // the model's own — they must not make "unchanged" read as a rewrite.
    expect(isUnchangedRewrite('Led the work.', 'Led the work.')).toBe(true)
    expect(isUnchangedRewrite('Led  the\nwork.', 'Led the work.')).toBe(true)
    expect(isUnchangedRewrite('  Led the work.  ', 'Led the work.')).toBe(true)
  })

  it('any wording change is a rewrite', () => {
    expect(isUnchangedRewrite('Led the work', 'Led the work.')).toBe(false)
    expect(isUnchangedRewrite('Drove the work.', 'Led the work.')).toBe(false)
  })
})

describe('hasDraftableFacts()', () => {
  it('needs at least one fact to draft FROM', () => {
    // Drafting from a blank card would be pure invention, which is the one
    // thing every assist is forbidden to do (§15).
    expect(hasDraftableFacts([])).toBe(false)
    expect(hasDraftableFacts(['Customer: Acme'])).toBe(true)
  })
})

describe('buildDraftPrompt — the empty-entry starting point', () => {
  const prompt = () => buildDraftPrompt(['Customer: Statoil', 'Project: Platform rebuild'], 'Projects', 'en')

  it('names the section and frames the answer as a starting point, not a finished entry', () => {
    expect(prompt()).toContain('"Projects"')
    expect(prompt()).toMatch(/STARTING POINT/)
  })

  it('sends the identity facts it was given', () => {
    expect(prompt()).toContain('Customer: Statoil')
    expect(prompt()).toContain('Project: Platform rebuild')
  })

  it('asks for both halves of the answer', () => {
    const p = prompt()
    expect(p).toContain('"rewrite"')
    expect(p).toContain('"asks"')
    expect(p).toContain(WRITING_COACH_SCHEMA)
  })

  it('draws the line at describing what THIS PERSON did', () => {
    // The failure this prompt exists to prevent: a fluent paragraph about work
    // the model has no knowledge of, which reads as true.
    const p = prompt()
    expect(p).toMatch(/MUST NOT CROSS/)
    expect(p).toMatch(/do not state what THIS PERSON did/i)
    expect(p).toMatch(/keep the draft generic/i)
  })

  it('names the language to write in', () => {
    expect(buildDraftPrompt(['Customer: Statoil'], 'Projects', 'no')).toContain('"no"')
  })

  it('tells the model the facts are already printed beside the entry', () => {
    // A draft opening "Akkreditert deltidsstudium gjennom Metier Academy" under
    // a heading that already says exactly that adds nothing.
    const p = prompt()
    expect(p).toMatch(/do not write sentences that merely restate/i)
    expect(p).toMatch(/Never ask for dates/i)
  })

  it('says so plainly when there is nothing filled in yet', () => {
    expect(buildDraftPrompt([], 'Projects', 'en')).toContain('(nothing filled in yet)')
  })

  it('gives each identity fact its own line', () => {
    // Run together, "Customer: StatoilRole: Architect" is one unreadable fact
    // and the model has to guess where one ends.
    const prompt = buildDraftPrompt(['Customer: Statoil', 'Role: Architect'], 'Projects', 'en')
    const lines = prompt.split(/\r?\n/)
    expect(lines).toContain('Customer: Statoil')
    expect(lines).toContain('Role: Architect')
  })

  it('is a multi-line instruction, not a single sentence', () => {
    expect(prompt().split('\n').length).toBeGreaterThan(5)
  })
})

describe('validateCoachResponse names what was wrong', () => {
  it('distinguishes "not an object" from a missing rewrite', () => {
    expect(() => validateCoachResponse('a string')).toThrow(/not a JSON object/i)
    expect(() => validateCoachResponse(null)).toThrow(/not a JSON object/i)
    expect(() => validateCoachResponse(42)).toThrow(InvalidCoachResponseError)
    expect(() => validateCoachResponse({ asks: ['What was your role?'] })).toThrow(/rewrite/i)
  })
})

describe('buildCoachPrompt — the source it hands the model', () => {
  it('trims the flattened source', () => {
    // The source is interpolated straight into the prompt; leading blank lines
    // push the instruction away from the text it applies to, which is what a
    // small model loses track of first.
    const prompt = buildCoachPrompt({ en: '   Ran the platform rebuild.   ' }, 'en')
    expect(prompt).toContain('Ran the platform rebuild.')
    expect(prompt).not.toContain('   Ran the platform rebuild.')
  })

  it('reads the requested locale rather than whichever slot is filled', () => {
    const prompt = buildCoachPrompt({ en: 'English text.', no: 'Norsk tekst.' }, 'no')
    expect(prompt).toContain('Norsk tekst.')
    expect(prompt).not.toContain('English text.')
  })
})
