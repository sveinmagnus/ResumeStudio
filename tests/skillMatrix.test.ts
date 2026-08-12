import { describe, it, expect } from 'vitest'
import { skillMatrixRows, fmtLastUsed, fmtProficiency } from '../src/lib/skillMatrix'
import { buildViewHtml, buildViewSections } from '../src/lib/viewFilter'
import { emptyStore, makeProject, makeSkill, makeSkillCategory, makeView } from './fixtures'
import { xs } from '../src/lib/exportStrings'
import { fmtDate } from '../src/lib/locales'
import type { SkillMatrixRow } from '../src/lib/skillMatrix'
import type { ProjectSkill, ResumeStore } from '../src/types'

const ps = (skill_id: string, duration = 0): ProjectSkill => ({
  id: `ps-${skill_id}-${Math.random()}`, skill_id, name: {},
  duration_in_years: duration, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
})

function matrixStore() {
  const store = emptyStore()
  store.skills.push(makeSkill({
    id: 'ts', name: { en: 'TypeScript' }, total_duration_in_years: 8, proficiency: 5, is_highlighted: true,
  }))
  store.skills.push(makeSkill({
    id: 'go', name: { en: 'Go' }, total_duration_in_years: 0, proficiency: 0,
  }))
  store.skills.push(makeSkill({
    id: 'k8s', name: { en: 'Kubernetes' }, total_duration_in_years: 0, proficiency: 3,
  }))
  // Go: used in two projects with declared durations.
  store.projects.push(makeProject({
    id: 'p1', skills: [ps('go', 1.5)],
    start: { year: 2019, month: 1 }, end: { year: 2020, month: 6 },
  }))
  // K8s: no declared durations → derive from date span; still ongoing.
  store.projects.push(makeProject({
    id: 'p2', skills: [ps('go', 1), ps('k8s')],
    start: { year: 2021, month: 1 }, end: null,
  }))
  return store
}

describe('skillMatrixRows', () => {
  const rows = skillMatrixRows(matrixStore(), makeView(), 'en')
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]))

  it('uses the stored legacy total when the skill has no dated usage', () => {
    expect(byName['TypeScript'].years).toBe(8)
  })

  it('computes years from the union of project date spans (not declared per-skill durations)', () => {
    // Go spans p1 (2019-01..2020-06 = 1.5y) plus p2 (2021-01..ongoing), unioned
    // — well past the old declared-sum of 2.5.
    expect(byName['Go'].years).toBeGreaterThan(5)
  })

  it('derives years from project date spans when nothing is declared', () => {
    // 2021-01 → now, ongoing — at least 4 years as of 2026.
    expect(byName['Kubernetes'].years).toBeGreaterThan(3)
  })

  /** One skill used by two finished projects, in the order given. */
  const lastUsedOf = (ends: Array<{ year: number; month: number | null }>) => {
    const store = emptyStore()
    store.skills = [makeSkill({ id: 'sk', name: { en: 'Solo' }, total_duration_in_years: 0 })]
    store.projects = ends.map((end, i) => makeProject({
      id: `p${i}`, start: { year: end.year - 1, month: 1 }, end,
      skills: [{ skill_id: 'sk', name: { en: 'Solo' }, proficiency: 3 }],
    }))
    return skillMatrixRows(store, makeView({}), 'en')[0].lastUsed
  }

  it('picks the latest usage by month, not just by year', () => {
    // Two projects finishing in the SAME year: comparing years alone ties, and
    // "last used" then reports whichever happened to be listed first.
    expect(lastUsedOf([{ year: 2019, month: 3 }, { year: 2019, month: 9 }]))
      .toEqual({ year: 2019, month: 9 })
    expect(lastUsedOf([{ year: 2019, month: 9 }, { year: 2019, month: 3 }]))
      .toEqual({ year: 2019, month: 9 })
  })

  it('reads a year-only end as the start of that year, which still beats last December', () => {
    expect(lastUsedOf([{ year: 2018, month: 12 }, { year: 2019, month: null }]))
      .toEqual({ year: 2019, month: null })
  })

  it('marks ongoing usage and formats it', () => {
    expect(byName['Kubernetes'].ongoing).toBe(true)
    expect(fmtLastUsed(byName['Kubernetes'])).toBe('Ongoing')
    expect(byName['Go'].ongoing).toBe(true) // p2 is ongoing and uses Go
  })

  it('sorts highlighted first, then by years descending', () => {
    expect(rows[0].name).toBe('TypeScript')
  })

  it('respects view exclusions (legacy per-skill id)', () => {
    const rows2 = skillMatrixRows(matrixStore(), makeView({ excluded_item_ids: ['go'] }), 'en')
    expect(rows2.some((r) => r.name === 'Go')).toBe(false)
  })

  it('drops every skill in an excluded CATEGORY (the matrix toggles categories)', () => {
    const store = matrixStore()
    store.skill_categories = [makeSkillCategory({ id: 'cat-cloud', name: { en: 'Cloud' } })]
    store.skills.find((s) => s.id === 'k8s')!.category_id = 'cat-cloud'
    const rows2 = skillMatrixRows(store, makeView({ excluded_item_ids: ['cat-cloud'] }), 'en')
    expect(rows2.some((r) => r.name === 'Kubernetes')).toBe(false)
    // A skill in a different (non-excluded) category is unaffected.
    expect(rows2.some((r) => r.name === 'TypeScript')).toBe(true)
  })

  it('highlightedOnly keeps only highlighted skills (summary detail)', () => {
    const rows2 = skillMatrixRows(matrixStore(), makeView(), 'en', { highlightedOnly: true })
    expect(rows2.map((r) => r.name)).toEqual(['TypeScript'])
  })

  it('skips disabled projects when computing usage', () => {
    const store = matrixStore()
    store.projects.forEach((p) => { p.disabled = true })
    const rows2 = skillMatrixRows(store, makeView(), 'en')
    const go = rows2.find((r) => r.name === 'Go')!
    expect(go.years).toBe(0)
    expect(go.lastUsed).toBeNull()
  })
})

