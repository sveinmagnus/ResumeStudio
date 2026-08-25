import { describe, it, expect } from 'vitest'
import {
  isJsonResumeFormat, parseJsonResumeDate, importFromJsonResume,
} from '../src/lib/importerJsonResume'
import { emptyStore as emptyStoreFixture } from './fixtures'

/**
 * Import once, but not until a test asks for it — a shared fixture built in the
 * describe body runs during COLLECTION, so an importer that throws would take
 * the whole file down before a single test is registered (importerEuropass's
 * rule).
 */
function memoized<T>(build: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= build())
}

// ─── A realistic JSON Resume v1.0.0 document ──────────────────────────────────

const SAMPLE = {
  $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
  basics: {
    name: 'Jane Doe',
    label: 'Software Architect',
    email: 'jane@example.com',
    phone: '+47 900 00 000',
    url: 'https://janedoe.dev',
    summary: 'Seasoned architect.\nBuilds platforms people like using.',
    location: { city: 'Oslo', region: 'Viken', countryCode: 'NO' },
    profiles: [
      { network: 'LinkedIn', url: 'https://linkedin.com/in/janedoe' },
      { network: 'Twitter', username: 'janedoe' },
      { network: 'Xing', url: 'https://xing.com/janedoe' },
    ],
  },
  work: [
    {
      name: 'Acme AS',
      position: 'Senior Engineer',
      url: 'https://acme.example',
      startDate: '2019-03-01',
      endDate: '2022-06',
      summary: 'Led the platform team.',
      highlights: ['Cut build times by 60%', 'Introduced trunk-based development'],
    },
    { name: 'CurrentCo', position: 'Principal Engineer', startDate: '2022-07' },
  ],
  volunteer: [
    { organization: 'Code Club', position: 'Mentor', summary: 'Weekly mentoring.', startDate: '2020', endDate: '2021' },
  ],
  education: [
    { institution: 'NTNU', area: 'Computer Science', studyType: 'MSc', score: 'A', startDate: '2010-08', endDate: '2015-06' },
  ],
  awards: [
    { title: 'Hackathon winner', date: '2018-11', awarder: 'TechConf', summary: 'Best in show.' },
  ],
  certificates: [
    { name: 'CKA', date: '2021-04', issuer: 'CNCF', url: 'https://cncf.example/cka' },
  ],
  publications: [
    { name: 'On Platforms', publisher: 'ACM', releaseDate: '2020-02', url: 'https://doi.example/1', summary: 'A paper about platforms.' },
  ],
  skills: [
    { name: 'Web Development', level: 'Master', keywords: ['HTML', 'CSS', 'JavaScript'] },
    { name: 'Leadership', level: 'Advanced' },
  ],
  languages: [
    { language: 'Norwegian', fluency: 'Native speaker' },
    { language: 'English', fluency: 'Fluent' },
  ],
  interests: [{ name: 'Hiking', keywords: ['mountains'] }],
  references: [
    { name: 'Ola Manager', reference: 'Jane is excellent — hire her.' },
  ],
  projects: [
    {
      name: 'Platform rebuild',
      description: 'Rebuilt the deployment platform end to end.',
      entity: 'Acme AS',
      keywords: ['Kubernetes', 'JavaScript'],
      roles: ['Tech Lead'],
      highlights: ['Zero-downtime cutover'],
      url: 'https://platform.example',
      startDate: '2021-01',
      endDate: '2021-12',
    },
  ],
  meta: { canonical: 'https://example.com/resume.json', version: 'v1.0.0' },
}

// ─── Detection ────────────────────────────────────────────────────────────────

