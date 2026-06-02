# Resume Studio — Project Guide for Claude Code

This file is read on every session. Read it first before touching code.

---

## 1. What this is

A web app that lets a consultant maintain **one master resume across multiple
languages** and extract **targeted variants** (Resume Views) for different
audiences. The project was scaffolded conversationally and is being continued
in Claude Code.

**Core promise:** the consultant edits once (in the language they choose), can
view/edit any field in two languages side-by-side, and exports polished `.docx`
or `.pdf` files via a Resume View — a curated subset of the master CV.

### State of the codebase

What works today:
- **Auto-save** to an Express + SQLite backend (debounced ~1s), with a
  **localStorage fallback** so a server outage never costs work.
- **Auth-gated server** (token-based, see `.env.example`); falls back to a
  local-only mode if the server is unreachable.
- **Targeted exports via Resume Views** — pick sections, exclude items,
  starred-only filter, custom intro, then export PDF (browser print pipeline)
  or DOCX (lazy-loaded docx lib). A **live preview pane** in the view editor
  re-renders the document as you tune it (iframe + page-count estimate).
- **CVpartner JSON import** and **portable JSON backup** (export + load) with
  a versioned format and a migration scaffold.
- **Translation assist** on every `DualField` secondary input: "Copy from
  primary" (no network) plus an optional "Draft translation" that proxies
  through the server to a self-hosted LibreTranslate instance (drafts are
  review-required). The Draft button only appears when the server reports a
  backend is configured (`LIBRETRANSLATE_URL`). See §8.
- **Server-side snapshot history** — every save appends a snapshot
  (deduped, last 50 kept); the header's **History** button restores any of
  them. See §8.
- **Undo / redo** (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) with debounced history.
- **Drag-and-drop reordering** (`@dnd-kit`) on every section that owns a
  `sort_order`; up/down arrow buttons kept for keyboard / accessibility.
- **Registry merge** — "Merge this skill/role into…" rewrites every reference
  and deletes the source.
- **React error boundary** around the editor so a crashed view never traps the
  user.

What's intentionally simple:
- The server stores **exactly one resume** (single-row table with a CHECK
  constraint). This is by design — the deployment model is one instance per
  consultant.
- Styling is **inline `<style>` blocks per component** + CSS custom properties
  in `src/index.css`. No Tailwind, no CSS-in-JS lib.

What's still on the wishlist: see section 12.

---

## 2. Stack and conventions

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite 5 | `npm run dev` / `npm run build` / `npm run preview` |
| Framework | React 18 + TypeScript | Strict mode on |
| State | Zustand (single store) | See `src/store/useStore.ts` |
| Persistence | Express + better-sqlite3 (single-row table) | See `server/`. localStorage fallback in `lib/localCache.ts` |
| Tests | Vitest (+ jsdom for browser-tied tests) | `npm test`, `npm run test:watch`, `npm run test:coverage` |
| Icons | lucide-react | **Tree-shaken**: import each icon by name, never `import * as` |
| DOCX export | `docx` npm package | **Lazy-loaded** (~352 kB chunk) — only fetched when the user clicks Export DOCX |
| PDF export | Browser print pipeline | HTML → `window.print()` → system Save-as-PDF |
| Drag-and-drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Pointer + keyboard sensors |
| Styling | Inline `<style>` blocks per component + CSS custom properties in `src/index.css` | No Tailwind, no CSS-in-JS lib — keep it that way |

### Code style rules
- **TypeScript strict mode.** `npm run typecheck` covers client + server.
- **No `any`** unless interfacing with truly unknown shapes (e.g. raw imported JSON). Use `unknown` then narrow.
- **No default exports** for components — use named exports. (`main.tsx` and `App.tsx` are the only existing default exports; new components are named.)
- **Inline styles via `<style>` tag inside the component.** Each component owns its CSS. Tokens come from `src/index.css` (see section 6). The only utility classes in `index.css` are widely-shared widgets (currently just `.check-row`).
- **Lucide icons must be imported by name**, e.g. `import { Star, ChevronDown } from 'lucide-react'`. Do not import `* as Icons` — it breaks tree-shaking and bloats the bundle by ~700 kB.
- **No `process.env` at runtime in the client.** This is a pure browser app once it leaves Vite. The Express server is the only place that reads env vars.
- **Run `npm run build` after substantial changes** — Vite's prod build catches issues `tsc --noEmit` misses (missing exports from third-party packages, dynamic import problems).
- **Run `npm test` before committing.** CI also runs typecheck + test + build (`.github/workflows/ci.yml`).

