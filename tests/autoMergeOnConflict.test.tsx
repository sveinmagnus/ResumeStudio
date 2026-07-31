/**
 * @vitest-environment jsdom
 *
 * The auto-merge half of the conflict path, exercised through the real hook.
 *
 * `tests/threeWayMerge.test.ts` proves the merge decides correctly; this proves
 * the editor actually USES it — that a refused save over non-overlapping edits
 * is reconciled and re-sent without ever raising the modal, and that a genuine
 * clash still stops and asks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResumePersistence } from '../src/store/useResumePersistence'
import { useStore } from '../src/store/useStore'
import { api, ConflictError } from '../src/lib/api'
import { resetStore } from './helpers/store-reset'
import { emptyStore, makeProject, makeResume } from './fixtures'
import type { ResumeStore } from '../src/types'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const MINE_ID = 'p-mine'
const THEIRS_ID = 'p-theirs'

function baseStore(): ResumeStore {
  return {
    ...emptyStore(),
    resume: makeResume(),
    projects: [
      makeProject({ id: MINE_ID, customer: { en: 'Acme' } }),
      makeProject({ id: THEIRS_ID, customer: { en: 'Initech' } }),
    ],
  }
}

const meta = (version: number) => ({
  id: 'r1', name: 'CV', primary_locale: 'en', secondary_locale: null,
  saved_at: 'x', created_at: 'x', version,
})

beforeEach(() => {
  localStorage.clear()
  resetStore()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

/** Mount the hook on a loaded resume and settle the boot promises. */
async function bootEditor(base: ResumeStore) {
  vi.spyOn(api, 'loadResume').mockResolvedValue({ data: clone(base), meta: meta(1) })
  vi.spyOn(api, 'listRegistry').mockResolvedValue([])
  const view = renderHook(() => useResumePersistence('r1'))
  await act(async () => { await Promise.resolve() })
  expect(view.result.current.loadState).toBe('ready')
  return view
}

describe('a refused save over non-overlapping edits', () => {
  it('merges silently and re-saves, without surfacing a conflict', async () => {
    const base = baseStore()
    const view = await bootEditor(base)

    // Their edit, already on the server: a different project.
    const theirs = clone(base)
    theirs.projects[1].customer = { en: 'Initech Ltd' }

    const save = vi.spyOn(api, 'saveResume')
      .mockRejectedValueOnce(new ConflictError({ data: theirs, meta: meta(2) }))
      .mockResolvedValue({ saved_at: 'y', version: 3 })

    // My edit, in this editor.
    act(() => {
      useStore.getState().updateItem('projects', MINE_ID, { customer: { en: 'Acme Corp' } })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })   // save debounce → 409
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })   // merged re-save

    expect(view.result.current.conflict).toBeNull()
    expect(save).toHaveBeenCalledTimes(2)

    // The second PUT carries BOTH sides' work, at the server's new version.
    const [, sentData, , sentBase] = save.mock.calls[1]
    const sent = sentData as ResumeStore
    expect(sent.projects.find((p) => p.id === MINE_ID)!.customer).toEqual({ en: 'Acme Corp' })
    expect(sent.projects.find((p) => p.id === THEIRS_ID)!.customer).toEqual({ en: 'Initech Ltd' })
    expect(sentBase).toBe(2)

    // The editor shows the merged document too, not just the wire.
    const live = useStore.getState().data
    expect(live.projects.find((p) => p.id === THEIRS_ID)!.customer).toEqual({ en: 'Initech Ltd' })
  })

  it('leaves nothing queued once the merged save lands', async () => {
    const base = baseStore()
    await bootEditor(base)

    const theirs = clone(base)
    theirs.projects[1].description = { en: 'Their note' }

    vi.spyOn(api, 'saveResume')
      .mockRejectedValueOnce(new ConflictError({ data: theirs, meta: meta(2) }))
      .mockResolvedValue({ saved_at: 'y', version: 3 })

    act(() => {
      useStore.getState().updateItem('projects', MINE_ID, { customer: { en: 'Acme Corp' } })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })

    expect(localStorage.getItem('resumestudio:store-cache:v1:r1')).toBeNull()
  })
})

describe('a refused save over the SAME value', () => {
  it('still stops and asks, listing only what is contested', async () => {
    const base = baseStore()
    const view = await bootEditor(base)

    const theirs = clone(base)
    theirs.projects[0].customer = { en: 'Acme AS' }        // same field…
    theirs.projects[1].customer = { en: 'Initech Ltd' }    // …plus one that is not

    const save = vi.spyOn(api, 'saveResume')
      .mockRejectedValue(new ConflictError({ data: theirs, meta: meta(2) }))

    act(() => {
      useStore.getState().updateItem('projects', MINE_ID, { customer: { en: 'Acme Corp' } })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })

    const conflict = view.result.current.conflict
    expect(conflict).not.toBeNull()
    expect(conflict!.conflicts).toHaveLength(1)
    expect(conflict!.conflicts![0]).toMatchObject({
      section: 'projects', itemId: MINE_ID, mine: 'Acme Corp', theirs: 'Acme AS',
    })
    expect(view.result.current.saveState).toBe('conflict')

    // Auto-save is paused: no retry storm while the user decides.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(save).toHaveBeenCalledTimes(1)
  })
})
