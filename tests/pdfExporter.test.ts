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
import { unzipSync } from 'fflate'
import { exportDocx } from '../src/lib/exporter'
import { buildViewSections } from '../src/lib/viewFilter'
import { withHeaderDefaults } from '../src/lib/viewHeader'
import { DEFAULT_VIEW_STYLE, deriveTokens } from '../src/lib/viewStyle'
import { LOCALE_CODES } from '../src/lib/locales'
import {
  emptyStore, makeResume, makeProject, makeView, makeCoverLetter,
  makeSkill, makeSkillCategory, makeKQ, makeWork, makeSpokenLanguage, makeRecommendation,
  makeCertification, makePosition, makeReference,
} from './fixtures'
import type { ResumeStore } from '../src/types'

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

/**
 * Every text node flattened to ONE string per rendered LINE — a pdfmake
 * paragraph is `{ text: [run, run, …] }`, and a summary line is now several
 * runs (one per slot, one per separator), so "is this on the same line" has to
 * be asked of the joined paragraph rather than of an individual run.
 */
function collectLines(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) { for (const n of node) collectLines(n, out); return out }
  if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>
    if ('text' in rec) { const line = collectText(rec.text).join(''); if (line) out.push(line) }
    if ('stack' in rec) collectLines(rec.stack, out)
    if ('columns' in rec) collectLines(rec.columns, out)
    if ('content' in rec) collectLines(rec.content, out)
    if ('table' in rec) collectLines((rec.table as Record<string, unknown>).body, out)
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

// ─── Skill matrix + identity (mirrors the DOCX adapter) ─────────────────────

describe('skill matrix table (PDF)', () => {
  /**
   * 67 mutants, none covered. Same feature and same two shape rules as the
   * DOCX table, in a second render engine — which is exactly where the two
   * quietly diverge if only one of them is pinned.
   */
  const matrixStore = (withCategory: boolean): ResumeStore => {
    const store = emptyStore()
    if (withCategory) store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    store.skills.push(makeSkill({
      id: 'ts', name: { en: 'TypeScript' }, total_duration_in_years: 8, proficiency: 4,
      category_id: withCategory ? 'cat1' : null,
    }))
    return store
  }
  const matrixView = (over: Record<string, unknown> = {}) => makeView({
    sections: buildViewSections().map((s) =>
      s.key === 'skill_matrix' ? { ...s, detail: 'full' as const, style: { ...s.style, ...over } } : s),
  })

  /** The matrix table node's body rows, as plain text. */
  const matrixRows = (dd: { content: unknown }): string[][] => {
    const found: string[][] = []
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (!n || typeof n !== 'object') return
      const rec = n as Record<string, unknown>
      // Section headings are tables too (they carry the rule under the label),
      // so key on headerRows — only the matrix declares one.
      const table = rec.table as { body?: unknown[][]; headerRows?: number } | undefined
      if (table?.body && table.headerRows === 1 && !found.length) {
        for (const row of table.body) {
          found.push(row.map((c) => String((c as { text?: unknown })?.text ?? '')))
        }
      }
      for (const v of Object.values(rec)) walk(v)
    }
    walk(dd.content)
    return found
  }

  /** The same rows as objects, for the assertions that are about formatting. */
  const matrixCells = (dd: { content: unknown }): Array<Array<Record<string, unknown>>> => {
    const found: Array<Array<Record<string, unknown>>> = []
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (!n || typeof n !== 'object') return
      const rec = n as Record<string, unknown>
      const table = rec.table as { body?: unknown[][]; headerRows?: number } | undefined
      if (table?.body && table.headerRows === 1 && !found.length) {
        for (const row of table.body) found.push(row as Array<Record<string, unknown>>)
      }
      for (const v of Object.values(rec)) walk(v)
    }
    walk(dd.content)
    return found
  }

  it('writes a header row and one row per skill, with the real values', async () => {
    const rows = matrixRows(await buildPdfDocDefinition(matrixStore(false), matrixView(), 'en'))
    expect(rows[0]).toEqual(['Skill', 'Experience', 'Proficiency', 'Last used'])
    expect(rows[1]).toEqual(['TypeScript', '8 yrs', '4/5', ''])
  })

  it('adds the Category column ONLY when some row has a category', async () => {
    const withCat = matrixRows(await buildPdfDocDefinition(matrixStore(true), matrixView(), 'en'))
    expect(withCat[0]).toEqual(['Skill', 'Category', 'Experience', 'Proficiency', 'Last used'])
    expect(withCat[1]).toEqual(['TypeScript', 'Languages', '8 yrs', '4/5', ''])
  })

  it('drops the Last used column when the section hides dates', async () => {
    const rows = matrixRows(await buildPdfDocDefinition(matrixStore(false), matrixView({ hide_dates: true }), 'en'))
    expect(rows[0]).toEqual(['Skill', 'Experience', 'Proficiency'])
  })

  it('localizes the column headings', async () => {
    const rows = matrixRows(await buildPdfDocDefinition(matrixStore(false), matrixView(), 'no'))
    expect(rows[0]).toEqual(['Ferdighet', 'Erfaring', 'Nivå', 'Sist brukt'])
  })

  it('marks the header row bold and accented', async () => {
    // The layout draws a rule under it but the cells are otherwise identical to
    // the data rows, so weight and colour are what make it read as a header —
    // and every text assertion above passes without them.
    const dd = await buildPdfDocDefinition(matrixStore(false), matrixView(), 'en')
    const header = matrixCells(dd)[0]
    expect(header[0]).toMatchObject({ bold: true })
    expect(header[0].color).toBe(`#${deriveTokens(DEFAULT_VIEW_STYLE).accentHex}`)
    expect(matrixCells(dd)[1][0].bold).toBeUndefined()
  })

  it('agrees cell-for-cell with the DOCX adapter', async () => {
    // One descriptor, every adapter (CLAUDE.md §7.7). The two tables are built
    // by separate code, so this is the assertion that notices when one grows a
    // column the other doesn't.
    // exportDocx downloads rather than returns; capture the blob it hands off.
    let docx: Blob | null = null
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true, configurable: true,
      value: (b: Blob) => { docx = b; return 'blob:fake' },
    })
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, configurable: true, value: () => {} })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await exportDocx(matrixStore(true), matrixView(), 'en')
    const files = unzipSync(new Uint8Array(await docx!.arrayBuffer()))
    const xml = new TextDecoder().decode(files['word/document.xml'])
    const docxCells = [...xml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)]
      .map((m) => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''))

    const pdfRows = matrixRows(await buildPdfDocDefinition(matrixStore(true), matrixView(), 'en'))
    expect(pdfRows.flat()).toEqual(docxCells)
  })
})