### Naming
- Files: `PascalCase.tsx` for components, `camelCase.ts` for libraries.
- Types: `PascalCase`, no `I` prefix.
- Store actions: imperative verbs (`addItem`, `updateItem`, `moveItem`, `replaceData`).
- Locale codes follow CVpartner where compatible: `en`, `no`, `se`, `dk`. The original `int` is normalized to `en` on import.

---

## 3. Architecture map

```
src/
├── types/index.ts              ← single source of truth for the data model
├── store/
│   ├── useStore.ts             ← Zustand store + generic CRUD actions
│   ├── useUndoRedo.ts          ← Undo/redo hook (Ctrl/Cmd+Z), subscribes to mutationCount
│   ├── useResumePersistence.ts ← Boot load + auto-save orchestration (effects + refs), submitToken, loadFile
│   └── useTranslation.ts       ← useTranslationAvailable() — memoized "is translate configured?" probe
├── lib/
│   ├── api.ts                  ← Server client (load/save, snapshots, translate; AbortSignal, token auth)
│   ├── backup.ts               ← Portable JSON backup format + migrateBackup() scaffold
│   ├── completeness.ts         ← PURE: translation completeness % + missing field paths per locale
│   ├── exporter.ts             ← LAZY-LOADED .docx generation (Cartavio brand, A4)
│   ├── importer.ts             ← CVpartner JSON → ResumeStore
│   ├── localCache.ts           ← localStorage fallback (debounced via useResumePersistence)
│   ├── locales.ts              ← LOCALE_LABELS, resolve(), fmt*(), fmtRelativeTime(), detectLocalesInData(), sortLocales()
│   ├── merge.ts                ← mergeSkills / mergeRoles + reference counts
│   ├── sections.ts             ← Sidebar section definitions and groups
│   ├── translateClient.ts      ← PURE: app→service locale map, canDraftBetween(), memoized availability probe
│   └── viewFilter.ts           ← Apply a ResumeView (sections, exclusions, starred); buildViewHtml() for PDF
├── components/
│   ├── ErrorBoundary.tsx       ← Wraps the editor; resets on activeSection change
│   ├── ImportScreen.tsx        ← Landing screen (drop CVpartner JSON / backup, or Start Fresh)
│   ├── AuthGate.tsx            ← Token-entry modal shown on 401 (onSubmit → persistence hook)
│   ├── SnapshotHistory.tsx     ← Version-history modal: list snapshots, restore via replaceData
│   ├── AppHeader.tsx           ← Editor top bar: SaveStatus, undo/redo, LanguageSwitcher, History, load/save-file
│   ├── layout/
│   │   ├── Sidebar.tsx         ← Section navigation
│   │   ├── LanguageSwitcher.tsx ← Primary/secondary locale + "re-detect" button
│   │   └── SaveStatus.tsx      ← Saving / Saved / Save failed / Local only / idle
│   ├── ui/
│   │   ├── DualField.tsx       ← THE KEY COMPONENT — side-by-side localized input
│   │   ├── EditorCard.tsx      ← Collapsible card; drag handle + up/down arrows (via `sortable` prop)
│   │   ├── Fields.tsx          ← TextField, DateField, TagField (plain inputs)
│   │   └── SortableList.tsx    ← DndContext + SortableContext wrapper (calls store.moveItem on drop)
│   └── editor/
│       ├── Overview.tsx        ← Dashboard with stats + translation %
│       ├── HeaderEditor.tsx    ← Personal details
│       ├── ProjectsEditor.tsx  ← Edit mode for projects (the richest editor)
│       ├── SimpleEditors.tsx   ← Work/Education/Courses/Certs/Positions/Presentations/Publications/Awards/Languages/Profile
│       ├── RegistryEditors.tsx ← Skill/Role/Reference/TechCat editors + Merge UI
│       └── ResumeViewsEditor.tsx ← View list + view editor (sections, items, options, Export PDF / Export DOCX)
├── App.tsx                     ← Routing only: picks load splash / AuthGate / ImportScreen / editor shell
├── main.tsx                    ← React entry
└── index.css                   ← Design tokens + body/scrollbar/animations + .check-row utility

server/                         ← Express API + SQLite persistence
├── index.ts                    ← Bootstrap: createApp() + app.listen()
├── app.ts                      ← createApp(): security headers, json, routers (no listen — tests use this)
├── auth.ts                     ← Bearer-token middleware (env: RESUME_API_TOKEN, read lazily), constant-time compare
├── db.ts                       ← createResumeDb(path) factory + lazy singleton (env: RESUME_DB_PATH); resume_store + resume_snapshots (last 50, deduped)
├── translate.ts               ← LibreTranslate proxy: locale map, fetch w/ timeout (env: LIBRETRANSLATE_URL/_API_KEY, read lazily)
└── routes/
    ├── resume.ts               ← GET / PUT /api/resume; GET /api/resume/snapshots(/:id)
    └── translate.ts            ← GET /api/translate/status, POST /api/translate

tests/                          ← Vitest specs (349 tests at last count)
├── fixtures.ts                 ← Shared makeProject() / makeRole() / ... factories
├── setup-rtl.ts                ← jest-dom matchers + afterEach(cleanup) for component tests
├── helpers/store-reset.ts      ← resetStore() — restores the singleton store between component tests
├── backup.test.ts, completeness.test.ts, exporter.test.ts,
├── importer.test.ts, localCache.test.ts, locales.test.ts,
├── merge.test.ts, store.test.ts, translateClient.test.ts, viewFilter.test.ts
├── components/                 ← RTL tests (.test.tsx, jsdom) for every editor (Header/Projects/Registry/Simple/
│                                  ResumeViews/Overview), shell (AppHeader/Sidebar/AuthGate/ImportScreen/
│                                  LanguageSwitcher/SaveStatus/ErrorBoundary/SnapshotHistory) + ui (DualField/Fields/EditorCard/SortableList)
└── server/                     ← db, translate, auth (direct) + routes (supertest over createApp()), node env
```

