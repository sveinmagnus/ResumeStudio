/**
 * Resume persistence orchestration — boot load + auto-save for one resume.
 *
 * The hook is parameterised by `resumeId` (read from the URL by the caller).
 * Mounting a new id loads it; navigating away unmounts and ejects the store.
 *
 * Owns the timing-sensitive effects and refs:
 *   1. Boot load — prefer the server, fall back to the per-id local cache.
 *   2. Local-cache write — 250 ms debounce after a mutation.
 *   3. Server save — 1 s debounce, AbortController so a newer mutation
 *      supersedes an in-flight save. Sends data + current locales together
 *      (per plan decision 10).
 *
 * See CLAUDE.md §8 for the full boot/save sequence this implements.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from './useStore'
import {
  api,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  ServerError,
  isAbortError,
} from '../lib/api'
import type { ResumeStore } from '../types'
import { type SaveState } from '../components/layout/SaveStatus'
import { loadPending, savePending, clearPending, listDirty, clearAllCaches } from '../lib/localCache'
import { subscribeOnline, recheckConnectivity, isOnline, type Connectivity } from '../lib/connectivity'
import { decideBoot, selectDrainTargets, type BootAction } from '../lib/syncEngine'
import { navigate } from '../lib/router'

export type AppLoad = 'loading' | 'auth' | 'ready' | 'not-found'

/**
 * Flush one resume's queued edits **without** loading it into the editor — used
 * to drain *non-active* dirty resumes (on reconnect, or on an online boot). A
 * 409 is left dirty on purpose: the conflict surfaces with the diff modal when
 * the user next opens that resume. Other failures keep it queued for the next
 * attempt. Never throws.
 */
export async function backgroundFlush(id: string): Promise<void> {
  const pending = loadPending(id)
  if (!pending?.dirty) return
  try {
    await api.saveResume(
      id,
      pending.data,
      { primary_locale: pending.locales.primary, secondary_locale: pending.locales.secondary },
      pending.base_version,
    )
    clearPending(id)
  } catch (err) {
    if (err instanceof ConflictError) return // resolve on next open
    // network/server error → leave queued for the next drain
  }
}

/** The other side of a conflict — the live server state, for diff + resolve. */
export interface ConflictState {
  data: ResumeStore
  meta: { version: number; primary_locale: string; secondary_locale: string | null }
}

export interface ResumePersistence {
  loadState: AppLoad
  saveState: SaveState
  cacheSavedAt: string | null
  /** Number of resumes with unsynced (dirty) edits — for the unsynced badge. */
  unsyncedCount: number
  /**
   * Non-null when the last save was refused because the server copy changed
   * elsewhere. Holds the server's current state so the editor can show a
   * keep/discard + diff resolution (Phase 4). Until resolved, auto-save is
   * paused and the local edits are kept (not discarded).
   */
  conflict: ConflictState | null
  /**
   * Resolve an active conflict. `keep` force-overwrites the server with the
   * local edits (re-PUT at the server's current version); `discard` drops the
   * local edits and takes the server copy. Both clear the conflict and resume
   * auto-save.
   */
  resolveConflict: (choice: 'keep' | 'discard') => void
  /** Re-run the pending server save (Retry button in SaveStatus). */
  retry: () => void
  /**
   * Store a token and try to load with it. Resolves on success (and flips
   * loadState to 'ready'); rejects with the underlying error so the caller
   * can map it to a user-facing message. Clears the bad token on 401.
   */
  submitToken: (token: string) => Promise<void>
}

