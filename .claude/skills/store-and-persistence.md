---
name: store-and-persistence
description: How Resume Studio's Zustand store and persistence layer actually work, and the invariants you must preserve. Use before changing anything in src/store/ (useStore, useResumePersistence, useUndoRedo), src/lib/localCache.ts, or the auto-save / boot / undo flow — or when adding a store action. Encodes the loadStore-vs-replaceData split and the mutationCount contract whose silent breakage has caused real bugs (merge not undoable, burst undo).
---

# Store & persistence

This is the highest-risk architectural area: the contracts here break
*silently* — no type error, no crash, just "undo doesn't see it" or "it never
saved." Read this before touching `src/store/**`, `src/lib/localCache.ts`, or
`src/lib/api.ts`. Pairs with CLAUDE.md §7 (store) and §8 (persistence).

## 1. The one rule that matters: how data gets replaced

There are **two** whole-store replacement actions and they are NOT
interchangeable:

| Action | Semantics | `mutationCount` | Use for |
|---|---|---|---|
| `loadStore(store, locales?)` | **I/O** — start a fresh editing session | **reset to 0** | server load, file open, cache restore |
| `replaceData(store)` | **in-app rewrite** — a computed mutation | **bumped** | undo/redo, registry merge, any "I computed a new store" |

**The failure mode:** call `loadStore` for an in-app rewrite and the change
silently (a) never enters the undo stack and (b) may never auto-save —
`mutationCount` was reset, so the save effect thinks nothing changed. This is
exactly the bug that made registry merges non-undoable until they were switched
to `replaceData`.

`loadStore` also runs the on-load migration (`foldRoleDescriptions`) and seeds
primary/secondary locale (from the caller's `locales` arg, else from
`supported_locales`). `replaceData` does neither — the data is assumed current.

Other loads (also reset `mutationCount`): `loadFromCVPartner`, `startFresh`,
`unloadStore`.

## 2. The `mutationCount` + `mutate()` contract

`mutationCount` is a monotonic counter: **+1 on every user-initiated data
mutation, reset to 0 on every load.** The persistence hook compares it to a
"last saved" ref to decide whether to auto-save; `useUndoRedo` subscribes to it
to know when to snapshot.

**Every mutating action funnels through the private `mutate()` helper** in
`useStore.ts`, which bumps the counter for you. When you add an action:

- Use `mutate((st) => patch)`. **Do not call `set()` directly** for a data
  change — auto-save, undo, and the local cache all key off `mutationCount`, so
  a raw `set` is invisible to all three.
- **Return `null` for a no-op** (unknown id, move-to-same-index, locale already
  set, nothing actually changed). This leaves state untouched AND skips the
  counter bump, so the save effect doesn't fire for an unobservable "change."
  `updateItem`/`removeItem`/`moveItem`/`detectAndSetLocales`/the locale setters
  all do this — match the pattern.

Note the locale setters (`setPrimaryLocale`/`setSecondaryLocale`) go through
`mutate()` too — the chosen locales are persisted server-side per resume and
ride along on the next PUT.

## 3. Multi-resume lifecycle

The app is now multi-resume (router-driven, `/r/:id`):

- `currentResumeId` tracks the loaded resume. `useResumePersistence(resumeId)`
  is parameterised by the id from the URL.
- **Mount loads, unmount ejects.** The boot effect keys on `resumeId`; its
  cleanup aborts any in-flight save and calls `unloadStore()` so a fast switch
  never flashes the old resume's data under the new id.
- The local cache is **per-id** (`resumestudio:store-cache:v1:<id>`), so two
  resumes never fight over one slot. `clearAllCaches()` on logout,
  `dropLegacyCache()` once on boot for the pre-multi-resume key.

## 4. Boot sequence (server-first, cache fallback)

In `useResumePersistence`:
1. `api.loadResume(id)` succeeds → `loadStore` with server locales, clear that
   id's cache, `ready`.
2. Server reachable but **no such id** → `not-found`. **Do NOT fall back to
   cache here** — that would resurrect ghost data for a deleted/foreign id.
3. Server **unreachable** → restore the per-id cache if present (`offline`),
   else `not-found`.
4. `401` → `auth`. `404` mid-session (deleted under us) → `navigate('/')`.

## 5. Save sequence

- **Local cache:** 250 ms debounce after a mutation (cheap, but not
  per-keystroke). Reads `data` via `useStore.getState()`.
- **Server:** 1 s debounce. `AbortController` so a newer mutation supersedes an
  in-flight PUT. Sends data **+ current locales** together. On success: clear
  the cache (now matches server), flash "Saved" 2 s. On failure: `error` state +
  Retry (which calls the same `flushToServer`). Abort errors are swallowed.

`flushToServer` reads `data`/`mutationCount`/locales from `getState()` at call
time, so the callback isn't rebuilt on every keystroke (only `resumeId` is a
dep). Keep it that way.

## 6. Undo / redo

`useUndoRedo` subscribes to `mutationCount`, debounces 500 ms, and pushes the
**pre-mutation** snapshot to a pure `UndoHistory` (`src/lib/undoHistory.ts`).
Apply happens via `replaceData` (so the undone state saves), with a one-shot
`suppressNext` flag so the resulting bump isn't re-recorded. Burst capture (one
undo step per typing burst) lives in `UndoHistory` and is unit-tested — if you
touch undo, change `UndoHistory` and its tests, not the timing glue.

## 7. When you touch this — checklist

1. New data action? Route it through `mutate()`; return `null` for no-ops.
2. Computing a new whole store in-app? `replaceData`, never `loadStore`.
3. Added a field that should persist? Confirm it's inside `data` (or the locale
   pair) so the PUT carries it; check the boot path restores it.
4. Touched the save/boot effects? Re-verify the cache-vs-server debounce and the
   not-found-vs-offline distinction (§4) — these are easy to invert.
5. Run `npm test` — `tests/store.test.ts` is the contract net:
   - every mutator bumps exactly once,
   - **no-ops do NOT bump** (the assertion that catches over-eager mutation),
   - `loadStore` resets to 0, `replaceData` bumps.
   Add a case for your action, including its no-op.

## 8. Gotcha for live verification

Auto-save can't be verified inside the Claude preview tool as-is: it injects
`PORT=5173`, which the Express server also tries to bind, colliding with Vite →
spurious save 500s. Run the server manually on 3001 to test save end-to-end
(see CLAUDE.md known quirks). Don't mistake those 500s for a code bug.
