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
    primaryLocale: s.primaryLocale,
    secondaryLocale: s.secondaryLocale,
    expandedItemId: s.expandedItemId,
    hasData: s.hasData,
    mutationCount: 0,
  }
})()

export function resetStore(): void {
  useStore.setState(INITIAL)
}
