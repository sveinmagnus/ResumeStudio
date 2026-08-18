import { describe, it, expect } from 'vitest'
import { importFromCVPartner, isCVPartnerFormat } from '../src/lib/importer'

describe('isCVPartnerFormat()', () => {
  it('detects the CVpartner-signature fields', () => {
    expect(isCVPartnerFormat({ project_experiences: [] })).toBe(true)
    expect(isCVPartnerFormat({ cv_roles: [] })).toBe(true)
    expect(isCVPartnerFormat({ language_codes: ['no'] })).toBe(true)
    expect(isCVPartnerFormat({ technologies: [] })).toBe(true)
    expect(isCVPartnerFormat({ default_cv: true })).toBe(true)
    expect(isCVPartnerFormat({ born_year: '1980' })).toBe(true)
    expect(isCVPartnerFormat({ navn: 'Sigrid' })).toBe(true)
  })

  it('does NOT misfire on a Resume Studio store (shared field names are excluded)', () => {
    // A raw ResumeStore has key_qualifications/work_experiences/educations too —
    // the detector must not treat those as CVpartner markers.
    expect(isCVPartnerFormat({
      resume: null, key_qualifications: [], work_experiences: [], educations: [],
      projects: [], skills: [], views: [],
    })).toBe(false)
  })

  it('rejects non-objects and arrays', () => {
    expect(isCVPartnerFormat(null)).toBe(false)
    expect(isCVPartnerFormat('x')).toBe(false)
    expect(isCVPartnerFormat([1, 2, 3])).toBe(false)
  })
})

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

  it('reads a bare string as English', () => {
    // Some exports carry a plain string where a localized object belongs;
    // ignoring it loses the value entirely.
    expect(importFromCVPartner({ title: 'Consultant' as unknown as object }).resume!.title)
      .toEqual({ en: 'Consultant' })
  })

  it('reads every pair of an interleaved array, and ignores a dangling code', () => {
    // The loop walks in twos and must stop before a trailing code with no
    // value — reading past the end pairs a code with undefined.
    const store = importFromCVPartner({
      title: ['no', 'Konsulent', 'se', 'Konsult', 'dk', 'Konsulent-dk', 'fi'],
    })
    expect(store.resume!.title).toEqual({ no: 'Konsulent', se: 'Konsult', dk: 'Konsulent-dk' })
  })

  it('drops an interleaved entry whose value is blank or not a string', () => {
    const store = importFromCVPartner({
      title: ['no', 'Konsulent', 'se', '   ', 'dk', 42 as unknown as string, 'de', null as unknown as string],
    })
    expect(store.resume!.title).toEqual({ no: 'Konsulent' })
  })

  it('trims interleaved values as well as object ones', () => {
    expect(importFromCVPartner({ title: ['no', '  Konsulent  '] }).resume!.title)
      .toEqual({ no: 'Konsulent' })
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
    // Course dates are a from/to range now (shape v11); the import date lands on `end`.
    expect(store.courses[0].end).toEqual({ year: 2020, month: 5 })
    expect(store.courses[0].start).toBeNull()
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

/**
 * The per-skill experience an import derives from a project's dates.
 *
 * 19 mutants, none killed — nothing called it. It is not internal bookkeeping:
 * it lands on every ProjectSkill as duration_in_years, which is summed into the
 * Skill Matrix's Experience column, so getting it wrong overstates or
 * understates a number the reader treats as a fact about the person.
 */
describe('importFromCVPartner — project duration', () => {
  /** Import one project with the given dates and read back a skill's duration. */
  const durationOf = (dates: Record<string, string>): number => {
    const store = importFromCVPartner({
      project_experiences: [{
        _id: 'p1',
        customer: { en: 'Acme' },
        project_experience_skills: [{ _id: 'sk1', tags: { en: 'Go' } }],
        ...dates,
      }],
    } as never)
    return store.projects[0].skills[0].duration_in_years
  }

  it('spans January of the first year to DECEMBER of the last', () => {
    // month_from defaults to January and month_to to December, so a project
    // given only years covers both of them: 2020..2021 measures 23 months, not
    // the 12 that defaulting month_to to January would give. That default is
    // worth a year per project across a whole CV.
    expect(durationOf({ year_from: '2020', year_to: '2021' })).toBeCloseTo(23 / 12, 2)
  })

  it('measures a single-year project as eleven months, not twelve', () => {
    // Jan 1 to Dec 1 — the end month is a point, not an inclusive month. Worth
    // stating so nobody "fixes" it into a rounder number by accident.
    expect(durationOf({ year_from: '2020', year_to: '2020' })).toBeCloseTo(11 / 12, 2)
  })

  it('honours explicit months at both ends', () => {
    // Jan 2020 → Jun 2020 is five months of elapsed time.
    expect(durationOf({ year_from: '2020', month_from: '1', year_to: '2020', month_to: '6' }))
      .toBeCloseTo(5 / 12, 1)
  })

  it('is zero when the project has no start year at all', () => {
    expect(durationOf({ year_to: '2021' })).toBe(0)
  })

  it('treats an EMPTY year_to as ongoing, not as year zero', () => {
    // '' is what the export writes for a running project. Parsed as a year it
    // would produce a huge negative span; the guard is what makes it "until
    // now" instead.
    const ongoing = durationOf({ year_from: '2020', year_to: '' })
    const thisYear = new Date().getFullYear()
    expect(ongoing).toBeGreaterThan(thisYear - 2020 - 1)
    expect(ongoing).toBeLessThan(thisYear - 2020 + 1.1)
  })

  it('treats a missing year_to as ongoing too', () => {
    expect(durationOf({ year_from: '2020' })).toBeGreaterThan(1)
  })

  it('never reports a negative duration for a backwards range', () => {
    // Real exports carry typos. A negative would subtract from the matrix.
    expect(durationOf({ year_from: '2021', month_from: '6', year_to: '2020', month_to: '1' })).toBe(0)
  })

  it('adds the skill offset on top, keeping the two separate', () => {
    const store = importFromCVPartner({
      project_experiences: [{
        _id: 'p1',
        customer: { en: 'Acme' },
        year_from: '2020', year_to: '2020',
        project_experience_skills: [
          { _id: 'sk1', tags: { en: 'Go' }, offset_duration_in_years: 3 },
        ],
      }],
    } as never)
    const skill = store.projects[0].skills[0]
    expect(skill.duration_in_years).toBeCloseTo(11 / 12, 2)
    expect(skill.offset_in_years).toBe(3)
    expect(skill.total_duration_in_years).toBeCloseTo(3 + 11 / 12, 2)
  })

  it('defaults a missing offset to 0 rather than NaN', () => {
    const store = importFromCVPartner({
      project_experiences: [{
        _id: 'p1', customer: { en: 'Acme' }, year_from: '2020', year_to: '2020',
        project_experience_skills: [{ _id: 'sk1', tags: { en: 'Go' } }],
      }],
    } as never)
    const skill = store.projects[0].skills[0]
    expect(skill.offset_in_years).toBe(0)
    expect(Number.isNaN(skill.total_duration_in_years)).toBe(false)
  })
})

/**
 * The subsidiary sections nothing imported.
 *
 * Certifications, positions, presentations and awards were entirely unreached —
 * so a CVpartner export could bring them in against the wrong fields and no
 * test would move. Each one maps a CVpartner name onto a different Resume Studio
 * name (`description` becomes an ORGANISATION on a position and a TITLE on a
 * presentation), which is exactly the sort of mapping that rots silently.
 */
describe('importFromCVPartner — the subsidiary sections', () => {
  const of = (raw: Record<string, unknown>) => importFromCVPartner(raw as never)

  describe('certifications', () => {
    const cert = (over: Record<string, unknown> = {}) => of({
      certifications: [{
        name: { en: 'AWS SA' }, organiser: { en: 'Amazon' },
        long_description: { en: 'Professional level.' },
        year: '2022', month: '3', order: 2, ...over,
      }],
    }).certifications[0]

    it('maps name, organiser and long_description', () => {
      expect(cert()).toMatchObject({
        name: { en: 'AWS SA' },
        organiser: { en: 'Amazon' },
        description: { en: 'Professional level.' },
      })
    })

    it('reads the issue date from year + month', () => {
      expect(cert().issued).toEqual({ year: 2022, month: 3 })
    })

    it('reads an expiry only when the export has one', () => {
      expect(cert({ year_expire: '2025', month_expire: '3' }).expires).toEqual({ year: 2025, month: 3 })
      expect(cert().expires).toBeNull()
    })

    it('carries the export’s order, and defaults it to 0', () => {
      expect(cert().sort_order).toBe(2)
      expect(cert({ order: undefined }).sort_order).toBe(0)
    })

    it('defaults starred and disabled to false rather than undefined', () => {
      expect(cert()).toMatchObject({ starred: false, disabled: false })
      expect(cert({ starred: true, disabled: true })).toMatchObject({ starred: true, disabled: true })
    })
  })

  describe('positions', () => {
    const pos = (over: Record<string, unknown> = {}) => of({
      positions: [{
        name: { en: 'Board member' }, description: { en: 'Cartavio AS' },
        year_from: '2020', year_to: '2022', order: 1, ...over,
      }],
    }).positions[0]

    it('maps CVpartner’s `description` onto the ORGANISATION', () => {
      // The name is the role; the organisation arrives in `description`. Getting
      // this pair the wrong way round labels every position with its company.
      expect(pos()).toMatchObject({
        name: { en: 'Board member' },
        organisation: { en: 'Cartavio AS' },
      })
    })

    it('leaves its own description empty — the export has no field for it', () => {
      expect(pos().description).toEqual({})
    })

    it('reads the range, treating an EMPTY year_to as ongoing', () => {
      expect(pos().start).toEqual({ year: 2020, month: null })
      expect(pos().end).toEqual({ year: 2022, month: null })
      expect(pos({ year_to: '' }).end).toBeNull()
      expect(pos({ year_to: undefined }).end).toBeNull()
    })
  })

  describe('presentations', () => {
    const pres = (over: Record<string, unknown> = {}) => of({
      presentations: [{
        description: { en: 'Scaling Postgres' },
        long_description: { en: 'A talk about scale.' },
        year: '2024', month: '9', order: 3, ...over,
      }],
    }).presentations[0]

    it('maps CVpartner’s `description` onto the TITLE', () => {
      // The opposite of positions, from the same source field name.
      expect(pres()).toMatchObject({
        title: { en: 'Scaling Postgres' },
        description: { en: 'A talk about scale.' },
      })
    })

    it('lands the date on the range END, matching shape v13', () => {
      // Presentations became a start/end range; the import has one date, and it
      // is the end, with the start left blank.
      expect(pres().end).toEqual({ year: 2024, month: 9 })
      expect(pres().start).toBeNull()
    })

    it('has no event or url — the export carries neither', () => {
      expect(pres().event).toEqual({})
      expect(pres().url).toBeNull()
    })
  })

  describe('honors & awards', () => {
    const award = (over: Record<string, unknown> = {}) => of({
      honors_awards: [{
        name: { en: 'Employee of the Year' }, issuer: { en: 'Cartavio AS' },
        for_work: { en: 'The migration' }, long_description: { en: 'For the migration.' },
        year: '2021', month: '12', order: 4, ...over,
      }],
    }).honor_awards[0]

    it('maps all four localized fields and the date', () => {
      expect(award()).toMatchObject({
        name: { en: 'Employee of the Year' },
        issuer: { en: 'Cartavio AS' },
        for_work: { en: 'The migration' },
        description: { en: 'For the migration.' },
        date: { year: 2021, month: 12 },
      })
    })

    it('carries order and disabled', () => {
      expect(award()).toMatchObject({ sort_order: 4, disabled: false })
      expect(award({ disabled: true }).disabled).toBe(true)
    })
  })

  it('imports nothing for a section the export omits entirely', () => {
    const store = of({})
    expect(store.certifications).toEqual([])
    expect(store.positions).toEqual([])
    expect(store.presentations).toEqual([])
    expect(store.honor_awards).toEqual([])
  })
})

describe('importFromCVPartner — date of birth', () => {
  const dob = (raw: Record<string, unknown>) =>
    importFromCVPartner(raw as never).resume!.date_of_birth

  it('assembles an ISO date from the three parts', () => {
    expect(dob({ born_year: '1980', born_month: '6', born_day: '15' })).toBe('1980-06-15')
  })

  it('zero-pads a single-digit month and day', () => {
    // '1980-6-1' is not an ISO date and does not parse the same everywhere.
    expect(dob({ born_year: '1980', born_month: '6', born_day: '1' })).toBe('1980-06-01')
  })

  it('defaults a missing month and day to January the 1st', () => {
    // The year is the part people actually record; defaulting to 0 would make
    // an invalid date, and dropping the whole field loses the year too.
    expect(dob({ born_year: '1980' })).toBe('1980-01-01')
  })

  it('is null when the export has no birth year', () => {
    expect(dob({ born_month: '6', born_day: '15' })).toBeNull()
  })
})

/**
 * The resume-root scalar mappings.
 *
 * Each is a `|| null` or a ternary that nothing exercised. They are small, but
 * an undefined reaching the store is not the same as a null: it round-trips
 * through JSON as a MISSING key, and the editor then renders an uncontrolled
 * input instead of an empty one.
 */
describe('importFromCVPartner — resume-root scalars', () => {
  const imp = (raw: Record<string, unknown>) => importFromCVPartner(raw as never)

  it('nulls an absent phone rather than leaving it undefined', () => {
    expect(imp({ telefon: '+47 900' }).resume!.phone).toBe('+47 900')
    expect(imp({}).resume!.phone).toBeNull()
  })

  it('nulls an absent profile image URL', () => {
    expect(imp({ image: 'https://x.test/p.png' }).resume!.profile_image_url)
      .toBe('https://x.test/p.png')
    expect(imp({}).resume!.profile_image_url).toBeNull()
  })

  it('nulls an absent twitter handle', () => {
    expect(imp({ twitter: '@kari' }).resume!.twitter).toBe('@kari')
    expect(imp({}).resume!.twitter).toBeNull()
  })

  it('maps the default locale, treating anything but "no" as English', () => {
    // Both directions: a constant here would set every imported CV to one
    // language, and the editor opens on the default locale.
    expect(imp({ language_code: 'no' }).resume!.default_locale).toBe('no')
    expect(imp({ language_code: 'int' }).resume!.default_locale).toBe('en')
    expect(imp({}).resume!.default_locale).toBe('en')
  })
})

/**
 * The optional fields on every CVpartner row.
 *
 * A real export omits fields per item rather than per file: one project carries
 * `order`, the next does not; one role is starred, most are not. Each of those is
 * its own `|| default` in the importer, so they are checked in pairs — carried
 * when present, defaulted when absent — section by section.
 */
describe('importFromCVPartner — optional numbers and flags, per section', () => {
  it('carries a role\u2019s experience numbers and flags, and defaults them when absent', () => {
    const store = importFromCVPartner({
      cv_roles: [
        {
          _id: 'r1', name: { en: 'Architect' }, years_of_experience: 12,
          years_of_experience_offset: 3, starred: true, order: 5, disabled: true,
        },
        { _id: 'r2', name: { en: 'Developer' } },
      ],
    })
    expect(store.roles[0]).toMatchObject({
      years_of_experience: 12, years_of_experience_offset: 3,
      starred: true, sort_order: 5, disabled: true,
    })
    expect(store.roles[1]).toMatchObject({
      years_of_experience: 0, years_of_experience_offset: 0,
      starred: false, sort_order: 0, disabled: false,
    })
  })

  it('carries a technology\u2019s duration and proficiency, and defaults them when absent', () => {
    const store = importFromCVPartner({
      technologies: [{
        _id: 'cat1', category: { en: 'Languages' },
        technology_skills: [
          { _id: 's1', tags: { en: 'Go' }, total_duration_in_years: 8, proficiency: 4 },
          { _id: 's2', tags: { en: 'Rust' } },
        ],
      }],
    })
    const go = store.skills.find((s) => Object.values(s.name)[0] === 'Go')!
    const rust = store.skills.find((s) => Object.values(s.name)[0] === 'Rust')!
    expect(go).toMatchObject({ total_duration_in_years: 8, proficiency: 4 })
    expect(rust).toMatchObject({ total_duration_in_years: 0, proficiency: 0 })
  })

  it('carries an employment\u2019s order and flags, and defaults them when absent', () => {
    const store = importFromCVPartner({
      work_experiences: [
        { employer: { en: 'Acme' }, order: 7, starred: true, disabled: true },
        { employer: { en: 'Beta' } },
      ],
    })
    expect(store.work_experiences[0]).toMatchObject({ sort_order: 7, starred: true, disabled: true })
    expect(store.work_experiences[1]).toMatchObject({ sort_order: 0, starred: false, disabled: false })
  })

  it('carries an education\u2019s order and flags, and defaults them when absent', () => {
    const store = importFromCVPartner({
      educations: [
        { school: { en: 'NTNU' }, order: 4, starred: true, disabled: true },
        { school: { en: 'UiO' } },
      ],
    })
    expect(store.educations[0]).toMatchObject({ sort_order: 4, starred: true, disabled: true })
    expect(store.educations[1]).toMatchObject({ sort_order: 0, starred: false, disabled: false })
  })

  it('treats an EMPTY year_to as ongoing, and a present one as an end date', () => {
    // CVpartner writes '' rather than omitting the field for current roles; a
    // truthiness check that missed that would date every ongoing job to year 0.
    const store = importFromCVPartner({
      work_experiences: [
        { employer: { en: 'Now' }, year_from: '2020', month_from: '1', year_to: '', month_to: '' },
        { employer: { en: 'Then' }, year_from: '2015', month_from: '2', year_to: '2018', month_to: '6' },
      ],
      educations: [
        { school: { en: 'Ongoing' }, year_from: '2021', year_to: '' },
        { school: { en: 'Finished' }, year_from: '2010', year_to: '2013' },
      ],
    })
    expect(store.work_experiences[0].end).toBeNull()
    expect(store.work_experiences[1].end).toEqual({ year: 2018, month: 6 })
    expect(store.educations[0].end).toBeNull()
    expect(store.educations[1].end).toEqual({ year: 2013, month: null })
  })
})

describe('importFromCVPartner — the project↔registry links', () => {
  const withProjectSkill = (tags: Record<string, string>, over: Record<string, unknown> = {}) => ({
    technologies: [{
      _id: 'cat1', category: { en: 'Languages' },
      technology_skills: [{ _id: 'reg-go', tags: { en: 'Go' }, total_duration_in_years: 5 }],
    }],
    project_experiences: [{
      _id: 'p1', customer: { en: 'AcmeCo' },
      project_experience_skills: [{ _id: 'ps1', tags, ...over }],
    }],
  })

  it('links a project skill to the registry entry with the same name, whatever its case', () => {
    // The registry is built from `technologies`; a project's own skill rows are
    // separate objects, so they are matched by NAME or they duplicate the entry.
    const store = importFromCVPartner(withProjectSkill({ en: 'GO' }))
    expect(store.skills).toHaveLength(1)
    expect(store.projects[0].skills[0].skill_id).toBe(store.skills[0].id)
  })

  it('creates a registry entry for a project skill the technologies list never mentioned', () => {
    const store = importFromCVPartner(withProjectSkill({ en: 'Rust' }))
    expect(store.skills.map((s) => Object.values(s.name)[0]).sort()).toEqual(['Go', 'Rust'])
    const rust = store.skills.find((s) => Object.values(s.name)[0] === 'Rust')!
    expect(store.projects[0].skills[0].skill_id).toBe(rust.id)
  })

  it('links two projects naming the same skill to ONE registry entry', () => {
    const store = importFromCVPartner({
      project_experiences: [
        { _id: 'p1', customer: { en: 'One' }, project_experience_skills: [{ _id: 'a', tags: { en: 'Kubernetes' } }] },
        { _id: 'p2', customer: { en: 'Two' }, project_experience_skills: [{ _id: 'b', tags: { en: 'kubernetes' } }] },
      ],
    })
    expect(store.skills).toHaveLength(1)
    expect(store.projects[0].skills[0].skill_id).toBe(store.projects[1].skills[0].skill_id)
  })

  it('adds the project\u2019s own offset to the duration it inherits', () => {
    const store = importFromCVPartner({
      project_experiences: [{
        _id: 'p1', customer: { en: 'AcmeCo' },
        year_from: '2020', month_from: '1', year_to: '2022', month_to: '1',
        project_experience_skills: [{ _id: 'ps1', tags: { en: 'Go' }, offset_duration_in_years: 3 }],
      }],
    })
    const link = store.projects[0].skills[0]
    expect(link.offset_in_years).toBe(3)
    expect(link.total_duration_in_years).toBe(link.duration_in_years + 3)
  })

  it('defaults a missing offset to nothing rather than to the duration', () => {
    const store = importFromCVPartner({
      project_experiences: [{
        _id: 'p1', customer: { en: 'AcmeCo' },
        project_experience_skills: [{ _id: 'ps1', tags: { en: 'Go' } }],
      }],
    })
    const link = store.projects[0].skills[0]
    expect(link.offset_in_years).toBe(0)
    expect(link.total_duration_in_years).toBe(link.duration_in_years)
  })

  it('numbers a project\u2019s roles by their own order, falling back to their position', () => {
    const store = importFromCVPartner({
      project_experiences: [{
        _id: 'p1', customer: { en: 'AcmeCo' },
        roles: [
          { _id: 'a', name: { en: 'Lead' }, order: 9 },
          { _id: 'b', name: { en: 'Dev' } },
        ],
      }],
    })
    expect(store.projects[0].roles.map((r) => r.sort_order)).toEqual([9, 1])
  })
})

describe('importFromCVPartner — the awkward skill rows', () => {
  it('links a repeated project skill to the registry entry it NAMES, not the first one', () => {
    const store = importFromCVPartner({
      technologies: [{
        _id: 'cat1', category: { en: 'Languages' },
        technology_skills: [
          { _id: 'reg-go', tags: { en: 'Go' } },
          { _id: 'reg-rust', tags: { en: 'Rust' } },
        ],
      }],
      project_experiences: [{
        _id: 'p1', customer: { en: 'AcmeCo' },
        project_experience_skills: [{ _id: 'ps1', tags: { en: 'rust' } }],
      }],
    })
    const rust = store.skills.find((sk) => Object.values(sk.name)[0] === 'Rust')!
    expect(store.projects[0].skills[0].skill_id).toBe(rust.id)
  })

  it('survives a project skill with no name at all', () => {
    // A row with empty tags carries no name to match on; it must not throw and
    // must not be silently linked to whichever skill happens to be first.
    const store = importFromCVPartner({
      technologies: [{
        _id: 'cat1', category: { en: 'Languages' },
        technology_skills: [{ _id: 'reg-go', tags: { en: 'Go' } }],
      }],
      project_experiences: [{
        _id: 'p1', customer: { en: 'AcmeCo' },
        project_experience_skills: [{ _id: 'ps1', tags: {} }],
      }],
    })
    expect(store.skills).toHaveLength(1)
    const go = store.skills[0]
    expect(store.projects[0].skills[0].skill_id).not.toBe(go.id)
  })

  it('survives a REGISTRY skill with no name at all', () => {
    // Reading a name off every registry entry to compare it is what makes an
    // unnamed one dangerous.
    const store = importFromCVPartner({
      technologies: [{
        _id: 'cat1', category: { en: 'Languages' },
        technology_skills: [{ _id: 'reg-blank', tags: {} }, { _id: 'reg-go', tags: { en: 'Go' } }],
      }],
      project_experiences: [{
        _id: 'p1', customer: { en: 'AcmeCo' },
        project_experience_skills: [{ _id: 'ps1', tags: { en: 'go' } }],
      }],
    })
    const go = store.skills.find((sk) => Object.values(sk.name)[0] === 'Go')!
    expect(store.projects[0].skills[0].skill_id).toBe(go.id)
  })
})

describe('importFromCVPartner — profile and project-role flags', () => {
  it('carries a profile’s flags, and defaults them when absent', () => {
    const store = importFromCVPartner({
      key_qualifications: [
        { label: { en: 'Lead' }, tag_line: { en: 'Architect' }, starred: true, disabled: true },
        { label: { en: 'Plain' } },
      ],
    })
    expect(store.key_qualifications[0]).toMatchObject({ starred: true, disabled: true })
    expect(store.key_qualifications[1]).toMatchObject({ starred: false, disabled: false })
  })

  it('carries a key point’s disabled flag onto the competency it becomes', () => {
    const store = importFromCVPartner({
      key_qualifications: [{
        label: { en: 'Lead' },
        key_points: [
          { name: { en: 'Cloud' }, long_description: { en: 'Ran it' }, disabled: true },
          { name: { en: 'Data' }, long_description: { en: 'Ran that too' } },
        ],
      }],
    })
    expect(store.key_competencies[0]).toMatchObject({ disabled: true })
    expect(store.key_competencies[1]).toMatchObject({ disabled: false })
  })

  it('carries a project role’s disabled flag, and defaults it when absent', () => {
    const store = importFromCVPartner({
      project_experiences: [{
        _id: 'p1', customer: { en: 'AcmeCo' },
        roles: [
          { _id: 'a', name: { en: 'Lead' }, disabled: true },
          { _id: 'b', name: { en: 'Dev' } },
        ],
      }],
    })
    expect(store.projects[0].roles.map((r) => r.disabled)).toEqual([true, false])
  })
})

/**
 * The two coercions every CVpartner field passes through.
 *
 * `localized()` handles the two shapes the export uses interchangeably, and a
 * real export mixes them within one file. `yearMonth()` reads dates that arrive
 * as strings, as numbers, or not at all. Both are total by design: a malformed
 * value must degrade to "nothing here", never throw — one bad field would
 * otherwise take the whole import down.
 */
describe('importFromCVPartner — the localized-value coercion', () => {
  const withCustomer = (customer: unknown) => importFromCVPartner({
    navn: 'Kari', project_experiences: [{ _id: 'p1', customer, year_from: '2020' }],
  } as never)

  it('reads the interleaved ARRAY shape, mapping int → en', () => {
    // Pairwise: locale, value, locale, value.
    expect(withCustomer(['no', 'Acme AS', 'int', 'Acme Ltd']).projects[0].customer)
      .toEqual({ no: 'Acme AS', en: 'Acme Ltd' })
  })

  it('reads the OBJECT shape, mapping int → en', () => {
    expect(withCustomer({ no: 'Acme AS', int: 'Acme Ltd' }).projects[0].customer)
      .toEqual({ no: 'Acme AS', en: 'Acme Ltd' })
  })

  it('reads a bare string as English', () => {
    expect(withCustomer('Acme').projects[0].customer).toEqual({ en: 'Acme' })
  })

  it('trims each value and drops the blank ones', () => {
    expect(withCustomer({ no: '  Acme AS  ', en: '   ' }).projects[0].customer)
      .toEqual({ no: 'Acme AS' })
    expect(withCustomer(['no', '  Acme  ', 'en', '']).projects[0].customer)
      .toEqual({ no: 'Acme' })
  })

  it('survives a non-string value in either shape rather than throwing', () => {
    // Real exports carry nulls and the occasional number; `.trim()` on one of
    // those would end the whole import.
    expect(() => withCustomer({ no: 42, en: null })).not.toThrow()
    expect(withCustomer({ no: 42, en: null } as never).projects[0].customer).toEqual({})
    expect(withCustomer(['no', 42, 'en', null] as never).projects[0].customer).toEqual({})
  })

  it('ignores a trailing half-pair in the array shape', () => {
    // An odd-length array is malformed; reading past the end must not invent a
    // locale keyed on undefined.
    expect(withCustomer(['no', 'Acme AS', 'en'] as never).projects[0].customer)
      .toEqual({ no: 'Acme AS' })
  })

  it('reads nothing at all as an empty map', () => {
    expect(withCustomer(null).projects[0].customer).toEqual({})
    expect(withCustomer(undefined).projects[0].customer).toEqual({})
    expect(withCustomer(42 as never).projects[0].customer).toEqual({})
  })
})

describe('importFromCVPartner — the date coercion', () => {
  const project = (over: Record<string, unknown>) => importFromCVPartner({
    navn: 'Kari', project_experiences: [{ _id: 'p1', customer: 'Acme', ...over }],
  } as never).projects[0]

  it('reads a year and month given as strings', () => {
    expect(project({ year_from: '2019', month_from: '06' }).start).toEqual({ year: 2019, month: 6 })
  })

  it('reads a year and month given as numbers', () => {
    expect(project({ year_from: 2019, month_from: 6 }).start).toEqual({ year: 2019, month: 6 })
  })

  it('reads a year with no month as year-only', () => {
    expect(project({ year_from: '2019' }).start).toEqual({ year: 2019, month: null })
    expect(project({ year_from: '2019', month_from: '' }).start).toEqual({ year: 2019, month: null })
  })

  it('reads a missing year as no date at all', () => {
    // Not year zero, and not NaN: the item simply has no start.
    expect(project({}).start).toBeNull()
    expect(project({ year_from: '' }).start).toBeNull()
  })
})

describe('importFromCVPartner — the locale list it declares', () => {
  const resumeOf = (raw: Record<string, unknown>) =>
    importFromCVPartner({ navn: 'Kari', ...raw } as never).resume!

  it('maps int → en in the declared list', () => {
    expect(resumeOf({ language_codes: ['no', 'int'] }).supported_locales).toEqual(['no', 'en'])
  })

  it('falls back to the single language_code, then to Norwegian', () => {
    expect(resumeOf({ language_code: 'se' }).supported_locales).toContain('se')
    expect(resumeOf({}).supported_locales).toEqual(['no', 'en'])
  })

  it('always includes en, and orders no → en → the rest', () => {
    // The resolution chain falls back to en, so a resume that never declares it
    // has a fallback locale it does not support.
    const locales = resumeOf({ language_codes: ['se', 'no'] }).supported_locales
    expect(locales).toEqual(['no', 'en', 'se'])
  })

  it('merges in a locale found only in the CONTENT', () => {
    // The export's own language list is unreliable — this is the case that
    // motivated scanning the content at all.
    const locales = resumeOf({
      language_codes: ['no'],
      project_experiences: [{ _id: 'p1', customer: { no: 'Acme', dk: 'Acme A/S' }, year_from: '2020' }],
    }).supported_locales
    expect(locales).toContain('dk')
  })

  it('lists each locale once however many times it appears', () => {
    const locales = resumeOf({
      language_codes: ['no', 'no', 'int'],
      project_experiences: [{ _id: 'p1', customer: { no: 'Acme' }, year_from: '2020' }],
    }).supported_locales
    expect(locales).toEqual([...new Set(locales)])
  })

  it('sets the default locale from the declared language code', () => {
    expect(resumeOf({ language_code: 'no' }).default_locale).toBe('no')
    expect(resumeOf({ language_code: 'int' }).default_locale).toBe('en')
    expect(resumeOf({}).default_locale).toBe('en')
  })
})

describe('importFromCVPartner — the derived project duration', () => {
  const skillDuration = (over: Record<string, unknown>) => importFromCVPartner({
    navn: 'Kari',
    project_experiences: [{
      _id: 'p1', customer: 'Acme', year_from: '2018', month_from: '01',
      project_experience_skills: [{ _id: 's1', tags: 'Go' }],
      ...over,
    }],
  } as never).projects[0].skills[0].duration_in_years

  it('measures a finished project from its own two dates', () => {
    expect(skillDuration({ year_to: '2020', month_to: '01' })).toBeCloseTo(2, 1)
  })

  it('runs an unfinished project up to today, whether the end is absent or BLANK', () => {
    // CVpartner writes an empty string for "still running", and `parseInt('')`
    // is NaN — a date built from it makes every derived duration NaN, which
    // then renders as an empty experience column.
    const absent = skillDuration({})
    const blank = skillDuration({ year_to: '' })
    expect(Number.isFinite(absent)).toBe(true)
    expect(Number.isFinite(blank)).toBe(true)
    expect(blank).toBeCloseTo(absent, 3)
    expect(blank).toBeGreaterThan(5)
  })

  it('never reports a negative duration for an end before the start', () => {
    expect(skillDuration({ year_to: '2010' })).toBe(0)
  })
})

describe('importFromCVPartner — the created_at it records', () => {
  it('keeps the export’s own timestamp when it has one', () => {
    const store = importFromCVPartner({ navn: 'Kari', created_at: '2019-03-04T10:00:00Z' } as never)
    expect(store.resume!.created_at).toBe('2019-03-04T10:00:00Z')
  })

  it('stamps now when the export carries none', () => {
    const store = importFromCVPartner({ navn: 'Kari' } as never)
    expect(typeof store.resume!.created_at).toBe('string')
    expect(Number.isNaN(Date.parse(store.resume!.created_at))).toBe(false)
  })
})

/**
 * The flags and orders each imported row lands with.
 *
 * CVpartner marks items disabled and starred, and orders them by an explicit
 * `order` field that is missing on plenty of real exports. Reading either one
 * wrongly is invisible in a diff and obvious in the editor: rows in the wrong
 * sequence, or a whole section that renders as empty because everything arrived
 * soft-deleted.
 */
describe('importFromCVPartner — flags and ordering', () => {
  const imported = (raw: Record<string, unknown>) => importFromCVPartner({ navn: 'Kari', ...raw } as never)

  it('honours an explicit order and falls back to the listed position', () => {
    const store = imported({
      project_experiences: [
        { _id: 'p1', customer: 'A', year_from: '2020', order: 5 },
        { _id: 'p2', customer: 'B', year_from: '2020' },
      ],
    })
    expect(store.projects.map((p) => p.sort_order)).toEqual([5, 0])
  })

  it('numbers project SKILLS by their listed position when none carries an order', () => {
    // `order: 0` and "no order" are the same thing in this format, so the
    // position is what separates two unordered rows.
    const store = imported({
      project_experiences: [{
        _id: 'p1', customer: 'A', year_from: '2020',
        project_experience_skills: [
          { _id: 's1', tags: 'Go' },
          { _id: 's2', tags: 'Rust' },
        ],
      }],
    })
    expect(store.projects[0].skills.map((s) => s.sort_order)).toEqual([0, 1])
  })

  it('imports every row enabled and unstarred unless the export says otherwise', () => {
    const store = imported({
      project_experiences: [{ _id: 'p1', customer: 'A', year_from: '2020' }],
      key_qualifications: [{ label: 'Profile', key_points: [{ name: 'A point' }] }],
    })
    expect(store.projects[0]).toMatchObject({ starred: false, disabled: false })
    expect(store.key_qualifications[0]).toMatchObject({ starred: false, disabled: false })
    expect(store.key_competencies[0]).toMatchObject({ starred: false, disabled: false })
  })

  it('carries a disabled or starred flag through when it is set', () => {
    const store = imported({
      project_experiences: [{ _id: 'p1', customer: 'A', year_from: '2020', disabled: true, starred: true }],
      key_qualifications: [{ label: 'P', starred: true, key_points: [{ name: 'A point', disabled: true }] }],
    })
    expect(store.projects[0]).toMatchObject({ starred: true, disabled: true })
    expect(store.key_qualifications[0].starred).toBe(true)
    expect(store.key_competencies[0].disabled).toBe(true)
  })

  it('reads a missing or blank end year as ONGOING', () => {
    const store = imported({
      project_experiences: [
        { _id: 'p1', customer: 'A', year_from: '2020' },
        { _id: 'p2', customer: 'B', year_from: '2020', year_to: '' },
        { _id: 'p3', customer: 'C', year_from: '2018', year_to: '2020', month_to: '06' },
      ],
    })
    expect(store.projects.map((p) => p.end)).toEqual([null, null, { year: 2020, month: 6 }])
  })
})

describe('importFromCVPartner — the sub-collections it leaves empty', () => {
  const imported = (raw: Record<string, unknown>) => importFromCVPartner({ navn: 'Kari', ...raw } as never)

  it('gives a project with no sub-rows empty lists, not seeded ones', () => {
    const p = imported({ project_experiences: [{ _id: 'p1', customer: 'A', year_from: '2020' }] }).projects[0]
    expect(p).toMatchObject({ roles: [], skills: [], industries: [], highlights: [] })
  })

  it('imports a profile with an empty bundle and no key points', () => {
    // Key points became the shared competency library (shape v12); the profile
    // keeps neither its own list nor a bundle until the user builds one.
    const kq = imported({ key_qualifications: [{ label: 'Profile' }] }).key_qualifications[0]
    expect(kq).toMatchObject({ key_points: [], competency_ids: [] })
  })

  it('keeps a key point that has a title but no description', () => {
    // Only an ENTIRELY empty point is skipped; dropping one that has a heading
    // loses a competency the consultant wrote.
    const store = imported({
      key_qualifications: [{
        label: 'P',
        key_points: [
          { name: 'Has a title only' },
          { long_description: 'Has a description only' },
          {},
        ],
      }],
    })
    expect(store.key_competencies).toHaveLength(2)
  })

  it('numbers the competencies upward across profiles', () => {
    const store = imported({
      key_qualifications: [
        { label: 'A', key_points: [{ name: 'One' }, { name: 'Two' }] },
        { label: 'B', key_points: [{ name: 'Three' }] },
      ],
    })
    expect(store.key_competencies.map((c) => c.sort_order)).toEqual([0, 1, 2])
  })
})

describe('importFromCVPartner — profiles and per-project details', () => {
  const imported = (raw: Record<string, unknown>) => importFromCVPartner({ navn: 'Kari', ...raw } as never)

  it('imports no profiles at all from an export that has none', () => {
    const store = imported({})
    expect(store.key_qualifications).toEqual([])
    expect(store.key_competencies).toEqual([])
  })

  it('honours the profile order, defaulting to zero', () => {
    const ordered = imported({ key_qualifications: [{ label: 'A', order: 5 }, { label: 'B', order: 3 }] })
    expect(ordered.key_qualifications.map((k) => k.sort_order)).toEqual([5, 3])

    const unordered = imported({ key_qualifications: [{ label: 'A' }] })
    expect(unordered.key_qualifications[0].sort_order).toBe(0)
  })

  it('carries the project country code, and nulls it when absent', () => {
    const store = imported({
      project_experiences: [
        { _id: 'p1', customer: 'A', year_from: '2020', location_country_code: 'NO' },
        { _id: 'p2', customer: 'B', year_from: '2020' },
      ],
    })
    expect(store.projects.map((p) => p.location_country_code)).toEqual(['NO', null])
  })
})

/**
 * The per-row flags every section carries, both ways round.
 *
 * `order`, `starred` and `disabled` are mapped identically in nine sections with
 * `(x as T) || fallback`, and nothing asserted them: a CV imported with every row
 * disabled is invisible in every export, and one imported with every row starred
 * fills a starred-only view with the whole CV. The fallback needs asserting in
 * both directions — the value when present, the default when not.
 */
describe('importFromCVPartner — the per-row flags in every section', () => {
  const FLAGGED: Record<string, Array<Record<string, unknown>>> = {
    project_experiences: [{ customer: 'Acme', order: 3, starred: true, disabled: true }],
    work_experiences: [{ employer: 'Cartavio', order: 3, starred: true, disabled: true }],
    educations: [{ school: 'NTNU', order: 3, starred: true, disabled: true }],
    courses: [{ name: 'Kubernetes', order: 3, starred: true, disabled: true }],
    certifications: [{ name: 'AWS SA', order: 3, starred: true, disabled: true }],
    languages: [{ name: 'Norwegian', order: 3, disabled: true }],
    positions: [{ name: 'Board member', order: 3, starred: true, disabled: true }],
    presentations: [{ description: 'A talk', order: 3, starred: true, disabled: true }],
    honors_awards: [{ name: 'Best paper', order: 3, starred: true, disabled: true }],
  }
  const bare = (rows: Array<Record<string, unknown>>) => rows.map((r) => {
    const copy = { ...r }
    delete copy.order
    delete copy.starred
    delete copy.disabled
    return copy
  })

  const SECTIONS: Array<[string, string]> = [
    ['project_experiences', 'projects'],
    ['work_experiences', 'work_experiences'],
    ['educations', 'educations'],
    ['courses', 'courses'],
    ['certifications', 'certifications'],
    ['languages', 'spoken_languages'],
    ['positions', 'positions'],
    ['presentations', 'presentations'],
    ['honors_awards', 'honor_awards'],
  ]
  const rows = (store: unknown, key: string) =>
    (store as Record<string, Array<Record<string, unknown>>>)[key]

  it.each(SECTIONS)('%s carries a set order/starred/disabled through', (rawKey, storeKey) => {
    const store = importFromCVPartner({ [rawKey]: FLAGGED[rawKey] })
    const row = rows(store, storeKey)[0]
    expect(row, rawKey).toBeDefined()
    expect(row.sort_order, `${rawKey}.sort_order`).toBe(3)
    expect(row.disabled, `${rawKey}.disabled`).toBe(true)
    if ('starred' in row) expect(row.starred, `${rawKey}.starred`).toBe(true)
  })

  it.each(SECTIONS)('%s defaults them when the export omits them', (rawKey, storeKey) => {
    const store = importFromCVPartner({ [rawKey]: bare(FLAGGED[rawKey]) })
    const row = rows(store, storeKey)[0]
    expect(row, rawKey).toBeDefined()
    expect(row.sort_order, `${rawKey}.sort_order`).toBe(0)
    expect(row.disabled, `${rawKey}.disabled`).toBe(false)
    if ('starred' in row) expect(row.starred, `${rawKey}.starred`).toBe(false)
  })

  it.each(SECTIONS)('%s imports nothing when the export omits the section', (rawKey, storeKey) => {
    // Every section reads `(raw.x as T[]) || []`; a fallback that is not empty
    // would invent a row out of an absent key.
    const store = importFromCVPartner({ default_cv: true })
    expect(rows(store, storeKey), rawKey).toEqual([])
  })
})

describe('importFromCVPartner — the supported-locale list', () => {
  it('reads the plural language_codes when present, mapping int to en', () => {
    const store = importFromCVPartner({ language_codes: ['no', 'int'], default_cv: true })
    expect([...store.resume!.supported_locales].sort()).toEqual(['en', 'no'])
  })

  it('falls back to the SINGULAR code when the plural list is absent', () => {
    const store = importFromCVPartner({ language_code: 'se', default_cv: true })
    expect(store.resume!.supported_locales).toContain('se')
  })

  it('falls back to Norwegian when neither is given', () => {
    // The export this importer exists for is a Norwegian product; guessing
    // English would mark every Norwegian field as an untranslated gap.
    const store = importFromCVPartner({ default_cv: true })
    expect(store.resume!.supported_locales).toContain('no')
  })

  it('always includes en, and merges in the locales found in the content', () => {
    const store = importFromCVPartner({
      language_codes: ['no'],
      project_experiences: [{ _id: 'p1', customer: { se: 'Kunden', no: 'Kunde' } }],
    })
    expect(store.resume!.supported_locales).toContain('en')
    expect(store.resume!.supported_locales).toContain('se')
  })
})

describe('importFromCVPartner — the interleaved localized array', () => {
  const first = (val: unknown) =>
    importFromCVPartner({ project_experiences: [{ customer: val }] }).projects[0].customer

  it('reads every PAIR, and ignores a dangling key at the end', () => {
    // The format is [locale, value, locale, value]; a truncated export leaves a
    // key with no value, and reading past it would key a locale on undefined.
    expect(first(['no', 'Norsk', 'int', 'English'])).toEqual({ no: 'Norsk', en: 'English' })
    expect(first(['no', 'Norsk', 'int'])).toEqual({ no: 'Norsk' })
  })

  it('drops a pair whose value is blank or not a string', () => {
    expect(first(['no', '   ', 'int', 'English'])).toEqual({ en: 'English' })
    expect(first(['no', 42, 'int', 'English'])).toEqual({ en: 'English' })
  })
})

/**
 * The coercions every CVpartner field passes through. Both are TOTAL by design:
 * a malformed value degrades to "nothing here" rather than throwing, because one
 * bad field would otherwise take the whole import down — and these exports carry
 * nulls, numbers where strings belong, and truncated arrays.
 */
describe('importFromCVPartner — the value coercions', () => {
  const customerOf = (customer: unknown) =>
    importFromCVPartner({ project_experiences: [{ customer }] }).projects[0].customer
  const projectOf = (over: Record<string, unknown>) =>
    importFromCVPartner({ project_experiences: [{ customer: 'Acme', ...over }] }).projects[0]

  it('reads the OBJECT shape as well as the array one, mapping int to en', () => {
    expect(customerOf({ no: 'Acme AS', int: 'Acme Ltd' })).toEqual({ no: 'Acme AS', en: 'Acme Ltd' })
  })

  it('reads a bare string as English, and anything else as nothing', () => {
    expect(customerOf('Acme')).toEqual({ en: 'Acme' })
    expect(customerOf(null)).toEqual({})
    expect(customerOf(undefined)).toEqual({})
    expect(customerOf(42)).toEqual({})
    expect(customerOf(true)).toEqual({})
  })

  it('trims each value and drops the blank and non-string ones', () => {
    expect(customerOf({ no: '  Acme AS  ', en: '   ', se: 42, dk: null })).toEqual({ no: 'Acme AS' })
  })

  it('reads a date given as a NUMBER, not only as a string', () => {
    // Both appear in real exports; parseInt on a number would work, but the
    // month is read through a different branch and a wrong one lands the item
    // in the wrong year on every date sort.
    expect(projectOf({ year_from: 2019, month_from: 6 }).start).toEqual({ year: 2019, month: 6 })
    expect(projectOf({ year_from: '2019', month_from: '06' }).start).toEqual({ year: 2019, month: 6 })
  })

  it('reads a year with no month as year-only, and no year as no date', () => {
    expect(projectOf({ year_from: '2019' }).start).toEqual({ year: 2019, month: null })
    expect(projectOf({ year_from: '2019', month_from: '' }).start).toEqual({ year: 2019, month: null })
    expect(projectOf({}).start).toBeNull()
    expect(projectOf({ year_from: '' }).start).toBeNull()
  })
})

describe('importFromCVPartner — the content locale scan', () => {
  const localesOf = (raw: Record<string, unknown>) =>
    importFromCVPartner({ language_codes: ['no'], ...raw }).resume!.supported_locales

  it('finds a locale nested several levels down', () => {
    // The scan recurses because the locale keys sit on leaf values, and the
    // export's own language list is the thing this exists to distrust.
    expect(localesOf({
      project_experiences: [{ customer: 'Acme', roles: [{ name: { dk: 'Arkitekt' } }] }],
    })).toContain('dk')
  })

  it('walks an ARRAY of objects, not only an object', () => {
    expect(localesOf({ project_experiences: [{ customer: { se: 'Kunden' } }] })).toContain('se')
  })

  it('ignores a locale key whose value is blank or not a string', () => {
    // A blank slot is not evidence the resume supports that language; adding it
    // marks every field in it as an untranslated gap.
    expect(localesOf({ project_experiences: [{ customer: { dk: '   ' } }] })).not.toContain('dk')
    expect(localesOf({ project_experiences: [{ customer: { dk: 42 } }] })).not.toContain('dk')
  })

  it('lists each locale once however many rows carry it', () => {
    const locales = localesOf({
      project_experiences: [{ customer: { se: 'A' } }, { customer: { se: 'B' } }],
    })
    expect(locales.filter((l) => l === 'se')).toHaveLength(1)
    expect(locales).toEqual([...new Set(locales)])
  })
})

describe('importFromCVPartner — the numbers on a project skill', () => {
  const skillOf = (ps: Record<string, unknown>) => importFromCVPartner({
    project_experiences: [{ customer: 'Acme', project_experience_skills: [{ tags: { no: 'Go' }, ...ps }] }],
  }).skills[0]

  it('carries a declared duration and proficiency', () => {
    const s = skillOf({ total_duration_in_years: 4, proficiency: 3 })
    expect(s.total_duration_in_years).toBe(4)
    expect(s.proficiency).toBe(3)
  })

  it('defaults both to zero when the export omits them', () => {
    // CVpartner exports often carry proficiency 0 across the board; the default
    // has to be the same zero rather than undefined, which would render blank.
    const s = skillOf({})
    expect(s.total_duration_in_years).toBe(0)
    expect(s.proficiency).toBe(0)
  })
})

describe('importFromCVPartner — the skill category order', () => {
  it('takes the export order when given, and falls back to the position', () => {
    const store = importFromCVPartner({
      technologies: [
        { category: { no: 'Skyer' }, order: 7, technology_skills: [{ tags: { no: 'Go' } }] },
        { category: { no: 'Språk' }, technology_skills: [{ tags: { no: 'Rust' } }] },
      ],
    })
    const orders = (store.skill_categories ?? []).map((c) => c.sort_order)
    expect(orders).toEqual([7, 1])
  })

  it('keeps an explicit order of ZERO rather than treating it as missing', () => {
    // `?? index`, not `|| index`: the first category legitimately has order 0,
    // and `||` would renumber it to its array position.
    const store = importFromCVPartner({
      technologies: [
        { category: { no: 'A' }, order: 0, technology_skills: [{ tags: { no: 'Go' } }] },
      ],
    })
    expect((store.skill_categories ?? [])[0].sort_order).toBe(0)
  })
})

/**
 * What a freshly imported store starts life with.
 *
 * Every row here is written out by hand, and the fields nothing in the export
 * feeds — the empty link lists, the flags, the sections CVpartner has no source
 * for — were the ones nothing asserted. Each is load-bearing: a seeded link list
 * points at a registry entry that does not exist and every renderer resolves
 * those ids, and a section that arrives with a row nobody wrote shows up in the
 * sidebar of a CV the consultant has not touched yet.
 */
describe('importFromCVPartner — the lists and flags a fresh import starts with', () => {
  it('leaves every section the CVpartner format cannot fill empty', () => {
    const store = importFromCVPartner({ navn: 'Kari' })
    expect(store.industries).toEqual([])
    expect(store.recommendations).toEqual([])
    expect(store.publications).toEqual([])
    expect(store.references).toEqual([])
    expect(store.views).toEqual([])
    expect(store.cover_letters).toEqual([])
    // No `technologies` block means no categories — not one nameless group.
    expect(store.skill_categories).toEqual([])
  })

  it('links a mapped row to nothing until the user does', () => {
    const store = importFromCVPartner({
      work_experiences: [{ _id: 'w1', employer: { en: 'Cartavio' }, year_from: '2019' }],
      courses: [{ _id: 'c1', name: { en: 'Kubernetes' }, year: '2021' }],
      certifications: [{ _id: 'ce1', name: { en: 'AWS SA' }, year: '2022' }],
    })
    expect(store.work_experiences[0].role_ids).toEqual([])
    expect(store.courses[0].skill_ids).toEqual([])
    expect(store.certifications[0].skill_ids).toEqual([])
  })

  it('imports an education as a home-campus degree, not an exchange term', () => {
    // `exchange` prints an extra line in every export, and CVpartner has no
    // field for it — setting it makes the CV state something it never said.
    const store = importFromCVPartner({
      educations: [{ _id: 'e1', school: { en: 'NTNU' }, degree: { en: 'MSc' } }],
    })
    expect(store.educations[0].exchange).toBe(false)
  })

  it('creates no skills for a technology group that lists none', () => {
    // The group still becomes a category; inventing a nameless skill inside it
    // puts a blank row in the Skills Showcase the user cannot explain.
    const store = importFromCVPartner({
      technologies: [{ _id: 'cat1', category: { en: 'Languages' } }],
    })
    expect(store.skill_categories).toHaveLength(1)
    expect(store.skills).toEqual([])
  })
})