describe('buildIdentity (PDF)', () => {
  const identityStore = (): ResumeStore => {
    const store = emptyStore()
    store.resume = makeResume({
      full_name: 'Kari Nordmann', title: { en: 'Solution Architect' },
      phone: '+47 900 00 000', email: 'kari@example.com',
    })
    return store
  }

  it('uses the profile tag line as the title, like every other adapter', async () => {
    // REGRESSION: the PDF was the only render path that skipped
    // viewProfileTagLine, so a resume whose title comes from its profile
    // exported as the PDF with the legacy master title and as everything else
    // with the tag line. §4: the tag line is the default resume title.
    const store = identityStore()
    store.key_qualifications.push(makeKQ({ tag_line: { en: 'Board Adviser' } }))
    const dd = await buildPdfDocDefinition(store, makeView({ sections: buildViewSections() }), 'en')
    const text = collectText(dd.content)
    expect(text[1]).toBe('Board Adviser')
    expect(text).not.toContain('Solution Architect')
  })

  it('still prefers an explicit header override', async () => {
    const store = identityStore()
    store.key_qualifications.push(makeKQ({ tag_line: { en: 'Board Adviser' } }))
    const dd = await buildPdfDocDefinition(store, makeView({
      sections: buildViewSections(),
      header: withHeaderDefaults({ title_override: { en: 'Interim CTO' } }),
    }), 'en')
    expect(collectText(dd.content)[1]).toBe('Interim CTO')
  })

  it('falls back to the resume title when no profile and no override', async () => {
    const dd = await buildPdfDocDefinition(identityStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(collectText(dd.content)[1]).toBe('Solution Architect')
  })

  it('puts the separator BETWEEN same-line contact fields, never before the first', async () => {
    // Phone and email share a line, so there is exactly ONE separator. Counting
    // is what distinguishes the three cases: 0 means it was never emitted, 2
    // means it also opened the line with a stray " | ". Looking at the run
    // BEFORE the phone number proves nothing — the field label sits there.
    const dd = await buildPdfDocDefinition(identityStore(), makeView({ sections: buildViewSections() }), 'en')
    const t = collectText(dd.content)
    expect(t.filter((x) => x === ' | ')).toHaveLength(1)
    expect(t.indexOf(' | ')).toBeGreaterThan(t.indexOf('+47 900 00 000'))
  })
})

/**
 * The PDF item renderer — the mirror of viewFilter's renderItem and
 * exporter's renderItemDocx, and the one with 54 unreached mutants.
 *
 * Every branch here decides how an item READS: which layout it takes, whether
 * the date sits beside the title, whether a key point gets a label, whether the
 * bullet column appears. They all produce nodes, so a wrong branch is invisible
 * to any assertion that content came out.
 */
describe('renderItemPdf — the item layouts', () => {
  const store = (over: Partial<Parameters<typeof makeWork>[0]> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, role_title: { en: 'Architect' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
      long_description: { en: 'Did the work.' }, ...over,
    })]
    return s
  }
  const dd = async (style: Record<string, unknown> = {}, s = store()) =>
    buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'work_experiences', detail: 'full', sort_order: 0, style } as never],
    }), 'en')

  /** Every text run in the tree, flattened, with its own properties kept. */
  const runs = (node: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> => {
    if (Array.isArray(node)) { node.forEach((n) => runs(n, out)); return out }
    if (!node || typeof node !== 'object') return out
    const rec = node as Record<string, unknown>
    if (typeof rec.text === 'string') out.push(rec)
    for (const v of Object.values(rec)) if (v && typeof v === 'object') runs(v, out)
    return out
  }
  const texts = (d: { content: unknown }) => runs(d.content).map((r) => String(r.text))

  it('puts the date beside the title, in a smaller faint run', async () => {
    // The DOCX and HTML adapters put the date in the meta line; the PDF sets it
    // on the title row, which is why it needs its own assertion.
    // The PDF's title run combines employer and role ("Acme — Architect"),
    // where the HTML and DOCX adapters split them across title and meta.
    const t = runs((await dd()).content)
    const title = t.find((r) => String(r.text).startsWith('Acme'))!
    expect(title.bold).toBe(true)
    const date = t.find((r) => String(r.text).includes('2020'))!
    expect(date.color).toBeDefined()
    expect(Number(date.fontSize)).toBeLessThan(Number(title.fontSize))
  })

  it('omits the date run entirely when dates are hidden', async () => {
    const t = texts(await dd({ hide_dates: true }))
    expect(t.some((x) => x.includes('2020'))).toBe(false)
    expect(t.some((x) => x.startsWith('Acme'))).toBe(true)
  })

  it('renders the meta line italic and subtle, and omits it when empty', async () => {
    // Certifications put the organiser on its own meta line — Employment folds
    // its role into the title instead.
    const certs = (organiser: Record<string, string>) => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.certifications = [makeCertification({ id: 'c1', name: { en: 'AWS SA' }, organiser })]
      return buildPdfDocDefinition(s, makeView({
        sections: [{ key: 'certifications', detail: 'full', sort_order: 0 } as never],
      }), 'en')
    }
    const meta = runs((await certs({ en: 'Amazon' })).content).find((r) => r.text === 'Amazon')!
    expect(meta.italics).toBe(true)
    expect(meta.color).toBeDefined()

    // No organiser → NO meta node at all, not an empty italic one. A text
    // search cannot see an empty node, so this counts the italic runs.
    const bare = await certs({})
    expect(texts(bare)).not.toContain('Amazon')
    expect(runs(bare.content).filter((r) => r.italics && r.text === '')).toEqual([])
  })

  it('gives a large-title section a bigger heading than the body', async () => {
    // titleStyle is a per-descriptor choice; collapsing it makes every heading
    // body-sized.
    // A body RUN inherits its size from the paragraph that wraps it, so the
    // comparison is against the body-size token rather than a sibling run.
    const t = runs((await dd()).content)
    const title = t.find((r) => String(r.text).startsWith('Acme'))!
    expect(Number(title.fontSize))
      .toBeGreaterThan(deriveTokens(DEFAULT_VIEW_STYLE).bodyFontSizePt)
  })

  describe('key points', () => {
    const withPoints = (points: Array<{ label?: Record<string, string>; body: Record<string, string> }>) => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.key_qualifications = [makeKQ({
        id: 'kq1', summary: { en: 'Summary.' },
        key_points: points.map((p, i) => ({
          id: `kp${i}`, name: p.label ?? {}, long_description: p.body, sort_order: i, disabled: false,
        })) as never,
      })]
      return buildPdfDocDefinition(s, makeView({
        sections: [{ key: 'key_qualifications', detail: 'full', sort_order: 0 } as never],
      }), 'en')
    }

    it('prefixes a labelled point with its label and a dash', async () => {
      const t = texts(await withPoints([{ label: { en: 'Cloud' }, body: { en: 'Ran it.' } }]))
      expect(t).toContain('• Cloud')
      expect(t).toContain(' — ')
      expect(t).toContain('Ran it.')
    })

    it('prefixes an unlabelled point with a bare bullet, and no dash', async () => {
      const t = texts(await withPoints([{ body: { en: 'Ran it.' } }]))
      expect(t).toContain('• ')
      expect(t).not.toContain(' — ')
    })

    it('flattens a multi-paragraph point onto one bullet line', async () => {
      // A point is ONE bullet; letting its paragraphs split would invent
      // bullets the user never wrote.
      const t = texts(await withPoints([{ body: { en: 'First.\n\nSecond.' } }]))
      expect(t).toContain('First.')
      expect(t).toContain('Second.')
      expect(t.filter((x) => x.startsWith('•'))).toHaveLength(1)
      // A separator run stands between them — without it the two paragraphs
      // run together as "First.Second.".
      expect(t.slice(t.indexOf('First.'), t.indexOf('Second.'))).toContain(' ')
    })
  })

  it('wraps the item in a two-column bullet row only when bullets are on', async () => {
    const on = await dd({ item_bullets: true })
    const cols = JSON.stringify(on.content).includes('"columns"')
    expect(cols).toBe(true)
    const off = await dd({})
    expect(JSON.stringify(off.content).includes('"columnGap":4')).toBe(false)
  })

  it('renders a language inline, with its level after an em-dash', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: { en: 'Native' } })]
    const t = texts(await buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'spoken_languages', detail: 'full', sort_order: 0 } as never],
    }), 'en'))
    expect(t).toContain('Norwegian')
    expect(t.some((x) => x.startsWith(' — ') && x.includes('Native'))).toBe(true)
  })

  it('omits the inline meta run when a language has no level', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: {} })]
    const t = texts(await buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'spoken_languages', detail: 'full', sort_order: 0 } as never],
    }), 'en'))
    expect(t).toContain('Norwegian')
    expect(t.some((x) => x.startsWith(' — '))).toBe(false)
  })

  it('renders a recommendation as an italic quote with a subtle attribution', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.recommendations = [makeRecommendation({
      id: 'r1', recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' },
      text: { en: 'Excellent to work with.' },
    })]
    const d = await buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'recommendations', detail: 'full', sort_order: 0 } as never],
    }), 'en')
    const quote = runs(d.content).find((r) => String(r.text).includes('Excellent'))!
    expect(quote.italics).toBe(true)
    expect(texts(d).some((x) => x.startsWith('— ') && x.includes('Jane Boss'))).toBe(true)
  })

  it('falls back to the company when the recommender has no name', async () => {
    // Losing the attribution entirely would leave an anonymous quote; the
    // company is the next-best identification.
    const s0 = emptyStore()
    s0.resume = makeResume({ full_name: 'X' })
    s0.recommendations = [makeRecommendation({
      id: 'r1', recommender_name: '', recommender_title: {}, relationship: {},
      recommender_company: 'BigCo', text: { en: 'Great.' },
    })]
    expect(texts(await buildPdfDocDefinition(s0, makeView({
      sections: [{ key: 'recommendations', detail: 'full', sort_order: 0 } as never],
    }), 'en')).some((x) => x === '— BigCo')).toBe(true)
  })

  it('omits the attribution line when there is nothing at all to attribute', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.recommendations = [makeRecommendation({
      id: 'r1', recommender_name: '', recommender_title: {}, relationship: {},
      recommender_company: '', text: { en: 'Great.' },
    })]
    const t = texts(await buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'recommendations', detail: 'full', sort_order: 0 } as never],
    }), 'en'))
    expect(t.some((x) => x.startsWith('— '))).toBe(false)
  })
})

/** scaleImage — 17 unreached mutants; it decides how big a photo prints. */
describe('scaleImage via the header images', () => {
  const png = (w: number, h: number) => {
    // A minimal but real PNG header carrying the given dimensions.
    const bytes = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
      (w >> 24) & 255, (w >> 16) & 255, (w >> 8) & 255, w & 255,
      (h >> 24) & 255, (h >> 16) & 255, (h >> 8) & 255, h & 255,
      0, 0, 0, 0, 0, 0,
    ]
    return `data:image/png;base64,${Buffer.from(Uint8Array.from(bytes)).toString('base64')}`
  }
  const photoNode = async (src: string) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X', profile_photo: src })
    const d = await buildPdfDocDefinition(s, makeView({
      sections: buildViewSections(),
      header: withHeaderDefaults({ photo_placement: 'left' }),
    }), 'en')
    const found: Array<Record<string, unknown>> = []
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (!n || typeof n !== 'object') return
      const rec = n as Record<string, unknown>
      if (typeof rec.image === 'string') found.push(rec)
      for (const v of Object.values(rec)) if (v && typeof v === 'object') walk(v)
    }
    walk(d.content)
    return found[0]
  }

  it('scales a large image down inside the box, keeping its aspect ratio', async () => {
    // 400x200 into a 100x120 box → limited by WIDTH, so 100x50.
    const n = await photoNode(png(400, 200))
    expect(n).toMatchObject({ width: 100, height: 50 })
  })

  it('is limited by HEIGHT for a tall image', async () => {
    // 200x480 into 100x120 → height wins: 120 tall, 50 wide.
    const n = await photoNode(png(200, 480))
    expect(n).toMatchObject({ width: 50, height: 120 })
  })

  it('never enlarges an image that already fits', async () => {
    const n = await photoNode(png(40, 30))
    expect(n).toMatchObject({ width: 40, height: 30 })
  })

  it('never reports a zero dimension', async () => {
    // A very wide sliver would round its height to 0 and print nothing.
    const n = await photoNode(png(4000, 3))
    expect(Number(n.width)).toBeGreaterThan(0)
    expect(Number(n.height)).toBeGreaterThan(0)
  })
})

/**
 * Tags, extra lines, the section-heading rule, and the empty-body guard —
 * the parts of the PDF adapter still unreached after the item layouts.
 */
describe('pdfExporter — tags, extra lines and the heading rule', () => {
  const runs = (node: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> => {
    if (Array.isArray(node)) { node.forEach((n) => runs(n, out)); return out }
    if (!node || typeof node !== 'object') return out
    const rec = node as Record<string, unknown>
    if (typeof rec.text === 'string') out.push(rec)
    for (const v of Object.values(rec)) if (v && typeof v === 'object') runs(v, out)
    return out
  }
  const texts = (d: { content: unknown }) => runs(d.content).map((r) => String(r.text))

  const projectStore = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } }), makeSkill({ id: 'k8s', name: { en: 'Kubernetes' } })]
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Acme' },
      skills: [
        { id: 'ps1', skill_id: 'go', name: { en: 'Go' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
        { id: 'ps2', skill_id: 'k8s', name: { en: 'Kubernetes' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 1 },
      ],
      ...over,
    } as never)]
    return s
  }
  const dd = (s: ResumeStore, style: Record<string, unknown> = {}) =>
    buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0, style } as never],
    }), 'en')

  it('lists an item’s tags, comma-joined, behind an italic label', async () => {
    const doc = await dd(projectStore(), { tag_style: 'inline' })
    expect(texts(doc).some((x) => x.includes('Go, Kubernetes'))).toBe(true)
    const label = runs(doc.content).find((r) => /skills/i.test(String(r.text)))
    expect(label?.italics).toBe(true)
  })

  it('fills each tag as its own chip when the view asks for chips', async () => {
    // The chip is the affordance — the reader can see those words are tags — so
    // it drops the label, exactly as the preview does. This used to be the
    // preview's alone: picking Chips changed nothing in the PDF.
    const doc = await dd(projectStore(), { tag_style: 'chips' })
    const chips = runs(doc.content).filter((r) => r.background)
    expect(chips.map((r) => String(r.text).trim())).toEqual(['Go', 'Kubernetes'])
    expect(new Set(chips.map((r) => r.background)).size).toBe(1)
    expect(texts(doc).some((x) => /skills/i.test(x))).toBe(false)
  })

  it('emits no tag node at all when an item has none', async () => {
    // Not just "no skill names" — no LABEL either. An empty tags node renders
    // as a stray "Skills:" with nothing after it.
    const t = texts(await dd(projectStore({ skills: [] })))
    expect(t.some((x) => x.includes('Go'))).toBe(false)
    expect(t.some((x) => /skills/i.test(x))).toBe(false)
  })

  it('pushes no empty run when a section tags WITHOUT a label', async () => {
    // The Skills Showcase emits tags with an empty tagsLabel — the one section
    // where the label guard is reachable. Pushing it unconditionally leaves an
    // empty run in front of the skill list.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.skill_categories = [makeSkillCategory({ id: 'c1', name: { en: 'Languages' } })]
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' }, category_id: 'c1', is_highlighted: true })]
    const doc = await buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'technology_categories', detail: 'full', sort_order: 0, style: { tag_style: 'inline' } } as never],
    }), 'en')
    expect(texts(doc)).toContain('Go')
    expect(runs(doc.content).filter((r) => r.text === '')).toEqual([])
  })

  it('renders each extra line as its own subtle paragraph', async () => {
    // Certifications put the credential URL there.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.certifications = [makeCertification({
      id: 'c1', name: { en: 'AWS SA' }, credential_url: 'https://verify.example/abc',
    })]
    const d = await buildPdfDocDefinition(s, makeView({
      // The credential link is an opt-in group (lib/sectionExtras), like every
      // optional fact — a view that wants it in the PDF asks for it.
      sections: [{ key: 'certifications', detail: 'full', sort_order: 0, style: { extras: ['links'] } } as never],
    }), 'en')
    // The SUBTLE grey specifically — para() always sets some colour, so
    // "has a colour" would pass with the styling dropped.
    const line = runs(d.content).find((r) => String(r.text).includes('verify.example'))
    expect(line).toBeDefined()
    expect(line!.color).toBe('#666666')
  })

  it('draws a rule under the section heading and nowhere else', async () => {
    // The heading is a one-row table whose only border is the bottom one; a rule
    // above it would read as a divider from the previous section. hLineWidth is
    // a CALLBACK, so it has to be invoked — a stringified layout cannot show it.
    const d = await dd(projectStore())
    expect(JSON.stringify(d.content)).toContain('"border":[false,false,false,true]')
    const heading = (d.content as Array<Record<string, unknown>>)
      .find((n) => n.table && (n.layout as Record<string, unknown>)?.hLineWidth)!
    const hLineWidth = (heading.layout as { hLineWidth: (i: number) => number }).hLineWidth
    expect(hLineWidth(0)).toBe(0)
    expect(hLineWidth(1)).toBeGreaterThan(0)
  })

  it('renders nothing for an empty rich-text body', async () => {
    const s = projectStore({ long_description: { en: '' }, description: {} })
    // An empty body must produce NO paragraph, not a blank one — a blank
    // paragraph is visible in the PDF as an unexplained gap.
    // Asked of whole LINES: a chip list separates its chips with space runs,
    // which are not blank paragraphs and are not what this guards.
    expect(collectLines((await dd(s)).content).filter((x) => x.trim() === '')).toEqual([])
  })
})

