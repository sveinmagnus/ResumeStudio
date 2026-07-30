// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { navigate, stampHistoryState, takePendingRestore } from '../src/lib/router'

/**
 * Per-history-entry UI state: the thing that makes browser Back return you to
 * where you were, with the card you came from still open.
 */

beforeEach(() => {
  window.history.replaceState(null, '', '/r/abc/projects')
})

describe('stampHistoryState', () => {
  it('records the snapshot on the CURRENT entry without adding history', () => {
    const before = window.history.length
    stampHistoryState({ scrollY: 900, expandedItemId: 'item-1' })

    expect((window.history.state as { ui?: unknown }).ui)
      .toEqual({ scrollY: 900, expandedItemId: 'item-1' })
    expect(window.history.length).toBe(before)
    expect(window.location.pathname).toBe('/r/abc/projects')
  })

  /** Called on every scroll frame, so an unchanged value must not churn. */
  it('is a no-op when nothing changed', () => {
    stampHistoryState({ scrollY: 900, expandedItemId: 'item-1' })
    const first = window.history.state
    stampHistoryState({ scrollY: 900, expandedItemId: 'item-1' })
    expect(window.history.state).toBe(first)
  })

  it('preserves any other state already on the entry', () => {
    window.history.replaceState({ other: 'keep me' }, '', '/r/abc/projects')
    stampHistoryState({ scrollY: 10, expandedItemId: null })
    expect((window.history.state as { other?: string }).other).toBe('keep me')
  })
})

describe('takePendingRestore', () => {
  /**
   * Forward navigation must restore nothing — arriving somewhere new starts at
   * the top. Only a popstate hands back a snapshot.
   */
  it('has nothing pending after a forward navigation', () => {
    stampHistoryState({ scrollY: 900, expandedItemId: 'item-1' })
    navigate('/r/abc/courses')
    expect(takePendingRestore()).toBeNull()
  })

  it('yields the snapshot once, then nothing', () => {
    stampHistoryState({ scrollY: 900, expandedItemId: 'item-1' })
    navigate('/r/abc/courses')

    // jsdom doesn't run the back/forward stack, so deliver the popstate the way
    // the browser would: with the previous entry's state attached.
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { ui: { scrollY: 900, expandedItemId: 'item-1' } },
    }))

    expect(takePendingRestore()).toEqual({ scrollY: 900, expandedItemId: 'item-1' })
    // Consumed — a later render must not re-apply it and yank the user back.
    expect(takePendingRestore()).toBeNull()
  })

  it('yields null for an entry that carries no snapshot', () => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    expect(takePendingRestore()).toBeNull()
  })
})
