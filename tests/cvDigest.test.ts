/**
 * @vitest-environment jsdom
 *
 * jsdom: the digest flattens each field's rich text via richToPlain (DOMParser).
 */
import { describe, it, expect } from 'vitest'
import { buildCvDigest, buildBilingualDigest, itemLabel } from '../src/lib/cvDigest'
import { emptyStore, makeProject, makeCourse } from './fixtures'
import type { ResumeStore } from '../src/types'

/**
 * The digest is the ONE way a CV is rendered into a prompt (CLAUDE.md §15), so an
 * item id in one advisor's reply resolves in another's validator. Its shape is
 * therefore a contract: the store key in the heading, the real id per item, and
 * one `key: text` line per non-empty field.
 */
describe('buildCvDigest — the shape a reply is matched against', () => {
  const digestOf = (data: ResumeStore, over: Record<string, unknown> = {}) =>
    buildCvDigest(data, { locale: 'en', ...over } as never)

  const store = (over: Partial<ResumeStore> = {}): ResumeStore => ({ ...emptyStore(), ...over })

  it('heads each section with its STORE KEY, which is what a reply must name', () => {
    const out = digestOf(store({ projects: [makeProject({ id: 'p1', customer: { en: 'Acme' } })] }))
    expect(out).toMatch(/^## projects /m)
  })

  it('lists an item by its real id and a label from the identity fields', () => {
    const out = digestOf(store({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' }, description: { en: 'Platform rebuild' },
        long_description: { en: '<p>Did the work.</p>' },
      })],
    }))
    expect(out).toContain('- id: p1')
    expect(out).toMatch(/title: Acme — Platform rebuild/)
    expect(out).toMatch(/long_description: Did the work\./)
  })

  it('says "(untitled)" when no identity field has anything', () => {
    expect(itemLabel('projects', { customer: {}, description: {} }, 'en')).toBe('(untitled)')
    // A blank field is skipped rather than joined as an empty part.
    expect(itemLabel('projects', { customer: { en: 'Acme' }, description: { en: '   ' } }, 'en'))
      .toBe('Acme')
  })

  it('adds a date range to the title, and says "present" for an open one', () => {
    const range = (over: Record<string, unknown>) => {
      const out = digestOf(store({ projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, ...over } as never)] }))
      return /\[(.+)\]/.exec(out)?.[1] ?? ''
    }
    expect(range({ start: { year: 2019, month: 6 }, end: { year: 2021, month: 3 } })).toBe('2019-06 → 2021-03')
    expect(range({ start: { year: 2019, month: null }, end: null })).toBe('2019 → present')
    expect(range({ start: null, end: null })).toBe('')
  })

  it('marks a starred item, and says nothing for an unstarred one', () => {
    const out = digestOf(store({ projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, starred: true })] }))
    expect(out).toContain('starred: yes')
    const plain = digestOf(store({ projects: [makeProject({ id: 'p2', customer: { en: 'Beta' } })] }))
    expect(plain).not.toContain('starred')
  })

  it('renders a LIST field as indented lines, one per entry', () => {
    const out = digestOf(store({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        highlights: [{ en: 'Cut release time' }, { en: '   ' }, { en: 'Grew the team' }],
      })],
    }))
    expect(out).toMatch(/highlights:\n {4}- Cut release time\n {4}- Grew the team/)
  })

  it('omits a list field with nothing in it rather than an empty heading', () => {
    const out = digestOf(store({ projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, highlights: [] })] }))
    expect(out).not.toContain('highlights:')
  })

  it('omits a list field the item does not carry AT ALL', () => {
    const project = makeProject({ id: 'p1', customer: { en: 'Acme' } })
    delete (project as unknown as Record<string, unknown>).highlights
    expect(digestOf(store({ projects: [project] }))).not.toContain('highlights')
  })

  it('starts with the section heading — nothing precedes it', () => {
    const out = digestOf(store({ projects: [makeProject({ id: 'p1', customer: { en: 'Acme' } })] }))
    expect(out.split(String.fromCharCode(10))[0]).toMatch(/^## projects /)
  })

  it('includes the short descriptions by DEFAULT', () => {
    const out = digestOf(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, short_description: { en: 'Short.' } })],
    }))
    expect(out).toContain('Short.')
  })

  it('ignores a date whose year is not a number', () => {
    // An imported row can carry a string year; printing it would put "nope" in
    // the prompt as if it were a date.
    const out = digestOf(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, start: { year: 'nope' } as never, end: null })],
    }))
    expect(out).not.toContain('nope')
    expect(out).not.toContain('present')
  })

  it('ignores a field holding a bare string where a localized value belongs', () => {
    const out = digestOf(store({
      projects: [{ ...makeProject({ id: 'p1', customer: { en: 'Acme' } }), long_description: 'bare string' } as never],
    }))
    expect(out).not.toContain('bare string')
    // Nothing at all is printed for that field — not even a first character.
    expect(out).not.toContain('long_description')
  })

  it('does not cut a field that is exactly at the cap', () => {
    const exactly = 'x'.repeat(10)
    const out = digestOf(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: { en: `<p>${exactly}</p>` } })],
    }), { maxFieldChars: 10 })
    expect(out).toContain(`long_description: ${exactly}`)
    expect(out).not.toContain('…')
  })

  it('caps a long field and marks the cut', () => {
    const long = 'x'.repeat(500)
    const out = digestOf(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: { en: `<p>${long}</p>` } })],
    }), { maxFieldChars: 100 })
    const line = out.split(/\r?\n/).find((l) => l.includes('long_description'))!
    expect(line.length).toBeLessThan(140)
    expect(line.endsWith('…')).toBe(true)
  })

  it('collapses whitespace so one field is one line', () => {
    const out = digestOf(store({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        long_description: { en: '<p>First line.</p><p>Second   line.</p>' },
      })],
    }))
    const line = out.split(/\r?\n/).find((l) => l.includes('long_description'))!
    expect(line).toBe('  long_description: First line. Second line.')
  })

  it('skips an item with no id — a reply could not name it anyway', () => {
    const data = store({ projects: [{ ...makeProject({ id: 'p1' }), id: 42 } as never] })
    expect(digestOf(data)).not.toContain('id: 42')
  })

  it('leaves out a section with nothing in it', () => {
    expect(digestOf(store({ projects: [makeProject({ id: 'p1', customer: { en: 'Acme' } })] })))
      .not.toContain('## courses')
  })

  it('honours the section list and the short-description switch', () => {
    const data = store({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        long_description: { en: '<p>Long.</p>' }, short_description: { en: 'Short.' },
      })],
      courses: [makeCourse({ id: 'c1', name: { en: 'Kubernetes' } })],
    })
    const only = digestOf(data, { sections: ['projects'] })
    expect(only).toContain('## projects')
    expect(only).not.toContain('## courses')

    expect(digestOf(data, { includeShort: false })).not.toContain('Short.')
    expect(digestOf(data, { includeShort: true })).toContain('Short.')
  })
})

