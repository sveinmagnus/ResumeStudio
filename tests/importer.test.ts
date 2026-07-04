import { describe, it, expect } from 'vitest'
import { importFromCVPartner } from '../src/lib/importer'

// CVpartner export uses idiosyncratic locale encodings and field names.
// These tests pin the known edge cases from CLAUDE.md §8.

describe('importFromCVPartner — minimal envelope', () => {
  it('handles an entirely empty export gracefully', () => {
    const store = importFromCVPartner({})
    expect(store.resume).not.toBeNull()
    expect(store.resume!.full_name).toBe('')
    expect(store.projects).toEqual([])
    expect(store.work_experiences).toEqual([])
    expect(store.skills).toEqual([])
    expect(store.roles).toEqual([])
  })

  it('reads name and email from the top-level fields', () => {
    const store = importFromCVPartner({ name: 'Ada Lovelace', email: 'ada@example.com' })
    expect(store.resume!.full_name).toBe('Ada Lovelace')
    expect(store.resume!.email).toBe('ada@example.com')
  })

  it('reads name from `navn` (Norwegian field) when `name` is absent', () => {
    const store = importFromCVPartner({ navn: 'Sigrid Test' })
    expect(store.resume!.full_name).toBe('Sigrid Test')
  })
})

// ─── Localized value parsing ───────────────────────────────────────────────────

describe('importFromCVPartner — localized() parsing', () => {
  it('accepts the object form { no, en } as-is', () => {
    const store = importFromCVPartner({
      title: { no: 'Konsulent', en: 'Consultant' },
    })
    expect(store.resume!.title).toEqual({ no: 'Konsulent', en: 'Consultant' })
  })

  it('accepts the interleaved-array form [code, value, code, value, …]', () => {
    const store = importFromCVPartner({
      title: ['no', 'Konsulent', 'en', 'Consultant'],
    })
    expect(store.resume!.title).toEqual({ no: 'Konsulent', en: 'Consultant' })
  })

  it('normalises CVpartner "int" locale to "en"', () => {
    const fromObject = importFromCVPartner({ title: { int: 'Consultant' } })
    expect(fromObject.resume!.title).toEqual({ en: 'Consultant' })

    const fromArray = importFromCVPartner({ title: ['int', 'Consultant'] })
    expect(fromArray.resume!.title).toEqual({ en: 'Consultant' })
  })

  it('trims whitespace and drops empty strings', () => {
    const store = importFromCVPartner({ title: { no: '  Konsulent  ', en: '   ' } })
    expect(store.resume!.title).toEqual({ no: 'Konsulent' })
  })

  it('drops malformed locales rather than throwing', () => {
    const store = importFromCVPartner({ title: null as unknown as object })
    expect(store.resume!.title).toEqual({})
  })
})

// ─── Locale detection (the unreliable language_codes workaround) ─────────────

describe('importFromCVPartner — locale detection', () => {
  it('detects locales that appear in content even when language_codes is sparse', () => {
    const store = importFromCVPartner({
      language_codes: ['no'],   // Source lies about coverage
      project_experiences: [
        {
          _id: 'p1',
          customer: { no: 'Kunde', int: 'Customer', se: 'Kunden' },
        },
      ],
    })
    expect(store.resume!.supported_locales).toContain('no')
    expect(store.resume!.supported_locales).toContain('en') // int → en
    expect(store.resume!.supported_locales).toContain('se')
  })

  it('always ensures "en" is present in supported_locales', () => {
    const store = importFromCVPartner({ language_codes: ['no'] })
    expect(store.resume!.supported_locales).toContain('en')
  })

  it('orders locales: no first, then en, then others', () => {
    const store = importFromCVPartner({
      language_codes: ['se'],
      project_experiences: [
        { _id: 'p1', customer: { no: 'X', int: 'X', se: 'X', dk: 'X' } },
      ],
    })
    const locs = store.resume!.supported_locales
    expect(locs[0]).toBe('no')
    expect(locs[1]).toBe('en')
    expect(new Set(locs)).toEqual(new Set(['no', 'en', 'se', 'dk']))
  })

  it('deduplicates locales', () => {
    const store = importFromCVPartner({
      language_codes: ['no', 'no', 'int'],
      project_experiences: [{ _id: 'p1', customer: { no: 'X', int: 'X' } }],
    })
    const locs = store.resume!.supported_locales
    expect(new Set(locs).size).toBe(locs.length)
  })
})

// ─── Skills & roles registries ────────────────────────────────────────────────

