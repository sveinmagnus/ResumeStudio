/**
 * @vitest-environment jsdom
 */
// jsdom: the source-emptiness check flattens rich text via lib/richText's DOMParser.
import { describe, it, expect } from 'vitest'
import {
  SUMMARY_FIELDS, summaryFields, emptySummaryTargets, applySummaries, summarizableSource,
  summaryContext,
} from '../src/lib/summarizeBatch'
import {
  emptyStore, makeResume, makeProject, makeWork, makeCourse, makeAward, makePublication,
} from './fixtures'
import type { ResumeStore } from '../src/types'

function store(over: Partial<ResumeStore> = {}): ResumeStore {
  return { ...emptyStore(), resume: makeResume({ id: 'r1' }), ...over }
}

describe('summaryFields()', () => {
  it('knows the sections whose editor offers a Summarize button', () => {
    expect(Object.keys(SUMMARY_FIELDS).sort()).toEqual([
      'certifications', 'courses', 'educations', 'honor_awards', 'key_competencies',
      'positions', 'presentations', 'projects', 'publications', 'recommendations',
      'work_experiences',
    ])
  })

  it('reads Projects and Employment from long_description, not the short name field', () => {
    expect(summaryFields('projects')?.source).toBe('long_description')
    expect(summaryFields('work_experiences')?.source).toBe('long_description')
  })

  it('reads Publications from its abstract and Recommendations from its text', () => {
    expect(summaryFields('publications')?.source).toBe('abstract')
    expect(summaryFields('recommendations')?.source).toBe('text')
  })

  it('is undefined for a section with no summary field', () => {
    expect(summaryFields('spoken_languages')).toBeUndefined()
    expect(summaryFields('references')).toBeUndefined()
    expect(summaryFields('skills')).toBeUndefined()
  })

  /**
   * Every row is independent: losing one leaves that section's Summarize
   * button doing nothing, with nothing else affected to notice. Listing the
   * keys (above) does not check what each maps to.
   */
  it('names both fields for every section it covers', () => {
    const pairs = Object.fromEntries(
      Object.keys(SUMMARY_FIELDS).map((k) => [k, `${summaryFields(k)?.source} → ${summaryFields(k)?.target}`]),
    )
    expect(pairs).toEqual({
      projects: 'long_description → short_description',
      work_experiences: 'long_description → short_description',
      positions: 'description → short_description',
      educations: 'description → short_description',
      courses: 'description → short_description',
      certifications: 'description → short_description',
      presentations: 'description → short_description',
      honor_awards: 'description → short_description',
      key_competencies: 'description → short_description',
      publications: 'abstract → short_description',
      recommendations: 'text → short_description',
    })
  })
})

describe('summarizableSource()', () => {
  it('flattens rich text to plain', () => {
    expect(summarizableSource('<p>Built the <b>platform</b></p>')).toBe('Built the platform')
  })

  it('rejects markup that renders no real words', () => {
    // richToPlain gives list items a bullet, so these are non-empty strings
    // after a trim — but there is nothing to summarize in any of them.
    expect(summarizableSource('<ul><li></li></ul>')).toBe('')
    expect(summarizableSource('<p></p>')).toBe('')
    expect(summarizableSource('<p><br></p>')).toBe('')
    expect(summarizableSource('   ')).toBe('')
    expect(summarizableSource(undefined)).toBe('')
  })

  it('keeps text that has any letter or digit, in any script', () => {
    expect(summarizableSource('<ul><li>Led the team</li></ul>')).toContain('Led the team')
    expect(summarizableSource('Ledet migrering')).toBe('Ledet migrering')
    expect(summarizableSource('2024')).toBe('2024')
  })
})

