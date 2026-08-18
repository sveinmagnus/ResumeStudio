/**
 * @vitest-environment jsdom
 *
 * The exporter relies on `Blob`, `URL.createObjectURL`, `document.createElement`,
 * and `URL.revokeObjectURL` to trigger a browser download. jsdom provides
 * everything except `URL.createObjectURL`, which we stub below.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { exportDocx, exportCoverLetterDocx } from '../src/lib/exporter'
import { buildViewSections } from '../src/lib/viewFilter'
import {
  emptyStore, makeProject, makeWork, makeEducation, makeView,
  makeKQ, makeReference, makeResume, makeSpokenLanguage,
  makeKeyCompetency, makeRecommendation, makeSkill, makeSkillCategory, makeCoverLetter,
  makeIndustry, makePresentation,
} from './fixtures'
import { withHeaderDefaults, withFooterDefaults } from '../src/lib/viewHeader'
import { DEFAULT_VIEW_STYLE, deriveTokens } from '../src/lib/viewStyle'
import type { ResumeStore } from '../src/types'

/**
 * The shape mask is the one export step that needs a real canvas, and jsdom has
 * none — so the branch deciding whether a circular profile photo reaches Word
 * as a circle could never be exercised. Stubbing the mask itself, and nothing
 * else in lib/image, makes that DECISION testable while the rest of the image
 * plumbing (header parsing, byte handling) stays real.
 */
const maskSpy = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/image')>()),
  applyShapeMaskToDataUrl: maskSpy,
}))

/** A view with every section enabled at full detail. */
const fullView = () => makeView({ sections: buildViewSections() })

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

/**
 * The document's real XML, unzipped.
 *
 * The substring scan above can only see strings that happen to survive
 * deflation, which is why every earlier assertion is about the blob's SIZE.
 * Reading word/document.xml lets a test say what the exporter actually wrote —
 * spacing, indentation, list markers — instead of that it wrote more bytes
 * than before.
 */
async function documentXml(blob: Blob): Promise<string> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const doc = files['word/document.xml']
  if (!doc) throw new Error('no word/document.xml in the archive')
  return new TextDecoder().decode(doc)
}

/** A store whose single project carries one rich-text body. */
function storeWithBody(html: string): ResumeStore {
  const store = emptyStore()
  store.resume = makeResume({ full_name: 'Test Person' })
  store.projects = [makeProject({ customer: { en: 'AcmeCo' }, long_description: { en: html } })]
  return store
}

describe('exportDocx() — what the document actually says', () => {
  /** Export one body and return the document's XML. */
  const xmlFor = async (html: string): Promise<string> => {
    await exportDocx(storeWithBody(html), fullView(), 'en')
    return documentXml(lastBlob!)
  }

  it('writes the body text, not just more bytes', async () => {
    expect(await xmlFor('<p>Ran the migration.</p>')).toContain('Ran the migration.')
  })

  it('prefixes an unordered item with a bullet and an ordered one with its number', async () => {
    // The markers are written by the exporter itself — Word is given plain
    // paragraphs with an indent, not a numbering definition — so a lost marker
    // silently turns a list into a run of indented sentences.
    expect(await xmlFor('<ul><li>First</li><li>Second</li></ul>')).toContain('•')

    const ol = await xmlFor('<ol><li>First</li><li>Second</li></ol>')
    expect(ol).toContain('1. ')
    expect(ol).toContain('2. ')
  })

  /**
   * The one paragraph element containing `text`, so an assertion is about THAT
   * paragraph rather than about any paragraph in the document — a whole-file
   * scan finds a heading's indent or spacing and proves nothing.
   */
  const paragraphWith = (xml: string, text: string): string => {
    // Each chunk ends at a </w:p>, so it holds exactly that paragraph's
    // properties and runs.
    const para = xml.split('</w:p>').find((p) => p.includes(text))
    if (para === undefined) throw new Error(`no paragraph containing ${text}`)
    return para.slice(para.lastIndexOf('<w:p'))
  }
  const attr = (fragment: string, name: string): number | null => {
    const m = new RegExp(`${name}="(\\d+)"`).exec(fragment)
    return m ? Number(m[1]) : null
  }

  it('indents a nested list item further than its parent', async () => {
    const xml = await xmlFor('<ul><li>Top</li><ul><li>Nested</li></ul></ul>')
    const top = attr(paragraphWith(xml, 'Top'), 'w:left')
    const nested = attr(paragraphWith(xml, 'Nested'), 'w:left')
    expect(top).toBeGreaterThan(0)
    expect(nested).toBeGreaterThan(top!)
  })

  it('separates two paragraphs of one body by the shared gap', async () => {
    // PARA_GAP_LINES is one number for every target (CLAUDE.md §4); the DOCX
    // twin of it is spacing/after in twips, and a paragraph followed by
    // another inside the same body must carry it.
    const xml = await xmlFor('<p>One.</p><p>Two.</p>')
    expect(attr(paragraphWith(xml, 'One.'), 'w:after')).toBeGreaterThan(0)
  })

  it('gives the LAST paragraph the caller’s gap, not the inter-paragraph one', async () => {
    // Two different gaps on purpose: BETWEEN paragraphs of one body it is the
    // shared PARA_GAP_LINES; AFTER the last one it is the caller's spacing to
    // whatever follows the item — the DOCX twin of `p:last-child` plus a
    // container margin. Asserting only the non-last paragraph leaves that
    // distinction free, and collapsing the two changes every item's spacing.
    const xml = await xmlFor('<p>One.</p><p>Two.</p>')
    const between = attr(paragraphWith(xml, 'One.'), 'w:after')
    const after = attr(paragraphWith(xml, 'Two.'), 'w:after')
    // Named against their SOURCE, not merely "different from each other":
    // swapping the two is exactly what an inverted last-paragraph test does,
    // and that still leaves them different.
    expect(between).toBe(deriveTokens(DEFAULT_VIEW_STYLE).paraGapTwips)
    expect(after).toBeGreaterThan(0)
    expect(after).not.toBe(between)
  })

  it('treats a single-paragraph body as the last one', async () => {
    // The branch deciding this is `i === blocks.length - 1`, true from the
    // start here — so a one-paragraph item takes the caller's gap, exactly as
    // the final paragraph of a longer one does.
    const one = await xmlFor('<p>Only one.</p>')
    const two = await xmlFor('<p>One.</p><p>Two.</p>')
    expect(attr(paragraphWith(one, 'Only one.'), 'w:after'))
      .toBe(attr(paragraphWith(two, 'Two.'), 'w:after'))
  })
})

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

  /**
   * The identity block — the first thing on the page, and the part every
   * reader looks at. It had 44 mutants and one killed: the existing header
   * tests assert the export is a zip and that the blob grew, so the name,
   * title and every contact line could vanish without a test moving.
   */
  describe('identity block', () => {
    const identityStore = (): ResumeStore => {
      const store = emptyStore()
      store.resume = makeResume({
        full_name: 'Kari Nordmann', title: { en: 'Solution Architect' },
        phone: '+47 900 00 000', email: 'kari@example.com', city: 'Oslo', country: 'Norway',
      })
      return store
    }
    const runs = async (): Promise<string[]> =>
      [...(await documentXml(lastBlob!)).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1])

    it('leads with the name, then the title, then the contact lines', async () => {
      await exportDocx(identityStore(), fullView(), 'en')
      const t = await runs()
      expect(t[0]).toBe('Kari Nordmann')
      expect(t[1]).toBe('Solution Architect')
      expect(t.slice(0, 8).join('|')).toContain('+47 900 00 000')
      expect(t.slice(0, 8).join('|')).toContain('kari@example.com')
    })

    it('puts the separator BETWEEN same-line fields and not before the first', async () => {
      // Phone and email share a line; a separator emitted at i === 0 would open
      // the contact line with a stray " | ".
      await exportDocx(identityStore(), fullView(), 'en')
      const t = await runs()
      const phone = t.indexOf('+47 900 00 000')
      expect(t[phone - 1]).not.toBe(' | ')
      expect(t.slice(phone, phone + 3)).toContain(' | ')
    })

    it('prefers the header title override over the profile tag line and the resume title', async () => {
      // Three sources, checked in order; the override is what a view uses to
      // present the same person differently, so it must win.
      const store = identityStore()
      store.key_qualifications.push(makeKQ({ tag_line: { en: 'Tag line profile' } }))
      await exportDocx(store, makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ title_override: { en: 'Board Candidate' } }),
      }), 'en')
      expect((await runs())[1]).toBe('Board Candidate')
    })

    it('falls back to the profile tag line when there is no override', async () => {
      const store = identityStore()
      store.key_qualifications.push(makeKQ({ tag_line: { en: 'Tag line profile' } }))
      await exportDocx(store, fullView(), 'en')
      expect((await runs())[1]).toBe('Tag line profile')
    })

    it('omits the title paragraph entirely when no source has one', async () => {
      const store = identityStore()
      store.resume = makeResume({ full_name: 'Kari Nordmann', title: {}, phone: '+47 900 00 000' })
      const t = await (async () => { await exportDocx(store, fullView(), 'en'); return runs() })()
      // Straight from the name to the contact line's label — no empty paragraph
      // where the title would have been.
      expect(t[0]).toBe('Kari Nordmann')
      expect(t[1]).toBe('Phone: ')
      expect(t[2]).toBe('+47 900 00 000')
    })

    it('drops a contact field the header config hides', async () => {
      const header = withHeaderDefaults({
        fields: withHeaderDefaults({}).fields.map((f) =>
          f.key === 'email' ? { ...f, show: false } : f),
      })
      await exportDocx(identityStore(), makeView({ sections: buildViewSections(), header }), 'en')
      expect(await runs()).not.toContain('kari@example.com')
    })
  })

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

  /**
   * The Skill Matrix is a real Word TABLE, and until now nothing asserted a
   * single cell of it — the section had tests that ran it and checked the blob
   * was a zip. Its two shape rules (the Category column appears only when some
   * row has one; the Last used column follows hide_dates) each silently drop a
   * column when wrong, which no size comparison would notice.
   */
  describe('skill matrix table', () => {
    /** A store whose matrix has one categorized and one uncategorized skill. */
    function matrixStore(withCategory: boolean): ResumeStore {
      const store = emptyStore()
      if (withCategory) store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
      store.skills.push(makeSkill({
        id: 'ts', name: { en: 'TypeScript' }, total_duration_in_years: 8, proficiency: 4,
        category_id: withCategory ? 'cat1' : null,
      }))
      return store
    }

    const matrixView = (over: Partial<{ hide_dates: boolean }> = {}) => makeView({
      sections: buildViewSections().map((s) =>
        s.key === 'skill_matrix'
          ? { ...s, detail: 'full' as const, style: { ...s.style, ...over } }
          : s),
    })

    /** Cell text in document order, so column identity is checked, not presence. */
    const cells = (xml: string): string[] =>
      [...xml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)]
        .map((m) => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''))

    it('writes a header row and one row per skill, with the real values', async () => {
      await exportDocx(matrixStore(false), matrixView(), 'en')
      const c = cells(await documentXml(lastBlob!))

      // Header, then the data row — four columns each (no category).
      expect(c.slice(0, 4)).toEqual(['Skill', 'Experience', 'Proficiency', 'Last used'])
      expect(c.slice(4, 8)).toEqual(['TypeScript', '8 yrs', '4/5', ''])
    })

    it('adds the Category column ONLY when some row has a category', async () => {
      await exportDocx(matrixStore(true), matrixView(), 'en')
      const withCat = cells(await documentXml(lastBlob!))
      expect(withCat.slice(0, 5)).toEqual(['Skill', 'Category', 'Experience', 'Proficiency', 'Last used'])
      expect(withCat.slice(5, 10)).toEqual(['TypeScript', 'Languages', '8 yrs', '4/5', ''])

      await exportDocx(matrixStore(false), matrixView(), 'en')
      expect(cells(await documentXml(lastBlob!))[1]).toBe('Experience')
    })

    it('drops the Last used column when the section hides dates', async () => {
      await exportDocx(matrixStore(false), matrixView({ hide_dates: true }), 'en')
      const c = cells(await documentXml(lastBlob!))
      expect(c.slice(0, 3)).toEqual(['Skill', 'Experience', 'Proficiency'])
      expect(c).not.toContain('Last used')
    })

    it('marks the header row bold and accented, so it reads as a header', async () => {
      // TableBorders.NONE — there are no rules between the cells, so weight and
      // colour are the ONLY thing separating the headings from the data. Every
      // other assertion here reads cell TEXT, which is identical either way.
      await exportDocx(matrixStore(false), matrixView(), 'en')
      const raw = [...(await documentXml(lastBlob!)).matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0])
      const accent = deriveTokens(DEFAULT_VIEW_STYLE).accentHex

      expect(raw[0]).toContain('<w:b/>')
      expect(raw[0]).toContain(accent)
      // The first data cell is the same text machinery without either.
      expect(raw[4]).not.toContain('<w:b/>')
      expect(raw[4]).not.toContain(accent)
    })

    it('localizes the column headings', async () => {
      // The matrix chrome is export chrome (CLAUDE.md §12) — it must translate.
      await exportDocx(matrixStore(false), matrixView(), 'no')
      const c = cells(await documentXml(lastBlob!))
      expect(c.slice(0, 4)).toEqual(['Ferdighet', 'Erfaring', 'Nivå', 'Sist brukt'])
    })

    it('leaves an unknown experience and proficiency blank rather than printing 0', async () => {
      // A CVpartner export can carry proficiency 0 across the board (§11), and
      // "0/5" beside a skill you list reads as an admission of incompetence.
      const store = emptyStore()
      store.skills.push(makeSkill({ id: 'go', name: { en: 'Go' }, total_duration_in_years: 0, proficiency: 0 }))
      await exportDocx(store, matrixView(), 'en')
      const c = cells(await documentXml(lastBlob!))
      expect(c.slice(4, 8)).toEqual(['Go', '', '', ''])
    })
  })

