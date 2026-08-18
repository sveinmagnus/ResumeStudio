/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import {
  sanitizeRich, richToPlain, hasMarkup, renderRichHtml, renderRichInlineHtml,
  parseRichBlocks, cleanPastedHtml, plainToRichHtml, plainParagraphs,
  paraGapEm, PARA_GAP_LINES,
} from '../src/lib/richText'

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

describe('hasMarkup', () => {
  it('detects allowed inline tags', () => {
    expect(hasMarkup('plain')).toBe(false)
    expect(hasMarkup('<b>x</b>')).toBe(true)
    expect(hasMarkup('<p>x</p>')).toBe(true)
    expect(hasMarkup('a<br>b')).toBe(true)
    expect(hasMarkup('<UL><LI>x</LI></UL>')).toBe(true)
  })
  it('ignores tags outside the allowlist', () => {
    expect(hasMarkup('<span>x</span>')).toBe(false)
    expect(hasMarkup('<div>x</div>')).toBe(false)
  })
})

describe('sanitizeRich', () => {
  it('keeps the allowed tags, wrapping loose inline content in a paragraph', () => {
    expect(sanitizeRich('<b>x</b>')).toBe('<p><b>x</b></p>')
    expect(sanitizeRich('<strong>x</strong>')).toBe('<p><strong>x</strong></p>')
    expect(sanitizeRich('<em>x</em><u>y</u>')).toBe('<p><em>x</em><u>y</u></p>')
    expect(sanitizeRich('<p>x</p>')).toBe('<p>x</p>')
    expect(sanitizeRich('<ul><li>x</li></ul>')).toBe('<ul><li>x</li></ul>')
    expect(sanitizeRich('<ol><li>a</li><li>b</li></ol>')).toBe('<ol><li>a</li><li>b</li></ol>')
  })
  it('strips disallowed tags but keeps their text', () => {
    expect(sanitizeRich('<span>hi</span>')).toBe('<p>hi</p>')
    expect(sanitizeRich('<div><b>x</b></div>')).toBe('<p><b>x</b></p>')
    expect(sanitizeRich('<a href="http://x">link</a>')).toBe('<p>link</p>')
  })
  it('collapses the oversized-gap artifacts from Word/translator pastes', () => {
    // empty / whitespace-only / <br>-only paragraphs are removed
    expect(sanitizeRich('<p>a</p><p></p><p>b</p>')).toBe('<p>a</p><p>b</p>')
    expect(sanitizeRich('<p>a</p><p><br></p><p>b</p>')).toBe('<p>a</p><p>b</p>')
    expect(sanitizeRich('<p>a</p><p> </p><p>b</p>')).toBe('<p>a</p><p>b</p>')
    // a trailing <br> inside a paragraph (a blank edge line) is dropped
    expect(sanitizeRich('<p>a<br></p>')).toBe('<p>a</p>')
    expect(sanitizeRich('<p><br>a</p>')).toBe('<p>a</p>')
  })
  it('drops dangerous container tags with their content', () => {
    expect(sanitizeRich('<script>alert(1)</script>safe')).toBe('<p>safe</p>')
    expect(sanitizeRich('<style>body{}</style>x')).toBe('<p>x</p>')
    expect(sanitizeRich('<iframe src=x></iframe>after')).toBe('<p>after</p>')
  })
  it('strips all attributes from allowed tags', () => {
    expect(sanitizeRich('<b style="color:red" onclick="x()">y</b>')).toBe('<p><b>y</b></p>')
    expect(sanitizeRich('<p class="foo" id="bar">x</p>')).toBe('<p>x</p>')
  })
  it('handles empty input', () => {
    expect(sanitizeRich('')).toBe('')
  })
  it('strips comment nodes (Word clipboard junk)', () => {
    expect(sanitizeRich('a<!--StartFragment-->b')).toBe('<p>ab</p>')
    expect(sanitizeRich('<p>x<!-- hidden --></p>')).toBe('<p>x</p>')
    expect(sanitizeRich('<!--[if gte mso 9]><xml>junk</xml><![endif]-->safe')).toBe('<p>safe</p>')
  })
})

// The bug this suite pins: a value could encode "new line" as a <p> boundary,
// as a <br>, or as a raw newline — invisible in the editor, and rendered three
// different ways across the preview / Word / PDF / text exports.
describe('sanitizeRich — one kind of line break', () => {
  it('turns a <br> into a paragraph boundary', () => {
    expect(sanitizeRich('a<br>b')).toBe('<p>a</p><p>b</p>')
    expect(sanitizeRich('<p>a<br>b</p>')).toBe('<p>a</p><p>b</p>')
  })
  it('collapses a run of <br> into ONE paragraph boundary', () => {
    expect(sanitizeRich('a<br><br>b')).toBe('<p>a</p><p>b</p>')
    expect(sanitizeRich('a<br><br><br>b')).toBe('<p>a</p><p>b</p>')
  })
  it('turns a raw newline into a paragraph boundary', () => {
    expect(sanitizeRich('a\nb')).toBe('<p>a</p><p>b</p>')
    expect(sanitizeRich('<p>a\nb</p>')).toBe('<p>a</p><p>b</p>')
    expect(sanitizeRich('a\r\nb')).toBe('<p>a</p><p>b</p>')
    // A lone carriage return is a break too — the optional \n in the pattern
    // is what stops it becoming an invisible character inside one paragraph.
    expect(sanitizeRich('a\rb')).toBe('<p>a</p><p>b</p>')
    // a blank line means the same as a single newline — the user can't see
    // which one a stored value holds
    expect(sanitizeRich('a\n\nb')).toBe('<p>a</p><p>b</p>')
  })
  it('does NOT break on the newline of pretty-printed markup', () => {
    expect(sanitizeRich('<p>a</p>\n<p>b</p>')).toBe('<p>a</p><p>b</p>')
    expect(sanitizeRich('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>'))
      .toBe('<ul><li>a</li><li>b</li></ul>')
  })
  it('rebuilds the inline formatting around each half of a split', () => {
    expect(sanitizeRich('<p><strong>a<br>b</strong></p>'))
      .toBe('<p><strong>a</strong></p><p><strong>b</strong></p>')
    expect(sanitizeRich('<p><strong><em>a\nb</em></strong></p>'))
      .toBe('<p><strong><em>a</em></strong></p><p><strong><em>b</em></strong></p>')
  })
  it('keeps a break inside a list item as a <br> (splitting would invent a bullet)', () => {
    expect(sanitizeRich('<ul><li>a<br>b</li></ul>')).toBe('<ul><li>a<br>b</li></ul>')
    expect(sanitizeRich('<ul><li>a\nb</li></ul>')).toBe('<ul><li>a<br>b</li></ul>')
  })
  it('trims the whitespace a split leaves at a paragraph edge', () => {
    expect(sanitizeRich('<p>a <br> b</p>')).toBe('<p>a</p><p>b</p>')
  })
  it('trims ALL the whitespace at a block edge, not one character of it', () => {
    // Pasted markup routinely carries several spaces or a newline at an edge;
    // leaving one behind shows up as a stray indent in every export.
    expect(sanitizeRich('<p>   a   </p>')).toBe('<p>a</p>')
    expect(sanitizeRich('<p>\n\n  a  \n\n</p>')).toBe('<p>a</p>')
    expect(sanitizeRich('<p>  <strong>a</strong>  </p>')).toBe('<p><strong>a</strong></p>')
  })

  it('drops layout whitespace inside an ORDERED list too', () => {
    // The unordered case was covered; both tag names are checked separately.
    expect(sanitizeRich('<ol>\n  <li>a</li>\n  <li>b</li>\n</ol>'))
      .toBe('<ol><li>a</li><li>b</li></ol>')
  })

  it('drops a break left at the very start or end of a block', () => {
    // A trailing <br> renders as an empty line the user cannot select or
    // delete; canonical storage has no such thing.
    expect(sanitizeRich('<p>a<br></p>')).toBe('<p>a</p>')
    expect(sanitizeRich('<p><br>a</p>')).toBe('<p>a</p>')
    expect(sanitizeRich('<ul><li>a<br></li></ul>')).toBe('<ul><li>a</li></ul>')
    expect(sanitizeRich('<ul><li><br>a</li></ul>')).toBe('<ul><li>a</li></ul>')
  })

  it('strips a comment wherever it is nested', () => {
    // Comments carry pasted-from-Word bookkeeping and conditional markup;
    // the recursion is what reaches the ones inside a list item.
    expect(sanitizeRich('<p>a<!-- note -->b</p>')).toBe('<p>ab</p>')
    expect(sanitizeRich('<ul><li>a<!-- note --></li></ul>')).toBe('<ul><li>a</li></ul>')
    expect(sanitizeRich('<p><strong>a<!-- deep --></strong></p>')).toBe('<p><strong>a</strong></p>')
  })

  it('is idempotent — canonical input rebuilds to itself', () => {
    const inputs = [
      'a<br>b', '<p>a\nb</p>', '<ul><li>a<br>b</li></ul>', '<p><strong>a<br>b</strong></p>',
      '<p>x</p><ul><li>y</li></ul><p>z</p>', 'plain text', '<div>a</div><div>b</div>',
    ]
    for (const input of inputs) {
      const once = sanitizeRich(input)
      expect(sanitizeRich(once)).toBe(once)
    }
  })
})

