import { describe, it, expect } from 'vitest'
import { emptyStore, makeProject } from './fixtures'
import type { KeyCompetency, ResumeStore } from '../src/types'
import { buildCvDigest, buildBilingualDigest, itemLabel } from '../src/lib/cvDigest'
import { fieldOf, isAdvisorSection, itemsOf } from '../src/lib/cvFields'
import { validateFindings, InvalidFindingsError, FINDINGS_SCHEMA } from '../src/lib/assistFindings'
import {
  validateProposals, applyProposals, InvalidProposalsError,
} from '../src/lib/assistProposals'
import { validateMining, applyAchievements } from '../src/lib/achievementMining'
import { validateProfileDraft, applyProfileDraft } from '../src/lib/profileGenerator'
import { tidyIntro } from '../src/lib/introDraft'
import { buildCvReviewPrompt } from '../src/lib/cvReview'
import { buildVoicePassPrompt } from '../src/lib/voicePass'

/** A store with one project carrying text in both languages. */
function storeWithProject(over: Partial<Parameters<typeof makeProject>[0]> = {}): ResumeStore {
  const s = emptyStore()
  s.projects = [makeProject({
    customer: { en: 'Acme', no: 'Acme' },
    description: { en: 'Payments platform' },
    long_description: { en: 'Was responsible for various work.', no: 'Ansvarlig for arbeid.' },
    ...over,
  })]
  return s
}

const pid = (s: ResumeStore) => s.projects[0].id

describe('cvFields', () => {
  it('knows which sections and fields the advisors may touch', () => {
    const s = emptyStore()
    expect(isAdvisorSection('projects', s)).toBe(true)
    // The registries are names, not prose — deliberately invisible here.
    expect(isAdvisorSection('skills', s)).toBe(false)
    expect(isAdvisorSection('nope', s)).toBe(false)

    expect(fieldOf('projects', 'long_description')?.prose).toBe(true)
    // Identity fields are readable but must never be rewritten.
    expect(fieldOf('projects', 'customer')?.prose).toBe(false)
    expect(fieldOf('projects', 'nonsense')).toBeNull()
  })

  it('excludes disabled items, as every export does', () => {
    const s = storeWithProject()
    expect(itemsOf(s, 'projects')).toHaveLength(1)
    s.projects[0].disabled = true
    expect(itemsOf(s, 'projects')).toHaveLength(0)
  })
})

describe('buildCvDigest', () => {
  it('carries the real item id and the prose, and skips empty sections', () => {
    const s = storeWithProject()
    const digest = buildCvDigest(s, { locale: 'en' })
    expect(digest).toContain(`id: ${pid(s)}`)
    expect(digest).toContain('Was responsible for various work.')
    expect(digest).toContain('## projects')
    // Nothing else has items, so nothing else appears.
    expect(digest).not.toContain('## educations')
  })

  it('labels an item from its identity fields, not its description', () => {
    const s = storeWithProject()
    expect(itemLabel('projects', s.projects[0] as unknown as Record<string, unknown>, 'en'))
      .toBe('Acme — Payments platform')
  })
})

describe('buildBilingualDigest', () => {
  /**
   * The whole point of the cross-language pass: it must read the RAW locale
   * slots. Going through resolve() would show the English text in the Norwegian
   * column and report perfect agreement — the opposite of the answer.
   */
  it('shows an empty second column as empty rather than falling back', () => {
    const s = storeWithProject({ long_description: { en: 'Only English here.' } })
    const digest = buildBilingualDigest(s, 'en', 'no')
    expect(digest).toContain('en: Only English here.')
    expect(digest).toContain('no: (empty)')
    expect(digest).not.toMatch(/no: Only English here\./)
  })

  it('skips fields empty in both languages', () => {
    const s = storeWithProject({ long_description: {}, short_description: {} })
    expect(buildBilingualDigest(s, 'en', 'no')).not.toContain('long_description')
  })
})

