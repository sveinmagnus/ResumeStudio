import { describe, it, expect } from 'vitest'
import { openSettings, onOpenSettings, type SettingsTabId } from '../src/lib/settingsBus'

describe('settingsBus', () => {
  it('delivers the requested tab to every subscriber', () => {
    const a: Array<SettingsTabId | undefined> = []
    const b: Array<SettingsTabId | undefined> = []
    const offA = onOpenSettings((t) => a.push(t))
    const offB = onOpenSettings((t) => b.push(t))

    openSettings('ai')
    expect(a).toEqual(['ai'])
    expect(b).toEqual(['ai'])

    offA()
    offB()
  })

  it('passes undefined when no tab is asked for', () => {
    // "Open Settings" and "open Settings on the AI tab" are different requests;
    // defaulting one to the other sends the user to the wrong screen.
    const seen: Array<SettingsTabId | undefined> = []
    const off = onOpenSettings((t) => seen.push(t))
    openSettings()
    expect(seen).toEqual([undefined])
    off()
  })

  it('stops delivering after unsubscribe', () => {
    // The header subscribes on mount; a leaked listener opens a dialog that
    // belongs to an unmounted component.
    const seen: unknown[] = []
    const off = onOpenSettings((t) => seen.push(t))
    off()
    openSettings('sync')
    expect(seen).toEqual([])
  })

  it('unsubscribing one listener leaves the others subscribed', () => {
    const kept: unknown[] = []
    const offDropped = onOpenSettings(() => { throw new Error('should not fire') })
    const offKept = onOpenSettings((t) => kept.push(t))
    offDropped()

    expect(() => openSettings('version')).not.toThrow()
    expect(kept).toEqual(['version'])
    offKept()
  })

  it('is a no-op when nobody is listening', () => {
    expect(() => openSettings('appearance')).not.toThrow()
  })
})
