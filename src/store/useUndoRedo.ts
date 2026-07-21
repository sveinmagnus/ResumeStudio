/**
 * Undo/redo on top of the resume store.
 *
 * We subscribe to the store's `mutationCount`. Each increment is a user
 * mutation — we hand the PRE-mutation `data` to an `UndoHistory` and debounce
 * 500 ms, so a burst of edits (e.g. typing a sentence) collapses into one
 * undo step that reverts the whole burst. See `lib/undoHistory.ts` for the
 * burst-capture rule and its unit tests.
 *
 * Undo / redo apply a snapshot via the store's `replaceData` action, which
 * itself bumps `mutationCount` (so auto-save persists the undone state).
 * Because our own subscriber would otherwise treat that as a brand-new
 * mutation and re-push it, we set a one-shot `suppressNext` flag — flipped
 * synchronously inside undo/redo and cleared by the next subscription tick.
 */
import { useEffect, useRef, useState } from 'react'
import { useStore } from './useStore'
import { UndoHistory } from '../lib/undoHistory'
import type { ResumeStore } from '../types'

const DEBOUNCE_MS = 500
const MAX_HISTORY = 100  // cap so memory doesn't grow forever

export function useUndoRedo(): {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
} {
  const history = useRef(new UndoHistory<ResumeStore>(MAX_HISTORY))

  // When undo/redo apply a snapshot via replaceData, the subscriber would
  // otherwise treat that as a new mutation and record it. This ref tells it
  // to skip exactly one increment.
  const suppressNext = useRef(false)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const sync = () => {
    setCanUndo(history.current.canUndo)
    setCanRedo(history.current.canRedo)
  }

  // Subscribe to mutation-count changes — these mark a user mutation.
  useEffect(() => {
    let prevMutation = useStore.getState().mutationCount
    let prevData     = useStore.getState().data

    const unsub = useStore.subscribe((st) => {
      const advanced = st.mutationCount > prevMutation
      const preMutation = prevData
      prevMutation = st.mutationCount
      prevData     = st.data

      if (!advanced) return
      if (suppressNext.current) { suppressNext.current = false; return }

      // First mutation of a burst captures the pre-burst snapshot; later ones
      // in the same debounce window are folded in (see UndoHistory).
      history.current.onMutation(preMutation)
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
      pendingTimer.current = setTimeout(() => {
        pendingTimer.current = null
        history.current.commit()
        sync()
      }, DEBOUNCE_MS)
    })
    return () => {
      unsub()
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
    }
  }, [])

  // Commit any pending burst synchronously so an undo/redo issued mid-burst
  // targets every keystroke up to "now".
  const flush = () => {
    if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null }
    history.current.commit()
  }

  const undo = () => {
    flush()
    const snapshot = history.current.undo(useStore.getState().data)
    if (!snapshot) return
    suppressNext.current = true
    useStore.getState().replaceData(snapshot)
    sync()
  }

  const redo = () => {
    flush()
    const snapshot = history.current.redo(useStore.getState().data)
    if (!snapshot) return
    suppressNext.current = true
    useStore.getState().replaceData(snapshot)
    sync()
  }

  // Keyboard shortcuts:
  //   Undo — Ctrl/Cmd+Z
  //   Redo — Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Alt+Z, or Ctrl/Cmd+Y
  // The physical-key `code` is checked alongside `key` so an international
  // layout (where AltGr = Ctrl+Alt may reshape `key`) still triggers redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const isZ = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z'
      const isY = e.code === 'KeyY' || e.key === 'y' || e.key === 'Y'
      if (isZ) {
        e.preventDefault()
        if (e.shiftKey || e.altKey) redo()
        else undo()
      } else if (isY) {
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