describe('cleanPastedHtml', () => {
  it('keeps paragraph boundaries from divs (website paste)', () => {
    expect(cleanPastedHtml('<div>one</div><div>two</div>')).toBe('<p>one</p><p>two</p>')
  })
  it('maps headings to bold paragraphs', () => {
    expect(cleanPastedHtml('<h2>Title</h2><p>body</p>'))
      .toBe('<p><strong>Title</strong></p><p>body</p>')
  })
  it('maps style-based formatting to tags (Google Docs)', () => {
    expect(cleanPastedHtml('<span style="font-weight:700">b</span> and <span style="font-style:italic">i</span>'))
      .toBe('<strong>b</strong> and <em>i</em>')
    expect(cleanPastedHtml('<span style="text-decoration:underline">u</span>')).toBe('<u>u</u>')
    expect(cleanPastedHtml('<span style="font-weight:bold;font-style:italic">x</span>'))
      .toBe('<strong><em>x</em></strong>')
  })
  it('does not bold the Google Docs b-wrapper with font-weight:normal', () => {
    // One paragraph → unwrapped, so it splices into the caret's paragraph.
    expect(cleanPastedHtml('<b style="font-weight:normal" id="docs-internal-guid-x"><p>hello <span style="font-weight:700">bold</span></p></b>'))
      .toBe('hello <strong>bold</strong>')
  })
  it('cleans a Word fragment: comments, o:p, nbsp-only paragraphs', () => {
    const word =
      '<p class=MsoNormal>Hello<o:p></o:p></p>' +
      '<p class=MsoNormal><o:p>&nbsp;</o:p></p>' +
      '<!--[if gte mso 9]><xml><w:WordDocument></w:WordDocument></xml><![endif]-->' +
      '<p class=MsoNormal><b>World</b></p>'
    expect(cleanPastedHtml(word)).toBe('<p>Hello</p><p><strong>World</strong></p>')
  })
  it('converts Word list paragraphs to a bulleted list', () => {
    const word =
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">-<span>&nbsp;</span></span>First</p>' +
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">-<span>&nbsp;</span></span>Second</p>'
    expect(cleanPastedHtml(word)).toBe('<ul><li>First</li><li>Second</li></ul>')
  })
  it('converts numbered Word list paragraphs to an ordered list', () => {
    const word =
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.<span>&nbsp;</span></span>First</p>' +
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2.<span>&nbsp;</span></span>Second</p>'
    expect(cleanPastedHtml(word)).toBe('<ol><li>First</li><li>Second</li></ol>')
  })
  it('flattens table rows to paragraphs', () => {
    expect(cleanPastedHtml('<table><tbody><tr><td>a</td><td><b>b</b></td></tr><tr><td>c</td></tr></tbody></table>'))
      .toBe('<p>a <strong>b</strong></p><p>c</p>')
  })
  it('drops images, keeps surrounding text', () => {
    expect(cleanPastedHtml('<p>x<img src="https://example.com/pic.png">y</p>')).toBe('xy')
  })
  it('drops empty and br-only paragraphs', () => {
    expect(cleanPastedHtml('<p><br></p><p>a</p><p></p>')).toBe('a')
  })
  it('unwraps a one-paragraph paste so it splices into the caret line', () => {
    expect(cleanPastedHtml('<div>just this</div>')).toBe('just this')
    // …but a multi-paragraph paste keeps its blocks
    expect(cleanPastedHtml('<div>one</div><div>two</div>')).toBe('<p>one</p><p>two</p>')
  })
  it('keeps real lists as-is and drops their styling', () => {
    expect(cleanPastedHtml('<ul style="margin:0"><li style="color:red">a</li></ul>'))
      .toBe('<ul><li>a</li></ul>')
  })
  it('removes scripts and styles with their content', () => {
    expect(cleanPastedHtml('<style>p{color:red}</style><p>a</p><script>x()</script>'))
      .toBe('a')
  })
  it('handles empty input', () => {
    expect(cleanPastedHtml('')).toBe('')
  })
})

describe('plainToRichHtml', () => {
  it('returns single-line text escaped but unwrapped', () => {
    expect(plainToRichHtml('hello & <world>')).toBe('hello &amp; &lt;world&gt;')
  })
  it('turns blank-line-separated chunks into paragraphs', () => {
    expect(plainToRichHtml('one\n\ntwo')).toBe('<p>one</p><p>two</p>')
  })
  it('turns single newlines into paragraphs too — one kind of break', () => {
    expect(plainToRichHtml('one\ntwo')).toBe('<p>one</p><p>two</p>')
  })
  it('normalises CRLF', () => {
    expect(plainToRichHtml('a\r\n\r\nb')).toBe('<p>a</p><p>b</p>')
  })
  it('handles empty input', () => {
    expect(plainToRichHtml('')).toBe('')
  })
})

describe('richToPlain', () => {
  it('passes plain strings through', () => {
    expect(richToPlain('hello world')).toBe('hello world')
  })
  it('strips inline markup', () => {
    expect(richToPlain('<b>hello</b> <em>world</em>')).toBe('hello world')
  })
  it('renders <br> as newline', () => {
    expect(richToPlain('a<br>b')).toBe('a\nb')
  })
  it('renders unordered lists with bullet markers', () => {
    const html = '<ul><li>a</li><li>b</li></ul>'
    expect(richToPlain(html)).toBe('• a\n• b')
  })
  it('renders ordered lists with numbers', () => {
    const html = '<ol><li>a</li><li>b</li></ol>'
    expect(richToPlain(html)).toBe('1. a\n2. b')
  })
  it('indents nested lists (li > ul nesting)', () => {
    expect(richToPlain('<ul><li>a<ul><li>b</li></ul></li></ul>')).toBe('• a\n  • b')
  })
  it('indents nested lists (ul > ul sibling nesting)', () => {
    expect(richToPlain('<ul><li>a</li><ul><li>b</li></ul></ul>')).toBe('• a\n  • b')
  })
  it('numbers nested ordered items per level', () => {
    expect(richToPlain('<ol><li>a<ol><li>b</li><li>c</li></ol></li></ol>'))
      .toBe('1. a\n  1. b\n  2. c')
  })
})

describe('renderRichHtml', () => {
  it('escapes an unmarked value and wraps it in a paragraph', () => {
    expect(renderRichHtml('5 < 6', escape)).toBe('<p>5 &lt; 6</p>')
  })
  it('paragraph-splits plain text so an imported CV reads like a typed one', () => {
    // Without this the newlines collapsed to spaces and the whole description
    // arrived in the preview/PDF as one slab of running text.
    expect(renderRichHtml('one\ntwo', escape)).toBe('<p>one</p><p>two</p>')
    expect(renderRichHtml('one\n\ntwo', escape)).toBe('<p>one</p><p>two</p>')
  })
  it('sanitises a marked-up value (does not escape)', () => {
    expect(renderRichHtml('<b>x</b>', escape)).toBe('<p><b>x</b></p>')
  })
  it('returns empty for empty input', () => {
    expect(renderRichHtml('', escape)).toBe('')
  })
})

describe('renderRichInlineHtml', () => {
  it('folds paragraphs into one line for a context that is already one line', () => {
    expect(renderRichInlineHtml('<p>a</p><p>b</p>', escape)).toBe('a b')
    expect(renderRichInlineHtml('one\ntwo', escape)).toBe('one two')
    expect(renderRichInlineHtml('<p><strong>x</strong></p>', escape)).toBe('<strong>x</strong>')
  })
  it('escapes plain text', () => {
    expect(renderRichInlineHtml('5 < 6', escape)).toBe('5 &lt; 6')
  })
})

describe('plainParagraphs', () => {
  it('treats every newline as a paragraph break', () => {
    expect(plainParagraphs('a\nb')).toEqual(['a', 'b'])
    expect(plainParagraphs('a\n\n\nb')).toEqual(['a', 'b'])
    expect(plainParagraphs('a\r\nb')).toEqual(['a', 'b'])
    expect(plainParagraphs('  spaced  ')).toEqual(['spaced'])
    expect(plainParagraphs('')).toEqual([])
  })

  it('handles a lone carriage return, as old Mac and some pastes use', () => {
    // The normalisation is \r\n? — the optional \n is what makes a bare \r a
    // break rather than an invisible character inside one paragraph.
    expect(plainParagraphs('a\rb')).toEqual(['a', 'b'])
    expect(plainParagraphs('a\r\r\nb')).toEqual(['a', 'b'])
  })
})

describe('paraGapEm', () => {
  it('is half a line box, so paragraphs sit 1.5 lines apart', () => {
    expect(PARA_GAP_LINES).toBe(0.5)
    expect(paraGapEm(1.5)).toBe(0.75)
    expect(paraGapEm(1.35)).toBe(0.675)
  })
})

