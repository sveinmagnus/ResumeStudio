/**
 * @vitest-environment jsdom
 */
// jsdom: richToPlain parses rich-text values via DOMParser (same dependency as
// lib/richText and the Europass exporter suite).
import { describe, it, expect } from 'vitest'
import { buildJsonResume, JSON_RESUME_SCHEMA } from '../src/lib/exporterJsonResume'
import { importFromJsonResume, isJsonResumeFormat } from '../src/lib/importerJsonResume'
import {
  emptyStore, makeResume, makeView, makeKQ, makeWork, makeProject,
  makeProjectSkill, makeProjectRole, makeEducation, makeSkill,
  makeSpokenLanguage, makePosition, makeRecommendation, makeAward,
  makeCertification, makePublication,
} from './fixtures'
import type { ResumeStore } from '../src/types'

type Json = Record<string, unknown>

const basicsOf = (doc: Json): Json => (doc.basics ?? {}) as Json
const rows = (doc: Json, key: string): Json[] => (doc[key] ?? []) as Json[]

function seeded(over: Partial<ResumeStore> = {}): ResumeStore {
  return { ...emptyStore(), ...over }
}

// ─── Envelope + basics ────────────────────────────────────────────────────────

describe('buildJsonResume — envelope and basics', () => {
  it('stamps the v1.0.0 schema', () => {
    const doc = buildJsonResume(seeded(), makeView(), 'en')
    expect(doc.$schema).toBe(JSON_RESUME_SCHEMA)
    expect(JSON_RESUME_SCHEMA).toContain('jsonresume')
  })

  it('emits identity, contact and profiles', () => {
    const store = seeded({
      resume: makeResume({
        phone: '+47 900 00 000',
        website_url: 'https://site.example',
        linkedin_url: 'https://linkedin.com/in/tp',
        twitter: 'tp_handle',
        place_of_residence: { en: 'Oslo' },
      }),
    })
    const basics = basicsOf(buildJsonResume(store, makeView(), 'en'))
    expect(basics.name).toBe('Test Person')
    expect(basics.email).toBe('test@example.com')
    expect(basics.phone).toBe('+47 900 00 000')
    expect(basics.url).toBe('https://site.example')
    expect(basics.location).toEqual({ city: 'Oslo' })
    expect(basics.profiles).toEqual([
      { network: 'LinkedIn', url: 'https://linkedin.com/in/tp' },
      { network: 'Twitter', username: 'tp_handle' },
    ])
  })

  it('emits a twitter URL as url, a bare handle as username', () => {
    const withTwitter = (twitter: string) => basicsOf(buildJsonResume(
      seeded({ resume: makeResume({ twitter }) }), makeView(), 'en',
    )).profiles as Json[]
    expect(withTwitter('https://x.com/tp')[0]).toEqual({ network: 'Twitter', url: 'https://x.com/tp' })
    expect(withTwitter('tp')[0]).toEqual({ network: 'Twitter', username: 'tp' })
  })

  it('omits empty fields instead of emitting blanks', () => {
    // makeResume has no phone/urls/place, and there is no profile → the basics
    // block holds exactly the three values that exist and nothing else.
    const doc = buildJsonResume(seeded(), makeView(), 'en')
    expect(doc.basics).toEqual({
      name: 'Test Person', label: 'Consultant', email: 'test@example.com',
    })
  })

  it('resolves the label like every header path: override, tag line, master title', () => {
    const store = seeded({
      key_qualifications: [makeKQ({ tag_line: { en: 'Cloud Architect' } })],
    })
    // No override → the selected profile's tag line.
    expect(basicsOf(buildJsonResume(store, makeView(), 'en')).label).toBe('Cloud Architect')
    // An explicit override wins.
    const overridden = makeView()
    overridden.header.title_override = { en: 'Board Member' }
    expect(basicsOf(buildJsonResume(store, overridden, 'en')).label).toBe('Board Member')
    // No profile, no override → the resume's master title.
    expect(basicsOf(buildJsonResume(seeded(), makeView(), 'en')).label).toBe('Consultant')
  })

  it('takes the summary from the presented profile, flattened to plain text', () => {
    const store = seeded({
      key_qualifications: [makeKQ({ summary: { en: '<p>Line one</p><p>Line two</p>' } })],
    })
    const summary = basicsOf(buildJsonResume(store, makeView(), 'en')).summary as string
    expect(summary).toContain('Line one')
    expect(summary).toContain('Line two')
    expect(summary).not.toContain('<p>')
  })

  it('drops the summary when the profile section is off, but keeps the tag-line label', () => {
    const store = seeded({
      key_qualifications: [makeKQ({ tag_line: { en: 'Cloud Architect' }, summary: { en: 'Hello.' } })],
    })
    const view = makeView({ sections: [{ key: 'key_qualifications', detail: 'off', sort_order: 0 }] })
    const basics = basicsOf(buildJsonResume(store, view, 'en'))
    expect(basics.summary).toBeUndefined()
    expect(basics.label).toBe('Cloud Architect')
  })
})