### Layered design — these layers must stay clean
1. **`types/`** has zero runtime imports. Pure type definitions.
2. **`lib/`** is pure logic. No React. The only DOM touchers are `exporter.ts` (download anchor), `viewFilter.ts` (string-builds HTML), and `localCache.ts` (localStorage). Each is easy to unit-test (see `tests/`).
3. **`store/`** owns mutable state. Only place where data lives.
4. **`components/`** read from the store and call store actions. **No business logic in components — if a computation is more than one line, it goes in `lib/`** (see `lib/completeness.ts` for an example of moving computation out of a component).

If you're tempted to put computation in a component file, add a function to `lib/` instead.

---

## 4. The data model — read this carefully

The data model was carefully designed across several iterations. Don't change shapes without considering the consequences.

### Localization
Every translatable field is a `LocalizedString = Record<string, string>` keyed by locale. Resolution chain (in `lib/locales.ts` → `resolve()`):
1. Requested locale
2. Fallback locale (default `"en"`)
3. First non-empty value (skips empty strings — see the bug fixed in commit `3da1b99`)

**Never** check `value[locale]` directly in components — always go through `resolve()` so the fallback chain works.

### Dates
- `YearMonth = { year: number, month: number | null }` — month-precision, not full dates. `month: null` means only year is known.
- `end: null` on date ranges means ongoing.

### Shared registries
- **`Skill`** lives in a global registry (`data.skills`) and is referenced by `ProjectSkill` (on `Project`) and `CategorySkill` (on `TechnologyCategory`) via `skill_id`. Use `lib/merge.ts → countSkillReferences()` to count all references.
- **`Role`** also lives in a global registry (`data.roles`). `ProjectRole` references it via `role_id`. Use `countRoleReferences()`.
- **Snapshot names**: `ProjectSkill.name`, `CategorySkill.name`, and `ProjectRole.name` are denormalized copies of the registry's name at link time, so a registry rename doesn't silently rewrite history. `merge.ts` updates these snapshots when it rewrites references.

### Resume Views
`ResumeView` (in `data.views`) is the "targeted resume" config: a name, an introduction (localized), a list of enabled sections in display order, an excluded-items list, a starred-only toggle, and an optional page limit. `lib/viewFilter.ts → applyView()` produces a filtered `ResumeStore` from a view; the exporter and HTML renderer consume the filtered store.