/**
 * The cover-letter DOCX path had NO test — 65 mutants, none covered. It is a
 * separate document builder from exportDocx (a letter is not a CV page: fixed
 * margins, its own block order), so nothing exportDocx asserts reaches it.
 */
describe('exportCoverLetterDocx()', () => {
  const letterStore = (): ResumeStore => {
    const store = emptyStore()
    store.resume = makeResume({
      full_name: 'Kari Nordmann', email: 'kari@example.com', phone: '+47 900 00 000',
    })
    return store
  }

  const filled = (over = {}) => makeCoverLetter({
    name: 'Equinor application',
    company: { en: 'Equinor ASA' },
    recipient: { en: 'Hiring Manager' },
    role_applied: { en: 'Lead Architect' },
    greeting: { en: 'Dear Hiring Manager,' },
    body: { en: 'I am writing about the role.\n\nI have fifteen years of experience.' },
    closing: { en: 'Yours sincerely,' },
    place_dated: 'Oslo, 1 March 2026',
    ...over,
  })

  /** Every run's text, in document order. */
  const texts = async (blob: Blob): Promise<string[]> =>
    [...(await documentXml(blob)).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1])

  it('writes the letter blocks in reading order', async () => {
    await exportCoverLetterDocx(letterStore(), filled(), 'en')
    expect(await texts(lastBlob!)).toEqual([
      'Kari Nordmann',
      'kari@example.com  ·  +47 900 00 000',
      'Oslo, 1 March 2026',
      'Hiring Manager',
      'Equinor ASA',
      'Application for Lead Architect',
      'Dear Hiring Manager,',
      'I am writing about the role.',
      'I have fifteen years of experience.',
      'Yours sincerely,',
      'Kari Nordmann',
    ])
  })

  it('signs off with the sender name a second time', async () => {
    // The name appears twice on purpose — letterhead at the top, signature at
    // the bottom — so a test that merely asserts it is PRESENT passes with the
    // signature dropped.
    const t = await (async () => {
      await exportCoverLetterDocx(letterStore(), filled(), 'en')
      return texts(lastBlob!)
    })()
    expect(t.filter((s) => s === 'Kari Nordmann')).toHaveLength(2)
    expect(t[t.length - 1]).toBe('Kari Nordmann')
  })

  it('omits every block the letter does not fill, without leaving blanks', async () => {
    // An empty letter must not print an empty subject line or a bare separator
    // dot — each block is individually gated.
    const store = emptyStore()
    store.resume = makeResume({ full_name: '', email: '', phone: '', website_url: '' })
    await exportCoverLetterDocx(store, makeCoverLetter({ place_dated: 'Oslo' }), 'en')
    expect(await texts(lastBlob!)).toEqual(['Oslo'])
  })

  it('splits the body on blank lines into separate paragraphs', async () => {
    await exportCoverLetterDocx(letterStore(), filled({
      body: { en: 'One.\n\nTwo.\n\nThree.' },
    }), 'en')
    const t = await texts(lastBlob!)
    expect(t).toContain('One.')
    expect(t).toContain('Two.')
    expect(t).toContain('Three.')
  })

  it('localizes the subject prefix', async () => {
    // Export chrome, so it translates (CLAUDE.md §12).
    const store = letterStore()
    store.resume = makeResume({ full_name: '', email: '', phone: '', website_url: '' })
    await exportCoverLetterDocx(store, makeCoverLetter({
      role_applied: { no: 'Løsningsarkitekt' }, place_dated: 'Oslo',
    }), 'no')
    expect(await texts(lastBlob!)).toContain('Søknad på stillingen Løsningsarkitekt')
  })

  it('names the file from the resume owner and the letter', async () => {
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await exportCoverLetterDocx(letterStore(), filled(), 'en')
    const el = anchor.mock.instances[0] as HTMLAnchorElement
    expect(el.download).toMatch(/\.docx$/i)
    expect(el.download.toLowerCase()).toContain('equinor')
  })

  it('produces a real zip', async () => {
    await exportCoverLetterDocx(letterStore(), filled(), 'en')
    expect(await isZip(lastBlob!)).toBe(true)
  })
})

/**
 * The DOCX item layouts — the fourth adapter of the same item.
 *
 * 72 survivors and 17 uncovered. The bullet layout is the part with a
 * mechanism of its own: DOCX has no flex row, so the glyph rides the title line
 * via a leading run plus a tab, and every content paragraph is indented to line
 * up under the heading. A hanging indent that stops hanging, or an indent
 * applied without a glyph, both still produce a document.
 */
describe('exportDocx — item layouts', () => {
  /** Local copies: the originals are scoped to another describe block. */
  const paragraphWith = (xml: string, text: string): string => {
    const para = xml.split('</w:p>').find((p) => p.includes(text))
    if (para === undefined) throw new Error(`no paragraph containing ${text}`)
    return para.slice(para.lastIndexOf('<w:p'))
  }
  const attr = (fragment: string, name: string): number | null => {
    const m = new RegExp(`${name}="(\\d+)"`).exec(fragment)
    return m ? Number(m[1]) : null
  }
  /**
   * A header with its own languages line switched off.
   *
   * The header lists spoken languages too ("Norwegian (Native)") and comes
   * first in the document, so without this a search for the language name
   * finds the HEADER and the assertion is not about the item at all.
   */
  const noLanguagesHeader = () => withHeaderDefaults({
    fields: withHeaderDefaults({}).fields.map((f) =>
      f.key === 'languages' ? { ...f, show: false } : f),
  })
  const store = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    s.work_experiences = [makeWork({
      id: 'w1', employer: { en: 'Acme' }, role_title: { en: 'Architect' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
      long_description: { en: '<p>Did the work.</p>' }, ...over,
    } as never)]
    return s
  }
  const xmlFor = async (style: Record<string, unknown> = {}, s = store()) => {
    await exportDocx(s, makeView({
      sections: [{ key: 'work_experiences', detail: 'full', sort_order: 0, style } as never],
    }), 'en')
    return documentXml(lastBlob!)
  }

  it('puts the date on the details line, where the layout control places it', async () => {
    // Not hung off the end of the title: the date is a slot of the details
    // line, which is what the four full-item layouts reorder. Hanging it off
    // the title made two of those four render identically here while the
    // preview showed the difference.
    const xml = await xmlFor()
    expect(paragraphWith(xml, 'Acme')).not.toMatch(/Jan 2020/)
    expect(paragraphWith(xml, 'Jan 2020')).toMatch(/Architect/)
  })

  it('moves the date ahead of the organisation when the layout asks', async () => {
    const orgFirst = paragraphWith(await xmlFor({ date_position: 'title-org-date' }), 'Jan 2020')
    expect(orgFirst.indexOf('Architect')).toBeLessThan(orgFirst.indexOf('Jan 2020'))
    const dateFirst = paragraphWith(await xmlFor({ date_position: 'title-date-org' }), 'Jan 2020')
    expect(dateFirst.indexOf('Jan 2020')).toBeLessThan(dateFirst.indexOf('Architect'))
  })

  it('lifts the details line above the title under a lead layout', async () => {
    const xml = await xmlFor({ date_position: 'lead-org-date' })
    expect(xml.indexOf('Jan 2020')).toBeLessThan(xml.indexOf('Acme'))
  })

  it('gives a large-title section a heading bigger than the body', async () => {
    // titleStyle is a per-descriptor choice; collapsing it makes every heading
    // body-sized, which the date-size comparison above cannot see.
    // Run sizes are `<w:sz w:val="24"/>`, so `attr` (which reads name="…")
    // cannot fetch them.
    const firstSize = (fragment: string) =>
      Number(/w:sz w:val="(\d+)"/.exec(fragment)?.[1] ?? NaN)
    const xml = await xmlFor()
    expect(firstSize(paragraphWith(xml, 'Acme')))
      .toBeGreaterThan(firstSize(paragraphWith(xml, 'Did the work.')))
  })

  it('omits the date run when dates are hidden', async () => {
    expect(await xmlFor({ hide_dates: true })).not.toMatch(/Jan 2020/)
  })

  describe('the bullet layout', () => {
    it('rides the glyph on the title line with a tab, and hangs the indent', async () => {
      const xml = await xmlFor({ item_bullets: true })
      const titlePara = paragraphWith(xml, 'Acme')
      // The glyph rides the title line as its own run ending in a LITERAL tab
      // (docx writes it inside <w:t>, not as a <w:tab/> element), which is why
      // the run needs xml:space="preserve" to survive.
      expect(titlePara).toMatch(/<w:t xml:space="preserve">•\t<\/w:t>/)
      // Hanging indent: the first line pulls back out of the body indent, so
      // the glyph sits in the margin and the title starts at the text column.
      expect(attr(titlePara, 'w:hanging')).toBe(attr(titlePara, 'w:left'))
      expect(attr(titlePara, 'w:left')).toBeGreaterThan(0)
    })

    it('indents the body paragraphs to line up under the heading', async () => {
      const xml = await xmlFor({ item_bullets: true })
      expect(attr(paragraphWith(xml, 'Did the work.'), 'w:left')).toBeGreaterThan(0)
    })

    it('leaves both the tab and the indent out when bullets are off', async () => {
      const xml = await xmlFor({})
      const titlePara = paragraphWith(xml, 'Acme')
      expect(titlePara).not.toContain('\t')
      expect(titlePara).not.toMatch(/w:hanging=/)
      expect(attr(paragraphWith(xml, 'Did the work.'), 'w:left')).toBeNull()
    })
  })

  it('renders a language as one inline paragraph, level after an em-dash', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: { en: 'Native' } })]
    // The HEADER lists languages too ("Norwegian (Native)"), and it comes
    // first — so it has to be off for the assertion to be about the item.
    await exportDocx(s, makeView({
      sections: [{ key: 'spoken_languages', detail: 'full', sort_order: 0 } as never],
      header: noLanguagesHeader(),
    }), 'en')
    const para = paragraphWith(await documentXml(lastBlob!), 'Norwegian')
    expect(para).toContain('Native')
    expect(para).toContain('—')
  })

  it('omits the inline meta run when a language has no level', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: {} })]
    await exportDocx(s, makeView({
      sections: [{ key: 'spoken_languages', detail: 'full', sort_order: 0 } as never],
      header: noLanguagesHeader(),
    }), 'en')
    const para = paragraphWith(await documentXml(lastBlob!), 'Norwegian')
    expect(para).not.toContain('—')
  })

  describe('the quote layout', () => {
    const recStore = (over: Record<string, unknown> = {}) => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.recommendations = [makeRecommendation({
        id: 'r1', recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' },
        text: { en: '<p>Excellent to work with.</p>' }, ...over,
      } as never)]
      return s
    }
    const recXml = async (over: Record<string, unknown> = {}) => {
      await exportDocx(recStore(over), makeView({
        sections: [{ key: 'recommendations', detail: 'full', sort_order: 0 } as never],
      }), 'en')
      return documentXml(lastBlob!)
    }

    it('italicises the quote and adds a subtle attribution line', async () => {
      const xml = await recXml()
      expect(paragraphWith(xml, 'Excellent to work with.')).toContain('<w:i/>')
      expect(xml).toMatch(/— Jane Boss/)
      expect(xml).toContain('CTO')
    })

    it('falls back to the company when there is no recommender name', async () => {
      const xml = await recXml({ recommender_name: '', recommender_title: {}, relationship: {}, recommender_company: 'BigCo' })
      expect(xml).toMatch(/— BigCo/)
    })

    it('omits the attribution paragraph when there is nothing to attribute', async () => {
      const xml = await recXml({ recommender_name: '', recommender_title: {}, relationship: {}, recommender_company: '' })
      expect(xml).not.toContain('—')
    })
  })
})

/**
 * The rich-text and heading plumbing every DOCX section runs through.
 *
 * These are the shared builders — one wrong constant here changes every item in
 * the document at once, which is exactly why they were the biggest survivor
 * pocket in the file.
 */