describe('importFromCVPartner — skills registry', () => {
  it('builds the registry from technologies[].technology_skills', () => {
    const store = importFromCVPartner({
      technologies: [
        {
          _id: 'cat1',
          category: { en: 'Languages' },
          technology_skills: [
            { _id: 'sk1', tags: { en: 'TypeScript' }, proficiency: 4, total_duration_in_years: 5 },
            { _id: 'sk2', tags: { en: 'Go' }, proficiency: 3, total_duration_in_years: 2 },
          ],
        },
      ],
    })
    expect(store.skills).toHaveLength(2)
    expect(store.skills.map((s) => s.name.en).sort()).toEqual(['Go', 'TypeScript'])
  })

  it('also collects skills referenced only inside projects (no orphans)', () => {
    const store = importFromCVPartner({
      technologies: [],
      project_experiences: [
        {
          _id: 'p1',
          customer: { en: 'Customer' },
          project_experience_skills: [
            { _id: 'ps1', tags: { en: 'Kubernetes' } },
          ],
        },
      ],
    })
    expect(store.skills.find((s) => s.name.en === 'Kubernetes')).toBeDefined()
  })

  it('reuses an existing skill registry entry when a project mentions an existing skill (case-insensitive)', () => {
    const store = importFromCVPartner({
      technologies: [
        {
          _id: 'cat1',
          category: { en: 'Languages' },
          technology_skills: [
            { _id: 'sk1', tags: { en: 'TypeScript' } },
          ],
        },
      ],
      project_experiences: [
        {
          _id: 'p1',
          customer: { en: 'X' },
          project_experience_skills: [{ _id: 'ps1', tags: { en: 'typescript' } }],
        },
      ],
    })
    expect(store.skills.filter((s) => s.name.en?.toLowerCase() === 'typescript')).toHaveLength(1)
  })
})

// ─── technologies[] → skill categories (roadmap: showcase unification) ───────

describe('importFromCVPartner — skill categories from technologies[]', () => {
  it('creates one skill category per technology group and links + highlights its skills', () => {
    const store = importFromCVPartner({
      technologies: [
        {
          _id: 'cat1',
          category: { en: 'Languages' },
          technology_skills: [
            { _id: 'sk1', tags: { en: 'TypeScript' } },
            { _id: 'sk2', tags: { en: 'Go' } },
          ],
        },
      ],
    })
    expect(store.skill_categories).toHaveLength(1)
    const cat = store.skill_categories![0]
    expect(cat.name.en).toBe('Languages')
    const catSkills = store.skills.filter((s) => s.category_id === cat.id)
    expect(catSkills.map((s) => s.name.en).sort()).toEqual(['Go', 'TypeScript'])
    for (const s of catSkills) expect(s.is_highlighted).toBe(true)
  })

  it('leaves project-only skills uncategorized and un-highlighted', () => {
    const store = importFromCVPartner({
      technologies: [],
      project_experiences: [{
        _id: 'p1', customer: { en: 'X' },
        project_experience_skills: [{ _id: 'ps1', tags: { en: 'Kubernetes' } }],
      }],
    })
    const k8s = store.skills.find((s) => s.name.en === 'Kubernetes')!
    expect(k8s.category_id).toBeNull()
    expect(k8s.is_highlighted).toBe(false)
  })

  it('skips a disabled technology group entirely — no category, skills not highlighted', () => {
    // A disabled group never reached the old Showcase export either
    // (applyView filters disabled items), so this preserves that invisibility.
    const store = importFromCVPartner({
      technologies: [
        {
          _id: 'cat1', category: { en: 'Legacy' }, disabled: true,
          technology_skills: [{ _id: 'sk1', tags: { en: 'COBOL' } }],
        },
      ],
    })
    expect(store.skill_categories).toHaveLength(0)
    const cobol = store.skills.find((s) => s.name.en === 'COBOL')!
    expect(cobol.category_id).toBeNull()
    expect(cobol.is_highlighted).toBe(false)
  })

  it('preserves the technologies[] order as category sort_order', () => {
    const store = importFromCVPartner({
      technologies: [
        { _id: 'c1', category: { en: 'First' }, technology_skills: [] },
        { _id: 'c2', category: { en: 'Second' }, technology_skills: [] },
      ],
    })
    const sorted = [...store.skill_categories!].sort((a, b) => a.sort_order - b.sort_order)
    expect(sorted.map((c) => c.name.en)).toEqual(['First', 'Second'])
  })
})