describe('parseRichBlocks', () => {
  it('returns a single paragraph for plain text', () => {
    const blocks = parseRichBlocks('hello')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('paragraph')
    expect((blocks[0] as { runs: { text: string }[] }).runs[0].text).toBe('hello')
  })
  it('splits plain text on newlines, matching the HTML path', () => {
    // The DOCX/PDF twin of the renderRichHtml case above: a plain-text
    // description used to arrive in Word as one run-on paragraph.
    const blocks = parseRichBlocks('one\ntwo')
    expect(blocks).toHaveLength(2)
    expect((blocks[0] as { runs: { text: string }[] }).runs[0].text).toBe('one')
    expect((blocks[1] as { runs: { text: string }[] }).runs[0].text).toBe('two')
  })
  it('extracts bold/italic/underline flags on runs', () => {
    const blocks = parseRichBlocks('<b>bold</b> <i>italic</i> <u>under</u>')
    const runs = (blocks[0] as { runs: { text: string; bold?: boolean; italic?: boolean; underline?: boolean }[] }).runs
    expect(runs[0]).toMatchObject({ bold: true })
    expect(runs.some((r) => r.italic)).toBe(true)
    expect(runs.some((r) => r.underline)).toBe(true)
  })
  it('emits ordered list items with index', () => {
    const blocks = parseRichBlocks('<ol><li>a</li><li>b</li></ol>')
    const items = blocks.filter((b) => b.kind === 'list-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ ordered: true, index: 1 })
    expect(items[1]).toMatchObject({ ordered: true, index: 2 })
  })
  it('emits unordered list items as not ordered', () => {
    const blocks = parseRichBlocks('<ul><li>a</li></ul>')
    expect(blocks[0]).toMatchObject({ kind: 'list-item', ordered: false })
  })
  it('mixes paragraphs and lists in document order', () => {
    const blocks = parseRichBlocks('<p>intro</p><ul><li>a</li></ul>')
    expect(blocks[0].kind).toBe('paragraph')
    expect(blocks[1].kind).toBe('list-item')
  })
  it('emits li > ul nesting as deeper list items, without duplicating text', () => {
    const blocks = parseRichBlocks('<ul><li>a<ul><li>b</li></ul></li></ul>')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ kind: 'list-item', level: 0, index: 1 })
    expect((blocks[0] as { runs: { text: string }[] }).runs.map((r) => r.text).join('')).toBe('a')
    expect(blocks[1]).toMatchObject({ kind: 'list-item', level: 1, index: 1 })
    expect((blocks[1] as { runs: { text: string }[] }).runs.map((r) => r.text).join('')).toBe('b')
  })
  it('emits ul > ul sibling nesting as deeper list items', () => {
    const blocks = parseRichBlocks('<ul><li>a</li><ul><li>b</li></ul></ul>')
    expect(blocks[0]).toMatchObject({ kind: 'list-item', level: 0 })
    expect(blocks[1]).toMatchObject({ kind: 'list-item', level: 1 })
  })
})

/**
 * parseRichBlocks is the ONE parse every non-HTML renderer walks (DOCX, PDF,
 * plain text), so a branch it gets wrong is wrong in three exported documents
 * at once. walkBlocks had 52 mutants no test reached; these are its branches.
 */
describe('parseRichBlocks — the branches the renderers depend on', () => {
  type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean }
  const runsOf = (b: unknown): Run[] => (b as { runs: Run[] }).runs
  const textOf = (b: unknown): string => runsOf(b).map((r) => r.text).join('')

  it('keeps a <br> as a newline run inside the paragraph, not a new block', () => {
    // §4: inside an <li> a break stays a break. The parse must carry it as a
    // run rather than splitting, or the renderers get a bullet nobody wrote.
    const blocks = parseRichBlocks('<ul><li>one<br>two</li></ul>')
    expect(blocks).toHaveLength(1)
    expect(runsOf(blocks[0]).map((r) => r.text)).toEqual(['one', '\n', 'two'])
  })

  it('combines nested inline flags rather than replacing the outer one', () => {
    const blocks = parseRichBlocks('<p><b>bold <i>both</i></b></p>')
    const both = runsOf(blocks[0]).find((r) => r.text === 'both')
    expect(both).toMatchObject({ bold: true, italic: true })
  })

  it('carries an inline flag INTO a nested list item', () => {
    const blocks = parseRichBlocks('<b><ul><li>a</li></ul></b>')
    expect(runsOf(blocks[0])[0]).toMatchObject({ bold: true })
  })

  it('normalizes a stray <li> into a paragraph rather than a bullet', () => {
    // sanitizeRich runs FIRST, so an <li> with no enclosing list is already a
    // <p> by the time the walker sees it. The text survives either way; what
    // matters is that it is not emitted as a bullet nobody wrote.
    const blocks = parseRichBlocks('<li>orphan</li>')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('paragraph')
    expect(textOf(blocks[0])).toBe('orphan')
  })

  it('treats a value that merely CONTAINS non-allowlisted tags as plain text', () => {
    // hasMarkup only recognises the tags storage is canonicalised to. A stored
    // value never holds a <div>, so one in the text is something the user
    // typed — it must print, not silently vanish as markup.
    expect(textOf(parseRichBlocks('<div>x</div>')[0])).toBe('<div>x</div>')
  })

  it('restarts the ordered counter for each list', () => {
    const blocks = parseRichBlocks('<ol><li>a</li><li>b</li></ol><ol><li>c</li></ol>')
    expect(blocks.map((b) => (b as { index: number }).index)).toEqual([1, 2, 1])
  })

  it('restarts the counter for a nested list and does NOT resume the parent', () => {
    // The nested list gets its own counter; the parent continues from where it
    // was, so "1, 1, 2" is right and "1, 2, 3" would renumber the document.
    const blocks = parseRichBlocks('<ol><li>a<ol><li>x</li></ol></li><li>b</li></ol>')
    expect(blocks.map((b) => [(b as { level: number }).level, (b as { index: number }).index]))
      .toEqual([[0, 1], [1, 1], [0, 2]])
  })

  it('flushes pending inline text as its own paragraph before a list starts', () => {
    // Bare text followed by a list: without the flush the text is lost or
    // absorbed into the first bullet.
    const blocks = parseRichBlocks('lead in<ul><li>a</li></ul>')
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' })
    expect(textOf(blocks[0])).toBe('lead in')
    expect(blocks[1]).toMatchObject({ kind: 'list-item' })
  })

  it('emits nothing for an empty paragraph or an empty list item', () => {
    expect(parseRichBlocks('<p></p><p>  </p>')).toEqual([])
    expect(parseRichBlocks('<ul><li></li></ul>')).toEqual([])
  })

  it('splits a raw newline inside a paragraph into TWO blocks', () => {
    // §4: every break is a paragraph boundary, and the canonicalisation runs
    // before the walk — so the block structure the DOCX and PDF get agrees
    // with the HTML preview built from the same value.
    expect(parseRichBlocks('<p>a   \n  b</p>').map(textOf)).toEqual(['a', 'b'])
  })

  it('collapses whitespace WITHIN one line to a single space', () => {
    expect(textOf(parseRichBlocks('<p>a     b</p>')[0])).toBe('a b')
  })

  it('marks ol as ordered and ul as not, at every level', () => {
    const blocks = parseRichBlocks('<ul><li>a<ol><li>x</li></ol></li></ul>')
    expect(blocks[0]).toMatchObject({ ordered: false, level: 0 })
    expect(blocks[1]).toMatchObject({ ordered: true, level: 1 })
  })
})

describe('cleanPastedHtml — containers and inline-style edges', () => {
  it('treats every block container as a paragraph boundary', () => {
    // The set exists so a paste from any site breaks where it looks like it
    // breaks. Each of these was in the list with nothing exercising it.
    for (const tag of ['section', 'article', 'blockquote', 'aside', 'figure', 'address']) {
      expect(cleanPastedHtml(`<${tag}>one</${tag}><${tag}>two</${tag}>`), tag)
        .toBe('<p>one</p><p>two</p>')
    }
  })

  it('flattens a definition list to paragraphs', () => {
    expect(cleanPastedHtml('<dl><dt>Term</dt><dd>Meaning</dd></dl>'))
      .toBe('<p>Term</p><p>Meaning</p>')
  })

  it('reads numeric font-weight at the 600 boundary', () => {
    // 600 is bold, 500 is not — the regex covers [6-9]00, and an off-by-one
    // there silently bolds or unbolds every Google Docs paste.
    expect(cleanPastedHtml('<span style="font-weight:600">x</span>')).toBe('<strong>x</strong>')
    expect(cleanPastedHtml('<span style="font-weight:500">x</span>')).toBe('x')
    expect(cleanPastedHtml('<span style="font-weight:bolder">x</span>')).toBe('<strong>x</strong>')
  })

  it('lets an inline style override the TAG in both directions', () => {
    // The attribute wins either way: a styled span becomes bold, and a <b>
    // styled normal does not stay bold.
    expect(cleanPastedHtml('<p><b style="font-weight:normal">x</b></p>')).toBe('x')
    expect(cleanPastedHtml('<p><span style="font-style:oblique">x</span></p>')).toBe('<em>x</em>')
  })

  it('reads the longhand text-decoration-line as well as the shorthand', () => {
    expect(cleanPastedHtml('<span style="text-decoration-line:underline">x</span>')).toBe('<u>x</u>')
    expect(cleanPastedHtml('<span style="text-decoration:none">x</span>')).toBe('x')
  })

  it('does not read a style property whose name is a suffix of another', () => {
    // The matcher anchors on `^` or `;` so `font-style` cannot satisfy a lookup
    // for `style`, and `-weight` cannot satisfy `font-weight`.
    expect(cleanPastedHtml('<span style="font-style:italic">x</span>')).toBe('<em>x</em>')
  })
})

