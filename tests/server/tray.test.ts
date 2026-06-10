import { describe, it, expect, vi } from 'vitest'
import {
  routeClick, TRAY_OPEN, TRAY_QUIT, TRAY_CHECK_DEFAULT, TRAY_INSTALL_DEFAULT,
  type TrayHandlers,
} from '../../server/desktop/tray'

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
    routeClick('Cartavio Resume Studio v0.2.1', h, titles) // disabled header
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