// ─── Sections ─────────────────────────────────────────────────────────────────

describe('buildJsonResume — sections', () => {
  it('maps work with ISO dates, and an ongoing job has no endDate', () => {
    const store = seeded({
      work_experiences: [
        makeWork({ start: { year: 2020, month: 1 }, end: null, company_url: 'https://bigco.example' }),
        makeWork({ employer: { en: 'OldCo' }, start: { year: 2015, month: null }, end: { year: 2019, month: 6 } }),
      ],
    })
    const work = rows(buildJsonResume(store, makeView(), 'en'), 'work')
    expect(work[0]).toMatchObject({ name: 'BigCo', position: 'Engineer', url: 'https://bigco.example', startDate: '2020-01' })
    expect('endDate' in work[0]).toBe(false)
    expect(work[1]).toMatchObject({ name: 'OldCo', startDate: '2015', endDate: '2019-06' })
  })

  it('falls back from the long description to the short one for the summary', () => {
    const store = seeded({
      work_experiences: [makeWork({ description: { en: 'Short only.' }, long_description: {} })],
    })
    expect(rows(buildJsonResume(store, makeView(), 'en'), 'work')[0].summary).toBe('Short only.')
  })

  it('maps projects with keywords, roles and highlights', () => {
    const store = seeded({
      projects: [makeProject({
        highlights: [{ en: 'Zero-downtime cutover' }],
        skills: [makeProjectSkill({ name: { en: 'TypeScript' } })],
        roles: [
          makeProjectRole({ name: { en: 'Developer' } }),
          makeProjectRole({ name: { en: 'Hidden role' }, disabled: true }),
        ],
        external_url: 'https://platform.example',
      })],
    })
    const p = rows(buildJsonResume(store, makeView(), 'en'), 'projects')[0]
    expect(p).toMatchObject({
      name: 'Short desc',
      description: 'Long desc',
      entity: 'Acme',
      keywords: ['TypeScript'],
      roles: ['Developer'],
      highlights: ['Zero-downtime cutover'],
      url: 'https://platform.example',
      startDate: '2022-01',
      endDate: '2023-06',
    })
  })

  it('maps volunteer, education, awards, certificates and publications', () => {
    const store = seeded({
      positions: [makePosition({ description: { en: 'Chairing meetings.' }, start: { year: 2020, month: null } })],
      educations: [makeEducation({ grade: 'A' })],
      honor_awards: [makeAward({ description: { en: 'Best in show.' }, date: { year: 2018, month: 11 } })],
      certifications: [makeCertification({ organiser: { en: 'CNCF' }, issued: { year: 2021, month: 4 }, credential_url: 'https://c.example' })],
      publications: [makePublication({ abstract: { en: 'A paper.' }, url: 'https://doi.example/1', date: { year: 2020, month: 2 } })],
    })
    const doc = buildJsonResume(store, makeView(), 'en')
    expect(rows(doc, 'volunteer')[0]).toMatchObject({
      organization: 'Org', position: 'Board Member', summary: 'Chairing meetings.', startDate: '2020',
    })
    expect(rows(doc, 'education')[0]).toMatchObject({
      institution: 'University', studyType: 'BSc', score: 'A', startDate: '2015-08', endDate: '2018-05',
    })
    expect(rows(doc, 'awards')[0]).toMatchObject({
      title: 'Hackathon Win', awarder: 'TechCo', summary: 'Best in show.', date: '2018-11',
    })
    expect(rows(doc, 'certificates')[0]).toMatchObject({
      name: 'A Cert', issuer: 'CNCF', date: '2021-04', url: 'https://c.example',
    })
    expect(rows(doc, 'publications')[0]).toMatchObject({
      name: 'A Paper', publisher: 'ACM', summary: 'A paper.', releaseDate: '2020-02', url: 'https://doi.example/1',
    })
  })

  // The skills contract changed deliberately: the raw registry no longer ships.
  // Skills follow the VIEW's skill sections — the Skills Showcase contributes
  // its category groups, the Skill Matrix its rows — exactly what the paged
  // exports show for the same view.
  it('maps proficiency onto the level scale via the skill matrix, omitting an unstated one', () => {
    const store = seeded({
      skills: [
        makeSkill({ name: { en: 'K8s' }, proficiency: 5 }),
        makeSkill({ name: { en: 'Terraform' }, proficiency: 4 }),
        makeSkill({ name: { en: 'Go' }, proficiency: 3 }),
        makeSkill({ name: { en: 'Rust' }, proficiency: 2 }),
        makeSkill({ name: { en: 'Elm' }, proficiency: 1 }),
        makeSkill({ name: { en: 'Docker' }, proficiency: 0 }),
      ],
    })
    const view = makeView({ sections: [{ key: 'skill_matrix', detail: 'full', sort_order: 0 }] })
    // The matrix's own order (highlighted, then years, then name) — here all
    // equal on the first two, so alphabetical, matching the in-app table.
    expect(rows(buildJsonResume(store, view, 'en'), 'skills')).toEqual([
      { name: 'Docker' },
      { name: 'Elm', level: 'Beginner' },
      { name: 'Go', level: 'Intermediate' },
      { name: 'K8s', level: 'Master' },
      { name: 'Rust', level: 'Beginner' },
      { name: 'Terraform', level: 'Advanced' },
    ])
  })

  it('emits the Skills Showcase as category groups with keywords', () => {
    const store = seeded({
      skills: [
        makeSkill({ name: { en: 'React' }, is_highlighted: true, category_id: 'cat-fe' }),
        makeSkill({ name: { en: 'CSS' }, is_highlighted: true, category_id: 'cat-fe' }),
        // Not highlighted → not in the showcase, and the matrix is off.
        makeSkill({ name: { en: 'Go' }, category_id: 'cat-fe' }),
      ],
      skill_categories: [{ id: 'cat-fe', resume_id: 'resume-1', name: { en: 'Frontend' }, sort_order: 0 }],
    })
    expect(rows(buildJsonResume(store, makeView(), 'en'), 'skills')).toEqual([
      { name: 'Frontend', keywords: ['CSS', 'React'] },
    ])
  })

  it('ships no skills at all when the view shows no skills section', () => {
    const store = seeded({
      skills: [makeSkill({ name: { en: 'React' }, is_highlighted: true, category_id: 'cat-fe' })],
      skill_categories: [{ id: 'cat-fe', resume_id: 'resume-1', name: { en: 'Frontend' }, sort_order: 0 }],
    })
    const view = makeView({
      sections: [{ key: 'technology_categories', detail: 'off', sort_order: 0 }],
    })
    expect(buildJsonResume(store, view, 'en')).not.toHaveProperty('skills')
  })

  it('never repeats a showcase skill as a matrix row', () => {
    const store = seeded({
      skills: [
        makeSkill({ name: { en: 'React' }, is_highlighted: true, category_id: 'cat-fe', proficiency: 5 }),
        makeSkill({ name: { en: 'Go' }, proficiency: 3 }),
      ],
      skill_categories: [{ id: 'cat-fe', resume_id: 'resume-1', name: { en: 'Frontend' }, sort_order: 0 }],
    })
    const view = makeView({ sections: [{ key: 'skill_matrix', detail: 'full', sort_order: 0 }] })
    expect(rows(buildJsonResume(store, view, 'en'), 'skills')).toEqual([
      { name: 'Frontend', keywords: ['React'] },
      { name: 'Go', level: 'Intermediate' },
    ])
  })

  it('maps languages, and applyView drops a disabled one', () => {
    const store = seeded({
      spoken_languages: [
        makeSpokenLanguage(),
        makeSpokenLanguage({ name: { en: 'Klingon' }, disabled: true }),
      ],
    })
    expect(rows(buildJsonResume(store, makeView(), 'en'), 'languages'))
      .toEqual([{ language: 'English', fluency: 'Native' }])
  })

  it('maps recommendations to references — the mirror of the import rule', () => {
    const store = seeded({ recommendations: [makeRecommendation()] })
    expect(rows(buildJsonResume(store, makeView(), 'en'), 'references'))
      .toEqual([{ name: 'Jane Colleague', reference: 'A pleasure to work with.' }])
  })

  it('omits empty sections entirely instead of emitting empty arrays', () => {
    const doc = buildJsonResume(seeded(), makeView(), 'en')
    for (const key of ['work', 'volunteer', 'education', 'awards', 'certificates',
      'publications', 'skills', 'languages', 'projects', 'references']) {
      expect(key in doc, key).toBe(false)
    }
  })
})