describe('buildBilingualDigest — both columns, raw', () => {
  const store = (over: Partial<ResumeStore> = {}): ResumeStore => ({ ...emptyStore(), ...over })

  it('shows each locale slot as stored, with no fallback between them', () => {
    // The fallback chain would show the English text in the Norwegian column and
    // report perfect agreement — the exact gap this pass looks for.
    const out = buildBilingualDigest(store({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        long_description: { en: '<p>English body.</p>' },
      })],
    }), 'en', 'no')
    expect(out).toContain('en: English body.')
    expect(out).toContain('no: (empty)')
  })

  it('skips a field both columns leave empty, and an item with no filled field', () => {
    const out = buildBilingualDigest(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: {} })],
    }), 'en', 'no')
    expect(out).toBe('')
  })

  it('caps each column, and does not cut one that is exactly at the cap', () => {
    const exactly = 'x'.repeat(10)
    const tooLong = 'y'.repeat(40)
    const out = buildBilingualDigest(store({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        long_description: { en: `<p>${exactly}</p>`, no: `<p>${tooLong}</p>` },
      })],
    }), 'en', 'no', { maxFieldChars: 10 })
    expect(out).toContain(`en: ${exactly}`)
    expect(out).not.toContain(`no: ${tooLong}`)
    expect(out).toContain(`no: ${'y'.repeat(10)}…`)
  })

  it('leaves the LIST fields out — a bullet list is not a paragraph to compare', () => {
    const out = buildBilingualDigest(store({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme' },
        long_description: { en: '<p>Body.</p>', no: '<p>Tekst.</p>' },
        highlights: [{ en: 'Cut release time' }],
      })],
    }), 'en', 'no')
    expect(out).toContain('long_description')
    expect(out).not.toContain('highlights')
  })

  it('leaves the identity fields out — they are names, not prose to compare', () => {
    const out = buildBilingualDigest(store({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme', no: 'Acme AS' },
        long_description: { en: '<p>Body.</p>', no: '<p>Tekst.</p>' },
      })],
    }), 'en', 'no')
    expect(out).not.toContain('customer:')
    // The customer still appears as the item's title, which is how a finding
    // names the row.
    expect(out).toContain('title: Acme')
  })
})