### What's an entity vs. an embedded array
- Tables (`projects`, `educations`, `courses`, etc.) live as top-level arrays in `ResumeStore`.
- Sub-collections that are tightly bound to a parent (a project's roles, a project's skills, a key qualification's bullet points, a tech category's skills) are **embedded arrays** on the parent entity. Don't promote these to top-level tables.

### Disabled vs. starred
- `disabled: true` excludes from all exports and overview lists. Used to soft-delete.
- `starred: true` is featured/highlighted ordering. Used by `ResumeView.starred_only`.

---

## 5. Multi-language UI — the dual-view pattern

The single most important UX requirement: **every translatable field renders as two inputs side-by-side**, primary language on the left, secondary on the right. The user can:
- Pick which two locales are visible (independent of which locales the master resume supports).
- Swap them with one click.
- Hide the secondary column to focus on one language.
- **Re-detect locales** from the data — `LanguageSwitcher`'s refresh button calls `detectAndSetLocales()` which scans every `LocalizedString` and merges any new locales into `resume.supported_locales`.

**Implementation:**
- `useStore().primaryLocale` and `useStore().secondaryLocale` (the latter can be `null` to mean "single column mode").
- The `DualField` component reads these directly and renders 1 or 2 inputs accordingly. Components calling `DualField` never need to know about locales — just pass the `LocalizedString` and a setter.
- The secondary input gets a subtle cyan tint (CSS var `--secondary-tint`) to distinguish from the primary (which uses the Cartavio navy accent on focus).
- The secondary column carries two **translation-assist** affordances:
  **Copy** (fills the secondary with the primary text, no network) and, when a
  LibreTranslate backend is configured, **Draft** (server-proxied machine
  draft, marked "review required"). See §8 → *Translation assist*. Editing the
  secondary input clears the draft annotation. Both are pure UX sugar on top of
  the same `onChange` — nothing else needs to know about them.

**Rule:** Every component that touches a `LocalizedString` must use `DualField`. Never render a single text input bound to one locale.

---

## 6. Design tokens and styling

CSS custom properties in `src/index.css` are the design system:

```css
--paper, --paper-raised, --paper-sunken    /* backgrounds */
--ink, --ink-soft, --ink-faint             /* text */
--line, --line-strong                      /* borders */
--accent (#002E6E), --accent-bright, --accent-wash  /* Cartavio navy (verified from live site) */
--secondary-tint, --secondary-line, --secondary-ink /* Cartavio cyan #00B8DE, for secondary locale */
--gold (#9a7b3f)                           /* star/featured indicator */
--serif: 'Open Sans Condensed' weight 300  /* heading font — matches cartavio.no */
--sans: 'Ubuntu' + system                  /* body font — matches cartavio.no */
--r-sm/--r-md/--r-lg                       /* border radii */
--shadow-sm/-md/-lg
```

