import { describe, it, expect } from 'vitest'
import {
  appendLocalized, buildRoleParagraph, foldRoleDescriptions,
  extractKeyPointsToCompetencies, defaultEmploymentRoleLinks, internProjectIndustries,
  migrateStore, isNewerShape, CURRENT_SHAPE_VERSION,
} from '../src/lib/migrate'
import { emptyStore, makeProject, makeWork } from './fixtures'
import type { ProjectRole, KeyQualification, KeyPoint, WorkExperience, Project, LocalizedString } from '../src/types'

/** A project carrying the pre-v4 single `industry`/`industry_id` pair. */
function legacyProject(id: string, industry: LocalizedString, industryId: string | null = null): Project {
  return { ...makeProject({ id }), industry, industry_id: industryId } as unknown as Project
}

// A ProjectRole carrying the legacy free-text fields that older saves had.
type LegacyRole = ProjectRole & { long_description?: Record<string, string>; summary?: Record<string, string> }

function legacyRole(over: Partial<LegacyRole> = {}): LegacyRole {
  return {
    id: 'pr-1', role_id: 'r-1', name: {}, sort_order: 0, disabled: false,
    long_description: {}, summary: {},
    ...over,
  }
}

describe('appendLocalized()', () => {
  it('joins non-empty values per locale with a blank line', () => {
    const out = appendLocalized({ en: 'First' }, { en: 'Second', no: 'Andre' })
    expect(out.en).toBe('First\n\nSecond')
    expect(out.no).toBe('Andre')
  })

  it('ignores empty / whitespace additions', () => {
    const out = appendLocalized({ en: 'First' }, { en: '   ', no: '' })
    expect(out.en).toBe('First')
    expect(out.no).toBeUndefined()
  })

  it('returns a copy of base when addition is undefined', () => {
    const base = { en: 'Only' }
    const out = appendLocalized(base, undefined)
    expect(out).toEqual(base)
    expect(out).not.toBe(base)
  })
})

describe('buildRoleParagraph()', () => {
  it('prefixes the role name and combines long_description + summary', () => {
    const out = buildRoleParagraph({
      name: { en: 'Architect' },
      long_description: { en: 'Designed it.' },
      summary: { en: 'In short, led design.' },
    })
    expect(out.en).toBe('Architect: Designed it.\n\nIn short, led design.')
  })

  it('omits locales that have no role text', () => {
    const out = buildRoleParagraph({ name: { en: 'Dev', no: 'Utvikler' }, long_description: { en: 'Built things.' } })
    expect(out.en).toBe('Dev: Built things.')
    expect(out.no).toBeUndefined()
  })

  it('falls back to bare text when no name for that locale', () => {
    const out = buildRoleParagraph({ name: {}, long_description: { en: 'Did work.' } })
    expect(out.en).toBe('Did work.')
  })
})

describe('foldRoleDescriptions()', () => {
  it('folds legacy role text into the project long_description and strips the fields', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      long_description: { en: 'Background.' },
      roles: [legacyRole({ name: { en: 'Lead' }, long_description: { en: 'Ran the team.' } })],
    }))

    const out = foldRoleDescriptions(store)
    expect(out.projects[0].long_description.en).toBe('Background.\n\nLead: Ran the team.')
    const role = out.projects[0].roles[0] as LegacyRole
    expect('long_description' in role).toBe(false)
    expect('summary' in role).toBe(false)
    // Registry linkage and identity are preserved.
    expect(role.id).toBe('pr-1')
    expect(role.role_id).toBe('r-1')
  })

  it('is idempotent — running twice does not duplicate text', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      long_description: {},
      roles: [legacyRole({ name: { en: 'Lead' }, long_description: { en: 'Ran the team.' } })],
    }))
    const once  = foldRoleDescriptions(store)
    const twice = foldRoleDescriptions(once)
    expect(twice.projects[0].long_description.en).toBe('Lead: Ran the team.')
    // Second pass is a true no-op: same reference back.
    expect(twice).toBe(once)
  })

  it('returns the same store reference when no roles carry legacy fields', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      roles: [{ id: 'pr-1', role_id: 'r-1', name: { en: 'Dev' }, sort_order: 0, disabled: false }],
    }))
    expect(foldRoleDescriptions(store)).toBe(store)
  })

  it('handles multiple locales independently', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      long_description: { en: 'EN bg.', no: 'NO bg.' },
      roles: [legacyRole({
        name: { en: 'Lead', no: 'Leder' },
        long_description: { en: 'Did EN.', no: 'Gjorde NO.' },
      })],
    }))
    const out = foldRoleDescriptions(store)
    expect(out.projects[0].long_description.en).toBe('EN bg.\n\nLead: Did EN.')
    expect(out.projects[0].long_description.no).toBe('NO bg.\n\nLeder: Gjorde NO.')
  })
})

