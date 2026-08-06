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
} from './fixtures'
import { withHeaderDefaults, withFooterDefaults } from '../src/lib/viewHeader'
import { DEFAULT_VIEW_STYLE, deriveTokens } from '../src/lib/viewStyle'
import type { ResumeStore } from '../src/types'

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
