---
name: software-testing
description: How to test code and run quality assurance so the output is genuinely trustworthy, not just green. Use when asked to test, verify, QA, add test coverage, review test quality, harden a change, or confirm something works. Covers the typecheck/test/build gate, writing high-signal tests that find real bugs, regression tests, live verification discipline, and telling real failures apart from environment noise.
---

# Software Testing & QA

Goal: make the QA output *trustworthy*. A green test run that asserts the wrong
thing, or a "works!" claim based on a misread, is worse than no QA — it
launders a bug into "verified." Everything below is in service of: **does this
change actually do what it's supposed to, and will I know if it later breaks?**

---

## 1. The quality gate — run all three, every time

Order matters; each catches what the previous one misses.

1. **Typecheck** (`npm run typecheck` / `tsc --noEmit`) — covers *all* tsconfig
   projects (client *and* server). Clean types are table stakes, not done.
2. **Tests** (`npm test`) — the behavioural contract.
3. **Build** (`npm run build`) — the prod bundler catches what `tsc` cannot:
   missing exports from third-party packages, broken dynamic imports, lazy-chunk
   problems. *Never skip the build because typecheck was clean.*

For user-facing changes, add a **4th step: live verification** (§5). "Tests
pass" ≠ "the feature works."

Run the gate **before declaring done and before committing**, not just at the
end of a long edit. CI should run the same three so regressions can't merge.

---

## 2. Write tests that can actually find bugs

A test only has value if it could fail for a real reason. High-signal habits:

- **Pin the documented contract.** When a comment / README / guide says "X
  happens," write a test that asserts X. Divergence between doc and code is a
  rich bug seam. *(This session: the importer's doc said the work-experience id
  map is built before projects so links resolve — the code built it after, so
  every link was silently `null`. A contract test caught it.)*
- **Assert the no-op.** For every mutation, also test that an *unobservable*
  change does **not** happen: unknown id → no state change, no counter bump;
  same-position move → no-op. Over-eager mutation hides here. *(Caught
  `updateItem`/`moveItem` bumping a mutation counter when nothing changed.)*
- **Test the fallback chain, including empties.** Resolution/precedence logic
  must be tested with empty strings, missing keys, and "first non-empty wins" —
  not just present/absent. *(A `resolve()` returned `''` when the primary key
  held an empty string instead of falling through.)*
- **Table-driven tests for parsers, importers, formatters.** One row per
  documented edge case (alternate input shapes, normalisation, malformed input
  that must not throw, ID stability, ordering, dedup).
- **Round-trip / identity tests for serializers.** `import(export(x))` deep-equals
  `x`; survive a real `JSON.parse(JSON.stringify(...))` cycle, not just an
  in-memory object.
- **Smoke tests for binary / heavy artifacts.** Don't assert exact bytes. Check
  structure: a `.docx` starts with the ZIP magic `PK\x03\x04` and contains
  `word/document.xml` + `[Content_Types].xml`; a bigger input yields a bigger
  file; excluded items are absent. Enough to prove "it produced a real, correct
  document" without brittleness.

---

## 3. Test at the right altitude

If a piece of logic is hard to test, that is a **design signal**, not a reason
to skip the test.

- **Extract tricky logic out of React hooks / IO / the DOM into a pure module,
  then unit-test the pure module.** The bug-prone part becomes deterministic and
  fast to test; the hook/component shrinks to thin glue. *(Burst-undo logic
  lived tangled inside a `useEffect` with timers and refs and had zero coverage
  — that's exactly where the bug hid. Extracting a pure `UndoHistory` class made
  the burst rule testable and the regression obvious.)*
- **Test through the seam the app actually uses.** For a Zustand/Redux app the
  store is a clean seam — drive actions, assert state. For pure libs, call the
  function. Reach for full component/E2E tests only for behaviour you can't
  reach more cheaply.
- **Mock at the boundary.** Stub `fetch`, pass an `AbortSignal`, fake timers —
  test the error matrix (404, 500, abort, network-down) without a live backend.

