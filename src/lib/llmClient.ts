/**
 * Client-side helpers for the LLM backend — the memoized "is a model
 * configured, where does it run, and is it high-end?" probe, mirroring
 * translateClient. The actual requests go through the Express proxy
 * (lib/api.ts).
 *
 * ONE memoized fetch backs every accessor: the boolean the Summarize buttons
 * ask for, the fuller status the assist panels need for their privacy line, and
 * the high-end flag the advanced assists are gated on. Several probes of the
 * same endpoint would be several things to keep in sync.
 */
import { api, type AssistStatus } from './api'

let statusPromise: Promise<AssistStatus> | null = null

/** Resolve (once) to the full backend status — configured, provider, model, local, highEnd. */
export function getAssistStatus(): Promise<AssistStatus> {
  if (!statusPromise) statusPromise = api.llmStatus()
  return statusPromise
}

/** Resolve once to whether the server has an AI backend configured at all. */
export function getLlmAvailability(): Promise<boolean> {
  return getAssistStatus().then((s) => s.configured)
}

/** Reset the memoized probe (after a settings change, or for tests). */
export function resetLlmAvailability(): void {
  statusPromise = null
}
