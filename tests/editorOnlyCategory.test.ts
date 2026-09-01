/**
 * @vitest-environment jsdom
 *
 * The shared item category (`lib/courseCategories.ts`) is EDITOR-ONLY: it
 * organizes the editor and drives view selection, and it must never be printed.
 *
 * Why this needs its own suite. The field is carried by four sections now
 * (Courses, Certifications, Presentations, Publications) and read by two
 * mechanisms that DO reach exports — the view editor's "By type" quick-select
 * and the per-view item exclusions — so the value travels close to the render
 * boundary without ever being allowed to cross it. Nothing about the type says
 * so: `category` is a plain string on the same object as the fields that ARE
 * exported, one line away in the descriptor. A leak would be a quiet
 * correctness bug (a stray "Food & Beverage" in a client's PDF), not a crash,
 * and no existing suite would catch it — `exportParity` asserts the inverse,
 * that declared facts DO reach every target.
 *
 * Assertions are on the FACTS a reader could find, in both the stored key and
 * the editor label, across every adapter that renders these sections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildViewHtml } from '../src/lib/viewFilter'
import { buildViewText, buildViewMarkdown } from '../src/lib/viewText'
import { buildPdfDocDefinition } from '../src/lib/pdfExporter'
import { exportDocx } from '../src/lib/exporter'
import { buildJsonResume } from '../src/lib/exporterJsonResume'
import { exportEuropassXml } from '../src/lib/exporterEuropass'
import { unzipSync, strFromU8 } from 'fflate'
import {
  emptyStore, makeResume, makeView, makeCourse, makeCertification,
  makePresentation, makePublication,
} from './fixtures'
import type { ResumeStore, ResumeView } from '../src/types'

/** Collect every `text` string in a pdfmake content tree. */
function pdfText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') { if (node) out.push(node); return out }
  if (Array.isArray(node)) { for (const n of node) pdfText(n, out); return out }
  if (node && typeof node === 'object') for (const v of Object.values(node as Record<string, unknown>)) pdfText(v, out)
  return out
}

/**
 * One category per section, so a leak names the section that leaked it, plus
 * the item title that proves the section rendered at all.
 */
const CATEGORIES: Array<{ section: string; key: string; label: string; title: string }> = [
  { section: 'courses', key: 'medical', label: 'Medical', title: 'Threat modelling' },
  { section: 'certifications', key: 'food_beverage', label: 'Food & Beverage', title: 'AWS SA' },
  { section: 'presentations', key: 'leisure', label: 'Leisure', title: 'Zero Trust talk' },
  { section: 'publications', key: 'vehicles', label: 'Vehicles', title: 'A paper' },
]

/**
 * Which sections each surface actually carries — measured, not assumed. The
 * leak check runs on every surface; this is the NEGATIVE CONTROL that keeps it
 * from passing vacuously, so it has to be exact. A surface that stops rendering
 * a section fails here rather than quietly making its leak check meaningless.
 *
 * JSON Resume has no slot for courses or presentations, and Europass's
 * SkillsPassport carries none of the four.
 */
const RENDERS: Record<string, string[]> = {
  'HTML preview': ['courses', 'certifications', 'presentations', 'publications'],
  'ATS text': ['courses', 'certifications', 'presentations', 'publications'],
  Markdown: ['courses', 'certifications', 'presentations', 'publications'],
  PDF: ['courses', 'certifications', 'presentations', 'publications'],
  DOCX: ['courses', 'certifications', 'presentations', 'publications'],
  'JSON Resume': ['certifications', 'publications'],
  Europass: [],
}

function categorizedStore(): ResumeStore {
  const s = emptyStore()
  s.resume = makeResume({ full_name: 'Test Person' })
  s.courses = [makeCourse({ id: 'co1', name: { en: 'Threat modelling' }, category: 'medical' })]
  s.certifications = [makeCertification({
    id: 'ce1', name: { en: 'AWS SA' }, organiser: { en: 'Amazon' }, category: 'food_beverage',
  })]
  s.presentations = [makePresentation({
    id: 'pr1', title: { en: 'Zero Trust talk' }, event: { en: 'Conf' }, category: 'leisure',
  })]
  s.publications = [makePublication({
    id: 'pu1', title: { en: 'A paper' }, publisher: { en: 'ACM' },
    publication_type: 'article', category: 'vehicles',
  })]
  return s
}

const fullView = (): ResumeView => makeView({
  sections: CATEGORIES.map(({ section }, i) => ({
    key: section, detail: 'full' as const, sort_order: i, style: {},
  })),
}) as ResumeView

let lastBlob: Blob | null = null

describe('the shared item category is editor-only', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // exportDocx triggers a download; capture the blob instead of writing one.
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { lastBlob = b as Blob; return 'blob:x' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it('never reaches any export surface, for any of the four sections', async () => {
    const store = categorizedStore()
    const view = fullView()

    const dd = await buildPdfDocDefinition(store, view, 'en')
    lastBlob = null
    await exportDocx(store, view, 'en')
    const docx = strFromU8(unzipSync(new Uint8Array(await lastBlob!.arrayBuffer()))['word/document.xml'])

    const surfaces: Record<string, string> = {
      'HTML preview': buildViewHtml(store, view, 'en'),
      'ATS text': buildViewText(store, view, 'en'),
      Markdown: buildViewMarkdown(store, view, 'en'),
      PDF: pdfText(dd.content).join('\n'),
      DOCX: docx,
      'JSON Resume': JSON.stringify(buildJsonResume(store, view, 'en')),
      // Europass carries none of these four sections — SkillsPassport has no
      // slot for them — so it is leak-checked but not content-checked.
      Europass: exportEuropassXml(store, view, 'en'),
    }

    for (const [name, text] of Object.entries(surfaces)) {
      const carried = RENDERS[name]
      for (const { section, key, label, title } of CATEGORIES) {
        // Negative control first: a section this surface is supposed to render
        // must actually be in there, or its leak check below proves nothing.
        expect(text.includes(title), `${name} did not render the ${section} item`)
          .toBe(carried.includes(section))
        expect(text.includes(key), `${name} leaked the ${section} category key "${key}"`).toBe(false)
        expect(text.includes(label), `${name} leaked the ${section} category label "${label}"`).toBe(false)
      }
    }
  })
})