describe('importFromCVPartner — roles registry', () => {
  it('builds the registry from cv_roles', () => {
    const store = importFromCVPartner({
      cv_roles: [
        { _id: 'r1', name: { en: 'Solution Architect', no: 'Løsningsarkitekt' } },
        { _id: 'r2', name: { en: 'Developer' } },
      ],
    })
    expect(store.roles.map((r) => r.name.en).sort()).toEqual(['Developer', 'Solution Architect'])
  })

  it('links project roles to the registry via cv_role_id', () => {
    const store = importFromCVPartner({
      cv_roles: [{ _id: 'r1', name: { en: 'Architect' } }],
      project_experiences: [
        {
          _id: 'p1',
          customer: { en: 'X' },
          roles: [{ _id: 'pr1', cv_role_id: 'r1', name: { en: 'Architect' } }],
        },
      ],
    })
    const archId = store.roles.find((r) => r.name.en === 'Architect')!.id
    expect(store.projects[0].roles[0].role_id).toBe(archId)
  })
})

// ─── Project mapping ──────────────────────────────────────────────────────────

describe('importFromCVPartner — projects', () => {
  it('maps customer_selected: customer_anonymized → use_anonymized: true', () => {
    const store = importFromCVPartner({
      project_experiences: [
        {
          _id: 'p1',
          customer: { en: 'Real Customer Name' },
          customer_anonymized: { en: 'A Bank' },
          customer_selected: 'customer_anonymized',
        },
      ],
    })
    expect(store.projects[0].use_anonymized).toBe(true)
  })

  it('defaults use_anonymized to false otherwise', () => {
    const store = importFromCVPartner({
      project_experiences: [
        { _id: 'p1', customer: { en: 'Real' } },
      ],
    })
    expect(store.projects[0].use_anonymized).toBe(false)
  })

  it('folds role descriptions into the single project long_description', () => {
    const store = importFromCVPartner({
      project_experiences: [
        {
          _id: 'p1',
          customer: { en: 'X' },
          long_description: { en: 'Project background.' },
          roles: [
            { _id: 'pr1', name: { en: 'Architect' }, long_description: { en: 'Designed the platform.' } },
          ],
        },
      ],
    })
    // Role free text is merged into the project description, prefixed with the
    // role name; roles themselves carry no description field anymore.
    expect(store.projects[0].long_description.en).toBe('Project background.\n\nArchitect: Designed the platform.')
    expect('long_description' in store.projects[0].roles[0]).toBe(false)
  })

  it('parses start/end YearMonth from year_from/month_from + year_to/month_to', () => {
    const store = importFromCVPartner({
      project_experiences: [
        {
          _id: 'p1', customer: { en: 'X' },
          year_from: '2021', month_from: '3', year_to: '2023', month_to: '12',
        },
      ],
    })
    expect(store.projects[0].start).toEqual({ year: 2021, month: 3 })
    expect(store.projects[0].end).toEqual({ year: 2023, month: 12 })
  })

  it('treats an empty year_to as ongoing (end = null)', () => {
    const store = importFromCVPartner({
      project_experiences: [
        { _id: 'p1', customer: { en: 'X' }, year_from: '2021', year_to: '' },
      ],
    })
    expect(store.projects[0].end).toBeNull()
  })

  it('handles missing month with month=null', () => {
    const store = importFromCVPartner({
      project_experiences: [
        { _id: 'p1', customer: { en: 'X' }, year_from: '2021' },
      ],
    })
    expect(store.projects[0].start).toEqual({ year: 2021, month: null })
  })

  it('resolves related_work_experience_id through the work_experience id map', () => {
    const store = importFromCVPartner({
      work_experiences: [
        { _id: 'cv-w1', employer: { en: 'BigCo' }, year_from: '2018' },
      ],
      project_experiences: [
        { _id: 'p1', customer: { en: 'X' }, related_work_experience_id: 'cv-w1' },
      ],
    })
    const w = store.work_experiences.find((x) => x.employer.en === 'BigCo')!
    expect(store.projects[0].work_experience_id).toBe(w.id)
  })

  it('leaves work_experience_id null when the link points nowhere', () => {
    const store = importFromCVPartner({
      project_experiences: [
        { _id: 'p1', customer: { en: 'X' }, related_work_experience_id: 'unknown-id' },
      ],
    })
    expect(store.projects[0].work_experience_id).toBeNull()
  })

  it('parses percent_allocated as an integer', () => {
    const store = importFromCVPartner({
      project_experiences: [
        { _id: 'p1', customer: { en: 'X' }, percent_allocated: '75' },
      ],
    })
    expect(store.projects[0].percent_allocated).toBe(75)
  })

  it('propagates disabled and starred flags through unchanged', () => {
    const store = importFromCVPartner({
      project_experiences: [
        { _id: 'p1', customer: { en: 'A' }, disabled: true, starred: false },
        { _id: 'p2', customer: { en: 'B' }, disabled: false, starred: true },
      ],
    })
    expect(store.projects[0].disabled).toBe(true)
    expect(store.projects[1].starred).toBe(true)
  })
})

