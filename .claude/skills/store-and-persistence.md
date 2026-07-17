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

`loadStore` also runs the data-shape migration chain (`lib/migrate.ts →
migrateStore()` — the single choke point for data entering from outside; the
snapshot-restore site calls it manually before `replaceData`) and seeds
primary/secondary locale (from the caller's `locales` arg, else from
`supported_locales`). `replaceData` never migrates — in-app computed data is
current by construction.

Other loads (also reset `mutationCount`): `startFresh`, `unloadStore`. (The
old `loadFromCVPartner` action is gone — CVpartner import goes through
ImportScreen → `importFromCVPartner()` → `api.createResume`, like every other
import format.)

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

## 4. The server API (all auth-gated, under `/api/resumes`)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/resumes` | Metadata list, newest first. `{resumes: []}` (never 404) — empty = fresh install. |
| `POST` | `/api/resumes` | `{name, data?, primary_locale?, secondary_locale?}` → 201 `{resume}`. |
| `GET` | `/api/resumes/:id` | `{data, meta}` (incl. `version`) or 404. `ETag: "<version>"`. |
| `PUT` | `/api/resumes/:id` | `{data, primary_locale?, secondary_locale?, base_version?}` — locales in pairs (400 if only one). 404 unknown; **409** `{error, current}` if `base_version` stale; else `{ok, saved_at, version}`. |
| `PATCH` | `/api/resumes/:id` | Rename only (`{name}`). |
| `DELETE` | `/api/resumes/:id` | Hard delete; snapshots cascade. |
| `GET` | `/api/resumes/:id/snapshots[/:sid]` | Snapshot metadata list / one snapshot's data. |

The `resumes` row carries a **`version`** column — an optimistic-concurrency
token. Every save sends the client's `base_version`; a stale one gets a 409
with the server's current state (nothing written).

## 5. Boot sequence (server-first; dirty queue wins)

In `useResumePersistence` (pure decisions in `lib/syncEngine.ts → decideBoot`):
1. `api.loadResume(id)` succeeds → seed base `version` + locales. **If a dirty
   `PendingRecord` also exists, trust IT over the server copy**: load the local
   data and flush it with its stored `base_version` (clean push syncs; stale
   base raises the non-blocking conflict). Otherwise `loadStore` the server
   copy and drop any clean local record.
2. Server reachable but **no such id** → `not-found`. **Do NOT fall back to
   cache here** — that would resurrect ghost data for a deleted/foreign id.
3. Server **unreachable** → restore `loadPending(id)` (+ its `base_version`)
   if present (`offline`), else `not-found`; kick a connectivity recheck.
4. `401` → `auth`. `404` mid-session (deleted under us) → `navigate('/')`.

## 6. Save sequence (per mutation)

- **Durable queue:** 250 ms debounce → `savePending(id, {…, dirty:true})` — a
  localStorage copy carrying the current `base_version`. A dirty record is both
  the offline fallback and the reconnect outbox.
- **Server:** 1 s debounce → `PUT` with `{data, locales, base_version}`
  together (locale-only changes ride along because the locale setters go
  through `mutate()`). `AbortController` so a newer mutation supersedes an
  in-flight PUT. On success: `clearPending(id)`, advance the base `version`.
- **Failure routing:** 404 → redirect `/`. 401 → auth modal. **409 → keep the
  local edits, pause auto-save, raise `conflict`.** Network failure →
  `offline` (connectivity down) or `queued` (nominally online); the edit stays
  in the dirty queue either way.

`flushToServer` reads `data`/`mutationCount`/locales from `getState()` at call
time, so the callback isn't rebuilt on every keystroke (only `resumeId` is a
dep). Keep it that way.

## 7. Offline, reconnect drain, and conflicts

- **Connectivity** (`lib/connectivity.ts`): `navigator.onLine` + events, but
  recovery is confirmed by polling `api.health()` (NIC up ≠ server answering).
- **Reconnect drain**: on a real offline→online transition (and online boot)
  the active resume re-flushes via `flushToServer`; **every other dirty
  resume** drains via `backgroundFlush` (`selectDrainTargets`); a 409 there is
  left dirty so the conflict surfaces when that resume is next opened.
- **Conflict UX**: `ConflictModal` shows a `lib/diffResume.ts` summary and
  offers **keep mine** (re-PUT at the server's version) or **discard mine**.
  Non-blocking — the editor stays usable; the `conflict` SaveStatus badge
  re-opens it.
- **Guards**: `beforeunload` fires while `listDirty()` is non-empty; logout
  confirms before wiping unsynced work; a mid-session 401 clears plaintext
  caches only when nothing is unsynced.

## 8. Undo / redo

`useUndoRedo` subscribes to `mutationCount`, debounces 500 ms, and pushes the
**pre-mutation** snapshot to a pure `UndoHistory` (`src/lib/undoHistory.ts`).
Apply happens via `replaceData` (so the undone state saves), with a one-shot
`suppressNext` flag so the resulting bump isn't re-recorded. Burst capture (one
undo step per typing burst) lives in `UndoHistory` and is unit-tested — if you
touch undo, change `UndoHistory` and its tests, not the timing glue.

## 9. When you touch this — checklist

1. New data action? Route it through `mutate()`; return `null` for no-ops.
2. Computing a new whole store in-app? `replaceData`, never `loadStore`.
3. Added a field that should persist? Confirm it's inside `data` (or the locale
   pair) so the PUT carries it; check the boot path restores it.
4. Touched the save/boot effects? Re-verify the cache-vs-server debounce, the
   not-found-vs-offline distinction (§5), and the dirty-queue-wins boot rule —
   these are easy to invert. The boot/drain matrix is unit-tested in
   `tests/syncEngine.test.ts`; change the pure functions, not the glue.
5. Run `npm test` — `tests/store.test.ts` is the contract net:
   - every mutator bumps exactly once,
   - **no-ops do NOT bump** (the assertion that catches over-eager mutation),
   - `loadStore` resets to 0, `replaceData` bumps.
   Add a case for your action, including its no-op.

## 10. Gotcha for live verification

Auto-save can't be verified inside the Claude preview tool as-is: it injects
`PORT=5173`, which the Express server also tries to bind, colliding with Vite →
spurious save 500s. Run the server manually on 3001 to test save end-to-end
(see CLAUDE.md known quirks). Don't mistake those 500s for a code bug.