/**
 * The header's geometry: which side the photo lands on, how big it is, and what
 * the logo does. pdfmake takes a tree, so these are structural assertions —
 * "the identity column comes second" rather than "the PDF looks right".
 */
describe('buildPdfDocDefinition — header placement and image boxes', () => {
  /** A PNG whose IHDR declares `w`×`h`; only the header is read. */
  const pngOf = (w: number, h: number): string => {
    const bytes = new Uint8Array(40)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
    const be = (o: number, v: number) => {
      bytes[o] = (v >>> 24) & 0xff; bytes[o + 1] = (v >>> 16) & 0xff
      bytes[o + 2] = (v >>> 8) & 0xff; bytes[o + 3] = v & 0xff
    }
    be(16, w); be(20, h)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return `data:image/png;base64,${btoa(binary)}`
  }

  const content = (dd: unknown) => (dd as { content: Record<string, unknown>[] }).content
  /** Every node in the tree that carries an `image`. */
  const images = (node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (Array.isArray(node)) { for (const n of node) images(n, out); return out }
    if (node && typeof node === 'object') {
      const rec = node as Record<string, unknown>
      if ('image' in rec) out.push(rec)
      for (const key of ['stack', 'columns', 'content', 'table']) if (key in rec) images(rec[key], out)
      if ('table' in rec) images((rec.table as Record<string, unknown>).body, out)
    }
    return out
  }

  const build = async (over: Record<string, unknown>, header: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe', ...over })
    s.projects = [makeProject({ id: 'p1', customer: { en: 'AcmeCorp' } })]
    return buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 }],
      header: withHeaderDefaults(header),
    }), 'en')
  }

  it('fits the photo into its box, preserving the aspect ratio', async () => {
    const dd = await build({ profile_photo: pngOf(200, 240) }, { photo_placement: 'right' })
    // The photo box is 100×120.
    expect(images(content(dd))).toContainEqual(expect.objectContaining({ width: 100, height: 120 }))
  })

  it('never enlarges a photo smaller than the box', async () => {
    const dd = await build({ profile_photo: pngOf(50, 60) }, { photo_placement: 'right' })
    expect(images(content(dd))).toContainEqual(expect.objectContaining({ width: 50, height: 60 }))
  })

  it('fits the logo into its own wider box', async () => {
    const dd = await build({ company_logo: pngOf(320, 48) }, { logo_placement: 'left' })
    // The logo box is 160×48.
    expect(images(content(dd))).toContainEqual(expect.objectContaining({ width: 160, height: 24 }))
  })

  it('puts the photo BEFORE the identity for a left placement and after for a right one', async () => {
    const colsOf = (dd: unknown) => {
      const node = content(dd).find((n) => 'columns' in n)!
      return (node.columns as Array<Record<string, unknown>>).map((c) => ('stack' in c && images(c).length ? 'photo' : 'identity'))
    }
    expect(colsOf(await build({ profile_photo: pngOf(100, 120) }, { photo_placement: 'left' })))
      .toEqual(['photo', 'identity'])
    expect(colsOf(await build({ profile_photo: pngOf(100, 120) }, { photo_placement: 'right' })))
      .toEqual(['identity', 'photo'])
  })

  it('stacks the photo above the identity for an "above" placement', async () => {
    const dd = await build({ profile_photo: pngOf(100, 120) }, { photo_placement: 'above' })
    const nodes = content(dd)
    const photoAt = nodes.findIndex((n) => 'image' in n)
    const nameAt = nodes.findIndex((n) => JSON.stringify(n.text ?? '').includes('Jane Doe'))
    expect(photoAt).toBeGreaterThanOrEqual(0)
    expect(photoAt).toBeLessThan(nameAt)
    expect(nodes[photoAt].columns).toBeUndefined()
  })

  it('embeds no image at all when the placement is none', async () => {
    const dd = await build(
      { profile_photo: pngOf(100, 120), company_logo: pngOf(160, 48) },
      { photo_placement: 'none', logo_placement: 'none' },
    )
    expect(images(content(dd))).toEqual([])
  })

  it('embeds no image when the resume carries none, whatever the placement says', async () => {
    const dd = await build({ profile_photo: null, company_logo: null }, { photo_placement: 'right', logo_placement: 'left' })
    expect(images(content(dd))).toEqual([])
  })

  it('aligns the logo where the placement says', async () => {
    for (const logo_placement of ['left', 'center', 'right'] as const) {
      const dd = await build({ company_logo: pngOf(160, 48) }, { logo_placement })
      expect(images(content(dd))[0].alignment, logo_placement).toBe(logo_placement)
    }
  })
})

describe('buildPdfDocDefinition — the skill-matrix table layout', () => {
  const tableNodes = (node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (Array.isArray(node)) { for (const n of node) tableNodes(n, out); return out }
    if (node && typeof node === 'object') {
      const rec = node as Record<string, unknown>
      if ('table' in rec) out.push(rec)
      for (const key of ['stack', 'columns', 'content']) if (key in rec) tableNodes(rec[key], out)
    }
    return out
  }

  const build = async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    s.skill_categories = [makeSkillCategory({ id: 'c1', name: { en: 'Languages' } })]
    s.skills = [
      makeSkill({ id: 's1', name: { en: 'Go' }, category_id: 'c1', total_duration_in_years: 8, proficiency: 4 }),
      makeSkill({ id: 's2', name: { en: 'Rust' }, category_id: 'c1', total_duration_in_years: 3, proficiency: 2 }),
    ]
    const view = makeView({
      sections: buildViewSections().map((sec) =>
        sec.key === 'skill_matrix' ? { ...sec, detail: 'full' as const } : sec),
    })
    return buildPdfDocDefinition(s, view, 'en')
  }

  /** The matrix table is the one whose header row starts with "Skill". */
  const matrixTable = (dd: unknown) =>
    tableNodes((dd as Record<string, unknown>).content).find((t) => {
      const body = (t.table as Record<string, unknown>).body as Array<Array<Record<string, unknown>>>
      return body[0]?.some((c) => c.text === 'Skill')
    })!

  it('repeats the header row on every page and gives each column an equal share', async () => {
    const table = matrixTable(await build())
    const t = table.table as Record<string, unknown>
    expect(t.headerRows).toBe(1)
    const widths = t.widths as string[]
    expect(widths.length).toBeGreaterThan(1)
    expect(new Set(widths)).toEqual(new Set(['*']))
    expect((t.body as unknown[][]).length).toBeGreaterThan(1)
  })

  it('rules only the top, the header underline and the bottom — never between rows', async () => {
    const table = matrixTable(await build())
    const layout = table.layout as Record<string, (i: number, node?: unknown) => number>
    const node = { table: { body: (table.table as Record<string, unknown>).body } }
    const rows = (node.table.body as unknown[]).length
    expect(layout.hLineWidth(0, node)).toBeGreaterThan(0)
    expect(layout.hLineWidth(1, node)).toBeGreaterThan(0)
    expect(layout.hLineWidth(rows, node)).toBeGreaterThan(0)
    // A rule between body rows would turn a light table into a grid.
    expect(layout.hLineWidth(2, node)).toBe(0)
    expect(layout.vLineWidth(0)).toBe(0)
  })

  it('pads every column on the right except the last one', async () => {
    const table = matrixTable(await build())
    const layout = table.layout as Record<string, (i: number) => number>
    const cols = ((table.table as Record<string, unknown>).widths as unknown[]).length
    expect(layout.paddingLeft(0)).toBe(0)
    expect(layout.paddingRight(0)).toBeGreaterThan(0)
    // The last column's padding would push the table past the text column.
    expect(layout.paddingRight(cols - 1)).toBe(0)
    expect(layout.paddingTop(0)).toBeGreaterThan(0)
    expect(layout.paddingBottom(0)).toBeGreaterThan(0)
  })

  it('writes the header row bold in the accent colour and the body rows neither', async () => {
    const table = matrixTable(await build())
    const body = (table.table as Record<string, unknown>).body as Array<Array<Record<string, unknown>>>
    const tokens = deriveTokens(DEFAULT_VIEW_STYLE)
    for (const cell of body[0]) {
      expect(cell.bold).toBe(true)
      expect(cell.color).toBe(`#${tokens.accentHex}`)
      expect(cell.fontSize).toBe(tokens.smallFontSizePt)
    }
    for (const cell of body[1]) {
      expect(cell.bold).toBeUndefined()
      expect(cell.color).not.toBe(`#${tokens.accentHex}`)
    }
  })
})

/**
 * PDF geometry, in points, derived from the same tokens the DOCX path uses.
 * pdfmake margins are `[left, top, right, bottom]`; getting an edge wrong moves
 * text sideways rather than down, which reads as a broken layout.
 */
