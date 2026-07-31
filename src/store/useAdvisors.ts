/**
 * Advisor runs that outlive the page you started them on.
 *
 * The problem this fixes is expensive in the most literal sense. An advisor run
 * costs real tokens and can take a minute on a frontier model; it lived in the
 * panel's `useState`, so navigating away from Overview — which the results
 * themselves invite you to do, since every finding has an "Open" button —
 * unmounted the component and threw the reply away. Worse, applying ONE of five
 * suggestions and coming back lost the other four. You paid for those.
 *
 * So runs live here instead:
 *
 *  - **A separate store from `useStore`.** Advisor state is not resume data: it
 *    must not be auto-saved to the server, synced between machines, written into
 *    snapshots, or land on the undo stack. Putting it in the resume store would
 *    do all four.
 *  - **The RAW reply is what's kept**, not the parsed result. Validation
 *    resolves ids against the live CV, so re-validating on each render means a
 *    finding pointing at an item you deleted in the meantime disappears by
 *    itself, with no invalidation logic.
 *  - **Resolution is per suggestion.** Accepting or dismissing one marks that
 *    key and leaves the rest, which is the whole complaint.
 *  - **Runs are keyed by resume**, because findings about one CV are nonsense
 *    against another.
 *
 * Persisted to localStorage so a reload doesn't bin work you paid for either.
 * Best-effort: a quota failure or a corrupt blob costs the cache, never the app.
 */

import { create } from 'zustand'
import { api } from '../lib/api'

export type AdvisorId =
  | 'review' | 'voice' | 'drift' | 'achievements' | 'jobfit'
  | 'profile' | 'intro' | 'section' | 'ats' | 'hygiene'

/** Where the results are read, so a notification can take you back to them. */
export const ADVISOR_HOME: Record<AdvisorId, string> = {
  review: 'overview',
  voice: 'overview',
  drift: 'overview',
  achievements: 'overview',
  jobfit: 'overview',
  profile: 'key_qualifications',
  intro: 'views',
  ats: 'views',
  hygiene: 'skills',
  // D3 runs against whichever section you were standing in; the scope carries
  // which one, and `advisorSection` resolves it.
  section: 'overview',
}

export const ADVISOR_LABEL: Record<AdvisorId, string> = {
  review: 'CV review',
  voice: 'Writing consistency',
  drift: 'Cross-language check',
  achievements: 'Achievement mining',
  jobfit: 'Job fit report',
  profile: 'Profile generator',
  intro: 'View introduction',
  section: 'Section gaps',
  ats: 'ATS keyword audit',
  hygiene: 'Registry hygiene',
}

/**
 * Which editor section a finished run wants you on.
 *
 * Scoped advisors know better than their static home: a "Section gaps" run
 * belongs to the section it examined, and a view-scoped run belongs to that
 * view's editor. Falls back to the static map.
 */
export function advisorSection(run: Pick<AdvisorRun, 'id' | 'scope'>): string {
  if (run.id === 'section' && run.scope) return run.scope
  return ADVISOR_HOME[run.id] ?? 'overview'
}

export type RunStatus = 'running' | 'done' | 'error'

export interface AdvisorRun {
  id: AdvisorId
  resumeId: string
  /**
   * What this run is ABOUT, when one advisor can be run against several things:
   * the view id for an intro draft or an ATS audit, the section key for a "what's
   * missing" pass. Without it, drafting an intro for the Board CV would overwrite
   * the draft you were still reading for the Partner CV.
   *
   * Undefined for whole-CV advisors, which can only have one run at a time.
   */
  scope?: string
  status: RunStatus
  startedAt: number
  finishedAt?: number
  /** The model's reply, verbatim. Re-validated against the live CV on render. */
  raw?: string
  /**
   * The user's own input for this run — the pasted job posting, the brief.
   * Kept because some results are only readable ALONGSIDE it: the ATS audit maps
   * the model's answers onto terms derived from the posting, so a restored run
   * with an empty textarea is a report about nothing. Not the prompt (that's
   * rebuilt from the live CV), just the part the user typed.
   */
  input?: string
  error?: string
  /**
   * Suggestions the user has finished with, by the key the validator assigns.
   * 'accepted' and 'dismissed' are tracked separately so the panel can say what
   * happened rather than just hiding the row.
   */
  resolved: Record<string, 'accepted' | 'dismissed'>
  /** False until the user has looked at the finished result — drives the toast. */
  seen: boolean
  /**
   * The results list is folded away. Persisted with the run because the results
   * themselves are: folding a twelve-item review, navigating off to fix
   * something and coming back to find it open again would undo the point.
   */
  collapsed?: boolean
}

/**
 * Which run we mean. `scope` narrows an advisor that can target several things
 * (a view, a section) — see `AdvisorRun.scope`.
 */
export interface AdvisorRef {
  id: AdvisorId
  resumeId: string
  scope?: string
}

interface AdvisorState {
  runs: Record<string, AdvisorRun>
  start: (ref: AdvisorRef, exec: () => Promise<string>, input?: string) => Promise<void>
  resolve: (ref: AdvisorRef, key: string, how: 'accepted' | 'dismissed') => void
  resolveMany: (ref: AdvisorRef, keys: readonly string[], how: 'accepted' | 'dismissed') => void
  markSeen: (ref: AdvisorRef) => void
  setCollapsed: (ref: AdvisorRef, collapsed: boolean) => void
  clear: (ref: AdvisorRef) => void
  clearResume: (resumeId: string) => void
}

const runKey = ({ id, resumeId, scope }: AdvisorRef) =>
  scope ? `${resumeId}::${id}::${scope}` : `${resumeId}::${id}`

