/**
 * Client-side view of the LLM backend — "is a model configured, where does it
 * run, and is it high-end?" — as a SUBSCRIBABLE value.
 *
 * Subscribable, NOT a memoized promise. A bare memoized probe hands a component
 * its answer forever, so saving a model (or ticking high-end) changes nothing on
 * screen — the advisors stay hidden until a remount re-reads it. One fetch still
 * backs every consumer; `resetLlmAvailability()` (called after a settings save)
 * clears it, re-probes, and notifies, so every AI surface reacts in place.
 */
import { api, ASSIST_OFF, type AssistStatus } from './api'

let statusPromise: Promise<AssistStatus> | null = null
let cached: AssistStatus = ASSIST_OFF
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Resolve (once) to the full backend status — configured, provider, model, local, highEnd. */
export function getAssistStatus(): Promise<AssistStatus> {
  if (!statusPromise) {
    statusPromise = api.llmStatus().then((s) => {
      cached = s
      emit()
      return s
    })
  }
  return statusPromise
}

/** Resolve once to whether the server has an AI backend configured at all. */
export function getLlmAvailability(): Promise<boolean> {
  return getAssistStatus().then((s) => s.configured)
}

/**
 * Re-probe and tell everyone. Called after a settings save — the whole point is
 * that a newly configured (or newly high-end) model lights up the AI surfaces
 * without a navigation.
 */
export function resetLlmAvailability(): void {
  statusPromise = null
  cached = ASSIST_OFF
  emit()
  // Re-probe straight away ONLY if something is on screen waiting for the
  // answer: those subscribers have just been told "nothing configured" and
  // would otherwise sit there wrongly. With no listeners there is nothing to
  // update, and probing eagerly would race whatever set the config — which is
  // exactly what tests do when they reset before installing their mock.
  if (listeners.size > 0) void getAssistStatus()
}

// ─── Subscription (for useSyncExternalStore) ─────────────────────────────────

export function subscribeAssistStatus(listener: () => void): () => void {
  listeners.add(listener)
  // First subscriber triggers the probe; later ones ride the same promise.
  void getAssistStatus()
  return () => { listeners.delete(listener) }
}

/** The last known status. Identity-stable between emits, as the hook requires. */
export function assistStatusSnapshot(): AssistStatus {
  return cached
}
