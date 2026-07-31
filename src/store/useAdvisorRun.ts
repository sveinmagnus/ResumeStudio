/**
 * Read one advisor run and parse it — the single adapter between the run store
 * and any panel that shows results.
 *
 * This started life inside `CvAdvisors` for the five Overview advisors. The
 * other panels (D1 profile generator, D2 view intro, D3 section gaps, B4 ATS
 * audit, C4 registry hygiene) kept their results in `useState` instead, which
 * meant the same defect the run store was built to fix: navigate away — which
 * these panels actively invite, since acting on their output means going to the
 * item — and a minute of paid-for model time was gone. Extracting the hook was
 * cheaper than writing that bug five more times.
 *
 * Two properties worth keeping when editing this:
 *
 *  - **Parsing happens on render, from the raw reply.** Validators resolve ids
 *    against the LIVE CV, so a suggestion about something you have since
 *    deleted or fixed drops out on its own — there is no cache to invalidate.
 *  - **Resolution is per suggestion.** Accepting one of five leaves four.
 */

import { useEffect, useMemo } from 'react'
import { useStore } from './useStore'
import {
  selectRun, useAdvisors, type AdvisorId, type AdvisorRef, type AdvisorRun,
} from './useAdvisors'
import { extractJson } from '../lib/llmAssist'

export interface AdvisorRunView<T> {
  /** Identifies this run — hand straight to `<AssistRun advisor={…}>`. */
  ref: AdvisorRef
  resumeId: string
  run: AdvisorRun | undefined
  /** The parsed reply, or null when there is no run / it failed to parse. */
  result: T | null
  /** Why the reply couldn't be read, if it couldn't. */
  parseError: string | null
  resolve: (key: string, how: 'accepted' | 'dismissed') => void
  resolveMany: (keys: readonly string[], how: 'accepted' | 'dismissed') => void
  /** Throw the run away (the panel's Discard / Start over). */
  clear: () => void
  collapsed: boolean
  setCollapsed: (v: boolean) => void
}

/**
 * `parse` receives the model's reply VERBATIM. Use `jsonReply` for the common
 * case of a JSON payload; panels whose model answers in prose (a drafted
 * introduction) read the string directly.
 */
export function useAdvisorRun<T>(
  id: AdvisorId,
  parse: (raw: string) => T,
  scope?: string,
  /**
   * A key for anything `parse` closes over that is NOT the live CV.
   *
   * The parse re-runs on the reply and the resolution map, which covers a
   * validator reading the store (that re-renders us anyway). The ATS audit is
   * the exception: its validator checks against terms derived from a pasted
   * posting held in component state, so the parse has to re-run when that
   * changes or the report is read against the wrong term list.
   *
   * A single string rather than a dependency array, because a spread dependency
   * list defeats both the lint rule and the reader — the length has to be
   * stable across renders and an array literal can't promise that.
   */
  parseKey?: string,
): AdvisorRunView<T> {
  const resumeId = useStore((s) => s.currentResumeId) ?? ''
  const run = useAdvisors((s) => selectRun(s.runs, id, resumeId, scope))
  const markSeen = useAdvisors((s) => s.markSeen)
  const clear = useAdvisors((s) => s.clear)
  const resolve = useAdvisors((s) => s.resolve)
  const resolveMany = useAdvisors((s) => s.resolveMany)
  const setCollapsed = useAdvisors((s) => s.setCollapsed)

  const ref = useMemo<AdvisorRef>(() => ({ id, resumeId, scope }), [id, resumeId, scope])

  // Looking at the panel IS seeing the result — that's what clears the toast.
  useEffect(() => {
    if (run && run.status !== 'running' && !run.seen) markSeen(ref)
  }, [run, ref, markSeen])

  const parsed = useMemo(() => {
    if (!run?.raw) return { result: null as T | null, error: null as string | null }
    try {
      return { result: parse(run.raw), error: null }
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'The reply could not be read.' }
    }
    // `parse` closes over the live store, so re-run whenever the run changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parse reads the live store (see above)
  }, [run?.raw, run?.resolved, parseKey])

  return {
    ref,
    resumeId,
    run,
    result: parsed.result,
    parseError: parsed.error,
    resolve: (key, how) => resolve(ref, key, how),
    resolveMany: (keys, how) => resolveMany(ref, keys, how),
    clear: () => clear(ref),
    // Folded state rides with the run, so it survives the navigation that
    // acting on a suggestion requires.
    collapsed: run?.collapsed === true,
    setCollapsed: (v) => setCollapsed(ref, v),
  }
}

/**
 * Wrap a JSON validator into a raw-reply parser: pull the JSON out of whatever
 * prose the model wrapped it in, then validate against the live CV.
 */
export function jsonReply<T>(validate: (json: unknown) => T): (raw: string) => T {
  return (raw) => validate(JSON.parse(extractJson(raw)))
}
