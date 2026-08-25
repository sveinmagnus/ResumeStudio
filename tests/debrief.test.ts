import { describe, it, expect } from 'vitest'
import {
  debriefQuestions, buildDebriefPrompt, validateDebrief, applyDebrief,
  debriefCandidates, InvalidDebriefError, DEBRIEF_SCHEMA,
} from '../src/lib/debrief'
import { emptyStore, makeProject, makeProjectSkill, makeSkill } from './fixtures'

const NOW = new Date('2026-06-15T00:00:00Z')

describe('debriefQuestions — derived from what the project lacks', () => {
  it('always asks about outcomes, difficulty and skills', () => {
    const p = makeProject({
      highlights: [{ en: 'a' }, { en: 'b' }, { en: 'c' }],
      long_description: { en: 'x'.repeat(250) },
      end: { year: 2026, month: 1 },
    })
    const ids = debriefQuestions(p, 'en').map((q) => q.id)
    expect(ids).toEqual(['outcome', 'hard', 'skills'])
  })

  it('adds highlight / summary / wrap questions when those fields are thin', () => {
    const p = makeProject({ highlights: [], long_description: {}, end: null })
    const ids = debriefQuestions(p, 'en').map((q) => q.id)
    expect(ids).toContain('highlights')
    expect(ids).toContain('summary')
    expect(ids).toContain('wrap')
  })

  it('names the already-linked skills in the skills question', () => {
    const p = makeProject({ skills: [makeProjectSkill({ name: { en: 'React' } })] })
    const q = debriefQuestions(p, 'en').find((x) => x.id === 'skills')!
    expect(q.text).toContain('React')
  })
})

describe('buildDebriefPrompt', () => {
  it('carries the answered questions, skips empty answers, and pins the schema', () => {
    const p = makeProject({ customer: { en: 'Acme' } })
    const qs = debriefQuestions(p, 'en')
    const prompt = buildDebriefPrompt(p, 'en', qs, { outcome: 'Cut costs 40%', hard: '' })
    expect(prompt).toContain('Cut costs 40%')
    expect(prompt).toContain(DEBRIEF_SCHEMA)
    expect(prompt).toContain('Acme')
    expect(prompt).not.toContain('hardest problem, and how did you solve it?\nA:')
  })

  it('tells the model which skills are already linked', () => {
    const p = makeProject({ skills: [makeProjectSkill({ name: { en: 'Kubernetes' } })] })
    const prompt = buildDebriefPrompt(p, 'en', [], {})
    expect(prompt).toContain('already linked: Kubernetes')
  })
})

describe('validateDebrief', () => {
  it('accepts a full draft and trims/drops junk entries', () => {
    const d = validateDebrief({
      $schema: DEBRIEF_SCHEMA,
      highlights: [' Cut costs 40% ', '', 42],
      skills: ['Terraform'],
      short_description: ' One line. ',
    })
    expect(d).toEqual({
      highlights: ['Cut costs 40%'],
      skills: ['Terraform'],
      short_description: 'One line.',
    })
  })

  it('tolerates absent fields as long as something is present', () => {
    expect(validateDebrief({ highlights: ['x'] }).skills).toEqual([])
    expect(validateDebrief({ short_description: 'y' }).highlights).toEqual([])
  })

  it('rejects a reply with nothing usable', () => {
    expect(() => validateDebrief({ highlights: [], skills: [] })).toThrow(InvalidDebriefError)
    expect(() => validateDebrief('nope')).toThrow(InvalidDebriefError)
    expect(() => validateDebrief(null)).toThrow(InvalidDebriefError)
  })
})