---

## 4. When a bug is fixed, leave a tripwire

- **Every bug fix ships with a regression test** that fails before the fix and
  passes after. Name it after the symptom, reference the commit/issue in a
  comment. The fix is not done until that test exists.
- **Coverage is a discovery tool, not a target.** Don't chase a percentage. *Do*
  read the report for **0%-covered files** — they're often dead code (this
  session found an orphaned module that way) or an untested risk surface.

---

## 5. Live / manual verification discipline

Unit tests prove logic; only running the app proves the feature. When you
verify by hand (browser, CLI, API):

- **Control the environment.** Start from known state: clean/seeded DB, a server
  you know is up, caches cleared. Stale persisted state from earlier experiments
  will masquerade as a bug (a leftover `resume: null` row made an editor render
  blank — not a code defect).
- **Wait for async to settle; don't query mid-boot.** Poll for a readiness
  signal (an element exists, content length > N) before asserting. A "blank
  page" is often "you looked before load finished."
- **Re-derive the EXPECTED result *before* you look at the actual.** State the
  prediction, then observe. Rationalising whatever you see is how a bug passes
  review: *typing "Hello" then one undo should yield `""` (whole burst); I
  earlier saw `3→2` on a list and called it "works" when it was the bug —
  reverting only the last change.*
- **Exercise the failure path, not just the happy path.** Save-failure banner +
  retry, offline fallback, pop-up-blocked export, empty/again-empty states.

---

## 6. Real failure vs. environment noise

Before filing something as a bug, rule out the harness. Common false alarms:

- **HMR / Fast-Refresh artifacts** after editing a hook: "React has detected a
  change in the order of Hooks" comparing the *old* module's hook sequence to
  the *new* one. A full reload (or restart the dev server) clears it. If the
  production **build** is clean and unit tests pass, the code is fine.
- **Port collisions** from the launcher injecting an env var (a dev server and
  API fighting over one port) → spurious save failures. Known-quirk, not your
  change.
- **Stale local/persisted state** — localStorage cache, a DB row from a prior
  manual `PUT`, a service worker. Clear it and retry.
- **Pop-up blockers / permissions** for print/export/clipboard flows.

Conversely, **don't dismiss a real failure as "flaky."** If you can't explain
*why* it's environmental, treat it as real until proven otherwise.

---

## 7. When a test fails: triage, don't reflex-fix

A red test means *something* disagrees. Decide **which side is right**:

- **Code bug** → fix the code, keep the test.
- **Test encodes an outdated contract** that changed *intentionally* → update
  the test to the new contract, with a comment saying why it changed. *(When
  detection was deliberately loosened to accept any version envelope, the old
  "rejects future version" assertion was updated, not deleted.)*
- **Ambiguous/over-specified test** → tighten the scenario so it tests one clear
  thing.

**Never** make a test pass by deleting it, loosening it to meaninglessness, or
weakening an assertion you don't understand. That converts a signal into a lie.

---

## 8. Reporting QA honestly

Distinguish, explicitly, between:

- **Verified** — you ran it and observed the expected result (say how).
- **Covered by tests** — automated, and what they assert.
- **Assumed / not exercised** — be upfront (e.g. "the live third-party
  round-trip isn't in CI; only the mocked error paths are").
- **Environmental** — failures you've attributed to the harness, with the reason.

State counts that matter (N tests passing, gate green) and what changed since
the last run. A precise "X is verified, Y is covered, Z is assumed" is far more
useful than a blanket "all good."

---

## Anti-patterns (don't)

- Skipping the build because `tsc` was clean.
- Asserting implementation details instead of observable behaviour.
- Tests that merely restate the code (they lock in shape, not correctness, and
  break on every refactor).
- Constructing entities inline in every test instead of shared fixtures/factories
  (one shape change → dozens of edits).
- Forgetting to reset a singleton store/state between tests (leakage → false
  pass/fail).
- Calling a feature "verified" from one happy-path click, or from a misread.
- Treating a green suite as proof the *feature* works — run the app too.
