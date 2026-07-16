/**
 * @vitest-environment jsdom
 *
 * The exporter relies on `Blob`, `URL.createObjectURL`, `document.createElement`,
 * and `URL.revokeObjectURL` to trigger a browser download. jsdom provides
 * everything except `URL.createObjectURL`, which we stub below.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { exportDocx } from '../src/lib/exporter'
import { buildViewSections } from '../src/lib/viewFilter'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeView,
  makeKQ, makeReference, makeResume, makeSpokenLanguage,
  makeKeyCompetency, makeRecommendation, makeSkill, makeSkillCategory,
} from './fixtures'
import { withHeaderDefaults, withFooterDefaults } from '../src/lib/viewHeader'
import { DEFAULT_VIEW_STYLE } from '../src/lib/viewStyle'

// A real 1x1 PNG (valid bytes so the exporter's image parser embeds it).
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='

// ─── Capture the blob the exporter wants to download ────────────────────────
let lastBlob: Blob | null = null

beforeEach(() => {
  lastBlob = null
  // jsdom doesn't implement these — stub them so we can inspect the blob.
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: (b: Blob) => { lastBlob = b; return 'blob:fake' },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: () => {} })
  // The anchor's .click() must be a no-op (jsdom's default tries to navigate).
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

// ─── Helpers ────────────────────────────────────────────────────────────────

/** A real .docx is a zip — its first bytes are the local file header PK\x03\x04. */
async function isZip(blob: Blob): Promise<boolean> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