// Build a KQ carrying the legacy key_points sub-list that older imports left
// behind. Only `key_points` is varied here — the rest is plumbing.
function kqWithPoints(points: Partial<KeyPoint>[]): KeyQualification {
  const filled: KeyPoint[] = points.map((p, i) => ({
    id: `kp-${i}`,
    name: {},
    long_description: {},
    sort_order: i,
    disabled: false,
    ...p,
  }))
  return {
    id: `kq-${Math.random().toString(36).slice(2, 8)}`,
    resume_id: 'r1',
    label: { en: 'Profile' },
    tag_line: {},
    summary: { en: 'Summary' },
    key_points: filled,
    skill_tags: [],
    sort_order: 0,
    starred: false,
    disabled: false,
    internal_notes: null,
  }
}

describe('extractKeyPointsToCompetencies()', () => {
  it('promotes per-KQ key_points to the top-level key_competencies array', () => {
    const store = emptyStore()
    store.resume = { ...store.resume!, id: 'resume-1' }
    store.key_qualifications.push(kqWithPoints([
      { name: { en: 'Leadership' }, long_description: { en: 'Led teams' } },
      { name: { en: 'Architecture' }, long_description: { en: 'Designed systems' } },
    ]))

    const out = extractKeyPointsToCompetencies(store)
    expect(out.key_qualifications[0].key_points).toEqual([])
    expect(out.key_competencies).toHaveLength(2)
    expect(out.key_competencies[0].title.en).toBe('Leadership')
    expect(out.key_competencies[0].description.en).toBe('Led teams')
    expect(out.key_competencies[0].resume_id).toBe('resume-1')
    // Sort order is dense from zero.
    expect(out.key_competencies.map((c) => c.sort_order)).toEqual([0, 1])
  })

  it('drops entirely-empty key_points instead of carrying them over as blanks', () => {
    const store = emptyStore()
    store.key_qualifications.push(kqWithPoints([
      { name: {}, long_description: {} },
      { name: { en: 'Real' }, long_description: { en: 'value' } },
    ]))
    const out = extractKeyPointsToCompetencies(store)
    expect(out.key_competencies).toHaveLength(1)
    expect(out.key_competencies[0].title.en).toBe('Real')
  })

  it('appends to an existing key_competencies array without clobbering order', () => {
    const store = emptyStore()
    store.key_competencies.push({
      id: 'existing', resume_id: '', title: { en: 'Existing' }, description: {},
      sort_order: 5, starred: false, disabled: false,
    })
    store.key_qualifications.push(kqWithPoints([{ name: { en: 'New' } }]))
    const out = extractKeyPointsToCompetencies(store)
    expect(out.key_competencies).toHaveLength(2)
    // New entry's sort_order is strictly after the existing one so the UI
    // shows it at the bottom of the list rather than overlapping.
    expect(out.key_competencies[1].sort_order).toBe(6)
  })

  it('returns the same store reference when no KQ carries key_points', () => {
    const store = emptyStore()
    store.key_qualifications.push(kqWithPoints([]))
    expect(extractKeyPointsToCompetencies(store)).toBe(store)
  })

  it('is idempotent — running twice does not duplicate competencies', () => {
    const store = emptyStore()
    store.key_qualifications.push(kqWithPoints([{ name: { en: 'Once' } }]))
    const once  = extractKeyPointsToCompetencies(store)
    const twice = extractKeyPointsToCompetencies(once)
    expect(twice.key_competencies).toHaveLength(1)
    expect(twice).toBe(once)
  })
})

// ─── defaultEmploymentRoleLinks ────────────────────────────────────────────

describe('defaultEmploymentRoleLinks()', () => {
  it('backfills role_id: null on legacy work_experiences', () => {
    const store = emptyStore()
    // Strip the field as if this came from an older save.
    const legacy = makeWork() as Partial<WorkExperience>
    delete legacy.role_id
    store.work_experiences.push(legacy as WorkExperience)
    const out = defaultEmploymentRoleLinks(store)
    expect(out.work_experiences[0].role_id).toBe(null)
  })

  it('preserves an existing role_id when present', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ role_id: 'r-abc' }))
    const out = defaultEmploymentRoleLinks(store)
    expect(out.work_experiences[0].role_id).toBe('r-abc')
  })

  it('returns the same reference when nothing changed (idempotent)', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ role_id: null }))
    expect(defaultEmploymentRoleLinks(store)).toBe(store)
  })
})

// ─── migrateStore / shape versioning ─────────────────────────────────────────