describe('summaryContext()', () => {
  /**
   * The heading lines sent with a summarize request so the prompt can name the
   * words the line must NOT spend itself on. The reported failure this fixes
   * was a model answering "Consultant for Statoil" for an entry already headed
   * *Statoil — Consultant*.
   */
  it('names the identity fields, labelled as the reader sees them', () => {
    const p = makeProject({ customer: { en: 'Statoil' }, description: { en: 'Platform rebuild' } })
    expect(summaryContext('projects', p, 'en'))
      .toEqual(['Customer: Statoil', 'Project name: Platform rebuild'])
  })

  /**
   * The one rule that must not slip: prose fields are what is being SUMMARISED.
   * Sending the description as context would tell the model not to repeat the
   * very text it was asked to condense.
   */
  it('never includes a prose field or a list field', () => {
    const p = makeProject({
      customer: { en: 'Statoil' },
      long_description: { en: 'Ran the platform rebuild end to end.' },
      short_description: { en: 'Ran the rebuild.' },
      highlights: [{ en: 'Cut release time' }],
    })
    const ctx = summaryContext('projects', p, 'en').join(' | ')
    expect(ctx).toContain('Statoil')
    expect(ctx).not.toContain('end to end')
    expect(ctx).not.toContain('Ran the rebuild')
    expect(ctx).not.toContain('Cut release time')
  })

  it('resolves across locales, since the heading itself falls back', () => {
    // A customer stored only in English is still what a reader of the Norwegian
    // column sees above the line being written.
    const p = makeProject({ customer: { en: 'Statoil' }, description: {} })
    expect(summaryContext('projects', p, 'no')).toEqual(['Customer: Statoil'])
  })

  it('skips a field with nothing in it rather than emitting a bare label', () => {
    const p = makeProject({ customer: { en: 'Statoil' }, description: { en: '   ' } })
    expect(summaryContext('projects', p, 'en')).toEqual(['Customer: Statoil'])
  })

  it('is empty for a section it does not know, and for a non-item', () => {
    expect(summaryContext('not_a_section', makeProject(), 'en')).toEqual([])
    expect(summaryContext('projects', null, 'en')).toEqual([])
    expect(summaryContext('projects', 'a string', 'en')).toEqual([])
  })

  it('ignores a field holding something that is not a localized value', () => {
    // Imported data puts strings and arrays where objects belong; a raw string
    // would otherwise be indexed by locale and yield a character.
    const odd = { ...makeProject({ customer: { en: 'Statoil' } }), description: 'plain' }
    expect(summaryContext('projects', odd, 'en')).toEqual(['Customer: Statoil'])
  })

  it('carries the employer for Employment, not the role description', () => {
    const w = makeWork({
      employer: { en: 'Cartavio' }, role_title: { en: 'Consultant' },
      long_description: { en: 'Led the platform team.' },
    })
    expect(summaryContext('work_experiences', w, 'en'))
      .toEqual(['Employer: Cartavio', 'Role: Consultant'])
  })
})

describe('emptySummaryTargets()', () => {
  it('finds one job per (item, locale) needing a summary', () => {
    const s = store({
      courses: [
        makeCourse({ id: 'c1', description: { no: 'Lang norsk tekst', en: 'Long English text' } }),
      ],
    })
    expect(emptySummaryTargets(s, 'courses', ['no', 'en'])).toEqual([
      // Each job carries the item's heading, so the batch and the per-field
      // button send the model the same "don't restate this" context.
      { id: 'c1', locale: 'no', source: 'Lang norsk tekst', context: ['Course: A Course'] },
      { id: 'c1', locale: 'en', source: 'Long English text', context: ['Course: A Course'] },
    ])
  })

  it('only counts the locales asked for — the visible columns', () => {
    const s = store({
      courses: [makeCourse({ id: 'c1', description: { no: 'Norsk', en: 'English' } })],
    })
    expect(emptySummaryTargets(s, 'courses', ['no'])).toHaveLength(1)
    expect(emptySummaryTargets(s, 'courses', ['no'])[0].locale).toBe('no')
  })

  it('skips a locale whose summary is already filled', () => {
    const s = store({
      courses: [makeCourse({
        id: 'c1',
        description: { no: 'Norsk', en: 'English' },
        short_description: { no: 'Allerede fylt' },
      })],
    })
    const out = emptySummaryTargets(s, 'courses', ['no', 'en'])
    expect(out.map((t) => t.locale)).toEqual(['en'])
  })

  it('treats a whitespace-only summary as empty', () => {
    const s = store({
      courses: [makeCourse({ id: 'c1', description: { en: 'Text' }, short_description: { en: '   ' } })],
    })
    expect(emptySummaryTargets(s, 'courses', ['en'])).toHaveLength(1)
  })

  it('skips a locale with no source to read — the summarizer writes what it reads', () => {
    const s = store({
      courses: [makeCourse({ id: 'c1', description: { no: 'Bare norsk' } })],
    })
    // No English description ⇒ no English job, even though English is empty.
    expect(emptySummaryTargets(s, 'courses', ['no', 'en']).map((t) => t.locale)).toEqual(['no'])
  })

  it('does not count rich markup with no actual text as a source', () => {
    const s = store({
      courses: [makeCourse({ id: 'c1', description: { en: '<p></p><ul><li></li></ul>' } })],
    })
    // An empty bullet list flattens to a lone "•" — text by a bare trim, but
    // nothing to summarize, and a real LLM call if we let it through.
    expect(emptySummaryTargets(s, 'courses', ['en'])).toHaveLength(0)
  })

  it('flattens rich source text to plain', () => {
    const s = store({
      projects: [makeProject({
        id: 'p1',
        long_description: { en: '<p>Built the <b>platform</b></p>' },
      })],
    })
    const out = emptySummaryTargets(s, 'projects', ['en'])
    expect(out[0].source).toContain('Built the platform')
    expect(out[0].source).not.toContain('<b>')
  })

  it('skips disabled items — they are in no export, so the calls would be waste', () => {
    const s = store({
      courses: [
        makeCourse({ id: 'c1', description: { en: 'Text' }, disabled: true }),
        makeCourse({ id: 'c2', description: { en: 'Text' } }),
      ],
    })
    expect(emptySummaryTargets(s, 'courses', ['en']).map((t) => t.id)).toEqual(['c2'])
  })

  it('reads Employment from long_description and ignores its short description field', () => {
    const s = store({
      work_experiences: [makeWork({
        id: 'w1',
        description: { en: 'Engineer' },          // the role name, not a source
        long_description: { en: 'Ran the platform team' },
      })],
    })
    expect(emptySummaryTargets(s, 'work_experiences', ['en'])[0].source).toBe('Ran the platform team')
  })

  it('reads a Publication from its abstract', () => {
    const s = store({
      publications: [makePublication({ id: 'pub1', abstract: { en: 'A paper about things' } })],
    })
    expect(emptySummaryTargets(s, 'publications', ['en'])[0].source).toBe('A paper about things')
  })

  it('is empty for a section with no summary field, and for an empty section', () => {
    expect(emptySummaryTargets(store(), 'spoken_languages', ['en'])).toEqual([])
    expect(emptySummaryTargets(store(), 'courses', ['en'])).toEqual([])
  })

  it('dedupes a repeated locale rather than queueing the same job twice', () => {
    const s = store({ courses: [makeCourse({ id: 'c1', description: { en: 'Text' } })] })
    expect(emptySummaryTargets(s, 'courses', ['en', 'en'])).toHaveLength(1)
  })
})

