/**
 * @vitest-environment jsdom
 *
 * THE PREVIEW IS THE EXPORT. One maximally-populated CV — every section, every
 * optional group switched on — rendered through all four adapters in all three
 * detail modes, asserting that no adapter says a word the others do not.
 *
 * `exportParity.test.ts` checks a list of facts someone thought to write down.
 * This checks the complement: that nothing ELSE differs either. It is what
 * found the two cases that list would have missed — an inline tag list
 * rendering unlabelled in the preview, and an all-empty item leaving a section
 * heading in the preview that no export had.
 *
 * Formatting devices may differ (a plain-text quote gets quotation marks, a
 * Markdown one gets '>'); the ALLOWED set below is the whole licence, and it is
 * deliberately tiny. Anything else failing here means a consultant could be
 * reading a preview that is not the document they will send.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildViewHtml } from '../src/lib/viewFilter'
import { buildViewText } from '../src/lib/viewText'
import { buildPdfDocDefinition } from '../src/lib/pdfExporter'
import { exportDocx } from '../src/lib/exporter'
import { unzipSync, strFromU8 } from 'fflate'
import { SECTION_EXTRAS } from '../src/lib/sectionExtras'
import {
  emptyStore, makeResume, makeProject, makeWork, makeEducation, makeCourse,
  makeCertification, makeKQ, makeKeyCompetency, makeRecommendation, makeSpokenLanguage,
  makePosition, makePresentation, makePublication, makeAward, makeReference,
  makeSkill, makeSkillCategory, makeView,
} from './fixtures'
import type { ResumeStore, ResumeView } from '../src/types'

function bigStore(): ResumeStore {
  const s = emptyStore()
  s.resume = makeResume({ full_name: 'Test Person', email: 'x@y.no', phone: '+47 900', linkedin_url: 'https://li/x' })
  s.key_qualifications = [makeKQ({
    id: 'kq1', tag_line: { en: 'Cloud architect' },
    summary: { en: '<p>Profile prose.</p>' }, summary_short: { en: 'Short profile.' },
    competency_ids: ['kc1'],
  })]
  s.key_competencies = [makeKeyCompetency({ id: 'kc1', title: { en: 'Architecture' }, description: { en: 'Designs systems' } })]
  s.skill_categories = [makeSkillCategory({ id: 'sc1', name: { en: 'Cloud' } })]
  s.skills = [makeSkill({ id: 'k1', name: { en: 'Kotlin' }, category_id: 'sc1', is_highlighted: true, proficiency: 4 })]
  s.projects = [makeProject({
    id: 'p1', customer: { en: 'Acme' }, description: { en: 'Payments platform' },
    long_description: { en: '<p>Rebuilt settlement.</p>' }, highlights: [{ en: 'Cut time 40%' }],
    team_size: 5, percent_allocated: 80, external_url: 'https://case.example',
    location_country_code: 'NO', start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    skills: [{ id: 'ps1', skill_id: 'k1', name: { en: 'Kotlin' }, duration_in_years: 2, offset_in_years: 0, total_duration_in_years: 2, sort_order: 0 }],
  }), makeProject({
    id: 'p2', customer: { en: 'Zenith' }, description: { en: 'Data mesh' },
    long_description: { en: '<p>Built the mesh.</p>' }, skills: [], roles: [], industries: [],
    start: { year: 2023, month: 1 }, end: null, sort_order: 1,
  })]
  s.work_experiences = [makeWork({
    id: 'w1', employer: { en: 'Cartavio' }, role_title: { en: 'Principal' },
    long_description: { en: '<p>Led delivery.</p>' }, employment_type: 'permanent',
    company_size_local: '~50', company_size_global: '40,000', company_url: 'https://cartavio.no',
  })]
  s.educations = [makeEducation({ id: 'e1', school: { en: 'NTNU' }, degree: { en: 'MSc' }, grade: 'A', exchange: true })]
  s.courses = [makeCourse({ id: 'co1', name: { en: 'Kubernetes' }, program: { en: 'CNCF' } })]
  s.certifications = [makeCertification({
    id: 'c1', name: { en: 'AWS SA' }, organiser: { en: 'Amazon' },
    issued: { year: 2024, month: 1 }, expires: { year: 2027, month: 1 }, credential_url: 'https://verify.example',
  })]
  s.positions = [makePosition({ id: 'po1', name: { en: 'Board member' }, organisation: { en: 'Forum' } })]
  s.presentations = [makePresentation({ id: 'pr1', title: { en: 'A talk' }, event: { en: 'Testfest' }, url: 'https://talk.example' })]
  s.publications = [makePublication({ id: 'pu1', title: { en: 'A paper' }, publisher: { en: 'ACM' }, url: 'https://doi.example' })]
  s.honor_awards = [makeAward({ id: 'a1', name: { en: 'Best paper' }, issuer: { en: 'ACM' }, for_work: { en: 'Phoenix migration' } })]
  s.recommendations = [makeRecommendation({
    id: 'r1', recommender_name: 'Ada', recommender_title: { en: 'CTO' }, recommender_company: 'Acme',
    relationship: { en: 'Manager' }, text: { en: '<p>Great work.</p>' }, contact_url: 'https://rec.example',
  })]
  s.references = [makeReference({
    id: 'rf1', name: 'Kari', title: 'CTO', company: 'BigCo', include_in_exports: true,
    relationship: { en: 'Former manager' }, email: 'kari@x.no', phone: '+47 999', linkedin_url: 'https://li/kari',
  })]
  s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: { en: 'Native' } })]
  return s
}

const ALL_SECTIONS = [
  'key_qualifications', 'key_competencies', 'projects', 'work_experiences', 'educations',
  'courses', 'certifications', 'positions', 'presentations', 'publications',
  'honor_awards', 'recommendations', 'references', 'spoken_languages', 'technology_categories',
]

function bigView(detail: 'full' | 'summary' = 'full', tabulate = false): ResumeView {
  return makeView({
    sections: ALL_SECTIONS.map((key, i) => ({
      key, detail, sort_order: i,
      style: {
        extras: (SECTION_EXTRAS[key] ?? []).map((g) => g.key),
        ...(tabulate ? { tabulate: true } : {}),
      },
    })),
  }) as ResumeView
}

/** Only real TEXT nodes — walking every value drags in colours and font names. */
function pdfText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') { if (node) out.push(node); return out }
  if (Array.isArray(node)) { for (const n of node) pdfText(n, out); return out }
  if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>
    if ('text' in rec) pdfText(rec.text, out)
    for (const k of ['content', 'stack', 'columns', 'table', 'body', 'ul', 'ol']) {
      if (k in rec) pdfText(rec[k], out)
    }
  }
  return out
}