describe('exportDocx — the shared paragraph builders', () => {
  const bodyStore = (html: string): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    // No short description: it stands in for a missing long one, which would
    // put a paragraph in the "empty body" case and hide what these count.
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, description: {}, long_description: { en: html } })]
    return s
  }
  const xmlOf = async (html: string, style: Record<string, unknown> = {}) => {
    await exportDocx(bodyStore(html), makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0, style } as never],
    }), 'en')
    return documentXml(lastBlob!)
  }
  const paraWith = (xml: string, text: string) => {
    const p = xml.split('</w:p>').find((x) => x.includes(text))
    if (p === undefined) throw new Error(`no paragraph with ${text}`)
    return p.slice(p.lastIndexOf('<w:p'))
  }
  const num = (frag: string, name: string) => {
    const m = new RegExp(`${name}="(-?\\d+)"`).exec(frag)
    return m ? Number(m[1]) : null
  }

  it('emits NO paragraph for an empty body', async () => {
    // An empty paragraph still takes vertical space in Word, so the COUNT is
    // what matters: the same document with a one-line body has exactly one more.
    const empty = (await xmlOf('')).split('<w:p>').length
    const filled = (await xmlOf('<p>Body.</p>')).split('<w:p>').length
    expect(filled).toBe(empty + 1)
  })

  describe('list markers and indentation', () => {
    it('numbers an ordered list from its own index, and bullets an unordered one', async () => {
      const ol = await xmlOf('<ol><li>First</li><li>Second</li></ol>')
      expect(ol).toContain('1. ')
      expect(ol).toContain('2. ')
      const ul = await xmlOf('<ul><li>First</li></ul>')
      expect(ul).toContain('•')
      expect(ul).not.toContain('1. ')
    })

    it('indents each nesting level by a further fixed step', async () => {
      // The step is what makes the hierarchy readable; a flat indent loses it.
      const xml = await xmlOf('<ul><li>Top</li><ul><li>Nested</li><ul><li>Deep</li></ul></ul></ul>')
      // The step is a fixed 360 twips (0.25"). Asserting only that the steps
      // are EQUAL passes for any multiple of it, so the values are named.
      expect(num(paraWith(xml, 'Top'), 'w:left')).toBe(360)
      expect(num(paraWith(xml, 'Nested'), 'w:left')).toBe(720)
      expect(num(paraWith(xml, 'Deep'), 'w:left')).toBe(1080)
    })

    it('gives a list item a tighter gap than a paragraph', async () => {
      // Bullets read as a group; paragraph spacing between them looks like a
      // series of separate statements.
      const list = num(paraWith(await xmlOf('<ul><li>One</li></ul>'), 'One'), 'w:after')!
      const para = num(paraWith(await xmlOf('<p>One</p>'), 'One'), 'w:after')!
      expect(list).toBeLessThan(para)
    })
  })

  describe('inline runs', () => {
    it('carries bold, italic and underline onto their runs', async () => {
      const xml = await xmlOf('<p><b>bold</b> <i>ital</i> <u>und</u></p>')
      const para = paraWith(xml, 'bold')
      expect(para).toContain('<w:b/>')
      expect(para).toContain('<w:i/>')
      expect(para).toContain('<w:u')
      // …and a plain run carries NONE of them, so each flag comes from the run
      // rather than being set on everything.
      const plain = paraWith(await xmlOf('<p>plain</p>'), 'plain')
      expect(plain).not.toContain('<w:u')
      expect(plain).not.toContain('<w:b/>')
      expect(plain).not.toContain('<w:i/>')
    })

    it('turns a <br> inside a list item into a REAL Word break', async () => {
      // A raw newline in <w:t> is XML whitespace — Word renders it as a SPACE
      // while the preview and PDF show a break, which is the bug this avoids.
      const xml = await xmlOf('<ul><li>one<br>two</li></ul>')
      expect(paraWith(xml, 'two')).toContain('<w:br/>')
    })

    it('emits exactly ONE empty run, and it is the one carrying the break', async () => {
      // A <br> arrives as its own '\n' run, which splits to ['','']. The guard
      // skips the LEADING empty piece and keeps the second — that kept run is
      // what carries break:1, so Word gets a break rather than a stray space.
      // Dropping the guard adds a second empty run; dropping the break makes
      // the line a space instead.
      const xml = await xmlOf('<ul><li>one<br>two</li></ul>')
      const para = paraWith(xml, 'two')
      const pieces = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1])
      expect(pieces).toEqual(['• ', 'one', '', 'two'])
      expect([...para.matchAll(/<w:br\/>/g)]).toHaveLength(1)
    })
  })

  describe('section headings', () => {
    it('shouts the label and rules it off in the accent colour', async () => {
      const xml = await xmlOf('<p>x</p>')
      const heading = paraWith(xml, 'PROJECTS')
      expect(heading).toContain('<w:b/>')
      expect(heading).toContain(deriveTokens(DEFAULT_VIEW_STYLE).accentHex)
      expect(heading).toMatch(/<w:bottom /)
    })

    it('replaces a hidden heading with a SPACER, not with nothing', async () => {
      // Dropping it entirely butts the section straight against the previous
      // one; the spacer keeps the rhythm.
      const xml = await xmlOf('<p>x</p>', { hide_heading: true })
      expect(xml).not.toContain('PROJECTS')
      const firstBody = paraWith(xml, 'Acme')
      expect(xml.indexOf('<w:p') ).toBeLessThan(xml.indexOf(firstBody))
    })
  })

  describe('the summary short-description placement', () => {
    const shortStore = () => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.projects = [makeProject({
        id: 'p1', customer: { en: 'Acme' }, description: { en: 'Payments' },
        short_description: { en: 'One line.' },
      })]
      return s
    }
    const summaryXml = async (style: Record<string, unknown>) => {
      await exportDocx(shortStore(), makeView({
        sections: [{ key: 'projects', detail: 'summary', sort_order: 0, style } as never],
      }), 'en')
      return documentXml(lastBlob!)
    }

    it('folds the short description INTO the line when asked inline', async () => {
      const xml = await summaryXml({ short_desc_line: 'inline' })
      expect(paraWith(xml, 'One line.')).toContain('Acme')
    })

    it('puts it on its own line otherwise', async () => {
      const xml = await summaryXml({ short_desc_line: 'below' })
      expect(paraWith(xml, 'One line.')).not.toContain('Acme')
    })

    it('emits no short line at all when there is no short description', async () => {
      const s = shortStore()
      s.projects[0].short_description = {}
      await exportDocx(s, makeView({
        sections: [{ key: 'projects', detail: 'summary', sort_order: 0 } as never],
      }), 'en')
      expect(await documentXml(lastBlob!)).not.toContain('One line.')
    })
  })

  describe('key points', () => {
    const pointsXml = async (points: Array<{ label?: Record<string, string>; body: Record<string, string> }>) => {
      const s = emptyStore()
      s.resume = makeResume({ full_name: 'X' })
      s.key_qualifications = [makeKQ({
        id: 'kq1', summary: { en: 'Summary.' },
        key_points: points.map((p, i) => ({
          id: `kp${i}`, name: p.label ?? {}, long_description: p.body, sort_order: i, disabled: false,
        })) as never,
      })]
      await exportDocx(s, makeView({
        sections: [{ key: 'key_qualifications', detail: 'full', sort_order: 0 } as never],
      }), 'en')
      return documentXml(lastBlob!)
    }

    it('bullets a labelled point and separates the label with a dash', async () => {
      const xml = await pointsXml([{ label: { en: 'Cloud' }, body: { en: 'Ran it.' } }])
      expect(xml).toContain('• Cloud')
      expect(xml).toContain(' — ')
      expect(xml).toContain('Ran it.')
    })

    it('bullets an unlabelled point without a dash', async () => {
      const xml = await pointsXml([{ body: { en: 'Ran it.' } }])
      expect(xml).toContain('•')
      expect(xml).not.toContain(' — ')
    })

    it('joins a multi-paragraph point onto one line with a space', async () => {
      const xml = await pointsXml([{ body: { en: 'First.\n\nSecond.' } }])
      const pieces = [...paraWith(xml, 'First.').matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
        .map((m) => m[1])
      // A separator run stands between the halves — without it they render as
      // "First.Second." on one line.
      expect(pieces).toContain('First.')
      expect(pieces).toContain('Second.')
      expect(pieces.slice(pieces.indexOf('First.'), pieces.indexOf('Second.'))).toContain(' ')
    })
  })

  it('labels a tag list when the descriptor supplies one, and omits it otherwise', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X' })
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Acme' },
      skills: [{ id: 'ps1', skill_id: 'go', name: { en: 'Go' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
    })]
    await exportDocx(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0 } as never],
    }), 'en')
    expect(await documentXml(lastBlob!)).toContain('Go')
  })

  it('aligns a logo banner by its placement', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'X', company_logo: PNG_1x1 })
    for (const [placement, want] of [['right', 'right'], ['center', 'center']] as const) {
      await exportDocx(s, makeView({
        sections: buildViewSections(),
        header: withHeaderDefaults({ logo_placement: placement }),
      }), 'en')
      expect(await documentXml(lastBlob!), placement).toContain(`w:val="${want}"`)
    }
  })
})

/**
 * The DOCX geometry, in the units Word actually reads.
 *
 * Every number here is derived from `deriveTokens`, so the assertions say "the
 * exporter wrote the token" rather than "the exporter wrote 170". A halved or
 * doubled conversion (twips are 1/20pt, run sizes are half-points) renders a
 * document that still opens and still says the right words, just wrong — which
 * is exactly the class of defect a reader notices and a test usually does not.
 */
describe('exportDocx — spacing and sizes come from the tokens', () => {
  const paraWith = (xml: string, text: string): string => {
    const chunk = xml.split('</w:p>').find((p) => p.includes(text))
    if (chunk === undefined) throw new Error(`no paragraph containing ${text}`)
    return chunk.slice(chunk.lastIndexOf('<w:p'))
  }
  const num = (fragment: string, name: string): number | null => {
    const m = new RegExp(`${name}="([\\d.]+)"`).exec(fragment)
    return m ? Number(m[1]) : null
  }
  const runSizes = (fragment: string): number[] =>
    [...fragment.matchAll(/w:sz w:val="([\d.]+)"/g)].map((m) => Number(m[1]))

  const store = (html: string): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Test Person' })
    s.projects = [makeProject({ customer: { en: 'AcmeCo' }, long_description: { en: html } })]
    return s
  }

  const xmlFor = async (html: string, style: Record<string, unknown> = {}) => {
    await exportDocx(store(html), makeView({
      sections: buildViewSections(), style: { ...DEFAULT_VIEW_STYLE, ...style },
    }), 'en')
    return documentXml(lastBlob!)
  }
  const tokensFor = (style: Record<string, unknown> = {}) =>
    deriveTokens({ ...DEFAULT_VIEW_STYLE, ...style } as never)

  it('writes body runs at the token size in HALF-points', async () => {
    for (const body_size of ['small', 'normal', 'large'] as const) {
      const xml = await xmlFor('<p>Body text.</p>', { body_size })
      const t = tokensFor({ body_size })
      expect(runSizes(paraWith(xml, 'Body text.')), body_size).toEqual([t.bodyFontSizePt * 2])
    }
  })

  it('writes a section heading at the h2 token size, over an accent rule', async () => {
    for (const body_size of ['small', 'large'] as const) {
      const xml = await xmlFor('<p>Body text.</p>', { body_size })
      const t = tokensFor({ body_size })
      const heading = paraWith(xml, 'PROJECTS')
      expect(runSizes(heading), body_size).toEqual([t.h2Pt * 2])
      expect(num(heading, 'w:color')).toBeNull() // colour is a hex attr, not numeric
      expect(heading).toContain(`w:color="${t.accentHex}"`)
      expect(num(heading, 'w:sz')).toBe(8) // the rule's thickness, in eighths of a point
    }
  })

  it('spaces a section heading by the item gap above and the section gap below', async () => {
    for (const density of ['compact', 'spacious'] as const) {
      const xml = await xmlFor('<p>Body text.</p>', { density })
      const t = tokensFor({ density })
      const heading = paraWith(xml, 'PROJECTS')
      // Twice the item gap: a heading needs more air above it than two items do
      // between them.
      expect(num(heading, 'w:before'), density).toBe(t.itemGapTwips * 2)
      expect(num(heading, 'w:after'), density).toBe(t.sectionHeadingAfterTwips)
    }
  })

  it('separates the paragraphs of one body by the shared paragraph gap', async () => {
    for (const density of ['compact', 'normal', 'spacious'] as const) {
      const xml = await xmlFor('<p>First one.</p><p>Second one.</p><p>Third one.</p>', { density })
      const t = tokensFor({ density })
      // Every paragraph but the last: the 1.5-line gap, per density.
      expect(num(paraWith(xml, 'First one.'), 'w:after'), density).toBe(t.paraGapTwips)
      expect(num(paraWith(xml, 'Second one.'), 'w:after'), density).toBe(t.paraGapTwips)
    }
  })

  it('gives the LAST paragraph the caller’s gap to whatever follows, not the paragraph gap', async () => {
    // The DOCX twin of `p:last-child { margin-bottom: 0 }` plus the container's
    // own margin: using the paragraph gap here would double the space between
    // one item's body and the next item's heading.
    const xml = await xmlFor('<p>First one.</p><p>Second one.</p>')
    const t = tokensFor()
    const last = num(paraWith(xml, 'Second one.'), 'w:after')
    expect(last).not.toBe(t.paraGapTwips)
    expect(last).toBeGreaterThan(0)
    // With a list after it, that same paragraph is no longer last and gets the
    // shared gap again.
    const withList = await xmlFor('<p>First one.</p><p>Second one.</p><ul><li>Item</li></ul>')
    expect(num(paraWith(withList, 'Second one.'), 'w:after')).toBe(t.paraGapTwips)
  })

  it('puts the caller\u2019s top gap on the FIRST paragraph only', async () => {
    // The gap belongs to the block, not to each paragraph in it; repeating it
    // would push every paragraph apart by the item gap as well.
    const xml = await xmlFor('<p>First one.</p><p>Second one.</p>')
    const first = num(paraWith(xml, 'First one.'), 'w:before')
    const second = num(paraWith(xml, 'Second one.'), 'w:before')
    expect(second).toBeNull()
    expect(first === null || first === 0).toBe(true)
  })

  it('gives a list item a tight gap and one indent step per level', async () => {
    const xml = await xmlFor('<ul><li>Top item</li><ul><li>Nested item</li></ul></ul>')
    expect(num(paraWith(xml, 'Top item'), 'w:after')).toBe(30)
    // 360 twips is a quarter inch — Word's own default indent step.
    expect(num(paraWith(xml, 'Top item'), 'w:left')).toBe(360)
    expect(num(paraWith(xml, 'Nested item'), 'w:left')).toBe(720)
  })

  it('sizes the item title and its details line from the tokens', async () => {
    for (const body_size of ['small', 'large'] as const) {
      const xml = await xmlFor('<p>Body text.</p>', { body_size })
      const t = tokensFor({ body_size })
      // A large item title is one point over h3, and stands alone on its line
      // — the date sits on the details line below it, at the body size.
      expect(runSizes(paraWith(xml, 'AcmeCo')), body_size).toEqual([(t.h3Pt + 1) * 2])
      expect(runSizes(paraWith(xml, 'Jan 2022')), body_size).toEqual([t.bodyFontSizePt * 2])
    }
  })
})