**Aesthetic:** Cartavio brand — pure white backgrounds, Cartavio navy (#002E6E) as the primary accent, cyan (#00B8DE) as the secondary/highlight. Open Sans Condensed (weight 300) for headings, Ubuntu for body. Colors and fonts verified directly from cartavio.no CSS. No warm/sepia tones, no oxblood. Brand skill: `.claude/skills/cartavio-brand.md`.

**Utility classes in `index.css`** (use these instead of redefining inline):
- `.check-row` — inline checkbox + label row.

When adding a component, copy the inline `<style>` pattern from an existing one (e.g. `DualField.tsx`). Use the tokens, don't introduce new colors casually.

---

## 7. The store — patterns to follow

### Reading
```ts
const data = useStore(s => s.data)
const projects = useStore(s => s.data.projects)
```

### Generic CRUD (use these — don't write custom mutations per section)
```ts
const { addItem, updateItem, removeItem, moveItem, reorderItem } = useStore()

addItem('projects', newProject)                          // appends + opens
updateItem('projects', projectId, { customer: localized }) // shallow merge
removeItem('projects', projectId)                        // no-op if id unknown
moveItem('projects', projectId, toIndex)                 // drag-and-drop target
reorderItem('projects', projectId, 'up' | 'down')        // keyboard fallback (thin wrapper over moveItem)
```

The generic functions are typed: `updateItem('projects', id, { customer: ... })` will autocomplete to the fields of `Project`. Use them rather than writing one-off mutations.

### Two flavours of "replace all data"

This distinction is critical — choose the right one:

- **`loadStore(store)`** — I/O semantics. Use for **loading** data from the
  server or a file. Resets `mutationCount` to 0 (so no spurious auto-save fires
  and undo history starts fresh).
- **`replaceData(store)`** — in-app rewrite semantics. Use when you've
  **computed** a new store and want it treated as a user mutation. Bumps
  `mutationCount`, which means: auto-save will sync it, undo/redo will see it.
  Currently used by `useUndoRedo` and by the registry merge handlers.

If you call `loadStore` for an in-app rewrite, the change will silently never
enter the undo stack and may not be saved.

### `mutationCount` and the `mutate()` helper

The store maintains a `mutationCount: number` that increments on every USER
mutation and resets on `loadStore`/`loadFromCVPartner`/`startFresh`. Auto-save
compares it to a "last saved" ref to decide whether to fire.

Every mutating action funnels through a private `mutate()` helper inside the
store that auto-bumps the counter — **new actions should use it too** rather
than calling `set()` directly. Return `null` from the updater for a no-op
(e.g. unknown id) so the counter doesn't bump for changes the user can't see.

### Navigation
- `setActiveSection(key)` to switch sidebar section (resets `expandedItemId`).
- `setExpandedItem(id)` to toggle an `EditorCard` open/closed.

### Undo / redo
- `useUndoRedo()` (in `src/store/useUndoRedo.ts`) is a hook consumed by `AppHeader` (which renders the undo/redo buttons and owns the keyboard shortcuts).
- Subscribes to `mutationCount` changes, debounces 500 ms, pushes the
  pre-mutation snapshot to a past stack capped at 100.
- Undo/redo apply snapshots via `replaceData` and use a one-shot `suppressNext`
  flag so the subscriber doesn't re-push the undo as a fresh mutation.

### Adding a new section
1. Add the array to `ResumeStore` in `types/index.ts`.
2. Add the empty array to `emptyStore` in `useStore.ts`.
3. Add an entry to `SECTIONS` in `lib/sections.ts`.
4. Add the icon import to `Sidebar.tsx`'s `ICON_MAP`.
5. Create the editor component and wire it into `App.tsx`'s router.
6. If the section has `sort_order`, wrap its `<EditorCard>`s in a `<SortableList section="…" ids={items.map(x=>x.id)}>`. If it doesn't, pass `sortable={false}` to each `<EditorCard>` so the drag handle isn't shown.
7. If it should appear in Resume View exports: add a `case` to both
   `lib/viewFilter.ts → renderItem` (HTML/PDF path) and `lib/exporter.ts →
   renderSection` (DOCX path). Also extend `getItemTitle`/`getItemSubtitle`
   in `viewFilter.ts` for the View-editor item list.

---

## 8. Persistence

### Architecture
- **Source of truth**: SQLite via the Express server (`server/db.ts`).
- **Cache**: localStorage (`lib/localCache.ts`, key `resumestudio:store-cache:v1`, single `{data, saved_at}` record).
- **In-memory**: the Zustand store.

### Boot sequence (`useResumePersistence` initial effect)
1. `api.load()` — try the server. If a resume comes back, load it AND clear the local cache (server is canonical).
2. If the server returned 404 (no resume yet) AND there's a cache, restore from cache silently (offline edits the server hasn't seen yet).
3. If the server is unreachable, restore from cache AND set save state to `offline` (visible to the user).
4. If the server returns 401, show the auth modal.

### Save sequence (per mutation, in `useResumePersistence`)
1. Cache write debounced 250 ms (cheap, but still not per-keystroke).
2. Server `PUT /api/resume` debounced 1 s, with an AbortController so a newer mutation supersedes an in-flight save.
3. On success: clear the local cache (now matches the server), flash "Saved" for 2 s.
4. On failure: show "Save failed" + Retry. Cache still holds the work.
5. On 401: kick the user back to the auth modal.

### Backup format
- `lib/backup.ts` defines `BackupV1` and `migrateBackup()`. The detector (`isBackupFormat`) is intentionally lenient — it accepts any envelope shape that smells like a backup, then `migrateBackup` decides if this build can read it (throws `UnsupportedBackupVersionError` with a user-meaningful message otherwise).
- When you bump the format, add a `BackupV2` interface, extend `AnyBackup`, write a `migrateV1toV2(v1)` step, and chain it into `migrateBackup`. The existing scaffold + tests at `tests/backup.test.ts` show the shape.