/** Search the binary docx for a substring (XML payload is uncompressed enough for tiny tests). */
async function blobContains(blob: Blob, needle: string): Promise<boolean> {
  // Use JSZip-free check: scan raw bytes for the UTF-8 sequence.
  // Word stores body text in word/document.xml; even though the archive entries
  // are deflated, short user strings often survive in stored mode or in the
  // central directory's filename list. To avoid flakiness we just verify
  // the file *is* a zip and inspect the size / count of expected entries.
  const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()))
  return text.includes(needle)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('exportDocx()', () => {
  it('produces a valid zipped .docx blob from an empty store', async () => {
    const store = emptyStore()
    const view  = makeView({ sections: buildViewSections() })
    await exportDocx(store, view, 'en')

    expect(lastBlob).not.toBeNull()
    expect(lastBlob!.size).toBeGreaterThan(0)
    expect(await isZip(lastBlob!)).toBe(true)
  })

  it('includes the standard Word OOXML parts (word/document.xml etc.)', async () => {
    const store = emptyStore()
    const view  = makeView({ sections: buildViewSections() })
    await exportDocx(store, view, 'en')

    // Central directory carries filenames in plaintext — easy to grep for.
    expect(await blobContains(lastBlob!, 'word/document.xml')).toBe(true)
    expect(await blobContains(lastBlob!, '[Content_Types].xml')).toBe(true)
  })

  it('exports a valid docx with item bullets enabled (smoke)', async () => {
    // The glyph/indent detail is pinned in the HTML + text tests; here we only
    // guard that the DOCX adapter's bullet path builds a real document rather
    // than throwing (the payload is deflated, so byte-grepping the glyph is
    // unreliable).
    const store = emptyStore()
    store.projects.push(makeProject({ customer: { en: 'Acme' }, long_description: { en: '<p>Work</p>' } }))
    const view = makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 }],
      style: { ...DEFAULT_VIEW_STYLE, item_bullets: true, bullet_style: 'square' },
    })
    await exportDocx(store, view, 'en')
    expect(await isZip(lastBlob!)).toBe(true)
    expect(lastBlob!.size).toBeGreaterThan(0)
  })

  it('produces a larger document when there is more content', async () => {
    const small = emptyStore()
    const big   = emptyStore()
    big.projects.push(makeProject({ customer: { en: 'BigCustomer' } }))
    big.projects.push(makeProject({ customer: { en: 'AnotherOne' } }))
    big.work_experiences.push(makeWork())
    big.educations.push(makeEducation())
    big.key_qualifications.push(makeKQ())

    const view = makeView({ sections: buildViewSections() })
    await exportDocx(small, view, 'en')
    const smallSize = lastBlob!.size

    await exportDocx(big, view, 'en')
    const bigSize = lastBlob!.size

    expect(bigSize).toBeGreaterThan(smallSize)
  })

  it('honours view.excluded_item_ids by skipping those items', async () => {
    const storeA = emptyStore()
    storeA.projects.push(makeProject({ id: 'p1', customer: { en: 'KeepMe' } }))
    storeA.projects.push(makeProject({ id: 'p2', customer: { en: 'DropMe' } }))

    const storeB = emptyStore()
    storeB.projects.push(makeProject({ id: 'p1', customer: { en: 'KeepMe' } }))

    const viewAll = makeView({ sections: buildViewSections() })
    const viewExcluding = makeView({
      sections: buildViewSections(),
      excluded_item_ids: ['p2'],
    })

    await exportDocx(storeA, viewExcluding, 'en')
    const excludedSize = lastBlob!.size

    await exportDocx(storeB, viewAll, 'en')
    const onlyOneSize = lastBlob!.size

    // Excluding p2 from storeA should produce essentially the same as storeB.
    // Allow a few bytes of difference for ordering/whitespace.
    expect(Math.abs(excludedSize - onlyOneSize)).toBeLessThan(200)
  })

  it('does not include references where include_in_exports is false', async () => {
    const storeWithPublic = emptyStore()
    storeWithPublic.references.push(makeReference({
      name: 'PublicRef', include_in_exports: true,
    }))

    const storeWithPrivate = emptyStore()
    storeWithPrivate.references.push(makeReference({
      name: 'PrivateRef', include_in_exports: false,
    }))

    const view = makeView({ sections: buildViewSections() })
    await exportDocx(storeWithPublic, view, 'en')
    const sizePublic = lastBlob!.size

    await exportDocx(storeWithPrivate, view, 'en')
    const sizePrivate = lastBlob!.size

    // Private reference should be filtered out → smaller output.
    expect(sizePrivate).toBeLessThan(sizePublic)
  })

  it('triggers a download by creating an anchor with the resume_view filename', async () => {
    const createElementSpy = vi.spyOn(document, 'createElement')
    const store = emptyStore()
    if (store.resume) store.resume.full_name = 'Ada Lovelace'
    const view = makeView({ name: 'Board CV', sections: buildViewSections() })
    await exportDocx(store, view, 'en')

    // Find the anchor that the exporter created
    const anchors = createElementSpy.mock.results
      .map((r) => r.value as HTMLElement)
      .filter((el) => el.tagName === 'A') as HTMLAnchorElement[]
    expect(anchors.length).toBeGreaterThan(0)
    const dl = anchors[anchors.length - 1].download
    expect(dl).toBe('Ada_Lovelace_Board_CV.docx')
  })

  it('still works when view.sections is empty (defaults to all enabled)', async () => {
    const store = emptyStore()
    store.projects.push(makeProject())
    const view = makeView({ sections: [] })
    await exportDocx(store, view, 'en')
    expect(await isZip(lastBlob!)).toBe(true)
  })

  it('renders the view introduction when set', async () => {
    const store = emptyStore()
    const withIntro = makeView({
      sections: buildViewSections(),
      introduction: { en: 'My custom intro paragraph' },
    })
    const withoutIntro = makeView({
      sections: buildViewSections(),
      introduction: {},
    })
    await exportDocx(store, withoutIntro, 'en')
    const baseline = lastBlob!.size
    await exportDocx(store, withIntro, 'en')
    expect(lastBlob!.size).toBeGreaterThan(baseline)
  })

  // ─── Detail levels ────────────────────────────────────────────────────────

  it('summary detail produces a smaller doc than full detail for the same content', async () => {
    const store = emptyStore()
    // Several projects with long descriptions — should compress to one line each.
    for (let i = 0; i < 5; i++) {
      store.projects.push(makeProject({
        customer: { en: `Customer ${i}` },
        long_description: { en: 'A long descriptive paragraph that summary mode is meant to skip entirely. '.repeat(8) },
      }))
    }
    const sectionsFull = buildViewSections()
    const sectionsSummary = sectionsFull.map((s) =>
      s.key === 'projects' ? { ...s, detail: 'summary' as const } : s
    )
    await exportDocx(store, makeView({ sections: sectionsFull }), 'en')
    const fullSize = lastBlob!.size
    await exportDocx(store, makeView({ sections: sectionsSummary }), 'en')
    const summarySize = lastBlob!.size
    expect(summarySize).toBeLessThan(fullSize)
  })

  it('off detail produces a smaller doc than full when the section has content', async () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ employer: { en: 'BigCo' }, long_description: { en: 'lots of detail here repeated ' .repeat(20) } }))
    const sectionsFull = buildViewSections()
    const sectionsOff = sectionsFull.map((s) =>
      s.key === 'work_experiences' ? { ...s, detail: 'off' as const } : s
    )
    await exportDocx(store, makeView({ sections: sectionsFull }), 'en')
    const fullSize = lastBlob!.size
    await exportDocx(store, makeView({ sections: sectionsOff }), 'en')
    const offSize = lastBlob!.size
    expect(offSize).toBeLessThan(fullSize)
  })

  // ─── Styling ──────────────────────────────────────────────────────────────

  it('changes output when view.style.body_size changes', async () => {
    const store = emptyStore()
    store.projects.push(makeProject({ long_description: { en: 'Some text content here.' } }))
    const small = makeView({
      sections: buildViewSections(),
      style: {
        density: 'normal', body_size: 'small', heading_font: 'condensed',
        accent_color: '#002E6E', page_margin: 'normal', tag_style: 'chips',
      },
    })
    const large = makeView({
      sections: buildViewSections(),
      style: {
        density: 'normal', body_size: 'large', heading_font: 'condensed',
        accent_color: '#002E6E', page_margin: 'normal', tag_style: 'chips',
      },
    })
    await exportDocx(store, small, 'en')
    const smallBytes = new Uint8Array(await lastBlob!.arrayBuffer())
    await exportDocx(store, large, 'en')
    const largeBytes = new Uint8Array(await lastBlob!.arrayBuffer())
    // Different font sizes serialise to different XML payloads. The byte
    // lengths can coincide (18 vs 24 half-points are both two digits), so
    // compare content rather than length.
    const identical =
      smallBytes.length === largeBytes.length &&
      smallBytes.every((b, i) => b === largeBytes[i])
    expect(identical).toBe(false)
  })

  // ─── Header images + footer ────────────────────────────────────────────────

  describe('header images & footer', () => {
    it('produces a valid zip with a photo (left), logo, and footer', async () => {
      const store = emptyStore()
      store.resume = makeResume({
        profile_photo: PNG_1x1,
        company_logo: PNG_1x1,
        company_name: 'Cartavio AS',
        phone: '+47 913 04 810',
      })
      store.spoken_languages = [makeSpokenLanguage({ name: { en: 'English' }, level: { en: 'Native' } })]
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ photo_placement: 'left', logo_placement: 'center' }),
        footer: withFooterDefaults({ separator: 'line', copyright: 'company', note: { en: 'Confidential' } }),
      })
      await exportDocx(store, view, 'en')
      expect(lastBlob).not.toBeNull()
      expect(await isZip(lastBlob!)).toBe(true)
      // The docx media folder appears when an image is embedded.
      expect(await blobContains(lastBlob!, 'word/media/')).toBe(true)
    })

    it('does not embed media when no images are configured', async () => {
      const store = emptyStore()
      store.resume = makeResume({ profile_photo: PNG_1x1 })
      const view = makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ photo_placement: 'none', logo_placement: 'none' }),
      })
      await exportDocx(store, view, 'en')
      expect(await blobContains(lastBlob!, 'word/media/')).toBe(false)
    })

    it('embeds media for every photo placement without throwing', async () => {
      for (const placement of ['left', 'right', 'above', 'below'] as const) {
        const store = emptyStore()
        store.resume = makeResume({ profile_photo: PNG_1x1 })
        const view = makeView({
          sections: buildViewSections(),
          header: withHeaderDefaults({ photo_placement: placement }),
        })
        await exportDocx(store, view, 'en')
        expect(await isZip(lastBlob!)).toBe(true)
        expect(await blobContains(lastBlob!, 'word/media/')).toBe(true)
      }
    })
  })
})

  // ─── Follow-up sections (key competencies, recommendations, promoted) ───────

  describe('new sections & promoted projects', () => {
    it('exports key competencies and recommendations without throwing', async () => {
      const store = emptyStore()
      store.key_competencies.push(makeKeyCompetency({ title: { en: 'Architecture' }, description: { en: 'Designs systems' } }))
      store.recommendations.push(makeRecommendation({ recommender_name: 'Jane Boss', text: { en: 'Great work' } }))
      await exportDocx(store, makeView({ sections: buildViewSections() }), 'en')
      expect(await isZip(lastBlob!)).toBe(true)
    })

    it('renders a Promoted Projects section from starred projects when enabled', async () => {
      const baseStore = emptyStore()
      baseStore.projects.push(makeProject({ id: 'p1', customer: { en: 'StarCorp' }, starred: true }))

      // Default view: promoted_projects off.
      await exportDocx(baseStore, makeView({ sections: buildViewSections() }), 'en')
      const offSize = lastBlob!.size

      // Enable promoted_projects → an extra section heading + item is emitted.
      const sections = buildViewSections().map((s) =>
        s.key === 'promoted_projects' ? { ...s, detail: 'full' as const } : s
      )
      await exportDocx(baseStore, makeView({ sections }), 'en')
      expect(await isZip(lastBlob!)).toBe(true)
      expect(lastBlob!.size).toBeGreaterThan(offSize)
    })

    it('renders the Skills Showcase (technology_categories) from highlighted, categorized skills', async () => {
      const emptyOfShowcase = emptyStore()
      await exportDocx(emptyOfShowcase, makeView({ sections: buildViewSections() }), 'en')
      const baseSize = lastBlob!.size

      const store = emptyStore()
      store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
      store.skills.push(makeSkill({ name: { en: 'TypeScript' }, category_id: 'cat1', is_highlighted: true }))
      await exportDocx(store, makeView({ sections: buildViewSections() }), 'en')
      expect(await isZip(lastBlob!)).toBe(true)
      expect(lastBlob!.size).toBeGreaterThan(baseSize)
    })
  })
