import { defaultExclude, mergeConfig } from 'vitest/config'
import base from './vite.config'

/**
 * The suite Stryker drives (`npm run test:mutation`) — the ordinary config with
 * exactly one test removed.
 *
 * `loginTimingRevealsALockedAccount` asserts that a failed login against a
 * locked account costs about what a real one costs. It is a real defence and it
 * belongs in the suite, but it decides pass/fail from wall clock, and a
 * mutation run is the one place wall clock means nothing: the code is
 * instrumented, two runners compete for the same cores, and the mutant itself
 * may have removed the scrypt derivation being timed.
 *
 * The dangerous direction is a FALSE KILL — scheduling noise trips the ratio,
 * Stryker records the mutant as caught, and the report claims a test covers
 * something no test asserts. That is worse than no report, so the test sits out
 * this run and keeps its meaning in the ordinary one.
 */
export default mergeConfig(base, {
  test: {
    exclude: [...defaultExclude, 'tests/server/loginTimingRevealsALockedAccount.test.ts'],
  },
})