describe('migrateStore() / isNewerShape()', () => {
  /** A store as an older (pre-versioning) build would have written it. */
  function legacyStore() {
    const store = emptyStore()
    delete store.shape_version // unstamped = shape v1
    store.projects.push(makeProject({
      long_description: {},
      roles: [legacyRole({ name: { en: 'Lead' }, long_description: { en: 'Ran the team.' } })],
    }))
    return store
  }

  it('runs the migration chain on unstamped data and stamps the result', () => {
    const out = migrateStore(legacyStore())
    expect(out.shape_version).toBe(CURRENT_SHAPE_VERSION)
    // The v1→v2 structural work actually happened.
    expect(out.projects[0].long_description.en).toBe('Lead: Ran the team.')
    expect('long_description' in out.projects[0].roles[0]).toBe(false)
  })

  it('returns the same reference for already-current data (zero work)', () => {
    const store = emptyStore() // fixtures stamp CURRENT_SHAPE_VERSION
    expect(migrateStore(store)).toBe(store)
  })

  it('never downgrades data stamped by a newer build — content and stamp untouched', () => {
    const store = emptyStore()
    store.shape_version = CURRENT_SHAPE_VERSION + 1
    const out = migrateStore(store)
    expect(out).toBe(store)
    expect(out.shape_version).toBe(CURRENT_SHAPE_VERSION + 1)
  })

  it('isNewerShape flags only versions above CURRENT', () => {
    const current = emptyStore()
    expect(isNewerShape(current)).toBe(false)

    const legacy = emptyStore()
    delete legacy.shape_version
    expect(isNewerShape(legacy)).toBe(false)

    const newer = emptyStore()
    newer.shape_version = CURRENT_SHAPE_VERSION + 1
    expect(isNewerShape(newer)).toBe(true)
  })

  it('does not mutate the input store', () => {
    const store = legacyStore()
    const before = JSON.stringify(store)
    migrateStore(store)
    expect(JSON.stringify(store)).toBe(before)
  })
})

// ─── internProjectIndustries (A8.1 registry, shape v4 multi-link) ─────────────

describe('internProjectIndustries()', () => {
  it('interns free-text industries into the registry (deduped) and links them via industries[]', () => {
    const store = emptyStore()
    store.industries = []
    store.projects.push(legacyProject('p1', { en: 'Finance' }))
    store.projects.push(legacyProject('p2', { en: 'finance' })) // case dupe
    store.projects.push(legacyProject('p3', { en: 'Energy' }))

    const out = internProjectIndustries(store)
    // Two registry entries: Finance (shared) + Energy.
    expect(out.industries).toHaveLength(2)
    const fin = out.industries.find((i) => i.name.en === 'Finance')!
    const p1 = out.projects.find((p) => p.id === 'p1')!
    const p2 = out.projects.find((p) => p.id === 'p2')!
    expect(p1.industries[0].industry_id).toBe(fin.id)
    expect(p2.industries[0].industry_id).toBe(fin.id) // case-insensitive dedupe → same id
    // legacy fields are stripped
    expect((p1 as unknown as Record<string, unknown>).industry_id).toBeUndefined()
    expect((p1 as unknown as Record<string, unknown>).industry).toBeUndefined()
  })

  it('gives a project with no industry text an empty industries[]', () => {
    const store = emptyStore()
    store.industries = []
    store.projects.push(legacyProject('p', {}))
    const out = internProjectIndustries(store)
    expect(out.industries).toHaveLength(0)
    expect(out.projects[0].industries).toEqual([])
  })

  it('converts a pre-v4 single industry_id link into industries[]', () => {
    const store = emptyStore()
    store.industries = [{ id: 'existing', resume_id: 'r', name: { en: 'Tech' }, sort_order: 0, disabled: false }]
    store.projects.push(legacyProject('p', { en: 'Tech' }, 'existing'))
    const out = internProjectIndustries(store)
    expect(out.industries).toHaveLength(1)
    expect(out.projects[0].industries).toHaveLength(1)
    expect(out.projects[0].industries[0].industry_id).toBe('existing')
  })

  it('is idempotent on already-v4 data (same reference)', () => {
    const store = emptyStore()
    store.industries = [{ id: 'i1', resume_id: 'r', name: { en: 'Finance' }, sort_order: 0, disabled: false }]
    store.projects.push(makeProject({ id: 'p', industries: [{ id: 'pi1', industry_id: 'i1', name: { en: 'Finance' }, sort_order: 0 }] }))
    const out = internProjectIndustries(store)
    expect(out.projects[0]).toBe(store.projects[0])
  })

  it('is reached by migrateStore: pre-v3 data gets a registry + industries[]', () => {
    const store = emptyStore()
    store.shape_version = 2
    store.industries = []
    store.projects.push(legacyProject('p', { en: 'Healthcare' }))
    const out = migrateStore(store)
    expect(out.shape_version).toBe(CURRENT_SHAPE_VERSION)
    expect(out.industries.some((i) => i.name.en === 'Healthcare')).toBe(true)
    expect(out.projects[0].industries[0].industry_id).toBeTruthy()
  })
})