describe('isJsonResumeFormat', () => {
  it('claims a realistic JSON Resume document', () => {
    expect(isJsonResumeFormat(SAMPLE)).toBe(true)
  })

  it.each([
    ['basics with a name only', { basics: { name: 'Jane Doe' } }, true],
    ['empty basics + a work array', { basics: {}, work: [] }, true],
    ['empty basics + an education array', { basics: {}, education: [] }, true],
    ['empty basics + a skills array', { basics: {}, skills: [] }, true],
    ['empty basics + a projects array', { basics: {}, projects: [] }, true],
    ['empty basics and nothing else', { basics: {} }, false],
    ['basics that is not an object', { basics: 'Jane Doe', work: [] }, false],
    ['no basics at all', { work: [], skills: [] }, false],
    ['null', null, false],
    ['an array', [{ basics: { name: 'x' } }], false],
    ['a string', 'basics', false],
  ])('%s → %s', (_name, json, expected) => {
    expect(isJsonResumeFormat(json)).toBe(expected)
  })

  it('never claims a CVpartner export', () => {
    const cvpartner = {
      navn: 'Ola Nordmann',
      project_experiences: [],
      technologies: [],
      language_codes: ['no', 'int'],
    }
    expect(isJsonResumeFormat(cvpartner)).toBe(false)
    // Even one that happens to carry a basics-shaped stowaway.
    expect(isJsonResumeFormat({ ...cvpartner, basics: { name: 'Ola' } })).toBe(false)
  })

  it('never claims our own backup format', () => {
    const backup = {
      $schema: 'resumestudio/v1',
      format_version: 1,
      exported_at: '2024-01-01T00:00:00Z',
      profile: null,
      registries: { skills: [], roles: [] },
      sections: { projects: [] },
      views: [],
    }
    expect(isJsonResumeFormat(backup)).toBe(false)
    expect(isJsonResumeFormat({ ...backup, basics: { name: 'x' } })).toBe(false)
  })

  it('never claims an identity-bearing sync file', () => {
    const syncFile = {
      $schema: 'resumestudio-resume/v1',
      resume_id: 'abc',
      saved_at: '2024-01-01T00:00:00Z',
      data: {},
      basics: { name: 'x' },
    }
    expect(isJsonResumeFormat(syncFile)).toBe(false)
  })

  it('never claims a bare ResumeStore', () => {
    const bareStore = {
      resume: { id: 'r1', full_name: 'Kari' },
      projects: [],
      skills: [],
      work_experiences: [],
      views: [],
      basics: { name: 'Kari' },
    }
    expect(isJsonResumeFormat(bareStore)).toBe(false)
  })

  it('rejects anything whose $schema mentions resumestudio, wherever it points', () => {
    expect(isJsonResumeFormat({
      $schema: 'https://resumestudio.example/some/v9',
      basics: { name: 'Jane' },
      work: [],
    })).toBe(false)
  })
})

// ─── Dates ────────────────────────────────────────────────────────────────────

describe('parseJsonResumeDate', () => {
  it.each([
    ['2020-03-15', { year: 2020, month: 3 }],
    ['2020-03', { year: 2020, month: 3 }],
    ['2020', { year: 2020, month: null }],
    // A sloppy single-digit month keeps the date rather than losing the year.
    ['2020-3', { year: 2020, month: 3 }],
    ['2020-01', { year: 2020, month: 1 }],
    ['2020-12', { year: 2020, month: 12 }],
    // Out-of-range months drop to null; the year survives.
    ['2020-00', { year: 2020, month: null }],
    ['2020-13', { year: 2020, month: null }],
    [2020, { year: 2020, month: null }],
    ['  2020-06  ', { year: 2020, month: 6 }],
    ['', null],
    [null, null],
    [undefined, null],
    ['junk', null],
    ['v2020-06', null],
    ['15-03-2020', null],
    ['2020-03-15T00:00:00', null],
    [{ year: 2020 }, null],
  ])('%j → %j', (input, expected) => {
    expect(parseJsonResumeDate(input)).toEqual(expected)
  })
})

// ─── Basics ───────────────────────────────────────────────────────────────────

