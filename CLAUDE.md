# Resume Studio — Project Guide for Claude Code

This file is read on every session. Read it first before touching code. It
holds the **invariants and conventions**; the exhaustive feature catalog lives
in `.claude/feature-map.md`, and `knowledge.yaml` (repo root) indexes every
knowledge artifact here — consult it to pick the right doc/skill for a task.

---

## 1. What this is

A web app that lets a consultant maintain **one master resume across multiple
languages** and extract **targeted variants** (Resume Views) for different
audiences. Scaffolded conversationally, continued in Claude Code.

**Core promise:** the consultant edits once (in the language they choose), can
view/edit any field in two languages side-by-side, and exports polished `.docx`
or `.pdf` files via a Resume View — a curated subset of the master CV.

### Feature summary

The full catalog with per-feature design detail is in
`.claude/feature-map.md`. At a glance, what works today:

- **Core editing** — multi-resume (`/` picker, `/r/:uuid` editor), debounced
  auto-save to Express+SQLite with per-id localStorage fallback, undo/redo,
  drag-and-drop reordering, global content search (Ctrl/Cmd+K).
- **Multi-language** — dual-view editing (§5), translation assist (Copy +
  server-proxied LibreTranslate/DeepL/etc. Draft), locale re-detection.
- **Registries** — shared Skill / Role / Industry registries with merge,
  usage counts, and a "By category" view; `SkillCategory` entities drive skill
  grouping + the Skills Showcase; Quadim skill-taxonomy autocomplete,
  normalization, related-skills, and offline auto-categorization.
- **Resume Views & export** — targeted section/item selection, per-view style +
  header/footer, export templates, BYO-LLM tailoring, anonymization, skill
  matrix; export to PDF / DOCX (lazy) / ATS text+Markdown; live preview pane.
- **Import** — CVpartner JSON, LinkedIn (.zip), Europass XML, AI-assisted
  PDF/Word (BYO-LLM), and portable JSON backup.
- **Persistence & safety** — auth-gated server (cookie/bearer, named tokens),
  offline editing + conflict safety, per-resume snapshot history, freshness
  warnings, storage readout, React error boundary.
- **Desktop** — downloadable portable build with cross-computer JSON sync and
  auto-update (§14, `DESKTOP.md`).

**Intentionally simple:** the router is a hand-rolled ~150-line History API
hook (`src/lib/router.ts`, no dep; the URL is canonical, `EditorRoute`
two-way-syncs it — URL→store then store→URL, order load-bearing). Styling is
inline `<style>` blocks per component + CSS custom properties. No Tailwind, no
CSS-in-JS.

Wishlist: §12.

---

## 2. Stack and conventions

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite 5 | `npm run dev` / `npm run build` / `npm run preview` |
| Framework | React 18 + TypeScript | Strict mode on |
| State | Zustand (single store) | See `src/store/useStore.ts` |
| Persistence | Express + better-sqlite3 (multi-row `resumes` + scoped `resume_snapshots`) | See `server/`. Per-id localStorage fallback in `lib/localCache.ts` |
| Routing | Hand-rolled History API hook | `src/lib/router.ts` — `useRoute()`, `navigate()`, `<Link>`. No dep. |
| Tests | Vitest (+ jsdom for browser-tied tests) | `npm test`, `npm run test:watch`, `npm run test:coverage` |
| Icons | lucide-react | **Tree-shaken**: import each icon by name, never `import * as` |
| DOCX export | `docx` npm package | **Lazy-loaded** (~352 kB chunk) — only fetched when the user clicks Export DOCX |
| PDF export | `pdfmake` (vector) | **Lazy-loaded** (~1.2 MB lib + ~0.9 MB font vfs) — one-click `.pdf` download built from the section catalog in `lib/pdfExporter.ts`, mirroring the DOCX exporter. Its own render engine, so ~matches (not pixel-identical to) the HTML preview |
| Drag-and-drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Pointer + keyboard sensors |
| Styling | Inline `<style>` blocks per component + CSS custom properties in `src/index.css` | No Tailwind, no CSS-in-JS lib — keep it that way |