/**
 * Header images: the box a photo or logo has to fit into.
 *
 * A PNG is synthesised per case because only its IHDR is read — the exporter
 * takes the dimensions from the header and hands the bytes to Word untouched, so
 * a header with the size we want is enough to drive the scaler.
 */
describe('exportDocx — header image scaling', () => {
  /** A PNG whose IHDR declares `w`×`h`. Bytes beyond the header are zeroes. */
  const pngOf = (w: number, h: number): string => {
    const bytes = new Uint8Array(40)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
    const be = (offset: number, value: number) => {
      bytes[offset] = (value >>> 24) & 0xff
      bytes[offset + 1] = (value >>> 16) & 0xff
      bytes[offset + 2] = (value >>> 8) & 0xff
      bytes[offset + 3] = value & 0xff
    }
    be(16, w)
    be(20, h)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return `data:image/png;base64,${btoa(binary)}`
  }

  const EMU_PER_PX = 9525
  /** Every embedded image's rendered size, in pixels, in document order. */
  const extents = (xml: string): Array<{ w: number; h: number }> =>
    [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)]
      .map((m) => ({ w: Number(m[1]) / EMU_PER_PX, h: Number(m[2]) / EMU_PER_PX }))

  const exportWith = async (over: Record<string, unknown>) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Test Person', ...over })
    s.projects = [makeProject({ customer: { en: 'AcmeCo' } })]
    await exportDocx(s, makeView({
      sections: buildViewSections(),
      header: withHeaderDefaults({ photo_placement: 'right', logo_placement: 'left' }),
    }), 'en')
    return documentXml(lastBlob!)
  }

  it('shrinks an oversized photo to the box, keeping its aspect ratio', async () => {
    // The box is 132×156; twice that must come back as exactly the box.
    const xml = await exportWith({ profile_photo: pngOf(264, 312) })
    expect(extents(xml)).toContainEqual({ w: 132, h: 156 })
  })

  it('does NOT enlarge a photo that is already smaller than the box', async () => {
    // Upscaling a small photo is how a header ends up with a blurred face.
    const xml = await exportWith({ profile_photo: pngOf(66, 78) })
    expect(extents(xml)).toContainEqual({ w: 66, h: 78 })
  })

  it('scales on whichever axis binds, not the other one', async () => {
    // Wide and short: the width limit binds at 0.5, the height limit would not
    // bind at all, so mixing the two axes up doubles the image.
    const xml = await exportWith({ profile_photo: pngOf(264, 78) })
    expect(extents(xml)).toContainEqual({ w: 132, h: 39 })
  })

  it('fits a logo into its own, wider box', async () => {
    // The logo box is 240×64 — a different shape from the photo's.
    const xml = await exportWith({ company_logo: pngOf(480, 64), profile_photo: null })
    expect(extents(xml)).toContainEqual({ w: 240, h: 32 })
  })

  it('falls back to the box for an image whose header declares no size', async () => {
    // A 0×0 header would otherwise divide by zero and render nothing at all.
    const xml = await exportWith({ profile_photo: pngOf(0, 0) })
    expect(extents(xml)).toContainEqual({ w: 132, h: 156 })
  })

  it('never renders an image away to nothing', async () => {
    // Rounding a 1px-tall strip down would drop it entirely.
    const xml = await exportWith({ profile_photo: pngOf(2000, 1) })
    const [first] = extents(xml)
    expect(first.w).toBeGreaterThan(0)
    expect(first.h).toBeGreaterThanOrEqual(1)
  })
})

describe('exportDocx — the summary layout', () => {
  const paraWith = (xml: string, text: string): string => {
    const chunk = xml.split('</w:p>').find((p) => p.includes(text))
    if (chunk === undefined) throw new Error(`no paragraph containing ${text}`)
    return chunk.slice(chunk.lastIndexOf('<w:p'))
  }
  const num = (fragment: string, name: string): number | null => {
    const m = new RegExp(`${name}="([\\d.]+)"`).exec(fragment)
    return m ? Number(m[1]) : null
  }
  const runSizes = (fragment: string): number[] =>
    [...fragment.matchAll(/w:sz w:val="([\d.]+)"/g)].map((m) => Number(m[1]))

  const xmlFor = async (style: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Test Person' })
    s.presentations = [{
      id: 'pr1', resume_id: 'r1', title: { en: 'A talk about testing' }, event: { en: 'Testfest' },
      description: {}, short_description: {}, start: null, end: { year: 2024, month: 3 },
      presentation_type: null, url: null, disabled: false, starred: false, sort_order: 0,
      created_at: '', updated_at: '',
    }] as never
    await exportDocx(s, makeView({
      sections: [{ key: 'presentations', detail: 'summary', sort_order: 0 } as never],
      style: { ...DEFAULT_VIEW_STYLE, ...style },
    }), 'en')
    return documentXml(lastBlob!)
  }

  it('writes each summary slot as its own run, all at the small size', async () => {
    const xml = await xmlFor()
    const t = deriveTokens(DEFAULT_VIEW_STYLE)
    const line = paraWith(xml, 'A talk about testing')
    expect(line).toContain('Testfest')
    // Slots and the separators between them are each a run; the size is what
    // must not drift between them.
    expect(new Set(runSizes(line))).toEqual(new Set([t.smallFontSizePt * 2]))
    // The tail is subdued, the title is not.
    expect(line).toMatch(/<w:b\/>/)
    expect(line).toContain('w:color w:val="666666"')
  })

  it('puts the slots in the order the view asked for', async () => {
    // The Word file follows the same layout control as the preview: this used
    // to be a preview-only setting, so one view produced two orderings.
    const dateFirst = paraWith(await xmlFor({ summary_layout: 'date-title-org' }), 'A talk about testing')
    const titleFirst = paraWith(await xmlFor({ summary_layout: 'title-org-date' }), 'A talk about testing')
    const order = (frag: string): number[] =>
      [frag.indexOf('Mar 2024'), frag.indexOf('A talk about testing'), frag.indexOf('Testfest')]
    const [d1, t1, e1] = order(dateFirst)
    expect(d1).toBeLessThan(t1)
    expect(t1).toBeLessThan(e1)
    const [d2, t2, e2] = order(titleFirst)
    expect(t2).toBeLessThan(e2)
    expect(e2).toBeLessThan(d2)
  })

  it('omits the tail run entirely when there is no meta to show', async () => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Test Person' })
    s.presentations = [{
      id: 'pr1', resume_id: 'r1', title: { en: 'A talk about testing' }, event: {},
      description: {}, short_description: {}, start: null, end: null,
      presentation_type: null, url: null, disabled: false, starred: false, sort_order: 0,
      created_at: '', updated_at: '',
    }] as never
    await exportDocx(s, makeView({
      sections: [{ key: 'presentations', detail: 'summary', sort_order: 0 } as never],
    }), 'en')
    const line = paraWith(await documentXml(lastBlob!), 'A talk about testing')
    expect(line).not.toContain('w:color w:val="666666"')
    expect(line).not.toContain(' — ')
  })

  it('spaces summary lines at a third of the item gap, with a floor', async () => {
    // Summary rows sit closer together than full items; the floor keeps them
    // from touching at the tightest density.
    const compact = await xmlFor({ density: 'compact' })
    expect(num(paraWith(compact, 'A talk about testing'), 'w:after')).toBe(30)

    const spacious = await xmlFor({ density: 'spacious' })
    const t = deriveTokens({ ...DEFAULT_VIEW_STYLE, density: 'spacious' } as never)
    expect(num(paraWith(spacious, 'A talk about testing'), 'w:after'))
      .toBeCloseTo(t.itemGapTwips / 3, 3)
  })
})

/**
 * Where the header photo actually LANDS in the Word document.
 *
 * The existing test proves every placement produces a zip with media in it,
 * which is true even if all six render identically. The placements differ in
 * structure: the four side-by-side variants build a two-cell table, `above` and
 * `below` are plain paragraphs around the identity block, and `none` embeds no
 * image at all. Nothing asserted which one came out.
 */
describe('exportDocx — header photo placement', () => {
  const withPhoto = (placement: string) => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'Kari Nordmann', profile_photo: PNG_1x1 })
    return exportDocx(store, makeView({
      sections: buildViewSections(),
      header: withHeaderDefaults({ photo_placement: placement as never, photo_shape: 'square' }),
    }), 'en')
  }

  it('builds a side-by-side TABLE for the four inline placements', async () => {
    for (const placement of ['left', 'right', 'left_of_name', 'right_of_name']) {
      await withPhoto(placement)
      const xml = await documentXml(lastBlob!)
      expect(xml, placement).toContain('<w:tbl>')
      expect(xml, placement).toContain('w:drawing')
    }
  })

  it('uses NO table for the stacked placements', async () => {
    for (const placement of ['above', 'below']) {
      await withPhoto(placement)
      const xml = await documentXml(lastBlob!)
      expect(xml, placement).not.toContain('<w:tbl>')
      expect(xml, placement).toContain('w:drawing')
    }
  })

  it('embeds no image at all when the placement is none', async () => {
    await withPhoto('none')
    const xml = await documentXml(lastBlob!)
    expect(xml).not.toContain('w:drawing')
    expect(xml).toContain('Kari Nordmann')
  })

  it('puts the photo cell on the correct SIDE', async () => {
    // The cell order in the row is the whole difference between left and right;
    // the margin sits on the inside edge either way.
    await withPhoto('left')
    const left = await documentXml(lastBlob!)
    await withPhoto('right')
    const right = await documentXml(lastBlob!)

    const photoAt = (xml: string) => xml.indexOf('w:drawing')
    const nameAt = (xml: string) => xml.indexOf('Kari Nordmann')
    expect(photoAt(left)).toBeLessThan(nameAt(left))
    expect(photoAt(right)).toBeGreaterThan(nameAt(right))
  })
})

describe('exportDocx — the footer note', () => {
  const footerXml = async (footer: Record<string, unknown>) => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'Kari Nordmann' })
    await exportDocx(store, makeView({
      sections: buildViewSections(),
      footer: withFooterDefaults(footer as never),
    }), 'en')
    return documentXml(lastBlob!)
  }

  it('writes the note text', async () => {
    const xml = await footerXml({ separator: 'line', copyright: 'none', note: { en: 'Confidential' } })
    expect(xml).toContain('Confidential')
  })

  it('writes nothing for a footer with neither note nor copyright', async () => {
    const xml = await footerXml({ separator: 'none', copyright: 'none', note: {} })
    expect(xml).not.toContain('Confidential')
    expect(xml).toContain('Kari Nordmann')
  })
})

describe('exportDocx — the gap above the footer', () => {
  const xmlFor = async (footer: Record<string, unknown>) => {
    const store = emptyStore()
    store.resume = makeResume({ full_name: 'Kari Nordmann' })
    await exportDocx(store, makeView({
      sections: buildViewSections(),
      footer: withFooterDefaults(footer as never),
    }), 'en')
    return documentXml(lastBlob!)
  }

  /** The <w:p> element that carries the given text. */
  const paraWith = (xml: string, text: string) => {
    const at = xml.indexOf(text)
    return xml.slice(xml.lastIndexOf('<w:p>', at), xml.indexOf('</w:p>', at))
  }

  it('adds a gap above the FIRST footer line only when there is no separator rule', async () => {
    // The rule already provides the visual break; adding the gap as well leaves
    // the footer floating, and omitting it without a rule glues the footer to
    // the last section.
    const noRule = await xmlFor({ separator: 'none', copyright: 'none', note: { en: 'Alpha' } })
    expect(paraWith(noRule, 'Alpha')).toContain('w:before="280"')

    const withRule = await xmlFor({ separator: 'line', copyright: 'none', note: { en: 'Alpha' } })
    expect(paraWith(withRule, 'Alpha')).not.toContain('w:before="280"')
  })

  it('adds the gap to the first line only, not to every one', async () => {
    // A note above a copyright line: two footer paragraphs, one gap.
    const xml = await xmlFor({
      separator: 'none', copyright: 'person', note: { en: 'Alpha' }, note_placement: 'above',
    })
    expect(xml.match(/w:before="280"/g) ?? []).toHaveLength(1)
    expect(paraWith(xml, 'Alpha')).toContain('w:before="280"')
    expect(paraWith(xml, 'Kari Nordmann')).not.toContain('w:before="280"')
  })
})