describe('validateFindings', () => {
  const ok = (findings: unknown[]) => ({ $schema: FINDINGS_SCHEMA, findings })

  it('resolves a good finding and labels it', () => {
    const s = storeWithProject()
    const { findings, dropped } = validateFindings(ok([{
      severity: 'high', kind: 'missing-outcome', section: 'projects', item_id: pid(s),
      title: 'No outcome', detail: 'Says what, never what came of it.', ask: 'What shipped?',
    }]), s, 'en')
    expect(dropped).toHaveLength(0)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      severity: 'high', section: 'projects', itemId: pid(s), itemLabel: 'Acme — Payments platform',
      ask: 'What shipped?',
    })
  })

  /**
   * A model that invents one id has still produced useful findings; failing the
   * whole run wastes the call. Drops are surfaced, never silent.
   */
  it('drops unresolvable references instead of failing the run', () => {
    const s = storeWithProject()
    const { findings, dropped } = validateFindings(ok([
      { section: 'projects', item_id: 'made-up', title: 'Ghost', detail: 'x' },
      { section: 'not_a_section', item_id: null, title: 'Ghost 2', detail: 'x' },
      { section: 'projects', item_id: pid(s), title: 'Real', detail: 'y' },
    ]), s, 'en')
    expect(findings.map((f) => f.title)).toEqual(['Real'])
    expect(dropped).toHaveLength(2)
  })

  it('accepts a section-level finding (item_id null)', () => {
    const s = storeWithProject()
    const { findings } = validateFindings(ok([
      { section: 'projects', item_id: null, title: 'Thin section', detail: 'Only one project.' },
    ]), s, 'en')
    expect(findings[0].itemId).toBeNull()
  })

  it('sorts most severe first', () => {
    const s = storeWithProject()
    const { findings } = validateFindings(ok([
      { severity: 'low', section: 'projects', item_id: null, title: 'L', detail: 'x' },
      { severity: 'high', section: 'projects', item_id: null, title: 'H', detail: 'x' },
      { severity: 'medium', section: 'projects', item_id: null, title: 'M', detail: 'x' },
    ]), s, 'en')
    expect(findings.map((f) => f.title)).toEqual(['H', 'M', 'L'])
  })

  it('rejects a reply that is not a findings document', () => {
    const s = emptyStore()
    expect(() => validateFindings({ nope: true }, s, 'en')).toThrow(InvalidFindingsError)
    expect(() => validateFindings('text', s, 'en')).toThrow(InvalidFindingsError)
  })
})

describe('validateProposals', () => {
  const ok = (edits: unknown[]) => ({ edits })

  it('accepts a prose rewrite and carries the original for comparison', () => {
    const s = storeWithProject()
    const { proposals, dropped } = validateProposals(ok([{
      section: 'projects', item_id: pid(s), field: 'long_description',
      proposed: 'Ran various work.', why: 'Cut filler.',
    }]), s, 'en')
    expect(dropped).toHaveLength(0)
    expect(proposals[0]).toMatchObject({
      field: 'long_description', current: 'Was responsible for various work.',
      proposed: 'Ran various work.', locale: 'en',
    })
  })

  /**
   * The guard that matters most: a rewritten customer name reads perfectly and
   * is a factual error.
   */
  it('refuses to rewrite an identity field', () => {
    const s = storeWithProject()
    const { proposals, dropped } = validateProposals(ok([{
      section: 'projects', item_id: pid(s), field: 'customer', proposed: 'Acme Corporation',
    }]), s, 'en')
    expect(proposals).toHaveLength(0)
    expect(dropped[0]).toMatch(/not free prose/i)
  })

  it('ignores a no-op edit', () => {
    const s = storeWithProject()
    const { proposals } = validateProposals(ok([{
      section: 'projects', item_id: pid(s), field: 'long_description',
      proposed: 'Was responsible for various work.',
    }]), s, 'en')
    expect(proposals).toHaveLength(0)
  })

  it('rejects a reply with no edits array', () => {
    expect(() => validateProposals({}, emptyStore(), 'en')).toThrow(InvalidProposalsError)
  })
})