### Code style rules
- **TypeScript strict mode.** `npm run typecheck` covers client + server.
- **No `any`** unless interfacing with truly unknown shapes (e.g. raw imported JSON). Use `unknown` then narrow.
- **No default exports** for components — use named exports. (`main.tsx` and `App.tsx` are the only existing default exports; new components are named.)
- **Inline styles via `<style>` tag inside the component.** Each component owns its CSS. Tokens come from `src/index.css` (see §6). The only utility classes in `index.css` are widely-shared widgets: `.check-row`, `.skip-link`, `.sr-only`.
- **Accessibility conventions (v0.3.1)** — hold these invariants when touching UI:
  - Every form control gets a programmatic name (`htmlFor`/`useId`, or
    `aria-label`). `DualField`/`RichField` name each column
    `"<label> (<locale name>)"` and set `lang={bcp47(locale)}` (WCAG 3.1.2).
  - Async status/errors are live regions: `role="status"` for ok/progress,
    `role="alert"` for failures. `SaveStatus` renders a *persistent* status
    wrapper — don't conditionally unmount a live region.
  - Modals go through `components/ui/useDialog.ts` (initial focus, Tab trap,
    Esc, focus restore) + `aria-modal` + `overscroll-behavior: contain`.
  - No `transition: all` — list properties. Reduced-motion is handled
    globally in `index.css`; never add a per-component override.
  - Focus: global `:focus-visible` ring; inputs that draw a box-shadow ring
    keep it, but `forced-colors` falls back to a real outline (global rule).
  - Text colors come from the AA-verified tokens (see §6) — never use
    `--secondary-ink` (cyan) for text; that's what `--secondary-ink-text`
    is for. Status text uses the `--ok/warn/err-ink` + `-wash` pairs.
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

One-line-per-file navigation aid. Where a file is subtle, the noted skill or
CLAUDE.md section carries the detail.

```
src/
├── types/index.ts   ← single source of truth for the data model (zero runtime imports)
├── store/           ← useStore (Zustand + generic CRUD, currentResumeId, unloadStore),
│                      useUndoRedo, useResumePersistence (boot+auto-save), useTranslation,
│                      useSortedItems, useReorderGuard. See the store-and-persistence skill
├── lib/             ← PURE logic (no React); a few touch browser APIs but stay jsdom-testable
│   │ — core: locales (resolve/bcp47/detectLocalesInData), sections (GROUP_ORDER,
│   │   canonicalSectionKey), router (hand-rolled History API), freshStore, migrate
│   │   (CURRENT_SHAPE_VERSION; single migration choke point), usage, merge (generic
│   │   mergeRegistry), completeness, wipeLocale, contentSearch, careerTimeline, freshness
│   │ — persistence/sync: api, localCache (per-id fallback+queue), connectivity,
│   │   syncEngine (PURE boot/drain decisions), diffResume, storage (weight thresholds),
│   │   backup (per-resume JSON), snapshotDiff, snapshotImages
│   │ — render/export: sectionCatalog (one descriptor feeds ALL render adapters),
│   │   viewFilter (applyView + buildViewHtml; escapeHtml; SECURITY-CRITICAL),
│   │   exporter (LAZY-LOADED docx; SECURITY: TextRun escapes), viewText (ATS text/MD),
│   │   viewStyle + viewHeader (render-boundary sanitisers), richText (allowlist;
│   │   SECURITY-CRITICAL), image (canvas downscale; rejects SVG), sectionSort,
│   │   viewTemplates, viewTailor (BYO-LLM), skillMatrix, showcase (showcaseGroups)
│   │ — skills/taxonomy: skillTaxonomy (Quadim lazy JSON), skillNormalize (imports only),
│   │   skillMatch (exact/token/fuzzy/semantic tiers), skillCategorize (SkillCategory
│   │   CRUD + auto-categorization; effectiveSkillCategory)
│   └ — importers: importer (CVpartner), importerLinkedIn (CSV/zip), importerEuropass
│       (XML+JSON), aiImport (resumestudio-ai/v1), translateClient
├── components/
│   ├── shell: App (routes + URL⇄store sync), AppHeader, ErrorBoundary, ResumeList (picker),
│   │   ImportScreen, AIImportModal, AuthGate, SnapshotHistory (restores via replaceData),
│   │   ConflictModal, NewerDataNotice, SyncPanel, SettingsModal, UpdateBanner, GlobalSearch
│   ├── layout/      ← Sidebar (GROUP_ORDER), LanguageSwitcher (popover), SaveStatus (live region)
│   ├── ui/          ← DualField (THE KEY COMPONENT), EditorCard, Fields, Autocomplete
│   │                  (ARIA combobox), SortableList, TranslationPopover (here to avoid a
│   │                  circular import), useDialog (shared modal focus behaviour)
│   └── editor/      ← Overview, HeaderEditor, ProfileCompetenciesEditor, ProjectsEditor,
│                      SimpleEditors, RegistryEditors, RegistryCategoryView, ResumeViewsEditor
└── index.css        ← self-hosted @font-face + design tokens + global a11y rules + utilities

server/              ← Express API + SQLite persistence
├── index.ts (VPS/dev entry) + app.ts (createApp: security headers, routers, static serving)
├── auth.ts (cookie OR Bearer; constant-time; env read lazily) · db.ts (createResumeDb +
│   lazy singleton; snapshots; dump/restore; close checkpoints WAL) · config.ts (PURE paths)
├── backup.ts (whole-store StoreBackupV1 — NOT the client backup) + backupScheduler/-Runtime
├── settings.ts (desktop settings.json; applyToEnv; isDesktop gate) · storage.ts (payloadStats)
├── translate.ts (pluggable proxy: libretranslate/deepl/google/azure) · translateDocker.ts
├── version.ts (APP_VERSION) · desktop/ (launcher, freePort, openBrowser, notify, tray,
│   trayIcon, updater, updateRuntime — CJS-bundled, see §14)
└── routes/          ← auth, resume, translate, backup, settings, update

scripts/build-desktop.mjs ← assembles the portable release/ folder (per target OS)
tests/               ← Vitest (lib/store/components/server) + e2e/smoke.spec.ts. See §10
```

