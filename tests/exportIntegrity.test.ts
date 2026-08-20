/**
 * @vitest-environment jsdom
 *
 * DOCX structural integrity — the failure class the other export tests can't see.
 *
 * `exporter.test.ts` asserts what the document SAYS (this heading, that date,
 * this escaped `<script>`), by reading `word/document.xml` as a string. A file
 * can pass every one of those assertions and still make Word open with
 * "unreadable content — do you want to recover?", because Word validates the
 * PACKAGE before it renders a word of it. Three things trigger that, none of
 * them visible in a string search:
 *
 *   1. A part that isn't well-formed XML.
 *   2. A relationship id referenced from document.xml with no matching entry in
 *      the .rels part — the classic dangling image reference.
 *   3. A part whose content type is undeclared in `[Content_Types].xml`.
 *
 * The e2e suite proves a real browser can produce and download a .docx; only
 * this can say the bytes are a valid OOXML package, across every section and
 * with images embedded. A green run here is not a substitute for opening one in
 * Word before a release — it is what makes that manual check a spot check
 * rather than the only line of defence.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { exportDocx, exportCoverLetterDocx } from '../src/lib/exporter'
import { buildViewSections } from '../src/lib/viewFilter'
import {
  emptyStore, makeResume, makeView, makeProject, makeWork, makeEducation,
  makeKQ, makeKeyCompetency, makeSkill, makeSkillCategory, makeReference,
  makeRecommendation, makeSpokenLanguage, makeCoverLetter, makeCourse,
  makeCertification, makePosition, makePresentation, makePublication, makeAward,
  makeRole, makeIndustry,
} from './fixtures'
import type { ResumeStore } from '../src/types'

// A real 1x1 PNG — valid bytes, so the exporter's image parser embeds it and
// the archive gains a media part with its own content type and relationship.
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='

let lastBlob: Blob | null = null

beforeEach(() => {
  lastBlob = null
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: (b: Blob) => { lastBlob = b; return 'blob:fake' },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: () => {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

type Archive = Record<string, Uint8Array>

async function archiveOf(blob: Blob): Promise<Archive> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()))
}

/** Parse a part as XML, returning the error text jsdom puts in `parsererror`. */
function xmlError(name: string, bytes: Uint8Array): string | null {
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  const err = doc.querySelector('parsererror')
  return err ? `${name}: ${err.textContent?.slice(0, 200) ?? 'malformed'}` : null
}

/**
 * The archive's real parts. A zip also carries directory entries (`word/`,
 * `_rels/`); those are not parts, have no content type, and would otherwise
 * read as violations.
 */
function partNames(files: Archive): string[] {
  return Object.keys(files).filter((n) => !n.endsWith('/'))
}

/** Every part that must parse as XML — the .xml parts plus the .rels parts. */
function xmlParts(files: Archive): string[] {
  return partNames(files).filter((n) => n.endsWith('.xml') || n.endsWith('.rels'))
}

/**
 * Relationship ids referenced from a part, as Word resolves them: `r:id` for
 * hyperlinks/headers, `r:embed` for images.
 */
function referencedRelIds(xml: string): string[] {
  return [...xml.matchAll(/r:(?:id|embed)="([^"]+)"/g)].map((m) => m[1])
}

/** Relationship ids DECLARED by a .rels part. */
function declaredRelIds(xml: string): Set<string> {
  return new Set([...xml.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]))
}

/**
 * Content types leave nothing uncovered: every part is matched either by an
 * Override naming it outright or by a Default for its extension.
 */
