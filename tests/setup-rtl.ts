/**
 * Vitest global setup — runs for every test file regardless of environment.
 *
 * 1. Registers the jest-dom matchers on Vitest's `expect`. Safe to load
 *    under both `node` and `jsdom` environments because matcher
 *    registration has no DOM-side effects at import time.
 *
 * 2. Cleans up React Testing Library renders between tests. RTL ships
 *    auto-cleanup that runs in `afterEach`, but only when `afterEach` is
 *    a global. Vitest does not register globals by default, so we wire
 *    cleanup up explicitly here. Without this, DOM from one test bleeds
 *    into the next and queries like `getAllByRole` return stale nodes.
 */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  cleanup()
})