// ─── Persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'rs-advisor-runs-v1'
/** A run older than this is stale advice about a CV that has moved on. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function load(): Record<string, AdvisorRun> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, AdvisorRun>
    const now = Date.now()
    const out: Record<string, AdvisorRun> = {}
    for (const [k, run] of Object.entries(parsed)) {
      if (!run || typeof run !== 'object') continue
      if (now - (run.startedAt ?? 0) > MAX_AGE_MS) continue
      // A run that was in flight when the tab closed can never complete — there
      // is no request to reattach to. Surfacing it as an error is honest;
      // leaving it "running" would spin forever.
      out[k] = run.status === 'running'
        ? { ...run, status: 'error', error: 'Interrupted — the app closed before this finished.' }
        : run
    }
    return out
  } catch {
    return {}
  }
}

function save(runs: Record<string, AdvisorRun>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs))
  } catch {
    /* quota or private mode — the cache is a convenience, never load-bearing */
  }
}

// ─── The store ───────────────────────────────────────────────────────────────

export const useAdvisors = create<AdvisorState>((set, get) => ({
  runs: load(),

  /**
   * Start a run and see it through, regardless of what the user does next.
   *
   * `exec` is the whole request (the caller owns prompt building and the
   * privacy confirm), and the promise is deliberately NOT tied to a component:
   * the `.then` writes into this store, which the panel reads whenever it next
   * mounts. Navigating away mid-run is now free.
   */
  async start(ref, exec, input) {
    const key = runKey(ref)
    const started: AdvisorRun = {
      id: ref.id, resumeId: ref.resumeId, scope: ref.scope, input,
      status: 'running', startedAt: Date.now(), resolved: {}, seen: true,
    }
    set((s) => {
      const runs = { ...s.runs, [key]: started }
      save(runs)
      return { runs }
    })

    const finish = (patch: Partial<AdvisorRun>) => {
      set((s) => {
        const current = s.runs[key]
        // A newer run for the same advisor supersedes this one — don't let a
        // slow first reply overwrite a fast second.
        if (!current || current.startedAt !== started.startedAt) return s
        const runs = {
          ...s.runs,
          [key]: { ...current, ...patch, finishedAt: Date.now(), seen: false },
        }
        save(runs)
        return { runs }
      })
    }

    try {
      finish({ status: 'done', raw: await exec() })
    } catch (e) {
      finish({ status: 'error', error: (e as Error).message || 'The run failed.' })
    }
  },

  resolve(ref, key, how) {
    get().resolveMany(ref, [key], how)
  },

  resolveMany(ref, keys, how) {
    if (!keys.length) return
    set((s) => {
      const k = runKey(ref)
      const run = s.runs[k]
      if (!run) return s
      const resolved = { ...run.resolved }
      for (const key of keys) resolved[key] = how
      const runs = { ...s.runs, [k]: { ...run, resolved } }
      save(runs)
      return { runs }
    })
  },

  markSeen(ref) {
    set((s) => {
      const k = runKey(ref)
      const run = s.runs[k]
      if (!run || run.seen) return s
      const runs = { ...s.runs, [k]: { ...run, seen: true } }
      save(runs)
      return { runs }
    })
  },

  setCollapsed(ref, collapsed) {
    set((s) => {
      const k = runKey(ref)
      const run = s.runs[k]
      if (!run || !!run.collapsed === collapsed) return s
      const runs = { ...s.runs, [k]: { ...run, collapsed } }
      save(runs)
      return { runs }
    })
  },

  clear(ref) {
    set((s) => {
      const runs = { ...s.runs }
      delete runs[runKey(ref)]
      save(runs)
      return { runs }
    })
  },

  clearResume(resumeId) {
    set((s) => {
      const runs = Object.fromEntries(
        Object.entries(s.runs).filter(([, r]) => r.resumeId !== resumeId),
      )
      save(runs)
      return { runs }
    })
  },
}))

// ─── Selectors ───────────────────────────────────────────────────────────────

/** The run for one advisor on one resume (and scope), or undefined. */
export function selectRun(
  runs: Record<string, AdvisorRun>,
  id: AdvisorId,
  resumeId: string,
  scope?: string,
): AdvisorRun | undefined {
  return runs[runKey({ id, resumeId, scope })]
}

/** Finished runs the user hasn't looked at yet — what the toast announces. */
export function unseenRuns(runs: Record<string, AdvisorRun>, resumeId: string): AdvisorRun[] {
  return Object.values(runs)
    .filter((r) => r.resumeId === resumeId && r.status !== 'running' && !r.seen)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
}

/** True when anything is in flight for this resume (drives the header spinner). */
export function hasRunning(runs: Record<string, AdvisorRun>, resumeId: string): boolean {
  return Object.values(runs).some((r) => r.resumeId === resumeId && r.status === 'running')
}

/**
 * Drop the suggestions the user already dealt with. Shared by every panel so
 * "accepted or dismissed" means the same thing everywhere.
 */
export function unresolved<T extends { key: string }>(
  items: readonly T[],
  run: AdvisorRun | undefined,
): T[] {
  if (!run) return [...items]
  return items.filter((i) => !run.resolved[i.key])
}

/** Convenience for a panel: start a run through the store. */
export function startAdvisor(
  ref: AdvisorRef,
  prompt: string,
  opts: { maxTokens?: number; advanced?: boolean; input?: string } = {},
): Promise<void> {
  return useAdvisors.getState().start(
    ref,
    () => api.llmComplete(prompt, opts.maxTokens, opts.advanced),
    opts.input,
  )
}