describe('applyProposals', () => {
  it('writes only the named locale slot and leaves the other alone', () => {
    const s = storeWithProject()
    const { proposals } = validateProposals({ edits: [{
      section: 'projects', item_id: pid(s), field: 'long_description', proposed: 'Ran the work.',
    }] }, s, 'en')

    const { data, applied, skipped } = applyProposals(s, proposals)
    expect(applied).toBe(1)
    expect(skipped).toHaveLength(0)
    expect(data.projects[0].long_description.en).toBe('Ran the work.')
    expect(data.projects[0].long_description.no).toBe('Ansvarlig for arbeid.')
    // The input store is untouched — replaceData takes the new one.
    expect(s.projects[0].long_description.en).toBe('Was responsible for various work.')
  })

  /**
   * The panel is non-blocking, so the user can keep editing while it's open.
   * Overwriting an edit they made after the run is the one unrecoverable
   * outcome here, so a changed field means skip, not apply.
   */
  it('skips a proposal whose source text changed since the run', () => {
    const s = storeWithProject()
    const { proposals } = validateProposals({ edits: [{
      section: 'projects', item_id: pid(s), field: 'long_description', proposed: 'Ran the work.',
    }] }, s, 'en')

    const edited = structuredClone(s)
    edited.projects[0].long_description.en = 'I rewrote this myself in the meantime.'

    const { applied, skipped, data } = applyProposals(edited, proposals)
    expect(applied).toBe(0)
    expect(skipped).toHaveLength(1)
    expect(data.projects[0].long_description.en).toBe('I rewrote this myself in the meantime.')
  })
})

describe('achievement mining', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    target: 'highlight', section: 'projects', text: 'Cut release time to a day',
    evidence: 'We moved from weekly to daily releases.', ...over,
  })

  it('drops any proposal that quotes no supporting text', () => {
    const s = storeWithProject()
    const { achievements, dropped } = validateMining({
      achievements: [
        entry({ item_id: pid(s), evidence: '' }),
        entry({ item_id: pid(s) }),
      ],
    }, s, 'en')
    expect(achievements).toHaveLength(1)
    expect(dropped[0]).toMatch(/quoted no supporting text/i)
  })

  it('appends a highlight without touching the description it came from', () => {
    const s = storeWithProject()
    const { achievements } = validateMining({ achievements: [entry({ item_id: pid(s) })] }, s, 'en')
    const { data, highlights } = applyAchievements(s, achievements, 'en')
    expect(highlights).toBe(1)
    expect(data.projects[0].highlights).toEqual([{ en: 'Cut release time to a day' }])
    expect(data.projects[0].long_description.en).toBe('Was responsible for various work.')
  })

  it('does not stack a duplicate highlight on a re-run', () => {
    const s = storeWithProject()
    const { achievements } = validateMining({ achievements: [entry({ item_id: pid(s) })] }, s, 'en')
    const once = applyAchievements(s, achievements, 'en').data
    const twice = applyAchievements(once, achievements, 'en')
    expect(twice.highlights).toBe(0)
    expect(twice.data.projects[0].highlights).toHaveLength(1)
  })

  it('creates a competency unstarred, at the end, and in no profile bundle', () => {
    const s = storeWithProject()
    s.key_qualifications = [{
      id: 'kq-1', resume_id: 'resume-1', label: {}, tag_line: { en: 'Architect' },
      summary: {}, key_points: [], skill_tags: [], competency_ids: [],
      sort_order: 0, starred: false, disabled: false, internal_notes: null,
    }]
    const { achievements } = validateMining({
      achievements: [entry({ target: 'competency', item_id: pid(s), detail: 'Owns delivery cadence.' })],
    }, s, 'en')

    const { data, competencies } = applyAchievements(s, achievements, 'en')
    expect(competencies).toBe(1)
    const created = data.key_competencies[0]
    expect(created).toMatchObject({ starred: false, disabled: false })
    expect(created.description.en).toBe('Owns delivery cadence.')
    // Joining a bundle would change what every view built on that profile exports.
    expect(data.key_qualifications[0].competency_ids).toEqual([])
  })
})

