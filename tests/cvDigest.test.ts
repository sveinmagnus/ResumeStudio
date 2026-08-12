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
