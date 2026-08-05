/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  nextOnline, subscribeOnline, isOnline, recheckConnectivity,
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

  it('recheckConnectivity() probes on demand and can recover without an online event', async () => {
    // The reason it exists: a save that fails network-side knows we are offline
    // before the browser fires anything, and the user should not have to wait
    // for the next poll tick to be told the connection is back.
    const health = vi.spyOn(api, 'health').mockResolvedValue(true)
    const seen: string[] = []
    subscribeOnline((s) => seen.push(s))

    window.dispatchEvent(new Event('offline'))
    expect(isOnline()).toBe(false)
    health.mockClear()

    recheckConnectivity()
    await vi.waitFor(() => expect(isOnline()).toBe(true))
    expect(health).toHaveBeenCalled()
    expect(seen).toEqual(['online', 'offline', 'online'])
  })

  it('recheckConnectivity() leaves the state alone while the probe still fails', async () => {
    vi.spyOn(api, 'health').mockResolvedValue(false)
    const seen: string[] = []
    subscribeOnline((s) => seen.push(s))
    window.dispatchEvent(new Event('offline'))

    recheckConnectivity()
    await vi.waitFor(() => expect(api.health).toHaveBeenCalled())
    expect(isOnline()).toBe(false)
    expect(seen).toEqual(['online', 'offline'])
  })

  it('does not re-announce a state it is already in', () => {
    // Two offline events (a flaky NIC) are one transition. Re-emitting would
    // make every subscriber redo its offline handling.
    const seen: string[] = []
    subscribeOnline((s) => seen.push(s))
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('offline'))
    expect(seen).toEqual(['online', 'offline'])
  })

  it('stops polling once it is back online', async () => {
    const health = vi.spyOn(api, 'health').mockResolvedValue(true)
    subscribeOnline(() => {})
    window.dispatchEvent(new Event('offline'))

    await vi.advanceTimersByTimeAsync(15_000)
    expect(isOnline()).toBe(true)

    // Recovered: the poll must be torn down, not left running for the session.
    health.mockClear()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(health).not.toHaveBeenCalled()
  })

  it('starts from the NIC state, and only once', () => {
    // A second subscriber must not re-read navigator.onLine and stomp the
    // state the machine has since established.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    __resetConnectivityForTests()
    vi.spyOn(api, 'health').mockResolvedValue(false)

    subscribeOnline(() => {})
    expect(isOnline()).toBe(false)

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const seen: string[] = []
    subscribeOnline((s) => seen.push(s))
    expect(seen).toEqual(['offline'])
  })

  it('polls from the start when the app loads with no connection', async () => {
    // Booting offline gets no 'online' event if the server was already
    // reachable by the time we started, so the poll has to be running already.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    __resetConnectivityForTests()
    const health = vi.spyOn(api, 'health').mockResolvedValue(true)

    subscribeOnline(() => {})
    expect(isOnline()).toBe(false)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(health).toHaveBeenCalled()
    expect(isOnline()).toBe(true)
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
