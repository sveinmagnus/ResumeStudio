/**
 * Connectivity tracking — a single source of truth for "is the server
 * reachable right now?", with a subscribe API the persistence hook uses to
 * drain its queue on reconnect.
 *
 * Why not just `navigator.onLine`? It only reflects the NIC state, not whether
 * our server actually answers — a captive portal, a sleeping laptop, or a dead
 * backend all read as "online". So:
 *   - We trust `offline` events immediately (NIC down ⇒ definitely offline).
 *   - We treat `online` events and "is it really back?" as a *prompt to probe*,
 *     not a conclusion: poll `api.health()` and only flip to online when it
 *     answers.
 *   - While we believe we're offline, we keep polling on an interval so real
 *     recovery is caught even without an `online` event.
 *
 * The transition logic is exposed as a pure reducer (`nextOnline`) so it can be
 * unit-tested without timers or a DOM.
 */

import { api } from './api'

export type Connectivity = 'online' | 'offline'

/**
 * Pure transition: given what we currently believe and a fresh health-probe
 * result, what should we believe now? Kept separate from the timer/DOM wiring
 * so the rule is testable in isolation.
 */
export function nextOnline(current: Connectivity, healthOk: boolean): Connectivity {
  return healthOk ? 'online' : 'offline'
}

type Listener = (state: Connectivity) => void

const HEALTH_POLL_MS = 15_000

const listeners = new Set<Listener>()
let state: Connectivity = 'online'
let pollTimer: ReturnType<typeof setInterval> | null = null
let started = false

function setState(next: Connectivity): void {
  if (next === state) return
  state = next
  for (const l of listeners) l(state)
  // Poll only while we think we're offline — that's when we need to detect
  // recovery. Once online, the `offline` event will tell us if we drop.
  if (state === 'offline') startPolling()
  else stopPolling()
}

async function probe(): Promise<void> {
  const ok = await api.health() // never throws — returns false on any failure
  setState(nextOnline(state, ok))
}

function startPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => { void probe() }, HEALTH_POLL_MS)
}

function stopPolling(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

function onOffline(): void { setState('offline') }
function onOnline(): void { void probe() } // NIC up ≠ server up — verify first

/** Begin tracking. Idempotent; safe to call from a module-load side effect. */
export function startConnectivity(): void {
  if (started || typeof window === 'undefined') return
  started = true
  state = navigator.onLine ? 'online' : 'offline'
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)
  if (state === 'offline') startPolling()
}

export function isOnline(): boolean {
  return state === 'online'
}

/**
 * Subscribe to connectivity changes. Returns an unsubscribe fn. Calls the
 * listener immediately with the current state so subscribers don't miss a
 * transition that already happened.
 */
export function subscribeOnline(listener: Listener): () => void {
  startConnectivity()
  listeners.add(listener)
  listener(state)
  return () => { listeners.delete(listener) }
}

/** Force an immediate health probe (e.g. right after a save fails network-side). */
export function recheckConnectivity(): void {
  void probe()
}

/** Test-only: reset module state between specs. */
export function __resetConnectivityForTests(): void {
  stopPolling()
  listeners.clear()
  state = 'online'
  started = false
}
