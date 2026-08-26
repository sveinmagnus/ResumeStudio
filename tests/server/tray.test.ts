import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  routeClick, startTray, TRAY_OPEN, TRAY_QUIT, TRAY_CHECK_DEFAULT, TRAY_INSTALL_DEFAULT,
  type TrayHandlers, type TrayOptions, type TrayUpdateView,
} from '../../server/desktop/tray'

interface FakeMenuItem { title: string; tooltip?: string; enabled?: boolean }
interface FakeTrayConf {
  menu: { icon: string; isTemplateIcon: boolean; title: string; tooltip: string; items: FakeMenuItem[] }
  debug: boolean
  copyDir: boolean
}
interface ClickAction { item?: { title?: string } }

const tray = vi.hoisted(() => {
  const instances: FakeSysTray[] = []
  class FakeSysTray {
    static readonly separator = { title: '<SEPARATOR>' }
    static failNext = false
    conf: FakeTrayConf
    clickHandler: ((action: ClickAction) => void) | null = null
    errorHandler: ((err: Error) => void) | null = null
    actions: { type: string; item: FakeMenuItem }[] = []
    killedWith: unknown[] = []
    failSendAction = false
    failKill = false
    constructor(conf: FakeTrayConf) {
      if (FakeSysTray.failNext) { FakeSysTray.failNext = false; throw new Error('no tray helper') }
      this.conf = conf
      instances.push(this)
    }
    ready(): Promise<void> { return Promise.resolve() }
    onClick(cb: (action: ClickAction) => void): Promise<void> { this.clickHandler = cb; return Promise.resolve() }
    onError(cb: (err: Error) => void): void { this.errorHandler = cb }
    sendAction(a: { type: string; item: FakeMenuItem }): Promise<void> {
      if (this.failSendAction) throw new Error('helper gone')
      // Snapshot: the caller mutates and re-pushes the same item objects.
      this.actions.push({ type: a.type, item: { ...a.item } })
      return Promise.resolve()
    }
    kill(exitNode?: boolean): void {
      if (this.failKill) throw new Error('kill refused')
      this.killedWith.push(exitNode)
    }
  }
  return { FakeSysTray, instances }
})

// The tsx-shaped CJS→ESM interop (constructor at `default`). The other two
// shapes tray.ts must survive — the esbuild bundle's `default.default` and an
// unrecognizable module — are exercised via vi.doMock + a fresh import below.
vi.mock('systray2', () => ({ default: tray.FakeSysTray }))

function handlers(): TrayHandlers & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    onOpen: () => calls.push('open'),
    onQuit: () => calls.push('quit'),
    onCheck: () => calls.push('check'),
    onInstall: () => calls.push('install'),
  }
}

const titles = { check: TRAY_CHECK_DEFAULT, install: TRAY_INSTALL_DEFAULT }

type OptsWithSpies = TrayOptions & { logs: string[]; fired: string[] }
function makeOpts(view?: Partial<TrayUpdateView>): OptsWithSpies {
  const logs: string[] = []
  const fired: string[] = []
  return {
    logs, fired,
    log: (m: string) => { logs.push(m) },
    onOpen: () => fired.push('open'),
    onQuit: () => fired.push('quit'),
    onCheck: () => fired.push('check'),
    onInstall: () => fired.push('install'),
    initialView: {
      versionLabel: 'Cartavio Resume Studio v1.2.0',
      checkTitle: TRAY_CHECK_DEFAULT,
      checkEnabled: true,
      installTitle: TRAY_INSTALL_DEFAULT,
      installEnabled: false,
      ...view,
    },
  }
}

const NEW_VIEW: TrayUpdateView = {
  versionLabel: 'Cartavio Resume Studio v2.0.0',
  checkTitle: 'Checking for updates…',
  checkEnabled: false,
  installTitle: 'Install update (v2.0.0)',
  installEnabled: true,
}

beforeEach(() => {
  tray.instances.length = 0
  tray.FakeSysTray.failNext = false
})

