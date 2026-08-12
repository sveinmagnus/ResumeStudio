// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { emptyStore, makeProject } from './fixtures'
import type { ResumeStore } from '../src/types'
import {
  selectRun, unresolved, unseenRuns, hasRunning, useAdvisors, advisorSection,
} from '../src/store/useAdvisors'
import { applyAchievements, validateMining, buildMiningPrompt } from '../src/lib/achievementMining'

const RESUME = 'resume-1'

beforeEach(() => {
  localStorage.clear()
  useAdvisors.setState({ runs: {} })
})

describe('advisor runs', () => {
  /**
   * The whole point: the request is owned by the store, not by the component
   * that started it, so unmounting mid-flight cannot lose a paid-for reply.
   */
  it('records a reply even though nothing is listening', async () => {
    await useAdvisors.getState().start({ id: 'review', resumeId: RESUME }, async () => '{"findings":[]}')
    const run = selectRun(useAdvisors.getState().runs, 'review', RESUME)
    expect(run).toMatchObject({ status: 'done', raw: '{"findings":[]}', seen: false })
  })

  it('marks a failure without losing the run', async () => {
    await useAdvisors.getState().start({ id: 'review', resumeId: RESUME }, async () => { throw new Error('rate limited') })
    expect(selectRun(useAdvisors.getState().runs, 'review', RESUME)).toMatchObject({
      status: 'error', error: 'rate limited',
    })
  })

  it('reports in-flight runs, so the UI can show a spinner anywhere', async () => {
    let release!: (v: string) => void
    const pending = useAdvisors.getState().start({ id: 'voice', resumeId: RESUME }, () => new Promise<string>((r) => { release = r }))
    expect(hasRunning(useAdvisors.getState().runs, RESUME)).toBe(true)
    release('{"edits":[]}')
    await pending
    expect(hasRunning(useAdvisors.getState().runs, RESUME)).toBe(false)
  })

  /** A slow first reply must not overwrite a fast second one. */
  it('lets a newer run supersede an older one', async () => {
    let releaseSlow!: (v: string) => void
    const slow = useAdvisors.getState().start({ id: 'review', resumeId: RESUME }, () => new Promise<string>((r) => { releaseSlow = r }))
    // Bump the clock so the second run has a distinct startedAt.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    await useAdvisors.getState().start({ id: 'review', resumeId: RESUME }, async () => 'SECOND')
    releaseSlow('FIRST')
    await slow
    vi.restoreAllMocks()
    expect(selectRun(useAdvisors.getState().runs, 'review', RESUME)?.raw).toBe('SECOND')
  })

  it('keeps runs for different resumes apart', async () => {
    await useAdvisors.getState().start({ id: 'review', resumeId: 'a' }, async () => 'A')
    await useAdvisors.getState().start({ id: 'review', resumeId: 'b' }, async () => 'B')
    expect(selectRun(useAdvisors.getState().runs, 'review', 'a')?.raw).toBe('A')
    expect(selectRun(useAdvisors.getState().runs, 'review', 'b')?.raw).toBe('B')
    expect(unseenRuns(useAdvisors.getState().runs, 'a')).toHaveLength(1)
  })

  it('announces a finished run until it has been looked at', async () => {
    await useAdvisors.getState().start({ id: 'review', resumeId: RESUME }, async () => 'x')
    expect(unseenRuns(useAdvisors.getState().runs, RESUME)).toHaveLength(1)
    useAdvisors.getState().markSeen({ id: 'review', resumeId: RESUME })
    expect(unseenRuns(useAdvisors.getState().runs, RESUME)).toHaveLength(0)
  })
})

/**
 * Scoped advisors (D2 view intro, D3 section gaps, B4 ATS audit) can be run
 * against several targets in one resume. Without a scope in the key, drafting an
 * intro for the second view would silently replace the one you were reading for
 * the first.
 */
