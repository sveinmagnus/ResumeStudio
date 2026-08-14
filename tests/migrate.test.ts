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

  /**
   * The legacy fields are stripped whether or not they held anything, but only
   * text is folded in. A role carrying an EMPTY long_description must not add a
   * bare "Lead:" line to the project — which is what folding on key-presence
   * rather than on content would produce.
   */
  it('strips empty legacy fields without appending a heading for them', () => {
    const store = emptyStore()
    store.projects.push(makeProject({
      long_description: { en: 'EN bg.' },
      roles: [legacyRole({ name: { en: 'Lead' }, long_description: { en: '   ' }, summary: {} })],
    }))
    const out = foldRoleDescriptions(store)
    expect(out.projects[0].long_description.en).toBe('EN bg.')
    // …and the role is still rebuilt clean, so the migration is not a no-op.
    expect(out).not.toBe(store)
    expect('long_description' in out.projects[0].roles[0]).toBe(false)
  })

  it('folds a role that carries only a summary', () => {
    // Two legacy field names existed and EITHER alone must trigger the
    // migration. Written out rather than via legacyRole(), which always adds
    // both keys and so cannot tell the two conditions apart.
    const store = emptyStore()
    store.projects.push(makeProject({
      long_description: { en: 'EN bg.' },
      roles: [{
        id: 'pr-1', role_id: 'r-1', name: { en: 'Lead' }, sort_order: 0, disabled: false,
        summary: { en: 'Ran it.' },
      } as never],
    }))
    expect(foldRoleDescriptions(store).projects[0].long_description.en)
      .toContain('Ran it.')
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

  /**
   * The shape-sniff needs BOTH keys. A half-migrated course — one written by a
   * build that added `start` before `end` existed — must be finished, not
   * skipped, or its `completed` date is stranded and the course loses its date.
   */
  it('finishes a half-migrated course carrying only one of the two keys', () => {
    const store = emptyStore()
    const halfStart = { ...makeCourse({ id: 'c1' }) } as Record<string, unknown>
    delete halfStart.end
    halfStart.completed = { year: 2022, month: 3 }

    const halfEnd = { ...makeCourse({ id: 'c2' }) } as Record<string, unknown>
    delete halfEnd.start
    halfEnd.end = { year: 2021, month: 9 }
    // Both present: the range's own end must win over the legacy field.
    halfEnd.completed = { year: 1999, month: 1 }

    store.courses = [halfStart as never, halfEnd as never]
    const out = migrateCourseDates(store)
    expect(out).not.toBe(store)
    expect(out.courses[0].end).toEqual({ year: 2022, month: 3 })
    expect(out.courses[1].start).toBeNull()
    // An `end` already present wins over the legacy field.
    expect(out.courses[1].end).toEqual({ year: 2021, month: 9 })
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

  it('finishes a half-migrated presentation carrying only one of the two keys', () => {
    // Same sniff as Courses: one key present is not "already migrated", and
    // treating it as such strands the legacy date.
    const store = emptyStore()
    const half = { ...makePresentation({ id: 'p1' }) } as Record<string, unknown>
    delete half.end
    half.date = { year: 2021, month: 9 }
    store.presentations = [half as never]

    const out = migratePresentationDates(store)
    expect(out).not.toBe(store)
    expect(out.presentations[0].end).toEqual({ year: 2021, month: 9 })
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

describe('stripSkillTags (v14)', () => {
  /**
   * `skill_tags` was declared on ten entities, editable on one, and read by
   * nothing. Removing it from the types would leave the key in every stored
   * resume forever, so the migration strips it on load.
   */
  it('removes the key from every entity that carried it', () => {
    const store = emptyStore()
    store.projects = [{ ...makeProject(), skill_tags: ['cloud'] } as never]
    store.courses = [{ ...makeCourse(), skill_tags: [] } as never]

    const out = migrateStore({ ...store, shape_version: 13 })
    expect('skill_tags' in (out.projects[0] as object)).toBe(false)
    expect('skill_tags' in (out.courses[0] as object)).toBe(false)
    expect(out.shape_version).toBe(CURRENT_SHAPE_VERSION)
  })

  /** Everything else on the item survives — this only drops the one key. */
  it('leaves the rest of the item untouched', () => {
    const store = emptyStore()
    const project = { ...makeProject(), skill_tags: ['cloud'] } as never
    store.projects = [project]

    const out = migrateStore({ ...store, shape_version: 13 })
    expect(out.projects[0].customer).toEqual((project as unknown as { customer: unknown }).customer)
    expect(out.projects[0].id).toBe((project as unknown as { id: string }).id)
  })

  /** Idempotent shape-sniffer, like every other step in the chain. */
  it('is a no-op for a store that never had it', () => {
    const store = emptyStore()
    store.projects = [makeProject()]
    const out = migrateStore({ ...store, shape_version: 13 })
    expect(out.projects[0]).toBe(store.projects[0])
  })
})

/**
 * The two biggest migrations' remaining branches.
 *
 * migrateStore is the single choke point for data entering from outside (§8),
 * and these two rewrite REFERENCES — an id that lands wrong doesn't fail, it
 * quietly points a project at the wrong industry or a skill at the wrong
 * category, in data that is then saved over the original.
 */
describe('internProjectIndustries — the v3/v4 paths', () => {
  const proj = (over: Record<string, unknown>) =>
    ({ ...makeProject({ id: 'p1' }), ...over }) as never
  const run = (store: Partial<ResumeStore>) =>
    internProjectIndustries({ ...emptyStore(), ...store } as ResumeStore)

  it('snapshots the name from the REGISTRY when a v3 link resolves', () => {
    // The link is authoritative; the denormalized name on the project may be
    // stale, and taking it would freeze an outdated name into the snapshot.
    const out = run({
      industries: [{ id: 'i1', resume_id: 'r', name: { en: 'Banking' }, sort_order: 0, disabled: false }],
      projects: [proj({ industry_id: 'i1', industry: { en: 'Stale name' }, industries: undefined })],
    })
    expect(out.projects[0].industries).toHaveLength(1)
    expect(out.projects[0].industries[0]).toMatchObject({ industry_id: 'i1', name: { en: 'Banking' } })
  })

  it('falls back to the project’s own name when the link dangles', () => {
    const out = run({ projects: [proj({ industry_id: 'ghost', industry: { en: 'Banking' }, industries: undefined })] })
    expect(out.projects[0].industries[0]).toMatchObject({ industry_id: 'ghost', name: { en: 'Banking' } })
  })

  it('does not duplicate a link the project already carries', () => {
    const out = run({
      projects: [proj({
        industry_id: 'i1',
        industries: [{ id: 'x', industry_id: 'i1', name: { en: 'Banking' }, sort_order: 0 }],
      })],
    })
    expect(out.projects[0].industries).toHaveLength(1)
  })

  it('reuses an existing registry entry rather than interning a second one', () => {
    const out = run({
      industries: [{ id: 'i1', resume_id: 'r', name: { en: 'Banking' }, sort_order: 0, disabled: false }],
      projects: [proj({ industry: { en: 'banking' }, industries: undefined })],
    })
    expect(out.industries).toHaveLength(1)
    expect(out.projects[0].industries[0].industry_id).toBe('i1')
  })

  it('interns two projects naming the same industry ONCE', () => {
    const out = run({
      projects: [
        proj({ id: 'p1', industry: { en: 'Banking' }, industries: undefined }),
        { ...makeProject({ id: 'p2' }), industry: { en: 'Banking' }, industries: undefined } as never,
      ],
    })
    expect(out.industries).toHaveLength(1)
    expect(out.projects[0].industries[0].industry_id).toBe(out.projects[1].industries[0].industry_id)
  })

  it('strips the legacy fields whichever path ran', () => {
    const out = run({ projects: [proj({ industry_id: 'i1', industry: { en: 'B' }, industries: undefined })] })
    const raw = out.projects[0] as unknown as Record<string, unknown>
    expect('industry' in raw).toBe(false)
    expect('industry_id' in raw).toBe(false)
  })

  it('leaves a clean v4 project — and the whole store — untouched', () => {
    // Idempotence: the same reference back means a later save is not dirtied by
    // a migration that had nothing to do.
    const store = { ...emptyStore(), industries: [], projects: [makeProject({ id: 'p1' })] } as ResumeStore
    expect(internProjectIndustries(store)).toBe(store)
  })

  it('rewrites a store whose industries array is missing entirely', () => {
    const store = { ...emptyStore(), projects: [makeProject({ id: 'p1' })] } as ResumeStore
    delete (store as unknown as Record<string, unknown>).industries
    const out = internProjectIndustries(store)
    expect(out).not.toBe(store)
    expect(Array.isArray(out.industries)).toBe(true)
  })

  it('ignores a blank industry name rather than interning an unnamed entry', () => {
    const out = run({ projects: [proj({ industry: { en: '  ' }, industries: undefined })] })
    expect(out.industries).toHaveLength(0)
    expect(out.projects[0].industries).toHaveLength(0)
  })
})

describe('unifyShowcaseCategories — dedup, order and idempotence', () => {
  const run = (store: Partial<ResumeStore>, techCats?: unknown[]) => {
    const s = { ...emptyStore(), ...store } as ResumeStore
    if (techCats) (s as unknown as Record<string, unknown>).technology_categories = techCats
    return unifyShowcaseCategories(s)
  }

  it('keeps the curated showcase ORDER, with registry categories after', () => {
    // The showcase order is what the user arranged; appending it after the
    // alphabetical registry list would silently reshuffle their display.
    const out = run(
      { skills: [], skill_categories: ['Alpha'] as never },
      [
        { id: 't2', name: { en: 'Zulu' }, sort_order: 1, skills: [] },
        { id: 't1', name: { en: 'Mike' }, sort_order: 0, skills: [] },
      ],
    )
    expect(out.skill_categories.map((c) => c.name.en)).toEqual(['Mike', 'Zulu', 'Alpha'])
  })

  it('deduplicates a registry category that repeats a showcase group’s name', () => {
    // Both shapes reach this: a v5 string list AND an already-entity list that
    // a legacy showcase array is being merged into.
    const fromStrings = run({ skills: [], skill_categories: ['Mike'] as never },
      [{ id: 't1', name: { en: 'Mike' }, sort_order: 0, skills: [] }])
    expect(fromStrings.skill_categories).toHaveLength(1)

    const fromEntities = run(
      { skills: [], skill_categories: [makeSkillCategory({ id: 'c1', name: { en: 'Mike' } })] },
      [{ id: 't1', name: { en: 'Mike' }, sort_order: 0, skills: [] }],
    )
    expect(fromEntities.skill_categories).toHaveLength(1)
  })

  it('interns each distinct free-text skill category once', () => {
    const out = run({
      skills: [
        { ...makeSkill({ id: 's1' }), category: 'Backend' } as never,
        { ...makeSkill({ id: 's2' }), category: 'Backend' } as never,
        { ...makeSkill({ id: 's3' }), category: 'Frontend' } as never,
      ],
      skill_categories: [] as never,
    })
    expect(out.skill_categories.map((c) => c.name.en).sort()).toEqual(['Backend', 'Frontend'])
    expect(out.skills[0].category_id).toBe(out.skills[1].category_id)
    expect(out.skills[0].category_id).not.toBe(out.skills[2].category_id)
  })

  it('leaves an already-migrated store untouched, by reference', () => {
    const store = {
      ...emptyStore(),
      skills: [makeSkill({ id: 's1', category_id: 'c1' })],
      skill_categories: [makeSkillCategory({ id: 'c1', name: { en: 'Backend' } })],
    } as ResumeStore
    expect(unifyShowcaseCategories(store)).toBe(store)
  })

  it('drops the legacy string fields off every skill', () => {
    const out = run({
      skills: [{ ...makeSkill({ id: 's1' }), category: 'Backend', default_category: 'x' } as never],
      skill_categories: [] as never,
    })
    const raw = out.skills[0] as unknown as Record<string, unknown>
    expect('category' in raw).toBe(false)
    expect('default_category' in raw).toBe(false)
  })
})

/**
 * The migrations' text handling and per-field guards.
 *
 * Every one of these trims before deciding whether a value EXISTS. A migration
 * that treats "   " as content folds a blank field into a real one, producing a
 * description that opens with a stray separator — and it does that once,
 * destructively, in data that is then saved back.
 */
describe('migrate — text guards and per-field defaults', () => {
  describe('appendLocalized', () => {
    it('joins two paragraphs with a blank line between them', () => {
      expect(appendLocalized({ en: 'First.' }, { en: 'Second.' }).en).toBe('First.\n\nSecond.')
    })

    it('treats a whitespace-only addition as nothing', () => {
      expect(appendLocalized({ en: 'First.' }, { en: '   ' })).toEqual({ en: 'First.' })
    })

    it('treats a whitespace-only BASE as empty rather than joining onto it', () => {
      // Otherwise the result opens with two blank lines.
      expect(appendLocalized({ en: '   ' }, { en: 'Second.' }).en).toBe('Second.')
    })

    it('keeps each locale separate', () => {
      expect(appendLocalized({ en: 'A', no: 'X' }, { en: 'B' })).toEqual({ en: 'A\n\nB', no: 'X' })
    })

    it('adds a locale the base does not have', () => {
      expect(appendLocalized({ en: 'A' }, { no: 'Y' })).toEqual({ en: 'A', no: 'Y' })
    })
  })

  describe('buildRoleParagraph', () => {
    const role = (over: Record<string, unknown> = {}) => ({
      id: 'r1', name: { en: 'Architect' },
      long_description: { en: 'Led the design.' }, summary: { en: 'Summary.' },
      ...over,
    }) as never

    it('labels the paragraph with the role name and joins both bodies', () => {
      const out = buildRoleParagraph(role(), ['en'])
      expect(out.en).toBe('Architect: Led the design.\n\nSummary.')
    })

    it('omits the label when the role has no name', () => {
      // "': Led the design." is what a missing guard produces.
      expect(buildRoleParagraph(role({ name: {} }), ['en']).en).toBe('Led the design.\n\nSummary.')
    })

    it('treats a whitespace-only name as no name', () => {
      expect(buildRoleParagraph(role({ name: { en: '  ' } }), ['en']).en)
        .toBe('Led the design.\n\nSummary.')
    })

    it('drops a blank body rather than joining around it', () => {
      expect(buildRoleParagraph(role({ summary: { en: '   ' } }), ['en']).en)
        .toBe('Architect: Led the design.')
    })

    it('emits nothing for a locale with no body at all', () => {
      expect(buildRoleParagraph(role({ long_description: {}, summary: {} }), ['en'])).toEqual({})
    })
  })

  describe('foldRoleDescriptions keeps only roles with text', () => {
    const proj = (roles: unknown[]) => ({
      ...makeProject({ id: 'p1', long_description: {} }),
      roles,
    }) as never

    it('folds a role that has a body', () => {
      const out = foldRoleDescriptions({
        ...emptyStore(),
        projects: [proj([{ id: 'r1', role_id: 'x', name: { en: 'Architect' }, sort_order: 0, long_description: { en: 'Led it.' } }])],
      })
      expect(out.projects[0].long_description.en).toContain('Led it.')
    })

    it('ignores a role whose only text is whitespace', () => {
      const out = foldRoleDescriptions({
        ...emptyStore(),
        projects: [proj([{ id: 'r1', role_id: 'x', name: { en: 'Architect' }, sort_order: 0, long_description: { en: '   ' } }])],
      })
      expect(out.projects[0].long_description).toEqual({})
    })
  })

  describe('extractKeyPointsToCompetencies', () => {
    it('carries a key point’s disabled flag onto the competency', () => {
      // A point the user hid must not reappear as a visible competency.
      const store = {
        ...emptyStore(),
        key_qualifications: [makeKQ({
          id: 'kq1',
          key_points: [
            { id: 'a', name: { en: 'Kept' }, long_description: { en: 'x' }, sort_order: 0, disabled: false },
            { id: 'b', name: { en: 'Hidden' }, long_description: { en: 'y' }, sort_order: 1, disabled: true },
          ] as never,
        })],
      }
      const out = extractKeyPointsToCompetencies(store as never)
      const byTitle = Object.fromEntries(out.key_competencies.map((c) => [c.title.en, c]))
      expect(byTitle['Kept'].disabled).toBe(false)
      expect(byTitle['Hidden'].disabled).toBe(true)
    })

    it('defaults a missing disabled flag to false', () => {
      const store = {
        ...emptyStore(),
        key_qualifications: [makeKQ({
          id: 'kq1',
          key_points: [{ id: 'a', name: { en: 'Kept' }, long_description: { en: 'x' }, sort_order: 0 }] as never,
        })],
      }
      expect(extractKeyPointsToCompetencies(store as never).key_competencies[0].disabled).toBe(false)
    })

    it('skips a point whose text is only whitespace', () => {
      const store = {
        ...emptyStore(),
        key_qualifications: [makeKQ({
          id: 'kq1',
          key_points: [{ id: 'a', name: { en: '  ' }, long_description: { en: '  ' }, sort_order: 0, disabled: false }] as never,
        })],
      }
      expect(extractKeyPointsToCompetencies(store as never).key_competencies).toEqual([])
    })
  })

  describe('migrateEmploymentShape', () => {
    const work = (over: Record<string, unknown>) =>
      ({ ...makeWork({ id: 'w1' }), ...over }) as never

    it('promotes a legacy role_id into the role_ids array', () => {
      const w = { ...makeWork({ id: 'w1' }), role_id: 'r1' } as never
      delete (w as Record<string, unknown>).role_ids
      const out = migrateEmploymentShape({ ...emptyStore(), work_experiences: [w] })
      expect(out.work_experiences[0].role_ids).toEqual(['r1'])
    })

    it('produces an EMPTY array when there is no legacy role', () => {
      const w = { ...makeWork({ id: 'w1' }) } as never
      delete (w as Record<string, unknown>).role_ids
      const out = migrateEmploymentShape({ ...emptyStore(), work_experiences: [w] })
      expect(out.work_experiences[0].role_ids).toEqual([])
    })

    it('copies a legacy company_size across, but not a blank one', () => {
      const withSize = migrateEmploymentShape({
        ...emptyStore(),
        work_experiences: [work({ company_size: '50-100', company_size_national: undefined })],
      })
      expect(withSize.work_experiences[0].company_size_national).toBe('50-100')

      const blank = migrateEmploymentShape({
        ...emptyStore(),
        work_experiences: [work({ company_size: '   ', company_size_national: undefined })],
      })
      expect(blank.work_experiences[0].company_size_national).toBeUndefined()
    })

    it('leaves an already-migrated employment untouched, by reference', () => {
      const store = { ...emptyStore(), work_experiences: [makeWork({ id: 'w1' })] }
      expect(migrateEmploymentShape(store)).toBe(store)
    })
  })

  describe('internSkillCategories', () => {
    it('seeds the list from the categories skills already use', () => {
      const out = internSkillCategories({
        ...emptyStore(),
        skills: [{ ...makeSkill({ id: 's1' }), category: 'Backend' } as never],
        skill_categories: [] as never,
      })
      expect(out.skill_categories).toContain('Backend')
    })

    it('does not promote a whitespace-only category off a skill', () => {
      const out = internSkillCategories({
        ...emptyStore(),
        skills: [{ ...makeSkill({ id: 's1' }), category: '   ' } as never],
        skill_categories: [] as never,
      })
      expect(out.skill_categories).toEqual([])
    })

    it('returns the SAME store when it finds nothing new to add', () => {
      // Idempotence, not tidiness: rewriting an unchanged store dirties it and
      // that write goes back to the server. A pre-existing blank entry
      // therefore survives until an explicit edit, which is the right trade.
      const store = {
        ...emptyStore(),
        skills: [{ ...makeSkill({ id: 's1' }), category: '   ' } as never],
        skill_categories: ['  '] as never,
      }
      expect(internSkillCategories(store)).toBe(store)
    })

    it('unions with the existing list rather than replacing it', () => {
      const out = internSkillCategories({
        ...emptyStore(),
        skills: [{ ...makeSkill({ id: 's1' }), category: 'Backend' } as never],
        skill_categories: ['Frontend'] as never,
      })
      expect([...out.skill_categories].sort()).toEqual(['Backend', 'Frontend'])
    })
  })

  describe('localizedKey', () => {
    it('keys on the first non-empty value, lower-cased', () => {
      // The key is how two spellings of one name are recognised as the same, so
      // case must not matter and a blank slot must be skipped.
      const store = (name: Record<string, string>) => ({
        ...emptyStore(),
        industries: [{ id: 'i1', resume_id: 'r', name, sort_order: 0, disabled: false }],
        projects: [{ ...makeProject({ id: 'p1' }), industry: { en: 'BANKING' }, industries: undefined } as never],
      })
      // 'Banking' and 'BANKING' must intern to ONE entry.
      const out = internProjectIndustries(store({ en: 'Banking' }) as never)
      expect(out.industries).toHaveLength(1)

      const skipsBlank = internProjectIndustries(store({ en: '', no: 'Banking' }) as never)
      expect(skipsBlank.industries).toHaveLength(1)
    })
  })
})

/**
 * The shape-sniffing inside each migration.
 *
 * Migrations are idempotent sniffers (CLAUDE.md §8): they run on every load of
 * outside data and have to tell an already-migrated store from an old one without
 * a version to trust. These call the helpers directly, because `migrateStore`
 * gates each one on `shape_version` and would skip the sniffing under test.
 */
describe('internProjectIndustries — the legacy free-text field', () => {
  const store = (projects: unknown[], industries: unknown[] = []) => ({
    ...emptyStore(), projects, industries,
  }) as unknown as ResumeStore

  it('interns one entry per distinct name and links each project to it', () => {
    const out = internProjectIndustries(store([
      { ...makeProject({ id: 'p1' }), industry: { en: 'Energy' } },
      { ...makeProject({ id: 'p2' }), industry: { en: 'Energy' } },
      { ...makeProject({ id: 'p3' }), industry: { en: 'Retail' } },
    ]))
    expect(out.industries.map((i) => Object.values(i.name)[0]).sort()).toEqual(['Energy', 'Retail'])
    const energy = out.industries.find((i) => Object.values(i.name)[0] === 'Energy')!
    expect(out.projects[0].industries[0].industry_id).toBe(energy.id)
    expect(out.projects[1].industries[0].industry_id).toBe(energy.id)
  })

  it('carries the legacy name onto the link, not an empty one', () => {
    const out = internProjectIndustries(store([
      { ...makeProject({ id: 'p1' }), industry: { en: 'Energy', no: 'Energi' } },
    ]))
    expect(out.projects[0].industries[0].name).toEqual({ en: 'Energy', no: 'Energi' })
    expect(out.industries[0].name).toEqual({ en: 'Energy', no: 'Energi' })
  })

  it('adds no second link when the project already links that industry', () => {
    // A half-migrated project can carry both the legacy field and the array.
    const out = internProjectIndustries(store(
      [{
        ...makeProject({ id: 'p1' }),
        industry: { en: 'Energy' },
        industries: [{ id: 'link1', industry_id: 'reg-energy', name: { en: 'Energy' }, sort_order: 0 }],
      }],
      [{ id: 'reg-energy', resume_id: 'r1', name: { en: 'Energy' }, sort_order: 0, disabled: false }],
    ))
    expect(out.projects[0].industries.map((pi) => pi.industry_id)).toEqual(['reg-energy'])
  })

  it('adds the link when the project links a DIFFERENT industry already', () => {
    // The guard is per industry id, not "has any link at all" — otherwise one
    // unrelated link swallows the legacy field.
    const out = internProjectIndustries(store(
      [{
        ...makeProject({ id: 'p1' }),
        industry: { en: 'Energy' },
        industries: [{ id: 'link1', industry_id: 'reg-retail', name: { en: 'Retail' }, sort_order: 0 }],
      }],
      [{ id: 'reg-retail', resume_id: 'r1', name: { en: 'Retail' }, sort_order: 0, disabled: false }],
    ))
    const names = out.projects[0].industries.map((pi) => Object.values(pi.name)[0]).sort()
    expect(names).toEqual(['Energy', 'Retail'])
  })

  it('drops the legacy fields once the link exists', () => {
    const out = internProjectIndustries(store([
      { ...makeProject({ id: 'p1' }), industry: { en: 'Energy' }, industry_id: 'old' },
    ]))
    const raw = out.projects[0] as unknown as Record<string, unknown>
    expect('industry' in raw).toBe(false)
    expect('industry_id' in raw).toBe(false)
  })

  it('leaves a clean v4 project by reference', () => {
    const clean = { ...makeProject({ id: 'p1' }), industries: [] }
    const input = store([clean])
    expect(internProjectIndustries(input).projects[0]).toBe(clean)
  })

  it('leaves a project whose legacy field is empty with no industries', () => {
    const out = internProjectIndustries(store([{ ...makeProject({ id: 'p1' }), industry: {} }]))
    expect(out.industries).toEqual([])
    expect(out.projects[0].industries).toEqual([])
  })
})

describe('unifyShowcaseCategories — the shapes a category list can hold', () => {
  const store = (over: Record<string, unknown>) => ({
    ...emptyStore(), ...over,
  }) as unknown as ResumeStore

  it('turns a v5 string into an entity and links the skill that named it', () => {
    const out = unifyShowcaseCategories(store({
      skill_categories: ['Languages'],
      skills: [{ ...makeSkill({ id: 's1', name: { en: 'Go' } }), category: 'Languages' }],
    }))
    const cat = out.skill_categories!.find((c) => Object.values(c.name)[0] === 'Languages')!
    expect(cat).toBeTruthy()
    expect(out.skills[0].category_id).toBe(cat.id)
    expect('category' in (out.skills[0] as unknown as Record<string, unknown>)).toBe(false)
  })

  it('keeps an entity that already carries an id', () => {
    const out = unifyShowcaseCategories(store({
      skill_categories: [{ id: 'cat-1', resume_id: 'r1', name: { en: 'Platforms' }, sort_order: 0, disabled: false }],
      skills: [],
    }))
    expect(out.skill_categories!.map((c) => c.id)).toEqual(['cat-1'])
  })

  it('returns the store untouched when there is nothing legacy to convert', () => {
    // The sniffer's early-out: entities already, no showcase groups, no skill
    // carrying a category string. Rewriting here would churn every load.
    const input = store({
      skill_categories: [{ id: 'cat-1', resume_id: 'r1', name: { en: 'Languages' }, sort_order: 0, disabled: false }],
      skills: [makeSkill({ id: 's1', name: { en: 'Go' }, category_id: 'cat-1' })],
    })
    expect(unifyShowcaseCategories(input)).toBe(input)
  })

  it('keeps an id-bearing entity through a run that converts something else', () => {
    const out = unifyShowcaseCategories(store({
      skill_categories: [{ id: 'cat-1', resume_id: 'r1', name: { en: 'Platforms' }, sort_order: 0, disabled: false }],
      skills: [{ ...makeSkill({ id: 's1', name: { en: 'Go' } }), category: 'Languages' }],
    }))
    expect(out.skill_categories!.map((c) => c.id)).toContain('cat-1')
    expect(out.skill_categories!.map((c) => Object.values(c.name)[0]).sort())
      .toEqual(['Languages', 'Platforms'])
  })

  it('collapses two id-bearing entities that share a name', () => {
    // Two rows for "Platforms" would render as two identical group headings in
    // the showcase; the first one wins and the skills follow it.
    const out = unifyShowcaseCategories(store({
      skill_categories: [
        { id: 'cat-1', resume_id: 'r1', name: { en: 'Platforms' }, sort_order: 0, disabled: false },
        { id: 'cat-2', resume_id: 'r1', name: { en: 'Platforms' }, sort_order: 1, disabled: false },
      ],
      skills: [{ ...makeSkill({ id: 's1', name: { en: 'Go' } }), category: 'Languages' }],
    }))
    expect(out.skill_categories!.filter((c) => Object.values(c.name)[0] === 'Platforms'))
      .toHaveLength(1)
  })

  it('skips junk in the list while converting the rest', () => {
    // Only a trimmed string or an object with an id is a category; anything else
    // would become an entity with no usable name.
    const out = unifyShowcaseCategories(store({
      skill_categories: ['Languages', null, 42, '   ', { name: { en: 'No id here' } }],
      skills: [{ ...makeSkill({ id: 's1', name: { en: 'Go' } }), category: 'Platforms' }],
    }))
    expect(out.skill_categories!.map((c) => Object.values(c.name)[0]).sort())
      .toEqual(['Languages', 'Platforms'])
  })

  it('does not add a second entity for a name a showcase group already made', () => {
    const out = unifyShowcaseCategories(store({
      technology_categories: [{ id: 'tc1', name: { en: 'Languages' }, skills: [{ skill_id: 's1' }] }],
      skill_categories: [{ id: 'cat-1', resume_id: 'r1', name: { en: 'Languages' }, sort_order: 1, disabled: false }],
      skills: [makeSkill({ id: 's1', name: { en: 'Go' } })],
    }))
    const languages = out.skill_categories!.filter((c) => Object.values(c.name)[0] === 'Languages')
    expect(languages).toHaveLength(1)
    // The showcase group is the one that wins, and the skill points at it.
    expect(out.skills[0].category_id).toBe(languages[0].id)
  })

  it('keeps an entity whose name is empty rather than dropping the category', () => {
    const out = unifyShowcaseCategories(store({
      skill_categories: [{ id: 'cat-1', resume_id: 'r1', name: {}, sort_order: 0, disabled: false }],
      skills: [],
    }))
    expect(out.skill_categories!.map((c) => c.id)).toEqual(['cat-1'])
  })

  it('is idempotent — a second pass changes nothing', () => {
    const once = unifyShowcaseCategories(store({
      skill_categories: ['Languages'],
      skills: [{ ...makeSkill({ id: 's1', name: { en: 'Go' } }), category: 'Languages' }],
    }))
    const twice = unifyShowcaseCategories(JSON.parse(JSON.stringify(once)) as ResumeStore)
    expect(twice.skill_categories).toEqual(once.skill_categories)
    expect(twice.skills).toEqual(once.skills)
  })
})

describe('migrateStore — the legacy skill_tags field', () => {
  const withTags = (over: Record<string, unknown>) => ({
    ...emptyStore(), shape_version: 1, ...over,
  }) as unknown as ResumeStore

  it('removes skill_tags from every section that carried it', () => {
    const out = migrateStore(withTags({
      projects: [{ ...makeProject({ id: 'p1' }), skill_tags: ['go'] }],
      work_experiences: [{ ...makeWork({ id: 'w1' }), skill_tags: ['rust'] }],
    }))
    expect('skill_tags' in (out.projects[0] as unknown as Record<string, unknown>)).toBe(false)
    expect('skill_tags' in (out.work_experiences[0] as unknown as Record<string, unknown>)).toBe(false)
  })

  it('strips the field from the row that has it and keeps the row that does not', () => {
    const out = migrateStore(withTags({
      projects: [
        { ...makeProject({ id: 'p1' }), skill_tags: [] },
        makeProject({ id: 'p2' }),
      ],
    }))
    expect(out.projects.map((p) => p.id)).toEqual(['p1', 'p2'])
    for (const project of out.projects) {
      expect('skill_tags' in (project as unknown as Record<string, unknown>)).toBe(false)
    }
  })

  it('leaves a row that never carried the field BY REFERENCE', () => {
    // Rewriting a row that needed nothing makes every load look like an edit to
    // the auto-save layer.
    const clean = makeProject({ id: 'p2' })
    const out = migrateStore(withTags({
      projects: [{ ...makeProject({ id: 'p1' }), skill_tags: ['go'] }, clean],
    }))
    expect(out.projects[1]).toBe(clean)
  })

  it('leaves a whole section alone when no row carries the field', () => {
    // The array itself is untouched, not merely its contents: rebuilding it
    // would mark the section dirty on every load.
    const store = withTags({ projects: [makeProject({ id: 'p1' })] })
    const before = store.projects
    expect(migrateStore(store).projects).toBe(before)
  })
})

/**
 * Migrations run once against data nobody can re-create, so each guard is
 * asserted from both sides: it has to fire on the old shape AND leave the
 * current one alone.
 */
describe('foldRoleDescriptions — which legacy roles carry text worth keeping', () => {
  const withRole = (role: Record<string, unknown>): ResumeStore => ({
    ...emptyStore(),
    projects: [makeProject({
      id: 'p1', long_description: { en: 'Ran it.' },
      roles: [{ id: 'pr1', role_id: 'r1', name: { en: 'Architect' }, sort_order: 0, ...role } as never],
    })],
  })

  it('folds text from EITHER legacy field', () => {
    const fromLong = foldRoleDescriptions(withRole({ long_description: { en: 'Led the team.' } }))
    expect(fromLong.projects[0].long_description.en).toContain('Led the team.')

    const fromSummary = foldRoleDescriptions(withRole({ summary: { en: 'Led the team.' } }))
    expect(fromSummary.projects[0].long_description.en).toContain('Led the team.')
  })

  it('strips the legacy keys even when they hold nothing', () => {
    // The keys are what mark the row as old; leaving them means the migration
    // runs again on every load, and `changed` reports a mutation each time.
    const out = foldRoleDescriptions(withRole({ long_description: {}, summary: {} }))
    const role = out.projects[0].roles[0] as Record<string, unknown>
    expect('long_description' in role).toBe(false)
    expect('summary' in role).toBe(false)
    // Nothing was appended: the description is untouched.
    expect(out.projects[0].long_description.en).toBe('Ran it.')
  })

  it('treats a whitespace-only legacy value as nothing to fold', () => {
    const out = foldRoleDescriptions(withRole({ long_description: { en: '   ' } }))
    expect(out.projects[0].long_description.en).toBe('Ran it.')
  })

  it('needs only ONE locale to hold text', () => {
    const out = foldRoleDescriptions(withRole({ long_description: { en: '', no: 'Ledet laget.' } }))
    expect(out.projects[0].long_description.no).toContain('Ledet laget.')
  })
})

describe('internProjectIndustries — the v3 single link', () => {
  const store = (project: Record<string, unknown>, industries: unknown[] = []): ResumeStore => ({
    ...emptyStore(),
    industries: industries as never,
    projects: [makeProject({ id: 'p1', ...project } as never)],
  })

  it('snapshots the registry name for the linked industry', () => {
    const out = internProjectIndustries(store(
      { industry_id: 'i1', industries: undefined },
      [{ id: 'i1', resume_id: 'r', name: { en: 'Finance' }, sort_order: 0, starred: false, disabled: false }],
    ))
    expect(out.projects[0].industries).toEqual([
      expect.objectContaining({ industry_id: 'i1', name: { en: 'Finance' } }),
    ])
  })

  it('falls back to the denormalized name when the registry has no such row', () => {
    const out = internProjectIndustries(store(
      { industry_id: 'gone', industry: { en: 'Public sector' }, industries: undefined }))
    expect(out.projects[0].industries[0].name).toEqual({ en: 'Public sector' })
  })

  it('does not add a second link for an industry already listed', () => {
    // Idempotence: running the chain twice must not duplicate the link.
    const out = internProjectIndustries(store({
      industry_id: 'i1',
      industries: [{ id: 'pi1', industry_id: 'i1', name: { en: 'Finance' }, sort_order: 0 }],
    }))
    expect(out.projects[0].industries).toHaveLength(1)
  })

  it('DOES add the link when the list holds a different industry', () => {
    // The duplicate check has to compare ids: matching anything already present
    // would silently drop the v3 link on any project that had gained another.
    const out = internProjectIndustries(store({
      industry_id: 'i1',
      industry: { en: 'Finance' },
      industries: [{ id: 'pi1', industry_id: 'i2', name: { en: 'Public sector' }, sort_order: 0 }],
    }))
    expect(out.projects[0].industries.map((pi) => pi.industry_id).sort()).toEqual(['i1', 'i2'])
  })

  it('snapshots the name of the LINKED registry row, not the first one', () => {
    const out = internProjectIndustries(store(
      { industry_id: 'i2', industries: undefined },
      [
        { id: 'i1', resume_id: 'r', name: { en: 'Finance' }, sort_order: 0, starred: false, disabled: false },
        { id: 'i2', resume_id: 'r', name: { en: 'Public sector' }, sort_order: 1, starred: false, disabled: false },
      ],
    ))
    expect(out.projects[0].industries[0].name).toEqual({ en: 'Public sector' })
  })
})

describe('internSkillCategories — the legacy free-text category', () => {
  it('interns a category name off the skills, trimmed, once each', () => {
    const s: ResumeStore = {
      ...emptyStore(),
      skills: [
        { ...makeSkill({ id: 's1', name: { en: 'Go' } }), category: '  Languages  ' } as never,
        { ...makeSkill({ id: 's2', name: { en: 'Rust' } }), category: 'Languages' } as never,
        { ...makeSkill({ id: 's3', name: { en: 'Bash' } }), category: '   ' } as never,
      ],
    }
    // v5 stored the categories as a plain string list; v6's unify step turns
    // them into entities, so at THIS step they are still strings.
    const out = internSkillCategories(s)
    expect(out.skill_categories as unknown as string[]).toEqual(['Languages'])
  })

  it('trims a padded name in the pre-existing string list, and drops a blank one', () => {
    // v5 wrote whatever the user typed; a padded duplicate would intern twice and
    // a blank one would become a category with no name.
    const s: ResumeStore = {
      ...emptyStore(),
      skill_categories: ['  Languages  ', '   '] as never,
      skills: [{ ...makeSkill({ id: 's1', name: { en: 'Go' } }), category: 'Cloud' } as never],
    }
    // The padded entry and the new one both land trimmed; the blank one is gone.
    expect(internSkillCategories(s).skill_categories as unknown as string[]).toEqual(['Cloud', 'Languages'])
  })

  it('keeps the same store reference when there is nothing new to intern', () => {
    // Idempotence is what makes the chain safe to run on every load.
    const s: ResumeStore = {
      ...emptyStore(),
      skill_categories: ['Languages'] as never,
      skills: [{ ...makeSkill({ id: 's1', name: { en: 'Go' } }), category: 'Languages' } as never],
    }
    expect(internSkillCategories(s)).toBe(s)
  })

  it('leaves an ALREADY-migrated entity list alone', () => {
    // v6+ data holds SkillCategory entities here, not strings. Trimming one as a
    // string would throw and take the whole load down.
    const s: ResumeStore = {
      ...emptyStore(),
      skill_categories: [makeSkillCategory({ id: 'c1', name: { en: 'Languages' } })],
      skills: [makeSkill({ id: 's1', name: { en: 'Go' }, category_id: 'c1' })],
    }
    expect(() => internSkillCategories(s)).not.toThrow()
    expect(internSkillCategories(s)).toBe(s)
  })
})