describe('importFromJsonResume — basics', () => {
  const store = memoized(() => importFromJsonResume(SAMPLE))

  it('lands all content in en, like the LinkedIn importer', () => {
    expect(store().resume?.default_locale).toBe('en')
    expect(store().resume?.supported_locales).toEqual(['en'])
  })

  it('maps identity and contact', () => {
    const r = store().resume!
    expect(r.full_name).toBe('Jane Doe')
    expect(r.email).toBe('jane@example.com')
    expect(r.phone).toBe('+47 900 00 000')
    expect(r.title).toEqual({ en: 'Software Architect' })
    expect(r.website_url).toBe('https://janedoe.dev')
    expect(r.place_of_residence).toEqual({ en: 'Oslo, Viken' })
  })

  it('routes profiles by network — LinkedIn and Twitter, never Xing', () => {
    const r = store().resume!
    expect(r.linkedin_url).toBe('https://linkedin.com/in/janedoe')
    expect(r.twitter).toBe('janedoe')
  })

  it('accepts "X" as the Twitter network name without claiming Xing', () => {
    const twitterOf = (network: string) => importFromJsonResume({
      basics: { name: 'J', profiles: [{ network, url: 'https://x.example/j' }] },
    }).resume?.twitter ?? null
    expect(twitterOf('X')).toBe('https://x.example/j')
    expect(twitterOf('x.com')).toBe('https://x.example/j')
    expect(twitterOf('Xing')).toBeNull()
  })

  it('turns the summary into a leading profile, stored plain', () => {
    expect(store().key_qualifications).toHaveLength(1)
    expect(store().key_qualifications[0].summary)
      .toEqual({ en: 'Seasoned architect.\nBuilds platforms people like using.' })
    expect(store().key_qualifications[0].competency_ids).toEqual([])
  })

  it('adds no profile when there is no summary', () => {
    expect(importFromJsonResume({ basics: { name: 'J' } }).key_qualifications).toEqual([])
  })

  it('joins city and region, and copes with either alone', () => {
    const placeOf = (location: Record<string, unknown>) => importFromJsonResume({
      basics: { name: 'J', location },
    }).resume!.place_of_residence
    expect(placeOf({ city: 'Oslo' })).toEqual({ en: 'Oslo' })
    expect(placeOf({ region: 'Viken' })).toEqual({ en: 'Viken' })
    expect(placeOf({})).toEqual({})
  })
})

// ─── Work ─────────────────────────────────────────────────────────────────────

describe('importFromJsonResume — work', () => {
  const store = memoized(() => importFromJsonResume(SAMPLE))

  it('maps employer, position, url and the date range', () => {
    const w = store().work_experiences[0]
    expect(w.employer).toEqual({ en: 'Acme AS' })
    expect(w.role_title).toEqual({ en: 'Senior Engineer' })
    expect(w.company_url).toBe('https://acme.example')
    expect(w.start).toEqual({ year: 2019, month: 3 })
    expect(w.end).toEqual({ year: 2022, month: 6 })
  })

  it('reads a missing endDate as ongoing', () => {
    expect(store().work_experiences[1].end).toBeNull()
  })

  it('keeps highlights as a bullet list appended to the summary', () => {
    expect(store().work_experiences[0].long_description).toEqual({
      en: '<p>Led the platform team.</p>'
        + '<ul><li>Cut build times by 60%</li><li>Introduced trunk-based development</li></ul>',
    })
  })

  it('stores a highlight-less summary as plain text, the house importer way', () => {
    const w = importFromJsonResume({
      basics: {},
      work: [{ name: 'A', summary: 'First line.\nSecond line.' }],
    }).work_experiences[0]
    expect(w.long_description).toEqual({ en: 'First line.\nSecond line.' })
  })

  it('escapes markup-significant characters in summaries and highlights', () => {
    const w = importFromJsonResume({
      basics: {},
      work: [{ name: 'A', summary: 'Cut <costs> by 5%', highlights: ['R&D <lead>'] }],
    }).work_experiences[0]
    expect(w.long_description.en).toBe(
      '<p>Cut &lt;costs&gt; by 5%</p><ul><li>R&amp;D &lt;lead&gt;</li></ul>',
    )
  })

  it('keeps a row with only an employer or only a position, skips one with neither', () => {
    const rows = (work: unknown[]) => importFromJsonResume({ basics: {}, work }).work_experiences
    expect(rows([{ name: 'Acme' }])).toHaveLength(1)
    expect(rows([{ position: 'Engineer' }])).toHaveLength(1)
    expect(rows([{ summary: 'orphan text' }])).toHaveLength(0)
  })
})