### Layered design — these layers must stay clean
1. **`types/`** has zero runtime imports. Pure type definitions.
2. **`lib/`** is pure logic. No React. A few touch DOM/browser APIs but stay unit-testable (jsdom): `exporter.ts`, `viewFilter.ts`, `localCache.ts`, `richText.ts`, `image.ts`.
3. **`store/`** owns mutable state. Only place where data lives.
4. **`components/`** read from the store and call store actions. **No business logic in components — if a computation is more than one line, it goes in `lib/`** (see `lib/completeness.ts`).

---

## 4. The data model — read this carefully

The data model was carefully designed across several iterations. Don't change shapes without considering the consequences.

### Localization
Every translatable field is a `LocalizedString = Record<string, string>` keyed by locale. Resolution chain (`lib/locales.ts → resolve()`):
1. Requested locale
2. Fallback locale (default `"en"`)
3. First non-empty value (skips empty strings — see the bug fixed in commit `3da1b99`)

**Never** check `value[locale]` directly in components — always go through `resolve()` so the fallback chain works.

### Dates
- `YearMonth = { year: number, month: number | null }` — month-precision. `month: null` means only year is known.
- `end: null` on date ranges means ongoing.

### Shared registries
- **`Skill`** — global registry (`data.skills`), referenced by `ProjectSkill` via `skill_id`. `countSkillReferences()`.
- **`Role`** — global registry (`data.roles`), referenced by `ProjectRole` + `WorkExperience.role_id`. `countRoleReferences()`.
- **`Industry`** — `data.industries`; a project references one or more via `Project.industries[]` (`ProjectIndustry` links; shape v4 — single `industry_id` pre-v4). `countIndustryReferences()`. All three merge through the generic `mergeRegistry` / `countRegistryReferences`.
- **`SkillCategory`** (shape v6) — `data.skill_categories`; a skill links to at most one via `Skill.category_id`. Lighter than the other three: no `mergeRegistry` yet (delete + reassign covers it), but has `renameSkillCategory` + curated `moveSkillCategory` reorder (drives both the By-category editor header order AND the Skills Showcase group order).
- **Snapshot names**: `ProjectSkill.name`, `ProjectRole.name`, `ProjectIndustry.name` are denormalized copies of the registry name at link time, so a rename doesn't rewrite history. `merge.ts` updates these when it rewrites references. (`SkillCategory` has no per-link snapshot — `category_id` resolves live via `categoryNameIndex()`.)

### Resume Views
`ResumeView` (in `data.views`) is the "targeted resume" config: name, localized intro, enabled sections in display order, excluded-items list, starred-only toggle, optional page limit. `lib/viewFilter.ts → applyView()` produces a filtered `ResumeStore`; the exporter and HTML renderer consume it.

### What's an entity vs. an embedded array
- Tables (`projects`, `educations`, `courses`, …) live as top-level arrays in `ResumeStore`.
- Sub-collections tightly bound to a parent (a project's roles/skills, a key qualification's bullets) are **embedded arrays** on the parent. Don't promote these to top-level tables.

### Disabled vs. starred
- `disabled: true` excludes from all exports and overview lists. Soft-delete.
- `starred: true` is featured/highlighted ordering. Used by `ResumeView.starred_only`.

---

## 5. Multi-language UI — the dual-view pattern

The single most important UX requirement: **every translatable field renders as two inputs side-by-side**, primary language left, secondary right. The user can pick which two locales are visible (independent of the resume's supported locales), swap them, hide the secondary column, or **re-detect locales** (`LanguageSwitcher`'s re-detect scans every `LocalizedString` and merges new locales into `resume.supported_locales`). All controls live behind ONE compact header button (the trigger shows e.g. "EN / NO" and opens a popover).

**Implementation:**
- `useStore().primaryLocale` and `useStore().secondaryLocale` (the latter can be `null` = single-column mode).
- `DualField` reads these directly and renders 1 or 2 inputs. Callers just pass the `LocalizedString` and a setter — they never touch locales.
- The secondary input gets a subtle cyan tint (`--secondary-tint`); the primary uses navy accent on focus.
- In two-language mode the open card **breaks out wider** (`.ec-wide` on `EditorCard`, gated on `secondaryLocale`, capped `min(1240px, max(100%, calc(100vw - 350px)))`) so each language gets comfortable width without fields overflowing. Single-language mode stays normal width.
- The secondary column carries two **translation-assist** affordances: **Copy** (no network) and, when a backend is configured, **Draft** (server-proxied, "review required"). Editing the secondary clears the draft annotation. Both are pure UX sugar over the same `onChange`.

