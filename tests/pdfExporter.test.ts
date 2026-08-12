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
import {
  emptyStore, makeResume, makeProject, makeView, makeCoverLetter,
  makeSkill, makeSkillCategory, makeKQ, makeWork, makeSpokenLanguage, makeRecommendation,
  makeCertification,
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
    const doc = await dd(projectStore())
    expect(texts(doc).some((x) => x.includes('Go, Kubernetes'))).toBe(true)
    const label = runs(doc.content).find((r) => /skills/i.test(String(r.text)))
    expect(label?.italics).toBe(true)
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
      sections: [{ key: 'technology_categories', detail: 'full', sort_order: 0 } as never],
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
      sections: [{ key: 'certifications', detail: 'full', sort_order: 0 } as never],
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
    const t = texts(await dd(s))
    expect(t.filter((x) => x.trim() === '')).toEqual([])
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