/**
 * richToPlain's list rendering — 24 survivors in nodeText alone.
 *
 * This is the ATS/plain-text view of a description and the text an AI assist
 * reads, so structure has to survive without markup: lists keep visible markers
 * and nested items keep visible indentation, because whitespace alone would
 * lose the shape entirely.
 */
describe('richToPlain — list structure in plain text', () => {
  it('prefixes unordered items with a bullet', () => {
    expect(richToPlain('<ul><li>First</li><li>Second</li></ul>'))
      .toBe('• First\n• Second')
  })

  it('numbers ordered items by their position among the LI siblings', () => {
    expect(richToPlain('<ol><li>First</li><li>Second</li><li>Third</li></ol>'))
      .toBe('1. First\n2. Second\n3. Third')
  })

  it('numbers from 1, not from 0', () => {
    expect(richToPlain('<ol><li>Only</li></ol>')).toBe('1. Only')
  })

  it('indents a nested list one level deeper', () => {
    // Two spaces per level of enclosing list — the only thing carrying the
    // hierarchy once the tags are gone.
    expect(richToPlain('<ul><li>Top<ul><li>Nested</li></ul></li></ul>'))
      .toBe('• Top\n  • Nested')
  })

  it('indents a doubly-nested list two levels', () => {
    expect(richToPlain('<ul><li>A<ul><li>B<ul><li>C</li></ul></li></ul></li></ul>'))
      .toBe('• A\n  • B\n    • C')
  })

  it('keeps a nested ORDERED list numbered independently', () => {
    expect(richToPlain('<ul><li>Top<ol><li>One</li><li>Two</li></ol></li></ul>'))
      .toBe('• Top\n  1. One\n  2. Two')
  })

  it('separates an item’s own text from its sub-list', () => {
    // Without the split the sub-items would be glued onto the parent's line.
    const out = richToPlain('<ul><li>Parent<ul><li>Child</li></ul></li></ul>')
    expect(out.split('\n')[0]).toBe('• Parent')
  })

  it('numbers by LI position even when a sub-list is a direct child', () => {
    // ul > ul sibling nesting puts a non-LI element among the children; counting
    // it would shift every number after it.
    expect(richToPlain('<ol><li>a</li><ul><li>x</li></ul><li>b</li></ol>').split('\n'))
      .toEqual(['1. a', '  • x', '2. b'])
  })

  it('does not add a blank line between a list and the paragraph after it', () => {
    // A paragraph ends with a newline; a list must not, or every list is
    // followed by a gap the user never asked for.
    expect(richToPlain('<ul><li>a</li></ul><p>b</p>').split('\n')).toEqual(['• a', 'b'])
  })

  it('turns a <br> into a real newline', () => {
    expect(richToPlain('<p>One<br>Two</p>')).toBe('One\nTwo')
  })

  it('collapses a whitespace run — including a source newline — to one space', () => {
    // Source formatting is not content; HTML renders it as a single space.
    expect(richToPlain('<p>One\n   Two</p>')).toBe('One Two')
    expect(richToPlain('<p>One\t\tTwo</p>')).toBe('One Two')
  })

  it('keeps the leading indentation of a nested item, collapsing only inner runs', () => {
    // The collapse is anchored on a preceding non-space so line-leading padding
    // survives; a blanket collapse would flatten the hierarchy.
    const out = richToPlain('<ul><li>Top<ul><li>Nested   text</li></ul></li></ul>')
    expect(out).toBe('• Top\n  • Nested text')
  })

  it('ends a paragraph with a newline but a list without a trailing blank', () => {
    expect(richToPlain('<p>One.</p><p>Two.</p>')).toBe('One.\nTwo.')
  })

  it('collapses three or more newlines to a blank line at most', () => {
    expect(richToPlain('<p>One.</p><p></p><p></p><p>Two.</p>')).not.toMatch(/\n\n\n/)
  })

  it('trims the result', () => {
    expect(richToPlain('<p>  Spaced  </p>')).toBe('Spaced')
  })

  it('takes the fast path for plain text, returning it unchanged', () => {
    // Including whitespace a DOM round-trip would collapse — the value is not
    // markup, so it is not reformatted.
    expect(richToPlain('two   spaces')).toBe('two   spaces')
  })

  it('is empty for empty input', () => {
    expect(richToPlain('')).toBe('')
  })

  it('reads inline formatting as its text, dropping the tags', () => {
    expect(richToPlain('<p>Ran <strong>fast</strong> and <em>quietly</em>.</p>'))
      .toBe('Ran fast and quietly.')
  })
})

/**
 * Loose content pasted INSIDE a list.
 *
 * `sanitizeRich` wraps bare inline content at the root in a `<p>` (that is the
 * canonical shape, CLAUDE.md §4), but content sitting directly inside a `<ul>` —
 * which is what a paste from a web page produces — has no such wrapper and is
 * walked as part of the list. It is the one route into `parseRichBlocks`'
 * loose-content handling, and it must not lose or reorder the author's words.
 */
describe('parseRichBlocks — loose content inside a list', () => {
  it('keeps loose text ABOVE the items it was written above', () => {
    expect(parseRichBlocks('<ul>Tools used<li>Go</li><li>Rust</li></ul>')).toEqual([
      { kind: 'paragraph', runs: [{ text: 'Tools used' }] },
      { kind: 'list-item', ordered: false, level: 0, index: 1, runs: [{ text: 'Go' }] },
      { kind: 'list-item', ordered: false, level: 0, index: 2, runs: [{ text: 'Rust' }] },
    ])
  })

  it('keeps the formatting of loose inline content', () => {
    expect(parseRichBlocks('<ul><strong>Tools</strong> used<li>Go</li></ul>')).toEqual([
      { kind: 'paragraph', runs: [{ text: 'Tools', bold: true }, { text: ' used' }] },
      { kind: 'list-item', ordered: false, level: 0, index: 1, runs: [{ text: 'Go' }] },
    ])
  })

  it('honours every inline tag in loose content, not just <strong>', () => {
    // The editor writes <strong>/<em>, a paste can carry <b>/<i>/<u>, and each
    // tag is tested separately in the walker.
    const flagsFor = (html: string) => {
      const first = parseRichBlocks(`<ul>${html}<li>Go</li></ul>`)[0]
      return first.runs[0]
    }
    expect(flagsFor('<b>x</b>')).toEqual({ text: 'x', bold: true })
    expect(flagsFor('<strong>x</strong>')).toEqual({ text: 'x', bold: true })
    expect(flagsFor('<em>x</em>')).toEqual({ text: 'x', italic: true })
    expect(flagsFor('<i>x</i>')).toEqual({ text: 'x', italic: true })
    expect(flagsFor('<u>x</u>')).toEqual({ text: 'x', underline: true })
    // Plain loose text carries no flags at all.
    expect(flagsFor('x')).toEqual({ text: 'x' })
  })

  it('keeps a nested inline’s flags alongside the outer one', () => {
    const first = parseRichBlocks('<ul><strong>bold <em>and italic</em></strong><li>Go</li></ul>')[0]
    expect(first.runs).toEqual([
      { text: 'bold ', bold: true },
      { text: 'and italic', bold: true, italic: true },
    ])
  })

  it('turns a break in loose content into a break, not a lost line', () => {
    expect(parseRichBlocks('<ul>one<br>two<li>Go</li></ul>')).toEqual([
      { kind: 'paragraph', runs: [{ text: 'one' }, { text: '\n' }, { text: 'two' }] },
      { kind: 'list-item', ordered: false, level: 0, index: 1, runs: [{ text: 'Go' }] },
    ])
  })

  it('collapses runs of whitespace in loose text, keeping a blank line as a break', () => {
    // A blank line inside a list becomes a <br> (splitting there would invent a
    // bullet nobody wrote) and the spaces around the words collapse to one.
    expect(parseRichBlocks('<ul>Tools   used\n\nhere<li>Go</li></ul>')[0])
      .toEqual({ kind: 'paragraph', runs: [{ text: 'Tools used' }, { text: '\n' }, { text: 'here' }] })
  })

  it('ignores the whitespace BETWEEN items rather than inventing a paragraph', () => {
    expect(parseRichBlocks('<ul> <li>Go</li> <li>Rust</li> </ul>').map((b) => b.kind))
      .toEqual(['list-item', 'list-item'])
  })

  it('numbers an ordered list from one, loose text or not', () => {
    const blocks = parseRichBlocks('<ol>Ranking<li>First</li><li>Second</li></ol>')
    expect(blocks.map((b) => ('index' in b ? b.index : 'p'))).toEqual(['p', 1, 2])
    expect(blocks.filter((b) => b.kind === 'list-item').every((b) => 'ordered' in b && b.ordered)).toBe(true)
  })

  it('drops a stray <li> that has no list around it — the sanitiser makes it a paragraph', () => {
    // Reached through the sanitiser, an orphan item is already a paragraph, so
    // the guard is what stops a bare one being emitted with a bullet.
    expect(parseRichBlocks('<li>Orphan</li>')).toEqual([
      { kind: 'paragraph', runs: [{ text: 'Orphan' }] },
    ])
  })
})