// ─── Skills → registry ────────────────────────────────────────────────────────

describe('importFromJsonResume — skills and the registry', () => {
  const store = memoized(() => importFromJsonResume(SAMPLE))

  it('turns an entry WITH keywords into a category plus one skill per keyword', () => {
    const cat = store().skill_categories!.find((c) => c.name.en === 'Web Development')
    expect(cat).toBeDefined()
    for (const name of ['HTML', 'CSS', 'JavaScript']) {
      const skill = store().skills.find((s) => s.name.en === name)
      expect(skill, name).toBeDefined()
      expect(skill!.category_id, name).toBe(cat!.id)
      expect(skill!.proficiency, name).toBe(5)
    }
  })

  it('turns an entry WITHOUT keywords into a plain skill', () => {
    const skill = store().skills.find((s) => s.name.en === 'Leadership')
    expect(skill).toBeDefined()
    expect(skill!.category_id).toBeNull()
    expect(skill!.proficiency).toBe(4)
  })

  it.each([
    ['Master', 5], ['expert', 5], ['Advanced', 4], ['Intermediate', 3],
    ['Beginner', 1], ['basic', 1], ['Novice', 1],
    ['Wizard', 0], ['', 0],
  ])('maps level %j to proficiency %i', (level, proficiency) => {
    const store2 = importFromJsonResume({ basics: {}, skills: [{ name: 'X', level }] })
    expect(store2.skills[0].proficiency).toBe(proficiency)
  })

  it('interns project keywords against the registry instead of duplicating', () => {
    // 'JavaScript' appears both under skills[] and as a project keyword.
    const js = store().skills.filter((s) => s.name.en === 'JavaScript')
    expect(js).toHaveLength(1)
    const link = store().projects[0].skills.find((s) => s.name.en === 'JavaScript')
    expect(link?.skill_id).toBe(js[0].id)
  })

  it('dedupes on skillKey, so React and React.js are one skill', () => {
    const store2 = importFromJsonResume({
      basics: {},
      skills: [{ name: 'React' }],
      projects: [{ name: 'App', keywords: ['React.js'] }],
    })
    expect(store2.skills).toHaveLength(1)
    expect(store2.projects[0].skills[0].skill_id).toBe(store2.skills[0].id)
  })

  it('does not link the same skill to one project twice', () => {
    const store2 = importFromJsonResume({
      basics: {},
      projects: [{ name: 'App', keywords: ['Node', 'Node.js'] }],
    })
    expect(store2.skills).toHaveLength(1)
    expect(store2.projects[0].skills).toHaveLength(1)
  })

  it('reuses one category across entries with the same name', () => {
    const store2 = importFromJsonResume({
      basics: {},
      skills: [
        { name: 'Frontend', keywords: ['HTML'] },
        { name: 'frontend', keywords: ['CSS'] },
      ],
    })
    expect(store2.skill_categories).toHaveLength(1)
    const catId = store2.skill_categories![0].id
    for (const s of store2.skills) expect(s.category_id).toBe(catId)
  })
})

// ─── Projects ─────────────────────────────────────────────────────────────────

