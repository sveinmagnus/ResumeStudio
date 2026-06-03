# Offline editing — implementation plan

Status: planning
Tracks CLAUDE.md §12.5
Builds on the persistence core (§8) and the multi-resume work (`plans/multi-resume.md`).

## Goal

Make local edits **durable and conflict-safe**:

1. **Durability + reconnect** — edits survive an outage / crash / closed laptop
   in a per-resume durable queue, and auto-drain to the server when
   connectivity returns. (Today's cache is a best-effort snapshot, overwritten
   on the next load — no queue, no reconnect drain.)
2. **Conflict safety** — each resume is versioned server-side, so a queued save
   detects "this resume changed elsewhere" (another tab or device) and refuses
   to silently clobber, surfacing a **keep / discard + diff** resolution step.

Closing the loop: once edits are provably durable in the queue and the user is
warned before losing them, the transient-401 path can clear the plaintext
`localStorage` cache safely — closing security-review residual §4.

## Non-goals (explicitly out of scope)

- **Offline app *load* (PWA / service worker).** The app still needs network to
  first boot; we're making *editing* offline-safe, not the shell offline-
  available. (This was Tier 3; not chosen.)
- **Automatic field-level merge.** Conflicts are resolved by the user choosing
  keep-mine or discard-mine, informed by a diff — not auto-merged. A three-way
  merge over the registries / embedded arrays / sort_order is its own project
  and risks silent corruption.
- **Per-operation oplog / CRDT.** The save model is whole-document PUT; the
  durable unit is the latest dirty document, not a log of field ops.
- **Cross-tab coordination (BroadcastChannel).** Two tabs in the same browser
  share one `localStorage` slot; the server version check is the correctness
  backstop, but we don't actively coordinate tabs in v1 (noted under Risks).

## Decisions (locked)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| 1 | Scope | **Tier 2: durability + reconnect + conflict safety** | No service worker. Editing is offline-safe; the shell still needs network to load. |
| 2 | Conflict mechanism | **Integer `version` column + optimistic concurrency** | Each save bumps `version`; a save carrying a stale base version is rejected. Cleaner than `saved_at`-as-etag (no clock-resolution ties) or content hashing. |
| 3 | Concurrency token transport | **`base_version` in the PUT body** | Rides alongside `data`/locales in the existing JSON body (symmetric with how locales already travel). `GET` also exposes it in `meta` + an `ETag` header for good measure. Avoids `If-Match` header-parsing nuances. |
| 4 | Conflict UX | **Keep / discard + diff panel** | A `ConflictModal` shows a section/field-level summary of what differs, then the user picks keep-mine (re-PUT at the new base) or discard-mine (take server). Needs a pure `lib/diffResume.ts`. |
| 5 | Queue model | **Whole-document pending record (one slot per resume)** | Extends the per-id cache with `{base_version, dirty, dirty_since}`. Not a per-op log. |
| 6 | Drain policy | **Auto-drain the active resume on reconnect; other dirty resumes drain on next open** | The in-memory store holds one resume; resolving a conflict needs the editor on that resume. Background-draining a *non-active* resume that conflicts has nowhere to show the diff, so we defer it to next visit. The guard counts total unsynced. |
| 7 | Unsynced UI | **SaveStatus states + navigation/logout guard** (no picker dots) | New SaveStatus states for offline/queued/conflict; a `beforeunload` guard and a logout confirm. No per-card markers in the picker. |
| 8 | Online detection | **`navigator.onLine` + `online`/`offline` events + a health-poll fallback** | `navigator.onLine` only knows NIC state, not server reachability — poll `api.health()` while "offline" to detect real recovery. |

## Data model

### Server (`resumes` table)

Add one column:

```sql
ALTER TABLE resumes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
```

`CREATE TABLE IF NOT EXISTS` won't add a column to an existing table, so
`createResumeDb` needs a tiny in-code migration: `PRAGMA table_info(resumes)` →
if `version` is absent, run the `ALTER TABLE`. (Unlike the multi-resume work,
real data may now exist, so this must be additive, not a drop.)