/**
 * Word's fake lists.
 *
 * Word pastes each list item as a `<p class="MsoListParagraph" style="mso-list:…">`
 * with the bullet glyph in an `mso-list:Ignore` span. Recognising that is a
 * heuristic, and the heuristic is the feature: miss it and a pasted CV section
 * arrives as a run of paragraphs each starting with a stray "·".
 */
describe('cleanPastedHtml — Word list detection', () => {
  const wordItem = (text: string, marker = '·', attrs = 'class="MsoListParagraph" style="mso-list:l0 level1 lfo1"') =>
    `<p ${attrs}><span style="mso-list:Ignore">${marker}<span>&nbsp;</span></span>${text}</p>`

  it('recognises an item by its CLASS alone', () => {
    const out = cleanPastedHtml(`${wordItem('First', '·', 'class="MsoListParagraph"')}`)
    expect(out).toContain('<li>')
    expect(out).toContain('First')
  })

  it('recognises an item by its mso-list STYLE alone', () => {
    const out = cleanPastedHtml(`${wordItem('First', '·', 'style="mso-list:l0 level1 lfo1"')}`)
    expect(out).toContain('<li>')
  })

  it('tolerates whitespace around the mso-list colon', () => {
    const out = cleanPastedHtml(`${wordItem('First', '·', 'style="mso-list : l0 level1 lfo1"')}`)
    expect(out).toContain('<li>')
  })

  it('leaves an ordinary Word paragraph as a paragraph', () => {
    const out = cleanPastedHtml('<p class="MsoNormal">Just prose</p>')
    expect(out).not.toContain('<li>')
    expect(out).toContain('Just prose')
  })

  it('strips the marker glyph rather than printing it in the item', () => {
    const out = cleanPastedHtml(wordItem('First'))
    expect(out).not.toContain('\u00b7')
    expect(out).toMatch(/<li>\s*First/)
  })

  it('makes an ORDERED list when the first marker reads like a number', () => {
    const out = cleanPastedHtml(`${wordItem('First', '1.')}${wordItem('Second', '2.')}`)
    expect(out).toContain('<ol>')
    expect(out).not.toContain('<ul>')
  })

  it('accepts either "1." or "1)" as a number, and only at the START of the marker', () => {
    expect(cleanPastedHtml(wordItem('First', '1)'))).toContain('<ol>')
    // A bullet that merely mentions a digit is not a numbered list: only
    // whitespace may precede the number, so a glyph in front rules it out.
    expect(cleanPastedHtml(wordItem('First', '\u00b7 2.'))).toContain('<ul>')
    expect(cleanPastedHtml(wordItem('First', '\u00b72.'))).toContain('<ul>')
    expect(cleanPastedHtml(wordItem('First', '  3. '))).toContain('<ol>')
  })

  it('reads the list KIND from the first marker, not a later one', () => {
    // Word writes the same marker on every item; a mixed group is a paste
    // artefact, and the first item is the one that decides.
    const out = cleanPastedHtml(`${wordItem('First', '\u00b7')}${wordItem('Second', '2.')}`)
    expect(out).toContain('<ul>')
    expect(out).not.toContain('<ol>')
  })

  it('handles a multi-digit number', () => {
    expect(cleanPastedHtml(wordItem('Tenth', '10.'))).toContain('<ol>')
  })

  it('groups consecutive items into ONE list and starts a new one after prose', () => {
    const out = cleanPastedHtml(
      `${wordItem('First')}${wordItem('Second')}<p class="MsoNormal">Prose</p>${wordItem('Third')}`,
    )
    expect((out.match(/<ul>/g) ?? []).length).toBe(2)
    expect((out.match(/<li>/g) ?? []).length).toBe(3)
    // The prose stays between the two lists rather than being swallowed.
    expect(out.indexOf('Prose')).toBeGreaterThan(out.indexOf('Second'))
    expect(out.indexOf('Prose')).toBeLessThan(out.indexOf('Third'))
  })

  it('keeps the item text in document order', () => {
    const out = cleanPastedHtml(`${wordItem('First')}${wordItem('Second')}`)
    expect(out.indexOf('First')).toBeLessThan(out.indexOf('Second'))
  })

  it('handles a Word list item that carries no marker span at all', () => {
    // Word omits the glyph span for some list styles; reaching for it blindly
    // would throw in the middle of a paste.
    const out = cleanPastedHtml('<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">First</p>')
    expect(out).toContain('<li>')
    expect(out).toContain('First')
  })

  it('does not pull a non-paragraph sibling into the list', () => {
    // The grouping walks siblings; only paragraphs are Word list items, and a
    // container that happens to carry the class is not one.
    const out = cleanPastedHtml(
      `${wordItem('First')}<div class="MsoListParagraph">Not an item</div>`,
    )
    expect((out.match(/<li>/g) ?? []).length).toBe(1)
    expect(out).toContain('Not an item')
  })

  it('collapses the whitespace a paste carries, including non-breaking spaces', () => {
    const out = cleanPastedHtml('<p>Two\u00a0\u00a0words   here</p>')
    expect(out).toContain('Two words here')
  })

  it('collapses whitespace inside NESTED elements too', () => {
    const out = cleanPastedHtml('<p><strong>Two   words</strong>   after</p>')
    expect(out).toContain('Two words')
    expect(out).not.toContain('   ')
  })
})

/**
 * Formatting read off PASTED markup.
 *
 * Word and Google Docs do not paste `<b>`; they paste `<span style="font-weight:700">`
 * — and, worse, they wrap runs in `<b style="font-weight:normal">`, where the tag
 * says bold and the style says otherwise. Whichever the paste says has to survive
 * the allowlist, or the consultant loses the emphasis they already applied.
 */
describe('cleanPastedHtml — formatting carried by inline style', () => {
  const clean = (html: string) => sanitizeRich(cleanPastedHtml(html))

  it('reads bold from a numeric font-weight', () => {
    for (const w of ['700', '600', '800', '900', 'bold', 'bolder']) {
      expect(clean(`<p><span style="font-weight:${w}">X</span></p>`), w).toContain('<strong>X</strong>')
    }
  })

  it('does NOT read bold from a normal or light weight', () => {
    for (const w of ['400', '300', 'normal', '500'] as const) {
      expect(clean(`<p><span style="font-weight:${w}">X</span></p>`), w).not.toContain('<strong>')
    }
  })

  it('lets an explicit weight OVERRIDE the tag, in both directions', () => {
    // The Google Docs case: <b style="font-weight:normal"> wraps everything.
    expect(clean('<p><b style="font-weight:normal">X</b></p>')).not.toContain('<strong>')
    expect(clean('<p><span style="font-weight:700">X</span></p>')).toContain('<strong>')
  })

  it('reads italic from font-style, and lets it override the tag', () => {
    expect(clean('<p><span style="font-style:italic">X</span></p>')).toContain('<em>X</em>')
    expect(clean('<p><span style="font-style:oblique">X</span></p>')).toContain('<em>X</em>')
    expect(clean('<p><i style="font-style:normal">X</i></p>')).not.toContain('<em>')
  })

  it('reads underline from either text-decoration property', () => {
    expect(clean('<p><span style="text-decoration-line:underline">X</span></p>')).toContain('<u>X</u>')
    expect(clean('<p><span style="text-decoration:underline">X</span></p>')).toContain('<u>X</u>')
    expect(clean('<p><span style="text-decoration:line-through">X</span></p>')).not.toContain('<u>')
    expect(clean('<p><u style="text-decoration:none">X</u></p>')).not.toContain('<u>')
  })

  it('keeps the tag\u2019s own meaning when no style says otherwise', () => {
    expect(clean('<p><b>X</b></p>')).toContain('<strong>X</strong>')
    expect(clean('<p><strong>X</strong></p>')).toContain('<strong>X</strong>')
    expect(clean('<p><i>X</i></p>')).toContain('<em>X</em>')
    expect(clean('<p><em>X</em></p>')).toContain('<em>X</em>')
    expect(clean('<p><u>X</u></p>')).toContain('<u>X</u>')
  })
})

describe('cleanPastedHtml — wrapping loose content into paragraphs', () => {
  const clean = (html: string) => sanitizeRich(cleanPastedHtml(html))

  it('wraps loose text between blocks into its own paragraph', () => {
    const out = clean('Alpha<div>Beta</div>Gamma')
    expect(out).toContain('<p>Alpha</p>')
    expect(out).toContain('<p>Gamma</p>')
  })

  it('drops a run that holds nothing but whitespace', () => {
    // Word pastes newlines and non-breaking spaces between blocks; each would
    // otherwise become an empty paragraph the user has to delete by hand.
    const nbsp = String.fromCharCode(160)
    const out = clean(`<div>Alpha</div>   ${nbsp} <div>Beta</div>`)
    expect(out).not.toContain('<p></p>')
    expect(out.match(/<p>/g) ?? []).toHaveLength(2)
  })

  it('keeps a run whose only content is a line BREAK', () => {
    // A break is content: it is the blank line the author put between two
    // paragraphs, and dropping it merges them.
    const out = clean('<div>Alpha</div><br><div>Beta</div>')
    expect(out).toContain('Alpha')
    expect(out).toContain('Beta')
  })
})