describe('buildCvDigest — what is left OUT of the prompt', () => {
  const store = (over: Record<string, unknown> = {}): ResumeStore => ({
    ...emptyStore(),
    projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, description: { en: 'Payments' }, ...over } as never)],
  })

  it('names the identity fields only in the title, never as their own lines', () => {
    // `prose: false` fields are readable but not rewritable (CLAUDE.md §15).
    // Emitting them as `customer: Acme` invites a proposal to rewrite the
    // customer's name.
    const out = buildCvDigest(store({ long_description: { en: 'Did the work.' } }), { locale: 'en' })
    expect(out).toContain('title: Acme')
    expect(out).not.toMatch(/^\s*customer:/m)
    expect(out).not.toMatch(/^\s*description:/m)
  })

  it('collapses a run of spaces inside a plain value', () => {
    // One field is one line, so any run of whitespace has to become a single
    // space — including in a value with no markup at all.
    const out = buildCvDigest(store({ long_description: { en: 'First  line   here.' } }), { locale: 'en' })
    expect(out).toContain('long_description: First line here.')
  })

  it('ends without a trailing blank line', () => {
    // Each section pushes a spacer; the prompt is concatenated with more blocks
    // after it, and a trailing run of newlines pushes the instructions apart.
    const out = buildCvDigest(store({ long_description: { en: 'Did the work.' } }), { locale: 'en' })
    expect(out.endsWith(String.fromCharCode(10))).toBe(false)
    expect(out.trimEnd()).toBe(out)
  })

  it('skips an item whose id is not a string, rather than listing it unnamed', () => {
    // A finding can only refer to an item by id; an entry with no usable id is
    // an invitation to a reference that resolves to nothing.
    const data = { ...emptyStore(), projects: [{ ...makeProject({ id: 'p1', customer: { en: 'Acme' } }), id: 42 } as never] }
    const out = buildCvDigest(data as ResumeStore, { locale: 'en' })
    expect(out).not.toContain('Acme')
    expect(out).not.toMatch(/- id:/)
  })
})

/**
 * The bilingual digest behind A3 (cross-language MEANING).
 *
 * It reads RAW locale slots rather than `resolve()` on purpose: the fallback
 * chain would paper over the very gap this pass exists to find, showing the
 * English text in the Norwegian column and reporting perfect agreement.
 */
