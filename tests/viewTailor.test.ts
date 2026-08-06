import { describe, it, expect } from 'vitest'
import {
  TAILOR_SCHEMA, buildTailorCatalog, buildTailorPrompt, isTailorFormat,
  validateTailorResponse, applyTailorResponse, InvalidTailorResponseError,
  postingLabel, tailorPurpose, tailorableSectionKeys,
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

  it('names the skills in the locale being tailored, and drops the nameless', () => {
    const store = storeWithContent()
    store.skills = [
      makeSkill({ name: { en: 'Cloud architecture', no: 'Skyarkitektur' } }),
      makeSkill({ name: {} }),
    ]
    // A nameless entry would be an empty string in the catalog — an item the
    // model can select and nobody can identify.
    expect(buildTailorCatalog(store, 'no').skills).toEqual(['Skyarkitektur'])
  })

  it('offers every exportable section as a tailorable key, and nothing else', () => {
    const keys = tailorableSectionKeys()
    expect(keys).toContain('projects')
    expect(keys).toContain('promoted_projects')   // synthetic, but tailorable
    // Editor-only pages are not sections a response may set detail for.
    expect(keys).not.toContain('overview')
    expect(keys).not.toContain('header')
    expect(keys).not.toContain('skills')
    expect(new Set(keys).size).toBe(keys.length)
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

  it('trims the posting so the delimiters stay flush against it', () => {
    // The posting sits between --- fences; leading blank lines from a paste
    // push the text away from them and blur where it starts and ends.
    const prompt = buildTailorPrompt(storeWithContent(), '\n\n  We need a TS dev \n\n', 'en')
    expect(prompt).toContain('---\nWe need a TS dev\n---')
  })
})

describe('InvalidTailorResponseError', () => {
  it('names a single problem and counts several', () => {
    // The modal shows this string when it cannot list the issues.
    expect(new InvalidTailorResponseError([{ path: 'section_detail.projects', reason: 'bad' }]).message)
      .toBe('section_detail.projects: bad')
    expect(new InvalidTailorResponseError([
      { path: 'a', reason: 'x' }, { path: 'b', reason: 'y' },
    ]).message).toBe('Found 2 problems in the tailoring response.')
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

describe('postingLabel / tailorPurpose', () => {
  it('takes the first non-empty line — in practice the job title', () => {
    expect(postingLabel('\n\n  Senior Developer, Cartavio  \nWe are looking for…')).toBe('Senior Developer, Cartavio')
  })

  it('caps a long first line so a pasted wall of text cannot become the note', () => {
    const label = postingLabel('x'.repeat(200))
    expect(label).toHaveLength(80)
    expect(label.endsWith('…')).toBe(true)
  })

  it('is empty for blank posting text', () => {
    expect(postingLabel('   \n  ')).toBe('')
  })

  it('dates the purpose with a stable ISO date', () => {
    expect(tailorPurpose('Architect', new Date('2026-07-17T10:00:00Z')))
      .toBe('Tailored from a job posting on 2026-07-17 — Architect')
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

  it('auto-fills the purpose note from the posting', () => {
    const res = applyTailorResponse(storeWithContent(), base, 'en', 'Lead Architect — Equinor\nOslo, hybrid')
    expect(res.view.purpose).toMatch(/^Tailored from a job posting on \d{4}-\d{2}-\d{2} — Lead Architect — Equinor$/)
  })

  it('still fills a dated purpose when no posting text is supplied', () => {
    const res = applyTailorResponse(storeWithContent(), base, 'en')
    expect(res.view.purpose).toMatch(/^Tailored from a job posting on \d{4}-\d{2}-\d{2}$/)
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

/**
 * The per-field rejections.
 *
 * The existing cases prove issues are COLLECTED rather than thrown one at a
 * time; these prove each field is actually checked. A field nobody validates
 * passes whatever the model sent straight into a view — and section_detail in
 * particular decides what appears in an exported CV.
 */
describe('validateTailorResponse — per-field checks', () => {
  const base = { $schema: TAILOR_SCHEMA, view_name: 'Board CV' }
  const bad = (over: Record<string, unknown>) => () =>
    validateTailorResponse({ ...base, ...over })
  const pathsOf = (fn: () => unknown): string[] => {
    try { fn(); return [] } catch (e) {
      return (e as InvalidTailorResponseError).issues.map((i) => i.path)
    }
  }

  it('accepts a string or a number for the text fields', () => {
    // A model that answers with a bare year for a name is coerced, not refused.
    expect(bad({ view_name: 'X', introduction: 2026 })).not.toThrow()
  })

  it('rejects a non-scalar view_name or introduction, naming which', () => {
    expect(pathsOf(bad({ view_name: { en: 'X' } }))).toContain('view_name')
    expect(pathsOf(bad({ introduction: ['a'] }))).toContain('introduction')
  })

  it('treats a null text field as simply absent', () => {
    expect(bad({ view_name: null, introduction: null })).not.toThrow()
  })

  describe('section_detail', () => {
    it('accepts the three legal details', () => {
      for (const d of ['off', 'summary', 'full']) {
        expect(bad({ section_detail: { projects: d } }), d).not.toThrow()
      }
    })

    it('rejects any other detail, naming the SECTION that carried it', () => {
      // The path is what makes a rejected reply fixable — "section_detail" on
      // its own does not say which key was wrong.
      expect(pathsOf(bad({ section_detail: { projects: 'partial' } })))
        .toContain('section_detail.projects')
      expect(pathsOf(bad({ section_detail: { projects: 3 } })))
        .toContain('section_detail.projects')
    })

    it('rejects a section_detail that is not an object at all', () => {
      expect(pathsOf(bad({ section_detail: ['projects'] }))).toContain('section_detail')
      expect(pathsOf(bad({ section_detail: 'full' }))).toContain('section_detail')
    })

    it('treats a null section_detail as absent', () => {
      expect(bad({ section_detail: null })).not.toThrow()
    })
  })

  describe('the id arrays', () => {
    it('accepts strings and numbers', () => {
      expect(bad({ exclude_item_ids: ['a', 1], gaps: ['x'] })).not.toThrow()
    })

    it('rejects a non-array, naming the field', () => {
      expect(pathsOf(bad({ exclude_item_ids: 'a' }))).toContain('exclude_item_ids')
      expect(pathsOf(bad({ gaps: { a: 1 } }))).toContain('gaps')
    })

    it('names the offending INDEX when one entry is wrong', () => {
      expect(pathsOf(bad({ exclude_item_ids: ['a', { id: 'b' }] })))
        .toContain('exclude_item_ids[1]')
      expect(pathsOf(bad({ gaps: ['ok', null, ['nested']] }))).toContain('gaps[2]')
    })

    it('treats a null array as absent', () => {
      expect(bad({ exclude_item_ids: null, gaps: null })).not.toThrow()
    })
  })

  it('checks BOTH id arrays, not just the first', () => {
    // They share one loop; dropping either from the list would leave it
    // unvalidated while every existing case still passed.
    const paths = pathsOf(bad({ exclude_item_ids: 'a', gaps: 'b' }))
    expect(paths).toContain('exclude_item_ids')
    expect(paths).toContain('gaps')
  })

  it('checks BOTH text fields, not just the first', () => {
    const paths = pathsOf(bad({ view_name: {}, introduction: {} }))
    expect(paths).toContain('view_name')
    expect(paths).toContain('introduction')
  })
})