describe('scoped runs', () => {
  it('keeps runs for two views of the same resume apart', async () => {
    const store = useAdvisors.getState()
    await store.start({ id: 'intro', resumeId: RESUME, scope: 'view-a' }, async () => 'A')
    await store.start({ id: 'intro', resumeId: RESUME, scope: 'view-b' }, async () => 'B')

    const runs = useAdvisors.getState().runs
    expect(selectRun(runs, 'intro', RESUME, 'view-a')?.raw).toBe('A')
    expect(selectRun(runs, 'intro', RESUME, 'view-b')?.raw).toBe('B')
  })

  it('does not confuse a scoped run with an unscoped one', async () => {
    await useAdvisors.getState().start({ id: 'section', resumeId: RESUME, scope: 'courses' }, async () => 'C')
    const runs = useAdvisors.getState().runs
    expect(selectRun(runs, 'section', RESUME)).toBeUndefined()
    expect(selectRun(runs, 'section', RESUME, 'courses')?.raw).toBe('C')
  })

  it('clears only the scope it was asked to clear', async () => {
    const store = useAdvisors.getState()
    await store.start({ id: 'ats', resumeId: RESUME, scope: 'v1' }, async () => '1')
    await store.start({ id: 'ats', resumeId: RESUME, scope: 'v2' }, async () => '2')
    useAdvisors.getState().clear({ id: 'ats', resumeId: RESUME, scope: 'v1' })

    const runs = useAdvisors.getState().runs
    expect(selectRun(runs, 'ats', RESUME, 'v1')).toBeUndefined()
    expect(selectRun(runs, 'ats', RESUME, 'v2')?.raw).toBe('2')
  })

  it('sends a finished section run back to the section it examined', async () => {
    await useAdvisors.getState().start({ id: 'section', resumeId: RESUME, scope: 'courses' }, async () => 'x')
    const run = selectRun(useAdvisors.getState().runs, 'section', RESUME, 'courses')!
    expect(advisorSection(run)).toBe('courses')
    // Unscoped advisors still use their static home.
    expect(advisorSection({ id: 'review' })).toBe('overview')
  })

  it('stores the user input a report has to be read against', async () => {
    await useAdvisors.getState().start(
      { id: 'ats', resumeId: RESUME, scope: 'v1' },
      async () => '{}',
      'Kubernetes, Terraform, Go',
    )
    expect(selectRun(useAdvisors.getState().runs, 'ats', RESUME, 'v1')?.input)
      .toBe('Kubernetes, Terraform, Go')
  })
})

describe('per-suggestion resolution', () => {
  const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]

  /**
   * The reported bug: five suggestions, act on one, the other four are gone.
   * Resolution is per key precisely so that can't happen.
   */
  it('keeps the rest when one suggestion is resolved', async () => {
    await useAdvisors.getState().start({ id: 'review', resumeId: RESUME }, async () => 'x')
    useAdvisors.getState().resolve({ id: 'review', resumeId: RESUME }, 'b', 'accepted')

    const run = selectRun(useAdvisors.getState().runs, 'review', RESUME)
    expect(unresolved(items, run).map((i) => i.key)).toEqual(['a', 'c'])
  })

  it('resolves a batch in one go', async () => {
    await useAdvisors.getState().start({ id: 'voice', resumeId: RESUME }, async () => 'x')
    useAdvisors.getState().resolveMany({ id: 'voice', resumeId: RESUME }, ['a', 'c'], 'accepted')
    const run = selectRun(useAdvisors.getState().runs, 'voice', RESUME)
    expect(unresolved(items, run).map((i) => i.key)).toEqual(['b'])
  })

  it('treats an absent run as nothing resolved', () => {
    expect(unresolved(items, undefined)).toHaveLength(3)
  })
})

describe('persistence', () => {
  it('survives a reload', async () => {
    await useAdvisors.getState().start({ id: 'review', resumeId: RESUME }, async () => 'KEEP ME')
    useAdvisors.getState().resolve({ id: 'review', resumeId: RESUME }, 'a', 'dismissed')

    // Re-read exactly what a fresh page load would.
    const stored = JSON.parse(localStorage.getItem('rs-advisor-runs-v1') ?? '{}')
    const run = stored[`${RESUME}::review`]
    expect(run.raw).toBe('KEEP ME')
    expect(run.resolved.a).toBe('dismissed')
  })

  /**
   * A request in flight when the tab closed can never be reattached to, so
   * restoring it as "running" would spin forever. The loader turns it into a
   * visible error instead. Exercised through a fresh module import, because
   * that is the only thing that runs the loader.
   */
  it('does not restore a run as still running', async () => {
    localStorage.setItem('rs-advisor-runs-v1', JSON.stringify({
      [`${RESUME}::review`]: {
        id: 'review', resumeId: RESUME, status: 'running', startedAt: Date.now(), resolved: {}, seen: true,
      },
    }))
    vi.resetModules()
    const fresh = await import('../src/store/useAdvisors')
    const run = fresh.selectRun(fresh.useAdvisors.getState().runs, 'review', RESUME)
    expect(run?.status).toBe('error')
    expect(run?.error).toMatch(/interrupted/i)
  })

  it('drops runs old enough to be advice about a different CV', async () => {
    const ancient = Date.now() - 30 * 24 * 60 * 60 * 1000
    localStorage.setItem('rs-advisor-runs-v1', JSON.stringify({
      [`${RESUME}::review`]: {
        id: 'review', resumeId: RESUME, status: 'done', startedAt: ancient, raw: 'x', resolved: {}, seen: true,
      },
    }))
    vi.resetModules()
    const fresh = await import('../src/store/useAdvisors')
    expect(fresh.selectRun(fresh.useAdvisors.getState().runs, 'review', RESUME)).toBeUndefined()
  })

  it('survives a corrupt cache without taking the app with it', async () => {
    localStorage.setItem('rs-advisor-runs-v1', 'not json{{{')
    vi.resetModules()
    const fresh = await import('../src/store/useAdvisors')
    expect(fresh.useAdvisors.getState().runs).toEqual({})
  })

  it('clearing removes the run entirely', async () => {
    await useAdvisors.getState().start({ id: 'review', resumeId: RESUME }, async () => 'x')
    useAdvisors.getState().clear({ id: 'review', resumeId: RESUME })
    expect(selectRun(useAdvisors.getState().runs, 'review', RESUME)).toBeUndefined()
  })
})

