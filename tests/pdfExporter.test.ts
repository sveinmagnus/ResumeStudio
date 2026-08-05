/**
 * @vitest-environment jsdom
 *
 * Covers the pure doc-definition builder. The actual pdfmake render + download
 * (exportPdf) needs the browser + the ~1.5 MB font vfs, so it isn't unit-tested
 * here — we assert the structure pdfmake will consume instead. countPdfPages is
 * covered with pdfmake stubbed, since what matters there is that we read the
 * count out of the footer callback and hand pdfmake an undisturbed document.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildPdfDocDefinition, buildCoverLetterPdfDef, __resetPdfMakeForTests } from '../src/lib/pdfExporter'
import { emptyStore, makeResume, makeProject, makeView, makeCoverLetter } from './fixtures'

/** Recursively gather every `text` string in a pdfmake content tree. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') { if (node) out.push(node); return out }
  if (Array.isArray(node)) { for (const n of node) collectText(n, out); return out }
  if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>
    if ('text' in rec) collectText(rec.text, out)
    if ('stack' in rec) collectText(rec.stack, out)
    if ('columns' in rec) collectText(rec.columns, out)
    if ('content' in rec) collectText(rec.content, out)
    if ('table' in rec) collectText((rec.table as Record<string, unknown>).body, out)
  }
  return out
}

describe('buildPdfDocDefinition — rich text becomes pdfmake nodes', () => {
  /** Every node in the tree, flattened, so a body's nodes can be found by text. */
  const allNodes = (node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (Array.isArray(node)) { for (const n of node) allNodes(n, out); return out }
    if (node && typeof node === 'object') {
      const rec = node as Record<string, unknown>
      out.push(rec)
      for (const key of ['text', 'stack', 'columns', 'content']) {
        if (key in rec) allNodes(rec[key], out)
      }
      if ('table' in rec) allNodes((rec.table as Record<string, unknown>).body, out)
    }
    return out
  }
  const nodeWith = (dd: unknown, text: string) =>
    allNodes((dd as Record<string, unknown>).content)
      .find((n) => JSON.stringify(n.text ?? '').includes(text))!

  const storeWithBody = (html: string) => ({
    ...emptyStore(),
    resume: makeResume({ full_name: 'Jane Doe' }),
    projects: [makeProject({ id: 'p1', customer: { en: 'AcmeCorp' }, long_description: { en: html } })],
  })
  const view = () => makeView({ sections: [{ key: 'projects', detail: 'full', sort_order: 0 }] })

  it('carries bold and italic runs into the node, not just the words', async () => {
    // pdfmake takes styling per run; dropping it renders a flat paragraph that
    // still contains every word, which is why a text-only assertion misses it.
    const dd = await buildPdfDocDefinition(
      storeWithBody('<p>Ran <strong>fast</strong> and <em>quietly</em>.</p>'), view(), 'en')
    const runs = (nodeWith(dd, 'fast').text as Array<Record<string, unknown>>)
    expect(runs.find((r) => r.text === 'fast')?.bold).toBe(true)
    expect(runs.find((r) => r.text === 'quietly')?.italics).toBe(true)
  })

  it('prefixes list items with a bullet or a number, and indents by level', async () => {
    const ul = await buildPdfDocDefinition(
      storeWithBody('<ul><li>Top</li><ul><li>Nested</li></ul></ul>'), view(), 'en')
    const top = nodeWith(ul, 'Top')
    const nested = nodeWith(ul, 'Nested')
    expect(JSON.stringify(top.text)).toContain('•')
    // Deeper level → larger left margin, or a nested list renders flat.
    expect((nested.margin as number[])[0]).toBeGreaterThan((top.margin as number[])[0])

    const ol = await buildPdfDocDefinition(
      storeWithBody('<ol><li>First</li><li>Second</li></ol>'), view(), 'en')
    expect(JSON.stringify(nodeWith(ol, 'First').text)).toContain('1. ')
    expect(JSON.stringify(nodeWith(ol, 'Second').text)).toContain('2. ')
  })

  it('puts the shared paragraph gap below a paragraph that has one after it', async () => {
    const dd = await buildPdfDocDefinition(storeWithBody('<p>One.</p><p>Two.</p>'), view(), 'en')
    expect((nodeWith(dd, 'One.').margin as number[])[3]).toBeGreaterThan(0)
  })
})

