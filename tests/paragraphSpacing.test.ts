/**
 * @vitest-environment jsdom
 *
 * The invariant this file exists for: a break between two paragraphs looks the
 * SAME however the value happens to encode it, and in every place the CV is
 * rendered.
 *
 * A description could arrive holding a `<p>` boundary (typed in the editor), a
 * `<br>` (pasted), or a raw newline (every plain-text import, and what the
 * editor itself emitted under `white-space: pre-wrap`). Those three used to
 * render four different ways — paragraph spacing in the HTML preview, a tight
 * break, a plain SPACE in Word, and a break in the PDF — none of it visible in
 * the editor. `sanitizeRich`'s `blockify` step canonicalises all three to a
 * paragraph boundary, and the four renderers share ONE gap (`PARA_GAP_LINES`).
 */
import { describe, it, expect } from 'vitest'
import { parseRichBlocks, sanitizeRich, PARA_GAP_LINES } from '../src/lib/richText'
import { buildViewHtml } from '../src/lib/viewFilter'
import { buildViewText, buildViewMarkdown } from '../src/lib/viewText'
import { deriveTokens, DEFAULT_VIEW_STYLE } from '../src/lib/viewStyle'
import { emptyStore, makeResume, makeWork, makeView } from './fixtures'

/** The same two-paragraph description, in each of the encodings we've shipped. */
const ENCODINGS: Record<string, string> = {
  'paragraph tags': '<p>First para.</p><p>Second para.</p>',
  'a <br>': 'First para.<br>Second para.',
  'a raw newline': 'First para.\nSecond para.',
  'a blank line': 'First para.\n\nSecond para.',
  'plain text with a newline': 'First para.\nSecond para.',
}

function storeWith(longDescription: string) {
  const store = emptyStore()
  store.resume = makeResume()
  store.work_experiences = [makeWork({ long_description: { en: longDescription } })]
  return store
}

const view = () => makeView({ sections: [{ key: 'work_experiences', detail: 'full', enabled: true }] })

describe('paragraph spacing — every encoding of a break behaves the same', () => {
  for (const [label, value] of Object.entries(ENCODINGS)) {
    it(`${label}: canonicalises to two paragraphs`, () => {
      expect(sanitizeRich(value)).toBe('<p>First para.</p><p>Second para.</p>')
    })

    it(`${label}: parses to two blocks for the DOCX/PDF exporters`, () => {
      const blocks = parseRichBlocks(value)
      expect(blocks).toHaveLength(2)
      expect(blocks.every((b) => b.kind === 'paragraph')).toBe(true)
      // No stray newline left inside a run — a "\n" in a Word <w:t> is just
      // whitespace, which is how Word used to swallow these breaks.
      expect(blocks.flatMap((b) => b.runs).some((r) => r.text.includes('\n'))).toBe(false)
    })

    it(`${label}: renders as two <p> in the HTML preview`, () => {
      const html = buildViewHtml(storeWith(value), view(), 'en')
      const desc = html.match(/<div class="ve-desc">([\s\S]*?)<\/div>/)?.[1] ?? ''
      expect(desc).toBe('<p>First para.</p><p>Second para.</p>')
    })

    it(`${label}: keeps the paragraphs apart in the text and Markdown exports`, () => {
      const store = storeWith(value)
      // A blank line between them: what a paragraph break looks like in plain
      // text, and what Markdown REQUIRES (adjacent lines merge into one).
      expect(buildViewText(store, view(), 'en')).toContain('First para.\n\nSecond para.')
      expect(buildViewMarkdown(store, view(), 'en')).toContain('First para.\n\nSecond para.')
    })
  }
})

describe('paragraph gap — one value, every target', () => {
  it('is half a line box in the derived style tokens', () => {
    const tokens = deriveTokens({ ...DEFAULT_VIEW_STYLE })
    expect(tokens.paraGapEm).toBeCloseTo(PARA_GAP_LINES * tokens.lineHeight, 5)
    expect(tokens.paraGapPt).toBeCloseTo(PARA_GAP_LINES * tokens.lineHeight * tokens.bodyFontSizePt, 1)
    expect(tokens.paraGapTwips).toBe(Math.round(tokens.paraGapPt * 20))
  })

  it('scales with the density the user picked', () => {
    const compact = deriveTokens({ ...DEFAULT_VIEW_STYLE, density: 'compact' })
    const spacious = deriveTokens({ ...DEFAULT_VIEW_STYLE, density: 'spacious' })
    expect(spacious.paraGapEm).toBeGreaterThan(compact.paraGapEm)
    expect(spacious.paraGapTwips).toBeGreaterThan(compact.paraGapTwips)
  })

  it('is the gap the HTML preview actually emits', () => {
    const store = storeWith('<p>a</p><p>b</p>')
    const tokens = deriveTokens({ ...DEFAULT_VIEW_STYLE })
    const html = buildViewHtml(store, view(), 'en')
    expect(html).toContain(`margin: 0 0 ${tokens.paraGapEm}em;`)
    // …and the last paragraph of a block doesn't push the next element down.
    expect(html).toContain('.ve-desc p:last-child')
  })
})

describe('a plain-text intro is paragraphs too', () => {
  it('splits on newlines in HTML and text, like every other field', () => {
    const store = storeWith('<p>body</p>')
    const v = makeView({
      sections: [{ key: 'work_experiences', detail: 'full', enabled: true }],
      introduction: { en: 'Intro one.\nIntro two.' },
    })
    expect(buildViewHtml(store, v, 'en'))
      .toContain('<div class="ve-intro"><p>Intro one.</p><p>Intro two.</p></div>')
    expect(buildViewText(store, v, 'en')).toContain('Intro one.\n\nIntro two.')
  })
})