describe('richToPlain — list markers', () => {
  it('numbers an ordered list from one, in document order', () => {
    expect(richToPlain('<ol><li>Alpha</li><li>Beta</li><li>Gamma</li></ol>'))
      .toBe('1. Alpha\n2. Beta\n3. Gamma')
  })

  it('bullets an unordered list', () => {
    expect(richToPlain('<ul><li>Alpha</li><li>Beta</li></ul>')).toBe('\u2022 Alpha\n\u2022 Beta')
  })

  it('counts only the LIST ITEMS when numbering, not other children', () => {
    // A pasted list can carry stray nodes between the items; counting those
    // would renumber every item after the first.
    expect(richToPlain('<ol><li>Alpha</li> <li>Beta</li></ol>')).toContain('2. Beta')
  })

  it('separates two paragraphs with a single newline, and trims the tail', () => {
    expect(richToPlain('<p>Alpha</p><p>Beta</p>')).toBe('Alpha\nBeta')
  })
})

/**
 * The ONE kind of line break (CLAUDE.md §4).
 *
 * A value can encode "new line" three ways — a `<br>`, a raw newline in a text
 * node, a blank line — and each used to render differently per target. The
 * sanitiser canonicalises all of them, so these assert the conversion itself
 * rather than a downstream render.
 */
describe('sanitizeRich — raw newlines become real breaks', () => {
  const NL = String.fromCharCode(10)

  it('turns a newline inside a paragraph into a paragraph boundary', () => {
    const out = sanitizeRich(`<p>First${NL}Second</p>`)
    expect(out).toBe('<p>First</p><p>Second</p>')
  })

  it('normalises CRLF and a lone CR the same way', () => {
    const CR = String.fromCharCode(13)
    expect(sanitizeRich(`<p>First${CR}${NL}Second</p>`)).toBe('<p>First</p><p>Second</p>')
    expect(sanitizeRich(`<p>First${CR}Second</p>`)).toBe('<p>First</p><p>Second</p>')
  })

  it('keeps a break inside a LIST ITEM as a break, not a new bullet', () => {
    // Splitting there would invent a bullet nobody wrote.
    const out = sanitizeRich(`<ul><li>First${NL}Second</li></ul>`)
    expect(out).toContain('<br>')
    expect(out.match(/<li>/g) ?? []).toHaveLength(1)
  })

  it('drops the layout whitespace BETWEEN list items', () => {
    // Pretty-printed markup indents its <li>s; that whitespace renders as
    // nothing, so carrying it into the canonical value is noise in every diff.
    const out = sanitizeRich(`<ul>${NL}  <li>First</li>${NL}  <li>Second</li>${NL}</ul>`)
    expect(out).toBe('<ul><li>First</li><li>Second</li></ul>')
  })

  it('leaves a text node that has no newline alone', () => {
    expect(sanitizeRich('<p>First  Second</p>')).toBe('<p>First  Second</p>')
  })

  it('leaves whitespace-only text outside a list alone rather than breaking it up', () => {
    expect(sanitizeRich(`<p>A</p>${NL}<p>B</p>`)).toBe('<p>A</p><p>B</p>')
  })
})

describe('sanitizeRich — the tag allowlist', () => {
  it('unwraps a disallowed element, keeping its children', () => {
    // Unwrap rather than drop: the words the consultant typed are the point,
    // and a <div> from a paste carries all of them.
    expect(sanitizeRich('<p><span>Alpha</span> <font color="red">Beta</font></p>'))
      .toBe('<p>Alpha Beta</p>')
  })

  it('strips every attribute from an allowed element', () => {
    // Attributes are the injection surface: style, class, and above all href /
    // on* handlers. None of them are needed by any renderer.
    const out = sanitizeRich('<p class="x" style="color:red" onclick="alert(1)"><strong id="y">Alpha</strong></p>')
    expect(out).toBe('<p><strong>Alpha</strong></p>')
  })

  it('drops a script or style element entirely, not just its tag', () => {
    // SECURITY: unwrapping these would move their TEXT into the document, so a
    // script body would render as visible prose.
    const out = sanitizeRich('<p>Alpha</p><script>alert(1)</script><style>p{}</style>')
    expect(out).not.toContain('alert(1)')
    expect(out).not.toContain('p{}')
    expect(out).toContain('Alpha')
  })
})

/**
 * The canonicalisation's quieter half: what must NOT become a break.
 *
 * Pretty-printed markup puts whitespace — often a newline — between tags. HTML
 * has always rendered that as nothing, so treating it as a break would split a
 * sentence in two every time a value passed through a formatter.
 */
describe('sanitizeRich — whitespace between tags is layout, not a break', () => {
  const NL = String.fromCharCode(10)

  it('keeps a newline that sits BETWEEN two inline tags inside one paragraph', () => {
    expect(sanitizeRich(`<p><strong>a</strong>${NL}<strong>b</strong></p>`))
      .toBe(`<p><strong>a</strong>${NL}<strong>b</strong></p>`)
  })

  it('keeps such a paragraph as ONE paragraph even with real text either side', () => {
    const out = sanitizeRich(`<p>a <strong>b</strong>${NL}<strong>c</strong> d</p>`)
    expect(out.match(/<p>/g) ?? []).toHaveLength(1)
  })

  it('keeps a newline between two inline tags inside a LIST ITEM as layout', () => {
    // Inside a list a real break becomes a <br>; this one is not a real break,
    // so promoting it would draw a line the author never typed.
    expect(sanitizeRich(`<ul><li><strong>a</strong>${NL}<strong>b</strong></li></ul>`))
      .toBe(`<ul><li><strong>a</strong>${NL}<strong>b</strong></li></ul>`)
  })

  it('keeps a plain space between two inline tags inside a list item', () => {
    // The between-items whitespace drop is scoped to the children of the <ul>
    // itself; inside an <li> the space is the space between two words.
    expect(sanitizeRich('<ul><li><strong>a</strong> <strong>b</strong></li></ul>'))
      .toBe('<ul><li><strong>a</strong> <strong>b</strong></li></ul>')
  })

  it('trims the space a split leaves at the edge of the SECOND half', () => {
    // The break lands before an inline element, so the leading space belongs to
    // the text inside it — an untrimmed edge shows up as a stray indent.
    expect(sanitizeRich(`<p>a${NL}<strong> x</strong></p>`))
      .toBe('<p>a</p><p><strong>x</strong></p>')
  })
})

describe('sanitizeRich — the inline wrappers a split leaves behind', () => {
  it('drops an inline wrapper the split emptied', () => {
    // The break sits at the END of the bold run, so the rebuilt <strong> in the
    // second paragraph gets nothing — shipping it would wrap the next words in
    // a bold tag the author had already closed.
    expect(sanitizeRich('<p><strong>a<br></strong>b</p>'))
      .toBe('<p><strong>a</strong></p><p>b</p>')
  })

  it('drops one left holding only whitespace', () => {
    expect(sanitizeRich('<p><strong>a<br> </strong>b</p>'))
      .toBe('<p><strong>a</strong></p><p>b</p>')
  })
})

describe('sanitizeRich — collapsing breaks across whitespace', () => {
  it('collapses two <br> separated by a space, as a paste routinely carries', () => {
    // Word and Google Docs write the blank line as "<br> <br>"; without looking
    // past the whitespace the run survives and every paste grows a blank line.
    expect(sanitizeRich('<ul><li>a<br> <br>b</li></ul>')).toBe('<ul><li>a <br>b</li></ul>')
  })
})

describe('sanitizeRich — the allowlist inside a list item', () => {
  it('unwraps a disallowed element nested in an <li>', () => {
    // SECURITY: <li> content is not paragraph-split, so it is the path where an
    // un-unwrapped tag would survive into the stored value and every export.
    expect(sanitizeRich('<ul><li><span>hi</span></li></ul>')).toBe('<ul><li>hi</li></ul>')
    expect(sanitizeRich('<ul><li><a href="http://x">link</a></li></ul>'))
      .toBe('<ul><li>link</li></ul>')
  })
})

describe('hasMarkup — the empty value', () => {
  it('is false for an empty string rather than probing it', () => {
    expect(hasMarkup('')).toBe(false)
  })
})

describe('plainToRichHtml — when a single line still needs its paragraph', () => {
  it('wraps a line that carries a trailing newline', () => {
    // Unwrapping is for text with no break in it at all; a value ending in a
    // newline has one, and splicing it into the caret's paragraph would lose it.
    expect(plainToRichHtml('a\n')).toBe('<p>a</p>')
  })
})

/**
 * The run-grouping inside a pasted container.
 *
 * A container's children mix bare text with blocks. Each contiguous inline run
 * becomes its own paragraph, and a run with nothing visible in it is dropped
 * rather than shipped as an empty paragraph the user has to delete by hand.
 */
