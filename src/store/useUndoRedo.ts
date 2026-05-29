/**
 * Undo/redo on top of the resume store.
 *
 * We subscribe to the store's mutationCount. Each increment is a user
 * mutation — we debounce 500 ms (so bursts of typing collapse into one undo
 * step), then push the PRE-mutation `data` to a past stack.
 *
 * Undo / redo apply a snapshot via the store's `replaceData` action, which
 * itself bumps `mutationCount` (so auto-save persists the undone state).
 * Because our own subscriber would otherwise treat that as a brand-new
 * mutation and re-push it, we set a one-shot `suppressNext` flag — flipped
 * synchronously inside undo/redo and cleared by the next subscription tick.
 *
 * History lives in module-scope refs rather than React state because it's
 * append-mostly and the keyboard handler only reads the latest entry.
 */
import { useEffect, useRef, useState } from 'react'
import { useStore } from './useStore'
import type { ResumeStore } from '../types'

const DEBOUNCE_MS = 500
const MAX_HISTORY = 100  // cap so memory doesn't grow forever

export function useUndoRedo(): {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
} {
  const past   = useRef<ResumeStore[]>([])
  const future = useRef<ResumeStore[]>([])

  // When undo/redo apply a snapshot via replaceData, the subscriber would
  // otherwise treat that as a new mutation and push it. This ref tells it
  // to skip exactly one increment.
  const suppressNext = useRef(false)

  // The next snapshot we'll commit if no further mutation arrives within
  // DEBOUNCE_MS. Captured in the setTimeout closure.
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushPending = useRef<(() => void) | null>(null)

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Subscribe to mutation-count changes — these mark a user mutation.
  useEffect(() => {
    let prevMutation = useStore.getState().mutationCount
    let prevData     = useStore.getState().data

    const unsub = useStore.subscribe((st) => {
      const advanced = st.mutationCount > prevMutation
      const snapshot = prevData
      prevMutation = st.mutationCount
      prevData     = st.data

      if (!advanced) return
      if (suppressNext.current) { suppressNext.current = false; return }

      // Debounce: replace any prior pending commit with one targeting the
      // newest pre-mutation snapshot.
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
      const commit = () => {
        past.current.push(snapshot)
        if (past.current.length > MAX_HISTORY) past.current.shift()
        future.current = []
        flushPending.current = null
        setCanUndo(true)
        setCanRedo(false)
      }
      flushPending.current = commit
      pendingTimer.current = setTimeout(commit, DEBOUNCE_MS)
    })
    return () => {
      unsub()
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
    }
  }, [])

  // Flush any debounced commit synchronously, so undo/redo targets reflect
  // every keystroke up to "now" rather than the last paused state.
  const flush = () => {
    if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null }
    if (flushPending.current) { flushPending.current(); flushPending.current = null }
  }

  const undo = () => {
    flush()
    const snapshot = past.current.pop()
    if (!snapshot) return
    future.current.push(useStore.getState().data)
    suppressNext.current = true
    useStore.getState().replaceData(snapshot)
    setCanUndo(past.current.length > 0)
    setCanRedo(future.current.length > 0)
  }

  const redo = () => {
    flush()
    const snapshot = future.current.pop()
    if (!snapshot) return
    past.current.push(useStore.getState().data)
    suppressNext.current = true
    useStore.getState().replaceData(snapshot)
    setCanUndo(past.current.length > 0)
    setCanRedo(future.current.length > 0)
  }

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl/Cmd+Y) keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // undo/redo are stable closures over refs — safe to omit from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { undo, redo, canUndo, canRedo }
}