### Snapshot history (server-side)
- `saveResume()` in `server/db.ts` runs in a transaction: it upserts the
  single `resume_store` row **and** appends a row to `resume_snapshots`
  (schema is additive — `CREATE TABLE IF NOT EXISTS`, no migration needed).
- A snapshot identical to the most recent one is skipped (de-dup), and the log
  is pruned to the newest **50** entries on every save.
- Read endpoints (auth-gated, under `/api/resume`):
  `GET /snapshots` → metadata only (`{id, saved_at, size}`, newest first);
  `GET /snapshots/:id` → that snapshot's full resume data.
- The **History** modal (`SnapshotHistory.tsx`, opened from `AppHeader`)
  restores via **`replaceData`** (not `loadStore`) so a restore is itself a
  user mutation: it lands in the undo stack and is re-saved. This is why
  "restore" is reversible.

### Translation assist (server-side proxy)
- The client never calls the translation backend directly. `POST /api/translate`
  (auth-gated) proxies to a self-hosted **LibreTranslate** instance configured
  via `LIBRETRANSLATE_URL` (+ optional `LIBRETRANSLATE_API_KEY`). Rationale: the
  URL/key stay server-side (the client reads no env vars — §2), CV text flows
  server→server inside the deployment, and there's one auth perimeter.
- `server/translate.ts` maps the app's locale codes to ISO codes the service
  expects (`no→nb`, `se→sv`, `dk→da`; others pass through). A near-identical map
  lives in `lib/translateClient.ts` for display gating — kept duplicated rather
  than coupling the two build trees; both are tiny.
- `GET /api/translate/status` reports `{configured}`; the client memoizes this
  once (`getTranslationAvailability`) so N `DualField`s share one probe, and the
  "Draft translation" button only renders when it's `true`. Drafts are always
  framed as review-required.

---

## 9. Importer notes (CVpartner format)

`src/lib/importer.ts` maps the CVpartner JSON export to our `ResumeStore`. Key behaviors:

- Localized values can be objects (`{ no: "...", int: "..." }`) or interleaved arrays (`['no', '...', 'int', '...']`). The `localized()` helper handles both. The `int` locale code is renamed to `en` on import.
- The export's `language_codes` field is unreliable (often only lists `no` even when content is in `no`, `int`, `se`, `dk`). We scan all content recursively to detect actually-used locales — see `scanLocales()` in `importFromCVPartner`. The same logic lives generically in `lib/locales.ts → detectLocalesInData()` for use against any `ResumeStore`.
- Skills are built from `technologies[].technology_skills` AND any extra skills referenced only by projects (no orphans).
- Roles come from `cv_roles`. Project roles link via `cv_role_id`.
- `project.related_work_experience_id` → our `work_experience_id`. **Important**: the work-experience id map is pre-built BEFORE iterating projects so links resolve. (This was a real bug — fixed in commit `3da1b99` with a regression test.)
- `customer_selected: 'customer_anonymized'` → our `use_anonymized: true`.

**If you're modifying the importer:** add cases to `tests/importer.test.ts`. The table-driven tests pin every documented behavior of this file.

---

## 10. Testing

### Running
```
npm test                  # one-shot, headless
npm run test:watch        # watch mode
npm run test:coverage     # v8 coverage in coverage/
```

