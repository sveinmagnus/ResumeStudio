# Multi-resume support — implementation plan

Branch: `feature/multi-resume-support`
Status: planning
Tracks CLAUDE.md §12.5

## Goal

Let one Resume Studio instance hold N distinct master CVs with a switcher, not
just N Resume Views of one CV. Each resume gets its own snapshot history,
locale preferences, and URL.

## Non-goals

- Multi-tenant auth (still one API token per instance).
- Per-resume permissions or sharing.
- Cross-resume Views (a View belongs to one resume).
- Concurrent editing of the same resume from two tabs (out of scope; existing
  last-write-wins behavior carries over).

## Decisions (locked)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| 1 | "Current resume" pointer | **URL-routed (`/r/:id`)** | Adds a router; persistence hook reads id from URL; `/` shows a list/picker. Bookmarkable. Back/forward works. |
| 2 | Existing-row migration | **None — no production data yet** | The old `resume_store` table can be dropped on startup; the new schema just *is* the schema. No sentinel name, no first-boot modal — naming happens at create time in the picker like any other "Add resume" flow. |
| 3 | Backup format | **Per-resume only (BackupV1 unchanged)** | `downloadBackup()` still exports the active resume. Loading a backup → creates a new resume rather than replacing. Old v1 files load cleanly. |
| 4 | Locale scope | **Per-resume** | `primary_locale` and `secondary_locale` move from Zustand UI state to fields on the resume row (server-persisted). |
| 5 | Delete model | **Hard delete with confirm** | Confirm copy: *"This deletes all snapshots too — export a backup first if unsure."* Snapshots cascade via `ON DELETE CASCADE`. No `deleted_at`, no recovery UI. |
| 6 | Backup-file entry point | **Picker only** | The header's existing "Load file" button is removed in the multi-resume world. Backup load is always "add a new resume from this file". |
| 7 | Picker card content | **Name + last-saved only** | Metadata-only fetch (`GET /api/resumes` returns `ResumeMeta[]`). No denormalized counts, no per-card data load. Fast and obvious. |
| 8 | Router | **Custom hook, History API** | `src/lib/router.ts` + `useRoute()` hook (~50 lines, no dep). Express prod needs a catch-all to `index.html` for direct `/r/:id` hits. Vite dev already handles this. |
| 9 | UI state on resume switch | **Carry current position across** | `activeSection` and `expandedItemId` stay where they were when switching resumes. Cheapest implementation — these are already store-level Zustand fields that survive the switch automatically. If a section doesn't exist on the new resume, the editor's existing graceful-handling covers it. |
| 10 | Locale write-back transport | **Fold into the existing PUT** | `primary_locale` / `secondary_locale` travel inside the same 1 s debounced PUT that saves resume data. No new endpoint, no second debounce path. |
| 11 | Empty-state at `/` | **Inline `ImportScreen` at `/`** | When `GET /api/resumes` returns an empty list, the picker route renders the existing `ImportScreen` component. The "create" path navigates to `/r/<new-id>` instead of flipping `hasData`. Maximum reuse of working code. |

## Data model

### Server (SQLite)

Drop the single-row constraint. New shape:

```sql
CREATE TABLE resumes (
  id          TEXT PRIMARY KEY,           -- uuid
  name        TEXT NOT NULL,              -- user-given label, e.g. "Sales CV"
  data        TEXT NOT NULL,              -- JSON ResumeStore
  primary_locale    TEXT NOT NULL DEFAULT 'en',
  secondary_locale  TEXT,                 -- null = single-column mode
  saved_at    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE resume_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resume_id   TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,
  saved_at    TEXT NOT NULL
);
CREATE INDEX idx_snapshots_resume ON resume_snapshots(resume_id, id DESC);
```

Pruning still keeps the newest 50 — but **per resume**, not global.

### Client (`types/index.ts`)

`ResumeStore` itself stays the same — the store still holds one resume in
memory. New surface:

```ts
export interface ResumeMeta {
  id: string
  name: string
  saved_at: string
  primary_locale: string
  secondary_locale: string | null
}
```

The Zustand store gains:
- `currentResumeId: string | null` — which resume is loaded.
- Locale fields stay on the store **at runtime**, but are seeded from the
  resume row on load and written back on change (via existing auto-save).

