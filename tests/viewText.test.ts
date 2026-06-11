/**
 * @vitest-environment jsdom
 */
// jsdom: the rich-text flattening goes through lib/richText's DOMParser.
import { describe, it, expect } from 'vitest'
import { buildViewText, buildViewMarkdown } from '../src/lib/viewText'
import { buildViewSections } from '../src/lib/viewFilter'
import {
  emptyStore, makeProject, makeWork, makeReference, makeRecommendation,
  makeSpokenLanguage, makeView, makeKQ,
} from './fixtures'

function sampleStore() {
  const store = emptyStore()
  store.projects.push(makeProject({
    id: 'p1',
    customer: { en: 'AcmeCo' },
    industry: { en: 'Finance' },
    long_description: { en: '<p>Built the <b>platform</b></p><ul><li>Led the team</li></ul>' },
    start: { year: 2022, month: 3 }, end: null,
    skills: [
      { id: 's1', skill_id: '', name: { en: 'TypeScript' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
    ],
  }))
  store.work_experiences.push(makeWork({ id: 'w1', employer: { en: 'Cartavio' }, role_title: { en: 'Engineer' } }))
  store.spoken_languages.push(makeSpokenLanguage({ name: { en: 'Norwegian' }, level: { en: 'Native' } }))
  return store
}

describe('buildViewText', () => {
  it('emits identity, uppercase section headings and item content', () => {
    const txt = buildViewText(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(txt).toContain('TEST PERSON')       // full name uppercased
    expect(txt).toContain('Consultant')        // title
    expect(txt).toContain('PROJECTS')          // section heading
    expect(txt).toContain('AcmeCo')
    expect(txt).toContain('Mar 2022 – Present')
    expect(txt).toContain('Finance')
  })

  it('flattens rich text into plain lines with dash bullets', () => {
    const txt = buildViewText(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(txt).toContain('Built the platform')
    expect(txt).toContain('- Led the team')
    expect(txt).not.toContain('<b>')
    expect(txt).not.toContain('<p>')
  })

  it('contains no HTML tags at all', () => {
    const txt = buildViewText(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(txt).not.toMatch(/<[a-z][^>]*>/i)
  })

  it('renders summary sections as one-line dashes', () => {
    const sections = buildViewSections().map((s) =>
      s.key === 'projects' ? { ...s, detail: 'summary' as const } : s,
    )
    const txt = buildViewText(sampleStore(), makeView({ sections }), 'en')
    expect(txt).toMatch(/- AcmeCo — .*Mar 2022/)
  })

  it('respects exclusions and off sections', () => {
    const sections = buildViewSections().map((s) =>
      s.key === 'work_experiences' ? { ...s, detail: 'off' as const } : s,
    )
    const txt = buildViewText(sampleStore(), makeView({ sections, excluded_item_ids: ['p1'] }), 'en')
    expect(txt).not.toContain('AcmeCo')
    expect(txt).not.toContain('Cartavio')
  })

  it('renders the introduction and the view-wide anonymization', () => {
    const store = sampleStore()
    store.projects[0].customer_anonymized = { en: 'BigBankAlias' }
    const view = makeView({
      sections: buildViewSections(),
      introduction: { en: 'Tailored pitch' },
      force_anonymized: true,
    })
    const txt = buildViewText(store, view, 'en')
    expect(txt).toContain('Tailored pitch')
    expect(txt).toContain('BigBankAlias')
    expect(txt).not.toContain('AcmeCo')
  })

  it('renders inline languages and quote recommendations', () => {
    const store = sampleStore()
    store.recommendations.push(makeRecommendation({
      recommender_name: 'Jane Boss', text: { en: 'Excellent work' },
    }))
    const txt = buildViewText(store, makeView({ sections: buildViewSections() }), 'en')
    expect(txt).toContain('Norwegian — Native')
    expect(txt).toContain('"Excellent work"')
    expect(txt).toContain('— Jane Boss')
  })

  it('skips references not marked for export', () => {
    const store = sampleStore()
    store.references.push(makeReference({ name: 'PrivatePerson', include_in_exports: false }))
    const txt = buildViewText(store, makeView({ sections: buildViewSections() }), 'en')
    expect(txt).not.toContain('PrivatePerson')
  })

  it('returns empty string without a resume', () => {
    const store = sampleStore()
    store.resume = null
    expect(buildViewText(store, makeView(), 'en')).toBe('')
  })
})

describe('buildViewMarkdown', () => {
  it('uses markdown headings and emphasis', () => {
    const md = buildViewMarkdown(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('# Test Person')
    expect(md).toContain('## Projects')
    expect(md).toContain('### AcmeCo')
    expect(md).toMatch(/\*.*Mar 2022 – Present.*\*/)
  })

  it('keeps bold runs from rich text', () => {
    const md = buildViewMarkdown(sampleStore(), makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('**platform**')
    expect(md).toContain('- Led the team')
  })

  it('quotes recommendations with > blocks', () => {
    const store = sampleStore()
    store.recommendations.push(makeRecommendation({
      recommender_name: 'Jane Boss', text: { en: 'Excellent work' },
    }))
    const md = buildViewMarkdown(store, makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('> Excellent work')
  })

  it('bolds summary titles', () => {
    const sections = buildViewSections().map((s) =>
      s.key === 'projects' ? { ...s, detail: 'summary' as const } : s,
    )
    const md = buildViewMarkdown(sampleStore(), makeView({ sections }), 'en')
    expect(md).toContain('- **AcmeCo**')
  })

  it('renders key qualification points as labelled bullets', () => {
    const store = sampleStore()
    store.key_qualifications.push(makeKQ({
      label: { en: 'Senior Profile' },
      key_points: [
        { id: 'k1', name: { en: 'Leadership' }, long_description: { en: 'Led teams of 10+' }, sort_order: 0 },
      ] as never,
    }))
    const md = buildViewMarkdown(store, makeView({ sections: buildViewSections() }), 'en')
    expect(md).toContain('### Senior Profile')
    expect(md).toContain('- **Leadership**: Led teams of 10+')
  })
})
