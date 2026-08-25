/**
 * @vitest-environment jsdom
 *
 * jsdom: the evidence corpus goes through richToPlain, which parses markup via
 * DOMParser.
 */
import { describe, it, expect } from 'vitest'
import { claimEvidenceReport, claimDismissKey } from '../src/lib/claimEvidence'
import {
  emptyStore, makeSkill, makeRole, makeProject, makeProjectSkill,
  makeWork, makeKQ, makeKeyCompetency, makePosition,
} from './fixtures'
import type { LocalizedString, ResumeStore } from '../src/types'

// Fixed "now" so open-ended ranges and snooze checks are deterministic.
const NOW = new Date('2026-06-15T00:00:00Z')

const report = (store: ResumeStore, dismissals?: Record<string, string>, now: Date = NOW) =>
  claimEvidenceReport(store, 'en', dismissals, now)

describe('claimEvidenceReport — proficiency', () => {
  it('flags a top-rated skill no dated project uses, as high severity', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { en: 'Kubernetes' }, proficiency: 5 })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({
      kind: 'proficiency', severity: 'high', section: 'skills',
      itemId: 's1', itemLabel: 'Kubernetes', dismissKey: 'claim:proficiency:s1',
    })
    expect(r.findings[0].detail).toBe('Rated 5/5 — no dated project uses this skill.')
  })

  it('also fires when only a legacy imported number backs the rating (usesFallback)', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', proficiency: 4, total_duration_in_years: 6 })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].severity).toBe('high')
    expect(r.findings[0].detail).toBe('Rated 4/5 — no dated project uses this skill.')
  })

  it('stays quiet when a dated project uses the skill for a solid stretch', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', proficiency: 5 })]
    // Fixture default range Jan 2022 – Jun 2023 = 18 months on one project.
    s.projects = [makeProject({ skills: [makeProjectSkill({ skill_id: 's1' })] })]
    expect(report(s).findings).toEqual([])
  })

  it('does not accept a DISABLED project as evidence', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', proficiency: 5 })]
    s.projects = [makeProject({ disabled: true, skills: [makeProjectSkill({ skill_id: 's1' })] })]
    expect(report(s).findings.map((f) => f.kind)).toEqual(['proficiency'])
  })

  it('still fires when the only linking project is UNDATED', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', proficiency: 5 })]
    s.projects = [makeProject({ start: null, end: null, skills: [makeProjectSkill({ skill_id: 's1' })] })]
    const r = report(s)
    expect(r.findings.map((f) => [f.kind, f.severity])).toEqual([['proficiency', 'high']])
  })

  it('never fires below the rating threshold, and skips unrated (0) skills', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ proficiency: 3 }), makeSkill({ proficiency: 0 })]
    const r = report(s)
    expect(r.findings).toEqual([])
    expect(r.checked).toBe(2)
  })

  it('flags thin evidence (under a year on a single project) as low severity', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', proficiency: 4 })]
    s.projects = [makeProject({
      start: { year: 2023, month: 1 }, end: { year: 2023, month: 6 },
      skills: [makeProjectSkill({ skill_id: 's1' })],
    })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].severity).toBe('low')
    expect(r.findings[0].detail).toBe('Rated 4/5 — 6 months across 1 project.')
  })

  it('does not call short experience thin once a SECOND project shows the skill', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', proficiency: 4 })]
    s.projects = [
      makeProject({ start: { year: 2023, month: 1 }, end: { year: 2023, month: 2 }, skills: [makeProjectSkill({ skill_id: 's1' })] }),
      makeProject({ start: { year: 2023, month: 4 }, end: { year: 2023, month: 5 }, skills: [makeProjectSkill({ skill_id: 's1' })] }),
    ]
    expect(report(s).findings).toEqual([])
  })

  it('names a manual adjustment so a deliberate pre-CV credit reads as such', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', proficiency: 5, experience_offset_years: 2.5 })]
    expect(report(s).findings[0].detail)
      .toBe('Rated 5/5 — no dated project uses this skill. (a manual adjustment of 2y 6m is set)')
  })
})