function partsMissingContentType(files: Archive): string[] {
  // Parsed, not regexed: the real part writes `ContentType` BEFORE `PartName`,
  // and an attribute-order assumption here reports the exporter as broken when
  // it is the test that is.
  const ct = new DOMParser().parseFromString(
    strFromU8(files['[Content_Types].xml'] ?? new Uint8Array()), 'application/xml',
  )
  const defaults = new Set(
    [...ct.getElementsByTagName('Default')]
      .map((el) => el.getAttribute('Extension')?.toLowerCase() ?? ''),
  )
  const overrides = new Set(
    [...ct.getElementsByTagName('Override')]
      .map((el) => (el.getAttribute('PartName') ?? '').replace(/^\//, '')),
  )
  return partNames(files).filter((name) => {
    if (name === '[Content_Types].xml') return false
    if (overrides.has(name)) return false
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    return !defaults.has(ext)
  })
}

/**
 * Every way this package would fail Word's pre-render validation, as a list —
 * so one run names all of them instead of stopping at the first.
 */
function ooxmlProblems(files: Archive): string[] {
  const problems: string[] = []

  for (const required of ['[Content_Types].xml', 'word/document.xml']) {
    if (!(required in files)) problems.push(`missing required part: ${required}`)
  }

  for (const name of xmlParts(files)) {
    const err = xmlError(name, files[name])
    if (err) problems.push(`malformed XML — ${err}`)
  }

  if (files['word/document.xml']) {
    const declared = declaredRelIds(
      strFromU8(files['word/_rels/document.xml.rels'] ?? new Uint8Array()),
    )
    for (const id of referencedRelIds(strFromU8(files['word/document.xml']))) {
      if (!declared.has(id)) problems.push(`dangling relationship: ${id}`)
    }
  }

  for (const name of partsMissingContentType(files)) {
    problems.push(`no content type declared: ${name}`)
  }

  return problems
}

function expectValidOoxml(files: Archive): void {
  expect(ooxmlProblems(files)).toEqual([])
}

/** A view with every exportable section on, at full detail. */
const fullView = () => makeView({ sections: buildViewSections() })

/** A store carrying at least one item in every section the catalog exports. */
function maximalStore(over: Partial<ResumeStore> = {}): ResumeStore {
  const cat = makeSkillCategory({ id: 'sc1', name: { en: 'Backend', no: 'Backend' } })
  const competency = makeKeyCompetency({ id: 'kc1', title: { en: 'Architecture' } })
  return {
    ...emptyStore(),
    resume: makeResume({ full_name: 'Kari Nordmann', supported_locales: ['en', 'no'] }),
    key_qualifications: [makeKQ({ id: 'kq1', competency_ids: ['kc1'] })],
    key_competencies: [competency],
    projects: [makeProject({ id: 'p1', customer: { en: 'Acme', no: 'Acme' } })],
    work_experiences: [makeWork({ id: 'w1' })],
    educations: [makeEducation({ id: 'e1' })],
    skills: [makeSkill({ id: 's1', name: { en: 'TypeScript' }, category_id: 'sc1' })],
    skill_categories: [cat],
    roles: [makeRole({ id: 'ro1' })],
    industries: [makeIndustry({ id: 'in1' })],
    courses: [makeCourse({ id: 'co1' })],
    certifications: [makeCertification({ id: 'ce1' })],
    positions: [makePosition({ id: 'po1' })],
    presentations: [makePresentation({ id: 'pr1' })],
    publications: [makePublication({ id: 'pu1' })],
    honor_awards: [makeAward({ id: 'ha1' })],
    references: [makeReference({ id: 'rf1' })],
    recommendations: [makeRecommendation({ id: 'rc1' })],
    spoken_languages: [makeSpokenLanguage({ id: 'sl1' })],
    ...over,
  }
}

describe('DOCX package integrity', () => {
  it('produces a valid OOXML package with every section enabled', async () => {
    await exportDocx(maximalStore(), fullView(), 'en')
    expect(lastBlob).not.toBeNull()
    expectValidOoxml(await archiveOf(lastBlob!))
  })

  it('stays valid with embedded images (media part, content type, relationship)', async () => {
    const store = maximalStore({
      resume: makeResume({
        full_name: 'Kari Nordmann',
        supported_locales: ['en', 'no'],
        profile_photo: PNG_1x1,
        company_logo: PNG_1x1,
      }),
    })
    // Both placements default to 'none', so a view has to ask for the images —
    // without this the package is valid but empty of media, and the integrity
    // checks below would be asserting nothing. 'square' keeps the shape-mask
    // path (canvas, absent in jsdom) out of it.
    const view = makeView({
      sections: buildViewSections(),
      header: { ...makeView().header, photo_placement: 'left', photo_shape: 'square', logo_placement: 'left' },
    })
    await exportDocx(store, view, 'en')
    const files = await archiveOf(lastBlob!)

    // The images really did land in the package — otherwise the checks below
    // would pass on a document that simply dropped them.
    const media = Object.keys(files).filter((n) => n.startsWith('word/media/'))
    expect(media.length).toBeGreaterThan(0)
    expectValidOoxml(files)
  })

  it('stays valid for a locale whose content is non-ASCII', async () => {
    // Norwegian text exercises the XML encoder on characters an ASCII-only
    // fixture never reaches — a mis-encoded byte here is a repair prompt.
    const store = maximalStore({
      resume: makeResume({ full_name: 'Øystein Ærlig Ångström', supported_locales: ['en', 'no'] }),
      projects: [makeProject({ id: 'p1', customer: { no: 'Bærum kommune — avdeling for økonomi' } })],
    })
    await exportDocx(store, fullView(), 'no')
    const files = await archiveOf(lastBlob!)
    expect(strFromU8(files['word/document.xml'])).toContain('Bærum')
    expectValidOoxml(files)
  })

  it('keeps the package valid when content carries XML metacharacters', async () => {
    // The escaping is asserted for correctness in exporter.test.ts; here the
    // point is that whatever escaping produces still parses as XML.
    const store = maximalStore({
      resume: makeResume({ full_name: 'A & B <script>alert("x")</script>' }),
      projects: [makeProject({ id: 'p1', customer: { en: '<b>Tag & "quote"</b>' } })],
    })
    await exportDocx(store, fullView(), 'en')
    expectValidOoxml(await archiveOf(lastBlob!))
  })

  it('produces a valid package for a cover letter', async () => {
    const store = maximalStore()
    const letter = makeCoverLetter({ id: 'cl1', name: 'Application' })
    await exportCoverLetterDocx(store, letter, 'en')
    expect(lastBlob).not.toBeNull()
    expectValidOoxml(await archiveOf(lastBlob!))
  })
})

/**
 * The checks above only mean something if they can fail. Each case takes a
 * REAL exported archive and breaks it the way a regression would, because a
 * validator asserted only against good input is indistinguishable from one
 * that returns the empty list unconditionally — which is what the first draft
 * of `partsMissingContentType` effectively did, in reverse: it reported eleven
 * healthy parts as untyped because it assumed the wrong attribute order.
 */
describe('the integrity checks have teeth', () => {
  async function validArchive(): Promise<Archive> {
    await exportDocx(maximalStore(), fullView(), 'en')
    return archiveOf(lastBlob!)
  }

  it('catches a part that is not well-formed XML', async () => {
    const files = await validArchive()
    files['word/styles.xml'] = new TextEncoder().encode('<w:styles><w:style></w:styles>')
    expect(ooxmlProblems(files).some((p) => p.startsWith('malformed XML'))).toBe(true)
  })

  it('catches a relationship id that nothing declares', async () => {
    const files = await validArchive()
    const doc = strFromU8(files['word/document.xml'])
      .replace('<w:body>', '<w:body><w:p><w:r><w:drawing r:embed="rIdNope"/></w:r></w:p>')
    files['word/document.xml'] = new TextEncoder().encode(doc)
    expect(ooxmlProblems(files)).toContain('dangling relationship: rIdNope')
  })

  it('catches a part with no declared content type', async () => {
    const files = await validArchive()
    files['word/media/image1.tiff'] = new Uint8Array([1, 2, 3])
    expect(ooxmlProblems(files)).toContain('no content type declared: word/media/image1.tiff')
  })

  it('catches a missing required part', async () => {
    const files = await validArchive()
    delete files['word/document.xml']
    expect(ooxmlProblems(files)).toContain('missing required part: word/document.xml')
  })
})