let lastBlob: Blob | null = null

/**
 * The words a reader would see, lower-cased and stripped of separators — so a
 * heading upper-cased in one target and title-cased in another is not mistaken
 * for a missing fact. Short tokens go: they are punctuation debris.
 */
function words(text: string): Set<string> {
  return new Set(
    text
      .replace(/\s+/g, ' ')
      .split(/[\s|·—–,;:()[\]]+/)
      .map((w) => w.replace(/^[#*>_`-]+|[#*>_`-]+$/g, '').trim().toLowerCase())
      .filter((w) => w.length > 2),
  )
}

/**
 * Words allowed in one adapter and not another. Each is a formatting device
 * with no meaning of its own — never a fact.
 */
const ALLOWED = new Set([
  // A recommendation is a quote: plain text wraps it in quotation marks, so its
  // first and last words carry one. Markdown and the paged targets do not.
  'great', 'work.', '"great', 'work."',
])

async function renderAll(store: ResumeStore, view: ResumeView): Promise<Record<string, string>> {
  // <head> holds the document title and the CSP — neither is page content.
  const html = buildViewHtml(store, view, 'en')
    .replace(/<head[\s\S]*?<\/head>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
  const dd = await buildPdfDocDefinition(store, view, 'en')
  lastBlob = null
  await exportDocx(store, view, 'en')
  const docx = strFromU8(unzipSync(new Uint8Array(await lastBlob!.arrayBuffer()))['word/document.xml'])
    .replace(/<[^>]+>/g, ' ')
  return {
    'HTML preview': html,
    'ATS text': buildViewText(store, view, 'en', 'text'),
    Markdown: buildViewText(store, view, 'en', 'markdown'),
    PDF: pdfText(dd.content).join('\n'),
    DOCX: docx,
  }
}

describe('preview parity — the preview says exactly what the exports say', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob) => { lastBlob = b; return 'blob:x' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it.each([
    ['full', 'full', false],
    ['summary', 'summary', false],
    ['tabulated', 'summary', true],
  ] as const)('agrees across every adapter in %s mode', async (_label, detail, tabulate) => {
    const out = await renderAll(bigStore(), bigView(detail, tabulate))
    const all = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, words(v)]))
    const names = Object.keys(all)
    for (const a of names) {
      for (const b of names) {
        if (a >= b) continue
        expect([...all[a]].filter((w) => !all[b].has(w) && !ALLOWED.has(w)),
          `${a} says what ${b} does not`).toEqual([])
        expect([...all[b]].filter((w) => !all[a].has(w) && !ALLOWED.has(w)),
          `${b} says what ${a} does not`).toEqual([])
      }
    }
  })

  it('lists items in the same order everywhere', async () => {
    // Order is content: a reader takes the first project as the headline one.
    const out = await renderAll(bigStore(), bigView())
    for (const [adapter, text] of Object.entries(out)) {
      const seen = ['Acme', 'Zenith']
        .map((n) => [n, text.indexOf(n)] as const)
        .filter(([, i]) => i >= 0)
        .sort((x, y) => x[1] - y[1])
        .map(([n]) => n)
      expect(seen, `${adapter} orders projects differently`).toEqual(['Acme', 'Zenith'])
    }
  })

  it('drops a section from the preview when the exports drop it', async () => {
    // A profile with no short summary renders nothing in Summary mode. The
    // preview used to keep the heading with a blank under it, advertising a
    // section the PDF did not have.
    const store = bigStore()
    store.key_qualifications[0].summary_short = {}
    const out = await renderAll(store, bigView('summary'))
    for (const [adapter, text] of Object.entries(out)) {
      expect(text.toLowerCase(), `${adapter} kept an empty profile section`)
        .not.toContain('professional summary')
    }
  })
})