describe('buildPdfDocDefinition', () => {
  it('produces an A4 doc with identity, section heading and item content', async () => {
    const store = {
      ...emptyStore(),
      resume: makeResume({ full_name: 'Jane Doe', title: { en: 'Architect' } }),
      projects: [makeProject({
        id: 'p1', customer: { en: 'AcmeCorp' }, description: { en: 'Built the platform' },
        start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
      })],
    }
    const view = makeView({ name: 'Board CV', sections: [{ key: 'projects', detail: 'full', sort_order: 0 }] })

    const dd = await buildPdfDocDefinition(store, view, 'en')
    expect(dd.pageSize).toBe('A4')
    expect(Array.isArray(dd.pageMargins)).toBe(true)
    expect((dd.pageMargins as number[])).toHaveLength(4)

    const text = collectText(dd.content).join(' | ')
    expect(text).toContain('Jane Doe')            // identity
    expect(text).toContain('Architect')           // title
    expect(text).toContain('PROJECTS')            // section heading, uppercased
    expect(text).toContain('AcmeCorp')            // item title (project customer)
  })

  it('renders a summary section as one-line entries (no full body)', async () => {
    const store = {
      ...emptyStore(),
      resume: makeResume({ full_name: 'Jane Doe' }),
      projects: [makeProject({ id: 'p1', customer: { en: 'AcmeCorp' }, long_description: { en: 'Long private detail' } })],
    }
    const view = makeView({ sections: [{ key: 'projects', detail: 'summary', sort_order: 0 }] })

    const dd = await buildPdfDocDefinition(store, view, 'en')
    const text = collectText(dd.content).join(' | ')
    expect(text).toContain('AcmeCorp')
    expect(text).not.toContain('Long private detail') // summary omits the body
  })

  it('includes the introduction and a footer copyright line', async () => {
    const store = { ...emptyStore(), resume: makeResume({ full_name: 'Jane Doe' }) }
    const view = makeView({
      introduction: { en: 'Tailored for boards.' },
      footer: { separator: 'line', copyright: 'person', copyright_custom: {}, note: {} },
    })

    const dd = await buildPdfDocDefinition(store, view, 'en')
    const text = collectText(dd.content).join(' | ')
    expect(text).toContain('Tailored for boards.')
    expect(text).toContain('Jane Doe') // copyright resolves the person's name
  })
})

// ─── Footer note placement ──────────────────────────────────────────────────
// The placement is computed once in viewHeader.footerLines and consumed by
// every path; these pin that the PDF actually honours it, so it can't drift
// from the HTML preview.

describe('buildCoverLetterPdfDef', () => {
  it('lays out an A4 letter with letterhead, subject, body and signature', () => {
    const store = { ...emptyStore(), resume: makeResume({ full_name: 'Ada Lovelace', email: 'ada@x.io' }) }
    const letter = makeCoverLetter({
      company: { en: 'Equinor' }, recipient: { en: 'Hiring Manager' },
      role_applied: { en: 'Architect' }, greeting: { en: 'Dear Manager,' },
      body: { en: 'First paragraph.\n\nSecond paragraph.' }, closing: { en: 'Sincerely,' },
    })
    const dd = buildCoverLetterPdfDef(store, letter, 'en')
    expect(dd.pageSize).toBe('A4')

    const text = collectText(dd.content).join(' | ')
    expect(text).toContain('Ada Lovelace')                 // letterhead + signature
    expect(text).toContain('ada@x.io')                     // contact
    expect(text).toContain('Application for Architect')    // subject
    expect(text).toContain('Dear Manager,')                // greeting
    expect(text).toContain('First paragraph.')
    expect(text).toContain('Second paragraph.')
    expect(text).toContain('Sincerely,')
  })

  it('does not leak an empty subject/greeting as blank nodes', () => {
    const store = { ...emptyStore(), resume: makeResume({ full_name: 'Ada' }) }
    const dd = buildCoverLetterPdfDef(store, makeCoverLetter({ body: { en: 'Body only.' } }), 'en')
    const text = collectText(dd.content).join(' | ')
    expect(text).toContain('Body only.')
    expect(text).not.toContain('Application for')
  })
})

