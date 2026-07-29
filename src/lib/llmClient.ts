/**
 * Client-side view of the LLM backend — "is a model configured, where does it
 * run, and is it high-end?" — as a SUBSCRIBABLE value.
 *
 * It was a memoized promise, which meant a component that had already probed
 * kept its answer forever. Saving a model (or ticking high-end) therefore
 * changed nothing on screen: the advisors stayed hidden until you navigated
 * away and back, because only a remount re-read the probe. With the config
 * surface as large as it now is, that's a trap.
 *
 * So the status is cached state with listeners. One fetch still backs every
 * consumer — `resetLlmAvailability()` (called after a settings save) clears it,
 * re-probes, and notifies everyone, so every AI surface in the app reacts in
 * place.
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