// ─── The view is honoured ─────────────────────────────────────────────────────

describe('buildJsonResume — view filtering', () => {
  it('respects excluded_item_ids', () => {
    const keep = makeProject({ description: { en: 'Kept' } })
    const drop = makeProject({ description: { en: 'Dropped' } })
    const store = seeded({ projects: [keep, drop] })
    const view = makeView({ excluded_item_ids: [drop.id] })
    const projects = rows(buildJsonResume(store, view, 'en'), 'projects')
    expect(projects.map((p) => p.name)).toEqual(['Kept'])
  })

  it('respects a section switched off', () => {
    const store = seeded({ work_experiences: [makeWork()] })
    const view = makeView({ sections: [{ key: 'work_experiences', detail: 'off', sort_order: 0 }] })
    expect('work' in buildJsonResume(store, view, 'en')).toBe(false)
  })

  it('respects disabled items and starred_only', () => {
    const store = seeded({
      projects: [
        makeProject({ description: { en: 'Starred' }, starred: true }),
        makeProject({ description: { en: 'Unstarred' } }),
        makeProject({ description: { en: 'Disabled' }, disabled: true }),
      ],
    })
    const view = makeView({ starred_only: true })
    expect(rows(buildJsonResume(store, view, 'en'), 'projects').map((p) => p.name))
      .toEqual(['Starred'])
  })
})

