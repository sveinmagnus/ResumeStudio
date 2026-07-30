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