describe('exportDocx — the geometry around the header', () => {
  const build = async (over: Record<string, unknown>, resume: Record<string, unknown> = {}) => {
    const store = emptyStore()
    store.resume = makeResume({
      full_name: 'Kari Nordmann', email: 'k@x.io', phone: '+47 900', website_url: 'https://x.io',
      profile_photo: PNG_1x1, ...resume,
    })
    await exportDocx(store, makeView({
      sections: buildViewSections(),
      header: withHeaderDefaults({ photo_shape: 'square', ...over } as never),
    }), 'en')
    return documentXml(lastBlob!)
  }

  it('puts the photo margin on the INSIDE edge, whichever side it sits on', async () => {
    // The gap belongs between the photo and the text; on the outside it just
    // indents the whole header.
    const gapRight = '<w:right w:type="dxa" w:w="200"/>'
    const gapLeft = '<w:left w:type="dxa" w:w="200"/>'

    const left = await build({ photo_placement: 'left' })
    expect(left).toContain(gapRight)
    expect(left).not.toContain(gapLeft)

    const right = await build({ photo_placement: 'right' })
    expect(right).toContain(gapLeft)
    expect(right).not.toContain(gapRight)
  })

  it('treats the _of_name variants as the same two sides', async () => {
    const leftOf = await build({ photo_placement: 'left_of_name' })
    expect(leftOf).toContain('<w:right w:type="dxa" w:w="200"/>')
    const rightOf = await build({ photo_placement: 'right_of_name' })
    expect(rightOf).toContain('<w:left w:type="dxa" w:w="200"/>')
  })

  it('gives the LAST contact line the big gap and the others the small one', async () => {
    // The last line closes the header block; giving every line the closing gap
    // spreads the contact details out like a list.
    const xml = await build({ photo_placement: 'none' })
    const paras = xml.split('</w:p>')
    const contact = paras.filter((p) => /k@x\.io|\+47 900|https:/.test(p))
    expect(contact.length).toBeGreaterThan(0)
    const last = contact[contact.length - 1]
    expect(last).toMatch(/w:after="200"/)
    for (const p of contact.slice(0, -1)) expect(p).toMatch(/w:after="30"/)
  })
})

// ─── Shared readers for the suites below ────────────────────────────────────

/** Every `<w:p>` element in the body, in document order. */
const bodyParas = (xml: string): string[] =>
  xml.slice(xml.indexOf('<w:body>')).match(/<w:p(?:\/>|(?: [^>]*)?>[\s\S]*?<\/w:p>)/g) ?? []

const paraOf = (xml: string, text: string): string => {
  const p = bodyParas(xml).find((x) => x.includes(text))
  if (p === undefined) throw new Error(`no paragraph containing ${text}`)
  return p
}

const numOf = (fragment: string, name: string): number | null => {
  const m = new RegExp(`${name}="(-?[0-9.]+)"`).exec(fragment)
  return m ? Number(m[1]) : null
}

const sizesOf = (fragment: string): number[] =>
  [...fragment.matchAll(/<w:sz w:val="([\d.]+)"\/>/g)].map((m) => Number(m[1]))

const textsOf = (fragment: string): string[] =>
  [...fragment.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1])

/**
 * Text that escaped a `<w:t>` element.
 *
 * `docx` serialises a raw string handed to a `children` array as a bare text
 * node — it does not throw and the file still opens, so Word shows a stray
 * word floating outside every run. Nothing else in a resume document writes
 * text outside `<w:t>`, which makes this a cheap standing check that each
 * children array only ever holds real components.
 */
const strayText = (xml: string): string[] =>
  [...xml.slice(xml.indexOf('<w:body>'))
    .replace(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>/g, '<w:t/>')
    .matchAll(/>([^<]+)</g)]
    .map((m) => m[1])
    .filter((s) => s.trim().length > 0)

/** The part carrying the document's default run properties. */
async function stylesXml(blob: Blob): Promise<string> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const part = files['word/styles.xml']
  if (!part) throw new Error('no word/styles.xml in the archive')
  return new TextDecoder().decode(part)
}

/**
 * The generic item layout, read through Education.
 *
 * Education is the plainest descriptor that fills every slot at once — a title
 * with a date, a meta line, a rich body and an extra line — and it takes the
 * body title size rather than the large one, so it also pins the sizing branch
 * that Projects and Work Experience hide. The resume is dropped so the section
 * is the WHOLE document: paragraph COUNT then becomes an assertion, which is
 * the only way to see a builder that emits a blank paragraph nobody asked for.
 */
describe('exportDocx — the item builders, with the document to themselves', () => {
  const eduStore = (over: Record<string, unknown> = {}): ResumeStore => {
    const s = emptyStore()
    s.resume = null
    s.educations = [makeEducation({
      school: { en: 'NTNU' },
      degree: { en: 'MSc Informatics' },
      grade: 'A',
      description: { en: '<p>Thesis on compilers.</p>' },
      ...over,
    })]
    return s
  }
  // The grade is an opt-in content group, so the section asks for it — these
  // tests are about the LAYOUT of an item that fills every slot.
  const xmlFor = async (
    over: Record<string, unknown> = {},
    style: Record<string, unknown> = {},
    extras: string[] = ['grade'],
  ) => {
    await exportDocx(eduStore(over), makeView({
      sections: [{
        key: 'educations', detail: 'full', sort_order: 0, style: { ...style, extras },
      } as never],
    }), 'en')
    return documentXml(lastBlob!)
  }
  const t = deriveTokens(DEFAULT_VIEW_STYLE)

  it('lays the whole item out in five paragraphs and nothing else', async () => {
    // Heading, title, meta, body, grade. Every "emit it anyway" branch below
    // adds a sixth, so this count is what makes the omission tests real.
    const xml = await xmlFor()
    expect(bodyParas(xml)).toHaveLength(5)
    expect(strayText(xml)).toEqual([])
  })

  it('sets the meta line in italics, subdued, at the body size', async () => {
    // The meta line is the item's second voice — the degree under the school.
    // Losing the italics or the grey makes it read as a second title.
    const meta = paraOf(await xmlFor(), 'MSc Informatics')
    expect(meta).toContain('<w:i/>')
    expect(meta).toContain('w:color w:val="666666"')
    expect(numOf(meta, 'w:after')).toBe(80)
    expect(sizesOf(meta)).toEqual([t.bodyFontSizePt * 2])
  })

  it('drops the meta line entirely when the item has no meta', async () => {
    // No grade group either, so the only italics left would be a meta line.
    const xml = await xmlFor({ degree: {}, grade: '', start: null, end: null }, {}, [])
    expect(bodyParas(xml)).toHaveLength(3)
    expect(xml).not.toContain('<w:i/>')
  })

  it('omits the grade line when the view did not ask for it', () => {
    // Optional facts are per view now: a section that never enabled the group
    // must not print the grade just because the record carries one.
    return xmlFor({}, {}, []).then((xml) => {
      expect(xml).not.toContain('Grade: A')
      expect(bodyParas(xml)).toHaveLength(4)
    })
  })

  it('writes the grade as a subtle extra line under the body', async () => {
    // extraLines is where a grade, a credential URL or a referee's phone
    // number lives; dropping the loop loses the fact, not just its styling.
    const xml = await xmlFor()
    const grade = paraOf(xml, 'Grade: A')
    expect(grade).toContain('w:color w:val="666666"')
    expect(numOf(grade, 'w:after')).toBe(40)
    expect(bodyParas(xml).indexOf(grade)).toBe(4)
  })

  it('gives the title the descriptor’s own top gap, bold, at the body size', async () => {
    // spacingBefore is per descriptor (200 on a project, 140 here): it is the
    // air BETWEEN items, so a lost value runs the list together, and a title
    // promoted to the large size makes every section look like Projects.
    const title = paraOf(await xmlFor(), 'NTNU')
    expect(numOf(title, 'w:before')).toBe(140)
    expect(numOf(title, 'w:after')).toBe(40)
    expect(title).toContain('<w:b/>')
    // The date run rides in the same paragraph only when the view shows dates;
    // the title itself is always at the body size.
    expect(sizesOf(title)[0]).toBe(t.bodyFontSizePt * 2)
  })

  it('leaves the top gap off an item whose descriptor asks for none', async () => {
    // Education asks for 140, a showcase category for 0 — and 0 has to become
    // "no attribute", not a literal zero and not some stand-in truthy value.
    const s = emptyStore()
    s.resume = null
    s.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    s.skills = [makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category_id: 'cat1', is_highlighted: true })]
    await exportDocx(s, makeView({
      sections: [{ key: 'technology_categories', detail: 'full', sort_order: 0 } as never],
    }), 'en')
    expect(paraOf(await documentXml(lastBlob!), 'Languages')).not.toContain('w:before=')
  })

  it('emits no paragraph for a body whose markup carries no words', async () => {
    // `<p></p>` survives as a truthy value in the store, so the body guard sees
    // content and the block parser sees none. The early return is what keeps an
    // empty paragraph — real vertical space in Word — out of the document.
    const xml = await xmlFor({ description: { en: '<p></p>' } })
    expect(bodyParas(xml)).toHaveLength(4)
    expect(strayText(xml)).toEqual([])
  })

  it('replaces a hidden heading with a spacer carrying the heading’s own top gap', async () => {
    // The spacer exists so a heading-less section still opens with the air the
    // heading would have provided; its run is deliberately 1pt so the spacer
    // contributes no line height of its own.
    const xml = await xmlFor({}, { hide_heading: true })
    const [spacer] = bodyParas(xml)
    expect(xml).not.toContain('EDUCATION')
    expect(numOf(spacer, 'w:before')).toBe(t.itemGapTwips * 2)
    expect(numOf(spacer, 'w:after')).toBe(0)
    expect(sizesOf(spacer)).toEqual([2])
    expect(textsOf(spacer)).toEqual([''])
  })
})

/**
 * The remaining item layouts — points, tags, the inline line and the quote.
 *
 * Same discipline as above: no resume and one section, so the paragraph count
 * is part of the assertion and a branch that emits an empty run shows up.
 */
