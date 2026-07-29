// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { emptyStore, makeProject } from './fixtures'
import type { ResumeStore } from '../src/types'
import {
  selectRun, unresolved, unseenRuns, hasRunning, useAdvisors,
} from '../src/store/useAdvisors'
import { applyAchievements, validateMining } from '../src/lib/achievementMining'

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
    await useAdvisors.getState().start('review', RESUME, async () => '{"findings":[]}')
    const run = selectRun(useAdvisors.getState().runs, 'review', RESUME)
    expect(run).toMatchObject({ status: 'done', raw: '{"findings":[]}', seen: false })
  })

  it('marks a failure without losing the run', async () => {
    await useAdvisors.getState().start('review', RESUME, async () => { throw new Error('rate limited') })
    expect(selectRun(useAdvisors.getState().runs, 'review', RESUME)).toMatchObject({
      status: 'error', error: 'rate limited',
    })
  })

  it('reports in-flight runs, so the UI can show a spinner anywhere', async () => {
    let release!: (v: string) => void
    const pending = useAdvisors.getState().start('voice', RESUME, () => new Promise<string>((r) => { release = r }))
    expect(hasRunning(useAdvisors.getState().runs, RESUME)).toBe(true)
    release('{"edits":[]}')
    await pending
    expect(hasRunning(useAdvisors.getState().runs, RESUME)).toBe(false)
  })

  /** A slow first reply must not overwrite a fast second one. */
  it('lets a newer run supersede an older one', async () => {
    let releaseSlow!: (v: string) => void
    const slow = useAdvisors.getState().start('review', RESUME, () => new Promise<string>((r) => { releaseSlow = r }))
    // Bump the clock so the second run has a distinct startedAt.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    await useAdvisors.getState().start('review', RESUME, async () => 'SECOND')
    releaseSlow('FIRST')
    await slow
    vi.restoreAllMocks()
    expect(selectRun(useAdvisors.getState().runs, 'review', RESUME)?.raw).toBe('SECOND')
  })

  it('keeps runs for different resumes apart', async () => {
    await useAdvisors.getState().start('review', 'a', async () => 'A')
    await useAdvisors.getState().start('review', 'b', async () => 'B')
    expect(selectRun(useAdvisors.getState().runs, 'review', 'a')?.raw).toBe('A')
    expect(selectRun(useAdvisors.getState().runs, 'review', 'b')?.raw).toBe('B')
    expect(unseenRuns(useAdvisors.getState().runs, 'a')).toHaveLength(1)
  })

  it('announces a finished run until it has been looked at', async () => {
    await useAdvisors.getState().start('review', RESUME, async () => 'x')
    expect(unseenRuns(useAdvisors.getState().runs, RESUME)).toHaveLength(1)
    useAdvisors.getState().markSeen('review', RESUME)
    expect(unseenRuns(useAdvisors.getState().runs, RESUME)).toHaveLength(0)
  })
})

describe('per-suggestion resolution', () => {
  const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]

  /**
   * The reported bug: five suggestions, act on one, the other four are gone.
   * Resolution is per key precisely so that can't happen.
   */
  it('keeps the rest when one suggestion is resolved', async () => {
    await useAdvisors.getState().start('review', RESUME, async () => 'x')
    useAdvisors.getState().resolve('review', RESUME, 'b', 'accepted')

    const run = selectRun(useAdvisors.getState().runs, 'review', RESUME)
    expect(unresolved(items, run).map((i) => i.key)).toEqual(['a', 'c'])
  })

  it('resolves a batch in one go', async () => {
    await useAdvisors.getState().start('voice', RESUME, async () => 'x')
    useAdvisors.getState().resolveMany('voice', RESUME, ['a', 'c'], 'accepted')
    const run = selectRun(useAdvisors.getState().runs, 'voice', RESUME)
    expect(unresolved(items, run).map((i) => i.key)).toEqual(['b'])
  })

  it('treats an absent run as nothing resolved', () => {
    expect(unresolved(items, undefined)).toHaveLength(3)
  })
})

describe('persistence', () => {
  it('survives a reload', async () => {
    await useAdvisors.getState().start('review', RESUME, async () => 'KEEP ME')
    useAdvisors.getState().resolve('review', RESUME, 'a', 'dismissed')

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
    await useAdvisors.getState().start('review', RESUME, async () => 'x')
    useAdvisors.getState().clear('review', RESUME)
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