describe('cleanPastedHtml — grouping a container’s children', () => {
  it('drops an inner container holding only whitespace, joining the text around it', () => {
    expect(cleanPastedHtml('<div>Alpha<div> </div>Beta</div>')).toBe('AlphaBeta')
  })

  it('drops an inner container holding only an empty inline wrapper', () => {
    // An emptied <i> is not content — Word leaves these behind constantly.
    expect(cleanPastedHtml('<div>Alpha<div><i></i></div>Beta</div>')).toBe('AlphaBeta')
  })

  it('keeps an inner container whose only content is a BREAK', () => {
    // A break IS content: it is the blank line the author put between two
    // paragraphs, and dropping it merges them into one.
    expect(cleanPastedHtml('<div>Alpha<div><br></div>Beta</div>'))
      .toBe('<p>Alpha</p><p>Beta</p>')
  })

  it('keeps a run that mixes text with whitespace rather than dropping the lot', () => {
    // The run has content if ANY node does; requiring all of them loses the
    // words next to a stray space.
    expect(cleanPastedHtml('<div>Alpha<span> </span><p>Beta</p></div>'))
      .toBe('<p>Alpha</p><p>Beta</p>')
  })

  it('makes a paragraph of each run either side of a block child', () => {
    expect(cleanPastedHtml('<div>Alpha<p>X</p>Beta</div>'))
      .toBe('<p>Alpha</p><p>X</p><p>Beta</p>')
  })

  it('does not break a run at an INLINE child', () => {
    // Only block-level children end a run; splitting at an <em> would put every
    // emphasised phrase on its own line.
    expect(cleanPastedHtml('<div>Alpha<em>x</em>Beta</div>')).toBe('Alpha<em>x</em>Beta')
  })
})

describe('cleanPastedHtml — elements the normaliser must leave alone', () => {
  it('keeps a <br> so the sanitiser can turn it into a paragraph boundary', () => {
    // Rebuilding a <br> from its (empty) formatting flags would delete it, and
    // the two lines the author wrote would run together.
    expect(cleanPastedHtml('<p>Alpha<br>Beta</p>')).toBe('<p>Alpha</p><p>Beta</p>')
  })

  it('keeps a header cell for the row handler to join', () => {
    // <th> is left to the <tr> branch like <td>; unwrapping it first would lift
    // its text out of the cell list and lose the column heading.
    expect(cleanPastedHtml('<table><tr><th>Head</th><td>Cell</td></tr></table>'))
      .toBe('Head Cell')
  })
})

describe('cleanPastedHtml — reading a style declaration', () => {
  it('falls back to the tag when the declaration has no value', () => {
    // An empty declaration is not an override: <b> with a blank font-weight is
    // still the bold the author applied.
    expect(cleanPastedHtml('<p><b style="font-weight: ">X</b></p>')).toBe('<strong>X</strong>')
  })

  it('does not read a weight that merely CONTAINS a bold number', () => {
    // The match is anchored at the start of the value, so a stray digit run
    // cannot bold a paste.
    expect(cleanPastedHtml('<span style="font-weight:1600">x</span>')).toBe('x')
  })
})

/**
 * Pasting from Word or a browser: loose text and stray containers.
 *
 * `cleanPastedHtml` wraps contiguous inline/text runs into paragraphs so a
 * container can be unwrapped without its stray text merging into the surrounding
 * flow. What counts as "visible content" decides whether a run becomes a
 * paragraph or is thrown away — and throwing away a run the user pasted loses
 * their text silently.
 */
describe('cleanPastedHtml — which runs survive the wrap', () => {
  it('keeps a run whose only content is a line break', () => {
    // A deliberate blank line between two pasted paragraphs is content: it has no
    // text, and dropping it welds the two paragraphs together.
    const out = cleanPastedHtml('<div>First</div><div><br></div><div>Second</div>')
    expect(out).toContain('First')
    expect(out).toContain('Second')
    expect(richToPlain(out)).not.toBe('FirstSecond')
  })

  it('keeps a run whose break is nested inside an inline wrapper', () => {
    // Word wraps almost everything in <span>; the break has to be found through
    // it, not just at the top of the run.
    const out = cleanPastedHtml('<div>First</div><div><span><br></span></div><div>Second</div>')
    expect(out).toContain('First')
    expect(out).toContain('Second')
  })

  it('drops a run that is only whitespace', () => {
    // The whitespace between block tags in pasted markup is not content; wrapping
    // it produces an empty paragraph the user cannot see or delete.
    const nl = String.fromCharCode(10)
    const out = cleanPastedHtml(`<div>First</div>   ${nl}   <div>Second</div>`)
    expect(out).not.toContain('<p></p>')
  })

  it('drops a run of non-breaking spaces, which Word emits by the dozen', () => {
    const nbsp = String.fromCharCode(0xa0)
    const out = cleanPastedHtml(`<div>First</div><div>${nbsp}${nbsp}</div><div>Second</div>`)
    expect(out).not.toContain('<p></p>')
  })

  it('keeps a run where only PART of it is blank', () => {
    // One blank node beside a text node must not condemn the whole run — that is
    // the difference between "some node has content" and "every node has content".
    const out = cleanPastedHtml('<div><span> </span>Real text<span> </span></div>')
    expect(richToPlain(out)).toContain('Real text')
  })
})

/**
 * The canonical form, at its edges.
 *
 * A sanitised value has to encode "new line" exactly ONE way, because the same
 * value is drawn by four renderers: a stray break, an empty inline wrapper or a
 * leading space at a paragraph edge each render differently in the editor, the
 * HTML preview, the PDF and Word.
 */
describe('sanitizeRich — the empty inline wrappers a split leaves behind', () => {
  const nl = String.fromCharCode(10)

  it('drops an inline wrapper left holding nothing', () => {
    // Splitting a formatted line rebuilds the formatting around each half; the
    // half with no text keeps an empty <strong>, which renders as a stray gap.
    expect(sanitizeRich('<p><strong></strong>Real text</p>')).not.toContain('<strong>')
    expect(sanitizeRich('<p><em>   </em>Real text</p>')).not.toContain('<em>')
  })

  it('drops one nested inside another', () => {
    // The prune recurses: Word nests spans and emphasis several deep, and only
    // the innermost is empty at first.
    const out = sanitizeRich('<p><strong><em></em></strong>Real text</p>')
    expect(out).not.toContain('<em>')
    expect(out).not.toContain('<strong>')
  })

  it('keeps a wrapper that still has text', () => {
    expect(sanitizeRich('<p><strong>Bold</strong> and plain</p>')).toContain('<strong>Bold</strong>')
  })

  it('trims the whitespace a split leaves at each paragraph edge', () => {
    // The leading space is invisible in the editor and shows up as an indent in
    // the PDF, which is the kind of difference nobody can explain later.
    const out = sanitizeRich(`<p>  First line${nl}Second line  </p>`)
    expect(out).not.toContain('<p> ')
    expect(out).not.toContain(' </p>')
    expect(richToPlain(out)).toContain('First line')
    expect(richToPlain(out)).toContain('Second line')
  })
})

describe('sanitizeRich — a newline inside a list stays a break', () => {
  const nl = String.fromCharCode(10)

  it('turns a newline next to text into a <br>, not a new bullet', () => {
    // Splitting inside a list item would invent a bullet the user never wrote.
    const out = sanitizeRich(`<ul><li>First half${nl}second half</li></ul>`)
    expect(out).toContain('<br>')
    expect(out.match(/<li>/g)).toHaveLength(1)
  })

  it('drops the layout whitespace BETWEEN list items', () => {
    // Pretty-printed markup carries indentation between <li> tags; HTML renders
    // it as nothing, and carrying it into the canonical value would make an
    // idempotent re-sanitise produce a different string.
    const out = sanitizeRich(`<ul>${nl}  <li>One</li>${nl}  <li>Two</li>${nl}</ul>`)
    expect(out).toBe(sanitizeRich(out))
    expect(out).not.toContain('<br>')
  })

  it('leaves a whitespace-only newline outside a list alone', () => {
    // The newline between two pretty-printed paragraph tags has always
    // rendered as nothing in HTML — it is not a break the user typed.
    const out = sanitizeRich(`<p>One</p>${nl}<p>Two</p>`)
    expect(out).not.toContain('<br>')
    expect(out.match(/<p>/g)).toHaveLength(2)
  })
})

/**
 * The allowlist, and the break normalisation around it.
 *
 * `sanitizeRich` is the single final gate before storage: everything the editor
 * saves, every import, and every model reply passes through it. What it strips
 * is the difference between a CV field and a script running in the preview
 * iframe, which is same-origin and carries the session cookie.
 */
