import { describe, it, expect } from 'vitest'
import {
  appendLocalized, buildRoleParagraph, foldRoleDescriptions,
  extractKeyPointsToCompetencies, migrateEmploymentShape, internProjectIndustries,
  internSkillCategories, unifyShowcaseCategories, localizeRecommenderTitles,
  unpinLegacyHeadingFont, ensureCoverLetters, migrateCourseDates, migrateBundleMembership, migratePresentationDates, migrateStore, isNewerShape, CURRENT_SHAPE_VERSION,
} from '../src/lib/migrate'
import { emptyStore, makeProject, makeWork, makeSkill, makeSkillCategory, makeView, makeCoverLetter, makeRecommendation, makeCourse, makeKQ, makeKeyCompetency, makePresentation } from './fixtures'
import type { ProjectRole, KeyQualification, KeyPoint, WorkExperience, Project, LocalizedString, Skill, ResumeStore } from '../src/types'

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

// ─── migrateEmploymentShape ─────────────────────────────────────────────────

describe('migrateEmploymentShape()', () => {
  it('converts a pre-v8 single role_id into role_ids[]', () => {
    const store = emptyStore()
    const legacy = makeWork() as Partial<WorkExperience> & { role_id?: string | null }
    delete (legacy as { role_ids?: unknown }).role_ids
    legacy.role_id = 'r-abc'
    store.work_experiences.push(legacy as WorkExperience)
    const out = migrateEmploymentShape(store)
    expect(out.work_experiences[0].role_ids).toEqual(['r-abc'])
  })

  it('yields [] when the legacy role_id was null / absent', () => {
    const store = emptyStore()
    const legacy = makeWork() as Partial<WorkExperience> & { role_id?: string | null }
    delete (legacy as { role_ids?: unknown }).role_ids
    legacy.role_id = null
    store.work_experiences.push(legacy as WorkExperience)
    const out = migrateEmploymentShape(store)
    expect(out.work_experiences[0].role_ids).toEqual([])
  })

  it('seeds company_size_national from the deprecated company_size', () => {
    const store = emptyStore()
    const legacy = makeWork({ company_size: '~50 employees' }) as WorkExperience
    delete (legacy as { company_size_national?: unknown }).company_size_national
    store.work_experiences.push(legacy)
    const out = migrateEmploymentShape(store)
    expect(out.work_experiences[0].company_size_national).toBe('~50 employees')
  })

  it('returns the same reference when nothing changed (idempotent)', () => {
    const store = emptyStore()
    store.work_experiences.push(makeWork({ role_ids: [], company_size: null }))
    expect(migrateEmploymentShape(store)).toBe(store)
  })
})

describe('localizeRecommenderTitles()', () => {
  it('wraps a legacy string title as { en: title }', () => {
    const store = emptyStore()
    const rec = makeRecommendation()
    ;(rec as unknown as { recommender_title: unknown }).recommender_title = 'CTO'
    store.recommendations.push(rec)
    const out = localizeRecommenderTitles(store)
    expect(out.recommendations[0].recommender_title).toEqual({ en: 'CTO' })
  })

  it('turns a null / absent title into {}', () => {
    const store = emptyStore()
    const withNull = makeRecommendation()
    ;(withNull as unknown as { recommender_title: unknown }).recommender_title = null
    const withAbsent = makeRecommendation()
    delete (withAbsent as Partial<typeof withAbsent>).recommender_title
    store.recommendations.push(withNull, withAbsent)
    const out = localizeRecommenderTitles(store)
    expect(out.recommendations[0].recommender_title).toEqual({})
    expect(out.recommendations[1].recommender_title).toEqual({})
  })

  it('leaves an already-localized title untouched (idempotent, same reference)', () => {
    const store = emptyStore()
    store.recommendations.push(makeRecommendation({ recommender_title: { en: 'CTO', no: 'Teknologidirektør' } }))
    expect(localizeRecommenderTitles(store)).toBe(store)
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

// ─── internSkillCategories (shape v5) ────────────────────────────────────────

describe('internSkillCategories()', () => {
  it('seeds skill_categories from the categories skills already use', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category: 'Frontend' }))
    store.skills.push(makeSkill({ id: 'b', name: { en: 'B' }, category: 'Cloud' }))
    store.skills.push(makeSkill({ id: 'c', name: { en: 'C' }, category: null }))
    const out = internSkillCategories(store)
    expect(out.skill_categories).toEqual(['Cloud', 'Frontend'])
  })

  it('unions with an existing list and is idempotent', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category: 'Frontend' }))
    store.skill_categories = ['Cloud'] // an empty (persisted) category
    const out = internSkillCategories(store)
    expect(out.skill_categories).toEqual(['Cloud', 'Frontend'])
    expect(internSkillCategories(out)).toBe(out) // no change → same reference
  })
})