describe('bilingual achievements', () => {
  function storeWithProject(): ResumeStore {
    const s = emptyStore()
    s.projects = [makeProject({
      customer: { en: 'Acme' },
      long_description: { en: 'We moved from weekly to daily releases.' },
    })]
    return s
  }

  const mined = (s: ResumeStore, over: Record<string, unknown> = {}) => validateMining({
    achievements: [{
      target: 'highlight', section: 'projects', item_id: s.projects[0].id,
      text: 'Cut release time to a day',
      evidence: 'We moved from weekly to daily releases.',
      ...over,
    }],
  }, s, 'en').achievements

  /**
   * A CV maintained in two languages must stay that way: a highlight landing
   * only in the primary column silently makes the other version say less, and
   * nothing surfaces that until an export goes out.
   */
  it('writes a highlight into both language columns', () => {
    const s = storeWithProject()
    const [a] = mined(s)
    const bilingual = { ...a, translations: { no: { text: 'Kuttet leveransetid til én dag', detail: '' } } }

    const { data } = applyAchievements(s, [bilingual], 'en')
    expect(data.projects[0].highlights[0]).toEqual({
      en: 'Cut release time to a day',
      no: 'Kuttet leveransetid til én dag',
    })
  })

  it('writes a competency title AND description in both languages', () => {
    const s = storeWithProject()
    const [a] = mined(s, { target: 'competency', detail: 'Owns delivery cadence.' })
    const bilingual = {
      ...a,
      translations: { no: { text: 'Leveransetakt', detail: 'Eier leveransetakten.' } },
    }

    const { data } = applyAchievements(s, [bilingual], 'en')
    expect(data.key_competencies[0].title).toEqual({ en: 'Cut release time to a day', no: 'Leveransetakt' })
    expect(data.key_competencies[0].description).toEqual({
      en: 'Owns delivery cadence.', no: 'Eier leveransetakten.',
    })
  })

  /** No translator configured is primary-only — honest, not broken. */
  it('falls back to one language when nothing was translated', () => {
    const s = storeWithProject()
    const { data } = applyAchievements(s, mined(s), 'en')
    expect(data.projects[0].highlights[0]).toEqual({ en: 'Cut release time to a day' })
  })

  /** An empty translation is skipped, not stored as a deliberate blank. */
  it('ignores an empty translation', () => {
    const s = storeWithProject()
    const [a] = mined(s)
    const { data } = applyAchievements(
      s, [{ ...a, translations: { no: { text: '   ', detail: '' } } }], 'en',
    )
    expect(data.projects[0].highlights[0]).toEqual({ en: 'Cut release time to a day' })
  })
})

