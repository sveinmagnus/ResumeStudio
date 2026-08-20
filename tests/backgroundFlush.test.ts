/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { backgroundFlush } from '../src/store/useResumePersistence'
import { savePending, loadPending } from '../src/lib/localCache'
import { api, ConflictError, NotFoundError } from '../src/lib/api'
import { emptyStore, makeResume } from './fixtures'

const dirty = (id: string, baseVersion = 3) =>
  savePending(id, {
    data: { ...emptyStore(), resume: makeResume() },
    locales: { primary: 'en', secondary: null },
    base_version: baseVersion,
    dirty: true,
  })

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('backgroundFlush', () => {
  it('pushes a dirty record with its base version, then clears it on success', async () => {
    dirty('r1', 7)
    const save = vi.spyOn(api, 'saveResume').mockResolvedValue({ saved_at: 'x', version: 8 })

    await backgroundFlush('r1')

    expect(save).toHaveBeenCalledTimes(1)
    // base_version (4th arg) is forwarded for the concurrency check.
    expect(save.mock.calls[0][3]).toBe(7)
    expect(loadPending('r1')).toBeNull() // cleared = synced
  })

  it('leaves the record dirty on a 409 (conflict resolves when the resume is opened)', async () => {
    dirty('r1')
    vi.spyOn(api, 'saveResume').mockRejectedValue(
      new ConflictError({ data: emptyStore(), meta: { ...makeMeta() } }),
    )
    await backgroundFlush('r1')
    expect(loadPending('r1')?.dirty).toBe(true) // still queued
  })

  it('leaves the record dirty on a network/server error', async () => {
    dirty('r1')
    vi.spyOn(api, 'saveResume').mockRejectedValue(new Error('network down'))
    await backgroundFlush('r1')
    expect(loadPending('r1')?.dirty).toBe(true)
  })

  it('drops the record on a 404 — a queue that can never drain is not a queue', async () => {
    // 404 means the resume was deleted, OR that it is a colleague's which this
    // account may read but never write (the server refuses that as "not found"
    // so ids stay unenumerable). Neither becomes writable by waiting, so
    // keeping the record would retry it on every reconnect forever.
    dirty('r1')
    vi.spyOn(api, 'saveResume').mockRejectedValue(new NotFoundError('Resume not found'))
    await backgroundFlush('r1')
    expect(loadPending('r1')).toBeNull()
  })

  it('is a no-op for a clean or missing record', async () => {
    const save = vi.spyOn(api, 'saveResume')
    await backgroundFlush('nonexistent')
    savePending('clean', {
      data: emptyStore(), locales: { primary: 'en', secondary: null },
      base_version: 1, dirty: false,
    })
    await backgroundFlush('clean')
    expect(save).not.toHaveBeenCalled()
  })
})

function makeMeta() {
  return {
    id: 'r1', name: 'CV', primary_locale: 'en', secondary_locale: null,
    saved_at: 'x', created_at: 'x', version: 9,
  }
}
