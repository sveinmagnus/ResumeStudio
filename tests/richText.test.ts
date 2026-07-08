/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import {
  sanitizeRich, richToPlain, hasMarkup, renderRichHtml, parseRichBlocks,
  cleanPastedHtml, plainToRichHtml,
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
  it('keeps the allowed tags as-is', () => {
    expect(sanitizeRich('<b>x</b>')).toBe('<b>x</b>')
    expect(sanitizeRich('<strong>x</strong>')).toBe('<strong>x</strong>')
    expect(sanitizeRich('<em>x</em><u>y</u>')).toBe('<em>x</em><u>y</u>')
    expect(sanitizeRich('<p>x</p>')).toBe('<p>x</p>')
    expect(sanitizeRich('<ul><li>x</li></ul>')).toBe('<ul><li>x</li></ul>')
    expect(sanitizeRich('<ol><li>a</li><li>b</li></ol>')).toBe('<ol><li>a</li><li>b</li></ol>')
  })
  it('strips disallowed tags but keeps their text', () => {
    expect(sanitizeRich('<span>hi</span>')).toBe('hi')
    expect(sanitizeRich('<div><b>x</b></div>')).toBe('<b>x</b>')
    expect(sanitizeRich('<a href="http://x">link</a>')).toBe('link')
  })
  it('drops dangerous container tags with their content', () => {
    expect(sanitizeRich('<script>alert(1)</script>safe')).toBe('safe')
    expect(sanitizeRich('<style>body{}</style>x')).toBe('x')
    expect(sanitizeRich('<iframe src=x></iframe>after')).toBe('after')
  })
  it('strips all attributes from allowed tags', () => {
    expect(sanitizeRich('<b style="color:red" onclick="x()">y</b>')).toBe('<b>y</b>')
    expect(sanitizeRich('<p class="foo" id="bar">x</p>')).toBe('<p>x</p>')
  })
  it('handles empty input', () => {
    expect(sanitizeRich('')).toBe('')
  })
  it('strips comment nodes (Word clipboard junk)', () => {
    expect(sanitizeRich('a<!--StartFragment-->b')).toBe('ab')
    expect(sanitizeRich('<p>x<!-- hidden --></p>')).toBe('<p>x</p>')
    expect(sanitizeRich('<!--[if gte mso 9]><xml>junk</xml><![endif]-->safe')).toBe('safe')
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
    expect(cleanPastedHtml('<b style="font-weight:normal" id="docs-internal-guid-x"><p>hello <span style="font-weight:700">bold</span></p></b>'))
      .toBe('<p>hello <strong>bold</strong></p>')
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
    expect(cleanPastedHtml('<p>x<img src="https://example.com/pic.png">y</p>')).toBe('<p>xy</p>')
  })
  it('drops empty and br-only paragraphs', () => {
    expect(cleanPastedHtml('<p><br></p><p>a</p><p></p>')).toBe('<p>a</p>')
  })
  it('keeps real lists as-is and drops their styling', () => {
    expect(cleanPastedHtml('<ul style="margin:0"><li style="color:red">a</li></ul>'))
      .toBe('<ul><li>a</li></ul>')
  })
  it('removes scripts and styles with their content', () => {
    expect(cleanPastedHtml('<style>p{color:red}</style><p>a</p><script>x()</script>'))
      .toBe('<p>a</p>')
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
  it('turns single newlines into <br>', () => {
    expect(plainToRichHtml('one\ntwo')).toBe('<p>one<br>two</p>')
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
  it('falls back to escapePlain when the value has no markup', () => {
    expect(renderRichHtml('5 < 6', escape)).toBe('5 &lt; 6')
  })
  it('sanitises a marked-up value (does not escape)', () => {
    expect(renderRichHtml('<b>x</b>', escape)).toBe('<b>x</b>')
  })
  it('returns empty for empty input', () => {
    expect(renderRichHtml('', escape)).toBe('')
  })
})

describe('parseRichBlocks', () => {
  it('returns a single paragraph for plain text', () => {
    const blocks = parseRichBlocks('hello')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('paragraph')
    expect((blocks[0] as { runs: { text: string }[] }).runs[0].text).toBe('hello')
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
