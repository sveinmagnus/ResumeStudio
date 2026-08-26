/**
 * The backup-runtime handoff point — the launcher seeds it, the settings route
 * reconfigures it, shutdown flushes through it. The full mutation sweep found
 * it had no direct suite at all (26 of 29 mutants unkilled), and every failure
 * here is the silent kind: sync not running while the panel says it is, or a
 * replaced watcher left chasing the old folder.
 *
 * The scheduler/watcher classes are mocked at the boundary; what this suite
 * pins is the LIFECYCLE — construct with the right options, start, stop the
 * predecessor, and answer isBackupRuntimeActive truthfully. Module state is
 * process-wide, so every test imports a fresh copy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface FakeService {
  opts: { db: unknown; dir: string; intervalMs: number; log: (m: string) => void }
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  flush: ReturnType<typeof vi.fn>
}

const state = vi.hoisted(() => ({
  schedulers: [] as FakeService[],
  watchers: [] as FakeService[],
  db: { fake: 'db' },
}))

vi.mock('../../server/backupScheduler.js', () => ({
  BackupScheduler: class {
    opts: FakeService['opts']
    start = vi.fn()
    stop = vi.fn()
    flush = vi.fn()
    constructor(opts: FakeService['opts']) {
      this.opts = opts
      state.schedulers.push(this as unknown as FakeService)
    }
  },
}))
vi.mock('../../server/backupWatcher.js', () => ({
  BackupWatcher: class {
    opts: FakeService['opts']
    start = vi.fn()
    stop = vi.fn()
    flush = vi.fn()
    constructor(opts: FakeService['opts']) {
      this.opts = opts
      state.watchers.push(this as unknown as FakeService)
    }
  },
}))
vi.mock('../../server/db.js', () => ({
  getDefaultDb: () => state.db,
}))

async function loadRuntime() {
  vi.resetModules()
  state.schedulers.length = 0
  state.watchers.length = 0
  return import('../../server/backupRuntime.js')
}

beforeEach(() => vi.clearAllMocks())

describe('reconfigureBackup', () => {
  it('starts a scheduler AND a watcher for the folder, with the seeded logger', async () => {
    const rt = await loadRuntime()
    const log = vi.fn()
    rt.initBackupRuntime(log)
    expect(rt.isBackupRuntimeActive()).toBe(false)

    rt.reconfigureBackup('C:/sync', 5000)

    expect(state.schedulers).toHaveLength(1)
    expect(state.watchers).toHaveLength(1)
    for (const svc of [state.schedulers[0], state.watchers[0]]) {
      expect(svc.opts).toMatchObject({ db: state.db, dir: 'C:/sync', intervalMs: 5000 })
      expect(svc.opts.log).toBe(log)
      expect(svc.start).toHaveBeenCalledTimes(1)
    }
    expect(rt.isBackupRuntimeActive()).toBe(true)
  })

  it('stops the previous pair before starting the new one', async () => {
    const rt = await loadRuntime()
    rt.reconfigureBackup('C:/old', 5000)
    const [oldSched, oldWatch] = [state.schedulers[0], state.watchers[0]]

    rt.reconfigureBackup('C:/new', 9000)

    expect(oldSched.stop).toHaveBeenCalledTimes(1)
    expect(oldWatch.stop).toHaveBeenCalledTimes(1)
    expect(state.schedulers[1].opts.dir).toBe('C:/new')
    expect(state.watchers[1].opts.intervalMs).toBe(9000)
    expect(rt.isBackupRuntimeActive()).toBe(true)
  })

  it('a null or whitespace-only dir tears sync down and starts nothing', async () => {
    for (const dir of [null, '   ']) {
      const rt = await loadRuntime()
      rt.reconfigureBackup('C:/sync', 5000)
      const [sched, watch] = [state.schedulers[0], state.watchers[0]]

      rt.reconfigureBackup(dir, 5000)

      expect(sched.stop).toHaveBeenCalledTimes(1)
      expect(watch.stop).toHaveBeenCalledTimes(1)
      expect(state.schedulers).toHaveLength(1)
      expect(state.watchers).toHaveLength(1)
      expect(rt.isBackupRuntimeActive()).toBe(false)
    }
  })
})

describe('flush and stop', () => {
  it('flushBackup delegates to the active scheduler and is a no-op when sync is off', async () => {
    const rt = await loadRuntime()
    expect(() => rt.flushBackup()).not.toThrow()

    rt.reconfigureBackup('C:/sync', 5000)
    rt.flushBackup()
    expect(state.schedulers[0].flush).toHaveBeenCalledTimes(1)
  })

  it('stopBackup stops both, reports inactive, and later flushes reach nothing', async () => {
    const rt = await loadRuntime()
    rt.reconfigureBackup('C:/sync', 5000)
    const sched = state.schedulers[0]

    rt.stopBackup()

    expect(sched.stop).toHaveBeenCalledTimes(1)
    expect(state.watchers[0].stop).toHaveBeenCalledTimes(1)
    expect(rt.isBackupRuntimeActive()).toBe(false)
    rt.flushBackup()
    expect(sched.flush).not.toHaveBeenCalled()
  })
})
