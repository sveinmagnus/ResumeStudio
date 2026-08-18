/**
 * @vitest-environment jsdom
 *
 * WHOLE-DOCUMENT visual parity: every view style control must reach every
 * target that can express it.
 *
 * `exportParity.test.ts` pins the FACTS — that each adapter states the same
 * things. This suite pins the other half: that each adapter LOOKS the way the
 * view asked. They are different failures. A view can carry every fact into
 * the PDF and still ignore the divider style, the chips, the column alignment
 * and the slot order the consultant picked while watching the preview.
 *
 * That is what was happening. Seven controls in the view editor moved the
 * preview and nothing else:
 *
 *   - Skill tags (Chips / Inline list)
 *   - Item dividers (eight choices)
 *   - Summary layout (six slot orders)
 *   - Full-item layout (four)
 *   - Summaries (free-flowing / aligned columns)
 *   - Section icons
 *   - and Word alone ignored density's line height
 *
 * A control that changes the preview and not the export is worse than one that
 * does nothing: the preview is what the consultant checks before sending the
 * file, so it certifies a layout the recipient never sees.
 *
 * The assertion below is deliberately blunt — flip the control, and the output
 * must DIFFER. It cannot check that a Word dashed border looks like a CSS
 * dashed border; the formats differ and that is fine. It checks that the
 * control is connected, which is the failure that actually happened. Where the
 * shape of the change is cheap to state, a second assertion names it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildViewHtml } from '../src/lib/viewFilter'
import { buildViewText } from '../src/lib/viewText'
import { buildPdfDocDefinition } from '../src/lib/pdfExporter'
import { exportDocx } from '../src/lib/exporter'
import { unzipSync, strFromU8 } from 'fflate'
import { emptyStore, makeResume, makeProject, makeView, makeEducation } from './fixtures'
import { DEFAULT_VIEW_STYLE } from '../src/lib/viewStyle'
import type { ResumeStore, ResumeView, ViewStyle } from '../src/types'

// ─── The document under test ────────────────────────────────────────────────

/**
 * Two items in a full section and two in a summary section — the minimum that
 * makes a BETWEEN-items divider and a column grid observable at all.
 */
function populatedStore(): ResumeStore {
  const s = emptyStore()
  s.resume = makeResume({ full_name: 'Test Person' })
  s.projects = [
    makeProject({
      id: 'p1', customer: { en: 'Acme' }, description: { en: 'Payments' },
      long_description: { en: '<p>Body one.</p>' },
      skills: [{
        id: 'ps1', skill_id: 'k1', name: { en: 'Kotlin' },
        duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
      }],
    }),
    makeProject({
      id: 'p2', customer: { en: 'Beta' }, description: { en: 'Ledger' },
      long_description: { en: '<p>Body two.</p>' },
    }),
  ]
  s.educations = [
    makeEducation({ id: 'e1', school: { en: 'NTNU' }, degree: { en: 'MSc' } }),
    makeEducation({ id: 'e2', school: { en: 'UiO' }, degree: { en: 'BSc' } }),
  ]
  return s
}

function viewWith(style: Partial<ViewStyle>): ResumeView {
  return makeView({
    style: { ...DEFAULT_VIEW_STYLE, ...style },
    sections: [
      { key: 'projects', detail: 'full', sort_order: 0, style: {} },
      { key: 'educations', detail: 'summary', sort_order: 1, style: {} },
    ],
  }) as ResumeView
}

// ─── Reading each adapter back as one comparable string ─────────────────────

let lastBlob: Blob | null = null

/** One part of the DOCX package, tags and all — this suite is about markup. */
async function docxPart(s: ResumeStore, v: ResumeView, part = 'document'): Promise<string> {
  lastBlob = null
  await exportDocx(s, v, 'en')
  const buf = new Uint8Array(await lastBlob!.arrayBuffer())
  return strFromU8(unzipSync(buf)[`word/${part}.xml`])
}

const docxXml = (s: ResumeStore, v: ResumeView): Promise<string> => docxPart(s, v)

/**
 * pdfmake table layouts are FUNCTIONS, so `JSON.stringify` drops them and a
 * dashed rule serialises identically to a solid one. Call each with the
 * arguments pdfmake would, and fold the answers into the string.
 */
function fnFingerprint(fn: (...a: unknown[]) => unknown): string {
  const node = { table: { body: [[{}], [{}], [{}]] } }
  return [0, 1, 2, 3].map((i) => {
    try { return JSON.stringify(fn(i, node)) } catch { return 'err' }
  }).join('|')
}

