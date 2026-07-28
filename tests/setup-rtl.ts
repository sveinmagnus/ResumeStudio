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
 *
 * 3. Aligns RTL's async timeout with the raised `testTimeout`.
 */
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/**
 * `findBy*` and `waitFor` do NOT honour Vitest's `testTimeout` — they use RTL's
 * own `asyncUtilTimeout`, which is still at its 1s default. vite.config.ts
 * raises testTimeout to 15s precisely because these tests "can take several
 * seconds under full-suite parallelism", but that only governs the test as a
 * whole: a `findByRole` inside one still gave up after 1s.
 *
 * 3s keeps a real "element never appears" bug failing fast while leaving the
 * margin the raised testTimeout was meant to provide. (This is a correctness
 * fix, not the flakiness fix — that was capping maxWorkers. The failures seen
 * before that were whole-test timeouts, not query timeouts.)
 */
configure({ asyncUtilTimeout: 3000 })

afterEach(() => {
  cleanup()
})