### What's covered
- **`lib/`** — every pure-logic library has a `.test.ts`: `locales`, `completeness`, `viewFilter`, `backup`, `importer`, `merge`, `exporter` (smoke test with jsdom for DOM bits), `localCache` (jsdom).
- **`store/useStore.ts`** — generic CRUD, `moveItem`/`reorderItem`, `mutationCount` semantics (every mutator bumps once, no-ops don't bump, `loadStore` resets, `replaceData` bumps).
- **React components** — `tests/components/*.test.tsx` via React Testing Library cover every editor, the shell components, and the ui primitives (render → interact → assert through the store). See "Component tests" below.
- **The Express server** — `tests/server/*.test.ts` (node env): `db` (CRUD +
  snapshot dedup/prune via `createResumeDb(':memory:')`), `translate` (locale
  map + `translate()` error matrix with a mocked `fetch`), `auth` (token
  matrix on the middleware), and `routes` (HTTP status/validation via
  **supertest** against `createApp()`, with `RESUME_DB_PATH=':memory:'`).
- **Test fixtures** — `tests/fixtures.ts` exports `emptyStore()` + `makeProject()`, `makeWork()`, etc. Use these instead of constructing entities inline so future shape changes are one-place fixes.

### What's NOT covered
- The **live LibreTranslate round-trip** — the proxy's validation/error paths
  are unit-tested with a mocked `fetch`, but an actual translation against a
  running LibreTranslate instance is only verified manually (no model in CI).
- Server modules read their env (`RESUME_API_TOKEN`, `LIBRETRANSLATE_URL`,
  `RESUME_DB_PATH`) **lazily** inside functions, so tests vary config with
  `vi.stubEnv` and `createApp()` has no import-time side effects.

### Component tests (RTL)
- Default test env is `node`; component tests opt in with `// @vitest-environment jsdom` at the top.
- `tests/setup-rtl.ts` registers `@testing-library/jest-dom` matchers and wires `afterEach(cleanup)` (vitest doesn't expose `afterEach` as a global, so RTL's auto-cleanup wouldn't fire on its own).
- The Zustand store is a module-level singleton — call `resetStore()` from `tests/helpers/store-reset.ts` in `beforeEach` so state doesn't leak between tests. To seed test data, follow with `useStore.setState({ data: {...}, hasData: true, ... })`.
- `userEvent.type` works without `userEvent.setup()` but the v14 setup-based API is also fine.

### Adding a test
- Pure-logic addition → add a case to the appropriate `tests/*.test.ts`.
- Store action addition → add a case to `tests/store.test.ts`, including a no-op assertion (`mutationCount` should not bump for unobservable changes).
- Component addition → add a `tests/components/<Name>.test.tsx` modeled on the existing ones (jsdom pragma, `resetStore()` in `beforeEach`, render → assert through the store).
- Server addition → add to `tests/server/`. Test db logic via `createResumeDb(':memory:')`; vary env with `vi.stubEnv` (server modules read env lazily); for routes, `await import('../../server/app')` in `beforeAll` with `RESUME_DB_PATH=':memory:'` and drive `createApp()` with supertest.

---

## 11. Operational notes

### Common commands
```
npm install              # first time only
npm run dev              # client (Vite, 5173) + server (Express, 3001) via concurrently
npm run dev:client       # just Vite (no server)
npm run dev:server       # just Express (tsx watch)
npm run build            # production build to dist/
npm run preview          # serve dist/ to verify the prod build works
npm test                 # vitest run
npm run typecheck        # client + server tsc
npm start                # production server (NODE_ENV=production)
```

### Verifying changes
After any significant change:
1. `npm run typecheck` — must be clean.
2. `npm test` — must be green.
3. `npm run build` — must be clean (catches things tsc misses).
4. For UI changes, open the dev server and click through the affected flow. CI runs all three.

### Server / env
- Copy `.env.example` to `.env` and set `RESUME_API_TOKEN` for a deployed instance. Leaving it empty disables auth — fine for local dev.
- `data/resume.db` is the SQLite file; it's gitignored. WAL mode is on. The
  `resume_snapshots` table lives in the same file (additive, no migration).
- The single-row constraint (`CHECK (id = 1)`) is intentional: this is a single-resume-per-instance product. (The snapshot table is *not* single-row — it's the history log.)
- **Translation is optional.** A bundled `docker-compose.yml` runs a
  LibreTranslate service (locales limited to `en,nb,sv,da`, models persisted in
  a named volume). Bring it up with **`npm run dev:translate`**
  (`translate:down` to stop), then set `LIBRETRANSLATE_URL=http://localhost:5000`
  in `.env` and restart the server. It is intentionally *not* part of
  `npm run dev` — first boot pulls a multi-GB image + models. Unset = the Draft
  button hides; Copy still works. Nothing leaves the deployment: the browser
  only talks to this server, which proxies to LibreTranslate.

### Known quirks
- The Claude Code preview tool launches `npm run dev` with `PORT=5173` injected for the Vite hint, but Express reads `process.env.PORT` and tries to bind 5173 too — collides with Vite. Outside the preview tool, `npm run dev` works correctly. If you need to verify auto-save end-to-end inside the preview, run the server manually with `PORT=3001 npx tsx server/index.ts`.
- The `.pdf` export uses `window.open()` + `window.print()`. **Pop-ups must be allowed.** The user gets an alert if blocked.
- The DOCX exporter (`lib/exporter.ts`) is lazy-loaded via dynamic import in `ResumeViewsEditor`. The first DOCX export triggers a ~352 kB chunk download. Don't statically import it from any always-loaded file or the bundle bloats again.
- Project skills imported from CVpartner may have proficiency=0 across the board (the source file doesn't populate them). Don't assume non-zero proficiency exists.

### What NOT to change without good reason
- The dual-view multi-language pattern (DualField). It's the whole point of the app.
- The shared role/skill registry design.
- The CVpartner importer's locale detection — it handles real-world malformed exports.
- The `loadStore` vs `replaceData` split in the store (see section 7). It's load-bearing for undo + auto-save semantics.
- The lazy import of `lib/exporter.ts`. Removing it adds ~350 kB to the initial bundle.

---

## 12. Future work

Ordered loosely by recommended priority. Each is a self-contained chunk.

> **Recently shipped** (don't re-propose): live preview pane in the Resume View
> editor, field-level translation assist (Copy + LibreTranslate-proxied Draft),
> and server-side snapshot history. See §1 and §8.

### 12.1 Export templates
`ResumeView.template_id` is already on the type (see `types/index.ts`) and called out as "reserved" in `lib/exporter.ts`, but nothing reads it. Two or three named templates (compact technical / formal management / minimal one-pager) would make views visually differentiated — currently a Board CV and a Technical CV produce the same-looking document. Touches both `buildViewHtml` (HTML/CSS path) and `exporter.ts` (DOCX path); each template is a styling delta, not a fork of the render logic. Pairs naturally with the (now shipped) live preview pane — that's what makes template choice tunable without an export round-trip.

### 12.2 Generic mergeRegistry
`mergeSkills` and `mergeRoles` are near-identical. If a third registry kind ever appears (e.g. mergeable industries), refactor to a descriptor-table `mergeRegistry(store, kind, source, target)`. Not worth doing for two kinds today.

### 12.3 Section catalog refactor
Three switches enumerate the 13 content sections: `viewFilter.getItemTitle/getItemSubtitle`, `viewFilter.renderItem`, `exporter.renderSection`. A section-descriptor registry (one place per section declaring `{titleField, subtitleField, dateField, render}`) would collapse them. The CLAUDE.md "Adding a new section" step would shrink from 7 items to 3. Don't do this if new sections are rare — the duplication is bounded.

### 12.4 Multi-resume support
The DB schema enforces single-tenant via `CHECK (id = 1)`. Multi-resume would mean: drop the constraint, move `resume_store` to a multi-row table, scope `resume_snapshots` per resume, add a `current_resume_id` setting + collection API, and wire a resume-switcher into the sidebar. The Zustand store wouldn't need to change shape, only what gets loaded into it. Note: Resume Views already cover "different audiences from one master CV" — this is only worth it for genuinely separate CVs.

---

## 13. Working with this project in Claude Code

A few tips specifically for this codebase:

- **Always read the relevant file before editing.** Files are small; reading is cheap.
- **`types/index.ts` is the source of truth.** When in doubt about a field, look there.
- **The store actions are generically typed.** Use them; don't write per-section update functions. Use the `mutate()` helper if you add a new action.
- **Inline styles live next to the component.** Don't extract to global CSS unless something is truly cross-cutting (then promote to `index.css` as a utility class or token).
- **Before adding a dependency**, check the bundle size (`npm run build` shows it). This is a client-side app; every dep ships to users. If it's used in only one place, consider lazy-loading it like `exporter.ts`.
- **The `docx` library's API uses `italics: true`, not `italic: true`.** Easy mistake; tsc catches it.
- **Lucide icons:** check the icon exists before using it (`grep -o "IconName" node_modules/lucide-react/dist/esm/lucide-react.js`). `IdCard` and a few others don't exist in this version; use `SquareUser` etc.
- **Don't reach for `loadStore` to apply an in-app computed store.** Use `replaceData` (see section 7) so undo + auto-save handle it correctly.
- **`useSortable` is no-op outside a `<SortableContext>`** but `<EditorCard>` will still show a drag handle. If a card isn't reorderable, pass `sortable={false}`.

If a request is large or touches many files, propose a plan first — list the files you'd change and what each change is. Then proceed once confirmed.
