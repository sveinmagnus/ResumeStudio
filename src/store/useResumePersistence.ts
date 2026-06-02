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
  isAbortError,
  setStoredToken,
  clearStoredToken,
} from '../lib/api'
import { type SaveState } from '../components/layout/SaveStatus'
import { loadCache, saveCache, clearCache } from '../lib/localCache'
import { navigate } from '../lib/router'

export type AppLoad = 'loading' | 'auth' | 'ready' | 'not-found'

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

  // "have we changed anything since the last successful save?" — both `data`
  // and `mutationCount` change together on a mutation, so the save effect
  // depends on `mutationCount` only and reads `data` via getState().
  const lastSavedMutation = useRef(0)
  const saveAbort = useRef<AbortController | null>(null)

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
      await api.saveResume(resumeId, snapshot, locales, saveAbort.current.signal)
      lastSavedMutation.current = counterAtSend
      setSaveState('saved')
      // Clear the local cache once it matches the server — keeps things tidy.
      clearCache(resumeId)
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
      console.error('Auto-save failed:', err)
      setSaveState('error')
    }
  }, [resumeId])

  // ── Initial load: prefer server, fall back to per-id local cache ──────────
  useEffect(() => {
    setLoadState('loading')
    setCurrentResumeId(resumeId)
    lastSavedMutation.current = 0

    api.loadResume(resumeId)
      .then((res) => {
        if (res) {
          loadStore(res.data, {
            primary: res.meta.primary_locale,
            secondary: res.meta.secondary_locale,
          })
          // Server is the source of truth — drop any stale local cache.
          clearCache(resumeId)
          setCacheSavedAt(null)
          setLoadState('ready')
        } else {
          // Server reachable but no such resume id. Don't fall back to cache —
          // that would resurrect ghost data. Send the user back to the picker.
          setLoadState('not-found')
        }
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) { setLoadState('auth'); return }
        // Server unreachable — try the per-id local cache so the user can keep
        // working with the last known good state of this resume.
        console.warn('Could not reach server:', err)
        const cached = loadCache(resumeId)
        if (cached) {
          loadStore(cached.data)
          setCacheSavedAt(cached.saved_at)
          setSaveState('offline')
          setLoadState('ready')
        } else {
          setLoadState('not-found')
        }
      })

    return () => {
      // Cancel any in-flight save and eject the resume so a quick switch
      // doesn't briefly show the old data under the new id.
      saveAbort.current?.abort()
      unloadStore()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId])

  // ── Local-cache write: short debounce so we don't stringify per keystroke.
  useEffect(() => {
    if (!hasData || mutationCount === 0) return
    const t = setTimeout(() => {
      saveCache(resumeId, useStore.getState().data)
      setCacheSavedAt(new Date().toISOString())
    }, 250)
    return () => clearTimeout(t)
  }, [mutationCount, hasData, resumeId])

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
      const res = await api.loadResume(resumeId)
      if (res) {
        loadStore(res.data, {
          primary: res.meta.primary_locale,
          secondary: res.meta.secondary_locale,
        })
        setLoadState('ready')
      } else {
        setLoadState('not-found')
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) clearStoredToken()
      throw err
    }
  }, [loadStore, resumeId])

  return { loadState, saveState, cacheSavedAt, retry: flushToServer, submitToken }
}