describe('routeClick', () => {
  it('dispatches Open and Quit by their fixed titles', () => {
    const h = handlers()
    routeClick(TRAY_OPEN, h, titles)
    routeClick(TRAY_QUIT, h, titles)
    expect(h.calls).toEqual(['open', 'quit'])
  })

  it('dispatches Check and Install as two distinct items', () => {
    const h = handlers()
    routeClick(TRAY_CHECK_DEFAULT, h, titles)
    routeClick(TRAY_INSTALL_DEFAULT, h, titles)
    expect(h.calls).toEqual(['check', 'install'])
  })

  it('matches the items by their CURRENT (changing) titles', () => {
    const h = handlers()
    const live = { check: 'Checking for updates…', install: 'Install update (v2.0.0)' }
    routeClick('Install update (v2.0.0)', h, live)
    routeClick('Checking for updates…', h, live)
    expect(h.calls).toEqual(['install', 'check'])
  })

  it('does not fire for a stale title once the live title changed', () => {
    const h = handlers()
    // Install item now reads "Downloading… 12%"; a click reporting the old
    // "Install update" title must NOT dispatch.
    routeClick(TRAY_INSTALL_DEFAULT, h, { check: TRAY_CHECK_DEFAULT, install: 'Downloading… 12%' })
    expect(h.calls).toEqual([])
  })

  it('ignores the version header, unknown titles, and undefined', () => {
    const h = handlers()
    // Disabled header
    routeClick('Cartavio Resume Studio v0.2.1', h, titles)
    routeClick('Something else', h, titles)
    routeClick(undefined, h, titles)
    expect(h.calls).toEqual([])
  })

  it('does not call any handler unexpectedly', () => {
    const onOpen = vi.fn(); const onQuit = vi.fn(); const onCheck = vi.fn(); const onInstall = vi.fn()
    routeClick('nope', { onOpen, onQuit, onCheck, onInstall }, titles)
    expect(onOpen).not.toHaveBeenCalled()
    expect(onQuit).not.toHaveBeenCalled()
    expect(onCheck).not.toHaveBeenCalled()
    expect(onInstall).not.toHaveBeenCalled()
  })
})