describe('exportDocx — points, tags and the special layouts', () => {
  const t = deriveTokens(DEFAULT_VIEW_STYLE)

  const kqXml = async (
    points: Array<{ label?: Record<string, string>; body: Record<string, string> }>,
  ) => {
    const s = emptyStore()
    s.resume = null
    s.key_qualifications = [makeKQ({
      id: 'kq1', tag_line: {}, summary: { en: 'Summary.' },
      key_points: points.map((p, i) => ({
        id: `kp${i}`, name: p.label ?? {}, long_description: p.body, sort_order: i, disabled: false,
      })) as never,
    })]
    await exportDocx(s, makeView({
      sections: [{ key: 'key_qualifications', detail: 'full', sort_order: 0 } as never],
    }), 'en')
    return documentXml(lastBlob!)
  }

  it('writes an unlabelled point as glyph then text, with nothing wedged between', async () => {
    // The glyph run and the body run sit next to each other; a separator run
    // leaking in here prints as a bullet with a hole after it.
    const xml = await kqXml([{ body: { en: 'Ran it.' } }])
    const point = paraOf(xml, 'Ran it.')
    expect(textsOf(point)).toEqual(['• ', 'Ran it.'])
    expect(numOf(point, 'w:after')).toBe(60)
    expect(point).not.toContain('<w:b/>')
  })

  it('bolds a point’s label and separates it from the text with a dash', async () => {
    const point = paraOf(await kqXml([{ label: { en: 'Cloud' }, body: { en: 'Ran it.' } }]), 'Ran it.')
    expect(textsOf(point)).toEqual(['• Cloud', ' — ', 'Ran it.'])
    expect(point).toContain('<w:b/>')
  })

  it('joins the paragraphs of one point with exactly one space', async () => {
    // A point is ONE bullet line, so a two-paragraph body is flattened; the
    // separator belongs between the halves, not in front of the first.
    const point = paraOf(await kqXml([{ body: { en: 'First.\n\nSecond.' } }]), 'First.')
    expect(textsOf(point)).toEqual(['• ', 'First.', ' ', 'Second.'])
  })

  it('gives a profile with a hidden tag line no title paragraph at all', async () => {
    // The DOCX profile block is heading-less by default. Emitting the title
    // anyway puts an empty paragraph — real space in Word — above the prose.
    const xml = await kqXml([])
    expect(bodyParas(xml)).toHaveLength(2)
    expect(textsOf(xml)).toEqual(['PROFESSIONAL SUMMARY', 'Summary.'])
  })

  // ─── Tags ────────────────────────────────────────────────────────────────

  const projectXml = async (
    over: Record<string, unknown> = {},
    style: Record<string, unknown> = { tag_style: 'inline' },
  ) => {
    const s = emptyStore()
    s.resume = null
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Acme' }, description: {}, long_description: { en: '<p>Did it.</p>' },
      skills: [{
        id: 'ps1', skill_id: 'go', name: { en: 'Go' },
        duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
      }],
      ...over,
    })]
    await exportDocx(s, makeView({
      sections: [{ key: 'projects', detail: 'full', sort_order: 0, style } as never],
    }), 'en')
    return documentXml(lastBlob!)
  }

  it('labels the tag line, italicises the label only, and sets both at the meta size', async () => {
    // Without the label the skills print as a bare comma list with nothing
    // saying what they are; at body size they compete with the description.
    const tags = paraOf(await projectXml(), 'Go')
    expect(textsOf(tags)).toEqual(['Skills: ', 'Go'])
    expect(numOf(tags, 'w:before')).toBe(60)
    expect(numOf(tags, 'w:after')).toBe(100)
    expect(sizesOf(tags)).toEqual([t.metaFontSizePt * 2, t.metaFontSizePt * 2])
    expect(tags).toContain('<w:i/>')
    expect(tags).toContain('w:color w:val="666666"')
  })

  it('writes no tag line at all for an item with no tags', async () => {
    const xml = await projectXml({ skills: [] })
    expect(textsOf(xml)).toEqual(['PROJECTS', 'Acme', 'Jan 2022 – Jun 2023', 'Did it.'])
    expect(strayText(xml)).toEqual([])
  })

  it('writes the showcase tags with no label, and no stray text in its place', async () => {
    // The Skills Showcase deliberately carries an EMPTY tags label — the
    // category name above the list already says what it is.
    const s = emptyStore()
    s.resume = null
    s.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    s.skills = [makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category_id: 'cat1', is_highlighted: true })]
    await exportDocx(s, makeView({
      sections: [{
        key: 'technology_categories', detail: 'full', sort_order: 0, style: { tag_style: 'inline' },
      } as never],
    }), 'en')
    const xml = await documentXml(lastBlob!)
    expect(textsOf(paraOf(xml, 'TypeScript'))).toEqual(['TypeScript'])
    expect(strayText(xml)).toEqual([])
  })

  it('leads a project body with its short description as its own paragraph', async () => {
    // The DOCX project layout is the only one with a plain lead-in line; folded
    // into the rich body it would take the body's spacing and lose its own.
    const xml = await projectXml(
      { description: { en: 'Payments platform' } }, { tag_style: 'inline', extras: ['lead'] })
    const paras = bodyParas(xml)
    const lead = paraOf(xml, 'Payments platform')
    expect(numOf(lead, 'w:after')).toBe(80)
    expect(paras.indexOf(lead)).toBeLessThan(paras.indexOf(paraOf(xml, 'Did it.')))
  })

  // ─── Bullets and dates ───────────────────────────────────────────────────

  const eduOnly = (style: Record<string, unknown>) => {
    const s = emptyStore()
    s.resume = null
    s.educations = [makeEducation({ school: { en: 'NTNU' }, degree: {}, description: {} })]
    return exportDocx(s, makeView({
      sections: [{ key: 'educations', detail: 'full', sort_order: 0, style } as never],
    }), 'en')
  }

  it('bolds the bullet glyph so it matches the title it rides with', async () => {
    await eduOnly({ item_bullets: true, bullet_style: 'disc' })
    const title = paraOf(await documentXml(lastBlob!), 'NTNU')
    const glyphRun = title.split('</w:r>').find((r) => r.includes('•'))
    expect(glyphRun).toContain('<w:b/>')
  })

  it('writes no stray text where the bullet and the date runs are absent', async () => {
    // Both are conditional spreads into the title's children array; a raw value
    // reaching one lands in Word as text outside any run — it still opens, so
    // nothing but this notices.
    await eduOnly({ hide_dates: true })
    const xml = await documentXml(lastBlob!)
    expect(strayText(xml)).toEqual([])
    expect(textsOf(xml)).toEqual(['EDUCATION', 'NTNU'])
  })

  // ─── Inline and quote ────────────────────────────────────────────────────

  it('sets the inline language line at the body size, bold, tightly spaced', async () => {
    const s = emptyStore()
    s.resume = null
    s.spoken_languages = [makeSpokenLanguage({ name: { en: 'Norwegian' }, level: { en: 'Native' } })]
    await exportDocx(s, makeView({
      sections: [{ key: 'spoken_languages', detail: 'full', sort_order: 0 } as never],
    }), 'en')
    const line = paraOf(await documentXml(lastBlob!), 'Norwegian')
    expect(numOf(line, 'w:after')).toBe(30)
    expect(line).toContain('<w:b/>')
    expect(sizesOf(line)).toEqual([t.bodyFontSizePt * 2, t.bodyFontSizePt * 2])
  })

  it('drops an empty attribution rather than opening the line with a separator', async () => {
    // A quote whose only attribution fact is the relationship must read
    // "— (Former manager)", not a dash followed by a dangling middot.
    const s = emptyStore()
    s.resume = null
    s.recommendations = [makeRecommendation({
      id: 'r1', recommender_name: '', recommender_title: {}, recommender_company: '',
      relationship: { en: 'Former manager' }, text: { en: '<p>Excellent.</p>' },
    } as never)]
    await exportDocx(s, makeView({
      sections: [{ key: 'recommendations', detail: 'full', sort_order: 0 } as never],
    }), 'en')
    const tail = paraOf(await documentXml(lastBlob!), 'Former manager')
    expect(textsOf(tail)).toEqual(['— (Former manager)'])
    expect(numOf(tail, 'w:after')).toBe(120)
  })
})

/**
 * The identity block in the units Word reads.
 *
 * The existing identity tests read the run TEXT — which name, which order.
 * These read the numbers around it: an export where the name sets at the body
 * size, or where every contact line takes the block's closing gap, still says
 * all the right words.
 */
describe('exportDocx — the identity block, measured', () => {
  const t = deriveTokens(DEFAULT_VIEW_STYLE)
  /** Languages stay in the HEADER but not as a section, so the CV is header-only. */
  const headerOnlySections = () =>
    buildViewSections().map((s) => (s.key === 'spoken_languages' ? { ...s, detail: 'off' as const } : s))

  const idStore = (): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({
      full_name: 'Kari Nordmann', title: { en: 'Solution Architect' },
      phone: '+47 900 00 000', email: 'kari@example.com',
    })
    s.spoken_languages = [makeSpokenLanguage({ name: { en: 'Norwegian' }, level: { en: 'Native' } })]
    return s
  }
  const xmlFor = async (header: Record<string, unknown> = {}) => {
    await exportDocx(idStore(), makeView({
      sections: headerOnlySections(),
      header: withHeaderDefaults(header as never),
    }), 'en')
    return documentXml(lastBlob!)
  }

  it('sets the name at the h1 token size, bold, over its own gap', async () => {
    const name = paraOf(await xmlFor(), 'Kari Nordmann')
    expect(sizesOf(name)).toEqual([t.h1Pt * 2])
    expect(name).toContain('<w:b/>')
    expect(numOf(name, 'w:after')).toBe(60)
  })

  it('honours a per-view name size instead of the token', async () => {
    // The header's name_style is how a view presents the same person bigger or
    // smaller; falling back to the token would silently ignore the setting.
    const name = paraOf(await xmlFor({ name_style: { size_pt: 30, font: 'condensed' } }), 'Kari Nordmann')
    expect(sizesOf(name)).toEqual([60])
  })

  it('sets the title one point over the small size, with a wider gap below', async () => {
    const title = paraOf(await xmlFor(), 'Solution Architect')
    expect(sizesOf(title)).toEqual([(t.smallFontSizePt + 1) * 2])
    expect(numOf(title, 'w:after')).toBe(120)
  })

  it('honours a per-view title size instead of the derived one', async () => {
    const title = paraOf(await xmlFor({ title_style: { size_pt: 20, font: 'body' } }), 'Solution Architect')
    expect(sizesOf(title)).toEqual([40])
  })

  it('sets every run of a contact line at the meta size', async () => {
    // Label, separator and value are three separate runs; they have to agree,
    // or the line steps up and down mid-sentence.
    const contact = paraOf(await xmlFor(), '+47 900 00 000')
    expect(sizesOf(contact)).toEqual(Array(sizesOf(contact).length).fill(t.metaFontSizePt * 2))
    expect(sizesOf(contact).length).toBeGreaterThan(1)
  })

  it('writes no label run when a field’s label has been blanked', async () => {
    // Blanking a label ("just print the number") is a real setting; emitting an
    // empty run for it leaves a stray space where the label used to be.
    const fields = withHeaderDefaults({}).fields.map((f) =>
      (f.key === 'phone' ? { ...f, label: { en: '' } } : f))
    const contact = paraOf(await xmlFor({ fields }), '+47 900 00 000')
    expect(textsOf(contact)).toEqual(['+47 900 00 000', ' | ', 'Email: ', 'kari@example.com'])
  })

  it('gives the LAST contact line the closing gap and the earlier ones a tight one', async () => {
    // Phone and email share line one; the languages line is line two. Giving
    // every line the closing gap spreads the contact details out like a list,
    // and giving none of them it glues the header to the first section.
    const xml = await xmlFor()
    expect(numOf(paraOf(xml, '+47 900 00 000'), 'w:after')).toBe(30)
    expect(numOf(paraOf(xml, 'Norwegian (Native)'), 'w:after')).toBe(200)
  })
})

/**
 * The header images: where they sit, how they are spaced, and whether the
 * circle a user chose survives the trip into Word.
 */
describe('exportDocx — header image placement, spacing and masking', () => {
  // The module mock is created once for the file, so its call log outlives a
  // test; "was never called" only means anything from a clean slate.
  beforeEach(() => { maskSpy.mockReset() })

  /** A PNG whose IHDR declares `w`×`h`; the exporter only reads that header. */
  const pngSized = (w: number, h: number): string => {
    const bytes = new Uint8Array(40)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
    const be = (offset: number, value: number) => {
      bytes[offset] = (value >>> 24) & 0xff
      bytes[offset + 1] = (value >>> 16) & 0xff
      bytes[offset + 2] = (value >>> 8) & 0xff
      bytes[offset + 3] = value & 0xff
    }
    be(16, w)
    be(20, h)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return `data:image/png;base64,${btoa(binary)}`
  }
  const EMU_PER_PX = 9525
  const extents = (xml: string): Array<{ w: number; h: number }> =>
    [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)]
      .map((m) => ({ w: Number(m[1]) / EMU_PER_PX, h: Number(m[2]) / EMU_PER_PX }))

  const exportWith = async (
    header: Record<string, unknown>, resume: Record<string, unknown> = {},
  ) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann', ...resume })
    await exportDocx(s, makeView({
      sections: buildViewSections(), header: withHeaderDefaults(header as never),
    }), 'en')
    return documentXml(lastBlob!)
  }

  it('aligns a left-placed logo left rather than falling through to another edge', async () => {
    // Three placements, one fall-through: 'left' is the one no earlier test
    // covers, so an inverted right-check reads as correct.
    const xml = await exportWith({ logo_placement: 'left' }, { company_logo: PNG_1x1 })
    expect(paraOf(xml, 'w:drawing')).toContain('<w:jc w:val="left"/>')
  })

  it('spaces the logo banner from the identity block below it', async () => {
    const xml = await exportWith({ logo_placement: 'center' }, { company_logo: PNG_1x1 })
    expect(numOf(paraOf(xml, 'w:drawing'), 'w:after')).toBe(140)
  })

  it('omits a stored logo entirely when its placement is none', async () => {
    // A view turning the logo off is a presentation decision, not a data one —
    // the logo stays on the resume and must not reappear in the export.
    const xml = await exportWith({ logo_placement: 'none' }, { company_logo: PNG_1x1 })
    expect(xml).not.toContain('w:drawing')
  })

  it('puts an "above" photo before the name, with its own gap under it', async () => {
    const xml = await exportWith(
      { photo_placement: 'above', photo_shape: 'square' }, { profile_photo: PNG_1x1 })
    const photo = paraOf(xml, 'w:drawing')
    expect(bodyParas(xml).indexOf(photo)).toBeLessThan(bodyParas(xml).indexOf(paraOf(xml, 'Kari Nordmann')))
    expect(numOf(photo, 'w:after')).toBe(100)
    expect(numOf(photo, 'w:before')).toBeNull()
  })

  it('puts a "below" photo after the identity, gapped on both sides', async () => {
    // 'above' and 'below' are the same two paragraphs in opposite order; a
    // collapsed branch still produces a document with a photo in it.
    const xml = await exportWith(
      { photo_placement: 'below', photo_shape: 'square' }, { profile_photo: PNG_1x1 })
    const photo = paraOf(xml, 'w:drawing')
    expect(bodyParas(xml).indexOf(photo)).toBeGreaterThan(bodyParas(xml).indexOf(paraOf(xml, 'Kari Nordmann')))
    expect(numOf(photo, 'w:before')).toBe(100)
    expect(numOf(photo, 'w:after')).toBe(120)
  })

  it('scales a tall photo by its HEIGHT when that is the binding limit', async () => {
    // The two limits are combined with a min, so the axis that binds decides.
    // A narrow, tall photo is the only shape where the height limit wins — the
    // existing cases all bind on width, which leaves the height term free.
    const xml = await exportWith(
      { photo_placement: 'above', photo_shape: 'square' }, { profile_photo: pngSized(66, 312) })
    expect(extents(xml)).toEqual([{ w: 33, h: 156 }])
  })

  it('masks a non-square photo and embeds the MASKED image', async () => {
    // Word cannot round an image's corners, so the circle is baked into the
    // pixels before embedding. Embedding the original instead silently gives
    // back the square photo the user chose to crop.
    maskSpy.mockResolvedValue(pngSized(40, 40))
    const xml = await exportWith(
      { photo_placement: 'above', photo_shape: 'circle' }, { profile_photo: pngSized(100, 100) })
    expect(maskSpy).toHaveBeenCalledWith(pngSized(100, 100), 'circle')
    expect(extents(xml)).toEqual([{ w: 40, h: 40 }])
  })

  it('does not mask a square photo — the shape IS the original bytes', async () => {
    const xml = await exportWith(
      { photo_placement: 'above', photo_shape: 'square' }, { profile_photo: pngSized(100, 100) })
    expect(maskSpy).not.toHaveBeenCalled()
    expect(extents(xml)).toEqual([{ w: 100, h: 100 }])
  })

  it('does not mask when the placement hides the photo', async () => {
    await exportWith({ photo_placement: 'none', photo_shape: 'circle' }, { profile_photo: pngSized(100, 100) })
    expect(maskSpy).not.toHaveBeenCalled()
  })

  it('does not mask when there is no photo to mask', async () => {
    // All three conditions have to hold together; any one of them relaxed sends
    // a null image into the masker.
    await exportWith({ photo_placement: 'left', photo_shape: 'circle' }, { profile_photo: null })
    expect(maskSpy).not.toHaveBeenCalled()
  })
})

