import { describe, it, expect, vi } from 'vitest'
import { routeClick, TRAY_OPEN, TRAY_QUIT, TRAY_UPDATE_DEFAULT, type TrayHandlers } from '../../server/desktop/tray'

function handlers(): TrayHandlers & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    onOpen: () => calls.push('open'),
    onQuit: () => calls.push('quit'),
    onUpdate: () => calls.push('update'),
  }
}

describe('routeClick', () => {
  it('dispatches Open and Quit by their fixed titles', () => {
    const h = handlers()
    routeClick(TRAY_OPEN, h, TRAY_UPDATE_DEFAULT)
    routeClick(TRAY_QUIT, h, TRAY_UPDATE_DEFAULT)
    expect(h.calls).toEqual(['open', 'quit'])
  })

  it('dispatches the update item by its CURRENT (toggling) title', () => {
    const h = handlers()
    // Default title.
    routeClick(TRAY_UPDATE_DEFAULT, h, TRAY_UPDATE_DEFAULT)
    // After the title toggled to "Install update (v2.0.0)".
    routeClick('Install update (v2.0.0)', h, 'Install update (v2.0.0)')
    expect(h.calls).toEqual(['update', 'update'])
  })

  it('does not fire update for a stale title once it has changed', () => {
    const h = handlers()
    // The live title is now the Install label; a click reporting the old
    // "Check for updates" title must NOT dispatch.
    routeClick(TRAY_UPDATE_DEFAULT, h, 'Install update (v2.0.0)')
    expect(h.calls).toEqual([])
  })

  it('ignores unknown titles and undefined', () => {
    const h = handlers()
    routeClick('Something else', h, TRAY_UPDATE_DEFAULT)
    routeClick(undefined, h, TRAY_UPDATE_DEFAULT)
    expect(h.calls).toEqual([])
  })

  it('does not call any handler unexpectedly', () => {
    const onOpen = vi.fn(); const onQuit = vi.fn(); const onUpdate = vi.fn()
    routeClick('nope', { onOpen, onQuit, onUpdate }, TRAY_UPDATE_DEFAULT)
    expect(onOpen).not.toHaveBeenCalled()
    expect(onQuit).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