**Rule:** Every component that touches a `LocalizedString` must use `DualField`. Never render a single text input bound to one locale.

---

## 6. Design tokens and styling

CSS custom properties in `src/index.css` are the design system:

```css
--paper, --paper-raised, --paper-sunken    /* backgrounds */
--ink, --ink-soft, --ink-faint             /* text */
--line, --line-strong                      /* borders */
--accent (#002E6E), --accent-bright, --accent-wash  /* Cartavio navy (verified from live site) */
--secondary-tint, --secondary-line, --secondary-ink /* Cartavio cyan #00B8DE — borders/washes/icons ONLY (2.4:1 on white) */
--secondary-ink-text (#007696)             /* the TEXT-safe cyan twin (≥4.5:1) — all cyan-family text uses this */
--ok-ink/--ok-wash, --warn-ink/--warn-wash, --err-ink/--err-wash  /* status pairs, every ink ≥4.5:1 on its wash AND on paper */
--gold (#9a7b3f)                           /* star/featured indicator */
--serif: 'Open Sans Condensed' weight 300  /* heading font — matches cartavio.no */
--sans: 'Ubuntu' + system                  /* body font — matches cartavio.no */
--r-sm/--r-md/--r-lg                       /* border radii */
--shadow-sm/-md/-lg
```

