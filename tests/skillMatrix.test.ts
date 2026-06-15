import { describe, it, expect } from 'vitest'
import { skillMatrixRows, fmtLastUsed, fmtProficiency } from '../src/lib/skillMatrix'
import { buildViewHtml, buildViewSections } from '../src/lib/viewFilter'
import { emptyStore, makeProject, makeSkill, makeView } from './fixtures'
import type { ProjectSkill } from '../src/types'

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

  it('prefers the registry total_duration, then declared project durations', () => {
    expect(byName['TypeScript'].years).toBe(8)
    expect(byName['Go'].years).toBe(2.5) // 1.5 + 1 declared
  })

  it('derives years from project date spans when nothing is declared', () => {
    // 2021-01 → now, ongoing — at least 4 years as of 2026.
    expect(byName['Kubernetes'].years).toBeGreaterThan(3)
  })

  it('marks ongoing usage and formats it', () => {
    expect(byName['Kubernetes'].ongoing).toBe(true)
    expect(fmtLastUsed(byName['Kubernetes'])).toBe('Ongoing')
    expect(byName['Go'].ongoing).toBe(true) // p2 is ongoing and uses Go
  })

  it('sorts highlighted first, then by years descending', () => {
    expect(rows[0].name).toBe('TypeScript')
  })

  it('respects view exclusions', () => {
    const rows2 = skillMatrixRows(matrixStore(), makeView({ excluded_item_ids: ['go'] }), 'en')
    expect(rows2.some((r) => r.name === 'Go')).toBe(false)
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

  it('omits the Category column entirely when no skill has a category', () => {
    // matrixStore skills have skill_type defaulting to a value, which prettifies
    // into a category — so to assert omission, blank the skill_type.
    const store = matrixStore()
    store.skills.forEach((s) => { s.skill_type = '' as never; s.classification = undefined })
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