describe('fmtProficiency', () => {
  it.each([[0, ''], [3, '3/5'], [5, '5/5']])('%i → %j', (p, expected) => {
    expect(fmtProficiency(p)).toBe(expected)
  })
})

describe('skill matrix in buildViewHtml', () => {
  it('is off by default — no matrix table in a fresh view', () => {
    const html = buildViewHtml(matrixStore(), makeView({ sections: buildViewSections() }), 'en')
    // The .ve-matrix CSS rules always sit in the <style> block; assert the
    // table *element* (and its section wrapper) is absent instead.
    expect(html).not.toContain('<table class="ve-matrix"')
    expect(html).not.toContain('ve-sec-skill_matrix')
  })

  it('renders an escaped table when enabled', () => {
    const store = matrixStore()
    store.skills.push(makeSkill({ id: 'xss', name: { en: '<script>alert(1)</script>' } }))
    const sections = buildViewSections().map((s) =>
      s.key === 'skill_matrix' ? { ...s, detail: 'full' as const } : s,
    )
    const html = buildViewHtml(store, makeView({ sections }), 'en')
    expect(html).toContain('ve-matrix')
    expect(html).toContain('<th>Skill</th>')
    expect(html).toContain('TypeScript')
    expect(html).toContain('8 yrs')
    expect(html).toContain('5/5')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('shows an authoritative Category column when classifications are present (F12 pt4)', () => {
    const store = matrixStore()
    store.skills[0].classification = 'Technical' // TypeScript → library classification
    const sections = buildViewSections().map((s) =>
      s.key === 'skill_matrix' ? { ...s, detail: 'full' as const } : s,
    )
    const html = buildViewHtml(store, makeView({ sections }), 'en')
    expect(html).toContain('<th>Category</th>')
    expect(html).toContain('Technical')
  })

  it('shows the linked skill category when no classification is set', () => {
    const store = matrixStore()
    store.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    store.skills[0].category_id = 'cat1' // TypeScript
    const sections = buildViewSections().map((s) =>
      s.key === 'skill_matrix' ? { ...s, detail: 'full' as const } : s,
    )
    const html = buildViewHtml(store, makeView({ sections }), 'en')
    expect(html).toContain('<th>Category</th>')
    expect(html).toContain('Languages')
  })

  it('omits the Category column entirely when no skill has a category', () => {
    // The Category column shows only when a skill has a classification or a
    // linked category; clear both so it's omitted.
    const store = matrixStore()
    store.skills.forEach((s) => { s.category_id = null; s.classification = undefined })
    const sections = buildViewSections().map((s) =>
      s.key === 'skill_matrix' ? { ...s, detail: 'full' as const } : s,
    )
    const html = buildViewHtml(store, makeView({ sections }), 'en')
    expect(html).not.toContain('<th>Category</th>')
  })

  it('summary detail renders highlighted skills only', () => {
    const sections = buildViewSections().map((s) =>
      s.key === 'skill_matrix' ? { ...s, detail: 'summary' as const } : s,
    )
    const html = buildViewHtml(matrixStore(), makeView({ sections }), 'en')
    expect(html).toContain('TypeScript')
    expect(html).not.toContain('Kubernetes')
  })

  it('hide_dates drops the Last used column', () => {
    const sections = buildViewSections().map((s) =>
      s.key === 'skill_matrix' ? { ...s, detail: 'full' as const, style: { hide_dates: true } } : s,
    )
    const html = buildViewHtml(matrixStore(), makeView({ sections }), 'en')
    expect(html).not.toContain('Last used')
    expect(html).not.toContain('Ongoing')
  })
})
/**
 * The skill matrix's per-skill usage scan — the numbers in the Experience and
 * Last used columns are derived here, and a reader takes them as facts.
 */
describe('skillMatrixRows — the usage scan', () => {
  const ps = (skill_id: string, duration = 0) => ({
    id: `ps-${skill_id}-${Math.random()}`, skill_id, name: {},
    duration_in_years: duration, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
  })

  it('ignores a DISABLED project when deriving usage', () => {
    // A soft-deleted project is out of every export; counting it would put
    // experience in the matrix that the CV never shows.
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' }, total_duration_in_years: 0 })]
    s.projects = [makeProject({
      id: 'p1', disabled: true, skills: [ps('go')] as never,
      start: { year: 2020, month: 1 }, end: null,
    })]
    const row = skillMatrixRows(s, makeView(), 'en').find((r) => r.name === 'Go')!
    expect(row.ongoing).toBe(false)
    expect(row.lastUsed).toBeNull()
  })

  it('ignores a project skill with no registry link', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
    s.projects = [makeProject({
      id: 'p1', skills: [{ ...ps(''), skill_id: '' }] as never,
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 1 },
    })]
    expect(skillMatrixRows(s, makeView(), 'en').find((r) => r.name === 'Go')!.lastUsed).toBeNull()
  })

  it('marks a skill used by an OPEN-ENDED project as ongoing', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
    s.projects = [makeProject({
      id: 'p1', skills: [ps('go')] as never, start: { year: 2020, month: 1 }, end: null,
    })]
    const row = skillMatrixRows(s, makeView(), 'en').find((r) => r.name === 'Go')!
    expect(row.ongoing).toBe(true)
    expect(fmtLastUsed(row, 'en', 'my')).toBe(xs('ongoing', 'en'))
  })

  it('reports the LATEST end date across several projects', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
    s.projects = [
      makeProject({ id: 'p1', skills: [ps('go')] as never, start: { year: 2015, month: 1 }, end: { year: 2016, month: 1 } }),
      makeProject({ id: 'p2', skills: [ps('go')] as never, start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 } }),
    ]
    expect(skillMatrixRows(s, makeView(), 'en').find((r) => r.name === 'Go')!.lastUsed)
      .toEqual({ year: 2021, month: 6 })
  })
})