// ─── Anonymization (SECURITY) ─────────────────────────────────────────────────

describe('buildJsonResume — anonymization never leaks the customer', () => {
  it('a force-anonymized view emits the alias and the real name appears NOWHERE', () => {
    const store = seeded({
      projects: [
        makeProject({
          customer: { en: 'SecretCorp' },
          customer_anonymized: { en: 'Large retailer' },
          description: { en: 'Checkout revamp' },
        }),
        // No alias at all — must degrade to the headline, never fall back.
        makeProject({
          customer: { en: 'HushCo' },
          customer_anonymized: {},
          description: { en: 'Data platform' },
        }),
      ],
    })
    const doc = buildJsonResume(store, makeView({ force_anonymized: true }), 'en')
    const text = JSON.stringify(doc)
    expect(text).not.toContain('SecretCorp')
    expect(text).not.toContain('HushCo')
    const projects = rows(doc, 'projects')
    expect(projects[0].entity).toBe('Large retailer')
    expect(projects[1].entity).toBeUndefined()
    expect(projects[1].name).toBe('Data platform')
  })

  it('a per-project use_anonymized flag holds without the view-wide switch', () => {
    const store = seeded({
      projects: [makeProject({
        use_anonymized: true,
        customer: { en: 'RealClient' },
        customer_anonymized: { en: 'A bank' },
      })],
    })
    const doc = buildJsonResume(store, makeView(), 'en')
    expect(JSON.stringify(doc)).not.toContain('RealClient')
    expect(rows(doc, 'projects')[0].entity).toBe('A bank')
  })
})