describe('buildBilingualDigest — one column per locale, no fallback', () => {
  const store = (fields: Record<string, unknown>): ResumeStore => ({
    ...emptyStore(),
    projects: [makeProject({ id: 'p1', customer: { en: 'Acme', no: 'Acme' }, ...fields } as never)],
  })

  it('prints both locales for a field, labelled by locale code', () => {
    const out = buildBilingualDigest(
      store({ long_description: { en: 'Ran the rebuild.', no: 'Kjørte ombyggingen.' } }), 'en', 'no')
    expect(out).toContain('    en: Ran the rebuild.')
    expect(out).toContain('    no: Kjørte ombyggingen.')
  })

  it('says (empty) for a missing slot instead of borrowing the other language', () => {
    const out = buildBilingualDigest(store({ long_description: { en: 'Ran the rebuild.' } }), 'en', 'no')
    expect(out).toContain('    en: Ran the rebuild.')
    expect(out).toContain('    no: (empty)')
    expect(out).not.toMatch(/no: Ran the rebuild/)
  })

  it('leaves out a field neither language fills', () => {
    const out = buildBilingualDigest(store({ long_description: { en: 'Ran it.' }, short_description: {} }), 'en', 'no')
    expect(out).not.toContain('short_description')
  })

  it('leaves out an item with nothing to compare, and its section with it', () => {
    const out = buildBilingualDigest(store({ long_description: {} }), 'en', 'no')
    expect(out).toBe('')
  })

  it('collapses whitespace and caps a long slot', () => {
    const long = 'word '.repeat(300)
    const out = buildBilingualDigest(
      store({ long_description: { en: `First  line   here. ${long}`, no: 'Kort.' } }), 'en', 'no', { maxFieldChars: 60 })
    const line = out.split(String.fromCharCode(10)).find((l) => l.trim().startsWith('en:'))!
    expect(line).toContain('First line here.')
    expect(line.endsWith('\u2026')).toBe(true)
    expect(line.length).toBeLessThan(80)
  })

  it('ignores a value that is not a localized map at all', () => {
    const data = {
      ...emptyStore(),
      projects: [{ ...makeProject({ id: 'p1', customer: { en: 'Acme', no: 'Acme' } }), long_description: 'plain string' } as never],
    }
    expect(buildBilingualDigest(data as ResumeStore, 'en', 'no')).toBe('')
  })

  it('ends without a trailing blank line', () => {
    const out = buildBilingualDigest(
      store({ long_description: { en: 'Ran it.', no: 'Kjørte det.' } }), 'en', 'no')
    expect(out.trimEnd()).toBe(out)
  })
})

describe('buildBilingualDigest — the slot reader, exactly', () => {
  const withDesc = (en: string, no: string, id: unknown = 'p1'): ResumeStore => ({
    ...emptyStore(),
    projects: [{
      ...makeProject({ id: 'p1', customer: { en: 'Acme', no: 'Acme' } }),
      id, long_description: { en, no },
    } as never],
  })

  it('trims each slot rather than printing the padding it found', () => {
    const out = buildBilingualDigest(withDesc('  Ran it.  ', 'Kjørte det.'), 'en', 'no')
    expect(out).toContain('    en: Ran it.' + String.fromCharCode(10))
  })

  it('marks a cut slot and leaves an exactly-capped one whole', () => {
    // The ellipsis says "there is more"; adding one to text that fits reports a
    // truncation that did not happen, and the reviewer looks for missing words.
    const exact = 'x'.repeat(40)
    const whole = buildBilingualDigest(withDesc(exact, 'Kort.'), 'en', 'no', { maxFieldChars: 40 })
    expect(whole).toContain(`    en: ${exact}` + String.fromCharCode(10))

    const cut = buildBilingualDigest(withDesc('x'.repeat(41), 'Kort.'), 'en', 'no', { maxFieldChars: 40 })
    expect(cut).toContain(`    en: ${exact}…`)
  })

  it('skips an item whose id is not a string', () => {
    const out = buildBilingualDigest(withDesc('Ran it.', 'Kjørte det.', 42), 'en', 'no')
    expect(out).toBe('')
  })
})

/**
 * The BILINGUAL digest — A3's whole input.
 *
 * Its one job is to show the two locale slots side by side WITHOUT the
 * resolution fallback, because the fallback would put the English text in the
 * Norwegian column and the model would report perfect agreement on a field that
 * has never been translated. Everything else about its shape exists so a reply's
 * item id resolves against the live CV.
 */
