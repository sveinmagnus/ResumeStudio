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
import type { ResumeStore, RegistryEntry } from '../types'
import { type SaveState } from './saveState'
import { loadPending, savePending, clearPending, listDirty, clearAllCaches } from '../lib/localCache'
import { subscribeOnline, recheckConnectivity, isOnline, type Connectivity } from '../lib/connectivity'
import { decideBoot, selectDrainTargets, type BootAction } from '../lib/syncEngine'
import { mergeStores, type MergeConflict } from '../lib/threeWayMerge'
import { navigate } from '../lib/router'

export type AppLoad = 'loading' | 'auth' | 'ready' | 'not-found'

/**
 * How often the editor checks whether its resume's server copy advanced under
 * it (a background sync merging another device's edits). Cheap metadata-only
 * request; slow enough to be near-free, fast enough to notice within ~half a
 * minute of a sync landing.
 */
const REMOTE_POLL_MS = 20_000

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
  /**
   * The values both sides changed differently, when a three-way merge was
   * possible. Empty array is impossible here (a clean merge never reaches the
   * modal); `null` means we had no base document to merge against — a reload
   * mid-edit, or edits queued offline from a previous session — so the modal
   * falls back to a whole-document diff.
   */
  conflicts: MergeConflict[] | null
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
   * True when the open resume's server copy advanced past what this editor
   * holds while we have NO unsynced local edits — i.e. a background sync merged
   * newer data from another device (see the desktop BackupWatcher). Distinct
   * from `conflict`, which is for the case where WE also have local edits.
   * Cleared by `reloadFromServer` (or by a save that re-syncs us).
   */
  remoteUpdate: boolean
  /** Discard nothing, re-load the newer server copy into the editor. */
  reloadFromServer: () => void
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
  const replaceData = useStore((s) => s.replaceData)
  const unloadStore = useStore((s) => s.unloadStore)
  const reconcileRegistry = useStore((s) => s.reconcileRegistry)
  const setCurrentResumeId = useStore((s) => s.setCurrentResumeId)
  const hasData = useStore((s) => s.hasData)
  const mutationCount = useStore((s) => s.mutationCount)

  const [loadState, setLoadState] = useState<AppLoad>('loading')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [unsyncedCount, setUnsyncedCount] = useState(0)
  const [remoteUpdate, setRemoteUpdate] = useState(false)

  // "have we changed anything since the last successful save?" — both `data`
  // and `mutationCount` change together on a mutation, so the save effect
  // depends on `mutationCount` only and reads `data` via getState().
  const lastSavedMutation = useRef(0)
  const saveAbort = useRef<AbortController | null>(null)
  // The server version this client last saw — sent as the optimistic-
  // concurrency base on each save, advanced on every successful save.
  const baseVersion = useRef<number | undefined>(undefined)
  /**
   * The DOCUMENT at `baseVersion` — what our edits are derived from. Held so a
   * refused save can be three-way merged instead of thrown at the user as a
   * whole-document choice (see `lib/threeWayMerge.ts`).
   *
   * In memory only, deliberately. The obvious alternative is to persist it
   * beside the queued edit, but a pending record already carries the whole
   * document including base64 images, and localStorage is capped around 5 MB per
   * origin — doubling it to buy a better modal is the wrong trade. Null means
   * "no base available" (offline edits from a previous session, or a reload
   * mid-conflict), and the conflict path degrades to what it did before.
   */
  const baseData = useRef<ResumeStore | null>(null)
  // While a conflict is unresolved we pause auto-save (read inside the effect
  // via the ref so each mutation re-check sees the current value).
  const conflictPaused = useRef(false)

  /**
   * Adopt a server copy as the editor's new baseline: load it, take its
   * version as the concurrency base, and drop any queued local record.
   *
   * `loadStore` resets mutationCount, so `lastSavedMutation` must be reset to
   * match — otherwise the save effect sees a difference and fires a spurious
   * PUT. Getting that pairing wrong is silent, which is why the four call
   * sites (boot, reload, discard-conflict, re-auth) share one helper.
   */
  const adoptServerCopy = useCallback((
    data: ResumeStore,
    meta: { version: number; primary_locale: string; secondary_locale: string | null },
  ) => {
    loadStore(data, { primary: meta.primary_locale, secondary: meta.secondary_locale })
    baseVersion.current = meta.version
    // Read the store back rather than reusing `data`: loadStore migrates, so the
    // in-memory document can differ from what arrived, and a base that doesn't
    // match what we are editing would read every migrated field as an edit.
    baseData.current = useStore.getState().data
    lastSavedMutation.current = 0
    clearPending(resumeId)
    setCacheSavedAt(null)
  }, [loadStore, resumeId])

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
      // What the server now holds is what our next edits are derived from.
      baseData.current = snapshot
      lastSavedMutation.current = counterAtSend
      setSaveState('saved')
      // We now hold the server's latest version, so any pending "updated
      // elsewhere" notice is stale.
      setRemoteUpdate(false)
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
        // The server copy moved on (another tab, another machine, or the desktop
        // sync watcher merging a backup file). That is only a decision for the
        // user if both sides changed the SAME value — so try a three-way merge
        // first, and bother nobody when the two sets of edits don't overlap.
        const base = baseData.current
        const merge = base ? mergeStores(base, snapshot, err.current.data) : null

        if (merge && merge.conflicts.length === 0) {
          // Unambiguous. Adopt the reconciled document at the server's version
          // and let the ordinary save effect push it (replaceData bumps
          // mutationCount, which is what schedules that).
          //
          // replaceData, never loadStore: this is an in-app rewrite, so it must
          // stay on the undo stack and must reach auto-save (CLAUDE.md §7).
          baseVersion.current = err.current.meta.version
          baseData.current = err.current.data
          replaceData(merge.merged)
          setSaveState('saving')
          return
        }

        // Genuine overlap (or no base to merge against) — keep the local edits
        // (don't clear the cache) and pause auto-save until the user resolves.
        conflictPaused.current = true
        setConflict({
          data: err.current.data,
          meta: {
            version: err.current.meta.version,
            primary_locale: err.current.meta.primary_locale,
            secondary_locale: err.current.meta.secondary_locale,
          },
          conflicts: merge ? merge.conflicts : null,
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
  }, [resumeId, replaceData])

  // ── Initial load: prefer server, fall back to per-id local cache ──────────
  useEffect(() => {
    setLoadState('loading')
    setCurrentResumeId(resumeId)
    lastSavedMutation.current = 0
    baseVersion.current = undefined
    baseData.current = null
    conflictPaused.current = false
    setConflict(null)
    setRemoteUpdate(false)

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
          adoptServerCopy(res!.data, res!.meta) // also drops any clean local snapshot
          setLoadState('ready')
          return
        case 'flush-local':
          // Unsynced offline edits win over the server copy: load them and push
          // with their base version (clean → syncs; stale → non-blocking conflict).
          //
          // `baseData` stays null here: the queued record holds OUR edits, not
          // the document they were derived from, and passing our own edits off
          // as the base would make the merge read every one of them as "nobody
          // changed this" and quietly discard them.
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

    // Fetch the instance registry alongside the resume so linked entries can be
    // reconciled to their shared canonical identity right after load. Guarded so
    // a registry failure never blocks the resume boot (falls back to stored
    // names). No-op for un-shared resumes (nothing links).
    Promise.all([
      api.loadResume(resumeId),
      api.listRegistry().catch(() => [] as RegistryEntry[]),
    ])
      .then(([res, registry]) => {
        const pending = res ? loadPending(resumeId) : null
        applyBoot(decideBoot({ server: res ? 'hit' : 'not-found', pending }), res, pending)
        if (res) {
          reconcileRegistry(registry) // overlay canonical names (display-only)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- boot runs once per resumeId, by design
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

  // ── Remote-update poll: notice when the open resume's server copy advanced
  //    under us. On the desktop build a background sync (BackupWatcher) can merge
  //    newer edits from another device into the DB while the editor sits idle;
  //    without this poll the user wouldn't see them until a reload. We only
  //    surface it when this editor is CLEAN — with local edits the next save
  //    409s into the conflict modal, which is the right UX for that case.
  useEffect(() => {
    if (loadState !== 'ready') return
    let stopped = false
    const poll = async () => {
      // Skip while a conflict is open, while offline, or while we have unsynced
      // edits (those resolve via save/conflict, not a passive "reload" notice).
      if (conflictPaused.current || !isOnline()) return
      const base = baseVersion.current
      if (base === undefined) return
      const st = useStore.getState()
      if (st.mutationCount !== lastSavedMutation.current) return
      if (listDirty().some((d) => d.id === resumeId)) return
      try {
        const metas = await api.listResumes()
        if (stopped) return
        const mine = metas.find((m) => m.id === resumeId)
        if (mine && mine.version > base) setRemoteUpdate(true)
      } catch {
        // Auth/network hiccups are handled by the save path — ignore here so a
        // transient blip never disrupts editing.
      }
    }
    const t = setInterval(() => { void poll() }, REMOTE_POLL_MS)
    return () => { stopped = true; clearInterval(t) }
  }, [loadState, resumeId])

  // Once the user starts editing, withdraw the passive "reload" offer: they now
  // have local edits, so the right resolution is the conflict flow on save (a
  // plain reload here would silently drop those edits).
  useEffect(() => {
    if (remoteUpdate && mutationCount !== lastSavedMutation.current) setRemoteUpdate(false)
  }, [mutationCount, remoteUpdate])

  const reloadFromServer = useCallback(async () => {
    try {
      const res = await api.loadResume(resumeId)
      if (!res) { navigate('/', { replace: true }); return } // deleted under us
      adoptServerCopy(res.data, res.meta)
      setRemoteUpdate(false)
      setSaveState('idle')
    } catch (err) {
      if (err instanceof UnauthorizedError) { setLoadState('auth'); return }
      // A failed reload just leaves the notice up to try again.
      console.warn('Reload from server failed:', err)
    }
  }, [resumeId, adoptServerCopy])

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
      adoptServerCopy(conflict.data, conflict.meta)
      setConflict(null)
      setSaveState('idle')
    } else {
      // Keep mine: re-PUT the local edits at the server's now-current version
      // (a clean overwrite). The store still holds the local data untouched.
      baseVersion.current = conflict.meta.version
      // We are now based on the server copy we chose to overwrite, so a further
      // concurrent write merges against the right document instead of the one
      // this conflict superseded.
      baseData.current = conflict.data
      setConflict(null)
      void flushToServer()
    }
  }, [conflict, adoptServerCopy, flushToServer])

  const submitToken = useCallback(async (token: string) => {
    // Exchange the token for the HttpOnly session cookie first; a wrong token
    // throws UnauthorizedError here (no cookie set), which the AuthGate surfaces.
    await api.login(token)
    const res = await api.loadResume(resumeId)
    if (res) {
      adoptServerCopy(res.data, res.meta)
      setLoadState('ready')
    } else {
      setLoadState('not-found')
    }
  }, [adoptServerCopy, resumeId])

  return {
    loadState, saveState, cacheSavedAt, unsyncedCount, conflict, resolveConflict,
    // Both are async; the interface deliberately exposes them as void —
    // each handles its own failures, and a caller has nothing to await.
    retry: () => { void flushToServer() },
    remoteUpdate,
    reloadFromServer: () => { void reloadFromServer() },
    submitToken,
  }
}