// ─── Round trip ───────────────────────────────────────────────────────────────

describe('JSON Resume round trip', () => {
  it('the export is claimed by our own detector', () => {
    const doc = buildJsonResume(seeded(), makeView(), 'en')
    expect(isJsonResumeFormat(doc)).toBe(true)
  })

  it('core content survives export → re-import', () => {
    const store = seeded({
      resume: makeResume({ phone: '+47 900 00 000', linkedin_url: 'https://linkedin.com/in/tp' }),
      key_qualifications: [makeKQ({ tag_line: { en: 'Platform Architect' }, summary: { en: 'Builds platforms.' } })],
      work_experiences: [makeWork({ long_description: { en: 'Ran the team.' } })],
      projects: [makeProject({
        skills: [makeProjectSkill({ name: { en: 'TypeScript' } })],
        roles: [makeProjectRole({ name: { en: 'Tech Lead' } })],
      })],
      educations: [makeEducation()],
      spoken_languages: [makeSpokenLanguage()],
      skills: [makeSkill({ name: { en: 'TypeScript' }, proficiency: 4 })],
    })
    // The matrix is what carries per-skill levels since the registry stopped
    // shipping wholesale — turn it on so the round trip covers proficiency.
    const view = makeView({ sections: [{ key: 'skill_matrix', detail: 'full', sort_order: 0 }] })
    const back = importFromJsonResume(buildJsonResume(store, view, 'en'))

    expect(back.resume?.full_name).toBe('Test Person')
    expect(back.resume?.email).toBe('test@example.com')
    expect(back.resume?.phone).toBe('+47 900 00 000')
    expect(back.resume?.linkedin_url).toBe('https://linkedin.com/in/tp')
    // The exported label was the tag line; it lands as the imported title.
    expect(back.resume?.title).toEqual({ en: 'Platform Architect' })
    expect(back.key_qualifications[0].summary).toEqual({ en: 'Builds platforms.' })

    expect(back.work_experiences[0].employer).toEqual({ en: 'BigCo' })
    expect(back.work_experiences[0].role_title).toEqual({ en: 'Engineer' })
    expect(back.work_experiences[0].start).toEqual({ year: 2020, month: 1 })
    expect(back.work_experiences[0].end).toBeNull()

    expect(back.projects[0].customer).toEqual({ en: 'Acme' })
    expect(back.projects[0].description).toEqual({ en: 'Short desc' })
    expect(back.roles.map((r) => r.name.en)).toEqual(['Tech Lead'])

    // The registry skill and the project keyword re-intern to ONE skill, and
    // the exported 'Advanced' level maps back to proficiency 4.
    const ts = back.skills.filter((s) => s.name.en === 'TypeScript')
    expect(ts).toHaveLength(1)
    expect(ts[0].proficiency).toBe(4)
    expect(back.projects[0].skills[0].skill_id).toBe(ts[0].id)

    expect(back.educations[0].school).toEqual({ en: 'University' })
    expect(back.educations[0].degree).toEqual({ en: 'BSc' })
    expect(back.spoken_languages[0].name).toEqual({ en: 'English' })
  })
})

// ─── Mutation-audit tripwires ────────────────────────────────────────────────
// Each case kills a mutant the first Stryker pass reported surviving.