describe('claimEvidenceReport — showcase', () => {
  it('flags a showcased skill no project links', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { en: 'Rust' }, is_highlighted: true })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({ kind: 'showcase', severity: 'low', itemId: 's1' })
    expect(r.findings[0].detail).toBe('Showcased, but no project shows it in use.')
  })

  it('is silenced by any project LINK, dated or not', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', is_highlighted: true })]
    s.projects = [makeProject({ start: null, end: null, skills: [makeProjectSkill({ skill_id: 's1' })] })]
    expect(report(s).findings).toEqual([])
  })

  it('yields to the proficiency rule — at most one finding per skill', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', proficiency: 5, is_highlighted: true })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].kind).toBe('proficiency')
  })
})

describe('claimEvidenceReport — role_years', () => {
  it('flags a stored years total with no dated assignment behind it', () => {
    const s = emptyStore()
    s.roles = [makeRole({ id: 'r1', name: { en: 'Architect' }, years_of_experience: 5 })]
    const r = report(s)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({
      kind: 'role_years', severity: 'low', section: 'roles',
      itemId: 'r1', itemLabel: 'Architect', dismissKey: 'claim:role_years:r1',
    })
    expect(r.findings[0].detail).toBe('Claims ~5 years — no dated project, employment or other role links it.')
  })

  it('stays quiet below the years threshold', () => {
    const s = emptyStore()
    s.roles = [makeRole({ years_of_experience: 2 })]
    expect(report(s).findings).toEqual([])
  })

  it('is silenced by a dated employment linking the role', () => {
    const s = emptyStore()
    s.roles = [makeRole({ id: 'r1', years_of_experience: 5 })]
    s.work_experiences = [makeWork({ role_ids: ['r1'] })]
    expect(report(s).findings).toEqual([])
  })

  it('skips a disabled role entirely — no finding, not counted as checked', () => {
    const s = emptyStore()
    s.roles = [makeRole({ years_of_experience: 5, disabled: true })]
    const r = report(s)
    expect(r.findings).toEqual([])
    expect(r.checked).toBe(0)
  })
})

describe('claimEvidenceReport — competency', () => {
  /** A competency bundled on a live profile, plus an optional corpus project. */
  const compStore = (title: LocalizedString, corpusText?: string): ResumeStore => {
    const s = emptyStore()
    s.key_competencies = [makeKeyCompetency({ id: 'c1', title })]
    s.key_qualifications = [makeKQ({ competency_ids: ['c1'] })]
    if (corpusText) s.projects = [makeProject({ long_description: { en: corpusText } })]
    return s
  }

  it('flags a bundled competency nothing in the CV mentions', () => {
    const r = report(compStore({ en: 'Cloud architecture' }))
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({
      kind: 'competency', severity: 'low', section: 'key_competencies',
      itemId: 'c1', itemLabel: 'Cloud architecture', dismissKey: 'claim:competency:c1',
    })
    expect(r.findings[0].detail).toBe('No project or employment mentions "Cloud architecture".')
  })

  it('is silenced by a single title token appearing in project prose', () => {
    const r = report(compStore({ en: 'Cloud architecture' }, 'Designed the cloud migration roadmap.'))
    expect(r.findings).toEqual([])
  })

  it('matches inside compound words and across locales', () => {
    // Norwegian compounds inflect ("skyarkitekturEN"), so substring matching is
    // what makes the check usable outside English.
    const s = compStore({ no: 'Skyarkitektur' })
    s.projects = [makeProject({ long_description: { no: 'Ansvarlig for skyarkitekturen i banken.' } })]
    expect(report(s).findings).toEqual([])
  })

  it('is silenced by other-role (position) prose too', () => {
    const s = compStore({ en: 'Board governance' })
    s.positions = [makePosition({ description: { en: 'Chaired the governance committee.' } })]
    expect(report(s).findings).toEqual([])
  })

  it('does not let markup fake a mention — tag names are not corpus text', () => {
    const s = compStore({ en: 'Strong stakeholder relations' })
    s.projects = [makeProject({ long_description: { en: '<p>Built the <strong>platform</strong>.</p>' } })]
    expect(report(s).findings.map((f) => f.kind)).toEqual(['competency'])
  })

  it('does not accept a DISABLED project as a mention', () => {
    const s = compStore({ en: 'Cloud architecture' }, 'Designed the cloud migration roadmap.')
    s.projects[0].disabled = true
    expect(report(s).findings.map((f) => f.kind)).toEqual(['competency'])
  })

  it('never fires for a competency no live profile bundles', () => {
    const s = emptyStore()
    s.key_competencies = [makeKeyCompetency({ id: 'c1', title: { en: 'Cloud architecture' } })]
    const unbundled = report(s)
    expect(unbundled.findings).toEqual([])
    expect(unbundled.checked).toBe(0)

    // A disabled profile's bundle is not a live bundle.
    s.key_qualifications = [makeKQ({ competency_ids: ['c1'], disabled: true })]
    expect(report(s).findings).toEqual([])
  })

  it('skips a disabled competency even when bundled', () => {
    const s = compStore({ en: 'Cloud architecture' })
    s.key_competencies[0].disabled = true
    const r = report(s)
    expect(r.findings).toEqual([])
    expect(r.checked).toBe(0)
  })

  it('skips a title with no searchable tokens rather than flagging it', () => {
    // Every word is a stopword or under four letters — nothing to search for.
    const r = report(compStore({ en: 'And for the win' }))
    expect(r.findings).toEqual([])
    expect(r.checked).toBe(1)
  })
})