describe('importFromJsonResume — projects', () => {
  const store = memoized(() => importFromJsonResume(SAMPLE))

  it('maps name to the headline, description to the body, entity to the customer', () => {
    const p = store().projects[0]
    expect(p.description).toEqual({ en: 'Platform rebuild' })
    expect(p.long_description).toEqual({ en: 'Rebuilt the deployment platform end to end.' })
    expect(p.customer).toEqual({ en: 'Acme AS' })
    expect(p.external_url).toBe('https://platform.example')
    expect(p.start).toEqual({ year: 2021, month: 1 })
    expect(p.end).toEqual({ year: 2021, month: 12 })
  })

  it('keeps highlights as localized strings', () => {
    expect(store().projects[0].highlights).toEqual([{ en: 'Zero-downtime cutover' }])
  })

  it('interns roles into the registry and links them', () => {
    const role = store().roles.find((r) => r.name.en === 'Tech Lead')
    expect(role).toBeDefined()
    const link = store().projects[0].roles[0]
    expect(link.role_id).toBe(role!.id)
    expect(link.name).toEqual({ en: 'Tech Lead' })
  })

  it('skips a project with neither a name nor a description', () => {
    expect(importFromJsonResume({ basics: {}, projects: [{ url: 'https://x.example' }] }).projects)
      .toHaveLength(0)
  })
})

// ─── The remaining sections ───────────────────────────────────────────────────

describe('importFromJsonResume — the remaining sections', () => {
  const store = memoized(() => importFromJsonResume(SAMPLE))

  it('maps volunteer entries to other roles', () => {
    const v = store().positions[0]
    expect(v.organisation).toEqual({ en: 'Code Club' })
    expect(v.name).toEqual({ en: 'Mentor' })
    expect(v.description).toEqual({ en: 'Weekly mentoring.' })
    expect(v.start).toEqual({ year: 2020, month: null })
    expect(v.end).toEqual({ year: 2021, month: null })
  })

  it('joins studyType and area into the degree', () => {
    const e = store().educations[0]
    expect(e.school).toEqual({ en: 'NTNU' })
    expect(e.degree).toEqual({ en: 'MSc, Computer Science' })
    expect(e.grade).toBe('A')
    expect(e.start).toEqual({ year: 2010, month: 8 })
    expect(e.end).toEqual({ year: 2015, month: 6 })
  })

  it('maps awards', () => {
    expect(store().honor_awards[0]).toMatchObject({
      name: { en: 'Hackathon winner' },
      issuer: { en: 'TechConf' },
      description: { en: 'Best in show.' },
      date: { year: 2018, month: 11 },
    })
  })

  it('maps certificates', () => {
    expect(store().certifications[0]).toMatchObject({
      name: { en: 'CKA' },
      organiser: { en: 'CNCF' },
      issued: { year: 2021, month: 4 },
      credential_url: 'https://cncf.example/cka',
    })
  })

  it('maps publications as articles', () => {
    expect(store().publications[0]).toMatchObject({
      title: { en: 'On Platforms' },
      publisher: { en: 'ACM' },
      abstract: { en: 'A paper about platforms.' },
      url: 'https://doi.example/1',
      date: { year: 2020, month: 2 },
      publication_type: 'article',
    })
  })

  it('maps languages', () => {
    expect(store().spoken_languages.map((l) => l.name.en)).toEqual(['Norwegian', 'English'])
    expect(store().spoken_languages[0].level).toEqual({ en: 'Native speaker' })
  })

  it('maps references to recommendations — quotes, not contactable referees', () => {
    expect(store().references).toEqual([])
    expect(store().recommendations[0]).toMatchObject({
      recommender_name: 'Ola Manager',
      text: { en: 'Jane is excellent — hire her.' },
    })
  })

  it('skips a reference with no quote', () => {
    expect(importFromJsonResume({ basics: {}, references: [{ name: 'Bob' }] }).recommendations)
      .toHaveLength(0)
  })
})

// ─── Totality + fresh-import invariants ───────────────────────────────────────