// ─── ID stability ─────────────────────────────────────────────────────────────

describe('importFromCVPartner — ID generation', () => {
  it('assigns fresh UUIDs to every imported entity (does not reuse CVpartner _id)', () => {
    const store = importFromCVPartner({
      project_experiences: [{ _id: 'cv-p-1', customer: { en: 'X' } }],
    })
    expect(store.projects[0].id).not.toBe('cv-p-1')
    // UUID v4 shape (with dashes, 36 chars)
    expect(store.projects[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('produces unique resume_id values within one store', () => {
    const store = importFromCVPartner({
      project_experiences: [{ _id: 'p1', customer: { en: 'X' } }],
      work_experiences: [{ _id: 'w1', employer: { en: 'Y' } }],
    })
    expect(store.projects[0].resume_id).toBe(store.resume!.id)
    expect(store.work_experiences[0].resume_id).toBe(store.resume!.id)
  })
})

// ─── Subsidiary sections ──────────────────────────────────────────────────────

describe('importFromCVPartner — subsidiary sections', () => {
  it('maps educations', () => {
    const store = importFromCVPartner({
      educations: [{
        _id: 'e1', school: { en: 'MIT' }, degree: { en: 'BSc' },
        year_from: '2015', year_to: '2018',
      }],
    })
    expect(store.educations[0].school.en).toBe('MIT')
    expect(store.educations[0].start?.year).toBe(2015)
  })

  it('maps courses with completed date', () => {
    const store = importFromCVPartner({
      courses: [{
        _id: 'c1', name: { en: 'Algorithms' }, year: '2020', month: '5',
      }],
    })
    expect(store.courses[0].name.en).toBe('Algorithms')
    expect(store.courses[0].completed).toEqual({ year: 2020, month: 5 })
  })

  it('maps spoken languages', () => {
    const store = importFromCVPartner({
      languages: [{ _id: 'l1', name: { en: 'English' }, level: { en: 'Native' } }],
    })
    expect(store.spoken_languages[0].name.en).toBe('English')
    expect(store.spoken_languages[0].level.en).toBe('Native')
  })

  it('initialises publications, references, and views as empty arrays', () => {
    const store = importFromCVPartner({})
    expect(store.publications).toEqual([])
    expect(store.references).toEqual([])
    expect(store.views).toEqual([])
  })

  it('maps key_qualifications and promotes key_points to key_competencies', () => {
    // CVpartner nests "key_points" under each key_qualification. We now treat
    // those as standalone Key Competencies, so the per-KQ key_points array
    // imports empty and the data lands in the top-level key_competencies list.
    const store = importFromCVPartner({
      key_qualifications: [
        {
          _id: 'kq1',
          label: { en: 'Profile' },
          tag_line: { en: 'Architect' },
          long_description: { en: 'A summary' },
          key_points: [
            { _id: 'kp1', name: { en: 'Leadership' }, long_description: { en: 'Led teams' } },
            { _id: 'kp2', name: { en: 'Architecture' }, long_description: { en: 'Designed systems' } },
            // Entirely empty point → dropped, not carried over as a blank.
            { _id: 'kp3', name: {}, long_description: {} },
          ],
        },
      ],
    })
    expect(store.key_qualifications[0].label.en).toBe('Profile')
    expect(store.key_qualifications[0].summary.en).toBe('A summary')
    expect(store.key_qualifications[0].key_points).toEqual([])
    expect(store.key_competencies).toHaveLength(2)
    expect(store.key_competencies[0].title.en).toBe('Leadership')
    expect(store.key_competencies[0].description.en).toBe('Led teams')
    expect(store.key_competencies[1].title.en).toBe('Architecture')
    // Sort order is dense from zero so the editor renders them in import order.
    expect(store.key_competencies.map((c) => c.sort_order)).toEqual([0, 1])
  })
})
