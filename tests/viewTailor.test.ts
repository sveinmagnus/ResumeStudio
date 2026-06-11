import { describe, it, expect } from 'vitest'
import {
  TAILOR_SCHEMA, buildTailorCatalog, buildTailorPrompt, isTailorFormat,
  validateTailorResponse, applyTailorResponse, InvalidTailorResponseError,
} from '../src/lib/viewTailor'
import { emptyStore, makeProject, makeWork, makeSkill, makeView } from './fixtures'

function storeWithContent() {
  const store = emptyStore()
  store.projects.push(makeProject({ id: 'p1', customer: { en: 'Acme' }, starred: true }))
  store.projects.push(makeProject({ id: 'p2', customer: { en: 'Beta' } }))
  store.projects.push(makeProject({ id: 'p3', customer: { en: 'Hidden' }, disabled: true }))
  store.work_experiences.push(makeWork({ id: 'w1', employer: { en: 'Cartavio' } }))
  store.skills.push(makeSkill({ name: { en: 'TypeScript' } }))
  return store
}

describe('buildTailorCatalog', () => {
  it('lists enabled items with ids, titles and starred flags', () => {
    const cat = buildTailorCatalog(storeWithContent(), 'en')
    const projects = cat.sections.find((s) => s.key === 'projects')!
    expect(projects.items.map((i) => i.id)).toEqual(['p1', 'p2'])
    expect(projects.items[0]).toMatchObject({ title: 'Acme', starred: true })
    expect(projects.items[1].starred).toBeUndefined()
  })

  it('omits disabled items, empty sections, and the synthetic promoted_projects', () => {
    const cat = buildTailorCatalog(storeWithContent(), 'en')
    expect(cat.sections.some((s) => s.key === 'promoted_projects')).toBe(false)
    expect(cat.sections.some((s) => s.key === 'educations')).toBe(false)
    expect(JSON.stringify(cat)).not.toContain('Hidden')
  })

  it('includes the skill registry names', () => {
    expect(buildTailorCatalog(storeWithContent(), 'en').skills).toContain('TypeScript')
  })
})

describe('buildTailorPrompt', () => {
  it('bundles the posting, catalog, schema id and locale', () => {
    const prompt = buildTailorPrompt(storeWithContent(), 'We need a TS dev', 'no')
    expect(prompt).toContain('We need a TS dev')
    expect(prompt).toContain(TAILOR_SCHEMA)
    expect(prompt).toContain('"no"')
    expect(prompt).toContain('Acme')
    expect(prompt).toContain('TypeScript')
  })
})

describe('isTailorFormat / validateTailorResponse', () => {
  it('detects the schema prefix', () => {
    expect(isTailorFormat({ $schema: 'resumestudio-tailor/v1' })).toBe(true)
    expect(isTailorFormat({ $schema: 'resumestudio-ai/v1' })).toBe(false)
    expect(isTailorFormat(null)).toBe(false)
    expect(isTailorFormat([])).toBe(false)
  })

  it('accepts a complete valid response', () => {
    const v = validateTailorResponse({
      $schema: TAILOR_SCHEMA,
      view_name: 'TS dev CV',
      introduction: 'Hi',
      section_detail: { projects: 'full', educations: 'summary' },
      exclude_item_ids: ['p2'],
      gaps: ['Kubernetes'],
    })
    expect(v.view_name).toBe('TS dev CV')
  })

  it('rejects a non-object root', () => {
    expect(() => validateTailorResponse('hi')).toThrow(InvalidTailorResponseError)
  })

  it('collects field-pathed issues instead of stopping at the first', () => {
    try {
      validateTailorResponse({
        $schema: 'wrong/v1',
        view_name: { nested: true },
        section_detail: { projects: 'everything' },
        exclude_item_ids: 'p1',
        gaps: [{}],
      })
      expect.unreachable('should have thrown')
    } catch (e) {
      const issues = (e as InvalidTailorResponseError).issues
      const paths = issues.map((i) => i.path)
      expect(paths).toContain('$schema')
      expect(paths).toContain('view_name')
      expect(paths).toContain('section_detail.projects')
      expect(paths).toContain('exclude_item_ids')
      expect(paths).toContain('gaps[0]')
    }
  })
})

describe('applyTailorResponse', () => {
  const base = {
    $schema: TAILOR_SCHEMA,
    view_name: 'Tailored TS CV',
    introduction: 'Pitch text',
    section_detail: { projects: 'full', educations: 'off', made_up_section: 'full' },
    exclude_item_ids: ['p2', 'hallucinated-id'],
    gaps: ['Kubernetes', ''],
  }

  it('builds a complete view with seeded details and exclusions', () => {
    const res = applyTailorResponse(storeWithContent(), base, 'en')
    expect(res.view.name).toBe('Tailored TS CV')
    expect(res.view.introduction).toEqual({ en: 'Pitch text' })
    expect(res.view.sections.find((s) => s.key === 'projects')?.detail).toBe('full')
    expect(res.view.sections.find((s) => s.key === 'educations')?.detail).toBe('off')
    expect(res.view.excluded_item_ids).toEqual(['p2'])
    expect(res.view.style).toBeDefined()
    expect(res.view.header.fields.length).toBeGreaterThan(0)
  })

  it('drops and reports hallucinated ids and unknown sections', () => {
    const res = applyTailorResponse(storeWithContent(), base, 'en')
    expect(res.unknownItemIds).toEqual(['hallucinated-id'])
    expect(res.unknownSections).toEqual(['made_up_section'])
    expect(res.excludedTitles).toEqual(['Beta'])
  })

  it('filters empty gaps and keeps the rest', () => {
    const res = applyTailorResponse(storeWithContent(), base, 'en')
    expect(res.gaps).toEqual(['Kubernetes'])
  })

  it('wraps the introduction in the requested locale', () => {
    const res = applyTailorResponse(storeWithContent(), { ...base, introduction: 'Norsk tekst' }, 'no')
    expect(res.view.introduction).toEqual({ no: 'Norsk tekst' })
  })

  it('falls back to a default view name and empty intro', () => {
    const res = applyTailorResponse(storeWithContent(), { $schema: TAILOR_SCHEMA }, 'en')
    expect(res.view.name).toBe('Tailored view')
    expect(res.view.introduction).toEqual({})
    expect(res.view.excluded_item_ids).toEqual([])
  })

  it('the produced view passes through the existing view machinery', () => {
    // Sanity: shape matches what makeView produces (same required fields).
    const res = applyTailorResponse(storeWithContent(), base, 'en')
    const reference = makeView()
    for (const key of Object.keys(reference)) {
      expect(res.view, `missing field ${key}`).toHaveProperty(key)
    }
  })
})