describe('applySummaries()', () => {
  it('writes each result into its item and locale', () => {
    const s = store({ courses: [makeCourse({ id: 'c1', description: { en: 'Text' } })] })
    const out = applySummaries(s, 'courses', [{ id: 'c1', locale: 'en', text: 'One line' }])
    expect(out.courses[0].short_description).toEqual({ en: 'One line' })
  })

  it('merges without disturbing a summary already written in another locale', () => {
    const s = store({
      courses: [makeCourse({ id: 'c1', short_description: { no: 'Håndskrevet' } })],
    })
    const out = applySummaries(s, 'courses', [{ id: 'c1', locale: 'en', text: 'Drafted' }])
    expect(out.courses[0].short_description).toEqual({ no: 'Håndskrevet', en: 'Drafted' })
  })

  it('applies several items in one pass — the batch is one undo step', () => {
    const s = store({
      courses: [makeCourse({ id: 'c1' }), makeCourse({ id: 'c2' }), makeCourse({ id: 'c3' })],
    })
    const out = applySummaries(s, 'courses', [
      { id: 'c1', locale: 'en', text: 'A' },
      { id: 'c3', locale: 'en', text: 'C' },
    ])
    expect(out.courses[0].short_description).toEqual({ en: 'A' })
    expect(out.courses[1].short_description ?? {}).toEqual({})  // untouched
    expect(out.courses[2].short_description).toEqual({ en: 'C' })
  })

  it('trims, and ignores an empty result', () => {
    const s = store({ courses: [makeCourse({ id: 'c1' })] })
    expect(applySummaries(s, 'courses', [{ id: 'c1', locale: 'en', text: '  Trimmed  ' }])
      .courses[0].short_description).toEqual({ en: 'Trimmed' })
    expect(applySummaries(s, 'courses', [{ id: 'c1', locale: 'en', text: '   ' }])).toBe(s)
  })

  it('ignores a result whose item has since vanished, rather than resurrecting it', () => {
    const s = store({ courses: [makeCourse({ id: 'c1' })] })
    const out = applySummaries(s, 'courses', [{ id: 'gone', locale: 'en', text: 'Orphan' }])
    expect(out.courses).toHaveLength(1)
    expect(out.courses[0].short_description ?? {}).toEqual({})
  })

  it('returns the same store for no results or an unknown section', () => {
    const s = store({ courses: [makeCourse({ id: 'c1' })] })
    expect(applySummaries(s, 'courses', [])).toBe(s)
    expect(applySummaries(s, 'spoken_languages', [{ id: 'x', locale: 'en', text: 'X' }])).toBe(s)
  })

  it('does not mutate the input store', () => {
    const s = store({ courses: [makeCourse({ id: 'c1' })] })
    applySummaries(s, 'courses', [{ id: 'c1', locale: 'en', text: 'New' }])
    expect(s.courses[0].short_description ?? {}).toEqual({})
  })

  it('round-trips: every target found is a target filled', () => {
    const s = store({
      honor_awards: [
        makeAward({ id: 'a1', description: { no: 'Norsk tekst', en: 'English text' } }),
        makeAward({ id: 'a2', description: { en: 'Only English' } }),
      ],
    })
    const targets = emptySummaryTargets(s, 'honor_awards', ['no', 'en'])
    expect(targets).toHaveLength(3)
    const out = applySummaries(s, 'honor_awards', targets.map((t) => ({
      id: t.id, locale: t.locale, text: `summary of ${t.source}`,
    })))
    expect(emptySummaryTargets(out, 'honor_awards', ['no', 'en'])).toEqual([])
  })
})
