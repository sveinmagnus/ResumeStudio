/**
 * Reset the Zustand store between component tests.
 *
 * The store is a module-level singleton — without this, state mutations
 * from one test leak into the next. We snapshot the initial state once
 * at import time, before any test runs, then restore it before each test.
 *
 * The snapshot is taken via `useStore.getState()` so the defaults stay in
 * sync with the production store; if those defaults change, no parallel
 * copy here needs updating.
 */
import { useStore } from '../../src/store/useStore'

const INITIAL = (() => {
  const s = useStore.getState()
  return {
    data: s.data,
    activeSection: s.activeSection,
    // A stale open view is invisible until two tests reuse a view id: the
    // second one then renders the EDITOR where it expected the list.
    activeViewId: s.activeViewId,
    primaryLocale: s.primaryLocale,
    secondaryLocale: s.secondaryLocale,
    expandedItemId: s.expandedItemId,
    hasData: s.hasData,
    mutationCount: 0,
    // Leaks the worst of any of these: a stray `readOnly` makes every
    // subsequent test's mutations silently do nothing.
    readOnly: s.readOnly,
  }
})()

export function resetStore(): void {
  useStore.setState(INITIAL)
}