describe('footer note placement', () => {
  const build = async (placement: string) => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'Ada Lovelace' })
    const view = makeView({
      sections: [],
      footer: {
        separator: 'line', copyright: 'person', copyright_custom: {},
        note: { en: 'Confidential' }, note_placement: placement as never,
      },
    })
    const dd = await buildPdfDocDefinition(store, view, 'en')
    // Only the footer's own text blocks, in order.
    return collectText(dd.content)
      .filter((t) => t.includes('Confidential') || t.includes('Ada Lovelace'))
  }
  const year = new Date().getFullYear()

  it('after: one line, note trailing the copyright', async () => {
    expect((await build('after')).at(-1)).toBe(`© ${year} Ada Lovelace  ·  Confidential`)
  })

  it('before: one line, note leading', async () => {
    expect((await build('before')).at(-1)).toBe(`Confidential  ·  © ${year} Ada Lovelace`)
  })

  it('above: two blocks, note first', async () => {
    expect((await build('above')).slice(-2)).toEqual(['Confidential', `© ${year} Ada Lovelace`])
  })

  it('below: two blocks, copyright first', async () => {
    expect((await build('below')).slice(-2)).toEqual([`© ${year} Ada Lovelace`, 'Confidential'])
  })
})

// ─── True page count ─────────────────────────────────────────────────────────

describe('countPdfPages', () => {
  beforeEach(() => { vi.resetModules(); __resetPdfMakeForTests() })
  const FONT_MODULES = [
    'pdfmake/build/fonts/Roboto',
    'pdfmake/build/standard-fonts/Times',
    'pdfmake/build/standard-fonts/Helvetica',
    'pdfmake/build/standard-fonts/Courier',
  ]
  afterEach(() => {
    vi.doUnmock('pdfmake/build/pdfmake')
    for (const m of FONT_MODULES) vi.doUnmock(m)
  })

  /**
   * Stand in for pdfmake: run the doc's footer callback the way real pagination
   * does (once per page, with the total), so we can assert we read the count
   * out of it. Captures the doc definition it was handed, and every font
   * container registered — the standard-14 families are separate modules since
   * 0.3, and a missing one only fails at layout time in a real render.
   */
  function stubPdfMake(pages: number) {
    const seen: { doc?: Record<string, unknown>, fonts: string[] } = { fonts: [] }
    for (const m of FONT_MODULES) {
      const family = m.split('/').pop()!
      vi.doMock(m, () => ({ default: { vfs: {}, fonts: { [family]: {} } } }))
    }
    vi.doMock('pdfmake/build/pdfmake', () => ({
      default: {
        addFontContainer(container: { fonts: Record<string, unknown> }) {
          seen.fonts.push(...Object.keys(container.fonts))
        },
        createPdf(doc: Record<string, unknown>) {
          seen.doc = doc
          return {
            async getBlob() {
              const footer = doc.footer as ((c: number, t: number, s: unknown) => unknown) | undefined
              for (let p = 1; p <= pages; p++) footer?.(p, pages, { width: 595, height: 842 })
              return new Blob()
            },
            async download() {}, async open() {},
          }
        },
      },
    }))
    return seen
  }

  const store = () => ({ ...emptyStore(), resume: makeResume({ full_name: 'Ada Lovelace' }) })

  it('reports the page count pdfmake actually paginated to', async () => {
    stubPdfMake(3)
    const { countPdfPages } = await import('../src/lib/pdfExporter')
    await expect(countPdfPages(store(), makeView(), 'en')).resolves.toBe(3)
  })

  it('attaches the probe footer without disturbing the document', async () => {
    // The footer exists only to read pageCount; everything pdfmake lays out
    // must be byte-identical to what the export produces.
    const seen = stubPdfMake(2)
    const { countPdfPages, buildPdfDocDefinition } = await import('../src/lib/pdfExporter')
    await countPdfPages(store(), makeView(), 'en')
    const real = await buildPdfDocDefinition(store(), makeView(), 'en')

    expect(typeof seen.doc!.footer).toBe('function')
    const { footer, ...rest } = seen.doc!
    expect(rest).toEqual(real)
    // The probe renders nothing, so it cannot push content onto another page.
    expect((footer as (c: number, t: number, s: unknown) => unknown)(1, 2, {})).toBe('')
  })

  it('never reports less than one page', async () => {
    stubPdfMake(0)
    const { countPdfPages } = await import('../src/lib/pdfExporter')
    await expect(countPdfPages(store(), makeView(), 'en')).resolves.toBe(1)
  })

  it('registers every font family a view can select', async () => {
    // lib/fonts.ts maps each catalog family onto one of these four. pdfmake's
    // browser build bundles none of them, so an unregistered family is not a
    // silent substitution — it throws mid-layout, and only for the users who
    // picked that font. Pin all four rather than trusting the import list.
    const seen = stubPdfMake(1)
    const { countPdfPages } = await import('../src/lib/pdfExporter')
    await countPdfPages(store(), makeView(), 'en')
    expect(seen.fonts.sort()).toEqual(['Courier', 'Helvetica', 'Roboto', 'Times'])
  })
})