describe('startTray', () => {
  it('builds the documented menu: disabled version header, Open/Quit enabled, update items per the view', async () => {
    const opts = makeOpts()
    const handle = await startTray(opts)
    expect(handle).not.toBeNull()
    const inst = tray.instances[0]
    const menu = inst.conf.menu
    expect(menu.icon.length).toBeGreaterThan(0)
    expect(menu.isTemplateIcon).toBe(false)
    expect(menu.title).toBe('Resume Studio')
    expect(menu.tooltip).toBe('Resume Studio')
    expect(menu.items).toHaveLength(8)
    expect(menu.items[0]).toEqual({ title: 'Cartavio Resume Studio v1.2.0', tooltip: 'Installed version', enabled: false })
    expect(menu.items[1]).toBe(tray.FakeSysTray.separator)
    expect(menu.items[2]).toEqual({ title: TRAY_OPEN, tooltip: 'Open Resume Studio in your browser', enabled: true })
    expect(menu.items[3]).toBe(tray.FakeSysTray.separator)
    expect(menu.items[4]).toEqual({ title: TRAY_CHECK_DEFAULT, tooltip: 'Check GitHub for a newer version', enabled: true })
    expect(menu.items[5]).toEqual({ title: TRAY_INSTALL_DEFAULT, tooltip: 'Install the available update', enabled: false })
    expect(menu.items[6]).toBe(tray.FakeSysTray.separator)
    expect(menu.items[7]).toEqual({ title: TRAY_QUIT, tooltip: 'Stop Resume Studio', enabled: true })
    expect(inst.conf.debug).toBe(false)
    expect(inst.conf.copyDir).toBe(false)
    expect(opts.logs.join('\n')).toContain('ready')
  })

  it('routes clicks through the LIVE titles, following setUpdate', async () => {
    const opts = makeOpts()
    const handle = (await startTray(opts))!
    const inst = tray.instances[0]
    inst.clickHandler?.({ item: { title: TRAY_OPEN } })
    inst.clickHandler?.({ item: { title: TRAY_CHECK_DEFAULT } })
    expect(opts.fired).toEqual(['open', 'check'])

    handle.setUpdate(NEW_VIEW)
    inst.clickHandler?.({ item: { title: TRAY_CHECK_DEFAULT } })
    inst.clickHandler?.({ item: { title: 'Checking for updates…' } })
    inst.clickHandler?.({ item: { title: 'Install update (v2.0.0)' } })
    expect(opts.fired).toEqual(['open', 'check', 'check', 'install'])
  })

  it('a click with no item is ignored, not a crash', async () => {
    const opts = makeOpts()
    await startTray(opts)
    const inst = tray.instances[0]
    expect(() => inst.clickHandler?.({})).not.toThrow()
    expect(opts.fired).toEqual([])
  })

  it('setUpdate pushes all three items to the helper with the new titles and enabled flags', async () => {
    const opts = makeOpts()
    const handle = (await startTray(opts))!
    const inst = tray.instances[0]
    handle.setUpdate(NEW_VIEW)
    expect(inst.actions.map((a) => a.type)).toEqual(['update-item', 'update-item', 'update-item'])
    expect(inst.actions.map((a) => a.item.title)).toEqual([
      'Cartavio Resume Studio v2.0.0', 'Checking for updates…', 'Install update (v2.0.0)',
    ])
    expect(inst.actions[1].item.enabled).toBe(false)
    expect(inst.actions[2].item.enabled).toBe(true)
  })

  it('a helper that refuses the update does not throw into the caller', async () => {
    const opts = makeOpts()
    const handle = (await startTray(opts))!
    const inst = tray.instances[0]
    inst.failSendAction = true
    expect(() => handle.setUpdate(NEW_VIEW)).not.toThrow()
    expect(inst.actions).toHaveLength(0)
  })

  it('kill tears down the helper WITHOUT exiting node, and never throws', async () => {
    const opts = makeOpts()
    const handle = (await startTray(opts))!
    const inst = tray.instances[0]
    handle.kill()
    expect(inst.killedWith).toEqual([false])
    inst.failKill = true
    expect(() => handle.kill()).not.toThrow()
  })

  it('logs a helper error instead of crashing', async () => {
    const opts = makeOpts()
    await startTray(opts)
    tray.instances[0].errorHandler?.(new Error('helper crashed'))
    expect(opts.logs.join('\n')).toContain('helper crashed')
  })

  it('a helper that cannot start yields null and a log line, never a throw', async () => {
    tray.FakeSysTray.failNext = true
    const opts = makeOpts()
    await expect(startTray(opts)).resolves.toBeNull()
    expect(opts.logs.join('\n')).toContain('unavailable')
    expect(opts.logs.join('\n')).toContain('no tray helper')
  })

  it('resolves the constructor from the bundle interop shape (default.default)', async () => {
    vi.resetModules()
    vi.doMock('systray2', () => ({ default: { default: tray.FakeSysTray } }))
    try {
      const mod = await import('../../server/desktop/tray')
      const opts = makeOpts()
      const handle = await mod.startTray(opts)
      expect(handle).not.toBeNull()
      expect(tray.instances).toHaveLength(1)
    } finally {
      vi.doUnmock('systray2')
      vi.resetModules()
    }
  })

  it('an unrecognizable module shape degrades to "no tray", never a crash', async () => {
    vi.resetModules()
    // A default that is neither the constructor nor wraps one. (A module with
    // NO default at all is not constructible here: vitest's mock runtime
    // throws its own guard on accessing a missing export.)
    vi.doMock('systray2', () => ({ default: { notAConstructor: true } }))
    try {
      const mod = await import('../../server/desktop/tray')
      const opts = makeOpts()
      await expect(mod.startTray(opts)).resolves.toBeNull()
      expect(opts.logs.join('\n')).toContain('unavailable')
    } finally {
      vi.doUnmock('systray2')
      vi.resetModules()
    }
  })
})