`version` starts at 1 on create and increments by 1 on every successful save.

### Client types

```ts
// api.ts — meta gains version
interface ResumeMeta { …; version: number }

// localCache.ts — the per-id record gains queue fields
interface PendingRecord {
  data: ResumeStore
  locales: { primary: string; secondary: string | null }
  base_version: number    // the server version this edit was derived from
  dirty: boolean          // unsynced changes present
  dirty_since: string     // ISO; for the "N unsynced" + guard messaging
  saved_at: string        // last local write
}
```

## Server changes

### `server/db.ts`
- Migration: add `version` if missing (see above).
- `getResume(id)` → include `version` in the returned `meta`.
- `createResume(...)` → seed `version = 1`.
- `saveResume(id, data, locales?, expectedVersion?)`:
  - If `expectedVersion` is supplied **and** ≠ the row's current `version`:
    return a **conflict result** (`{ conflict: true, current: ResumeFull }`)
    and write nothing.
  - Otherwise: write, `version = version + 1`, append snapshot (unchanged),
    return `{ saved_at, version }`.
  - When `expectedVersion` is omitted (legacy/forced overwrite) → write
    unconditionally (used by "keep my version" after the user resolves).
- All inside the existing transaction so the version, row, and snapshot never
  diverge.

### `server/routes/resume.ts`
- `PUT /api/resumes/:id`: read optional `base_version` from the body.
  - Conflict → **409** with `{ error, current: { data, meta } }` so the client
    can diff without a second round-trip.
  - Success → `{ ok: true, saved_at, version }`, and set `ETag: "<version>"`.
- `GET /api/resumes/:id`: `meta.version` + `ETag` header.
- Validation: `base_version`, if present, must be a non-negative integer (400
  otherwise).

## Client changes

### `lib/api.ts`
- New `ConflictError extends Error` carrying `current: { data, meta }`.
- `loadResume` → meta includes `version`.
- `saveResume(id, data, locales?, baseVersion?, signal?)`:
  - Send `base_version` when provided.
  - **409 → throw `ConflictError`** with the parsed `current`.
  - Success → return `{ saved_at, version }` (callers track the new base).

### `lib/localCache.ts` → durable queue
- Evolve the record to `PendingRecord` (above). New surface:
  `loadPending(id)`, `savePending(id, rec)`, `markClean(id)` / `clearPending(id)`,
  and **`listDirty(): {id, dirty_since}[]`** (prefix-scan, for the drain set +
  the guard count). Keep `clearAllCaches`/`dropLegacyCache`.