describe('buildPdfDocDefinition — margins and rules from the tokens', () => {
  const nodes = (node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (Array.isArray(node)) { for (const n of node) nodes(n, out); return out }
    if (node && typeof node === 'object') {
      const rec = node as Record<string, unknown>
      out.push(rec)
      for (const key of ['text', 'stack', 'columns', 'content']) if (key in rec) nodes(rec[key], out)
      if ('table' in rec) nodes((rec.table as Record<string, unknown>).body, out)
    }
    return out
  }
  const nodeWith = (dd: unknown, text: string) =>
    nodes((dd as Record<string, unknown>).content)
      .find((n) => JSON.stringify(n.text ?? '').includes(text))!
  const marginOf = (node: Record<string, unknown>) => node.margin as number[]

  const build = async (html: string, style: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    s.projects = [makeProject({ id: 'p1', customer: { en: 'AcmeCorp' }, long_description: { en: html } })]
    return buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 }],
      style: { ...DEFAULT_VIEW_STYLE, ...style },
    }), 'en')
  }
  const tokensFor = (style: Record<string, unknown> = {}) =>
    deriveTokens({ ...DEFAULT_VIEW_STYLE, ...style } as never)

  it('spaces body paragraphs by the shared gap, in POINTS, per density', async () => {
    for (const density of ['compact', 'normal', 'spacious'] as const) {
      const dd = await build('<p>First one.</p><p>Second one.</p><p>Third one.</p>', { density })
      const t = tokensFor({ density })
      expect(marginOf(nodeWith(dd, 'First one.'))[3], density).toBeCloseTo(t.paraGapPt, 3)
      expect(marginOf(nodeWith(dd, 'Second one.'))[3], density).toBeCloseTo(t.paraGapPt, 3)
    }
  })

  it('gives the last paragraph the caller\u2019s bottom gap, not the paragraph gap', async () => {
    const dd = await build('<p>First one.</p><p>Second one.</p>')
    const t = tokensFor()
    expect(marginOf(nodeWith(dd, 'Second one.'))[3]).not.toBeCloseTo(t.paraGapPt, 3)
  })

  it('indents a list item on the LEFT edge, one step per level', async () => {
    const dd = await build('<ul><li>Top item</li><ul><li>Nested item</li></ul></ul>')
    const top = marginOf(nodeWith(dd, 'Top item'))
    const nested = marginOf(nodeWith(dd, 'Nested item'))
    expect(top[0]).toBeGreaterThan(0)
    expect(nested[0]).toBeGreaterThan(top[0])
    // Only the left and bottom edges move — a list item is not pushed down.
    expect(top[1]).toBe(0)
    expect(top[2]).toBe(0)
    expect(top[3]).toBeGreaterThan(0)
  })

  it('rules a section heading UNDER the text and nowhere else', async () => {
    const dd = await build('<p>Body.</p>')
    const heading = nodes((dd as Record<string, unknown>).content)
      .find((n) => 'table' in n && JSON.stringify(n).includes('PROJECTS'))!
    const layout = heading.layout as Record<string, (i: number) => number | string>
    expect(layout.hLineWidth(0)).toBe(0)
    expect(layout.hLineWidth(1)).toBeGreaterThan(0)
    expect(layout.vLineWidth(0)).toBe(0)
    expect(layout.hLineColor(1)).toBe(`#${tokensFor().accentHex}`)
    // No side padding: the rule has to line up with the body text.
    expect(layout.paddingLeft(0)).toBe(0)
    expect(layout.paddingRight(0)).toBe(0)
    expect(layout.paddingTop(0)).toBe(0)
    expect(layout.paddingBottom(0)).toBeGreaterThan(0)
  })

  it('spaces the section heading from the tokens, above and below', async () => {
    for (const density of ['compact', 'spacious'] as const) {
      const dd = await build('<p>Body.</p>', { density })
      const t = tokensFor({ density })
      const heading = nodes((dd as Record<string, unknown>).content)
        .find((n) => 'table' in n && JSON.stringify(n).includes('PROJECTS'))!
      const m = marginOf(heading)
      // twips → points is a divide by 20; a heading two points out is visible.
      expect(m[1], density).toBeCloseTo(t.itemGapTwips / 20, 3)
      expect(m[3], density).toBeCloseTo(t.sectionHeadingAfterTwips / 20 + 2, 3)
    }
  })

  it('carries the section\u2019s top gap on the first node when the heading is hidden', async () => {
    // With no heading there is nothing to hold the gap, so the first content
    // node has to take it — otherwise the section crowds the one above.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    s.projects = [makeProject({ id: 'p1', customer: { en: 'AcmeCorp' }, long_description: { en: '<p>Body.</p>' } })]
    const hidden = await buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0, style: { hide_heading: true } } as never],
    }), 'en')
    const shown = await buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 }],
    }), 'en')
    expect(JSON.stringify(hidden)).not.toContain('PROJECTS')
    const t = tokensFor()
    const firstHidden = (hidden as { content: Record<string, unknown>[] }).content
      .find((n) => JSON.stringify(n).includes('AcmeCorp'))!
    const firstShown = (shown as { content: Record<string, unknown>[] }).content
      .find((n) => JSON.stringify(n).includes('AcmeCorp'))!
    expect(marginOf(firstHidden)[1]).toBeCloseTo(marginOf(firstShown)[1] + t.itemGapTwips / 20, 3)
  })
})

/**
 * SUMMARY detail in the PDF.
 *
 * A view set to summary renders one line per item instead of a block, and none of
 * that path had a test — the whole branch was uncovered. It is also where the
 * short description is placed, which is the one setting that changes how a
 * one-line CV reads.
 */
describe('buildPdfDocDefinition — the summary line', () => {
  const store = (over: Record<string, unknown> = {}) => ({
    ...emptyStore(),
    resume: makeResume({ full_name: 'Jane Doe' }),
    work_experiences: [makeWork({
      id: 'w1', employer: { en: 'Cartavio' }, role_title: { en: 'Architect' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
      ...over,
    })],
  })
  const summaryView = (style: Record<string, unknown> = {}) => makeView({
    sections: [{ key: 'work_experiences', detail: 'summary', sort_order: 0, style } as never],
  })

  it('renders one line carrying the title and the meta', async () => {
    const dd = await buildPdfDocDefinition(store(), summaryView(), 'en')
    const text = collectText(dd.content).join(' | ')
    expect(text).toContain('Architect')
    expect(text).toContain('Cartavio')
    // A summary line, not the full block: no separate description paragraph.
    expect(text).not.toContain('Long desc')
  })

  it('joins several meta parts with a middot', async () => {
    const dd = await buildPdfDocDefinition(store(), summaryView(), 'en')
    expect(collectLines(dd.content).join(' | ')).toMatch(/Cartavio[^|]*\u00b7|\u00b7[^|]*Cartavio/)
  })

  it('orders the slots the way the view asked for', async () => {
    // Same control as the preview's: it used to move only the preview, so one
    // view read date-first on screen and title-first in its own PDF.
    const line = async (layout: string): Promise<string> => collectLines(
      (await buildPdfDocDefinition(store(), summaryView({ summary_layout: layout }), 'en')).content,
    ).find((l) => l.includes('Architect'))!
    const dateFirst = await line('date-title-org')
    const titleFirst = await line('title-org-date')
    expect(dateFirst.indexOf('Cartavio')).toBeGreaterThan(dateFirst.indexOf('Architect'))
    expect(titleFirst.indexOf('Architect')).toBeLessThan(titleFirst.indexOf('Cartavio'))
    expect(dateFirst).not.toEqual(titleFirst)
  })

  it('puts the short description on its own line by default', async () => {
    const dd = await buildPdfDocDefinition(
      store({ short_description: { en: 'Ran the platform.' } }), summaryView(), 'en')
    const lines = collectLines(dd.content)
    // Its own line, and NOT glued onto the one carrying the meta.
    expect(lines).toContain('Ran the platform.')
    expect(lines.some((l) => l.includes('Cartavio') && l.includes('Ran the platform.'))).toBe(false)
  })

  it('appends it to the same line when asked to', async () => {
    const dd = await buildPdfDocDefinition(
      store({ short_description: { en: 'Ran the platform.' } }),
      summaryView({ short_desc_line: 'inline' }), 'en')
    const lines = collectLines(dd.content)
    expect(lines.some((l) => l.includes('Cartavio') && l.includes('Ran the platform.'))).toBe(true)
    expect(lines).not.toContain('Ran the platform.')
  })

  it('styles the below-line description as subtle, not as body text', async () => {
    // It is a supporting line under the item; at body weight the summary list
    // reads as two entries per item.
    const dd = await buildPdfDocDefinition(
      store({ short_description: { en: 'Ran the platform.' } }), summaryView(), 'en')
    const found: Array<Record<string, unknown>> = []
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (!n || typeof n !== 'object') return
      const rec = n as Record<string, unknown>
      if (rec.text === 'Ran the platform.') found.push(rec)
      for (const k of ['stack', 'columns', 'content', 'text']) if (k in rec) walk(rec[k])
    }
    walk(dd.content)
    expect(found).toHaveLength(1)
    expect(found[0].color).toBeTruthy()
  })

  it('emits no trailing separator when there is no short description', async () => {
    const dd = await buildPdfDocDefinition(store({ short_description: {} }), summaryView({ short_desc_line: 'inline' }), 'en')
    for (const line of collectText(dd.content)) {
      expect(line.trimEnd().endsWith('\u2014'), line).toBe(false)
    }
  })

  it('renders a PROFILE as prose even at summary detail', async () => {
    // key_qualifications is alwaysFull: the detail level picks WHICH prose, not
    // whether to collapse it to a line.
    const s = {
      ...emptyStore(),
      resume: makeResume({ full_name: 'Jane Doe' }),
      key_qualifications: [makeKQ({
        id: 'kq1', tag_line: { en: 'Architect' },
        summary: { en: 'The long profile.' }, summary_short: { en: 'The short line.' },
      } as never)],
    }
    const dd = await buildPdfDocDefinition(
      s, makeView({ sections: [{ key: 'key_qualifications', detail: 'summary', sort_order: 0 }] }), 'en')
    const text = collectText(dd.content).join(' | ')
    expect(text).toContain('The short line.')
    expect(text).not.toContain('The long profile.')
  })
})

describe('exportCoverLetterPdf — the filename it downloads as', () => {
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

  /** Capture the name the download is handed; the render itself is not the point. */
  function stubPdfMake() {
    const seen: { name?: string } = {}
    for (const m of FONT_MODULES) {
      const family = m.split('/').pop()!
      vi.doMock(m, () => ({ default: { vfs: {}, fonts: { [family]: {} } } }))
    }
    vi.doMock('pdfmake/build/pdfmake', () => ({
      default: {
        addFontContainer() {},
        createPdf() {
          return {
            async download(name: string) { seen.name = name },
            async getBlob() { return new Blob() },
            async open() {},
          }
        },
      },
    }))
    return seen
  }

  const run = async (letterName: string, fullName = 'Ada Lovelace') => {
    const seen = stubPdfMake()
    const mod = await import('../src/lib/pdfExporter')
    const store = { ...emptyStore(), resume: makeResume({ full_name: fullName }) }
    await mod.exportCoverLetterPdf(store, makeCoverLetter({ name: letterName } as never), 'en')
    return seen.name!
  }

  it('names the file after the person and the letter', async () => {
    // The letter is one of several a consultant sends the same week; a generic
    // name means the wrong file gets attached.
    // One export per test: the pdfmake stub is installed through the module
    // registry, and re-stubbing inside a test does not reach the module already
    // imported.
    const name = await run('Equinor application')
    expect(name).toMatch(/Ada_Lovelace/)
    expect(name).toMatch(/Equinor_application/)
    expect(name).toMatch(/\.pdf$/)
  })

  it('falls back to a generic letter name when the letter is unnamed', async () => {
    expect(await run('')).toMatch(/cover-letter/)
  })

  it('exports for a store with no resume record', async () => {
    const seen = stubPdfMake()
    const mod = await import('../src/lib/pdfExporter')
    const store = { ...emptyStore(), resume: null } as never
    await expect(mod.exportCoverLetterPdf(store, makeCoverLetter({ name: 'Letter' } as never), 'en'))
      .resolves.toBeUndefined()
    expect(seen.name).toMatch(/Letter/)
  })
})

