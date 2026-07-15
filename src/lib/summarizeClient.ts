/**
 * Client-side helpers for the "Summarize" feature — the memoized "is an LLM
 * backend configured?" probe, mirroring translateClient. The actual request
 * goes through the Express proxy (lib/api.ts → api.summarize).
 */
import { api } from './api'

let availabilityPromise: Promise<boolean> | null = null

/** Resolve once to whether the server has a summarize backend configured. */
export function getSummarizeAvailability(): Promise<boolean> {
  if (!availabilityPromise) {
    availabilityPromise = api.summarizeStatus()
  }
  return availabilityPromise
}

/** Reset the memoized probe (after a settings change, or for tests). */
export function resetSummarizeAvailability(): void {
  availabilityPromise = null
}