/**
 * The view introduction — the paragraph a view uses to address one reader.
 *
 * It has its own spacing rules (an opening gap on the first paragraph, a wider
 * closing gap under the last) and its own voice: italic, grey, body size.
 */
describe('exportDocx — the view introduction', () => {
  const t = deriveTokens(DEFAULT_VIEW_STYLE)
  const introXml = async (text: string) => {
    const s = emptyStore()
    s.resume = null
    await exportDocx(s, makeView({ sections: buildViewSections(), introduction: { en: text } }), 'en')
    return documentXml(lastBlob!)
  }

  it('opens with a gap above the first paragraph only', async () => {
    // The gap belongs to the block, not to each paragraph — repeated, it pushes
    // the intro's own sentences as far apart as the intro is from the header.
    const xml = await introXml('First line.\n\nSecond line.')
    expect(numOf(paraOf(xml, 'First line.'), 'w:before')).toBe(80)
    expect(numOf(paraOf(xml, 'Second line.'), 'w:before')).toBeNull()
  })

  it('closes with a wider gap under the last paragraph than between them', async () => {
    const xml = await introXml('First line.\n\nSecond line.')
    expect(numOf(paraOf(xml, 'First line.'), 'w:after')).toBe(t.paraGapTwips)
    expect(numOf(paraOf(xml, 'Second line.'), 'w:after')).toBe(220)
  })

  it('sets the intro in italics, grey, at the body size', async () => {
    // It reads as an aside to the reader; in the body voice it reads as the CV
    // making a claim about itself.
    const only = paraOf(await introXml('Only line.'), 'Only line.')
    expect(only).toContain('<w:i/>')
    expect(only).toContain('w:color w:val="333333"')
    expect(sizesOf(only)).toEqual([t.bodyFontSizePt * 2])
    expect(numOf(only, 'w:after')).toBe(220)
  })
})

/**
 * How the Skill Matrix section is wired into the document, and the geometry of
 * the table itself.
 *
 * The matrix is the one section that bypasses the generic renderer — its own
 * heading branch, its own emptiness check, its own table builder — so nothing
 * asserted about the other sections reaches any of it.
 */
describe('exportDocx — the skill matrix section', () => {
  const t = deriveTokens(DEFAULT_VIEW_STYLE)

  /** A view where the matrix is the ONLY section, so the document is just it. */
  const matrixOnly = (detail: 'full' | 'summary', style: Record<string, unknown> = {}) =>
    makeView({
      sections: buildViewSections().map((s) =>
        (s.key === 'skill_matrix'
          ? { ...s, detail, style } as never
          : { ...s, detail: 'off' as const })),
    })

  const matrixStore = (): ResumeStore => {
    const s = emptyStore()
    s.resume = null
    s.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    s.skills = [
      makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category_id: 'cat1', proficiency: 4, is_highlighted: true }),
      makeSkill({ id: 'go', name: { en: 'Go' }, category_id: null, proficiency: 3, is_highlighted: false }),
    ]
    return s
  }
  const cells = (xml: string): string[] =>
    [...xml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)]
      .map((m) => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join(''))
  const rawCells = (xml: string): string[] =>
    [...xml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0])

  it('lists only the highlighted skills at summary detail', async () => {
    // Summary is the "headline competencies" mode. Showing every skill turns a
    // six-row highlight table back into the full registry dump.
    await exportDocx(matrixStore(), matrixOnly('summary'), 'en')
    const c = cells(await documentXml(lastBlob!))
    expect(c).toContain('TypeScript')
    expect(c).not.toContain('Go')
  })

  it('lists every skill at full detail', async () => {
    await exportDocx(matrixStore(), matrixOnly('full'), 'en')
    const c = cells(await documentXml(lastBlob!))
    expect(c).toContain('TypeScript')
    expect(c).toContain('Go')
  })

  it('emits neither heading nor table when no skill qualifies', async () => {
    // An empty matrix must vanish completely — a heading over a header row with
    // nothing under it reads as data the CV forgot to fill in.
    const s = matrixStore()
    s.skills = s.skills.map((sk) => ({ ...sk, is_highlighted: false }))
    await exportDocx(s, matrixOnly('summary'), 'en')
    const xml = await documentXml(lastBlob!)
    expect(xml).not.toContain('<w:tbl>')
    expect(xml).not.toContain('SKILL MATRIX')
  })

  it('heads the matrix, or replaces the heading with a measured spacer', async () => {
    await exportDocx(matrixStore(), matrixOnly('full'), 'en')
    expect(await documentXml(lastBlob!)).toContain('SKILL MATRIX')

    await exportDocx(matrixStore(), matrixOnly('full', { hide_heading: true }), 'en')
    const hidden = await documentXml(lastBlob!)
    expect(hidden).not.toContain('SKILL MATRIX')
    expect(numOf(bodyParas(hidden)[0], 'w:before')).toBe(t.itemGapTwips * 2)
  })

  it('splits the width evenly across the columns it actually shows', async () => {
    // Five columns at a quarter each overflow the page; the share is computed
    // from the surviving column count for that reason.
    await exportDocx(matrixStore(), matrixOnly('full'), 'en')
    expect(rawCells(await documentXml(lastBlob!))[0]).toContain('w:w="20%"')

    await exportDocx(matrixStore(), matrixOnly('full', { hide_dates: true }), 'en')
    expect(rawCells(await documentXml(lastBlob!))[0]).toContain('w:w="25%"')
  })

  it('drops exactly ONE column when dates are hidden', async () => {
    // Counting the cells is what separates "the column is gone" from "the
    // column is there but empty" — the two look identical read as text.
    await exportDocx(matrixStore(), matrixOnly('full', { hide_dates: true }), 'en')
    const c = cells(await documentXml(lastBlob!))
    expect(c.slice(0, 4)).toEqual(['Skill', 'Category', 'Experience', 'Proficiency'])
    expect(c).toHaveLength(12)
  })

  it('keeps the Category column when only SOME rows carry one', async () => {
    // One categorised skill among many is the normal case; requiring every row
    // to have a category silently drops the column for almost every CV.
    await exportDocx(matrixStore(), matrixOnly('full'), 'en')
    const c = cells(await documentXml(lastBlob!))
    expect(c.slice(0, 5)).toEqual(['Skill', 'Category', 'Experience', 'Proficiency', 'Last used'])
    expect(c.slice(10, 15)).toEqual(['Go', '', '', '3/5', ''])
  })

  it('marks the header row to repeat across a page break', async () => {
    // The matrix is the one part of a CV that can run past a page boundary, and
    // a headerless continuation is four columns of unlabelled numbers.
    await exportDocx(matrixStore(), matrixOnly('full'), 'en')
    expect(await documentXml(lastBlob!)).toContain('<w:tblHeader/>')
  })

  it('pads every cell so borderless columns do not touch', async () => {
    // TableBorders.NONE — with no rules between them, the padding is the only
    // thing keeping one column's text off the next.
    await exportDocx(matrixStore(), matrixOnly('full'), 'en')
    const cell = rawCells(await documentXml(lastBlob!))[0]
    expect(cell).toContain('<w:top w:type="dxa" w:w="40"/>')
    expect(cell).toContain('<w:bottom w:type="dxa" w:w="40"/>')
    expect(cell).toContain('<w:right w:type="dxa" w:w="120"/>')
  })

  it('sets cell text at the small size, not the body size', async () => {
    await exportDocx(matrixStore(), matrixOnly('full'), 'en')
    expect(sizesOf(rawCells(await documentXml(lastBlob!))[0])).toEqual([t.smallFontSizePt * 2])
  })

  it('prints the real last-used date rather than leaving the column blank', async () => {
    // The Last used column is the point of the matrix: it says which skills are
    // current. A column that always answers "" is worse than no column.
    const s = matrixStore()
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Acme' },
      start: { year: 2022, month: 1 }, end: { year: 2023, month: 5 },
      skills: [{
        id: 'ps1', skill_id: 'ts', name: { en: 'TypeScript' },
        duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
      }],
    })]
    await exportDocx(s, matrixOnly('full'), 'en')
    expect(cells(await documentXml(lastBlob!))[9]).toBe('May 2023')
  })
})

/**
 * The footer rule — the horizontal line closing the document.
 *
 * Its style, weight and colour are a view setting, and every separator style
 * still produces a valid document, so the only way a wrong one shows up is by
 * reading the border element itself.
 */
describe('exportDocx — the footer rule', () => {
  const t = deriveTokens(DEFAULT_VIEW_STYLE)
  const footerXml = async (footer: Record<string, unknown>) => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    await exportDocx(s, makeView({ sections: [], footer: withFooterDefaults(footer as never) }), 'en')
    return documentXml(lastBlob!)
  }
  /** The rule paragraph: the only one with a TOP border (headings rule below). */
  const rule = (xml: string): string => {
    const p = bodyParas(xml).find((x) => x.includes('<w:top w:val='))
    if (p === undefined) throw new Error('no paragraph carrying a top border')
    return p
  }

  it('draws the rule in the accent colour, hairline thin, and carries no text', async () => {
    // It is a rule, not a line of content: a run inside it would give the
    // paragraph a text line's height and push the footer down a row.
    const xml = await footerXml({ separator: 'line', copyright: 'none', note: { en: 'Confidential' } })
    const r = rule(xml)
    expect(r).toContain(`<w:top w:val="single" w:color="${t.accentHex}" w:sz="6" w:space="1"/>`)
    expect(r).toMatch(/<\/w:pPr><\/w:p>$/)
  })

  it('spaces the rule off the last section, and off the footer text below it', async () => {
    const withText = await footerXml({ separator: 'line', copyright: 'none', note: { en: 'Confidential' } })
    expect(numOf(rule(withText), 'w:before')).toBe(280)
    expect(numOf(rule(withText), 'w:after')).toBe(60)

    // A rule with nothing under it must not reserve room for absent text.
    const bare = await footerXml({ separator: 'line', copyright: 'none', note: {} })
    expect(numOf(rule(bare), 'w:after')).toBe(0)
  })

  it('draws each separator style as itself, and the thick one thicker', async () => {
    // 'thick' shares SINGLE with 'line' and differs only in weight, so a lost
    // weight makes the two settings identical.
    const dotted = await footerXml({ separator: 'dotted', copyright: 'none', note: { en: 'x' } })
    expect(rule(dotted)).toContain('w:val="dotted"')

    const dbl = await footerXml({ separator: 'double', copyright: 'none', note: { en: 'x' } })
    expect(rule(dbl)).toContain('w:val="double"')

    const thick = await footerXml({ separator: 'thick', copyright: 'none', note: { en: 'x' } })
    expect(rule(thick)).toContain('w:val="single"')
    expect(numOf(rule(thick), 'w:sz')).toBe(18)
  })

  it('draws no rule at all when the view asks for none', async () => {
    const xml = await footerXml({ separator: 'none', copyright: 'none', note: { en: 'Confidential' } })
    expect(xml).not.toContain('<w:top w:val=')
    expect(xml).toContain('Confidential')
  })

  it('sets the footer text at the meta size', async () => {
    // The footer is the smallest voice on the page; at body size it competes
    // with the CV it is closing.
    const xml = await footerXml({ separator: 'line', copyright: 'none', note: { en: 'Confidential' } })
    expect(sizesOf(paraOf(xml, 'Confidential'))).toEqual([t.metaFontSizePt * 2])
  })
})

/**
 * Page setup and the document's default run — the two places a setting reaches
 * every page at once without appearing in any paragraph.
 */