## Server changes

### `server/db.ts`

The `ResumeDb` interface becomes resume-id-aware:

```ts
export interface ResumeDb {
  listResumes(): ResumeMeta[]                          // for picker
  createResume(name: string, data: unknown,
               locales: { primary: string; secondary: string | null }): ResumeMeta
  getResume(id: string): { data, meta } | null
  saveResume(id: string, data: unknown,
             locales?: { primary: string; secondary: string | null }): string
  deleteResume(id: string): boolean                    // cascades snapshots
  renameResume(id: string, name: string): void
  listSnapshots(resumeId: string): SnapshotMeta[]
  getSnapshot(resumeId: string, snapshotId: number): Record<string, unknown> | null
}
```

`saveResume` still:
- Wraps upsert + snapshot append in one transaction.
- Skips snapshot insert if identical to the last one for that resume.
- Prunes to `MAX_SNAPSHOTS` newest snapshots **scoped to `resume_id`**.

### Routes (`server/routes/resume.ts`)

Old → new:

| Old | New |
|---|---|
| `GET  /api/resume` | `GET  /api/resumes` (list metadata) |
| | `POST /api/resumes` (create — body `{name, data?, primary_locale?, secondary_locale?}`) |
| | `GET  /api/resumes/:id` (load full) |
| `PUT  /api/resume` | `PUT  /api/resumes/:id` (save full — data + locales together, per decision 10) |
| | `PATCH /api/resumes/:id` (rename only — avoids re-sending the full CV blob) |
| | `DELETE /api/resumes/:id` |
| `GET  /api/resume/snapshots` | `GET  /api/resumes/:id/snapshots` |
| `GET  /api/resume/snapshots/:sid` | `GET  /api/resumes/:id/snapshots/:sid` |

404 semantics:
- `GET /api/resumes` returns `{ resumes: [] }` (never 404) — empty list is the
  "fresh install" signal.
- `GET /api/resumes/:id` returns 404 if id unknown.

### Schema initialisation

No migration. There's no production data yet, so the new schema simply *is*
the schema. `createResumeDb()` runs `CREATE TABLE IF NOT EXISTS` for the
new `resumes` and `resume_snapshots` tables and — defensively, on startup
only — `DROP TABLE IF EXISTS resume_store` to make sure the old single-row
table can't shadow the new one if a stale DB file is lying around.

That `DROP` runs *once at boot* against any existing DB file. For dev
machines that have an old `resume_store` row, the resume just disappears on
upgrade. If that matters on a given machine, export a backup first via the
existing v1 flow before pulling the new build.

## Client changes

### Routing

Custom hook in `src/lib/router.ts` (~50 lines) — History API + `popstate`
listener + a `<Link>` component. Routes: `/`, `/r/:id`. The existing
`App.tsx` switch becomes a route table.

Express prod needs `app.get('*', ...)` to serve `index.html` for direct
`/r/:id` hits. Vite dev already handles this. If we later want shareable
view links (`/r/:id/views/:viewId`) the same hook extends — no rewrite.

### `App.tsx`

Route table replaces the current `if (!hasData) return <ImportScreen />` flow:

```
loading           → splash
auth              → AuthGate
/                 → ResumeList (picker / "Create new" / "Import from file")
/r/:id            → editor shell (loads resume by id via persistence hook)
/r/:id (unknown)  → 404 component with link back to /
```

`ImportScreen`'s role changes: it's no longer the "you have no data" gate. It
becomes a flow inside the picker — "Add resume" opens an import affordance,
which then creates a resume and routes to `/r/<new-id>`.

### `useResumePersistence`

Becomes parameterised by resume id:

```ts
useResumePersistence(resumeId: string): ResumePersistence
```