describe('profile generator', () => {
  function withLibrary(): ResumeStore {
    const s = storeWithProject()
    const c: KeyCompetency = {
      id: 'comp-1', resume_id: 'resume-1', title: { en: 'Cloud architecture' },
      description: { en: 'Designs cloud platforms.' }, sort_order: 0,
      starred: false, disabled: false,
    }
    s.key_competencies = [c]
    return s
  }

  const draftReply = (bundle: unknown[]) => ({
    profiles: [{
      tag_line: 'Cloud architect, public sector', summary: 'Builds public cloud platforms.',
      summary_short: 'Cloud architect.', rationale: 'For procurement readers.',
      evidence: ['Acme — Payments platform'], bundle,
    }],
  })

  it('reuses a library competency by id and marks a proposed one as new', () => {
    const s = withLibrary()
    const { profiles, dropped } = validateProfileDraft(
      draftReply([
        { id: 'comp-1' },
        { id: null, title: 'Public procurement', description: 'Knows the process.' },
      ]), s, 'en')
    expect(dropped).toHaveLength(0)
    expect(profiles[0].bundle).toEqual([
      { id: 'comp-1', title: 'Cloud architecture', description: 'Designs cloud platforms.', isNew: false },
      { id: null, title: 'Public procurement', description: 'Knows the process.', isNew: true },
    ])
  })

  /**
   * An id that doesn't resolve is a hallucination, not a new competency — a
   * genuine proposal comes back with id null. Creating one would duplicate
   * something already in the library.
   */
  it('drops a bundle entry naming a competency that does not exist', () => {
    const s = withLibrary()
    const { profiles, dropped } = validateProfileDraft(draftReply([{ id: 'ghost' }]), s, 'en')
    expect(profiles[0].bundle).toHaveLength(0)
    expect(dropped[0]).toMatch(/isn't in the library/i)
  })

  it('appends the profile last and creates only the new competencies', () => {
    const s = withLibrary()
    const { profiles } = validateProfileDraft(
      draftReply([{ id: 'comp-1' }, { id: null, title: 'Public procurement', description: 'x' }]), s, 'en')

    const next = applyProfileDraft(s, profiles[0], 'en')
    expect(next.key_competencies).toHaveLength(2)
    expect(next.key_qualifications).toHaveLength(1)
    const added = next.key_qualifications[0]
    expect(added.tag_line.en).toBe('Cloud architect, public sector')
    // Bundle order is preserved, and the reused id is the original.
    expect(added.competency_ids[0]).toBe('comp-1')
    expect(added.competency_ids).toHaveLength(2)
    // Not starred: a view picks the FIRST non-disabled profile, so a generated
    // one must not quietly become what every existing view presents.
    expect(added.starred).toBe(false)
  })
})

describe('tidyIntro', () => {
  it('strips fences, labels and wrapping quotes but keeps paragraphs', () => {
    expect(tidyIntro('```\nHello there.\n```')).toBe('Hello there.')
    expect(tidyIntro('Here is the introduction: Hello there.')).toBe('Hello there.')
    expect(tidyIntro('"Hello there."')).toBe('Hello there.')
    // Unlike tidyLine, more than one line survives.
    expect(tidyIntro('One.\n\nTwo.')).toBe('One.\n\nTwo.')
  })
})

describe('prompt builders', () => {
  it('the review names the registry skills so unregistered ones can be spotted', () => {
    const s = storeWithProject()
    s.skills = [{
      id: 'sk-1', resume_id: 'resume-1', name: { en: 'Kubernetes' },
      total_duration_in_years: 0, proficiency: 3, is_highlighted: false,
      created_at: new Date().toISOString(),
    }]
    const prompt = buildCvReviewPrompt(s, 'en')
    expect(prompt).toContain('Kubernetes')
    expect(prompt).toContain(FINDINGS_SCHEMA)
  })

  /**
   * The voice pass writes, so the prompt must enumerate exactly which fields it
   * may touch — an identity field must never appear in that list.
   */
  it('the voice pass lists only prose fields as editable', () => {
    const prompt = buildVoicePassPrompt(storeWithProject(), 'en')
    expect(prompt).toMatch(/projects: long_description, short_description/)
    expect(prompt).not.toMatch(/projects:.*customer/)
  })
})