describe('achievement mining — the prompt, the drops and what lands where', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.projects = [makeProject({
      id: 'p1',
      customer: { en: 'Acme' },
      long_description: { en: 'We moved from weekly to daily releases.' },
      short_description: { en: 'Release work.' },
    })]
    return s
  }

  const one = (over: Record<string, unknown> = {}) => ({
    target: 'highlight', section: 'projects', item_id: 'p1',
    text: 'Cut release time to a day',
    evidence: 'We moved from weekly to daily releases.',
    ...over,
  })

  it('sends the LONG descriptions and not the one-line summaries', () => {
    // The short line is derived from the long one; including it would spend
    // context on text that can hold no unmined achievement.
    const prompt = buildMiningPrompt(store(), 'en')
    expect(prompt).toContain('We moved from weekly to daily releases.')
    expect(prompt).not.toContain('Release work.')
  })

  it('counts entries from ONE when it reports what it dropped', () => {
    const { dropped } = validateMining({ achievements: [one({ item_id: 'gone' })] }, store(), 'en')
    expect(dropped[0]).toMatch(/^Entry 1 /)
  })

  it('quotes only the START of a rejected achievement, not the whole line', () => {
    const long = 'x'.repeat(200)
    const { dropped } = validateMining({ achievements: [one({ text: long, evidence: '' })] }, store(), 'en')
    expect(dropped[0]).toContain('…')
    expect(dropped[0].length).toBeLessThan(120)
  })

  it('drops an achievement with no supporting quote — the anti-invention contract', () => {
    const { achievements, dropped } = validateMining(
      { achievements: [one({ evidence: '' })] }, store(), 'en',
    )
    expect(achievements).toHaveLength(0)
    expect(dropped[0]).toMatch(/^Entry 1 /)
    expect(dropped[0]).toMatch(/quoted no supporting text/)
  })

  it('does not let a translation overwrite the primary column', () => {
    // A model echoing the source locale back in `translations` would replace the
    // text the user is reviewing with an unreviewed one.
    const s = store()
    const [a] = validateMining({ achievements: [one()] }, s, 'en').achievements
    const echoed = { ...a, translations: { en: { text: 'Something else', detail: '' } } }
    const { data } = applyAchievements(s, [echoed], 'en')
    expect(data.projects[0].highlights[0]).toEqual({ en: 'Cut release time to a day' })
  })

  it('lands a highlight as a highlight and nothing else', () => {
    const s = store()
    const { achievements } = validateMining({ achievements: [one()] }, s, 'en')
    const { data, highlights, competencies } = applyAchievements(s, achievements, 'en')
    expect([highlights, competencies]).toEqual([1, 0])
    expect(data.key_competencies).toBe(s.key_competencies)
  })

  it('lands a competency as a competency and adds no highlight', () => {
    const s = store()
    const { achievements } = validateMining(
      { achievements: [one({ target: 'competency', detail: 'Owns delivery cadence.' })] }, s, 'en',
    )
    const { data, highlights, competencies } = applyAchievements(s, achievements, 'en')
    expect([highlights, competencies]).toEqual([0, 1])
    expect(data.projects[0].highlights).toEqual([])
  })

  it('refuses a highlight for an item that has no highlights at all', () => {
    const s = store()
    delete (s.projects[0] as unknown as Record<string, unknown>).highlights
    const { achievements, dropped } = validateMining({ achievements: [one()] }, s, 'en')
    expect(achievements).toHaveLength(0)
    expect(dropped[0]).toMatch(/no highlights/)
  })

  it('adds the FIRST highlight when the array went missing after the run', () => {
    // The run is non-blocking, so the item can change under it; the write must
    // start a fresh list rather than reading through a missing one.
    const s = store()
    const { achievements } = validateMining({ achievements: [one()] }, s, 'en')
    delete (s.projects[0] as unknown as Record<string, unknown>).highlights
    const { data, highlights } = applyAchievements(s, achievements, 'en')
    expect(highlights).toBe(1)
    expect(data.projects[0].highlights).toEqual([{ en: 'Cut release time to a day' }])
  })

  it('appends beside an existing DIFFERENT highlight', () => {
    const s = store()
    s.projects[0].highlights = [{ en: 'Something else entirely' }]
    const { achievements } = validateMining({ achievements: [one()] }, s, 'en')
    const { data } = applyAchievements(s, achievements, 'en')
    expect(data.projects[0].highlights.map((h) => h.en))
      .toEqual(['Something else entirely', 'Cut release time to a day'])
  })

  it('does not stack a duplicate when the existing line is stored padded', () => {
    // Re-running the pass must not add the same line twice, and the stored
    // value may carry whitespace the model never sent.
    const s = store()
    s.projects[0].highlights = [{ en: '  Cut release time to a day  ' }]
    const { achievements } = validateMining({ achievements: [one()] }, s, 'en')
    const { data, highlights } = applyAchievements(s, achievements, 'en')
    expect(highlights).toBe(0)
    expect(data.projects[0].highlights).toHaveLength(1)
  })

  it('survives a highlights array holding a blank entry', () => {
    const s = store()
    ;(s.projects[0] as unknown as { highlights: unknown[] }).highlights = [null, { en: 'Other' }]
    const { achievements } = validateMining({ achievements: [one()] }, s, 'en')
    const { data, highlights } = applyAchievements(s, achievements, 'en')
    expect(highlights).toBe(1)
    expect(data.projects[0].highlights).toHaveLength(3)
  })
})