/**
 * The numbers, flags and colours the doc definition carries.
 *
 * pdfmake accepts `undefined` for almost every property and silently falls back
 * to its own defaults, so a token that stops reaching a node changes the printed
 * page without changing a single word of it. Text-only assertions cannot see
 * that; the blocks below read the properties themselves.
 */

const T = deriveTokens(DEFAULT_VIEW_STYLE)

/** Every object node in a pdfmake tree, in document order. */
function pdfNodes(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) { for (const n of node) pdfNodes(n, out); return out }
  if (!node || typeof node !== 'object') return out
  const rec = node as Record<string, unknown>
  out.push(rec)
  for (const key of ['text', 'stack', 'columns', 'content', 'canvas']) if (key in rec) pdfNodes(rec[key], out)
  if ('table' in rec) pdfNodes((rec.table as Record<string, unknown>).body, out)
  return out
}

/** The node whose own `text` is exactly this string (a leaf paragraph). */
const leafSaying = (dd: Record<string, unknown>, text: string) =>
  pdfNodes(dd.content).find((n) => n.text === text)

/** The container node whose `text` is a run ARRAY mentioning `needle`. */
const blockSaying = (dd: Record<string, unknown>, needle: string) =>
  pdfNodes(dd.content).find((n) => Array.isArray(n.text) && JSON.stringify(n.text).includes(needle))

/**
 * Any bare string sitting where a node belongs. pdfmake tolerates one, but this
 * module never writes one: a string node carries no font, size or colour, so it
 * would print in pdfmake's defaults instead of the view's style.
 */
function bareStringNodes(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) { if (typeof n === 'string') out.push(n); else bareStringNodes(n, out) }
    return out
  }
  if (!node || typeof node !== 'object') return out
  const rec = node as Record<string, unknown>
  for (const key of ['text', 'stack', 'columns', 'content', 'canvas']) {
    if (Array.isArray(rec[key])) bareStringNodes(rec[key], out)
  }
  if ('table' in rec) bareStringNodes((rec.table as Record<string, unknown>).body, out)
  return out
}

const projectView = () => makeView({ sections: [{ key: 'projects', detail: 'full', sort_order: 0 }] })

describe('pdfExporter - paragraph tokens', () => {
  const oneProject = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'AcmeCorp' }, description: { en: 'Built the platform' },
      long_description: {}, ...over,
    })]
    return s
  }

  it('sizes and inks a plain paragraph from the tokens, with its own bottom gap', async () => {
    // The project short description is the one plain paragraph in the tree.
    // Losing its size leaves pdfmake's own default, which no longer matches the
    // density the user picked; losing its gap runs it into the body below.
    const dd = await buildPdfDocDefinition(oneProject(), projectView(), 'en')
    const lead = leafSaying(dd, 'Built the platform')
    expect(lead).toBeDefined()
    expect(lead!.fontSize).toBe(T.bodyFontSizePt)
    expect(lead!.color).toBe('#222222')
    expect((lead!.margin as number[])[3]).toBe(5)
  })

  it('inks rich-text paragraphs AND bullet lines with the body colour', async () => {
    // The two richToPdf branches carry the colour separately; the bullet branch
    // losing it prints default-coloured list lines beside inked paragraphs.
    const dd = await buildPdfDocDefinition(
      oneProject({ long_description: { en: '<p>Alpha</p><ul><li>Beta</li></ul>' } }), projectView(), 'en')
    const alpha = blockSaying(dd, 'Alpha')
    const beta = blockSaying(dd, 'Beta')
    expect(alpha?.color).toBe('#222222')
    expect(alpha?.fontSize).toBe(T.bodyFontSizePt)
    expect(beta?.color).toBe('#222222')
    expect(beta?.fontSize).toBe(T.bodyFontSizePt)
  })

  it('never puts a bare string where a styled node belongs', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe', phone: '+47 900 00 000' })
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
    s.projects = [
      makeProject({
        id: 'p1', customer: { en: 'Acme' },
        long_description: { en: '<p>Alpha</p><ul><li>Beta</li></ul>' },
        highlights: [{ en: 'Cut latency in half' }],
        skills: [{
          id: 'ps1', skill_id: 'go', name: { en: 'Go' },
          duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
        }],
      }),
      // Markup that parses to no blocks at all - the empty-body early return.
      makeProject({ id: 'p2', customer: { en: 'Beta Ltd' }, description: {}, long_description: { en: '<p></p>' } }),
    ]
    const dd = await buildPdfDocDefinition(s, projectView(), 'en')
    expect(bareStringNodes(dd.content)).toEqual([])
  })
})

describe('pdfExporter - the section heading node', () => {
  it('gives the heading table a full-width column and bold accented text', async () => {
    // The heading is a one-row table; without the '*' width pdfmake shrink-wraps
    // it and the rule under the heading stops short of the text edge.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' } })]
    const dd = await buildPdfDocDefinition(s, projectView(), 'en')
    const heading = (dd.content as Record<string, unknown>[]).find((n) => 'table' in n)!
    expect((heading.table as { widths: unknown[] }).widths).toEqual(['*'])
    const cell = (heading.table as { body: Record<string, unknown>[][] }).body[0][0]
    expect(cell.text).toBe('PROJECTS')
    expect(cell.bold).toBe(true)
    expect(cell.fontSize).toBe(T.h2Pt)
    expect(cell.color).toBe('#' + T.headingHex)
  })
})

describe('pdfExporter - the summary line runs', () => {
  const summaryView = (key: string) => makeView({ sections: [{ key, detail: 'summary', sort_order: 0 }] })

  it('sets the title run bold so it reads ahead of its meta', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    s.certifications = [makeCertification({ id: 'c1', name: { en: 'AWS SA' }, organiser: { en: 'Amazon' } })]
    const dd = await buildPdfDocDefinition(s, summaryView('certifications'), 'en')
    const line = blockSaying(dd, 'AWS SA')!
    const runs = line.text as Record<string, unknown>[]
    expect(runs[0]).toMatchObject({ text: 'AWS SA', bold: true })
    expect(line.fontSize).toBe(T.smallFontSizePt)
    expect(runs[1]).toMatchObject({ color: '#666666' })
  })

  it('emits no meta run at all when the item has no meta to show', async () => {
    // An unconditional meta run prints a dangling separator after the title.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    s.certifications = [makeCertification({ id: 'c1', name: { en: 'AWS SA' } })]
    const dd = await buildPdfDocDefinition(s, summaryView('certifications'), 'en')
    const runs = blockSaying(dd, 'AWS SA')!.text as Record<string, unknown>[]
    expect(runs).toHaveLength(1)
  })
})

describe('pdfExporter - what an item row is made of', () => {
  const build = (s: ResumeStore, key: string, style: Record<string, unknown> = {}) =>
    buildPdfDocDefinition(s, makeView({
      sections: [{ key, detail: 'full', sort_order: 0, style } as never],
    }), 'en')

  /** The run array of the node whose FIRST run says exactly this. */
  const rowStartingWith = (dd: Record<string, unknown>, first: string) =>
    pdfNodes(dd.content)
      .filter((n) => Array.isArray(n.text))
      .find((n) => (n.text as Record<string, unknown>[])[0]?.text === first)

  it('writes the inline layout title bold, ahead of its trailing meta', async () => {
    // Languages render as one inline row; an unbolded name loses the only visual
    // separation between the language and its level.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: { en: 'Native' } })]
    const dd = await build(s, 'spoken_languages')
    const row = rowStartingWith(dd, 'Norwegian')!
    const runs = row.text as Record<string, unknown>[]
    expect(runs[0].bold).toBe(true)
    expect(row.fontSize).toBe(T.bodyFontSizePt)
    expect(row.color).toBe('#222222')
  })

  it('opens a quote attribution with the name, never with a stray separator', async () => {
    // With no recommender name the attribution is empty and only the
    // relationship survives; joining without dropping the empty half prints
    // "-  . (Peer)" under the quote.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.recommendations = [makeRecommendation({
      id: 'r1', recommender_name: '', recommender_title: {}, recommender_company: '',
      relationship: { en: 'Peer' }, text: { en: 'Great.' },
    })]
    const dd = await build(s, 'recommendations')
    expect(leafSaying(dd, '— (Peer)')).toBeDefined()
  })

  it('renders no title row at all for an item whose title resolves empty', async () => {
    // A position with neither organisation nor role name still has a body; an
    // unconditional title row prints a blank bold line above it.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.positions = [makePosition({ id: 'pos1', name: {}, organisation: {}, description: { en: 'Did things' } })]
    const dd = await build(s, 'positions')
    // The item did render - it is only the title row that must be absent.
    expect(collectText(dd.content)).toContain('Did things')
    const emptyRuns = pdfNodes(dd.content)
      .filter((n) => Array.isArray(n.text))
      .filter((n) => (n.text as Record<string, unknown>[]).some((r) => r?.text === ''))
    expect(emptyRuns).toEqual([])
  })

  it('sizes a plain item title at body size and a large-title one above it', async () => {
    // titleStyle is the descriptor's choice: Projects head each entry, a
    // certification is a line in a list. Collapsing the two makes every section
    // shout.
    const certStore = emptyStore()
    certStore.resume = makeResume({ full_name: 'X' })
    certStore.certifications = [makeCertification({ id: 'c1', name: { en: 'AWS SA' } })]
    const cert = await build(certStore, 'certifications')
    expect((rowStartingWith(cert, 'AWS SA')!.text as Record<string, unknown>[])[0].fontSize)
      .toBe(T.bodyFontSizePt)

    const projStore = emptyStore()
    projStore.resume = makeResume({ full_name: 'X' })
    projStore.projects = [makeProject({ id: 'p1', customer: { en: 'AcmeCorp' } })]
    const proj = await build(projStore, 'projects')
    expect((rowStartingWith(proj, 'AcmeCorp')!.text as Record<string, unknown>[])[0].fontSize)
      .toBe(T.h3Pt + 1)
  })

  it('leaves the title row a single run when the item carries no date', async () => {
    // An unconditional date run prints three spaces and nothing after them.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.certifications = [makeCertification({ id: 'c1', name: { en: 'AWS SA' }, issued: null })]
    const dd = await build(s, 'certifications')
    expect(rowStartingWith(dd, 'AWS SA')!.text).toHaveLength(1)
  })

  it('bolds a key point bullet only when the point has a label to bold', async () => {
    // The bullet glyph and the label share one run: bolding a bare bullet makes
    // an unlabelled list look like a list of headings.
    const withPoints = (label: Record<string, string>) => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.key_qualifications = [makeKQ({
        id: 'kq1', summary: { en: 'Summary.' },
        key_points: [{ id: 'kp0', name: label, long_description: { en: 'Ran it.' }, sort_order: 0, disabled: false }] as never,
      })]
      return build(s, 'key_qualifications')
    }
    expect((rowStartingWith(await withPoints({}), '• ')!.text as Record<string, unknown>[])[0].bold).toBe(false)
    expect((rowStartingWith(await withPoints({ en: 'Cloud' }), '• Cloud')!.text as Record<string, unknown>[])[0].bold).toBe(true)
  })
})