export function useResumePersistence(resumeId: string): ResumePersistence {
  // Actions are stable references (created once in the store), so selecting
  // them here doesn't subscribe this hook to re-renders.
  const loadStore = useStore((s) => s.loadStore)
  const unloadStore = useStore((s) => s.unloadStore)
  const setCurrentResumeId = useStore((s) => s.setCurrentResumeId)
  const hasData = useStore((s) => s.hasData)
  const mutationCount = useStore((s) => s.mutationCount)

  const [loadState, setLoadState] = useState<AppLoad>('loading')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [unsyncedCount, setUnsyncedCount] = useState(0)

  // "have we changed anything since the last successful save?" — both `data`
  // and `mutationCount` change together on a mutation, so the save effect
  // depends on `mutationCount` only and reads `data` via getState().
  const lastSavedMutation = useRef(0)
  const saveAbort = useRef<AbortController | null>(null)
  // The server version this client last saw — sent as the optimistic-
  // concurrency base on each save, advanced on every successful save.
  const baseVersion = useRef<number | undefined>(undefined)
  // While a conflict is unresolved we pause auto-save (read inside the effect
  // via the ref so each mutation re-check sees the current value).
  const conflictPaused = useRef(false)

  const flushToServer = useCallback(async () => {
    const st = useStore.getState()
    const snapshot = st.data
    const counterAtSend = st.mutationCount
    const locales = {
      primary_locale: st.primaryLocale,
      secondary_locale: st.secondaryLocale,
    }
    saveAbort.current?.abort()
    saveAbort.current = new AbortController()
    setSaveState('saving')
    try {
      const res = await api.saveResume(
        resumeId, snapshot, locales, baseVersion.current, saveAbort.current.signal,
      )
      baseVersion.current = res.version
      lastSavedMutation.current = counterAtSend
      setSaveState('saved')
      // Synced — drop the queued pending record so it's no longer "dirty".
      clearPending(resumeId)
      setCacheSavedAt(null)
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000)
    } catch (err) {
      if (isAbortError(err)) return
      if (err instanceof UnauthorizedError) { setLoadState('auth'); return }
      if (err instanceof NotFoundError) {
        // Resume was deleted server-side under us — send the user home.
        navigate('/', { replace: true })
        return
      }
      if (err instanceof ConflictError) {
        // The server copy moved on (another tab/device). Keep the local edits
        // (don't clear the cache) and pause auto-save until the user resolves.
        // Phase 4 renders a keep/discard + diff modal off `conflict`.
        conflictPaused.current = true
        setConflict({
          data: err.current.data,
          meta: {
            version: err.current.meta.version,
            primary_locale: err.current.meta.primary_locale,
            secondary_locale: err.current.meta.secondary_locale,
          },
        })
        setSaveState('conflict')
        return
      }
      // ServerError = the server answered but failed (5xx) → a real error the
      // user can retry. Anything else (a fetch TypeError) is almost certainly
      // a network drop: the edit is safe in the dirty pending record, so show
      // "offline" and let the connectivity probe drive the reconnect drain.
      if (err instanceof ServerError) {
        console.error('Auto-save failed:', err)
        setSaveState('error')
      } else {
        // Distinguish a confirmed outage ('offline') from a transient blip
        // while we still believe we're online ('queued'). Either way the edit
        // is safe in the dirty pending record; recheck to drive the drain.
        console.warn('Save failed; edit is queued locally:', err)
        setSaveState(isOnline() ? 'queued' : 'offline')
        recheckConnectivity()
      }
    }
  }, [resumeId])

  // ── Initial load: prefer server, fall back to per-id local cache ──────────
  useEffect(() => {
    setLoadState('loading')
    setCurrentResumeId(resumeId)
    lastSavedMutation.current = 0
    baseVersion.current = undefined
    conflictPaused.current = false
    setConflict(null)

    // Apply a boot decision (the *what* comes from the pure `decideBoot`; this
    // does the I/O). `res` is present for a server hit; `pending` for the
    // local-record branches.
    const applyBoot = (
      action: BootAction,
      res: { data: ResumeStore; meta: { version: number; primary_locale: string; secondary_locale: string | null } } | null,
      pending: ReturnType<typeof loadPending>,
    ) => {
      switch (action.kind) {
        case 'not-found':
          // Unknown id, or unreachable with nothing cached — back to the picker.
          setLoadState('not-found')
          return
        case 'load-server':
          loadStore(res!.data, { primary: res!.meta.primary_locale, secondary: res!.meta.secondary_locale })
          baseVersion.current = res!.meta.version
          clearPending(resumeId) // drop any clean local snapshot
          setCacheSavedAt(null)
          setLoadState('ready')
          return
        case 'flush-local':
          // Unsynced offline edits win over the server copy: load them and push
          // with their base version (clean → syncs; stale → non-blocking conflict).
          loadStore(pending!.data, pending!.locales)
          baseVersion.current = pending!.base_version
          setCacheSavedAt(pending!.saved_at)
          setLoadState('ready')
          void flushToServer()
          return
        case 'offline-local':
          loadStore(pending!.data, pending!.locales)
          baseVersion.current = pending!.base_version
          setCacheSavedAt(pending!.saved_at)
          setSaveState('offline')
          setLoadState('ready')
          recheckConnectivity()
          return
      }
    }

    api.loadResume(resumeId)
      .then((res) => {
        const pending = res ? loadPending(resumeId) : null
        applyBoot(decideBoot({ server: res ? 'hit' : 'not-found', pending }), res, pending)
        if (res) {
          // Server reachable on boot — drain any OTHER resumes' queued edits
          // (e.g. left from a previous offline session). The active resume is
          // handled by applyBoot above.
          for (const { id } of listDirty()) if (id !== resumeId) void backgroundFlush(id)
        }
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) { setLoadState('auth'); return }
        console.warn('Could not reach server:', err)
        const pending = loadPending(resumeId)
        applyBoot(decideBoot({ server: 'unreachable', pending }), null, pending)
      })

    return () => {
      // Cancel any in-flight save and eject the resume so a quick switch
      // doesn't briefly show the old data under the new id.
      saveAbort.current?.abort()
      unloadStore()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId])

  // ── Queue write: short debounce so we don't stringify per keystroke. Marks
  //    the record dirty (unsynced) with the base version it was derived from,
  //    so a crash/outage leaves a durable, drainable copy.
  useEffect(() => {
    if (!hasData || mutationCount === 0) return
    const t = setTimeout(() => {
      const st = useStore.getState()
      savePending(resumeId, {
        data: st.data,
        locales: { primary: st.primaryLocale, secondary: st.secondaryLocale },
        base_version: baseVersion.current ?? 0,
        dirty: true,
      })
      setCacheSavedAt(new Date().toISOString())
    }, 250)
    return () => clearTimeout(t)
  }, [mutationCount, hasData, resumeId])

  // ── Server save: 1s debounce after the latest user mutation ───────────────
  useEffect(() => {
    if (!hasData) return
    // Paused while a conflict is unresolved — local edits keep flowing into the
    // cache (above), but we don't re-PUT (it would just 409 again) until the
    // user resolves. `conflictPaused` is a ref so this re-check sees its
    // current value on every mutation without re-creating the effect.
    if (conflictPaused.current) return
    if (mutationCount === lastSavedMutation.current) return
    const t = setTimeout(() => { void flushToServer() }, 1000)
    return () => clearTimeout(t)
  }, [mutationCount, hasData, flushToServer])

  // ── Reconnect drain: when connectivity returns, push the active resume's
  //    queued edits. Only fires on a real offline→online transition (not the
  //    initial subscribe — boot handles the first flush), and not while a
  //    conflict is unresolved.
  useEffect(() => {
    let prev: Connectivity = 'online'
    const unsub = subscribeOnline((conn) => {
      const recovered = prev === 'offline' && conn === 'online'
      prev = conn
      if (!recovered) return
      const { active, background } = selectDrainTargets(
        listDirty().map((d) => d.id), resumeId,
      )
      // Active resume resolves through the editor (can raise a conflict modal),
      // unless a conflict is already pending. Others push in the background.
      if (active && !conflictPaused.current) void flushToServer()
      for (const id of background) void backgroundFlush(id)
    })
    return unsub
  }, [resumeId, flushToServer])

  // ── Keep the unsynced-resume count fresh. The queue changes on every local
  //    write (cacheSavedAt) and on every sync (saveState), so recompute then.
  useEffect(() => { setUnsyncedCount(listDirty().length) }, [saveState, cacheSavedAt])

  // ── Unsaved-work guard: warn before a tab close while edits are unsynced.
  //    Reads listDirty() at event time so it reflects the live queue.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (listDirty().length > 0) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // ── Security residual §4 close: on an auth gate (token expired/rotated
  //    mid-session), wipe the plaintext local caches IF nothing is unsynced.
  //    With unsynced edits we keep them (data safety wins over the residual);
  //    the durable queue means they're recoverable once the user re-auths.
  useEffect(() => {
    if (loadState === 'auth' && listDirty().length === 0) clearAllCaches()
  }, [loadState])

  const resolveConflict = useCallback((choice: 'keep' | 'discard') => {
    if (!conflict) return
    conflictPaused.current = false
    if (choice === 'discard') {
      // Take the server copy; drop the local edits and the queued record.
      loadStore(conflict.data, {
        primary: conflict.meta.primary_locale,
        secondary: conflict.meta.secondary_locale,
      })
      baseVersion.current = conflict.meta.version
      lastSavedMutation.current = 0 // loadStore reset mutationCount → no spurious save
      clearPending(resumeId)
      setConflict(null)
      setSaveState('idle')
    } else {
      // Keep mine: re-PUT the local edits at the server's now-current version
      // (a clean overwrite). The store still holds the local data untouched.
      baseVersion.current = conflict.meta.version
      setConflict(null)
      void flushToServer()
    }
  }, [conflict, loadStore, resumeId, flushToServer])

  const submitToken = useCallback(async (token: string) => {
    // Exchange the token for the HttpOnly session cookie first; a wrong token
    // throws UnauthorizedError here (no cookie set), which the AuthGate surfaces.
    await api.login(token)
    const res = await api.loadResume(resumeId)
    if (res) {
      loadStore(res.data, {
        primary: res.meta.primary_locale,
        secondary: res.meta.secondary_locale,
      })
      baseVersion.current = res.meta.version
      setLoadState('ready')
    } else {
      setLoadState('not-found')
    }
  }, [loadStore, resumeId])

  return { loadState, saveState, cacheSavedAt, unsyncedCount, conflict, resolveConflict, retry: flushToServer, submitToken }
}