describe('buildJsonResume — boundaries and filters (mutation audit)', () => {
  it('honours a per-section sort override, like every other export path', () => {
    const store = seeded({
      work_experiences: [
        makeWork({ id: 'new', employer: { en: 'Newest' }, start: { year: 2024, month: 1 }, sort_order: 0 }),
        makeWork({ id: 'old', employer: { en: 'Oldest' }, start: { year: 2010, month: 1 }, sort_order: 1 }),
      ],
    })
    const custom = rows(buildJsonResume(store, makeView(), 'en'), 'work').map((w) => w.name)
    expect(custom).toEqual(['Newest', 'Oldest'])
    const byStart = rows(buildJsonResume(store, makeView({
      sections: [{ key: 'work_experiences', detail: 'full', sort_order: 0, sort: 'start_asc' }],
    }), 'en'), 'work').map((w) => w.name)
    expect(byStart).toEqual(['Oldest', 'Newest'])
  })

  it('resolves each skill section detail by ITS key, not the first stored section', () => {
    const store = seeded({
      skills: [
        makeSkill({ name: { en: 'React' }, is_highlighted: true, category_id: 'cat-fe' }),
        makeSkill({ name: { en: 'Go' }, proficiency: 3 }),
      ],
      skill_categories: [{ id: 'cat-fe', resume_id: 'resume-1', name: { en: 'Frontend' }, sort_order: 0 }],
    })
    const view = makeView({
      sections: [
        { key: 'technology_categories', detail: 'off', sort_order: 0 },
        { key: 'skill_matrix', detail: 'full', sort_order: 1 },
      ],
    })
    // Showcase off, matrix on: only matrix rows (highlighted first, per the
    // matrix's own order), no category group.
    expect(rows(buildJsonResume(store, view, 'en'), 'skills')).toEqual([
      { name: 'React' },
      { name: 'Go', level: 'Intermediate' },
    ])
  })

  it('a summary-detail matrix ships highlighted skills only', () => {
    const store = seeded({
      skills: [
        makeSkill({ name: { en: 'Starred' }, is_highlighted: true, proficiency: 4 }),
        makeSkill({ name: { en: 'Plain' }, proficiency: 4 }),
      ],
    })
    const view = makeView({ sections: [{ key: 'skill_matrix', detail: 'summary', sort_order: 0 }] })
    expect(rows(buildJsonResume(store, view, 'en'), 'skills')).toEqual([
      { name: 'Starred', level: 'Advanced' },
    ])
  })

  it('a plain-http twitter link is still a URL, not a username', () => {
    const store = seeded({ resume: makeResume({ twitter: 'http://x.com/tp' }) })
    expect((basicsOf(buildJsonResume(store, makeView(), 'en')).profiles as Json[])[0])
      .toEqual({ network: 'Twitter', url: 'http://x.com/tp' })
  })

  it('omits basics entirely when the resume carries nothing', () => {
    const store = seeded({
      resume: makeResume({
        full_name: '', email: '', phone: null, title: {}, website_url: null,
        place_of_residence: {}, linkedin_url: null, twitter: null,
      }),
    })
    expect(buildJsonResume(store, makeView(), 'en')).not.toHaveProperty('basics')
  })

  it('an all-empty item compacts away and never leaves an empty section behind', () => {
    const store = seeded({
      work_experiences: [makeWork({
        employer: {}, role_title: {}, description: {}, long_description: {},
        company_url: null, start: null, end: null,
      })],
    })
    expect(buildJsonResume(store, makeView(), 'en')).not.toHaveProperty('work')
  })

  it('trims prose and drops empty highlights on the way out', () => {
    const store = seeded({
      projects: [makeProject({
        long_description: { en: 'Did the work.   ' },
        highlights: [{ en: '' }, { en: 'Real result' }],
      })],
    })
    const p = rows(buildJsonResume(store, makeView(), 'en'), 'projects')[0]
    expect(p.description).toBe('Did the work.')
    expect(p.highlights).toEqual(['Real result'])
  })
})
