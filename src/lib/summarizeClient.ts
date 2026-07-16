/**
 * Client-side helpers for the LLM backend — the memoized "is a model
 * configured, and where does it run?" probe, mirroring translateClient. The
 * actual requests go through the Express proxy (lib/api.ts).
 *
 * ONE memoized fetch backs both accessors: the boolean the Summarize buttons
 * ask for, and the fuller status the assist panels need for their privacy line.
 * Two probes of the same endpoint would be two things to keep in sync.
 */
import { api, type AssistStatus } from './api'

let statusPromise: Promise<AssistStatus> | null = null

/** Resolve (once) to the full backend status — configured, provider, model, local. */
export function getAssistStatus(): Promise<AssistStatus> {
  if (!statusPromise) statusPromise = api.summarizeStatus()
  return statusPromise
}

/** Resolve once to whether the server has a summarize backend configured. */
export function getSummarizeAvailability(): Promise<boolean> {
  return getAssistStatus().then((s) => s.configured)
}

/** Reset the memoized probe (after a settings change, or for tests). */
export function resetSummarizeAvailability(): void {
  statusPromise = null
}