- Migration of the existing `{saved_at, data}` shape: treat a record missing the
  new fields as `dirty:false, base_version:0` (it'll re-sync cleanly).

### `lib/connectivity.ts` (new, pure-ish)
- `subscribeOnline(cb)`, `isOnline()`. Driven by `online`/`offline` events; when
  offline, poll `api.health()` on an interval to catch real recovery (NIC-up ≠
  server-reachable). Exposes a single source of truth the hook subscribes to.
- Pure core (the transition state machine) unit-tested with fake timers +
  stubbed `navigator.onLine`/health.

### `lib/diffResume.ts` (new, PURE)
- `diffStores(mine, theirs): ResumeDiff` — section-level added/removed/changed
  counts plus a handful of notable field-level diffs (e.g. `resume.title`
  yours-vs-theirs). Consumed by `ConflictModal`. Table-tested (this is exactly
  the "extract tricky logic to a pure lib" altitude the testing skill wants).

### `store/useResumePersistence.ts` — the orchestration
This is where it comes together. The hook keeps its shape but gains:
- **Base-version tracking**: hold the current server `version` in a ref; seed it
  from `loadResume`, update it on every successful save, and on a "discard mine"
  resolve.
- **Queue writes**: the 250 ms cache write becomes `savePending(id, {data,
  locales, base_version, dirty:true, …})`. On successful server flush →
  `markClean(id)`.
- **`flushToServer`** sends `base_version`; on `ConflictError` it sets a
  `conflict` state `{ mine, theirs }` (no auto-retry) and stops the debounce
  loop until resolved.
- **Boot**: if `loadPending(id)` shows a dirty record while the server is
  reachable, attempt to flush it (with its stored `base_version`) *before*
  trusting the server copy — so unsynced offline work isn't silently dropped on
  the next online load. A conflict there opens the modal.
- **Reconnect drain**: subscribe to `connectivity`; on offline→online, flush the
  active resume's pending record.
- **Resolution actions** (passed to `ConflictModal`):
  - *Keep mine* → `saveResume(id, mine, locales, theirs.version)` (re-PUT at the
    server's new version → clean overwrite), then `markClean`.
  - *Discard mine* → `loadStore(theirs.data, locales)`, `clearPending(id)`,
    base-version = theirs.version.

> Per the testing skill, extract the queue-drain + conflict decision into a
> pure helper (`lib/syncEngine.ts`?) that takes (pending, serverState, online)
> and returns an action, so the timing-tangled hook stays thin and the rules
> are unit-testable without a live server.

### UI

1. **`SaveStatus` new states.** Extend `SaveState`:
   - `offline` → keep, but reword to "Offline — saved locally".
   - `queued` → "N unsynced change(s)" (server reachable, drain pending/failed).
   - `conflict` → "Changed elsewhere — resolve" (click opens the modal).
   The component already has the icon/variant pattern; add three variants.

2. **`ConflictModal` (new).** Renders the `diffResume` summary + [Keep my
   version] / [Discard mine]. Modeled on `SnapshotHistory` (overlay + actions).
   Mounted by the editor when persistence reports a `conflict`.

3. **Guards.**
   - **`beforeunload`**: when `listDirty()` is non-empty, the browser's
     "leave site?" prompt fires (prevents losing unsynced work on tab close).
   - **Logout** (`AuthGate` "Clear saved token"): if `listDirty()` is non-empty,
     confirm "You have N unsynced change(s) — export a backup first?" before
     `clearAllCaches()`.
   - **Transient 401** (`App`/`useResumePersistence`): on a mid-session 401,
     if the queue is empty → `clearAllCaches()`; if non-empty → keep the cache,
     surface the auth modal, and clear only after the user re-auths and the
     queue drains. **This closes security residual §4.**

## Test impact

New / changed coverage (testing skill: pin contracts, assert no-ops, mock at
the boundary, table-drive the diff):

- **Server `db`**: version starts at 1; bumps on save; `saveResume` with a stale
  `expectedVersion` returns a conflict and writes nothing; omitted version
  force-writes; snapshot still appended on the winning write.
- **Server `routes`**: PUT with stale `base_version` → 409 + `current`; PUT with
  matching version → 200 + new version + `ETag`; GET exposes version/ETag; bad
  `base_version` → 400.
- **`api`**: 409 → `ConflictError` carrying `current`; success returns the new
  version; `base_version` is sent only when provided.
- **`diffResume`** (pure, table-driven): added/removed/changed per section;
  field-level notable diffs; identical stores → empty diff.
- **`connectivity`** (fake timers): offline→online transition fires; health-poll
  recovery while `navigator.onLine` is wrong.
- **`localCache`/queue**: pending round-trip with version; `listDirty` across ids;
  legacy record migrates to `dirty:false`.
- **`syncEngine`** (pure): drain decision matrix (clean/dirty × online/offline ×
  conflict).
- **Components (RTL)**: `ConflictModal` keep/discard wiring; `SaveStatus` new
  states; the logout guard confirms before wiping when dirty.

## Phased rollout

Each phase ends buildable + tested.

### Phase 1 — Server versioning (backward-compatible)
Add the `version` column + migration, conflict-aware `saveResume`, 409 on the
route, version/ETag on GET. With `base_version` optional, the existing client
keeps working (force-write path). Server tests rewritten/extended.

### Phase 2 — Client concurrency plumbing
`ConflictError`, `loadResume` version, `saveResume` base_version. Hook tracks
the base version and sends it; on conflict, **for now** auto-resolve
"server-wins-then-reapply-is-deferred" → actually just surface a placeholder
`conflict` state (modal comes in Phase 4). App still works online.

### Phase 3 — Durable queue + reconnect
`localCache` → pending record; `connectivity` module; boot-flush of a dirty
record; offline→online drain of the active resume; `syncEngine` pure helper.
SaveStatus gains `offline`/`queued`. Closes the durability half.

### Phase 4 — Conflict UX + guards + security close
`diffResume`, `ConflictModal`, SaveStatus `conflict` state, `beforeunload` +
logout guards, and the transient-401 cache-clear logic (residual §4 closed).

### Phase 5 — Docs + sweep
CLAUDE.md §8 (persistence: queue + versioning + conflict flow), §11 (ETag/
version note), retire §12.5. Manual verification of the offline→edit→reconnect
and the two-tab conflict flows.

## Risks

- **Base-version bookkeeping is load-bearing.** A stale or mistracked base
  version means either false conflicts (annoying) or silent overwrites (data
  loss). It must be updated on: load, successful save, snapshot restore (a
  restore is a `replaceData` mutation → it'll re-save and bump), and "discard
  mine". Cover each path with a test.
- **`navigator.onLine` lies.** Mitigated by the health-poll fallback; don't
  trust the event alone to declare "back online".
- **Two tabs, same browser.** They share the `localStorage` pending slot and
  could interleave writes. The server `version` check prevents *server* clobber
  (the second tab's flush 409s), but the shared slot can still confuse local
  state. v1 accepts this; a `BroadcastChannel` lock is a follow-up. Document it.
- **Restore + offline interplay.** A snapshot restore while offline is just
  another dirty mutation; it queues and drains like any edit. Verify it doesn't
  double-count or lose the base version.
- **Guard fatigue.** `beforeunload` prompts are blunt — only arm it when
  `listDirty()` is actually non-empty, and disarm immediately after a successful
  drain, or users will learn to dismiss it.

## Resolved questions

Both resolved in favour of **non-blocking** behaviour:

1. **Non-active dirty resumes on reconnect** — **deferred to next open** (not
   background-flushed). The reconnect drain only touches the active resume; a
   dirty record for some other resume stays queued and drains (and resolves any
   conflict) the next time the user opens that resume. The nav/logout guard
   still counts it in the total unsynced. Matches "no picker dots" and keeps
   reconnect cheap.
2. **Conflict during boot-flush** — **non-blocking**: load the server copy into
   the editor and raise the `conflict` SaveStatus state (which opens the modal
   on click). No modal is forced over the loading screen; the user lands in a
   working editor and resolves when ready. The dirty pending record is retained
   until they resolve, so "keep mine" is still possible.

## Files touched (estimate)

Server: `db.ts` (version + migration + conflict), `routes/resume.ts` (409/ETag).
Client: `lib/api.ts` (ConflictError, version, base_version), `lib/localCache.ts`
(pending queue + listDirty), `lib/connectivity.ts` (new), `lib/diffResume.ts`
(new), `lib/syncEngine.ts` (new), `store/useResumePersistence.ts` (orchestration),
`components/layout/SaveStatus.tsx` (states), `components/ConflictModal.tsx` (new),
`components/AuthGate.tsx` (logout guard), `App.tsx` / editor (mount modal,
beforeunload).
Tests: server `db`/`routes`; new `api`/`diffResume`/`connectivity`/`syncEngine`/
queue tests; `ConflictModal` + `SaveStatus` RTL.
Docs: CLAUDE.md §8, §11, §12.

## Next step

Start Phase 1: the `version` column + migration + conflict-aware `saveResume`,
driven by rewritten `tests/server/db.test.ts`, then the 409/ETag route + tests.
Backward-compatible, so it can land before any client work.