/**
 * Category selection and the view's own filters.
 *
 * The matrix is selected BY CATEGORY (§: the view editor shows category toggles
 * for this section, shared with the Skills Showcase), which is unlike every other
 * section's per-item exclusion — so it needs its own assertions.
 */
describe('skillMatrixRows — selection and filters', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.skill_categories = [
      makeSkillCategory({ id: 'lang', name: { en: 'Languages' } }),
      makeSkillCategory({ id: 'plat', name: { en: 'Platforms' } }),
    ]
    s.skills = [
      makeSkill({ id: 'go', name: { en: 'Go' }, category_id: 'lang', is_highlighted: true }),
      makeSkill({ id: 'rust', name: { en: 'Rust' }, category_id: 'lang' }),
      makeSkill({ id: 'k8s', name: { en: 'Kubernetes' }, category_id: 'plat' }),
      makeSkill({ id: 'loose', name: { en: 'Bash' }, category_id: null }),
    ]
    return s
  }
  const names = (view: Parameters<typeof skillMatrixRows>[1], opts = {}) =>
    skillMatrixRows(store(), view, 'en', opts).map((r) => r.name)

  it('lists every skill by default, categorised or not', () => {
    expect(names(makeView()).sort()).toEqual(['Bash', 'Go', 'Kubernetes', 'Rust'])
  })

  it('drops a whole CATEGORY when its id is excluded', () => {
    // The exclusion list holds category ids for this section, not skill ids.
    expect(names(makeView({ excluded_item_ids: ['lang'] })).sort())
      .toEqual(['Bash', 'Kubernetes'])
  })

  it('drops an uncategorised skill via the uncategorised bucket', () => {
    const out = names(makeView({ excluded_item_ids: ['plat', 'lang'] }))
    expect(out).toEqual(['Bash'])
  })

  it('keeps a skill whose category id is stale rather than hiding it', () => {
    // A dangling category link must not make a skill vanish from the matrix.
    const s = store()
    s.skills[0].category_id = 'gone'
    expect(skillMatrixRows(s, makeView(), 'en').map((r) => r.name)).toContain('Go')
  })

  it('shows only highlighted skills when asked for the summary set', () => {
    expect(names(makeView(), { highlightedOnly: true })).toEqual(['Go'])
  })

  it('reports the category NAME on each row, blank when uncategorised', () => {
    const rows = skillMatrixRows(store(), makeView(), 'en')
    expect(rows.find((r) => r.name === 'Go')!.category).toBe('Languages')
    expect(rows.find((r) => r.name === 'Bash')!.category).toBe('')
  })

  it('resolves the skill and category names in the requested locale', () => {
    const s = store()
    s.skills[0].name = { en: 'Go', no: 'Go-språket' }
    s.skill_categories![0].name = { en: 'Languages', no: 'Språk' }
    const row = skillMatrixRows(s, makeView(), 'no').find((r) => r.name === 'Go-språket')!
    expect(row.category).toBe('Språk')
  })

  it('skips a skill with no usable name at all', () => {
    const s = store()
    s.skills.push(makeSkill({ id: 'blank', name: {} }))
    expect(skillMatrixRows(s, makeView(), 'en').some((r) => r.name === '')).toBe(false)
  })

  it('returns nothing for an empty registry', () => {
    const s = emptyStore()
    expect(skillMatrixRows(s, makeView(), 'en')).toEqual([])
  })
})