async function renderAll(s: ResumeStore, v: ResumeView): Promise<Record<string, string>> {
  const dd = await buildPdfDocDefinition(s, v, 'en')
  return {
    'HTML preview': buildViewHtml(s, v, 'en'),
    'ATS text': buildViewText(s, v, 'en', 'text'),
    PDF: JSON.stringify(dd, (_k, val) => (typeof val === 'function' ? fnFingerprint(val) : val)),
    DOCX: await docxXml(s, v),
  }
}

/** The paged targets — everything that draws rather than lists. */
const PAGED = ['HTML preview', 'PDF', 'DOCX'] as const
/** Plus the linear one, for controls that change what is SAID, not just drawn. */
const ALL = [...PAGED, 'ATS text'] as const

describe('export visual parity — every style control reaches every target', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // exportDocx triggers a download; capture the blob instead of writing one.
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob) => { lastBlob = b; return 'blob:x' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  /**
   * Flip one control and report which targets' output moved. Tests assert the
   * EXACT set, so an over-reaction (a purely visual choice leaking into the ATS
   * text) fails as loudly as a missing one.
   */
  const moved = async (a: Partial<ViewStyle>, b: Partial<ViewStyle>): Promise<string[]> => {
    const store = populatedStore()
    const before = await renderAll(store, viewWith(a))
    const after = await renderAll(store, viewWith(b))
    return ALL.filter((t) => before[t] !== after[t])
  }

  // ── The seven that were preview-only ────────────────────────────────────────

  it('draws skill tags as chips or as an inline list in every paged target', async () => {
    expect(await moved({ tag_style: 'chips' }, { tag_style: 'inline' })).toEqual([...PAGED])
  })

  it('draws the chosen divider rule in every paged target', async () => {
    expect(await moved(
      { item_divider: true, divider_style: 'line' },
      { item_divider: true, divider_style: 'dashed' },
    )).toEqual([...PAGED])
  })

  it('drops the divider everywhere when the view turns it off', async () => {
    expect(await moved(
      { item_divider: true, divider_style: 'line' }, { item_divider: false },
    )).toEqual([...PAGED])
  })

  it('orders the summary slots the same way in every target', async () => {
    // Order is a fact about how the CV READS, so the ATS text follows it too.
    expect(await moved(
      { summary_layout: 'title-org-date' }, { summary_layout: 'date-org-title' },
    )).toEqual([...ALL])
  })

  it('applies the full-item layout in every target', async () => {
    expect(await moved(
      { date_position: 'title-org-date' }, { date_position: 'lead-date-org' },
    )).toEqual([...ALL])
  })

  it('lays summaries out in aligned columns in every paged target', async () => {
    expect(await moved({ tabulate: false }, { tabulate: true })).toEqual([...PAGED])
  })

  it('draws the section icon in every paged target', async () => {
    expect(await moved({ section_icons: false }, { section_icons: true })).toEqual([...PAGED])
  })

  it('carries density into Word as line spacing, not only as gaps', async () => {
    // Word took the item gaps but never the line height, so `spacious` and
    // `compact` sat far closer together there than in the preview or the PDF.
    const store = populatedStore()
    const line = async (density: ViewStyle['density']): Promise<number> => {
      // It rides the document's DEFAULT paragraph style, not each paragraph.
      const m = /<w:spacing[^>]*w:line="(\d+)"[^>]*w:lineRule="auto"/
        .exec(await docxPart(store, viewWith({ density }), 'styles'))
      return m ? Number(m[1]) : 0
    }
    expect(await line('compact')).toBeLessThan(await line('normal'))
    expect(await line('normal')).toBeLessThan(await line('spacious'))
  })

  // ── The ones that already worked, kept so they cannot regress ─────────────

  it('applies the purely visual controls to every paged target and no other', async () => {
    expect(await moved({ density: 'normal' }, { density: 'spacious' })).toEqual([...PAGED])
    expect(await moved({ accent_color: '#002E6E' }, { accent_color: '#AA1122' })).toEqual([...PAGED])
    expect(await moved({}, { heading_color: '#118844' })).toEqual([...PAGED])
    expect(await moved({ page_margin: 'normal' }, { page_margin: 'generous' })).toEqual([...PAGED])
    expect(await moved({ body_size: 'normal' }, { body_size: 'large' })).toEqual([...PAGED])
  })

  it('draws item bullets in every target, the ATS text included', async () => {
    expect(await moved(
      { item_bullets: false }, { item_bullets: true, bullet_style: 'arrow' },
    )).toEqual([...ALL])
  })
})