describe('importFromJsonResume — totality and defaults', () => {
  it('imports an empty document without throwing', () => {
    expect(() => importFromJsonResume({})).not.toThrow()
    const store = importFromJsonResume({})
    expect(store.resume?.full_name).toBe('')
    expect(store.projects).toEqual([])
  })

  it('survives every branch being the wrong kind', () => {
    const wrong = {
      basics: 'not an object',
      work: {},
      education: 'none',
      skills: 42,
      projects: [null, 'text', 7],
      languages: [{}],
      references: [true],
    }
    expect(() => importFromJsonResume(wrong)).not.toThrow()
    const store = importFromJsonResume(wrong)
    expect(store.work_experiences).toEqual([])
    expect(store.projects).toEqual([])
    expect(store.spoken_languages).toEqual([])
  })

  it('leaves every section it does not import empty', () => {
    const store = importFromJsonResume({ basics: { name: 'Jane' }, work: [{ name: 'Acme' }] })
    for (const key of [
      'skills', 'roles', 'industries', 'key_qualifications', 'key_competencies',
      'recommendations', 'projects', 'educations', 'courses', 'certifications',
      'spoken_languages', 'positions', 'presentations', 'honor_awards',
      'publications', 'references', 'views', 'cover_letters', 'skill_categories',
    ] as const) {
      expect(store[key], key).toEqual([])
    }
    expect(store.work_experiences).toHaveLength(1)
  })

  it('imports every row enabled and unstarred, with fresh ids', () => {
    const store = importFromJsonResume(SAMPLE)
    expect(store.work_experiences[0]).toMatchObject({ starred: false, disabled: false })
    expect(store.projects[0]).toMatchObject({ starred: false, disabled: false, use_anonymized: false })
    expect(store.educations[0]).toMatchObject({ starred: false, disabled: false, exchange: false })
    expect(store.spoken_languages[0].disabled).toBe(false)
    const ids = [
      ...store.work_experiences, ...store.projects, ...store.skills, ...store.roles,
    ].map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of store.projects) expect(item.resume_id).toBe(store.resume!.id)
  })

  it('trims padded values on the way in', () => {
    const store = importFromJsonResume({ basics: { name: '  Jane Doe  ', email: ' j@x.io ' } })
    expect(store.resume?.full_name).toBe('Jane Doe')
    expect(store.resume?.email).toBe('j@x.io')
  })
})

// ─── Mutation-audit tripwires ────────────────────────────────────────────────
// Each case kills a mutant the first Stryker pass reported surviving.

describe('importFromJsonResume — boundaries and filters (mutation audit)', () => {
  it('a bare ResumeStore with a basics stowaway is still ours, never JSON Resume', () => {
    // No resumestudio $schema to catch it early — only the looksLikeResumeStore
    // guard stands between this file and the wrong importer.
    const disguised = { ...emptyStoreFixture(), basics: { name: 'Stowaway' } }
    expect(isJsonResumeFormat(disguised)).toBe(false)
  })

  it('keeps the year and drops an out-of-range or zero month', () => {
    expect(parseJsonResumeDate('2020-13')).toEqual({ year: 2020, month: null })
    expect(parseJsonResumeDate('2020-00')).toEqual({ year: 2020, month: null })
  })

  it('imports everything enabled, unstarred and unhighlighted', () => {
    const store = importFromJsonResume({
      basics: { name: 'X', summary: 'A summary.' },
      skills: [{ name: 'React' }],
      projects: [{ name: 'P', roles: ['Lead'] }],
    })
    const kq = store.key_qualifications[0]
    expect([kq.starred, kq.disabled]).toEqual([false, false])
    expect(store.skills[0].is_highlighted).toBe(false)
    const role = store.roles[0]
    expect([role.starred, role.disabled]).toEqual([false, false])
  })

  it('a keyword group with NO name still interns its skills, uncategorized', () => {
    const store = importFromJsonResume({ basics: { name: 'X' }, skills: [{ keywords: ['React'] }] })
    expect(store.skills.map((s) => s.name.en)).toEqual(['React'])
    expect(store.skills[0].category_id).toBeNull()
    expect(store.skill_categories ?? []).toEqual([])
  })

  it('duplicate role and keyword names inside one project produce one link each', () => {
    const store = importFromJsonResume({
      basics: { name: 'X' },
      projects: [{ name: 'P', roles: ['Tech Lead', 'Tech Lead'], keywords: ['React', 'react.js'] }],
    })
    expect(store.projects[0].roles).toHaveLength(1)
    expect(store.projects[0].skills).toHaveLength(1)
    expect(store.roles).toHaveLength(1)
    expect(store.skills).toHaveLength(1)
  })
})