describe('buildBilingualDigest', () => {
  const NL = String.fromCharCode(10)
  const store = (over: Partial<ResumeStore> = {}): ResumeStore => ({ ...emptyStore(), ...over })
  const oneProject = (fields: Record<string, unknown>) =>
    store({ projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, description: {}, long_description: {}, ...fields } as never)] })

  it('shows both locale slots for a field, under the section and the item id', () => {
    const out = buildBilingualDigest(
      oneProject({ long_description: { en: 'Ran the rebuild.', no: 'Ledet ombyggingen.' } }), 'no', 'en')
    expect(out).toMatch(/^## projects /m)
    expect(out).toContain('- id: p1')
    expect(out).toContain('  long_description:')
    expect(out).toContain('    no: Ledet ombyggingen.')
    expect(out).toContain('    en: Ran the rebuild.')
  })

  it('does NOT fall back to the other locale for a missing slot', () => {
    // The whole point: an untranslated field must read as empty on one side, or
    // the pass reports agreement where there is none.
    const out = buildBilingualDigest(oneProject({ long_description: { en: 'Ran the rebuild.' } }), 'no', 'en')
    expect(out).toContain('    no: (empty)')
    expect(out).toContain('    en: Ran the rebuild.')
  })

  it('skips a field neither locale fills, and an item with no filled field', () => {
    const out = buildBilingualDigest(
      oneProject({ long_description: { en: 'Ran it.' }, short_description: {} }), 'no', 'en')
    expect(out).not.toContain('short_description')

    const empty = buildBilingualDigest(oneProject({}), 'no', 'en')
    expect(empty).toBe('')
  })

  it('omits a section heading when no item in it has anything to compare', () => {
    // A heading with nothing under it spends prompt budget and invites the model
    // to comment on a section it was shown nothing from.
    const out = buildBilingualDigest(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, description: {}, long_description: {} })],
      courses: [makeCourse({ id: 'c1', description: { en: 'A course.', no: 'Et kurs.' } })],
    }), 'no', 'en')
    expect(out).not.toContain('## projects')
    expect(out).toContain('## courses')
  })

  it('skips an item whose id is not a string — a reply could not name it', () => {
    const s = store({ projects: [{ ...makeProject({ id: 'p1' }), id: 42, long_description: { en: 'x', no: 'y' } } as never] })
    expect(buildBilingualDigest(s, 'no', 'en')).toBe('')
  })

  it('titles each item in the PRIMARY locale', () => {
    const out = buildBilingualDigest(store({
      projects: [makeProject({
        id: 'p1', customer: { en: 'Acme Ltd', no: 'Acme AS' }, description: {},
        long_description: { en: 'Ran it.', no: 'Ledet det.' },
      })],
    }), 'no', 'en')
    expect(out).toContain('  title: Acme AS')
  })

  it('collapses each slot to one line and caps it', () => {
    const long = 'word '.repeat(200)
    const out = buildBilingualDigest(
      oneProject({ long_description: { en: long, no: `First.${NL}${NL}Second   line.` } }), 'no', 'en', { maxFieldChars: 80 })
    const noLine = out.split(NL).find((l) => l.trim().startsWith('no:'))!
    const enLine = out.split(NL).find((l) => l.trim().startsWith('en:'))!
    expect(noLine).toBe('    no: First. Second line.')
    expect(enLine.length).toBeLessThan(100)
    expect(enLine.endsWith('…')).toBe(true)
  })

  it('honours a section list, and ends with no trailing blank line', () => {
    const s = store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: { en: 'Ran it.', no: 'Ledet det.' } })],
      courses: [makeCourse({ id: 'c1', description: { en: 'A course.', no: 'Et kurs.' } })],
    })
    const only = buildBilingualDigest(s, 'no', 'en', { sections: ['courses'] })
    expect(only).toContain('## courses')
    expect(only).not.toContain('## projects')
    expect(only.endsWith(NL)).toBe(false)
    expect(only.startsWith(' ')).toBe(false)
  })
})