Boot sequence per id:
1. `api.loadResume(id)` instead of `api.load()`.
2. On 404, route back to `/` (the id is invalid — don't fall back to cache).
3. Local cache key becomes `resumestudio:store-cache:v1:<id>` so two resumes
   don't fight over the same slot. Picker doesn't use the cache.

Save loop: unchanged in shape; `api.save(data)` → `api.saveResume(id, data)`.

The hook also owns the locale write-back: when `primaryLocale` or
`secondaryLocale` change in the store, debounce a `PATCH /api/resumes/:id`
with just the locale fields. (Or fold them into the same PUT — simpler;
they're small.)

### `lib/api.ts`

New surface, replacing `load`/`save`:

```ts
api.listResumes(): Promise<ResumeMeta[]>
api.createResume(input: { name; data?; primary_locale?; secondary_locale? }): Promise<ResumeMeta>
api.loadResume(id): Promise<{ data: ResumeStore; meta: ResumeMeta } | null>
api.saveResume(id, data, signal?): Promise<void>
api.patchResume(id, patch: Partial<ResumeMeta>): Promise<void>
api.deleteResume(id): Promise<void>
api.listSnapshots(id): Promise<SnapshotMeta[]>
api.getSnapshot(id, snapshotId): Promise<ResumeStore>
```

Old `api.load`/`api.save` deleted (no compatibility shim — internal only).

### Store

- Add `currentResumeId: string | null` to state.
- `loadStore(store)` keeps its meaning. Add `setCurrentResumeId(id)` action.
- Locale setters trigger auto-save via mutationCount (so they round-trip to
  the server). Confirm `setPrimaryLocale`/`setSecondaryLocale` go through
  `mutate()` — today they don't, because locales were UI-only state.

### `lib/localCache.ts`

Key becomes `resumestudio:store-cache:v1:<id>`. Add a `clearAllCaches()`
that iterates `localStorage` keys with the prefix, for use on logout / token
invalidation. Migration: on first run of the new build, delete the old
unscoped `resumestudio:store-cache:v1` key (its content can't safely be
attributed to any one resume).

### `lib/backup.ts`

Stays per-resume. No format bump. One small change: `downloadBackup` already
takes a `ResumeStore` — no signature change. The filename helper should
prefer the resume's `name` (from meta) over `full_name` if both are present.

Loading a backup creates a new resume and routes to it. The header's
existing "Load file" button is removed in the multi-resume world — backup
load is picker-only (decision 6).

### UI surfaces

1. **Resume picker (`/`)** — new component `ResumeList.tsx`.
   - Card-per-resume: name, last-saved relative time, "Open" / "Delete".
   - "Add resume" button → opens existing `ImportScreen` flow inline (Start
     Fresh / CVpartner import / backup load), creates resume, navigates.
   - Empty state: identical to current `ImportScreen` directly.

2. **First-boot naming modal** — `NameResumeModal.tsx`.
   - Triggers when picker sees a resume with name `__needs_naming__`.
   - Pre-fills with `resume.full_name` if present (need a lightweight
     server-side endpoint or fetch the resume to read it; simpler to just
     auto-load the one resume and prompt with the value).
   - Submits → `PATCH /api/resumes/:id { name }`.
   - Modal blocks: user can't dismiss without naming.

3. **Resume switcher** — header dropdown next to the brand mark.
   - Shows current resume name + chevron.
   - Click → list of resumes + "All resumes…" link to `/`.
   - Switching = navigation to `/r/:other-id`.

4. **Existing UI changes:**
   - `AppHeader`: "Load file" button removed (decision 6). Brand mark gains
     the resume-switcher dropdown.
   - `SnapshotHistory` modal: queries per-resume endpoints — passes
     `currentResumeId` from store.
   - Sidebar: no change. It's section navigation within a resume.

## Test impact

Anything green in `tests/server/` that exercises route shape will break:

- `tests/server/routes.test.ts` — fully rewritten for the new URL grammar.
- `tests/server/db.test.ts` — rewritten for the new `ResumeDb` interface
  (multi-row, scoped snapshots).
- `tests/server/auth.test.ts` — unchanged (middleware doesn't know about routes).
- `tests/server/translate.test.ts` — unchanged.

New tests needed:
- DB: create/list/load/delete, snapshot scoping (resume A's snapshots
  don't leak into resume B's history), CASCADE on delete.
- DB: the one-shot migration — seed an old-shape DB, open it, assert the
  migrated state.
- Routes: full CRUD shape; 404 semantics; PATCH partial updates.
- Client: the new router; the picker (RTL); name-modal flow (RTL).
- Backup: loading a backup creates a resume + routes to it (manual or RTL).

`api.ts` tests don't exist yet — adding them now is cheap insurance against
the bigger surface area.

## Phased rollout

The whole change is multi-day. The phases are designed so each ends in a
**buildable, testable state**. Without a migration to worry about, the
server and client can be rewired in lockstep.

### Phase 1 — Server: schema + API
- New `resumes` + scoped `resume_snapshots` tables; `DROP resume_store IF
  EXISTS` defensive step.
- New `ResumeDb` interface (multi-row, scoped snapshots).
- New routes (`/api/resumes`, `:id`, snapshots) — old routes deleted.
- Tests: full rewrite of `tests/server/db.test.ts` and
  `tests/server/routes.test.ts` covering CRUD, snapshot scoping, CASCADE
  on delete, 404 semantics. Auth + translate tests unchanged.
- App is **broken in the browser at the end of Phase 1** — that's expected.
  Don't ship; carry straight into Phase 2.

### Phase 2 — Client: `api.ts` + router + picker
- `api.ts` rewritten for the new surface; old `load`/`save` deleted.
- `src/lib/router.ts` with `useRoute()` + `<Link>`. Routes wired in
  `App.tsx`.
- `useResumePersistence(resumeId)` becomes id-aware. Local cache keys
  become per-id; old unscoped cache key cleared on first run.
- `ResumeList` picker at `/`. Empty state renders `ImportScreen` inline.
- Header switcher dropdown. Existing "Load file" button removed.
- Resume creation flow: `POST /api/resumes` → navigate to `/r/<new-id>`.
- Tests: new `tests/api.test.ts` covering every endpoint; component tests
  for `ResumeList` and the switcher.

### Phase 3 — Polish + docs
- Delete confirm modal copy + flow.
- Per-resume locales round-tripped (seeded on load, written in PUT body).
- CLAUDE.md updates: §1 "What works", §3 architecture map, §8
  "Persistence" (route grammar + per-id cache keys), §11 "Server / env",
  §12 (delete §12.5).
- Manual verification sweep of every flow in CLAUDE.md §1.

## Open questions

None remaining — all design questions are folded into the Decisions table
above. Anything that surfaces during implementation gets caught either by
the typechecker or by the rewritten server-test suite.

## Risks

- **Snapshot scope regression.** A bug where snapshot pruning drops the
  wrong resume's history is hard to recover from. Mitigation: dedicated
  test that creates two resumes, generates >50 saves on resume A, asserts
  resume B's snapshots are untouched.

- **Server test rewrite.** Existing route tests are useful regression
  coverage — rewriting them risks losing edge cases (401 on empty token,
  body validation, etc.). Mitigation: rewrite as **rename-then-edit**, not
  delete-and-restart; copy the asserts forward.

- **Bundle growth.** A router dep is the most likely culprit. Mitigation:
  start with the custom-router option; measure with `npm run build`.

- **URL routing in production.** Express needs a catch-all for client-side
  routes. If a user bookmarks `/r/abc-uuid` and hits the server directly,
  Express needs to serve `index.html`, not 404. Verify with `npm run
  preview` and a hand-typed URL.

## Files touched (estimate)

Server: `db.ts`, `routes/resume.ts`, `app.ts` (catch-all for client routes).
Client: `App.tsx`, `lib/api.ts`, `lib/router.ts` (new), `lib/localCache.ts`,
`store/useStore.ts`, `store/useResumePersistence.ts`,
`components/ImportScreen.tsx`, `components/AppHeader.tsx`,
`components/SnapshotHistory.tsx`, `components/ResumeList.tsx` (new),
`components/layout/Sidebar.tsx` (maybe — switcher placement TBD).
Tests: full `tests/server/db.test.ts` + `tests/server/routes.test.ts`
rewrite; new `tests/api.test.ts`; new component specs for picker +
switcher.
Docs: CLAUDE.md §1, §3 (architecture map), §7 (mention `ResumeMeta`), §8
(persistence section), §11 (env), §12 (delete §12.5).

## Next step

Start Phase 1: write the new `createResumeDb` against `':memory:'`, drive
it from a rewritten `tests/server/db.test.ts`, then rewrite the routes and
their tests on top. Phase 1 is server-only and produces a building, fully
tested server with a broken browser UI — Phase 2 picks up immediately.
