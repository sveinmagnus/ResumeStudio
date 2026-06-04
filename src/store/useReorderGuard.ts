import { useCallback } from 'react'
import { useStore } from './useStore'
import { SORT_LABELS } from '../lib/sectionSort'
import type { ResumeStore } from '../types'

type ArraySection = Exclude<keyof ResumeStore, 'resume'>

/**
 * Guard a manual reorder (drag or arrow) against a non-custom sort mode.
 *
 * Returns a function: call it with the actual reorder, and when the section
 * is in a computed sort mode it first asks the user to confirm overwriting
 * their saved custom order. On confirm the wrapped reorder runs — the store's
 * moveItem then bakes the displayed order into sort_order and flips the
 * section back to Custom. On cancel the reorder is skipped.
 *
 * In Custom mode the wrapped reorder runs immediately (no prompt).
 */
export function useReorderGuard(section: ArraySection): (proceed: () => void) => void {
  const mode = useStore((s) => s.sectionSort[section] ?? 'custom')
  return useCallback((proceed: () => void) => {
    if (mode !== 'custom') {
      const ok = window.confirm(
        `This section is sorted by “${SORT_LABELS[mode]}”.\n\n` +
        `Moving an item by hand will replace your saved custom order with the ` +
        `current arrangement and switch the section back to Custom order.\n\nContinue?`,
      )
      if (!ok) return
    }
    proceed()
  }, [mode, section])
}