describe('applyDebrief', () => {
  const seeded = () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'sk-react', name: { en: 'React' } })]
    s.projects = [makeProject({
      id: 'p1',
      highlights: [{ en: 'Existing' }],
      skills: [],
      short_description: { no: 'Norsk linje' },
    })]
    return s
  }
  let n = 0
  const ids = (): string => `gen-${n++}`

  it('appends highlights, links + creates skills, sets the short description, stamps debriefed_at', () => {
    const next = applyDebrief(seeded(), 'p1', {
      highlights: ['Cut costs 40%'],
      linkSkillIds: ['sk-react'],
      newSkills: ['Terraform'],
      shortDescription: 'Modernised the platform.',
    }, 'en', NOW, ids)

    const p = next.projects[0]
    expect(p.highlights.map((h) => h.en)).toEqual(['Existing', 'Cut costs 40%'])
    expect(p.skills.map((ps) => ps.skill_id)).toContain('sk-react')
    expect(next.skills.map((s) => s.name.en)).toContain('Terraform')
    const created = next.skills.find((s) => s.name.en === 'Terraform')!
    expect(p.skills.map((ps) => ps.skill_id)).toContain(created.id)
    // The other locale's short description is untouched.
    expect(p.short_description).toEqual({ no: 'Norsk linje', en: 'Modernised the platform.' })
    expect(p.debriefed_at).toBe(NOW.toISOString())
  })

  it('never double-links an already linked skill and leaves the store untouched on a bad id', () => {
    const s = seeded()
    s.projects[0].skills = [makeProjectSkill({ skill_id: 'sk-react', name: { en: 'React' } })]
    const next = applyDebrief(s, 'p1', {
      highlights: [], linkSkillIds: ['sk-react'], newSkills: [], shortDescription: null,
    }, 'en', NOW, ids)
    expect(next.projects[0].skills).toHaveLength(1)

    const untouched = applyDebrief(s, 'missing', {
      highlights: ['x'], linkSkillIds: [], newSkills: [], shortDescription: null,
    }, 'en', NOW, ids)
    expect(untouched).toBe(s)
  })

  it('does not mutate the input store', () => {
    const s = seeded()
    applyDebrief(s, 'p1', {
      highlights: ['New'], linkSkillIds: [], newSkills: ['Go'], shortDescription: 'Line',
    }, 'en', NOW, ids)
    expect(s.projects[0].highlights).toHaveLength(1)
    expect(s.skills).toHaveLength(1)
    expect(s.projects[0].debriefed_at).toBeUndefined()
  })
})

describe('debriefCandidates — the recently-finished nudge', () => {
  it('offers a project that ended within the window, newest first', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'old', customer: { en: 'Old' }, end: { year: 2026, month: 2 } }),
      makeProject({ id: 'new', customer: { en: 'New' }, end: { year: 2026, month: 5 } }),
    ]
    expect(debriefCandidates(s, NOW).map((c) => c.id)).toEqual(['new', 'old'])
  })

  it('skips ongoing, long-finished, disabled and already-debriefed projects', () => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'ongoing', end: null }),
      makeProject({ id: 'ancient', end: { year: 2024, month: 1 } }),
      makeProject({ id: 'off', end: { year: 2026, month: 5 }, disabled: true }),
      makeProject({ id: 'done', end: { year: 2026, month: 5 }, debriefed_at: '2026-06-01T00:00:00Z' }),
    ]
    expect(debriefCandidates(s, NOW)).toEqual([])
  })

  it('re-offers a project whose debrief predates this ending', () => {
    const s = emptyStore()
    // Debriefed in January, but the project ran on and ended in May.
    s.projects = [makeProject({
      id: 'p', end: { year: 2026, month: 5 }, debriefed_at: '2026-01-10T00:00:00Z',
    })]
    expect(debriefCandidates(s, NOW).map((c) => c.id)).toEqual(['p'])
  })

  it('honours a snoozed dismissal until it lapses', () => {
    const s = emptyStore()
    s.projects = [makeProject({ id: 'p', end: { year: 2026, month: 5 } })]
    const key = debriefCandidates(s, NOW)[0].dismissKey
    expect(debriefCandidates(s, NOW, { [key]: '2027-01-01T00:00:00Z' })).toEqual([])
    expect(debriefCandidates(s, NOW, { [key]: '2026-01-01T00:00:00Z' }).map((c) => c.id)).toEqual(['p'])
  })
})