describe('pdfExporter - the item bullet column', () => {
  const bulletDoc = (style: Record<string, unknown>) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, long_description: { en: 'Did the work.' },
    })]
    return buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'work_experiences', detail: 'full', sort_order: 0, style } as never],
    }), 'en')
  }
  const columnsNode = (dd: Record<string, unknown>) =>
    (dd.content as Record<string, unknown>[]).find((n) => 'columns' in n)!

  it('hangs the content off a fixed glyph column sized from the body text', async () => {
    // The glyph column is a hanging indent: a wrong width (or a missing one)
    // lets the content column slide under the bullet instead of aligning
    // under the heading.
    const dd = await bulletDoc({ item_bullets: true })
    const cols = columnsNode(dd).columns as Record<string, unknown>[]
    expect(cols).toHaveLength(2)
    expect(cols[0].width).toBe(T.bodyFontSizePt * 0.9)
    expect(cols[0].bold).toBe(true)
    expect(cols[0].fontSize).toBe(T.h3Pt)
    expect(cols[0].color).toBe('#' + T.headingHex)
    expect(String(cols[0].text).length).toBeGreaterThan(0)
    expect(cols[1].width).toBe('*')
    expect(Array.isArray(cols[1].stack)).toBe(true)
    expect((cols[1].stack as unknown[]).length).toBeGreaterThan(0)
  })

  it('carries the section gap on the bullet row when the heading is hidden', async () => {
    // The bullet wrapper is the one node this module emits WITHOUT a margin, so
    // it is where a missing zero-margin fallback shows up as NaN geometry.
    const dd = await bulletDoc({ item_bullets: true, hide_heading: true })
    expect(columnsNode(dd).margin).toEqual([0, T.itemGapTwips / 20, 0, 0])
  })
})

describe('pdfExporter - the section dispatcher', () => {
  const workStore = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, role_title: { en: 'Architect' },
      long_description: { en: 'Did the work.' }, ...over,
    })]
    return s
  }
  const summaryDoc = (s: ResumeStore, style: Record<string, unknown> = {}) =>
    buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'work_experiences', detail: 'summary', sort_order: 0, style } as never],
    }), 'en')

  it('trims the short description before it becomes its own line', async () => {
    // Leading whitespace survives into the PDF as a hanging indent on one line
    // of a list where every other line is flush.
    const dd = await summaryDoc(workStore({ short_description: { en: '   Ran the platform.  ' } }))
    expect(leafSaying(dd, 'Ran the platform.')).toBeDefined()
  })

  it('styles the below-the-line short description subtle, with its own tight gap', async () => {
    const dd = await summaryDoc(workStore({ short_description: { en: 'Ran the platform.' } }))
    const line = leafSaying(dd, 'Ran the platform.')!
    expect(line.color).toBe('#666666')
    expect((line.margin as number[])[3]).toBe(3)
  })

  it('joins an inline short description to the meta only when there IS meta', async () => {
    // No employer and no dates leaves the meta empty; joining regardless prints
    // the summary line as "Architect -  - Ran the platform.".
    const dd = await summaryDoc(
      workStore({
        employer: {}, start: null, end: null,
        short_description: { en: 'Ran the platform.' },
      }),
      { short_desc_line: 'inline' },
    )
    const row = pdfNodes(dd.content)
      .filter((n) => Array.isArray(n.text))
      .find((n) => (n.text as Record<string, unknown>[])[0]?.text === 'Architect')!
    expect((row.text as Record<string, unknown>[])[1].text).toBe(' — Ran the platform.')
  })

  it('prints no heading for a section whose every item opts out of exports', async () => {
    // A reference kept for the consultant's own records still counts as an item,
    // so the section survives the empty-items guard and only the per-item render
    // can drop it. A heading over nothing looks like lost content.
    const refsDoc = (include_in_exports: boolean, detail: 'full' | 'summary') => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.references = [makeReference({ id: 'ref1', name: 'Jane Doe', include_in_exports })]
      return buildPdfDocDefinition(s, makeView({
        sections: [{ key: 'references', detail, sort_order: 0 }],
      }), 'en')
    }
    for (const detail of ['full', 'summary'] as const) {
      expect(collectText((await refsDoc(false, detail)).content).join(' | '), detail)
        .not.toContain('REFERENCES')
      // The opt-in case proves the section really is reaching the item renderer,
      // rather than being dropped earlier as an empty section.
      expect(collectText((await refsDoc(true, detail)).content).join(' | '), detail)
        .toContain('REFERENCES')
    }
  })

  it('does not repeat the first node when the heading is hidden', async () => {
    // The first node absorbs the section gap and the REST follow it; taking the
    // whole list instead prints the item title twice.
    const dd = await buildPdfDocDefinition(workStore(), makeView({
      sections: [{ key: 'work_experiences', detail: 'full', sort_order: 0, style: { hide_heading: true } } as never],
    }), 'en')
    const titleRows = pdfNodes(dd.content)
      .filter((n) => Array.isArray(n.text))
      .filter((n) => (n.text as Record<string, unknown>[])[0]?.text === 'Acme — Architect')
    expect(titleRows).toHaveLength(1)
  })
})

describe('pdfExporter - the skill matrix section', () => {
  const matrixDoc = (s: ResumeStore, detail: 'full' | 'summary' = 'full', style: Record<string, unknown> = {}) =>
    buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'skill_matrix', detail, sort_order: 0, style } as never],
    }), 'en')

  /** The matrix table node - the only table in the tree declaring a header row. */
  const matrixTable = (dd: Record<string, unknown>) =>
    pdfNodes(dd.content).find((n) => (n.table as { headerRows?: number } | undefined)?.headerRows === 1)

  const rowsOf = (dd: Record<string, unknown>): string[][] => {
    const table = matrixTable(dd)
    if (!table) return []
    return (table.table as { body: Record<string, unknown>[][] }).body
      .map((row) => row.map((c) => String(c.text ?? '')))
  }

  it('adds the Category column when only SOME of the rows are categorised', async () => {
    // A partly-classified registry is the normal state of a real CV. Requiring
    // every row to have one drops the column and hides the classification work
    // the user already did.
    const s = emptyStore()
    s.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    s.skills = [
      makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category_id: 'cat1', proficiency: 4 }),
      makeSkill({ id: 'sh', name: { en: 'Bash' }, category_id: null, proficiency: 3 }),
    ]
    const rows = rowsOf(await matrixDoc(s))
    const col = rows[0].indexOf('Category')
    expect(col).toBeGreaterThan(-1)
    expect(rows.slice(1).map((r) => r[col]).sort()).toEqual(['', 'Languages'])
  })

  it('fills the Last used cell from the skill’s most recent project', async () => {
    // The column exists to answer "is this current?"; an empty cell reads as
    // "never used" for a skill the CV shows three projects of.
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'ts', name: { en: 'TypeScript' }, proficiency: 4 })]
    s.projects = [makeProject({
      id: 'p1', start: { year: 2020, month: 1 }, end: { year: 2023, month: 6 },
      skills: [{
        id: 'ps1', skill_id: 'ts', name: { en: 'TypeScript' },
        duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
      }],
    })]
    const rows = rowsOf(await matrixDoc(s))
    expect(rows[0].at(-1)).toBe('Last used')
    expect(rows[1].at(-1)).toContain('2023')
  })

  it('rules the matrix in a neutral grey, not in the accent colour', async () => {
    // The accent belongs to the section headings; using it for table rules turns
    // a reference table into the loudest thing on the page.
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'ts', name: { en: 'TypeScript' }, proficiency: 4 })]
    const layout = matrixTable(await matrixDoc(s))!.layout as Record<string, (i: number) => unknown>
    expect(layout.hLineColor(1)).toBe('#d1d5db')
  })

  it('narrows the matrix to highlighted skills at summary detail only', async () => {
    const s = emptyStore()
    s.skills = [
      makeSkill({ id: 'ts', name: { en: 'TypeScript' }, proficiency: 4, is_highlighted: true }),
      makeSkill({ id: 'sh', name: { en: 'Bash' }, proficiency: 3, is_highlighted: false }),
    ]
    const summary = rowsOf(await matrixDoc(s, 'summary')).slice(1).map((r) => r[0])
    expect(summary).toEqual(['TypeScript'])
    const full = rowsOf(await matrixDoc(s, 'full')).slice(1).map((r) => r[0])
    expect(full).toEqual(['TypeScript', 'Bash'])
  })

  it('renders no table and no heading when there is no skill to tabulate', async () => {
    // A header row over an empty body is a table of nothing - worse than the
    // section simply not appearing.
    const s = emptyStore()
    const dd = await matrixDoc(s)
    expect(rowsOf(dd)).toEqual([])
    expect(collectText(dd.content).join(' | ')).not.toContain('SKILL MATRIX')
  })

  it('heads the matrix unless the section is set to hide its heading', async () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'ts', name: { en: 'TypeScript' }, proficiency: 4 })]
    const shown = await matrixDoc(s)
    expect(collectText(shown.content).join(' | ')).toContain('SKILL MATRIX')

    const hidden = await matrixDoc(s, 'full', { hide_heading: true })
    expect(collectText(hidden.content).join(' | ')).not.toContain('SKILL MATRIX')
    // The table itself must survive - hiding the heading is not hiding the data.
    expect(rowsOf(hidden)).not.toEqual([])
  })
})