describe('sanitizeRich — the allowlist', () => {
  it('removes a dangerous container WITH its subtree, not just the tag', () => {
    // Unwrapping a <script> would leave its source as visible text; removing the
    // element takes the payload with it.
    expect(sanitizeRich('<p>Before<script>alert(1)</script>After</p>')).not.toContain('alert(1)')
    for (const tag of ['style', 'iframe', 'object', 'form', 'textarea', 'button', 'svg']) {
      const out = sanitizeRich(`<p>Text<${tag}>payload</${tag}></p>`)
      expect(out, tag).not.toContain('payload')
      expect(out, tag).not.toContain(`<${tag}`)
    }
  })

  it('removes a VOID dangerous element too', () => {
    // <embed> and <input> take no children — the parser makes any following text
    // a sibling — so what matters is that the element itself never survives.
    for (const tag of ['embed', 'input']) {
      const out = sanitizeRich(`<p>Text<${tag} src="x"></p>`)
      expect(out, tag).not.toContain(`<${tag}`)
      expect(out, tag).toContain('Text')
    }
  })

  it('UNWRAPS a disallowed tag, keeping the words inside it', () => {
    // A <span> or <font> carries no meaning we store, but the text inside it is
    // the user's — dropping the subtree would silently delete their sentence.
    const out = sanitizeRich('<p><span>kept</span> <font color="red">also kept</font></p>')
    expect(richToPlain(out)).toContain('kept')
    expect(richToPlain(out)).toContain('also kept')
    expect(out).not.toContain('<span')
    expect(out).not.toContain('<font')
  })

  it('wipes every attribute from a tag it keeps', () => {
    // An event handler or a style is what turns allowed markup into a vector.
    const out = sanitizeRich('<p class="x" onclick="alert(1)" style="color:red"><strong id="y">Bold</strong></p>')
    expect(out).toContain('<strong>Bold</strong>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('class=')
    expect(out).not.toContain('style=')
    expect(out).not.toContain('id=')
  })

  it('strips comments, which Word clipboard HTML is full of', () => {
    expect(sanitizeRich('<p>Text<!-- [if gte mso 9] --></p>')).not.toContain('<!--')
  })
})

describe('sanitizeRich — break normalisation', () => {
  it('collapses a run of breaks into one boundary', () => {
    // Two breaks in a row is how a Word user makes a blank line; keeping both
    // draws an empty line the paragraph gap already provides.
    const out = sanitizeRich('<p>One<br><br>Two</p>')
    expect(out).not.toContain('<br><br>')
  })

  it('does not let blank text between two breaks hide the run', () => {
    const out = sanitizeRich('<p>One<br>   <br>Two</p>')
    expect(out).not.toMatch(/<br>\s*<br>/)
  })

  it('strips a break at the start or end of a paragraph', () => {
    // A leading or trailing break only draws an empty edge line, and the
    // paragraph gap is what actually separates blocks.
    expect(sanitizeRich('<p><br>Text</p>')).not.toContain('<br>')
    expect(sanitizeRich('<p>Text<br></p>')).not.toContain('<br>')
    expect(sanitizeRich('<li><br>Item</li>')).not.toContain('<br>')
  })

  it('removes a paragraph left with nothing in it', () => {
    // Word pastes a blank paragraph for every empty line; each one would render
    // as an unexplained gap the user cannot click into.
    const out = sanitizeRich('<p>One</p><p></p><p>   </p><p>Two</p>')
    expect(out.match(/<p>/g)).toHaveLength(2)
  })
})

/**
 * The block/run structure the exporters walk.
 *
 * `parseRichBlocks` is what the DOCX and PDF builders read, and the HTML preview
 * is built from the same value by a different path — so a difference here shows
 * up as a CV that looks one way on screen and another in the file the client
 * receives.
 */
describe('parseRichBlocks — lists', () => {
  it('numbers the items of an ordered list from one', () => {
    const blocks = parseRichBlocks('<ol><li>First</li><li>Second</li><li>Third</li></ol>')
    expect(blocks.map((b) => b.index)).toEqual([1, 2, 3])
    expect(blocks.every((b) => b.ordered)).toBe(true)
  })

  it('restarts the count for a second list', () => {
    // Two separate lists are two separate sequences; continuing the count would
    // print "4." under a heading that starts a new list.
    const blocks = parseRichBlocks('<ol><li>A</li></ol><p>Between</p><ol><li>B</li></ol>')
    const items = blocks.filter((b) => b.kind === 'list-item')
    expect(items.map((b) => b.index)).toEqual([1, 1])
  })

  it('marks an unordered list as unordered and still counts it', () => {
    const blocks = parseRichBlocks('<ul><li>One</li><li>Two</li></ul>')
    expect(blocks.every((b) => b.ordered === false)).toBe(true)
    expect(blocks.map((b) => b.index)).toEqual([1, 2])
  })

  it('gives a nested list a deeper level, restarting its numbering', () => {
    const blocks = parseRichBlocks('<ul><li>Outer<ul><li>Inner</li></ul></li></ul>')
    const levels = blocks.filter((b) => b.kind === 'list-item').map((b) => b.level)
    expect(levels).toEqual([0, 1])
  })

  it('drops a stray list item with no list around it', () => {
    // A bare <li> has no bullet to belong to; emitting one would draw a marker
    // at a level nothing established.
    expect(parseRichBlocks('<li>Orphan</li>').filter((b) => b.kind === 'list-item')).toEqual([])
  })

  it('keeps loose text pasted into a list ABOVE the items it precedes', () => {
    // The text sits in the run buffer when the first <li> arrives; flushing it
    // there is what stops it being emitted after the items the author wrote it
    // above.
    const blocks = parseRichBlocks('<ul>Intro line<li>First item</li></ul>')
    const texts = blocks.map((b) => b.runs.map((r) => r.text).join(''))
    expect(texts[0]).toContain('Intro line')
    expect(texts[1]).toContain('First item')
  })
})

describe('parseRichBlocks — inline formatting', () => {
  it('carries bold, italic and underline onto the run', () => {
    const [block] = parseRichBlocks('<p><strong>b</strong><em>i</em><u>u</u></p>')
    expect(block.runs.map((r) => [r.text, !!r.bold, !!r.italic, !!r.underline])).toEqual([
      ['b', true, false, false],
      ['i', false, true, false],
      ['u', false, false, true],
    ])
  })

  it('treats the legacy tags as their modern equivalents', () => {
    // Word and older stored values use <b>/<i>; the renderers only look at the
    // flags, so both spellings have to arrive the same.
    const [block] = parseRichBlocks('<p><b>bold</b><i>ital</i></p>')
    expect(block.runs[0].bold).toBe(true)
    expect(block.runs[1].italic).toBe(true)
  })

  it('inherits an outer flag into a nested one rather than replacing it', () => {
    const [block] = parseRichBlocks('<p><strong>bold <em>and italic</em></strong></p>')
    const nested = block.runs.find((r) => r.text.includes('and italic'))!
    expect(nested.bold).toBe(true)
    expect(nested.italic).toBe(true)
  })

  it('emits a break inside a list item as a newline run', () => {
    // The one place a break survives canonicalisation; every renderer draws it
    // as a real line break inside the bullet.
    const nl = String.fromCharCode(10)
    const [item] = parseRichBlocks(`<ul><li>First half${nl}second half</li></ul>`)
    expect(item.runs.map((r) => r.text).join('')).toContain(nl)
  })

  it('drops a block whose runs are all empty', () => {
    expect(parseRichBlocks('<p><strong></strong></p>')).toEqual([])
  })
})

/**
 * The plain-text projection.
 *
 * `richToPlain` feeds the ATS export, every AI prompt and the drift comparison.
 * A model shown mangled indentation reports a list as prose; an ATS parser shown
 * a run-together paragraph reads two jobs as one.
 */
describe('richToPlain — list rendering', () => {
  const nl = String.fromCharCode(10)

  it('bullets an unordered list and numbers an ordered one', () => {
    expect(richToPlain('<ul><li>One</li><li>Two</li></ul>')).toBe(`• One${nl}• Two`)
    expect(richToPlain('<ol><li>One</li><li>Two</li></ol>')).toBe(`1. One${nl}2. Two`)
  })

  it('numbers ordered items by their position among the ITEMS', () => {
    // Whitespace between items must not shift the count. (It does still leave a
    // stray leading space on the continuation line — asserted loosely here so
    // this test pins the NUMBERING rather than locking in that wart.)
    const out = richToPlain(`<ol>${nl}  <li>One</li>${nl}  <li>Two</li>${nl}</ol>`)
    expect(out.split(nl).map((l) => l.trim())).toEqual(['1. One', '2. Two'])
  })

  it('indents a nested list one level deeper, on its own line', () => {
    const out = richToPlain('<ul><li>Outer<ul><li>Inner</li></ul></li></ul>')
    expect(out).toBe(`• Outer${nl}  • Inner`)
  })

  it('keeps the item text on the marker line, not below it', () => {
    // The inline content and any sub-list are separated deliberately; losing that
    // split puts the sub-items on the same line as their parent.
    const out = richToPlain('<ul><li>Parent text<ul><li>Child</li></ul></li></ul>')
    expect(out.split(nl)[0]).toBe('• Parent text')
  })
})

describe('richToPlain — whitespace', () => {
  const nl = String.fromCharCode(10)

  it('renders a source newline as a space, the way HTML does', () => {
    expect(richToPlain(`<p>One${nl}two</p>`)).toBe('One two')
  })

  it('collapses a run of spaces that FOLLOWS text', () => {
    expect(richToPlain('<p>One    two</p>')).toBe('One two')
  })

  it('preserves the leading indentation of a nested item', () => {
    // The collapse is deliberately anchored to a preceding non-space, so the
    // two-space indent that marks depth survives.
    const out = richToPlain('<ul><li>A<ul><li>B<ul><li>C</li></ul></li></ul></li></ul>')
    expect(out.split(nl).map((l) => l.match(/^ */)![0].length)).toEqual([0, 2, 4])
  })

  it('separates paragraphs by a single blank line at most', () => {
    const out = richToPlain('<p>One</p><p></p><p></p><p>Two</p>')
    expect(out).not.toMatch(new RegExp(nl + '{3,}'))
  })

  it('turns a break into a real newline', () => {
    expect(richToPlain('<p>One<br>Two</p>')).toBe(`One${nl}Two`)
  })

  it('returns a plain string untouched, without a DOM round trip', () => {
    // The fast path is what keeps every prompt build cheap; it must not trim or
    // reflow a value that has no markup in it.
    expect(richToPlain('  Already plain.  ')).toBe('  Already plain.  ')
  })

  it('is empty for an empty value', () => {
    expect(richToPlain('')).toBe('')
  })
})