// ─── unifyShowcaseCategories (shape v6 — Skills Showcase unification) ────────

/** A pre-v6 skill carrying the legacy free-text `category` field. */
function legacySkill(over: Partial<Skill> & { category?: string | null } = {}): Skill {
  return { ...makeSkill(over), category: over.category } as unknown as Skill
}

/** Attach a legacy `technology_categories[]` array onto a v4/v5 store, as a
 *  backup import or pre-migration save would carry it. */
function withLegacyTechCats(store: ResumeStore, techCats: unknown[]): ResumeStore {
  return { ...store, technology_categories: techCats } as unknown as ResumeStore
}

describe('unifyShowcaseCategories()', () => {
  it('creates entities from legacy technology_categories and links + highlights their skills', () => {
    const store = emptyStore()
    store.skill_categories = []
    store.skills.push(legacySkill({ id: 's1', name: { en: 'TypeScript' } }))
    store.skills.push(legacySkill({ id: 's2', name: { en: 'Go' } }))
    const withTechCats = withLegacyTechCats(store, [{
      id: 'tc1', name: { en: 'Languages' }, sort_order: 0,
      skills: [{ id: 'cs1', skill_id: 's1' }, { id: 'cs2', skill_id: 's2' }],
    }])

    const out = unifyShowcaseCategories(withTechCats)
    expect(out.skill_categories).toHaveLength(1)
    const cat = out.skill_categories![0]
    expect(cat.name.en).toBe('Languages')
    for (const s of out.skills) {
      expect(s.category_id).toBe(cat.id)
      expect(s.is_highlighted).toBe(true)
    }
    // Legacy key is gone.
    expect((out as unknown as Record<string, unknown>).technology_categories).toBeUndefined()
  })

  it('showcase membership wins over a differing registry category string', () => {
    const store = emptyStore()
    store.skills.push(legacySkill({ id: 's1', name: { en: 'TypeScript' }, category: 'Frontend' }))
    const withTechCats = withLegacyTechCats(store, [{
      id: 'tc1', name: { en: 'Languages' }, sort_order: 0,
      skills: [{ id: 'cs1', skill_id: 's1' }],
    }])
    const out = unifyShowcaseCategories(withTechCats)
    expect(out.skill_categories!.map((c) => c.name.en)).toEqual(['Languages'])
    expect(out.skills[0].category_id).toBe(out.skill_categories![0].id)
  })

  it('a registry category string (no showcase membership) becomes its own entity', () => {
    const store = emptyStore()
    store.skills.push(legacySkill({ id: 's1', name: { en: 'TypeScript' }, category: 'Frontend' }))
    const out = unifyShowcaseCategories(store)
    expect(out.skill_categories!.map((c) => c.name.en)).toEqual(['Frontend'])
    expect(out.skills[0].category_id).toBe(out.skill_categories![0].id)
    expect(out.skills[0].is_highlighted).toBe(false) // not from a showcase group
    expect((out.skills[0] as unknown as Record<string, unknown>).category).toBeUndefined()
  })

  it('skips a disabled legacy category entirely — no entity, no highlighting', () => {
    const store = emptyStore()
    store.skills.push(legacySkill({ id: 's1', name: { en: 'COBOL' } }))
    const withTechCats = withLegacyTechCats(store, [{
      id: 'tc1', name: { en: 'Legacy' }, sort_order: 0, disabled: true,
      skills: [{ id: 'cs1', skill_id: 's1' }],
    }])
    const out = unifyShowcaseCategories(withTechCats)
    expect(out.skill_categories).toHaveLength(0)
    expect(out.skills[0].category_id).toBeNull()
    expect(out.skills[0].is_highlighted).toBe(false)
  })

  it('rewrites view excluded_item_ids from the old TechnologyCategory id to the new SkillCategory id', () => {
    const store = emptyStore()
    store.views.push(makeView({ excluded_item_ids: ['tc1', 'some-other-id'] }))
    const withTechCats = withLegacyTechCats(store, [
      { id: 'tc1', name: { en: 'Languages' }, sort_order: 0, skills: [] },
    ])
    const out = unifyShowcaseCategories(withTechCats)
    const newId = out.skill_categories![0].id
    expect(out.views[0].excluded_item_ids).toEqual([newId, 'some-other-id'])
  })

  it('preserves legacy showcase group order ahead of any leftover skill_categories', () => {
    const store = emptyStore()
    store.skill_categories = ['Zzz-leftover'] as unknown as ResumeStore['skill_categories']
    const withTechCats = withLegacyTechCats(store, [
      { id: 'tc1', name: { en: 'First' }, sort_order: 0, skills: [] },
      { id: 'tc2', name: { en: 'Second' }, sort_order: 1, skills: [] },
    ])
    const out = unifyShowcaseCategories(withTechCats)
    expect(out.skill_categories!.map((c) => c.name.en)).toEqual(['First', 'Second', 'Zzz-leftover'])
  })

  it('is idempotent — running twice does not duplicate categories or re-flip highlighting', () => {
    const store = emptyStore()
    store.skills.push(legacySkill({ id: 's1', name: { en: 'TypeScript' } }))
    const withTechCats = withLegacyTechCats(store, [{
      id: 'tc1', name: { en: 'Languages' }, sort_order: 0,
      skills: [{ id: 'cs1', skill_id: 's1' }],
    }])
    const once = unifyShowcaseCategories(withTechCats)
    const twice = unifyShowcaseCategories(once)
    expect(twice.skill_categories).toHaveLength(1)
    expect(twice.skills[0].is_highlighted).toBe(true)
    expect(twice).toBe(once) // true no-op on already-v6 data
  })

  it('returns the same reference for already-current (all-entity, no legacy) data', () => {
    const store = emptyStore()
    store.skill_categories = [makeSkillCategory({ name: { en: 'Cloud' } })]
    store.skills.push(makeSkill({ category_id: store.skill_categories[0].id }))
    expect(unifyShowcaseCategories(store)).toBe(store)
  })

  it('upgrades a bare v5 string[] skill_categories into entities with no legacy tech cats', () => {
    const store = emptyStore()
    store.skill_categories = ['Cloud', 'Frontend'] as unknown as ResumeStore['skill_categories']
    const out = unifyShowcaseCategories(store)
    expect(out.skill_categories!.map((c) => c.name.en).sort()).toEqual(['Cloud', 'Frontend'])
  })

  it('is reached end-to-end by migrateStore on legacy pre-v6 data', () => {
    const store = emptyStore()
    store.shape_version = 4
    store.skills.push(legacySkill({ id: 's1', name: { en: 'TypeScript' } }))
    const withTechCats = withLegacyTechCats(store, [{
      id: 'tc1', name: { en: 'Languages' }, sort_order: 0,
      skills: [{ id: 'cs1', skill_id: 's1' }],
    }])
    const out = migrateStore(withTechCats)
    expect(out.shape_version).toBe(CURRENT_SHAPE_VERSION)
    expect(out.skill_categories!.some((c) => c.name.en === 'Languages')).toBe(true)
    expect(out.skills[0].is_highlighted).toBe(true)
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

describe('unpinLegacyHeadingFont() — shape v9', () => {
  /**
   * A view as saved before fonts were configurable: `heading_font` carries the
   * old hardcoded default and `body_font` doesn't exist yet.
   */
  function preFontView(headingFont: string) {
    const v = makeView()
    v.style = { density: 'normal', body_size: 'normal', heading_font: headingFont } as never
    return v
  }

  it("rewrites the old baked-in default to 'inherit' so the global font reaches it", () => {
    const store = emptyStore()
    store.views.push(preFontView('condensed'))
    const out = unpinLegacyHeadingFont(store)
    expect(out.views[0].style?.heading_font).toBe('inherit')
  })

  it('keeps a heading font the user deliberately chose pre-v9', () => {
    const store = emptyStore()
    store.views.push(preFontView('serif'))
    const out = unpinLegacyHeadingFont(store)
    expect(out.views[0].style?.heading_font).toBe('serif')
    expect(out.views[0]).toBe(store.views[0]) // untouched
  })

  it("leaves a post-v9 view alone — 'condensed' there is an explicit pick", () => {
    const store = emptyStore()
    const v = makeView()
    v.style = { heading_font: 'condensed', body_font: 'inherit' } as never
    store.views.push(v)
    const out = unpinLegacyHeadingFont(store)
    expect(out).toBe(store) // body_font present ⇒ not legacy ⇒ no change at all
  })

  it('is idempotent (running twice changes nothing further)', () => {
    const store = emptyStore()
    store.views.push(preFontView('condensed'))
    const once = unpinLegacyHeadingFont(store)
    const twice = unpinLegacyHeadingFont(once)
    expect(twice).toBe(once) // same reference — second pass is a no-op
  })

  it('tolerates a view with no style at all', () => {
    const store = emptyStore()
    const v = makeView()
    delete (v as { style?: unknown }).style
    store.views.push(v)
    expect(() => unpinLegacyHeadingFont(store)).not.toThrow()
  })

  it('is reached by migrateStore for v8 data', () => {
    const store = emptyStore()
    store.shape_version = 8
    store.views.push(preFontView('condensed'))
    const out = migrateStore(store)
    expect(out.shape_version).toBe(CURRENT_SHAPE_VERSION)
    expect(out.views[0].style?.heading_font).toBe('inherit')
  })
})

describe('ensureCoverLetters() — shape v10', () => {
  it('adds an empty cover_letters array when absent', () => {
    const store = emptyStore()
    delete (store as { cover_letters?: unknown }).cover_letters
    const out = ensureCoverLetters(store)
    expect(out.cover_letters).toEqual([])
  })

  it('leaves an existing array untouched (same reference — idempotent)', () => {
    const store = emptyStore()
    store.cover_letters = [makeCoverLetter({ name: 'Keep me' })]
    expect(ensureCoverLetters(store)).toBe(store)
  })

  it('is reached by migrateStore for pre-v10 data', () => {
    const store = emptyStore()
    store.shape_version = 9
    delete (store as { cover_letters?: unknown }).cover_letters
    const out = migrateStore(store)
    expect(out.shape_version).toBe(CURRENT_SHAPE_VERSION)
    expect(out.cover_letters).toEqual([])
  })
})

describe('migrateCourseDates (v11)', () => {
  it('seeds end from the legacy completed date and leaves start blank', () => {
    const store = emptyStore()
    const legacy = { ...makeCourse({ id: 'c1', name: { en: 'K8s' } }) } as Record<string, unknown>
    delete legacy.start
    delete legacy.end
    legacy.completed = { year: 2022, month: 3 }
    store.courses = [legacy as never]
    const out = migrateCourseDates(store)
    expect(out.courses[0].start).toBeNull()
    expect(out.courses[0].end).toEqual({ year: 2022, month: 3 })
  })

  it('is idempotent — a course already carrying a range is untouched', () => {
    const store = emptyStore()
    store.courses = [makeCourse({ id: 'c1', start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 } })]
    const out = migrateCourseDates(store)
    expect(out).toBe(store) // same reference, no work
  })

  it('handles a legacy course with no completed date (both range ends null)', () => {
    const store = emptyStore()
    const legacy = { ...makeCourse({ id: 'c1' }) } as Record<string, unknown>
    delete legacy.start
    delete legacy.end
    store.courses = [legacy as never]
    const out = migrateCourseDates(store)
    expect(out.courses[0].start).toBeNull()
    expect(out.courses[0].end).toBeNull()
  })
})

describe('migratePresentationDates (v13)', () => {
  it('seeds end from the legacy single date and leaves start blank', () => {
    const store = emptyStore()
    const legacy = { ...makePresentation({ id: 'p1' }) } as Record<string, unknown>
    delete legacy.start
    delete legacy.end
    legacy.date = { year: 2021, month: 9 }
    store.presentations = [legacy as never]
    const out = migratePresentationDates(store)
    expect(out.presentations[0].start).toBeNull()
    expect(out.presentations[0].end).toEqual({ year: 2021, month: 9 })
  })

  it('is idempotent — a presentation already carrying a range is untouched', () => {
    const store = emptyStore()
    store.presentations = [makePresentation({ id: 'p1', start: { year: 2019, month: 1 }, end: { year: 2022, month: 6 } })]
    const out = migratePresentationDates(store)
    expect(out).toBe(store)
  })

  it('handles a legacy presentation with no date (both range ends null)', () => {
    const store = emptyStore()
    const legacy = { ...makePresentation({ id: 'p1' }) } as Record<string, unknown>
    delete legacy.start
    delete legacy.end
    delete legacy.date
    store.presentations = [legacy as never]
    const out = migratePresentationDates(store)
    expect(out.presentations[0].start).toBeNull()
    expect(out.presentations[0].end).toBeNull()
  })
})

describe('migrateBundleMembership (v12)', () => {
  // A competency as pre-v12 data had it: an editor-only `profile_id` grouping link.
  const legacyComp = (id: string, profile_id: string | null, sort_order = 0) =>
    ({ ...makeKeyCompetency({ id, sort_order }), profile_id }) as Record<string, unknown>
  // A profile as pre-v12 data had it: no `competency_ids` array yet.
  const preV12KQ = (id: string) => {
    const kq = { ...makeKQ({ id }) } as Record<string, unknown>
    delete kq.competency_ids
    return kq
  }

  it('collects each profile\'s competencies into competency_ids, ordered by sort_order', () => {
    const store = emptyStore()
    store.key_qualifications = [preV12KQ('p1'), preV12KQ('p2')] as never
    store.key_competencies = [
      legacyComp('c1', 'p1', 2),
      legacyComp('c2', 'p2', 0),
      legacyComp('c3', 'p1', 1),
      legacyComp('c4', null, 3), // unassigned — belongs to no bundle
    ] as never
    const out = migrateBundleMembership(store)
    const byId = Object.fromEntries(out.key_qualifications.map((q) => [q.id, q]))
    // p1 gets c3 (sort 1) before c1 (sort 2); p2 gets c2; unassigned c4 goes nowhere.
    expect(byId.p1.competency_ids).toEqual(['c3', 'c1'])
    expect(byId.p2.competency_ids).toEqual(['c2'])
    // The legacy link is stripped off every competency.
    expect(out.key_competencies.every((c) => !('profile_id' in (c as object)))).toBe(true)
  })

  it('guarantees a competency_ids array on every profile', () => {
    const store = emptyStore()
    store.key_qualifications = [preV12KQ('p1')] as never
    const out = migrateBundleMembership(store)
    expect(out.key_qualifications[0].competency_ids).toEqual([])
  })

  it('drops a competency whose profile_id names no existing profile', () => {
    const store = emptyStore()
    store.key_qualifications = [makeKQ({ id: 'p1' })]
    store.key_competencies = [legacyComp('c1', 'ghost')] as never
    const out = migrateBundleMembership(store)
    expect(out.key_qualifications[0].competency_ids).toEqual([])
  })

  it('unions onto any competency_ids already present, without duplicating', () => {
    const store = emptyStore()
    store.key_qualifications = [makeKQ({ id: 'p1', competency_ids: ['c1'] })]
    store.key_competencies = [legacyComp('c1', 'p1', 0), legacyComp('c2', 'p1', 1)] as never
    const out = migrateBundleMembership(store)
    expect(out.key_qualifications[0].competency_ids).toEqual(['c1', 'c2'])
  })

  it('is idempotent — bundles present and no profile_id yields the same reference', () => {
    const store = emptyStore()
    store.key_qualifications = [makeKQ({ id: 'p1', competency_ids: ['c1'] })]
    store.key_competencies = [makeKeyCompetency({ id: 'c1' })]
    expect(migrateBundleMembership(store)).toBe(store)
  })

  it('migrateStore runs it end-to-end and stamps the current shape', () => {
    const store = emptyStore()
    store.key_qualifications = [preV12KQ('p1')] as never
    store.key_competencies = [legacyComp('c1', 'p1')] as never
    delete (store as { shape_version?: number }).shape_version
    const out = migrateStore(store)
    expect(out.shape_version).toBe(CURRENT_SHAPE_VERSION)
    expect(out.key_qualifications[0].competency_ids).toEqual(['c1'])
  })
})