describe('pdfExporter - the identity block styling', () => {
  const identityDoc = (over: Record<string, unknown> = {}, header: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.resume = makeResume({
      full_name: 'Kari Nordmann', title: { en: 'Solution Architect' },
      phone: '+47 900 00 000', email: 'kari@example.com', ...over,
    })
    return buildPdfDocDefinition(s, makeView({ sections: [], header: withHeaderDefaults(header) }), 'en')
  }

  it('sets the name in the heading colour at the h1 size, bold', async () => {
    // The name is the largest thing on page one; losing its size drops it to
    // body text and the CV opens on an unremarkable line.
    const name = (await identityDoc()).content as Record<string, unknown>[]
    expect(name[0]).toMatchObject({ text: 'Kari Nordmann', bold: true, color: '#' + T.headingHex })
    expect(name[0].fontSize).toBe(T.h1Pt)
  })

  it('sets the title one point above the small size, in its own softer ink', async () => {
    const dd = await identityDoc()
    const title = (dd.content as Record<string, unknown>[])[1]
    expect(title.text).toBe('Solution Architect')
    expect(title.color).toBe('#444444')
    expect(title.fontSize).toBe(T.smallFontSizePt + 1)
  })

  it('honours an explicit name and title size over the tokens', async () => {
    const dd = await identityDoc({}, {
      name_style: { size_pt: 30, font: 'condensed' },
      title_style: { size_pt: 9, font: 'body' },
    })
    const content = dd.content as Record<string, unknown>[]
    expect(content[0].fontSize).toBe(30)
    expect(content[1].fontSize).toBe(9)
  })

  it('emits no title node at all when there is no title to show', async () => {
    // An unconditional title node prints an empty line between the name and the
    // contact details.
    const dd = await identityDoc({ title: {} })
    const titled = (dd.content as Record<string, unknown>[]).filter((n) => n.color === '#444444')
    expect(titled).toEqual([])
  })

  it('colours a contact label faint and its value subtle', async () => {
    // The label is chrome and the value is the content; one colour for both
    // makes "Phone:" compete with the number.
    const dd = await identityDoc()
    const runs = pdfNodes(dd.content).filter((n) => typeof n.text === 'string')
    expect(runs.find((r) => r.text === 'Phone: ')?.color).toBe('#888888')
    expect(runs.find((r) => r.text === '+47 900 00 000')?.color).toBe('#666666')
  })

  it('emits no label run for a field whose label the user blanked everywhere', async () => {
    // Clearing the label in every language is how a user asks for bare values;
    // pushing the run regardless leaves an empty styled run before each one.
    const blank = Object.fromEntries(LOCALE_CODES.map((c) => [c, '']))
    const dd = await identityDoc({}, {
      fields: [{ key: 'phone', show: true, label: blank, same_line: false, sort_order: 0 }],
    })
    const runs = pdfNodes(dd.content).filter((n) => typeof n.text === 'string')
    expect(runs.filter((r) => r.text === '')).toEqual([])
    expect(runs.some((r) => r.text === '+47 900 00 000')).toBe(true)
  })
})