/**
 * The row ORDER is the matrix's editorial voice: a tender reader looks at the
 * first few rows and stops. Highlighted skills come first, then the longest
 * experience, then alphabetically — and each of those three has to actively
 * reorder, so the assertions below feed it lists already in the wrong order.
 */
describe('skillMatrixRows — the order the reader sees', () => {
  const withYears = (over: Parameters<typeof makeSkill>[0]) =>
    makeSkill({ total_duration_in_years: 0, ...over })

  const order = (skills: Parameters<typeof makeSkill>[0][]) => {
    const s = emptyStore()
    s.skills = skills.map(withYears)
    return skillMatrixRows(s, makeView(), 'en').map((r) => r.name)
  }

  it('lifts a highlighted skill above an unhighlighted one with MORE experience', () => {
    expect(order([
      { id: 'a', name: { en: 'Ada' }, total_duration_in_years: 12 },
      { id: 'b', name: { en: 'Bash' }, total_duration_in_years: 1, is_highlighted: true },
    ])).toEqual(['Bash', 'Ada'])
  })

  it('keeps a highlighted skill first even when the years tie', () => {
    // The tie is the case that separates "highlighted OR years" from
    // "highlighted AND years": with equal years the second rule contributes 0.
    expect(order([
      { id: 'a', name: { en: 'Ada' }, total_duration_in_years: 4 },
      { id: 'z', name: { en: 'Zsh' }, total_duration_in_years: 4, is_highlighted: true },
    ])).toEqual(['Zsh', 'Ada'])
  })

  it('orders by years DESCENDING within a group', () => {
    expect(order([
      { id: 'a', name: { en: 'Ada' }, total_duration_in_years: 2 },
      { id: 'b', name: { en: 'Bash' }, total_duration_in_years: 9 },
      { id: 'c', name: { en: 'C' }, total_duration_in_years: 5 },
    ])).toEqual(['Bash', 'C', 'Ada'])
  })

  it('falls back to the skill name when both rules tie', () => {
    expect(order([
      { id: 'z', name: { en: 'Zsh' }, total_duration_in_years: 3 },
      { id: 'a', name: { en: 'Ada' }, total_duration_in_years: 3 },
    ])).toEqual(['Ada', 'Zsh'])
  })
})

