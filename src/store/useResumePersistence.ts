/**
 * Resume persistence orchestration — boot load + auto-save, extracted from
 * App.tsx so the component is purely routing.
 *
 * Owns the three timing-sensitive effects and the refs they share:
 *   1. Boot load — prefer the server, fall back to the local cache.
 *   2. Local-cache write — 250 ms debounce after a mutation (cheap fallback).
 *   3. Server save — 1 s debounce, AbortController so a newer mutation
 *      supersedes an in-flight save.
 *
 * See CLAUDE.md §8 for the full boot/save sequence this implements. The hook
 * intentionally lives beside `useUndoRedo` — both are app-wiring hooks that
 * bridge the store to a cross-cutting concern. The only non-store/lib import
 * is the `SaveState` *type* from the SaveStatus component (erased at compile,
 * so no runtime layering violation).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from './useStore'
import { api, UnauthorizedError, isAbortError, setStoredToken, clearStoredToken } from '../lib/api'
import { type SaveState } from '../components/layout/SaveStatus'
import { isBackupFormat, importFromBackup, UnsupportedBackupVersionError } from '../lib/backup'
import { loadCache, saveCache, clearCache } from '../lib/localCache'

export type AppLoad = 'loading' | 'auth' | 'ready'

export interface ResumePersistence {
  loadState: AppLoad
  saveState: SaveState
  cacheSavedAt: string | null
  /** Re-run the pending server save (Retry button in SaveStatus). */
  retry: () => void
  /**
   * Store a token and try to load with it. Resolves on success (and flips
   * loadState to 'ready'); rejects with the underlying error so the caller
   * can map it to a user-facing message. Clears the bad token on 401.
   */
  submitToken: (token: string) => Promise<void>
  /** Load a backup or CVpartner JSON file chosen from the header. */
  loadFile: (file: File) => Promise<void>
}

export function useResumePersistence(): ResumePersistence {
  // Actions are stable references (created once in the store), so selecting
  // them here doesn't subscribe this hook to re-renders.
  const loadStore = useStore((s) => s.loadStore)
  const loadFromCVPartner = useStore((s) => s.loadFromCVPartner)
  const hasData = useStore((s) => s.hasData)
  const mutationCount = useStore((s) => s.mutationCount)

  const [loadState, setLoadState] = useState<AppLoad>('loading')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(null)

  // mutationCount is "have we changed anything since the last successful
  // server save?" Both `data` and `mutationCount` change together on a
  // mutation, so the save effect depends on `mutationCount` only and reads
  // `data` via getState() — keeps `flushToServer` from being rebuilt on every
  // keystroke (which would churn the save-effect teardown/setup cycle).
  const lastSavedMutation = useRef(0)
  const saveAbort = useRef<AbortController | null>(null)

  const flushToServer = useCallback(async () => {
    const snapshot = useStore.getState().data
    const counterAtSend = useStore.getState().mutationCount
    saveAbort.current?.abort()
    saveAbort.current = new AbortController()
    setSaveState('saving')
    try {
      await api.save(snapshot, saveAbort.current.signal)
      lastSavedMutation.current = counterAtSend
      setSaveState('saved')
      // Clear the local cache once it matches the server — keeps things tidy
      // and avoids stale data lingering after a successful sync.
      clearCache()
      setCacheSavedAt(null)
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000)
    } catch (err) {
      if (isAbortError(err)) return
      if (err instanceof UnauthorizedError) { setLoadState('auth'); return }
      console.error('Auto-save failed:', err)
      setSaveState('error')
    }
  }, [])

  // ── Initial load: prefer server, fall back to local cache ─────────────────
  useEffect(() => {
    api.load()
      .then((store) => {
        if (store) {
          loadStore(store)
          // Server is the source of truth — drop any local cache.
          clearCache()
          setCacheSavedAt(null)
        } else {
          // Server is up but has no resume yet. If we have local work,
          // restore it silently so the user doesn't lose anything.
          const cached = loadCache()
          if (cached) {
            loadStore(cached.data)
            setCacheSavedAt(cached.saved_at)
          }
        }
        setLoadState('ready')
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) { setLoadState('auth'); return }
        // Server unreachable — try the local cache so the user can keep working.
        console.warn('Could not reach server:', err)
        const cached = loadCache()
        if (cached) {
          loadStore(cached.data)
          setCacheSavedAt(cached.saved_at)
          setSaveState('offline')
        }
        setLoadState('ready')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Local-cache write: short debounce so we don't stringify the whole
  //    store on every keystroke. Still much tighter than the server save
  //    (1 s) so a browser crash loses at most ~quarter-second of work.
  useEffect(() => {
    if (!hasData || mutationCount === 0) return
    const t = setTimeout(() => {
      saveCache(useStore.getState().data)
      setCacheSavedAt(new Date().toISOString())
    }, 250)
    return () => clearTimeout(t)
  }, [mutationCount, hasData])

  // ── Server save: 1s debounce after the latest user mutation ───────────────
  useEffect(() => {
    if (!hasData) return
    if (mutationCount === lastSavedMutation.current) return
    const t = setTimeout(() => { void flushToServer() }, 1000)
    return () => clearTimeout(t)
  }, [mutationCount, hasData, flushToServer])

  const submitToken = useCallback(async (token: string) => {
    setStoredToken(token)
    try {
      const store = await api.load()
      if (store) loadStore(store)
      setLoadState('ready')
    } catch (err) {
      if (err instanceof UnauthorizedError) clearStoredToken()
      throw err
    }
  }, [loadStore])

  const loadFile = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      const json = JSON.parse(text) as unknown

      if (isBackupFormat(json)) {
        // Routes through migrateBackup → throws UnsupportedBackupVersionError
        // if the file was saved by a newer build.
        loadStore(importFromBackup(json))
      } else {
        // Anything else we assume is a CVpartner export — the importer is
        // defensive enough to handle most malformed inputs.
        loadFromCVPartner(json as Record<string, unknown>)
      }
    } catch (e) {
      const msg = e instanceof UnsupportedBackupVersionError
        ? e.message
        : `Could not load file: ${(e as Error).message}`
      alert(msg)
    }
  }, [loadStore, loadFromCVPartner])

  return { loadState, saveState, cacheSavedAt, retry: flushToServer, submitToken, loadFile }
}
