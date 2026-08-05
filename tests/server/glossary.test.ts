import { describe, it, expect } from 'vitest'
import {
  parseGlossary, glossaryPromptBlock, deeplEntries, googleMarkup, googleUnmarkup,
} from '../../server/glossary'

describe('parseGlossary', () => {
  it('accepts a well-formed glossary', () => {
    const g = parseGlossary({
      terms: [{ from: 'Skydrift', to: 'Cloud operations' }],
      keep: ['Statens vegvesen'],
    })
    expect(g).toEqual({
      terms: [{ from: 'Skydrift', to: 'Cloud operations' }],
      keep: ['Statens vegvesen'],
    })
  })

  it('returns undefined for anything with nothing usable in it', () => {
    expect(parseGlossary(undefined)).toBeUndefined()
    expect(parseGlossary('nope')).toBeUndefined()
    expect(parseGlossary({})).toBeUndefined()
    expect(parseGlossary({ terms: [], keep: [] })).toBeUndefined()
    // No target
    expect(parseGlossary({ terms: [{ from: 'x' }] })).toBeUndefined()
  })

  /**
   * The reason this is scrubbed rather than trusted: a tab or newline would
   * break the DeepL TSV upload (which is delimited by exactly those), and a
   * newline in a term is the obvious way to smuggle an instruction into the LLM
   * provider's prompt block.
   */
  it('strips control characters, including tabs and newlines', () => {
    const g = parseGlossary({
      terms: [{ from: 'A\tB', to: 'C\nD' }],
      keep: ['E\r\nF'],
    })
    expect(g?.terms[0]).toEqual({ from: 'A B', to: 'C D' })
    expect(g?.keep[0]).toBe('E F')
  })

  it('drops a pair whose sides are the same (nothing to instruct)', () => {
    expect(parseGlossary({ terms: [{ from: 'Docker', to: 'docker' }] })).toBeUndefined()
  })

  it('caps entry count and entry length against a hostile body', () => {
    const g = parseGlossary({
      terms: Array.from({ length: 500 }, (_, i) => ({ from: `a${i}`, to: `b${i}` })),
      keep: Array.from({ length: 500 }, (_, i) => `k${i}`),
    })
    expect(g!.terms.length).toBeLessThanOrEqual(50)
    expect(g!.keep.length).toBeLessThanOrEqual(50)

    const long = parseGlossary({ terms: [{ from: 'x'.repeat(500), to: 'y'.repeat(500) }] })
    expect(long!.terms[0].from.length).toBeLessThanOrEqual(80)
  })
})

describe('glossaryPromptBlock', () => {
  it('states the mappings and the do-not-translate names', () => {
    const block = glossaryPromptBlock({
      terms: [{ from: 'Skydrift', to: 'Cloud operations' }],
      keep: ['Statens vegvesen'],
    })
    expect(block).toContain('Skydrift → Cloud operations')
    expect(block).toContain('Statens vegvesen')
    expect(block).toMatch(/DO NOT TRANSLATE/)
  })

  it('is empty when there is no glossary', () => {
    expect(glossaryPromptBlock(undefined)).toBe('')
  })
})

describe('deeplEntries', () => {
  /** An identity entry is how a glossary says "leave this alone". */
  it('maps every keep name to itself, alongside the real pairs', () => {
    const entries = deeplEntries({
      terms: [{ from: 'Skydrift', to: 'Cloud operations' }],
      keep: ['Statens vegvesen'],
    })
    expect(entries).toContainEqual({ from: 'Skydrift', to: 'Cloud operations' })
    expect(entries).toContainEqual({ from: 'Statens vegvesen', to: 'Statens vegvesen' })
  })

  /** DeepL rejects a glossary with duplicate source terms outright. */
  it('keeps only the first entry for a source term', () => {
    const entries = deeplEntries({
      terms: [{ from: 'Skydrift', to: 'Cloud operations' }, { from: 'skydrift', to: 'Cloud ops' }],
      keep: ['Skydrift'],
    })
    expect(entries.filter((e) => e.from.toLowerCase() === 'skydrift')).toHaveLength(1)
    expect(entries[0].to).toBe('Cloud operations')
  })
})

describe('googleMarkup', () => {
  const g = {
    terms: [{ from: 'Skydrift', to: 'Cloud operations' }],
    keep: ['Statens vegvesen'],
  }

  /**
   * Google Translate v2 has no glossary parameter, so terminology is enforced
   * structurally: substitute the agreed target wording and mark it notranslate.
   */
  it('substitutes the target wording and protects it', () => {
    const { html, used } = googleMarkup('Jeg jobbet med Skydrift.', g)
    expect(used).toBe(true)
    expect(html).toContain('<span class="notranslate">Cloud operations</span>')
    expect(html).not.toContain('Skydrift')
  })

  it('protects a do-not-translate name unchanged', () => {
    const { html } = googleMarkup('Jobbet for Statens vegvesen.', g)
    expect(html).toContain('<span class="notranslate">Statens vegvesen</span>')
  })

  it('leaves text alone when nothing matches', () => {
    const { html, used } = googleMarkup('Helt vanlig tekst.', g)
    expect(used).toBe(false)
    expect(html).toBe('Helt vanlig tekst.')
  })

  it('does not match inside a longer word', () => {
    const { used } = googleMarkup('Skydriften er god.', g)
    expect(used).toBe(false)
  })

  /** Longest first, so a shorter term can't eat part of a longer one. */
  it('prefers the longer term when two overlap', () => {
    const { html } = googleMarkup('Vi driver Cloud operations her', {
      terms: [{ from: 'Cloud', to: 'Sky' }, { from: 'Cloud operations', to: 'Skydrift' }],
      keep: [],
    })
    expect(html).toContain('>Skydrift<')
    expect(html).not.toContain('>Sky<')
  })

  it('escapes the surrounding text so HTML mode is safe', () => {
    const { html } = googleMarkup('a < b & Skydrift', g)
    expect(html).toContain('&lt;')
    expect(html).toContain('&amp;')
  })

  it('round-trips through unmarkup', () => {
    const { html } = googleMarkup('a < b og Skydrift her', g)
    expect(googleUnmarkup(html)).toBe('a < b og Cloud operations her')
  })

  /**
   * Regression: `unescapeHtml` decoded `&amp;` FIRST, which made the escape /
   * unescape pair non-inverse for text that already CONTAINS an entity — the
   * case the raw-`<` test above cannot catch, because a bare `<` survives either
   * order.
   *
   * A literal `&lt;` escapes to `&amp;lt;`; an `&amp;`-first pass decoded that
   * to `&lt;` and the next pass to `<`. So `A &lt; B` came back as `A < B`, and
   * a CV mentioning `&lt;script&gt;` came back carrying real `<script>` —
   * inert text promoted to markup inside the store. Never XSS (escape-at-render
   * holds) but a corruption bug and a hole in defence in depth.
   */
  it.each([
    'A &lt; B',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    'Tom &amp; Jerry',
    'R&D "quoted" & <b>bold</b>',
    "it's & <a>",
  ])('round-trips %j without decoding an entity twice', (text) => {
    // Force markup on by including a glossary term, then strip it back out.
    const { html, used } = googleMarkup(`${text} Skydrift`, g)
    expect(used).toBe(true)
    expect(googleUnmarkup(html)).toBe(`${text} Cloud operations`)
  })
})
