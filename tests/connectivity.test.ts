/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  nextOnline, subscribeOnline, isOnline,
  __resetConnectivityForTests,
} from '../src/lib/connectivity'
import { api } from '../src/lib/api'

describe('nextOnline (pure transition)', () => {
  it('follows the health probe result regardless of prior state', () => {
    expect(nextOnline('online', false)).toBe('offline')
    expect(nextOnline('offline', true)).toBe('online')
    expect(nextOnline('online', true)).toBe('online')
    expect(nextOnline('offline', false)).toBe('offline')
  })
})

describe('connectivity machine', () => {
  beforeEach(() => {
    __resetConnectivityForTests()
    vi.useFakeTimers()
    // Start "online" per the NIC.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    __resetConnectivityForTests()
  })

  it('emits the current state immediately on subscribe', () => {
    const seen: string[] = []
    const unsub = subscribeOnline((s) => seen.push(s))
    expect(seen).toEqual(['online'])
    unsub()
  })

  it('an offline event flips to offline without waiting for a probe', () => {
    const seen: string[] = []
    subscribeOnline((s) => seen.push(s))
    window.dispatchEvent(new Event('offline'))
    expect(seen).toEqual(['online', 'offline'])
    expect(isOnline()).toBe(false)
  })

  it('an online event only flips back after a successful health probe', async () => {
    const health = vi.spyOn(api, 'health').mockResolvedValue(true)
    const seen: string[] = []
    subscribeOnline((s) => seen.push(s))

    window.dispatchEvent(new Event('offline'))
    expect(isOnline()).toBe(false)

    window.dispatchEvent(new Event('online')) // triggers a probe, not an immediate flip
    await vi.waitFor(() => expect(isOnline()).toBe(true))
    expect(health).toHaveBeenCalled()
    expect(seen).toEqual(['online', 'offline', 'online'])
  })

  it('while offline it keeps polling health to catch recovery without an event', async () => {
    const health = vi.spyOn(api, 'health').mockResolvedValue(false)
    subscribeOnline(() => {})
    window.dispatchEvent(new Event('offline'))
    expect(isOnline()).toBe(false)

    // Server comes back; the next poll tick should detect it.
    health.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(isOnline()).toBe(true)
  })
})