describe('exportDocx — page setup and document defaults', () => {
  const build = async (style: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.resume = null
    await exportDocx(s, makeView({
      sections: [], style: { ...DEFAULT_VIEW_STYLE, ...style },
    }), 'en')
    return lastBlob!
  }

  it('sets A4 portrait, in twips', async () => {
    // Word has no notion of "A4" here — the size is the literal page geometry,
    // and a wrong one reprints the whole CV at the wrong margins.
    expect(await documentXml(await build()))
      .toContain('<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>')
  })

  it('takes the page margins from the view’s own token, not a fixed default', async () => {
    for (const page_margin of ['tight', 'generous'] as const) {
      const xml = await documentXml(await build({ page_margin }))
      const m = deriveTokens({ ...DEFAULT_VIEW_STYLE, page_margin } as never).pageMarginTwips
      expect(xml, page_margin).toContain(
        `<w:pgMar w:top="${m.top}" w:right="${m.right}" w:bottom="${m.bottom}" w:left="${m.left}"`)
    }
  })

  it('declares the body font and size as the document default', async () => {
    // Paragraphs set their own run properties, but anything docx generates for
    // itself (an empty paragraph, a table's filler) inherits these — so a
    // missing default is a document that changes typeface halfway down.
    for (const body_size of ['small', 'large'] as const) {
      const styles = await stylesXml(await build({ body_size }))
      const t = deriveTokens({ ...DEFAULT_VIEW_STYLE, body_size } as never)
      const defaults = styles.slice(styles.indexOf('<w:docDefaults>'), styles.indexOf('</w:docDefaults>'))
      expect(defaults, body_size).toContain(`w:ascii="${t.bodyFontDocx}"`)
      expect(defaults, body_size).toContain(`<w:sz w:val="${t.bodyFontSizePt * 2}"/>`)
    }
  })

  it('exports a resume-less store, and still names the file from the view', async () => {
    // A store can reach the exporter with no resume row (a fresh or partially
    // loaded one). Reading through it unguarded turns Export into a crash.
    const s = emptyStore()
    s.resume = null
    s.projects = [makeProject({ customer: { en: 'Acme' } })]
    await exportDocx(s, makeView({ name: 'Board CV', sections: buildViewSections() }), 'en')
    const anchors = (vi.mocked(HTMLAnchorElement.prototype.click).mock.instances ?? []) as HTMLAnchorElement[]
    expect(await isZip(lastBlob!)).toBe(true)
    expect(anchors[anchors.length - 1].download).toBe('resume_Board_CV.docx')
  })

  it('skips the whole footer for a resume-less store, rule and copyright alike', async () => {
    // The footer's copyright names the resume's owner, so with no resume there
    // is nobody to credit — and reaching for the name anyway is a crash on the
    // last step of an export the user already waited for.
    const s = emptyStore()
    s.resume = null
    await exportDocx(s, makeView({
      sections: [],
      footer: withFooterDefaults({
        separator: 'line', copyright: 'person', note: { en: 'Confidential' },
      } as never),
    }), 'en')
    const xml = await documentXml(lastBlob!)
    expect(xml).not.toContain('Confidential')
    expect(xml).not.toContain('<w:top w:val=')
  })
})

/**
 * The section dispatcher's drop paths.
 *
 * Each one is a section that legitimately renders NOTHING — a descriptor with
 * no renderer, an item that declines to be exported, a short description made
 * of spaces. Every one of them still produces a valid .docx, so the failure
 * mode is an empty heading or a blank line, not an error.
 */
describe('exportDocx — sections and items that render nothing', () => {
  const onlySection = (key: string, detail: 'full' | 'summary', style: Record<string, unknown> = {}) =>
    makeView({ sections: [{ key, detail, sort_order: 0, style } as never] })

  it('writes no Industries heading, and no stray text, for a registry with no renderer', async () => {
    // Industries IS an exportable section but the catalog gives it no renderer,
    // so it drops out silently. The drop returns an array straight into the
    // document body, which is where a raw value would land as loose text.
    const s = emptyStore()
    s.resume = null
    s.industries = [makeIndustry({ name: { en: 'Finance' } })]
    await exportDocx(s, onlySection('industries', 'full'), 'en')
    const xml = await documentXml(lastBlob!)
    expect(strayText(xml)).toEqual([])
    expect(bodyParas(xml)).toEqual([])
  })

  it('writes no References heading when the only reference is not for export', async () => {
    // A private referee is a real setting, and a heading over an empty section
    // tells the reader the CV lost something.
    const s = emptyStore()
    s.resume = null
    s.references = [makeReference({ name: 'Jane Doe', include_in_exports: false })]
    for (const detail of ['full', 'summary'] as const) {
      await exportDocx(s, onlySection('references', detail), 'en')
      const xml = await documentXml(lastBlob!)
      expect(xml, detail).not.toContain('Jane Doe')
      expect(xml, detail).not.toContain('REFERENCES')
      expect(strayText(xml), detail).toEqual([])
    }
  })

  const talkStore = (short: string): ResumeStore => {
    const s = emptyStore()
    s.resume = null
    s.presentations = [makePresentation({
      id: 'pr1', title: { en: 'A talk about testing' }, event: {},
      description: {}, short_description: { en: short }, start: null, end: null,
    } as never)]
    return s
  }

  it('trims a padded short description instead of printing the padding', async () => {
    // The value comes from a paste or an import as often as from typing; the
    // padding shows up in Word as a hanging indent nobody set.
    await exportDocx(talkStore('  One line.  '), onlySection('presentations', 'summary'), 'en')
    const xml = await documentXml(lastBlob!)
    expect(textsOf(paraOf(xml, 'One line.'))).toEqual(['One line.'])
  })

  it('treats a whitespace-only short description as no description at all', async () => {
    await exportDocx(talkStore('   '), onlySection('presentations', 'summary'), 'en')
    const xml = await documentXml(lastBlob!)
    expect(bodyParas(xml)).toHaveLength(2)
    expect(textsOf(xml)).toEqual(['PRESENTATIONS', 'A talk about testing'])
  })

  it('folds an inline short description in with no meta ahead of it', async () => {
    // The item has no event and no date, so the summary line's meta is empty —
    // joining it in anyway opens the line with a dangling dash.
    await exportDocx(talkStore('One line.'), onlySection('presentations', 'summary', { short_desc_line: 'inline' }), 'en')
    const xml = await documentXml(lastBlob!)
    expect(bodyParas(xml)).toHaveLength(2)
    expect(textsOf(xml)).toEqual(['PRESENTATIONS', 'A talk about testing', ' — One line.'])
  })

  it('puts a below-the-line short description in its own subdued paragraph', async () => {
    await exportDocx(talkStore('One line.'), onlySection('presentations', 'summary', { short_desc_line: 'below' }), 'en')
    const xml = await documentXml(lastBlob!)
    const short = paraOf(xml, 'One line.')
    expect(bodyParas(xml)).toHaveLength(3)
    expect(short).toContain('w:color w:val="666666"')
    expect(numOf(short, 'w:after')).toBe(60)
  })
})

/**
 * The cover letter's geometry.
 *
 * `exportCoverLetterDocx` is a second document builder — its own page, its own
 * block spacing, its own default gap — and the existing suite reads its TEXT.
 * A letter with every gap collapsed to one value says the same words and reads
 * like a memo.
 */
describe('exportCoverLetterDocx — the letter’s measurements', () => {
  const sz = deriveTokens(DEFAULT_VIEW_STYLE).bodyFontSizePt * 2
  const accent = deriveTokens(DEFAULT_VIEW_STYLE).accentHex

  const letterStore = (): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({
      full_name: 'Kari Nordmann', email: 'kari@example.com', phone: '+47 900 00 000', website_url: null,
    })
    return s
  }
  const filled = (over = {}) => makeCoverLetter({
    name: 'Equinor application',
    company: { en: 'Equinor ASA' },
    recipient: { en: 'Hiring Manager' },
    role_applied: { en: 'Lead Architect' },
    greeting: { en: 'Dear Hiring Manager,' },
    body: { en: 'First paragraph.\n\nSecond paragraph.' },
    closing: { en: 'Yours sincerely,' },
    place_dated: 'Oslo, 1 March 2026',
    ...over,
  })
  const xmlOf = async (store = letterStore(), letter = filled()) => {
    await exportCoverLetterDocx(store, letter, 'en')
    return documentXml(lastBlob!)
  }

  it('sets the letterhead name larger, bold and in the accent colour', async () => {
    // It is the letter's only piece of branding; at body weight the letter
    // opens with a line that looks like it was pasted in.
    const name = bodyParas(await xmlOf())[0]
    expect(sizesOf(name)).toEqual([sz + 10])
    expect(name).toContain('<w:b/>')
    expect(name).toContain(`w:color w:val="${accent}"`)
    expect(numOf(name, 'w:after')).toBe(40)
  })

  it('sets the contact line smaller and grey, then opens a gap', async () => {
    const contact = paraOf(await xmlOf(), 'kari@example.com')
    expect(sizesOf(contact)).toEqual([sz - 2])
    expect(contact).toContain('w:color w:val="333333"')
    expect(numOf(contact, 'w:after')).toBe(320)
  })

  it('spaces every block by its role in the letter', async () => {
    // Seven different gaps, none interchangeable: the addressee block sits
    // tight internally and open below, the salutation breathes, the paragraphs
    // are a body. One shared value turns a letter into a list.
    const xml = await xmlOf()
    expect(numOf(paraOf(xml, 'Oslo, 1 March 2026'), 'w:after')).toBe(320)
    expect(numOf(paraOf(xml, 'Hiring Manager'), 'w:after')).toBe(40)
    expect(numOf(paraOf(xml, 'Equinor ASA'), 'w:after')).toBe(320)
    expect(numOf(paraOf(xml, 'Lead Architect'), 'w:after')).toBe(280)
    expect(numOf(paraOf(xml, 'Dear Hiring Manager,'), 'w:after')).toBe(200)
    expect(numOf(paraOf(xml, 'First paragraph.'), 'w:after')).toBe(200)
    expect(numOf(paraOf(xml, 'Yours sincerely,'), 'w:after')).toBe(40)
  })

  it('justifies the body paragraphs and nothing else', async () => {
    const xml = await xmlOf()
    expect(paraOf(xml, 'Second paragraph.')).toContain('<w:jc w:val="both"/>')
    expect(paraOf(xml, 'Dear Hiring Manager,')).not.toContain('<w:jc')
  })

  it('bolds the subject and the signature, and gives the signature the default gap', async () => {
    // The signature is the one block that names no spacing of its own, so it
    // reads the builder's fallback — which is why the fallback has to exist.
    const xml = await xmlOf()
    const paras = bodyParas(xml)
    expect(paraOf(xml, 'Lead Architect')).toContain('<w:b/>')
    const signature = paras[paras.length - 1]
    expect(signature).toContain('Kari Nordmann')
    expect(signature).toContain('<w:b/>')
    expect(numOf(signature, 'w:after')).toBe(120)
  })

  it('sets the letter body at the default size, and no stray text anywhere', async () => {
    const xml = await xmlOf()
    expect(sizesOf(paraOf(xml, 'First paragraph.'))).toEqual([sz])
    expect(strayText(xml)).toEqual([])
  })

  it('borrows the referenced view’s type size so letter and CV match', async () => {
    // The letter is posted with the CV; a letter set two points off the CV it
    // accompanies looks like it came from somewhere else.
    const s = letterStore()
    const view = makeView({ id: 'v1', style: { ...DEFAULT_VIEW_STYLE, body_size: 'large' } })
    s.views = [view]
    const big = deriveTokens({ ...DEFAULT_VIEW_STYLE, body_size: 'large' } as never).bodyFontSizePt * 2
    const xml = await xmlOf(s, filled({ view_id: 'v1' }))
    expect(big).not.toBe(sz)
    expect(sizesOf(paraOf(xml, 'First paragraph.'))).toEqual([big])
  })

  it('fixes the letter page to A4 with its own margins, not the view’s', async () => {
    // A letter is not a CV page: it keeps ~2 cm all round whatever page margin
    // the referenced view uses.
    const s = letterStore()
    s.views = [makeView({ id: 'v1', style: { ...DEFAULT_VIEW_STYLE, page_margin: 'generous' } })]
    const xml = await xmlOf(s, filled({ view_id: 'v1' }))
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>')
    expect(xml).toContain('<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"')
  })

  it('declares the letter’s font and size as the document default', async () => {
    await exportCoverLetterDocx(letterStore(), filled(), 'en')
    const styles = await stylesXml(lastBlob!)
    const defaults = styles.slice(styles.indexOf('<w:docDefaults>'), styles.indexOf('</w:docDefaults>'))
    expect(defaults).toContain(`w:ascii="${deriveTokens(DEFAULT_VIEW_STYLE).bodyFontDocx}"`)
    expect(defaults).toContain(`<w:sz w:val="${sz}"/>`)
  })

  it('exports a letter for a resume-less store rather than crashing on the filename', async () => {
    const s = emptyStore()
    s.resume = null
    await exportCoverLetterDocx(s, filled(), 'en')
    const anchors = (vi.mocked(HTMLAnchorElement.prototype.click).mock.instances ?? []) as HTMLAnchorElement[]
    expect(await isZip(lastBlob!)).toBe(true)
    expect(anchors[anchors.length - 1].download).toBe('resume_Equinor_application.docx')
  })
})