/** A PNG whose IHDR declares `w` x `h`; only the header is ever read. */
function pngHeader(w: number, h: number): string {
  const bytes = new Uint8Array(40)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const be = (o: number, v: number) => {
    bytes[o] = (v >>> 24) & 0xff; bytes[o + 1] = (v >>> 16) & 0xff
    bytes[o + 2] = (v >>> 8) & 0xff; bytes[o + 3] = v & 0xff
  }
  be(16, w); be(20, h)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:image/png;base64,${btoa(binary)}`
}

/** Every node in the tree that carries an `image`. */
const imageNodes = (dd: Record<string, unknown>) =>
  pdfNodes(dd.content).filter((n) => typeof n.image === 'string')

describe('pdfExporter - where the photo sits relative to the identity', () => {
  const build = (photo_placement: string) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe', profile_photo: pngHeader(100, 120) })
    return buildPdfDocDefinition(s, makeView({
      sections: [], header: withHeaderDefaults({ photo_placement: photo_placement as never }),
    }), 'en')
  }
  const columnRoles = (dd: Record<string, unknown>) => {
    const node = (dd.content as Record<string, unknown>[]).find((n) => 'columns' in n)!
    return (node.columns as Record<string, unknown>[])
      .map((c) => (imageNodes({ content: [c] }).length ? 'photo' : 'identity'))
  }

  it('keeps the name-level placements on the side they name', async () => {
    // left_of_name / right_of_name share the column layout with left / right;
    // folding them into the fallback drops the photo to the bottom of the
    // header instead of beside the name.
    expect(columnRoles(await build('left_of_name'))).toEqual(['photo', 'identity'])
    expect(columnRoles(await build('right_of_name'))).toEqual(['identity', 'photo'])
  })

  it('gives the identity column the flexible width in both column layouts', async () => {
    for (const placement of ['left', 'right']) {
      const node = ((await build(placement)).content as Record<string, unknown>[]).find((n) => 'columns' in n)!
      const cols = node.columns as Record<string, unknown>[]
      const identity = cols.find((c) => !imageNodes({ content: [c] }).length)!
      expect(identity.width, placement).toBe('*')
      expect((identity.stack as unknown[]).length, placement).toBeGreaterThan(0)
    }
  })

  it('puts a "below" photo AFTER the identity, with its own breathing room', async () => {
    // 'below' is the fallback branch; treating it like 'above' silently moves
    // the photo to the top of the page for every view that chose it.
    const dd = await build('below')
    const nodes = dd.content as Record<string, unknown>[]
    const photoAt = nodes.findIndex((n) => typeof n.image === 'string')
    const nameAt = nodes.findIndex((n) => n.text === 'Jane Doe')
    expect(photoAt).toBeGreaterThan(nameAt)
    expect(nodes[photoAt].margin).toEqual([0, 6, 0, 8])
    expect(nodes[photoAt].width).toBe(100)
  })
})

describe('pdfExporter - masking a non-square photo', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.doUnmock('../src/lib/image') })

  const MASKED = pngHeader(40, 40)

  /**
   * The real mask draws on a canvas, which jsdom never loads an image into, so
   * it is stubbed here. What matters is WHETHER it is called, and that its
   * result is what gets embedded.
   */
  const loadWithMask = async (mask: (url: string, shape: string) => Promise<string>) => {
    const actual = await vi.importActual<typeof import('../src/lib/image')>('../src/lib/image')
    vi.doMock('../src/lib/image', () => ({ ...actual, applyShapeMaskToDataUrl: mask }))
    return import('../src/lib/pdfExporter')
  }

  const run = async (
    opts: { photo: string | null; shape: string; placement: string },
    mask: (url: string, shape: string) => Promise<string> = async () => MASKED,
  ) => {
    const calls: Array<[string, string]> = []
    const { buildPdfDocDefinition: build } = await loadWithMask((url, shape) => {
      calls.push([url, shape]); return mask(url, shape)
    })
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe', profile_photo: opts.photo })
    const dd = await build(s, makeView({
      sections: [],
      header: withHeaderDefaults({
        photo_placement: opts.placement as never, photo_shape: opts.shape as never,
      }),
    }), 'en')
    return { calls, dd }
  }

  it('masks the photo, and embeds the MASKED bytes, for a non-square shape', async () => {
    const photo = pngHeader(100, 120)
    const { calls, dd } = await run({ photo, shape: 'circle', placement: 'left' })
    expect(calls).toEqual([[photo, 'circle']])
    expect(imageNodes(dd)[0].image).toBe(MASKED)
  })

  it('leaves a square photo alone - masking it would be a needless re-encode', async () => {
    const photo = pngHeader(100, 120)
    const { calls, dd } = await run({ photo, shape: 'square', placement: 'left' })
    expect(calls).toEqual([])
    expect(imageNodes(dd)[0].image).toBe(photo)
  })

  it('does not mask a photo the header is not going to show', async () => {
    const { calls } = await run({ photo: pngHeader(100, 120), shape: 'circle', placement: 'none' })
    expect(calls).toEqual([])
  })

  it('does not reach for a mask when there is no photo at all', async () => {
    const { calls } = await run({ photo: null, shape: 'circle', placement: 'left' })
    expect(calls).toEqual([])
  })

  it('falls back to the unmasked photo when masking fails', async () => {
    // A stored image the browser cannot decode must not cost the user their
    // photo - a square-cornered picture beats no picture.
    const photo = pngHeader(100, 120)
    const { dd } = await run(
      { photo, shape: 'circle', placement: 'left' },
      () => Promise.reject(new Error('canvas unavailable')),
    )
    expect(imageNodes(dd)[0].image).toBe(photo)
  })
})

describe('pdfExporter - the introduction paragraphs', () => {
  const introDoc = (text: string) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    return buildPdfDocDefinition(s, makeView({ sections: [], introduction: { en: text } }), 'en')
  }

  it('opens the intro with a gap, spaces its paragraphs and closes with a bigger one', async () => {
    // The closing gap separates the intro from the first section heading; using
    // the paragraph gap there makes the intro read as part of that section.
    const dd = await introDoc('First para.\n\nSecond para.')
    const first = leafSaying(dd, 'First para.')!
    const last = leafSaying(dd, 'Second para.')!
    expect(first.margin).toEqual([0, 4, 0, T.paraGapPt])
    expect(last.margin).toEqual([0, 0, 0, 12])
    expect(first.italics).toBe(true)
    expect(first.color).toBe('#333333')
    expect(first.fontSize).toBe(T.bodyFontSizePt)
  })

  it('gives a single-paragraph intro the closing gap, not the paragraph gap', async () => {
    const dd = await introDoc('Only para.')
    expect((leafSaying(dd, 'Only para.')!.margin as number[])[3]).toBe(12)
  })
})

describe('pdfExporter - the footer rule and its lines', () => {
  const footerDoc = (footer: Record<string, unknown>) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Ada Lovelace' })
    return buildPdfDocDefinition(s, makeView({
      sections: [],
      footer: { copyright_custom: {}, note: {}, note_placement: 'after', ...footer } as never,
    }), 'en')
  }
  const canvasNode = (dd: Record<string, unknown>) =>
    (dd.content as Record<string, unknown>[]).find((n) => 'canvas' in n)

  it('draws the rule the full width of the text column', async () => {
    // The rule spans the CONTENT box, so both page margins come off the A4
    // width; adding one instead of subtracting it runs the line off the page.
    const dd = await footerDoc({ separator: 'line', copyright: 'person' })
    const line = (canvasNode(dd)!.canvas as Record<string, unknown>[])[0]
    const expected = 595.28 - T.pageMarginTwips.left / 20 - T.pageMarginTwips.right / 20
    expect(line).toMatchObject({ type: 'line', x1: 0, y1: 0, y2: 0 })
    expect(line.x2).toBeCloseTo(expected, 6)
    expect(line.lineColor).toBe('#' + T.accentHex)
  })

  it('weights the rule by the separator style the view picked', async () => {
    const thin = (canvasNode(await footerDoc({ separator: 'line', copyright: 'person' }))!.canvas as Record<string, unknown>[])[0]
    const thick = (canvasNode(await footerDoc({ separator: 'thick', copyright: 'person' }))!.canvas as Record<string, unknown>[])[0]
    expect(thin.lineWidth).toBe(0.6)
    expect(thick.lineWidth).toBe(1.6)
  })

  it('dashes only the dashed styles, each with its own pattern', async () => {
    const dashOf = async (separator: string) =>
      ((canvasNode(await footerDoc({ separator, copyright: 'person' }))!.canvas as Record<string, unknown>[])[0]).dash
    expect(await dashOf('dotted')).toEqual({ length: 1, space: 2 })
    expect(await dashOf('dashed')).toEqual({ length: 4, space: 3 })
    expect(await dashOf('line')).toBeUndefined()
  })

  it('leaves room under the rule only when there is a line to sit there', async () => {
    const withText = canvasNode(await footerDoc({ separator: 'line', copyright: 'person' }))!
    expect(withText.margin).toEqual([0, 16, 0, 6])
    const bare = canvasNode(await footerDoc({ separator: 'line', copyright: 'none' }))!
    expect(bare.margin).toEqual([0, 16, 0, 0])
  })

  it('draws no rule at all for the "none" separator, and pushes the text down instead', async () => {
    const dd = await footerDoc({ separator: 'none', copyright: 'person' })
    expect(canvasNode(dd)).toBeUndefined()
    const line = pdfNodes(dd.content).find((n) => String(n.text).includes('Ada Lovelace') && n.alignment === 'center')!
    expect((line.margin as number[])[1]).toBe(16)
  })
})

describe('pdfExporter - the document defaults', () => {
  it('carries the view font, size, leading and ink as the document default', async () => {
    // Every node that sets none of these inherits them; an empty defaultStyle
    // hands the whole document to pdfmake's built-in 12pt Roboto.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    const dd = await buildPdfDocDefinition(s, makeView({ sections: [] }), 'en')
    const def = dd.defaultStyle as Record<string, unknown>
    expect(def.fontSize).toBe(T.bodyFontSizePt)
    expect(def.lineHeight).toBe(T.lineHeight)
    expect(def.color).toBe('#222222')
    expect(String(def.font).length).toBeGreaterThan(0)
  })

  it('builds a document for a store with no resume record, header and footer alike', async () => {
    // The picker can hand a half-restored store to the preview; reaching into a
    // missing resume there throws instead of rendering the sections that DO
    // exist.
    const s: ResumeStore = { ...emptyStore(), resume: null }
    s.projects = [makeProject({ id: 'p1', customer: { en: 'AcmeCorp' } })]
    const dd = await buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 }],
      footer: { separator: 'line', copyright: 'person', copyright_custom: {}, note: {}, note_placement: 'after' },
    }), 'en')
    const text = collectText(dd.content).join(' | ')
    expect(text).toContain('AcmeCorp')
    expect((dd.content as Record<string, unknown>[]).some((n) => 'canvas' in n)).toBe(false)
  })
})

describe('pdfExporter - the cover letter block by block', () => {
  const size = T.bodyFontSizePt
  const fullLetter = () => {
    const store: ResumeStore = {
      ...emptyStore(),
      resume: makeResume({ full_name: 'Ada Lovelace', email: 'ada@x.io', phone: '+47 900 00 000', website_url: null }),
    }
    const letter = makeCoverLetter({
      company: { en: 'Equinor' }, recipient: { en: 'Hiring Manager' },
      role_applied: { en: 'Architect' }, greeting: { en: 'Dear Manager,' },
      body: { en: 'First paragraph.' }, closing: { en: 'Sincerely,' },
      place_dated: 'Oslo, 1 May 2026',
    })
    return buildCoverLetterPdfDef(store, letter, 'en') as Record<string, unknown>
  }
  const blocks = (dd: Record<string, unknown>) => dd.content as Record<string, unknown>[]
  const saying = (dd: Record<string, unknown>, text: string) =>
    blocks(dd).filter((n) => n.text === text)

  it('sets the letterhead name in the accent, above the body size', async () => {
    // The letterhead IS the branding on a letter that carries no logo; at body
    // size and body colour it reads as the first line of the letter instead.
    const dd = fullLetter()
    expect(blocks(dd)[0]).toMatchObject({ text: 'Ada Lovelace', bold: true })
    expect(blocks(dd)[0].color).toBe('#' + T.accentHex)
    expect(blocks(dd)[0].fontSize).toBe(size + 5)
    expect(blocks(dd)[0].margin).toEqual([0, 0, 0, 2])
    expect(String(blocks(dd)[0].font).length).toBeGreaterThan(0)
  })

  it('sets the contact line a point BELOW the body, so it supports the name', async () => {
    const contact = blocks(fullLetter())[1]
    expect(String(contact.text)).toContain('ada@x.io')
    expect(String(contact.text)).toContain('+47 900 00 000')
    expect(contact.fontSize).toBe(size - 1)
    expect(contact.color).toBe('#333333')
    expect(contact.margin).toEqual([0, 0, 0, 16])
  })

  it('spaces the dateline and the recipient block apart from what follows', async () => {
    const dd = fullLetter()
    expect(saying(dd, 'Oslo, 1 May 2026')[0]).toMatchObject({ fontSize: size, margin: [0, 0, 0, 16] })
    const recipient = saying(dd, 'Hiring Manager\nEquinor')[0]
    expect(recipient).toBeDefined()
    expect(recipient).toMatchObject({ fontSize: size, margin: [0, 0, 0, 16] })
  })

  it('bolds the subject line so the reader can route the letter', async () => {
    const dd = fullLetter()
    const subject = blocks(dd).find((n) => String(n.text).startsWith('Application for'))!
    expect(subject).toMatchObject({ bold: true, fontSize: size, margin: [0, 0, 0, 14] })
    expect(saying(dd, 'Dear Manager,')[0]).toMatchObject({ fontSize: size, margin: [0, 0, 0, 10] })
  })

  it('closes with the sign-off and the name under it, bold and tight', async () => {
    const dd = fullLetter()
    expect(saying(dd, 'Sincerely,')[0]).toMatchObject({ fontSize: size, margin: [0, 6, 0, 0] })
    // Twice: once in the letterhead, once as the signature.
    const names = saying(dd, 'Ada Lovelace')
    expect(names).toHaveLength(2)
    expect(names[1]).toMatchObject({ bold: true, fontSize: size, margin: [0, 2, 0, 0] })
  })

  it('carries the letter font, size, leading and ink as the document default', async () => {
    const def = fullLetter().defaultStyle as Record<string, unknown>
    expect(def.fontSize).toBe(size)
    expect(def.lineHeight).toBe(T.lineHeight)
    expect(def.color).toBe('#222222')
    expect(String(def.font).length).toBeGreaterThan(0)
  })

  it('emits no empty block for a part the letter simply does not have', async () => {
    // With no resume behind it and only a body written, every optional block is
    // empty. An unconditional push prints each one as a blank line, which on a
    // one-page letter is most of the page.
    const store: ResumeStore = { ...emptyStore(), resume: null }
    const dd = buildCoverLetterPdfDef(
      store, makeCoverLetter({ body: { en: 'Body only.' }, place_dated: 'Oslo, 1 May 2026' }), 'en',
    ) as Record<string, unknown>
    const texts = blocks(dd).map((n) => String(n.text))
    expect(texts).toEqual(['Oslo, 1 May 2026', 'Body only.'])
  })

  it('still prints a sign-off when the letter has one but the store has no name', async () => {
    // The closing is the user's own words; dropping it because there is no name
    // to sign with loses text they wrote.
    const store: ResumeStore = { ...emptyStore(), resume: null }
    const dd = buildCoverLetterPdfDef(
      store, makeCoverLetter({ body: { en: 'Body.' }, closing: { en: 'Sincerely,' } }), 'en',
    ) as Record<string, unknown>
    expect(blocks(dd).map((n) => String(n.text))).toContain('Sincerely,')
  })

  it('borrows the referenced view’s accent so letter and CV read as one submission', async () => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'Ada Lovelace' })
    store.views = [makeView({ id: 'v1', style: { ...DEFAULT_VIEW_STYLE, accent_color: '#aa1122' } })]
    const dd = buildCoverLetterPdfDef(
      store, makeCoverLetter({ view_id: 'v1', body: { en: 'Body.' } }), 'en',
    ) as Record<string, unknown>
    expect(String((dd.content as Record<string, unknown>[])[0].color).toLowerCase()).toBe('#aa1122')
  })
})

describe('exportPdf - the file it hands the browser', () => {
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

  function stubPdfMake() {
    const seen: { name?: string; doc?: Record<string, unknown>; fonts: string[] } = { fonts: [] }
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
            async download(name: string) { seen.name = name },
            async getBlob() { return new Blob() },
            async open() {},
          }
        },
      },
    }))
    return seen
  }

  it('downloads the built document under a name from the person and the view', async () => {
    const seen = stubPdfMake()
    const mod = await import('../src/lib/pdfExporter')
    const store = { ...emptyStore(), resume: makeResume({ full_name: 'Ada Lovelace' }) }
    store.projects = [makeProject({ id: 'p1', customer: { en: 'AcmeCorp' } })]
    await mod.exportPdf(store, makeView({
      name: 'Board CV', sections: [{ key: 'projects', detail: 'full', sort_order: 0 }],
    }), 'en')
    expect(seen.name).toMatch(/Ada_Lovelace/)
    expect(seen.name).toMatch(/Board_CV/)
    expect(seen.name).toMatch(/\.pdf$/)
    // The document that was laid out is the real one, not an empty shell.
    expect(JSON.stringify(seen.doc)).toContain('AcmeCorp')
  })

  it('exports a store with no resume record instead of throwing', async () => {
    const seen = stubPdfMake()
    const mod = await import('../src/lib/pdfExporter')
    const store: ResumeStore = { ...emptyStore(), resume: null }
    await expect(mod.exportPdf(store, makeView({ name: 'Board CV' }), 'en')).resolves.toBeUndefined()
    expect(seen.name).toMatch(/Board_CV/)
  })

  it('caches pdfmake until the test seam drops it', async () => {
    // The library and its font vfs are ~2 MB; re-registering them per export
    // would re-pay that on every click. The seam exists so a suite can re-stub,
    // and it has to actually clear the cache to do that.
    const seen = stubPdfMake()
    const mod = await import('../src/lib/pdfExporter')
    const store = { ...emptyStore(), resume: makeResume({ full_name: 'Ada Lovelace' }) }
    await mod.countPdfPages(store, makeView(), 'en')
    const once = seen.fonts.length
    expect(once).toBeGreaterThan(0)
    await mod.countPdfPages(store, makeView(), 'en')
    expect(seen.fonts).toHaveLength(once)
    mod.__resetPdfMakeForTests()
    await mod.countPdfPages(store, makeView(), 'en')
    expect(seen.fonts).toHaveLength(once * 2)
  })
})

describe('pdfExporter - an image whose header declares a zero dimension', () => {
  // A truncated or hand-edited PNG can carry a 0 in its IHDR. Dividing by it
  // gives Infinity, the scale collapses, and the photo prints as a 1pt dot -
  // so the missing dimension has to fall back to the box, not be used as-is.
  const photoBox = async (src: string) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe', profile_photo: src })
    const dd = await buildPdfDocDefinition(s, makeView({
      sections: [], header: withHeaderDefaults({ photo_placement: 'left' }),
    }), 'en')
    return imageNodes(dd)[0]
  }

  it('falls back to the box WIDTH when the file declares none', async () => {
    // 0 x 200 into the 100 x 120 photo box: width becomes 100, height wins the
    // scale at 0.6, so the photo prints 60 x 120.
    expect(await photoBox(pngHeader(0, 200))).toMatchObject({ width: 60, height: 120 })
  })

  it('falls back to the box HEIGHT when the file declares none', async () => {
    // 200 x 0: height becomes 120, width wins the scale at 0.5 -> 100 x 60.
    expect(await photoBox(pngHeader(200, 0))).toMatchObject({ width: 100, height: 60 })
  })
})

describe('pdfExporter - a registry section a view happens to list', () => {
  it('contributes nothing at all for a section the catalog cannot render', async () => {
    // The Industry registry passes the exportable filter (it has a store key)
    // but its catalog entry has neither a summary nor a full renderer - it
    // exists for editor titles only. It must drop out silently rather than
    // leaving a heading or an unstyled node in the flow.
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Jane Doe' })
    s.industries = [{ id: 'ind1', name: { en: 'Energy' }, sort_order: 0 } as never]
    const dd = await buildPdfDocDefinition(s, makeView({
      sections: [{ key: 'industries', detail: 'full', sort_order: 0 }],
    }), 'en')
    expect(bareStringNodes(dd.content)).toEqual([])
    expect(collectText(dd.content)).not.toContain('Energy')
  })
})
