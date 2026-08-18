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

describe('polling only runs while we think we are offline', () => {
  beforeEach(() => {
    __resetConnectivityForTests()
    vi.useFakeTimers()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    __resetConnectivityForTests()
  })

  it('does not poll at all while online — the offline event will tell us', () => {
    const health = vi.spyOn(api, 'health').mockResolvedValue(true)
    subscribeOnline(() => {})
    vi.advanceTimersByTime(120_000)
    expect(health).not.toHaveBeenCalled()
  })

  it('polls for recovery once offline, and keeps polling while it stays down', async () => {
    const health = vi.spyOn(api, 'health').mockResolvedValue(false)
    subscribeOnline(() => {})
    window.dispatchEvent(new Event('offline'))

    await vi.advanceTimersByTimeAsync(15_000)
    expect(health).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(health).toHaveBeenCalledTimes(2)
    expect(isOnline()).toBe(false)
  })

  it('stops polling once a probe finds the server again', async () => {
    const health = vi.spyOn(api, 'health').mockResolvedValue(true)
    subscribeOnline(() => {})
    window.dispatchEvent(new Event('offline'))

    await vi.advanceTimersByTimeAsync(15_000)
    expect(isOnline()).toBe(true)
    const after = health.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(health).toHaveBeenCalledTimes(after)
  })

  it('starts only ONE poll timer however many offline events arrive', async () => {
    const health = vi.spyOn(api, 'health').mockResolvedValue(false)
    subscribeOnline(() => {})
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('offline'))

    await vi.advanceTimersByTimeAsync(15_000)
    expect(health).toHaveBeenCalledTimes(1)
  })

  it('starts offline when the NIC says so, and polls from the start', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const health = vi.spyOn(api, 'health').mockResolvedValue(false)
    const seen: string[] = []
    subscribeOnline((s) => seen.push(s))
    expect(seen).toEqual(['offline'])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(health).toHaveBeenCalled()
  })

  it('an unsubscribed listener hears nothing further', () => {
    const seen: string[] = []
    const unsub = subscribeOnline((s) => seen.push(s))
    unsub()
    window.dispatchEvent(new Event('offline'))
    expect(seen).toEqual(['online'])
  })

  it('notifies every subscriber, not just the first', () => {
    const a: string[] = []
    const b: string[] = []
    subscribeOnline((s) => a.push(s))
    subscribeOnline((s) => b.push(s))
    window.dispatchEvent(new Event('offline'))
    expect(a).toEqual(['online', 'offline'])
    expect(b).toEqual(['online', 'offline'])
  })
})

describe('connectivity — starting is idempotent, and it really starts', () => {
  beforeEach(() => {
    __resetConnectivityForTests()
    vi.useFakeTimers()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    __resetConnectivityForTests()
  })

  it('registers the window listeners on the FIRST subscribe', () => {
    // The whole machine hangs off these two events; if start bails out before
    // registering them, going offline is never noticed and the app keeps trying
    // to save into a dead connection.
    const add = vi.spyOn(window, 'addEventListener')
    subscribeOnline(() => {})
    const events = add.mock.calls.map((c) => c[0])
    expect(events).toContain('offline')
    expect(events).toContain('online')
  })

  it('does not stack a second poll timer when subscribed twice', () => {
    // Each subscriber starts the machine; without the idempotence guard every
    // panel that mounts adds another 15-second health probe against the server.
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const a = subscribeOnline(() => {})
    const b = subscribeOnline(() => {})
    expect(setIntervalSpy.mock.calls.length).toBeLessThanOrEqual(1)
    a(); b()
  })
})