describe('claimEvidenceReport — dismissals', () => {
  const skillStore = (): ResumeStore => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { en: 'Kubernetes' }, proficiency: 5 })]
    return s
  }
  const key = claimDismissKey('proficiency', 's1')

  it('moves a snoozed finding to snoozed (with its label) until the date passes', () => {
    const r = report(skillStore(), { [key]: '2026-09-01T00:00:00Z' })
    expect(r.findings).toEqual([])
    expect(r.snoozed).toEqual([{ key, label: 'Kubernetes', until: '2026-09-01T00:00:00Z' }])
    // The snoozed item was still examined.
    expect(r.checked).toBe(1)
  })

  it('surfaces the finding again once the snooze lapses', () => {
    const r = report(skillStore(), { [key]: '2026-09-01T00:00:00Z' }, new Date('2026-09-02T00:00:00Z'))
    expect(r.findings).toHaveLength(1)
    expect(r.snoozed).toEqual([])
  })

  it('ignores an unparseable snooze date rather than hiding the finding forever', () => {
    const r = report(skillStore(), { [key]: 'not a date' })
    expect(r.findings).toHaveLength(1)
  })

  it('does not surface a weaker finding in a snoozed one’s place', () => {
    // The skill is also showcased with no links; the snoozed proficiency
    // finding must still claim the item's single slot.
    const s = skillStore()
    s.skills[0].is_highlighted = true
    const r = report(s, { [key]: '2026-09-01T00:00:00Z' })
    expect(r.findings).toEqual([])
    expect(r.snoozed.map((x) => x.key)).toEqual([key])
  })
})

describe('claimEvidenceReport — checked count and ordering', () => {
  it('counts skills, live roles and bundled competencies; sorts high first then by section', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { en: 'Kubernetes' }, proficiency: 5 })]
    s.roles = [
      makeRole({ id: 'r1', name: { en: 'Architect' }, years_of_experience: 5 }),
      makeRole({ years_of_experience: 5, disabled: true }),
    ]
    s.key_competencies = [
      makeKeyCompetency({ id: 'c1', title: { en: 'Cloud architecture' } }),
      makeKeyCompetency({ id: 'c2' }),
    ]
    s.key_qualifications = [makeKQ({ competency_ids: ['c1'] })]
    const r = report(s)
    expect(r.checked).toBe(3)
    expect(r.findings.map((f) => [f.severity, f.section])).toEqual([
      ['high', 'skills'],
      ['low', 'key_competencies'],
      ['low', 'roles'],
    ])
  })

  it('reports an empty store as empty', () => {
    expect(report(emptyStore())).toEqual({ findings: [], snoozed: [], checked: 0 })
  })
})