describe('skillMatrixRows — the per-row values a reader takes as fact', () => {
  const rowFor = (over: Parameters<typeof makeSkill>[0], fill: (s: ResumeStore) => void = () => {}) => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'sk', name: { en: 'Solo' }, total_duration_in_years: 0, ...over })]
    fill(s)
    return skillMatrixRows(s, makeView(), 'en')[0]
  }

  it('trims a library classification, and ignores a blank one', () => {
    expect(rowFor({ classification: '  Technical  ' }).category).toBe('Technical')

    // Whitespace is not a classification: fall through to the linked category.
    const row = rowFor({ classification: '   ', category_id: 'cat' }, (s) => {
      s.skill_categories = [makeSkillCategory({ id: 'cat', name: { en: 'Cloud' } })]
    })
    expect(row.category).toBe('Cloud')
  })

  it('reports no category when the store has no category list at all', () => {
    // An older resume can reach here with the array absent, not empty.
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'sk', name: { en: 'Solo' }, category_id: 'cat' })]
    delete (s as { skill_categories?: unknown }).skill_categories
    expect(skillMatrixRows(s, makeView(), 'en')[0].category).toBe('')
  })

  it('clamps proficiency into the 0-5 the column claims', () => {
    expect(rowFor({ proficiency: 3 }).proficiency).toBe(3)
    expect(rowFor({ proficiency: 9 }).proficiency).toBe(5)
    expect(rowFor({ proficiency: -2 }).proficiency).toBe(0)
  })

  it('ignores usage from a project with no start date', () => {
    // An undated project cannot say WHEN a skill was last used, and reporting
    // its end alone would date the skill from a range nobody entered.
    const row = rowFor({}, (s) => {
      s.projects = [makeProject({
        id: 'p1', start: null, end: { year: 2021, month: 6 },
        skills: [{ skill_id: 'sk', name: {}, proficiency: 3 }] as never,
      })]
    })
    expect(row.lastUsed).toBeNull()
    expect(row.ongoing).toBe(false)
  })

  it('keeps the FIRST of two usages that fall in the same month', () => {
    // A year-only end and January of that year compare equal; replacing on a tie
    // would silently sharpen "2019" into "January 2019".
    const row = rowFor({}, (s) => {
      s.projects = [
        makeProject({
          id: 'p1', start: { year: 2018, month: 1 }, end: { year: 2019, month: null },
          skills: [{ skill_id: 'sk', name: {}, proficiency: 3 }] as never,
        }),
        makeProject({
          id: 'p2', start: { year: 2018, month: 1 }, end: { year: 2019, month: 1 },
          skills: [{ skill_id: 'sk', name: {}, proficiency: 3 }] as never,
        }),
      ]
    })
    expect(row.lastUsed).toEqual({ year: 2019, month: null })
  })
})

describe('fmtLastUsed', () => {
  const row = (over: Partial<SkillMatrixRow>): SkillMatrixRow => ({
    id: 'sk', name: 'Solo', category: '', years: 0, proficiency: 0,
    lastUsed: null, ongoing: false, highlighted: false, ...over,
  })

  it('formats a closed last-used date in the section\u2019s own date format', () => {
    expect(fmtLastUsed(row({ lastUsed: { year: 2021, month: 6 } }), 'en', 'month-year'))
      .toBe(fmtDate({ year: 2021, month: 6 }, 'month-year', 'en'))
    expect(fmtLastUsed(row({ lastUsed: { year: 2021, month: 6 } }), 'en', 'year-only'))
      .toBe('2021')
  })

  it('says Ongoing only when the row is ongoing, and nothing with no date', () => {
    expect(fmtLastUsed(row({ ongoing: true }), 'en')).toBe(xs('ongoing', 'en'))
    expect(fmtLastUsed(row({}), 'en')).toBe('')
  })
})
