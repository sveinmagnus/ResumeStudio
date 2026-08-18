/**
 * @vitest-environment jsdom
 *
 * WHOLE-DOCUMENT parity: one view, rendered through every adapter, must state
 * the same facts.
 *
 * `sectionCatalog.test.ts` pins parity at the descriptor level — that the data
 * view is the same object whichever target asks. This suite pins the other
 * half: that each adapter actually RENDERS what the descriptor handed it. Both
 * halves failed once, independently, and each was invisible from the other:
 *
 *   - the catalog set `tagsLabel` only on the shape the paged exports asked
 *     for, so the ATS text printed "Go, Kubernetes" with nothing saying what
 *     those words were;
 *   - the HTML renderer never drew `plainBody` or `extraLines` at all, so a
 *     grade or a credential URL reached the PDF and the Word file while the
 *     preview the consultant checked first showed neither.
 *
 * The second is the one that matters: a preview that under-reports is worse
 * than no preview, because it is believed. So the assertions below are about
 * the FACTS a reader can find, never about markup or spacing — the adapters
 * are supposed to look different.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildViewHtml } from '../src/lib/viewFilter'
import { buildViewText } from '../src/lib/viewText'
import { buildPdfDocDefinition } from '../src/lib/pdfExporter'
import { exportDocx } from '../src/lib/exporter'
import { unzipSync, strFromU8 } from 'fflate'
import {
  emptyStore, makeResume, makeProject, makeView, makeCertification, makeEducation,
} from './fixtures'
import type { ResumeStore, ResumeView } from '../src/types'

// ─── The document under test ────────────────────────────────────────────────

/** A CV whose items fill every optional group the three sections declare. */
function populatedStore(): ResumeStore {
  const s = emptyStore()
  s.resume = makeResume({ full_name: 'Test Person' })
  s.projects = [makeProject({
    id: 'p1',
    customer: { en: 'Acme' },
    description: { en: 'Payments platform' },
    long_description: { en: '<p>Rebuilt the settlement engine.</p>' },
    highlights: [{ en: 'Cut settlement time by 40%' }],
    team_size: 5,
    percent_allocated: 80,
    external_url: 'https://case.example/acme',
    location_country_code: 'NO',
    skills: [{ id: 'ps1', skill_id: 'k1', name: { en: 'Kotlin' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
  })]
  s.educations = [makeEducation({
    id: 'e1', school: { en: 'NTNU' }, degree: { en: 'MSc' }, grade: 'A', exchange: true,
  })]
  s.certifications = [makeCertification({
    id: 'c1', name: { en: 'AWS SA' }, organiser: { en: 'Amazon' },
    issued: { year: 2024, month: 1 }, expires: { year: 2027, month: 1 },
    credential_url: 'https://verify.example/abc',
  })]
  return s
}

const SECTION_KEYS = ['projects', 'educations', 'certifications'] as const

/** Every group each of those sections declares, so nothing is left off. */
const ALL_GROUPS: Record<string, string[]> = {
  projects: ['lead', 'metrics', 'highlights', 'links', 'location'],
  educations: ['grade', 'exchange'],
  certifications: ['expiry', 'links'],
}

function viewWith(groups: boolean): ResumeView {
  return makeView({
    sections: SECTION_KEYS.map((key, i) => ({
      key, detail: 'full' as const, sort_order: i,
      style: groups ? { extras: ALL_GROUPS[key] } : {},
    })),
  }) as ResumeView
}

// ─── Reading each adapter back as plain findable text ───────────────────────

/** Collect every `text` string in a pdfmake content tree. */
function pdfText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') { if (node) out.push(node); return out }
  if (Array.isArray(node)) { for (const n of node) pdfText(n, out); return out }
  if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>
    for (const v of Object.values(rec)) pdfText(v, out)
  }
  return out
}

let lastBlob: Blob | null = null

/** The DOCX document part, with the XML tags stripped back to readable text. */
async function docxText(store: ResumeStore, view: ResumeView): Promise<string> {
  lastBlob = null
  await exportDocx(store, view, 'en')
  const buf = new Uint8Array(await lastBlob!.arrayBuffer())
  const xml = strFromU8(unzipSync(buf)['word/document.xml'])
  // Runs are split across elements, so drop the tags and keep the text.
  return xml.replace(/<[^>]+>/g, '')
}

async function renderAll(store: ResumeStore, view: ResumeView): Promise<Record<string, string>> {
  const dd = await buildPdfDocDefinition(store, view, 'en')
  return {
    'HTML preview': buildViewHtml(store, view, 'en'),
    'ATS text': buildViewText(store, view, 'en', 'text'),
    'Markdown': buildViewText(store, view, 'en', 'markdown'),
    PDF: pdfText(dd.content).join('\n'),
    DOCX: await docxText(store, view),
  }
}

/**
 * Facts that must reach EVERY adapter once their groups are on. Each is a
 * substring a reader would look for, not a rendering.
 */
const OPTIONAL_FACTS: Array<[string, string]> = [
  ['project team size', 'Team of 5'],
  ['project allocation', '80% allocation'],
  ['project highlight', 'Cut settlement time by 40%'],
  ['project case-study link', 'https://case.example/acme'],
  ['project country', 'Norway'],
  ['project lead-in', 'Payments platform'],
  ['education grade', 'Grade: A'],
  ['education exchange', 'Study abroad'],
  ['certification expiry', '2027'],
  ['certification credential link', 'https://verify.example/abc'],
]

/** Facts that are core content and must appear whatever the view enables. */
const CORE_FACTS: Array<[string, string]> = [
  ['project customer', 'Acme'],
  ['project description', 'Rebuilt the settlement engine.'],
  ['project skill', 'Kotlin'],
  ['school', 'NTNU'],
  ['certification name', 'AWS SA'],
]

describe('export parity — every adapter states the same facts', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // exportDocx triggers a download; capture the blob instead of writing one.
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob) => { lastBlob = b; return 'blob:x' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it('labels the skill list in every adapter that writes tags as text', async () => {
    // The HTML preview is the deliberate exception: it draws tags as CHIPS, so
    // the label would be noise. Everywhere else a bare comma list of words with
    // no label is exactly the defect this suite was built around.
    const out = await renderAll(populatedStore(), viewWith(false))
    for (const adapter of ['ATS text', 'Markdown', 'PDF', 'DOCX']) {
      expect(out[adapter], `${adapter} lost the skills label`).toContain('Skills:')
    }
    expect(out['HTML preview']).toContain('ve-tag')
  })

  it('carries every core fact into all five outputs', async () => {
    const out = await renderAll(populatedStore(), viewWith(false))
    for (const [adapter, text] of Object.entries(out)) {
      for (const [label, fact] of CORE_FACTS) {
        expect(text, `${adapter} is missing the ${label}`).toContain(fact)
      }
    }
  })

  it('carries every optional fact into all five outputs once its group is on', async () => {
    // The regression this suite exists for: these used to reach the PDF and the
    // Word file while the preview and the ATS text dropped them silently.
    const out = await renderAll(populatedStore(), viewWith(true))
    for (const [adapter, text] of Object.entries(out)) {
      for (const [label, fact] of OPTIONAL_FACTS) {
        expect(text, `${adapter} is missing the ${label}`).toContain(fact)
      }
    }
  })

  it('withholds every optional fact from all five outputs by default', async () => {
    // Symmetry matters as much as presence: a group left off must be off
    // everywhere, or "default off" just moves the surprise to another button.
    const out = await renderAll(populatedStore(), viewWith(false))
    for (const [adapter, text] of Object.entries(out)) {
      for (const [label, fact] of OPTIONAL_FACTS) {
        // The lead-in is the one exception: with no group on it still stands in
        // for a missing long description, and this project HAS a long one.
        if (label === 'project lead-in') continue
        expect(text, `${adapter} leaked the ${label}`).not.toContain(fact)
      }
    }
  })
})