**Aesthetic:** Cartavio brand — pure white backgrounds, navy (#002E6E) primary accent, cyan (#00B8DE) secondary/highlight. Open Sans Condensed (300) headings, Ubuntu body. Verified from cartavio.no CSS. No warm/sepia tones. Brand skill: `.claude/skills/cartavio-brand.md`.

**Fonts are self-hosted** (`public/fonts/*.woff2` + `@font-face`, preloaded from `index.html`) — no Google Fonts CDN (GDPR, offline, `font-src 'self'`). Don't reintroduce a fonts CDN.

**Configurable view fonts** (`lib/fonts.ts`): a catalog of brand + common cross-platform families. A view's `heading_font`/`body_font` is a catalog id or `'inherit'` (the app-wide default, stored in `lib/appPrefs.ts` localStorage, edited in Settings). `viewStyle.withResolvedFonts` maps `'inherit'` → the concrete id at each export boundary (the pure exporters take an optional `globalFonts` param). PDF can't embed arbitrary fonts, so each family maps onto a pdfmake standard-14 base font (`pdfFont`: Times/Helvetica/Courier — no binaries; brand fonts keep embedded Roboto). Word references the name (can't embed) → `installUrl` surfaces a "download & install" link. **We deliberately do NOT bundle new font binaries** (the chosen "light" approach) — don't add `@fontsource`/font files without confirming.

**Minimum text size is 11px** (bumped in v0.3.1). Don't add new text below 11px.

**Utility classes** (use instead of redefining inline): `.check-row`, `.skip-link`, `.sr-only`. `index.css` also owns the global `:focus-visible` ring, `forced-colors` outline fallback, and `prefers-reduced-motion` collapse — don't duplicate those per component.

When adding a component, copy the inline `<style>` pattern from an existing one (e.g. `DualField.tsx`). Use the tokens; don't introduce new colors casually.

---

## 7. The store — patterns to follow

> Before changing `src/store/**`, `lib/localCache.ts`, or the auto-save / boot /
> undo flow, read the **store & persistence skill**
> (`.claude/skills/store-and-persistence.md`) — it spells out the
> `loadStore`-vs-`replaceData` split and the `mutationCount`/`mutate()` contract
> whose silent breakage has caused real bugs.

### Reading
```ts
const projects = useStore(s => s.data.projects)
```

### Generic CRUD (use these — don't write custom mutations per section)
```ts
const { addItem, updateItem, removeItem, moveItem, reorderItem } = useStore()

addItem('projects', newProject)                          // top of custom order + opens the card
addItem('roles', reg, { open: false })                   // nested registry create: don't steal focus
updateItem('projects', projectId, { customer: localized }) // shallow merge
removeItem('projects', projectId)                        // no-op if id unknown
moveItem('projects', projectId, toIndex)                 // drag-and-drop target
reorderItem('projects', projectId, 'up' | 'down')        // keyboard fallback (thin wrapper over moveItem)
```

`addItem` places the new item at the **top** of custom (`sort_order`) order (editors also render their Add button above the list), and in date-sort modes an **undated item floats to the top** until dated. It also **opens the new item's card** by default; pass `{ open: false }` for a registry entry created from *inside* another editor so it doesn't collapse the parent card. The generic functions are typed (`updateItem('projects', id, {...})` autocompletes to `Project` fields).

### The two contracts that break silently (full detail in the skill)
- **`loadStore(store, locales?)`** = I/O (server/file load): resets `mutationCount` to 0, runs `migrateStore()`. **`replaceData(store)`** = in-app rewrite (undo, merges, restores): bumps `mutationCount` so auto-save + undo see it, never migrates. `unloadStore()` ejects on unmount. Calling `loadStore` for an in-app rewrite silently skips undo AND may never save.
- **Every mutating action goes through the private `mutate()` helper** (auto-bumps `mutationCount`; auto-save and undo key off it — a raw `set()` is invisible to both). Return `null` from the updater for a no-op so invisible changes don't bump.

Navigation: `setActiveSection(key)` / `setExpandedItem(id)`. Undo/redo: `useUndoRedo` in `AppHeader` — see the skill.

### Adding a new section
1. Add the array to `ResumeStore` in `types/index.ts`.
2. Add the empty array to both `emptyStore()` and `freshStore()` in `lib/freshStore.ts`.
3. Add an entry to `SECTIONS` in `lib/sections.ts`. Sidebar *group* order comes from `GROUP_ORDER` (export-first); SECTIONS order drives the view editor's default section sequence. If the section is edited on another section's page, extend `canonicalSectionKey()`.
4. Add the icon import to `Sidebar.tsx`'s `ICON_MAP`.
5. Create the editor component and wire it into `App.tsx`'s `EditorRoute` switch (the key is auto a valid URL segment; EditorRoute validates against SECTIONS).
6. If sortable by `sort_order`, wrap `<EditorCard>`s in `<SortableList section="…" ids={…}>`. Else pass `sortable={false}` to each card.
7. If it should appear in Resume View exports: add **one descriptor** to `lib/sectionCatalog.ts` (title/subtitle + `summary()`/`full()` data views). Every render path (HTML/PDF, DOCX, text/Markdown) consumes the catalog through its generic adapter. Descriptors return **data only** — adapters own escaping; never build markup in a descriptor. Per-path differences go behind `ctx.target`. Views pick it up via `isExportableSection` + `normalizeViewSections`; give it a `defaultViewDetail` if not `full`. See the **export-pipeline** and **security** skills.
8. If you add a configurable **style/header field** to a view, it is untrusted-import surface — sanitise at the render boundary (`viewStyle.ts → deriveTokens` / `viewHeader.ts → withHeaderDefaults`) and add a breakout regression test. See the security skill.
9. If sortable by something other than `sort_order`, wire it into `lib/sectionSort.ts`.

---

## 8. Persistence

> The **store & persistence skill** carries the working detail: the full
> `/api/resumes` route grammar, the boot sequence (dirty-queue-wins), the save
> sequence (250 ms queue / 1 s PUT / abort / 409 routing), and the offline →
> reconnect-drain → conflict machinery. Summary of the architecture:

- **Source of truth**: SQLite via Express (`server/db.ts`) — `resumes` (one row
  per CV, with a **`version`** optimistic-concurrency token) + `resume_snapshots`
  (FK, `ON DELETE CASCADE`). **Outbound queue / offline fallback**: one
  `PendingRecord` per resume in localStorage (`lib/localCache.ts`); a dirty
  record is an unsynced edit awaiting flush. **In-memory**: the Zustand store
  holds one resume at a time (`currentResumeId`).
- **Conflict** = 409 from a stale `base_version` → non-blocking `ConflictModal`
  (diff summary; keep mine / discard mine). Sync decisions are pure functions
  in `lib/syncEngine.ts`; connectivity recovery is health-poll-confirmed
  (`lib/connectivity.ts`).
- **Backup** (`lib/backup.ts`, per-resume `BackupV1`): loading one from the
  picker creates a **new** resume. Distinct from the server's whole-store sync
  file (§14).
- **Snapshots** (server-side, 50/resume, deduped, stored **image-free** via
  `stripSnapshotImages`; restore re-attaches current images). The History modal
  restores via **`replaceData`** so a restore is undoable + re-saved.
- **Data-shape versioning** (`lib/migrate.ts`): `shape_version` (absent = 1;
  `CURRENT_SHAPE_VERSION` = 9). `migrateStore()` is the single choke point for
  data entering from outside (`loadStore` + snapshot restore; `replaceData`
  never migrates). Migrations are **idempotent shape-sniffers**. Newer-build
  data loads best-effort (stamp never downgraded; `NewerDataNotice`). **Bump
  only for structural migrations** — additive optional fields stay covered by
  `with*Defaults` render tolerance.
- **Translation assist**: the client never calls a translation backend directly
  — `POST /api/translate` proxies to the configured provider
  (`TRANSLATE_PROVIDER` ∈ `off|libretranslate|deepl|google|azure`; unset +
  `LIBRETRANSLATE_URL` → libretranslate for back-compat). Keys/URLs stay
  server-side; per-provider locale maps differ; errors never echo upstream
  detail. The client memoizes `GET /api/translate/status` once; drafts are
  always review-required.

---

## 9. Importer notes (CVpartner format)

> Full detail in the **CVpartner import skill** (`.claude/skills/cvpartner-import.md`)
> — format quirks, importer invariants, table-test discipline. Read it before
> touching `importer.ts` / `migrate.ts`.

`src/lib/importer.ts` maps CVpartner JSON to `ResumeStore`. The two invariants
worth knowing without opening the skill: localized values come in two shapes
(object AND interleaved array — `localized()` handles both; `int` → `en`), and
the export's `language_codes` is unreliable, so locales are detected by
recursive content scan. **If modifying the importer:** add cases to
`tests/importer.test.ts` (table-driven, pins every documented behavior).

---

## 10. Testing

**Before writing tests or doing QA, read the testing skill:
`.claude/skills/software-testing.md`.**

### Running
```
npm test                  # one-shot, headless
npm run test:watch        # watch mode
npm run test:coverage     # v8 coverage
npm run test:e2e          # build + Playwright smoke suite
```

### Coverage shape
- **`lib/`** — every pure-logic library has a `.test.ts`. Security-regression suites live in `viewFilter.test.ts` (XSS escaping + `<style>`/attribute breakout), `viewStyle.test.ts` (`sanitizeHexColor`), `viewHeader.test.ts` (boundary validators).
- **`store/useStore.ts`** — generic CRUD, `moveItem`/`reorderItem`, `mutationCount` semantics.
- **React components** — `tests/components/*.test.tsx` (RTL) cover every editor, shell, and ui primitive (render → interact → assert through the store).
- **Server** — `tests/server/*.test.ts` (node env): `db`, `translate`/`translateDocker`, `settings`, `config`, `backup`, `auth` (bearer + cookie matrix), plus route suites via **supertest** against `createApp()` with `RESUME_DB_PATH=':memory:'`.
- **E2E smoke** — `e2e/smoke.spec.ts` boots the REAL prod server and drives create → edit/auto-save/reload → view preview → unknown-id bounce. Keep it thin (happy paths only).
- **Fixtures** — `tests/fixtures.ts` exports `emptyStore()` + `makeProject()`/`makeWork()`/… — use these so shape changes are one-place fixes.

### Not covered
- The **live LibreTranslate round-trip** (proxy paths are unit-tested with mocked `fetch`; no model in CI).
- Server modules read env **lazily**, so tests vary config with `vi.stubEnv` and `createApp()` has no import-time side effects.

### Conventions
- Default test env is `node`; component tests opt in with `// @vitest-environment jsdom`.
- `tests/setup-rtl.ts` registers jest-dom matchers + `afterEach(cleanup)`.
- The store is a module-level singleton — call `resetStore()` (`tests/helpers/store-reset.ts`) in `beforeEach`; seed with `useStore.setState(...)`.
- Adding a test: pure-logic → `tests/*.test.ts`; store action → `tests/store.test.ts` (include a no-op assertion); component → `tests/components/<Name>.test.tsx`; server → `tests/server/` (`createResumeDb(':memory:')`, `vi.stubEnv`, supertest over `createApp()`).

---

## 11. Operational notes

### Common commands
```
npm run dev              # client (Vite, 5173) + server (Express, 3001) via concurrently
npm run dev:client       # just Vite      npm run dev:server   # just Express (tsx watch)
npm run build            # production build to dist/    npm run preview  # serve dist/
npm test                 # vitest run      npm run typecheck    # client + server tsc
npm start                # production server (NODE_ENV=production)
npm run desktop          # build client + run the desktop launcher from source (tsx)
npm run build:desktop    # assemble the portable release/ folder (per target OS)
```

### Verifying changes
After any significant change: 1. `npm run typecheck` (clean) → 2. `npm test` (green) → 3. `npm run build` (clean — catches what tsc misses) → 4. for UI, click through the affected flow. CI runs all three. Before committing anything touching HTML/string templating, the server, auth, persistence, imports, or exports, run through the **security skill** (`.claude/skills/security-review.md`).

### Server / env
- Copy `.env.example` to `.env`; set `RESUME_API_TOKEN` for a deployed instance (empty disables auth — fine for local dev).
- `data/resume.db` is gitignored, WAL on, foreign keys on (required for snapshot CASCADE). `createResumeDb` defensively drops the pre-multi-resume `resume_store` table.
- **Hardening (`server/app.ts`):** CSP + `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy`/`Permissions-Policy` on every response (CSP `'self'` scripts/fonts + inline styles; fonts self-hosted). Auth-gated API is rate-limited with a **failure-focused** limiter (`skipSuccessfulRequests`), tunable via `RESUME_RATE_LIMIT_MAX`/`_WINDOW_MS`.
- **DB file ACLs:** `createResumeDb` chmods a file-backed DB to `0600`, `defaultDb` tightens `data/` to `0700`. Best-effort, no-op on Windows.
- **Translation is optional.** Bundled `docker-compose.yml` runs LibreTranslate (`en,nb,sv,da`); `npm run dev:translate` (`translate:down` to stop), then set `LIBRETRANSLATE_URL` + restart. Intentionally *not* part of `npm run dev` (first boot pulls a multi-GB image). Unset = Draft hides, Copy still works.

### Known quirks
- The preview tool injects `PORT=5173`, but Express reads `process.env.PORT` and collides with Vite. To verify auto-save inside the preview, run the server manually with `PORT=3001 npx tsx server/index.ts`.
- `.pdf` export is a **vector one-click download** via lazy-loaded `pdfmake` (`lib/pdfExporter.ts`) — no print dialog, no pop-up. Like the DOCX path it's a *separate* render engine (bundled Roboto font, not the brand Open Sans Condensed/Ubuntu), so its layout is close to but not pixel-identical with the HTML preview. Don't statically import `lib/pdfExporter.ts` or `pdfmake` from any always-loaded file.
- The DOCX exporter (`lib/exporter.ts`) is lazy-loaded via dynamic import in `ResumeViewsEditor` (~352 kB chunk). Don't statically import it from any always-loaded file.
- CVpartner project skills may have proficiency=0 across the board — don't assume non-zero.

### What NOT to change without good reason
- The dual-view multi-language pattern (DualField). It's the whole point of the app.
- The shared role/skill registry design.
- The CVpartner importer's locale detection (handles real-world malformed exports).
- The `loadStore` vs `replaceData` split (§7) — load-bearing for undo + auto-save.
- The lazy import of `lib/exporter.ts` (removing it adds ~350 kB to the initial bundle).

---

## 12. Future work

**Recently shipped — don't re-propose.** See `.claude/feature-map.md → Recently
shipped`, git history, and `plans/`. Highlights: multi-resume, offline editing +
conflict safety, desktop build + JSON sync + auto-update, the section-descriptor
catalog + export templates + BYO-LLM tailoring + ATS text/Markdown, LinkedIn +
Europass + AI import, Quadim skill-taxonomy integration, the showcase→category
unification (shape v6), Industry registry + generic `mergeRegistry`, career
timeline, global search, and the v0.3.1 UX/accessibility wave.

### Watchlist (deferred until forced)
- **Cross-tab coordination** — two tabs editing one resume share a localStorage pending slot. The server `version` check makes it *safe* (second flush 409s into the conflict modal), just not tidy; a `BroadcastChannel` lock would stop the local thrash. Low priority.
- **UI-chrome localization** — app labels are English-only. A dictionary-based `t()` is plausible for the Norwegian market but taxes every component forever — decide once, record here.
- **Image asset table (A4 Phase 2)** — auto-save PUTs and pending records still carry embedded base64 images. If measurements show quota risk, move to a content-addressed `assets` table (`hash → bytes` + `asset_id`), touching exporter/viewFilter/backup/localCache.
- **Offline-load (PWA / service worker)** — offline *editing* shipped; *loading* the app cold with no network still fails (no SW caching the shell). Multi-day; only if "open and edit with zero connectivity" becomes a real need. See `plans/offline-editing.md` (Tier 3).

---

## 13. Working with this project in Claude Code

- **`knowledge.yaml` (repo root) is a KCP manifest** — a machine-navigable index of every knowledge artifact (this file, `.claude/skills/` + `.claude/feature-map.md`, `DESKTOP.md`, `plans/`, docs, CI policies) with intent, dependencies, and `validated` dates. Consult it to pick a doc/skill; when you change a document, update its unit's `validated` date. Spec: https://github.com/Cantara/knowledge-context-protocol
- **Always read the relevant file before editing.** Files are small; reading is cheap.
- **`types/index.ts` is the source of truth.** When in doubt about a field, look there.
- **Store actions are generically typed.** Use them; use `mutate()` for new actions.
- **Inline styles live next to the component.** Don't extract to global CSS unless truly cross-cutting.
- **Before adding a dependency**, check the bundle size (`npm run build`). Every dep ships to users; if used in one place, lazy-load it like `exporter.ts`.
- **The `docx` library uses `italics: true`, not `italic: true`.** tsc catches it.
- **Lucide icons:** check the icon exists first (`grep -o "IconName" node_modules/lucide-react/dist/esm/lucide-react.js`). `IdCard` doesn't exist here; use `SquareUser` etc.
- **Don't reach for `loadStore` to apply an in-app computed store.** Use `replaceData` (§7).
- **`useSortable` is no-op outside a `<SortableContext>`** but `<EditorCard>` still shows a drag handle. Pass `sortable={false}` for non-reorderable cards.

If a request is large or touches many files, propose a plan first, then proceed once confirmed.

---

## 14. Desktop build & cross-computer sync

Full end-user + build docs in **`DESKTOP.md`**. Load-bearing invariants for working here:

- **Two server entries, one app.** `server/index.ts` (VPS/dev, `tsx`) and `server/desktop/launcher.ts` (desktop) both call `createApp()`. Don't fork app logic per entry — differences are env/wiring only.
- **The launcher is bundled to CJS** (esbuild, `better-sqlite3` external). So **launcher code must not use `import.meta`/`__dirname`** — it uses env + `process.cwd()`. `app.ts`/`db.ts` guard `import.meta.url` (`import.meta.url ? … : process.cwd()`) because esbuild emits `""` for it; don't "simplify" that back or the bundle crashes at boot.
- **Paths come from `server/config.ts`** (pure). The launcher sets `RESUME_DB_PATH` + `RESUME_CLIENT_DIR` before `createApp()`/first DB use. **Data dir** is per-user OS-standard (`%APPDATA%\ResumeStudio`, `~/Library/Application Support/ResumeStudio`, `~/.local/share/resume-studio`), overridable via `RESUME_DATA_DIR` — matches Electron's `app.getPath('userData')`.
- **Sync model = whole-store JSON backup, NOT the live DB in the cloud folder.** `RESUME_BACKUP_DIR` holds one `resume-studio-backup.json` written atomically. Merge is **newest-wins per resume by `saved_at`, union, never deletes** (`db.restoreResumes`, `merge` mode). Live SQLite in a sync folder is intentionally avoided (corruption); `RESUME_DB_JOURNAL=TRUNCATE` is the documented escape hatch.
- **`db.close()`** does `wal_checkpoint(TRUNCATE)` then close. Keep shutdown ordering: `tray.kill()` → `flushBackup()` → `closeDefaultDb()` → `server.close()`.
- **System-tray icon = the user's Quit affordance** (`desktop/tray.ts`, `systray2`). Tray Quit calls the same `shutdown()` — never add a "quit" control to the web UI. Gotchas: register `onClick`/`onError` only after `await systray.ready()`; the CJS↔ESM interop puts the `SysTray` constructor in different places under `tsx` vs the bundle (`tray.ts` resolves defensively). `systray2` is **external + vendored** in the build; best-effort (any failure → null, app keeps running).
- **Two backup concepts, don't conflate:** `src/lib/backup.ts` = per-resume client download (`resumestudio/v1`); `server/backup.ts` = whole-store sync file (`resumestudio-store/v1`).
- **In-app settings are desktop-only.** The launcher sets `RESUME_DESKTOP=1`; `settings.ts → isDesktop()` gates the editable surface. `loadOrInitSettings()` seeds `settings.json` from env, then `applyToEnv()` pushes it back onto `process.env` so the lazily-env-reading translate/backup code picks up changes with no restart. Keep translate/backup reading **env**; route runtime changes through `applyToEnv` (+ `reconfigureBackup` for the stateful scheduler). VPS never sets `RESUME_DESKTOP` → `/api/settings` reports `managed:false`, PUT 403s.
- **Managed translate = the app drives Docker** (it doesn't bundle the engine). `translateDocker.ts` shells out argv-only; best-effort, never throws into the request path. After changing translate settings the client calls `resetTranslationAvailability()`. Keys are write-only over the API (`toView()` returns `*_set` booleans, never the value).
- **Auto-update = staged-swap, not Electron.** `updater.ts` checks GitHub Releases, downloads the per-platform `.tar.gz` (host-allowlisted — SSRF guard), extracts with system `tar`, validates the tree. To replace files a running process can't overwrite (esp. `node.exe` on Windows) it writes a detached per-OS swap script (`buildSwapScript`) that waits for our PID, mirrors the staged build over `RESUME_INSTALL_DIR`, relaunches, and self-deletes. Gated by `isUpdateSupported()` — VPS reports `supported:false` and 403s (a server must never rewrite its own files). `RESUME_NO_UPDATE` disables; `RESUME_UPDATE_REPO` overrides. Keep `assetNameFor` in `updater.ts` and its copy in `build-desktop.mjs` in sync.
- **Version source of truth (don't reintroduce the v0.3.2 drift bug).** A *published* build's version is the **git tag** — `release.yml` derives it from `GITHUB_REF_NAME`, exports `RESUME_APP_VERSION`, and **hard-fails if `package.json` doesn't match the tag**. To cut a release: bump `package.json` **and** `package-lock.json`, commit, then tag `vX.Y.Z`. Local `npm run build:desktop` (no env) uses `package.json`.
- **Windows update UX:** the swap is a **visible PowerShell window** with a progress bar (`Wait-Process`, file-by-file `Copy-Item`); the **relaunch is windowless** via `wscript.exe` (invoked by name — never by file association, which opened a text editor and was the original install bug) running `Resume Studio (no window).vbs`. POSIX stays a detached `sh` script. See `DESKTOP.md §6`.
