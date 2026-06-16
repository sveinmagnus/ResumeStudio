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
- **Multi-resume** — one instance can hold N distinct master CVs. Picker
  route at `/`; each resume lives at `/r/:uuid`; header dropdown switches
  between them; hard-delete with confirm (snapshots cascade). Each resume
  carries its own per-resume primary/secondary locales server-side. See §8.
- **Auto-save** to an Express + SQLite backend (debounced ~1s) — sends the
  resume payload + locales in a single PUT per mutation. **Per-id
  localStorage fallback** so a server outage never costs work.
- **Auth-gated server** (token-based, see `.env.example`). The browser exchanges
  the token for an **HttpOnly session cookie** via `/api/auth/login` (so the
  token never lives in JS-readable storage); `Authorization: Bearer` still works
  for non-browser clients. Falls back to a local-only mode if unreachable.
  **Named tokens** (`RESUME_API_TOKENS=name:token,…`) give a small team
  per-person tokens whose names stamp `saved_by` on saves/snapshots — shown on
  picker cards and in History. Attribution only, no permissions model.
- **Storage readout** — `GET /api/resumes/storage` measures each resume's
  payload (and embedded-image share); the picker warns at 1 MB / 2.5 MB
  (localStorage-quota risk) and shows the DB size in the footer.
- **Skill-taxonomy integration (Quadim library)** — the skill autocompletes
  offer canonical names (committed slim JSON, lazy chunk; `lib/skillTaxonomy.ts`)
  so new skills don't mint near-duplicates; free-text imports are
  **normalized** to canonical spellings (`lib/skillNormalize.ts`); the Skill
  Registry suggests **related skills** from the relatesTo graph; and imported
  skills carry an authoritative **classification** surfaced as the skill-matrix
  Category column.
- **Freshness & expiry warnings** — the Overview's "Needs attention" panel
  flags expired/expiring certifications and long-running "ongoing" items, and
  the picker badges resumes not updated in 6+ months (`lib/freshness.ts`).
- **Targeted exports via Resume Views** — pick sections, exclude items,
  starred-only filter, custom intro, then export PDF (browser print pipeline),
  DOCX (lazy-loaded docx lib), or ATS-friendly **plain text / Markdown**
  (`lib/viewText.ts`). A **live preview pane** in the view editor re-renders
  the document as you tune it (iframe + page-count estimate). All render
  paths share the **section-descriptor catalog** (`lib/sectionCatalog.ts`).
- **View power features** — named **export templates** seeding
  style/header/footer (`lib/viewTemplates.ts`), **BYO-LLM tailoring** from a
  pasted job posting (`lib/viewTailor.ts`, no API key), a per-view
  **anonymization toggle** (`force_anonymized` — anonymized customers +
  initial-redacted references), and a synthetic **Skill Matrix** section
  (skill × years × proficiency × last-used; `lib/skillMatrix.ts`).
- **View customization** — per-view styling (density, body size, heading font,
  accent color, page margin, tag style; `lib/viewStyle.ts`), per-section detail
  levels (off / summary / full) and style overrides, a configurable
  **header/footer** (which contact fields show, labels, separators, name/title
  type sizing, profile photo + company logo placement, footer copyright/note;
  `lib/viewHeader.ts`), and per-section sort modes (`lib/sectionSort.ts`).
  **Untrusted view config (from imports) is sanitised at the render boundary —
  see the security skill before touching `viewStyle`/`viewHeader`/`viewFilter`.**
- **Richer content** — limited **rich-text** descriptions (bold/italic/underline/
  lists via an allowlist sanitiser, `lib/richText.ts`), uploaded profile photo +
  company logo (canvas-downscaled to data URLs, `lib/image.ts`), and additional
  sections: **Key Competencies**, **Recommendations**, and a synthetic
  **Promoted Projects** view section (the starred projects).
- **CVpartner JSON import** and **portable JSON backup** (export + load) with
  a versioned format and a migration scaffold. Loading either kind of file
  from the picker creates a new resume (the in-editor "load file" button is
  gone — backup load is picker-only). The picker also imports **LinkedIn data
  exports** (.zip of CSVs, lazy fflate; `lib/importerLinkedIn.ts`) and
  **Europass CVs** (SkillsPassport XML + profile JSON;
  `lib/importerEuropass.ts`).
- **AI-assisted import from PDF/Word** (`lib/aiImport.ts`,
  `components/AIImportModal.tsx`) — a *bring-your-own-LLM* flow, no external
  service or API key. The picker hands the user a downloadable template
  (`public/ai-import-template.md`, also served at `/ai-import-template.md`)
  describing a deliberately-simple exchange schema (`resumestudio-ai/v1`:
  plain strings, no ids, skills/roles by name). The user runs it in any LLM
  with their CV, pastes the returned JSON back, and `validateAIImport`
  (field-pathed errors) → `importFromAIDraft` (interns skills/roles into the
  shared registries, wraps strings as `LocalizedString`, links projects to
  jobs by employer name) builds a new resume after a preview. AI-format files
  dropped on the normal import zone are auto-routed too.
- **Translation assist** on every `DualField` secondary input: "Copy from
  primary" (no network) plus an optional "Draft translation" that proxies
  through the server to a self-hosted LibreTranslate instance (drafts are
  review-required). The Draft button only appears when the server reports a
  backend is configured (`LIBRETRANSLATE_URL`). See §8.
- **Server-side snapshot history**, **per resume** — every save appends a
  snapshot (deduped, last 50 kept *per resume*); the header's **History**
  button restores any of them. Each row **expands to show what changed** vs the
  previous snapshot — items added/removed by title, plus per-field character
  deltas that name the field and language box ("Description (Norsk): +42
  chars") — computed lazily by `lib/snapshotDiff.ts`. See §8.
- **Undo / redo** (Ctrl/Cmd+Z; redo on Ctrl/Cmd+Shift+Z **or** Ctrl/Cmd+Y)
  with debounced history.
- **Drag-and-drop reordering** (`@dnd-kit`) on every section that owns a
  `sort_order`; up/down arrow buttons kept for keyboard / accessibility.
- **Registry merge** — "Merge this skill/role/industry into…" rewrites every
  reference and deletes the source, via the generic descriptor-table
  `mergeRegistry(store, kind, source, target)` in `lib/merge.ts` (skills,
  roles, industries; the named wrappers stay for readability). Role merges also
  rewrite linked employments (`WorkExperience.role_id`) alongside
  `project.roles[].role_id`. **Industries** are the third registry kind:
  `Project.industry_id` links to `data.industries`, populated automatically by
  the shape-v3 migration (`migrate.ts → internIndustries` interns existing /
  imported free-text industries, deduped).
- **Global content search** (`lib/contentSearch.ts`) — a Ctrl/Cmd+K command
  palette (`GlobalSearch`) substring-searches every section, registry and the
  header, ranks title matches first, and jumps to the item.
- **Career timeline** — an Overview card (`lib/careerTimeline.ts`) showing
  employments + projects as an overlap-packed timeline with employment-gap
  detection.
- **Accessibility regression net** — `tests/components/a11y.test.tsx` runs
  jest-axe (dev-only) over the editor surfaces; keep new editors passing it.
- **Registry management** — Skill and Role lists carry an "Unused / Missing
  translation" filter bar; each card shows its usage breakdown as
  "N projects | M categor(y|ies)" (skills) or "N projects | M employments"
  (roles), and a per-card expansion lists the actual referencing items with
  click-to-jump. Project / tech-category skill chips are added through an
  **autocomplete** (existing skill OR auto-create from typed text); clicking
  an already-attached chip opens a `DualField` popover (the shared
  `TranslationPopover`) that edits the **registry** entry's translation (so the
  change propagates to every reference). The **same chip + autocomplete +
  dual-language popover** pattern is used for **project roles** and the
  **employment role link** (picking an existing role fills both languages; the
  popover edits the registry Role), plus linking a reference to a project /
  employment.
- **React error boundary** around the editor so a crashed view never traps the
  user.
- **Downloadable desktop build** — a portable folder (bundled Node + esbuild'd
  server + built client) with a double-clickable launcher that boots the app on
  a free loopback port and opens the browser. Data lives in a stable per-user OS
  folder; an optional **whole-store JSON backup** written to a cloud-synced
  folder (Google Drive/Dropbox/OneDrive) syncs CVs across computers via a
  newest-wins merge on launch. Build with `npm run build:desktop`. See §14 and
  `DESKTOP.md`. The persistence architecture is unchanged, so a later move to
  Electron is repackaging, not a rewrite.
- **Automatic updates (desktop build)** — the system-tray "Check for updates"
  item (plus an in-app picker banner + Settings → Updates) checks GitHub
  Releases daily / on demand, toggles to "Install update (vX.Y.Z)" when a newer
  release exists, and on click downloads the per-platform `.tar.gz` and swaps
  the build in place via a detached per-OS script, then relaunches. Desktop-only
  + `isUpdateSupported()`-gated (the VPS build reports `supported:false`). No
  Electron, no code signing. See §14 and `DESKTOP.md` §6.

What's intentionally simple:
- The **router** is a hand-rolled ~150-line History API hook
  (`src/lib/router.ts`) — no dep. Routes: `/` picker, `/r/:id` editor,
  `/r/:id/:section` (active section in the URL — refresh keeps your place,
  Back walks sections), `/r/:id/views/:viewId` (one view open), plus a 404.
  The URL is canonical: `EditorRoute` two-way-syncs it with the store
  (URL→store first, store→URL second — order is load-bearing). Express prod
  has a catch-all so bookmarked URLs work.
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
| Persistence | Express + better-sqlite3 (multi-row `resumes` + scoped `resume_snapshots`) | See `server/`. Per-id localStorage fallback in `lib/localCache.ts` |
| Routing | Hand-rolled History API hook | `src/lib/router.ts` — `useRoute()`, `navigate()`, `<Link>`. No dep. |
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
- **Inline styles via `<style>` tag inside the component.** Each component owns its CSS. Tokens come from `src/index.css` (see section 6). The only utility classes in `index.css` are widely-shared widgets: `.check-row`, `.skip-link`, `.sr-only`.
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

```
src/
├── types/index.ts              ← single source of truth for the data model
├── store/
│   ├── useStore.ts             ← Zustand store + generic CRUD actions; currentResumeId; unloadStore()
│   ├── useUndoRedo.ts          ← Undo/redo hook (Ctrl/Cmd+Z), subscribes to mutationCount
│   ├── useResumePersistence.ts ← Per-id boot load + auto-save orchestration; takes resumeId
│   ├── useTranslation.ts       ← useTranslationAvailable() — memoized "is translate configured?" probe
│   ├── useSortedItems.ts       ← Apply a section's sort mode (lib/sectionSort) for display
│   └── useReorderGuard.ts      ← Blocks drag-reordering when a non-custom sort mode is active
├── lib/
│   ├── api.ts                  ← Server client (listResumes/createResume/loadResume(id)/saveResume(id,data,locales)/patchResume/deleteResume + snapshots + translate)
│   ├── backup.ts               ← Portable JSON backup format + migrateBackup() scaffold
│   ├── completeness.ts         ← PURE: translation completeness % + missing field paths per locale
│   ├── exporter.ts             ← LAZY-LOADED .docx generation (Cartavio brand, A4)
│   ├── freshStore.ts           ← emptyStore() / freshStore() factories (used by Zustand startFresh + the picker create flow)
│   ├── importer.ts             ← CVpartner JSON → ResumeStore
│   ├── localCache.ts           ← Per-id localStorage fallback (saveCache(id, data) etc.); clearAllCaches(); dropLegacyCache()
│   ├── locales.ts              ← LOCALE_LABELS, resolve(), bcp47() (app code → lang attr; se→sv, dk→da), fmt*(), fmtRelativeTime(), detectLocalesInData(), sortLocales()
│   ├── merge.ts                ← mergeSkills / mergeRoles + reference counts (role merges rewrite work_experiences[].role_id too)
│   ├── migrate.ts              ← PURE: data-shape migrations + CURRENT_SHAPE_VERSION; migrateStore() is the single choke point for data entering the app (loadStore + snapshot restore)
│   ├── usage.ts                ← PURE: usageOfSkill / usageOfRole — enumerate referencing projects, employments, tech-categories; isSkillUnused / isRoleUnused for the "Unused" registry filter
│   ├── router.ts               ← Hand-rolled History API router: useRoute(), navigate(), <Link>, parseRoute()
│   ├── sections.ts             ← Section definitions + groups; GROUP_ORDER (sidebar renders export-first, decoupled from SECTIONS order); canonicalSectionKey() folds key_qualifications/key_competencies into the profile_competencies page
│   ├── translateClient.ts      ← PURE: app→service locale map, canDraftBetween(), memoized availability probe
│   ├── connectivity.ts         ← navigator.onLine + health-poll confirmation; subscribeOnline() drives the reconnect drain
│   ├── syncEngine.ts           ← PURE sync decisions (decideBoot/selectDrainTargets) — boot/drain matrix, unit-tested w/o timers
│   ├── diffResume.ts           ← PURE: section/profile diff summary for the ConflictModal
│   ├── richText.ts             ← PURE-ish: limited rich-text (b/i/u/ul/ol/li) — sanitizeRich allowlist + renderRichHtml (HTML) + parseRichBlocks (DOCX). SECURITY-CRITICAL render path
│   ├── viewStyle.ts            ← PURE: ViewStyle → concrete tokens (deriveTokens); sanitizeHexColor; resolveFontCss — render-boundary validation of view styling
│   ├── viewHeader.ts           ← PURE: header/footer config defaults + builders; withHeaderDefaults/withFooterDefaults sanitise untrusted view config
│   ├── sectionSort.ts          ← PURE: per-section sort (custom / alphabetical / start / end / date)
│   ├── image.ts                ← Profile-photo/logo helpers: canvas downscale → data URL (browser); imageInfoFromDataUrl (PURE, for DOCX). Rejects SVG
│   ├── wipeLocale.ts           ← PURE: remove a locale's content across the store (language-config tool)
│   ├── sectionCatalog.ts       ← PURE: section-descriptor catalog (A5) — one descriptor per content section feeds editor titles + ALL render adapters. Returns data only; adapters own escaping
│   ├── viewTemplates.ts        ← PURE: named export templates (F1) — presets seeding style/header/footer + section detail via template_id
│   ├── viewTailor.ts           ← PURE: BYO-LLM view tailoring (F2) — prompt bundle, resumestudio-tailor/v1 validation (field-pathed), applyTailorResponse
│   ├── viewText.ts             ← PURE: ATS plain-text + Markdown exports (F6) — third render adapter over the catalog
│   ├── skillMatrix.ts          ← PURE: skill-matrix rows (F9) — registry + project usage → years/proficiency/last-used + authoritative Category (F12 pt4)
│   ├── careerTimeline.ts       ← PURE: career-timeline model (F15) — employment/project bars, lane packing, employment-gap detection, year ticks
│   ├── contentSearch.ts        ← PURE: global content search (F16) — recursive string collector over the store + ranked hits with snippet + authoritative Category (F12 pt4)
│   ├── skillTaxonomy.ts        ← Quadim skill-library data (F12): lazy generated JSON (names/relations/classifications) + PURE matchTaxonomy / relatedSkillSuggestions (regen: scripts/build-skill-taxonomy.mjs)
│   ├── skillNormalize.ts       ← PURE: canonicalize imported skill names to library spelling + stamp classifications (F12 pt2/4); free-text importers only, not backups
│   ├── freshness.ts            ← PURE: freshness/expiry warnings (F3) — expired/expiring certs, stale 'ongoing' items, isResumeStale; deterministic via injected `now`
│   ├── importerLinkedIn.ts     ← PURE: LinkedIn data-export (CSV map) → ResumeStore; RFC4180 parseCsv. ZIP extraction lives in ImportScreen (lazy fflate)
│   ├── importerEuropass.ts     ← Europass import: SkillsPassport XML (DOMParser) + profile JSON → ResumeStore
│   ├── storage.ts (src/lib)    ← PURE: payload-weight thresholds + fmtBytes for the picker readout (server twin: server/storage.ts)
│   └── viewFilter.ts           ← Apply a ResumeView (detail/exclusions/starred/force_anonymized); buildViewHtml() for PDF/preview. escapeHtml. SECURITY-CRITICAL render path
├── components/
│   ├── ErrorBoundary.tsx       ← Wraps the editor; resets on activeSection change
│   ├── ResumeList.tsx          ← Picker route (/): card list + "Add resume" panel + delete confirm
│   ├── ImportScreen.tsx        ← Callback-driven import UI: onStartFresh / onImported(store, suggestedName) + compact mode
│   ├── AuthGate.tsx            ← Token-entry modal shown on 401 (onSubmit → App-level handler)
│   ├── SnapshotHistory.tsx     ← Per-resume version-history modal: takes resumeId; restore via replaceData
│   ├── ConflictModal.tsx       ← Non-blocking 409 conflict UI: diffResume summary + keep-mine / discard-mine
│   ├── NewerDataNotice.tsx     ← Dismissible editor warning when the loaded resume was saved by a newer build (dataFromNewerApp — see lib/migrate.ts)
│   ├── SyncPanel.tsx           ← Picker "Sync & backup" panel (desktop build only): status + Back up now / Restore from folder. Renders null when no sync folder is configured
│   ├── SettingsModal.tsx       ← Settings dialog (opened from the picker gear AND the editor-header cogwheel): translation mode (off / Docker-managed / remote URL) + sync folder + Updates (version + check). Read-only note when server reports managed:false
│   ├── UpdateBanner.tsx        ← Picker "Update available → Install" banner (desktop build); polls /api/update/status; renders null when unsupported/up-to-date
│   ├── AppHeader.tsx           ← Editor top bar: ResumeSwitcher (disclosure) + SaveStatus + undo/redo + LanguageSwitcher + History + backup-export + Settings cogwheel
│   ├── layout/
│   │   ├── Sidebar.tsx         ← Section navigation (groups render in GROUP_ORDER — export first; active item is canonicalSectionKey-aware)
│   │   ├── LanguageSwitcher.tsx ← Compact disclosure: one "EN / NO" trigger opens a popover with the primary/secondary/add selects, swap and re-detect
│   │   └── SaveStatus.tsx      ← Saving / Saved / Save failed / Local only / idle — persistent role=status live region
│   ├── ui/
│   │   ├── DualField.tsx       ← THE KEY COMPONENT — side-by-side localized input
│   │   ├── EditorCard.tsx      ← Collapsible card; drag handle + up/down arrows (via `sortable` prop)
│   │   ├── Fields.tsx          ← TextField, DateField, TagField (plain inputs)
│   │   ├── Autocomplete.tsx    ← Generic typeahead picker (full ARIA combobox) with optional "Add new" path. Used to attach skills to projects/tech-cats, roles to employments, and projects/employments to references.
│   │   ├── SortableList.tsx    ← DndContext + SortableContext wrapper (calls store.moveItem on drop)
│   │   └── useDialog.ts        ← Shared modal behaviour: initial focus, Tab trap, Esc close, focus restore — every overlay dialog uses it
│   └── editor/
│       ├── Overview.tsx        ← Dashboard with stats + translation %
│       ├── HeaderEditor.tsx    ← Personal Details — identity fields only (name/contact/title/links/photo/company); no tabs
│       ├── ProfileCompetenciesEditor.tsx ← "Profile & Competencies" page: ProfileEditor + KeyCompetenciesEditor under headings (replaces the old Personal Details sub-tabs)
│       ├── ProjectsEditor.tsx  ← Edit mode for projects (the richest editor)
│       ├── SimpleEditors.tsx   ← Work/Education/Courses/Certs/Positions/Presentations/Publications/Awards/Languages/Profile
│       ├── RegistryEditors.tsx ← Skill/Role/Reference/TechCat editors + Merge UI
│       └── ResumeViewsEditor.tsx ← View list + view editor (sections, items, options, Export PDF / Export DOCX)
├── App.tsx                     ← Route table: AuthGate / ResumeList (/) / EditorRoute (/r/:id[/:section|/views/:viewId]) / NotFound; URL⇄store section sync
├── main.tsx                    ← React entry
└── index.css                   ← Self-hosted @font-face + design tokens + focus-visible/forced-colors/reduced-motion globals + .check-row/.skip-link/.sr-only utilities

server/                         ← Express API + SQLite persistence
├── index.ts                    ← Bootstrap (VPS/dev entry): createApp() + app.listen() on a fixed port
├── app.ts                      ← createApp(): security headers, json, routers, static client serving (RESUME_CLIENT_DIR or prod dist)
├── auth.ts                     ← Auth middleware: accepts the HttpOnly session cookie OR `Authorization: Bearer` (env: RESUME_API_TOKEN, read lazily); constant-time compare; presentedToken/tokenIsValid/isAuthRequired
├── db.ts                       ← createResumeDb(path) factory + lazy singleton; multi-row `resumes` + scoped `resume_snapshots` (last 50/resume, deduped, ON DELETE CASCADE); dumpResumes/restoreResumes (store sync) + close() (WAL checkpoint); getDefaultDb/closeDefaultDb
├── config.ts                   ← PURE: resolvePaths()/defaultDataDir() — per-user data dir, db path, backup dir, log file (desktop build)
├── backup.ts                   ← Whole-store JSON backup format (StoreBackupV1) + atomic write/read + signature. NOT the per-resume client backup
├── backupScheduler.ts          ← Signature-gated periodic backup writer (start/flush/stop)
├── backupRuntime.ts            ← Process-wide holder for the active scheduler so the settings route can reconfigure it live (initBackupRuntime/reconfigureBackup/flushBackup/stopBackup)
├── settings.ts                 ← Desktop settings file (settings.json): load/save + applyToEnv onto process.env; isDesktop() gate; toView() masks the API key
├── translateDocker.ts          ← Optional managed Docker LibreTranslate: dockerAvailable/start/stop + translateReachable probe (spawn, argv-only)
├── translate.ts               ← LibreTranslate proxy: locale map, fetch w/ timeout (env: LIBRETRANSLATE_URL/_API_KEY, read lazily)
├── version.ts                  ← PURE-ish: APP_VERSION (RESUME_APP_VERSION env, baked into the desktop shims, else package.json under tsx). Used by the auto-updater
├── desktop/                    ← Desktop launcher (not used by the VPS entry)
│   ├── launcher.ts             ← Entry the portable build runs: data dir + free port + boot-restore + open browser + scheduler + tray + auto-update + graceful shutdown. No import.meta/__dirname so it bundles to CJS
│   ├── freePort.ts             ← Find a free loopback port (preferred → ladder → OS-assigned)
│   ├── openBrowser.ts          ← Zero-dep cross-platform default-browser opener
│   ├── notify.ts               ← PURE build{Notify,Confirm*}Command + best-effort native popup (info) + confirmInstall (interactive Install/Cancel: Win WinForms / mac osascript / Linux zenity)
│   ├── tray.ts                 ← System-tray icon (systray2): version header + Open + Check-for-updates + Install-update (2 items) + Quit; routeClick() pure dispatch + setUpdate() (live items); best-effort (null if no tray)
│   ├── trayIcon.ts             ← PURE: generates the tray icon (navy/cyan mark) via zlib — PNG (*nix) / ICO (Windows), no image dep
│   ├── updater.ts              ← Auto-updater core: PURE compareVersions/assetNameFor/isAllowedHost (SSRF) + checkForUpdate (GitHub) + downloadAsset/extractArchive(tar)/stageUpdate
│   └── updateRuntime.ts        ← Process-wide updater state holder (mirrors backupRuntime): init/getStatus/runCheck/runInstall/setTrayRefresher + PURE buildSwapScript (per-OS swap+relaunch)
└── routes/
    ├── auth.ts                 ← /api/auth: POST /login (token → HttpOnly cookie), POST /logout, GET /status. Rate-limited, NOT auth-gated
    ├── resume.ts               ← /api/resumes collection: list/create/load/save/rename/delete + per-resume /snapshots(/:sid)
    ├── translate.ts            ← GET /api/translate/status, POST /api/translate
    ├── backup.ts               ← /api/backup: GET /status, POST /now, POST /restore (reads RESUME_BACKUP_DIR lazily)
    ├── settings.ts             ← /api/settings: GET/PUT (desktop-gated) + POST /translate/test + POST /docker (start/stop/status)
    └── update.ts               ← /api/update: GET /status, POST /check, POST /install (desktop-gated via isUpdateSupported)

scripts/build-desktop.mjs       ← Assembles the portable release/ folder (esbuild bundle + dist + native deps + Node runtime + launcher shims). Run per target OS

tests/                          ← Vitest specs (see CI for the live count)
├── fixtures.ts                 ← Shared makeProject() / makeRole() / ... factories
├── setup-rtl.ts                ← jest-dom matchers + afterEach(cleanup) for component tests
├── helpers/store-reset.ts      ← resetStore() — restores the singleton store between component tests
├── backup.test.ts, completeness.test.ts, exporter.test.ts,
├── importer.test.ts, localCache.test.ts, locales.test.ts,
├── merge.test.ts, store.test.ts, translateClient.test.ts, viewFilter.test.ts
├── components/                 ← RTL tests (.test.tsx, jsdom) for every editor (Header/Projects/Registry/Simple/
│                                  ResumeViews/Overview), shell (AppHeader/Sidebar/AuthGate/ImportScreen/
│                                  LanguageSwitcher/SaveStatus/ErrorBoundary/SnapshotHistory/SyncPanel/SettingsModal) + ui (DualField/Fields/EditorCard/SortableList)
└── server/                     ← db (incl. dump/restore/close), config, backup, settings, translate, translateDocker, auth (direct) + routes (resume/backup/settings via supertest over createApp()), node env
```

### Layered design — these layers must stay clean
1. **`types/`** has zero runtime imports. Pure type definitions.
2. **`lib/`** is pure logic. No React. A few touch DOM/browser APIs but stay unit-testable (jsdom): `exporter.ts` (download anchor), `viewFilter.ts` (string-builds HTML), `localCache.ts` (localStorage), `richText.ts` (DOMParser, for the rich-text allowlist), and `image.ts` (`fileToResizedDataUrl` uses canvas; `imageInfoFromDataUrl` is pure). Each is easy to unit-test (see `tests/`).
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
- **`Industry`** (A8.1) lives in `data.industries`; `Project.industry_id` references it (with `Project.industry` kept as the denormalized name). Use `countIndustryReferences()`. All three kinds merge through the generic `mergeRegistry` / `countRegistryReferences`.
- **Snapshot names**: `ProjectSkill.name`, `CategorySkill.name`, `ProjectRole.name`, and `Project.industry` are denormalized copies of the registry's name at link time, so a registry rename doesn't silently rewrite history. `merge.ts` updates these snapshots when it rewrites references.

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
- **Re-detect locales** from the data — `LanguageSwitcher`'s re-detect button calls `detectAndSetLocales()` which scans every `LocalizedString` and merges any new locales into `resume.supported_locales`.

All of these controls live behind ONE compact header button (the
`LanguageSwitcher` trigger shows the current pair, e.g. "EN / NO", and opens a
popover) — language choice is a set-once setting and doesn't earn permanent
header space.

**Implementation:**
- `useStore().primaryLocale` and `useStore().secondaryLocale` (the latter can be `null` to mean "single column mode").
- The `DualField` component reads these directly and renders 1 or 2 inputs accordingly. Components calling `DualField` never need to know about locales — just pass the `LocalizedString` and a setter.
- The secondary input gets a subtle cyan tint (CSS var `--secondary-tint`) to distinguish from the primary (which uses the Cartavio navy accent on focus).
- `RichField` (the main multi-line description editor) **breaks out wider than
  the editor card in two-language mode** (`.rf-wide`, capped via
  `min(1400px, max(100%, calc(100vw - 350px)))`) so each language column gets a
  comfortable width when the viewport allows; single-language mode stays at the
  normal card width. The open `EditorCard` uses `overflow: visible` so the
  overhang isn't clipped.
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
--secondary-tint, --secondary-line, --secondary-ink /* Cartavio cyan #00B8DE — borders/washes/icons ONLY (2.4:1 on white) */
--secondary-ink-text (#007696)             /* the TEXT-safe cyan twin (≥4.5:1) — all cyan-family text uses this */
--ok-ink/--ok-wash, --warn-ink/--warn-wash, --err-ink/--err-wash  /* status pairs, every ink ≥4.5:1 on its wash AND on paper */
--gold (#9a7b3f)                           /* star/featured indicator */
--serif: 'Open Sans Condensed' weight 300  /* heading font — matches cartavio.no */
--sans: 'Ubuntu' + system                  /* body font — matches cartavio.no */
--r-sm/--r-md/--r-lg                       /* border radii */
--shadow-sm/-md/-lg
```

**Aesthetic:** Cartavio brand — pure white backgrounds, Cartavio navy (#002E6E) as the primary accent, cyan (#00B8DE) as the secondary/highlight. Open Sans Condensed (weight 300) for headings, Ubuntu for body. Colors and fonts verified directly from cartavio.no CSS. No warm/sepia tones, no oxblood. Brand skill: `.claude/skills/cartavio-brand.md`.

**Fonts are self-hosted** (`public/fonts/*.woff2` + `@font-face` in
`index.css`, preloaded from `index.html`) — no Google Fonts CDN request
(GDPR), works offline in the desktop build, and the CSP is `font-src 'self'`.
Don't reintroduce a fonts CDN.

**Minimum text size is 11px.** The 9–10px micro-labels were bumped in v0.3.1;
don't add new text below 11px.

**Utility classes in `index.css`** (use these instead of redefining inline):
- `.check-row` — inline checkbox + label row.
- `.skip-link` — visually hidden until keyboard-focused (first Tab stop in the editor).
- `.sr-only` — visually hidden, available to assistive tech.

`index.css` also owns the global `:focus-visible` ring, the `forced-colors`
outline fallback, and the `prefers-reduced-motion` collapse — don't duplicate
those per component (see the accessibility conventions in §2).

When adding a component, copy the inline `<style>` pattern from an existing one (e.g. `DualField.tsx`). Use the tokens, don't introduce new colors casually.

---

## 7. The store — patterns to follow

> Before changing `src/store/**`, `lib/localCache.ts`, or the auto-save / boot /
> undo flow, read the **store & persistence skill**
> (`.claude/skills/store-and-persistence.md`) — it spells out the
> `loadStore`-vs-`replaceData` split and the `mutationCount`/`mutate()` contract
> whose silent breakage has caused real bugs.

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

- **`loadStore(store, locales?)`** — I/O semantics. Use for **loading** data
  from the server or a file. Resets `mutationCount` to 0 (so no spurious
  auto-save fires and undo history starts fresh). The optional `locales`
  arg seeds primary/secondary from the resume row when the persistence hook
  has them; otherwise locales fall back to `supported_locales[0/1]`.
- **`replaceData(store)`** — in-app rewrite semantics. Use when you've
  **computed** a new store and want it treated as a user mutation. Bumps
  `mutationCount`, which means: auto-save will sync it, undo/redo will see it.
  Currently used by `useUndoRedo` and by the registry merge handlers.
- **`unloadStore()`** — eject the in-memory resume back to empty. The
  persistence hook calls this on unmount so a quick switch doesn't show
  stale data under the new id.

If you call `loadStore` for an in-app rewrite, the change will silently never
enter the undo stack and may not be saved.

### `mutationCount` and the `mutate()` helper

The store maintains a `mutationCount: number` that increments on every USER
mutation and resets on `loadStore`/`loadFromCVPartner`/`startFresh`/`unloadStore`. Auto-save
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
2. Add the empty array to both `emptyStore()` and `freshStore()` in `lib/freshStore.ts`.
3. Add an entry to `SECTIONS` in `lib/sections.ts`. The sidebar's *group*
   order comes from `GROUP_ORDER` (export-first), not from SECTIONS order —
   SECTIONS order still drives the view editor's default section sequence.
   If the section is edited on another section's page, extend
   `canonicalSectionKey()` so chrome + sidebar highlighting resolve.
4. Add the icon import to `Sidebar.tsx`'s `ICON_MAP`.
5. Create the editor component and wire it into `App.tsx`'s `EditorRoute`
   switch. The section key is automatically a valid URL segment
   (`/r/:id/<key>`) — EditorRoute validates against SECTIONS.
6. If the section has `sort_order`, wrap its `<EditorCard>`s in a `<SortableList section="…" ids={items.map(x=>x.id)}>`. If it doesn't, pass `sortable={false}` to each `<EditorCard>` so the drag handle isn't shown.
7. If it should appear in Resume View exports: add **one descriptor** to
   `lib/sectionCatalog.ts` (title/subtitle for the View-editor item list,
   `summary()` and `full()` data views — see the file header). Every render
   path (HTML/PDF, DOCX, plain-text/Markdown) consumes the catalog through its
   generic adapter, so there are no per-section switches left to extend.
   Descriptors return **data only** — the adapters own escaping
   (`escapeHtml`/`renderRichHtml` in `viewFilter`, `TextRun` in `exporter`);
   never build markup in a descriptor. Per-path differences go behind
   `ctx.target`. The section is picked up by views automatically via
   `isExportableSection` + `normalizeViewSections`; give it a
   `defaultViewDetail` if it shouldn't default to `full`. The
   **export-pipeline skill** (`.claude/skills/export-pipeline.md`) and the
   **security skill** still apply (lazy-load discipline, escaping cross-check).
8. If you add a configurable **style/header field** to a view (not just a
   content section), it is untrusted-import surface — sanitise it at the render
   boundary (`lib/viewStyle.ts → deriveTokens` / `lib/viewHeader.ts →
   withHeaderDefaults`) and add a breakout regression test. See the security
   skill before touching those files.
9. If the section is sortable by something other than `sort_order`, wire it
   into `lib/sectionSort.ts` (used by `useSortedItems` / `useReorderGuard`).

---

## 8. Persistence

### Architecture
- **Source of truth**: SQLite via the Express server (`server/db.ts`).
  Two tables: `resumes` (one row per CV — id, name, data, primary_locale,
  secondary_locale, saved_at, created_at, **version**) and `resume_snapshots`
  (FK `resume_id` with `ON DELETE CASCADE`, indexed by `(resume_id, id DESC)`).
  `version` is an optimistic-concurrency token — see *Offline editing* below.
- **Outbound queue / cache**: localStorage (`lib/localCache.ts`), keyed
  `resumestudio:store-cache:v1:<resume_id>` — one `PendingRecord` per resume
  (`{data, locales, base_version, dirty, dirty_since, saved_at}`). A dirty
  record is an unsynced edit awaiting a flush; it's both the offline fallback
  and the reconnect outbox.
- **In-memory**: the Zustand store holds one resume at a time;
  `currentResumeId` tracks which one.

### Routes (all auth-gated, under `/api/resumes`)
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/resumes` | Metadata list, newest `saved_at` first. Returns `{resumes: []}` (never 404) — empty list is the "fresh install" signal. |
| `POST` | `/api/resumes` | Body `{name, data?, primary_locale?, secondary_locale?}` → 201 with `{resume: ResumeMeta}`. |
| `GET` | `/api/resumes/:id` | `{data, meta}` (meta incl. `version`) or 404. Sets `ETag: "<version>"`. |
| `PUT` | `/api/resumes/:id` | Body `{data, primary_locale?, secondary_locale?, base_version?}` — locales optional but **must come in pairs** (400 if only one); `base_version` optional (non-neg int). 404 if id unknown; **409** `{error, current:{data,meta}}` if `base_version` is stale; else `{ok, saved_at, version}` + ETag. |
| `PATCH` | `/api/resumes/:id` | Rename only (`{name}`) — avoids re-sending the CV blob. |
| `DELETE` | `/api/resumes/:id` | Hard delete; snapshots cascade. 404 if already gone. |
| `GET` | `/api/resumes/:id/snapshots` | Metadata list (newest first). 404 if resume unknown. |
| `GET` | `/api/resumes/:id/snapshots/:sid` | One snapshot's full data. |

### Boot sequence — per active resume (`useResumePersistence(resumeId)`)
1. `api.loadResume(id)` — try the server. On hit, seed the base `version` +
   locales.
2. If a **dirty `PendingRecord`** also exists, trust *it* over the server copy:
   load the local data and flush it with its stored `base_version` (a clean
   push syncs; a stale base raises the non-blocking conflict). Otherwise load
   the server copy and drop any clean local record.
3. On 404 with server reachable, set `loadState='not-found'` — the editor
   redirects to `/`. **No cache fallback** for unknown ids.
4. On server unreachable, restore from `loadPending(id)` (+ its `base_version`),
   `saveState='offline'`, and kick a connectivity recheck.
5. On 401, set `loadState='auth'`; App shows the modal.

### Save sequence — per mutation (1s debounce)
1. Queue write debounced 250 ms via `savePending(id, {…, dirty:true})` — a
   durable copy with the current `base_version`.
2. Server `PUT /api/resumes/:id` debounced 1 s, body carries `{data,
   primary_locale, secondary_locale, base_version}` together. Locale-only
   changes ride along because the locale setters go through `mutate()`.
3. AbortController so a newer mutation supersedes an in-flight save.
4. On success → `clearPending(id)` (synced), advance the base `version`.
5. On 404 mid-save → redirect to `/`. On 401 → auth modal. On **409** → keep
   the local edits, pause auto-save, raise the `conflict` state. On a network
   failure (not a 5xx) → `saveState` = `offline` (connectivity down) or
   `queued` (still nominally online); the edit stays in the dirty queue.

### Offline editing & conflict safety
- **Sync decisions** are pure functions in `lib/syncEngine.ts` (`decideBoot`,
  `selectDrainTargets`) — the hook is thin glue, so the boot/drain matrix is
  unit-tested without timers or the DOM.
- **Connectivity** (`lib/connectivity.ts`): `navigator.onLine` + `online`/
  `offline` events, but recovery is confirmed by polling `api.health()` (the
  NIC being up ≠ the server answering). `subscribeOnline()` drives the drain.
- **Reconnect drain**: on a real offline→online transition (and on an online
  boot) the active resume re-flushes via `flushToServer` while **every other
  dirty resume** drains via `backgroundFlush` (a 409 there is left dirty so the
  conflict surfaces when that resume is next opened).
- **Unsynced visibility**: the header `SaveStatus` shows `offline`/`queued`
  with a multi-resume count; the picker marks dirty cards and notes the backlog.
- **Conflict** = a 409 from a stale `base_version`. The hook holds the server's
  `current` state as `conflict`; `ConflictModal` shows a `lib/diffResume.ts`
  summary (section counts **plus the labelled items that differ** + profile
  field diffs) and offers **keep mine** (re-PUT at the server's version) or
  **discard mine** (take server). Non-blocking: the editor stays usable, the
  `conflict` SaveStatus badge re-opens the modal.
- **Guards / security**: a `beforeunload` guard fires while `listDirty()` is
  non-empty; the logout button confirms before wiping unsynced work; a
  mid-session 401 clears the plaintext caches **only when nothing is unsynced**
  (closes security-review residual §4 without risking queued edits).

### Backup format
- `lib/backup.ts` defines `BackupV1` and `migrateBackup()`. The detector
  (`isBackupFormat`) is intentionally lenient — it accepts any envelope shape
  that smells like a backup, then `migrateBackup` decides if this build can
  read it (throws `UnsupportedBackupVersionError` otherwise).
- Backup is **per-resume** (decision 3): `downloadBackup` writes the active
  resume; loading a backup file from the picker creates a **new** resume
  rather than replacing one. The in-editor "load file" affordance is gone.

### Snapshot history (server-side, per resume)
- `saveResume(id, data, locales?, expectedVersion?)` in `server/db.ts` runs in
  a transaction: it bumps `version`, updates the `resumes` row **and** appends
  to `resume_snapshots` scoped by `resume_id`. A stale `expectedVersion`
  short-circuits to a `conflict` result (nothing written, no snapshot).
- Identical-to-last-snapshot saves are deduped per resume. Pruning keeps the
  newest **50** per resume — not global.
- **Snapshots are stored image-free**: `db.ts → stripSnapshotImages` drops the
  base64 `profile_photo`/`company_logo` and per-view header overrides from the
  snapshot copy (the live `resumes` row keeps them), and dedupe compares the
  stripped JSON — so an image-only edit doesn't mint a snapshot. On restore the
  client re-attaches the *current* images (`lib/snapshotImages.ts →
  reattachImages`); a pre-strip snapshot that still carries images keeps its own.
- The **History** modal (`SnapshotHistory.tsx`, takes `resumeId`) restores
  via **`replaceData`** (not `loadStore`) so a restore is itself a user
  mutation: it lands in the undo stack and is re-saved. Reversible.

### Data-shape versioning (`lib/migrate.ts`)
- `ResumeStore.shape_version` stamps the content shape (absent = pre-versioning
  = 1; `CURRENT_SHAPE_VERSION` = 3 — v3 added the Industry registry +
  `industry_id` and interns existing industry text). **Bump only for structural
  migrations** (a new top-level array that code iterates counts) — additive
  optional fields stay covered by `with*Defaults` render tolerance.
- `migrateStore()` is the single choke point for data entering the app from
  outside: `loadStore` runs it on every load; the snapshot-restore site calls
  it before `replaceData`. `replaceData` itself never migrates — in-app
  computed data (undo, merges) is current by construction.
- Migrations are **idempotent shape-sniffers** (unstamped legacy data is the
  norm in the wild); the stamp short-circuits the chain when current.
- Data from a NEWER build loads **best-effort**: stamp is never downgraded
  (unknown fields survive — the store only spreads/shallow-merges) and the
  editor shows a dismissible warning (`dataFromNewerApp` →
  `NewerDataNotice`). Real scenario: cloud-folder sync between an
  auto-updated machine and a stale one.
- The per-resume backup envelope carries `shape_version` alongside its own
  `format_version` (envelope vs. content versioning — don't conflate).

### Translation assist (server-side proxy)
- The client never calls a translation backend directly. `POST /api/translate`
  (auth-gated) proxies to whichever **provider** is configured. URLs/keys stay
  server-side (the client reads no env vars — §2), CV text flows server→provider,
  and there's one auth perimeter.
- **Pluggable providers** (`server/translate.ts`): `TRANSLATE_PROVIDER` ∈
  `off | libretranslate | deepl | google | azure`. `resolveConfig(env)` reads the
  provider + its key(s) lazily; `translate()` dispatches to the matching backend;
  `isTranslationConfigured()` is provider-scoped. **Back-compat:** if
  `TRANSLATE_PROVIDER` is unset but `LIBRETRANSLATE_URL` is set, it defaults to
  `libretranslate` (so old env-only deployments keep working). Per-provider env:
  `LIBRETRANSLATE_URL`/`_API_KEY`, `DEEPL_API_KEY` (Free vs Pro auto-detected from
  the `:fx` suffix → different host), `GOOGLE_TRANSLATE_API_KEY`,
  `AZURE_TRANSLATOR_KEY`/`_REGION`. Each provider has its own locale map (DeepL
  uppercases + needs `EN-GB` for an English target; Azure uses `nb`; Google uses
  `no`). Errors never echo upstream detail (could leak an internal URL/key).
- A near-identical app-locale map lives in `lib/translateClient.ts` for display
  gating — kept duplicated rather than coupling the two build trees; both tiny.
- `GET /api/translate/status` reports `{configured}`; the client memoizes this
  once (`getTranslationAvailability`) so N `DualField`s share one probe, and the
  "Draft translation" button only renders when it's `true`. Drafts are always
  framed as review-required.

---

## 9. Importer notes (CVpartner format)

> Full detail in the **CVpartner import skill**
> (`.claude/skills/cvpartner-import.md`) — format quirks, importer invariants,
> and the table-test discipline. Read it before touching `importer.ts` /
> `migrate.ts`.

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

**Before writing tests or doing QA, read the testing skill:
`.claude/skills/software-testing.md`** — it captures how to write tests that
actually find bugs, the typecheck/test/build gate, regression-test discipline,
and how to verify live without fooling yourself.

### Running
```
npm test                  # one-shot, headless
npm run test:watch        # watch mode
npm run test:coverage     # v8 coverage in coverage/
```

### What's covered
- **`lib/`** — every pure-logic library has a `.test.ts`: `locales`,
  `completeness`, `viewFilter`, `backup`, `importer`, `merge`, `exporter`
  (smoke test with jsdom), `localCache` (jsdom), plus the view-rendering /
  styling modules `viewStyle`, `viewHeader`, `richText`, `image`,
  `sectionSort`, and the offline-sync modules `syncEngine`, `diffResume`,
  `connectivity`, `wipeLocale`, and the client `api` (mocked `fetch`).
  The **security-regression** suites live in `viewFilter.test.ts`
  ("HTML escaping (XSS)" — escaping + `<style>`/attribute breakout via crafted
  view config), `viewStyle.test.ts` (`sanitizeHexColor`, enum-fallback), and
  `viewHeader.test.ts` (boundary validators).
- **`store/useStore.ts`** — generic CRUD, `moveItem`/`reorderItem`, `mutationCount` semantics (every mutator bumps once, no-ops don't bump, `loadStore` resets, `replaceData` bumps).
- **React components** — `tests/components/*.test.tsx` via React Testing Library cover every editor, the shell components, and the ui primitives (render → interact → assert through the store). See "Component tests" below.
- **The Express server** — `tests/server/*.test.ts` (node env): `db` (multi-
  resume CRUD, snapshot dedup/prune *scoped per resume*, CASCADE on delete,
  via `createResumeDb(':memory:')`), `translate` / `translateDocker`,
  `settings`, `config`, `backup`, `auth` (the bearer **and cookie** token
  matrix on the middleware), and the route suites (`resume`, `settings`,
  `backup`, and `authRoutes` — login/logout/status + the cookie→authorized
  round-trip) via **supertest** against `createApp()` with
  `RESUME_DB_PATH=':memory:'`.
- **Test fixtures** — `tests/fixtures.ts` exports `emptyStore()` + `makeProject()`, `makeWork()`, etc. Use these instead of constructing entities inline so future shape changes are one-place fixes.
- **E2E smoke (Playwright)** — `e2e/smoke.spec.ts` boots the REAL production
  server (built client + Express + in-memory DB, see `playwright.config.ts`)
  and drives a browser through create → edit/auto-save/reload → view preview →
  unknown-id bounce. Run with `npm run test:e2e` (builds first); CI runs it as
  its own job. Keep it thin — happy paths only, the integration class of
  regression (wiring, routing, CSP, lazy chunks); behavior detail belongs in
  Vitest. The `webapp-testing` skill covers ad-hoc Playwright driving.

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
npm run test:e2e         # build + Playwright smoke suite (e2e/, real server)
npm run typecheck        # client + server tsc
npm start                # production server (NODE_ENV=production)
npm run desktop          # build client + run the desktop launcher from source (tsx)
npm run build:desktop    # assemble the portable release/ folder (per target OS)
```

### Verifying changes
After any significant change:
1. `npm run typecheck` — must be clean.
2. `npm test` — must be green.
3. `npm run build` — must be clean (catches things tsc misses).
4. For UI changes, open the dev server and click through the affected flow. CI runs all three.

For QA depth and live-verification discipline, see the testing skill
(`.claude/skills/software-testing.md`). Before committing anything that touches
HTML/string templating, the server, auth, persistence, imports, or exports,
also run through the security skill (`.claude/skills/security-review.md`).

### Server / env
- Copy `.env.example` to `.env` and set `RESUME_API_TOKEN` for a deployed instance. Leaving it empty disables auth — fine for local dev.
- `data/resume.db` is the SQLite file; it's gitignored. WAL mode is on.
  Foreign keys are on (required for snapshot CASCADE — SQLite default is OFF).
- The schema is **multi-resume** — `resumes` (one row per CV) +
  `resume_snapshots` (FK with `ON DELETE CASCADE`). On boot, `createResumeDb`
  defensively `DROP TABLE IF EXISTS resume_store` to clean up the
  pre-multi-resume single-row table if a stale dev DB is around.
- API surface: `/api/resumes` (collection) and `/api/resumes/:id/...` —
  full grammar in §8.
- **Hardening (`server/app.ts`):** a `Content-Security-Policy` plus the
  existing `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy`/
  `Permissions-Policy` headers ride on every response (the CSP is inert on
  JSON, active on the prod-served shell — `'self'` scripts/fonts + inline
  styles; fonts are self-hosted since v0.3.1, no Google Fonts hosts; see the
  comment in `app.ts`). The auth-gated API
  is rate-limited with a **failure-focused** limiter (`skipSuccessfulRequests`
  — only ≥400 responses count, so brute-force/floods get 429'd but auto-save
  doesn't), tunable via `RESUME_RATE_LIMIT_MAX` / `RESUME_RATE_LIMIT_WINDOW_MS`.
- **DB file ACLs:** `createResumeDb` chmods a file-backed DB to `0600` and
  `defaultDb` tightens `data/` to `0700` (covers the WAL/SHM sidecars).
  Best-effort — a no-op on Windows, never fatal.
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
> editor, field-level translation assist (Copy + provider-proxied Draft),
> server-side snapshot history, **multi-resume support**, **offline editing +
> conflict safety**, the **downloadable desktop build + cross-computer JSON
> sync**, and the June 2026 wave: **section-descriptor catalog**
> (`lib/sectionCatalog.ts` — one descriptor feeds the editor titles + all
> render adapters), **export templates** (`lib/viewTemplates.ts`, via
> `template_id`), **BYO-LLM view tailoring** (`lib/viewTailor.ts`, paste a job
> posting), **per-view anonymization** (`force_anonymized`), **ATS plain-text
> + Markdown exports** (`lib/viewText.ts`), **LinkedIn + Europass importers**,
> the **skill-matrix view section** (`lib/skillMatrix.ts`), **named tokens +
> saved_by attribution** (`RESUME_API_TOKENS`), the full **Quadim
> skill-taxonomy integration** (`lib/skillTaxonomy.ts` autocomplete + relations;
> `lib/skillNormalize.ts` import normalization + classification stamping; the
> matrix Category column), the **storage readout** (`server/storage.ts` +
> picker weight warnings), **freshness & expiry warnings** (`lib/freshness.ts`
> — Overview "Needs attention" + picker staleness), and a **per-view export
> locale** (`export_locale`). The July 2026 wave added: the **generic
> `mergeRegistry`** + an **Industry registry** (third mergeable kind;
> `Project.industry_id`, shape v3 migration interns existing/imported industry
> text), an **accessibility audit** (jest-axe regression suite + fixed
> unlabelled controls), the **career-timeline** Overview card
> (`lib/careerTimeline.ts`), and **global content search**
> (`lib/contentSearch.ts` + `GlobalSearch` palette, Ctrl/Cmd+K). See §1, §14,
> `plans/improvement-roadmap.md`, and `DESKTOP.md`. **A4 Phase 2**
> (content-addressed asset table) was deliberately deferred — measurement infra
> shipped; build the table only when real data warrants. **F4/F8** (application
> log, cover letter) were dropped as out of scope.
>
> The **v0.3.1 UX/accessibility wave** (12 `ux/*` branches) also shipped:
> programmatic labels + per-locale `lang` everywhere (`bcp47()`), live
> regions for save status/errors, keyboard paths (import drop zone,
> EditorCard toggle), shared modal focus management (`ui/useDialog.ts`),
> WCAG-AA contrast tokens (`--secondary-ink-text`, `--ok/warn/err-*`),
> global focus-visible/forced-colors/reduced-motion handling, responsive
> DualField stacking, **URL-carried sections** (`/r/:id/:section`), full
> combobox ARIA, **self-hosted fonts**, skip link, and meta polish. The
> follow-up wave: **export-first sidebar** (`GROUP_ORDER`), the **compact
> language-switcher popover**, a **global settings cogwheel** (editor
> header), and the **Profile & Competencies page** replacing the Personal
> Details sub-tabs (`canonicalSectionKey()` keeps old deep links working).

### 12.1 Remaining watchlist (deferred until forced)
- **Cross-tab BroadcastChannel lock**: two tabs editing one resume share a
  localStorage pending slot; the server `version` check makes it *safe* (the
  second flush 409s into the conflict modal), just not tidy.
- **UI-chrome localization**: app labels are English-only. A dictionary-based
  `t()` for chrome strings is plausible for the Norwegian market but taxes
  every component forever — decide once and record it here either way.
- (Done July 2026: **generic `mergeRegistry`** — `lib/merge.ts` is now a
  descriptor-table engine over skills/roles/industries; the **accessibility
  audit** — jest-axe suite in `tests/components/a11y.test.tsx`.)

### 12.2 Image asset table (A4 Phase 2)
Snapshots are image-free and the picker now measures payload weight (`GET /api/resumes/storage`), but every auto-save PUT and localStorage pending record still carries the embedded base64 images. If real-world measurements show quota risk, move to a content-addressed `assets` table (`hash → bytes`) with `asset_id` references — touches exporter/viewFilter (resolve at render), the backup format (embed on export), and localCache.

### 12.3 Offline-load (PWA / service worker) — *deferred Tier 3*
Offline *editing* shipped (durable queue + reconnect drain + conflict safety —
see §8). What's still not possible is *loading* the app with no network: there's
no service worker caching the shell + assets, so a cold start offline fails. A
PWA layer (SW caching index.html/JS/CSS/fonts, an update-prompt for version
skew, offline fallback for the lazy exporter chunk) would close that. Multi-day;
only worth it if "open and edit with zero connectivity" becomes a real need.
See `plans/offline-editing.md` (Tier 3, explicitly out of scope for the shipped
work) for the analysis.

### 12.4 Cross-tab coordination
Two tabs of the same browser editing one resume share a single `localStorage`
pending slot and can interleave writes. The server `version` check prevents
*server* clobber (the second tab's flush 409s into the conflict modal), but a
`BroadcastChannel` lock would stop the local thrash and let tabs hand off
cleanly. Low priority — the conflict path already makes it safe, just not tidy.

## 13. Working with this project in Claude Code

A few tips specifically for this codebase:

- **`knowledge.yaml` (repo root) is a KCP manifest** — a machine-navigable index
  of every knowledge artifact here (this file, the `.claude/skills/`, `DESKTOP.md`,
  `plans/`, the docs site, CI policies) with intent, dependencies, and freshness
  (`validated`) metadata. When deciding *which* doc/skill to read for a task,
  consult it; when you change a document, update its unit's `validated` date.
  Spec: https://github.com/Cantara/knowledge-context-protocol
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

---

## 14. Desktop build & cross-computer sync

Full end-user + build docs live in **`DESKTOP.md`**. Key facts for working here:

- **Two server entries, one app.** `server/index.ts` is the VPS/dev entry (fixed
  port, `tsx`). `server/desktop/launcher.ts` is the desktop entry. Both call the
  same `createApp()`. Don't fork app logic per entry — differences are env/wiring
  only.
- **The launcher is bundled to CJS** by `scripts/build-desktop.mjs` (esbuild,
  `better-sqlite3` external). Because of that, **launcher code must not use
  `import.meta`/`__dirname`** — it relies on env + `process.cwd()`. `app.ts` and
  `db.ts` guard their `import.meta.url` (`import.meta.url ? … : process.cwd()`)
  because esbuild emits `""` for it in the bundle; don't "simplify" that back to
  a bare `fileURLToPath(import.meta.url)` or the bundle crashes at boot.
- **Paths come from `server/config.ts`** (pure). The launcher sets
  `RESUME_DB_PATH` + `RESUME_CLIENT_DIR` from it before `createApp()`/first DB
  use, so `db.ts`/`app.ts` pick them up through the env vars they already honour.
- **Data dir** is per-user OS-standard (`%APPDATA%\ResumeStudio`,
  `~/Library/Application Support/ResumeStudio`, `~/.local/share/resume-studio`),
  overridable via `RESUME_DATA_DIR`. This matches what Electron's
  `app.getPath('userData')` would give — deliberate, for the eventual migration.
- **Sync model = whole-store JSON backup, NOT the live DB in the cloud folder.**
  `RESUME_BACKUP_DIR` (e.g. a Google Drive folder) holds one
  `resume-studio-backup.json` written atomically. The launcher merges newer
  content from it on boot; the `BackupScheduler` keeps it current while running;
  the picker `SyncPanel` exposes Back-up-now / Restore. Merge is **newest-wins
  per resume by `saved_at`, union, never deletes** (`db.restoreResumes`, `merge`
  mode). `replace` mode (deletes local rows absent from the backup) exists but is
  not wired to any always-on path. Putting the live SQLite file in a sync folder
  is intentionally avoided (corruption risk); `RESUME_DB_JOURNAL=TRUNCATE` is the
  documented escape hatch if someone insists.
- **`db.close()`** does `wal_checkpoint(TRUNCATE)` then close — the launcher
  calls it (via `closeDefaultDb()`) on shutdown so the `.db` is self-contained at
  rest. Keep shutdown ordering: `tray.kill()` → `flushBackup()` →
  `closeDefaultDb()` → `server.close()`.
- **System-tray icon = the user's Quit affordance** (`desktop/tray.ts`, built on
  `systray2`). Tray Quit calls the same `shutdown()` as Ctrl-C/signals — never
  add a "quit" control to the web UI (it'd error other open tabs). Two gotchas
  that cost real debugging: (1) **register `onClick`/`onError` only after
  `await systray.ready()`** — `init()` is async, so `_process`/`_rl` are null
  before then and `onError` dereferences null; (2) the CJS↔ESM default-import
  interop puts the `SysTray` constructor in different places under `tsx` vs the
  esbuild bundle — `tray.ts` resolves it defensively. `systray2` is **external +
  vendored** in the build (like `better-sqlite3`); esbuild mangles its
  stdio/readline wiring if bundled. The build copies its dep closure into
  `app/node_modules` and prunes `traybin/` to the current platform. The tray is
  best-effort: any failure logs and returns null, app keeps running.
- **Two backup concepts, don't conflate:** `src/lib/backup.ts` =
  per-resume client download (`resumestudio/v1`); `server/backup.ts` =
  whole-store sync file (`resumestudio-store/v1`).
- **In-app settings are desktop-only.** The launcher sets `RESUME_DESKTOP=1`;
  `settings.ts → isDesktop()` gates the editable surface. `loadOrInitSettings()`
  seeds `settings.json` from env on first run, then `applyToEnv()` pushes it back
  onto `process.env` so the **lazily-env-reading** translate/backup code picks up
  changes with no restart. The VPS build never sets `RESUME_DESKTOP`, so
  `/api/settings` reports `managed:false`, PUT 403s, and config stays env-driven.
  Don't make translate/backup read settings directly — keep them reading env, and
  route runtime changes through `applyToEnv` (+ `reconfigureBackup` for the
  periodic scheduler, since that's stateful and lives in `backupRuntime`).
- **Managed translate = the app drives Docker**, it does not bundle the engine.
  `translateDocker.ts` shells out (argv-only, never a shell string) to
  `docker compose -f $RESUME_COMPOSE_FILE up -d libretranslate`. Everything there
  is best-effort and must never throw into the request path — Docker missing just
  yields `available:false`. After changing translate settings, the client calls
  `resetTranslationAvailability()` so the editor re-probes `/api/translate/status`.
- **Translate providers are settings-selectable** (desktop) or env-selectable
  (VPS): the Settings screen writes `translate_provider` + per-provider keys;
  `applyToEnv` maps them to `TRANSLATE_PROVIDER`/`DEEPL_API_KEY`/… so the lazily-
  env-reading `translate.ts` picks them up live. `settingsToTranslateConfig()`
  builds a `TranslateConfig` without touching env — used by `POST
  /api/settings/translate/test` to probe *pending* (unsaved) config by drafting
  one phrase. Keys are write-only over the API: `toView()` returns `*_set`
  booleans, never the value; only the on-disk `settings.json` holds them.
- **Auto-update = staged-swap, not Electron.** `updater.ts` checks GitHub
  Releases (`checkForUpdate`), downloads the per-platform `resume-studio-<os>-
  <arch>.tar.gz` (host-allowlisted to GitHub — SSRF guard), extracts with the
  system `tar`, and validates the tree (`looksLikeValidBuild`). `updateRuntime.ts`
  holds the state (mirrors `backupRuntime`), and to replace files a *running*
  process can't overwrite (esp. `node.exe` on Windows) it writes a detached
  per-OS swap script (`buildSwapScript`) that waits for our PID to exit,
  mirrors/copies the staged build over `RESUME_INSTALL_DIR`, relaunches the shim,
  and self-deletes. The launcher seeds the runtime (`initUpdateRuntime`), runs a
  daily check, and wires the tray (`setTrayRefresher` → `setUpdate`). Gated by
  `isUpdateSupported()` (the runtime is only seeded on the desktop build), so
  `/api/update` reports `supported:false` and 403s mutations on the VPS — a
  server must never rewrite its own files. `RESUME_NO_UPDATE` disables it;
  `RESUME_UPDATE_REPO` overrides the repo. The build (`build-desktop.mjs`) bakes
  `RESUME_APP_VERSION` into the shims and emits the `.tar.gz` to `release-dist/`;
  `.github/workflows/release.yml` publishes it. Keep `assetNameFor` in
  `updater.ts` and the duplicated copy in `build-desktop.mjs` in sync.
- **Version source of truth (don't reintroduce the v0.3.2 drift bug).** A
  *published* build's version is the **git tag** — `release.yml`'s "Resolve &
  verify version" step derives it from `GITHUB_REF_NAME`, exports
  `RESUME_APP_VERSION` so the build bakes the tag value, and **hard-fails if
  `package.json` doesn't match the tag**. `build-desktop.mjs` and
  `server/version.ts` both read `RESUME_APP_VERSION` first, else `package.json`.
  So: to cut a release, bump `package.json` **and** `package-lock.json` to the
  new version, commit, then tag `vX.Y.Z` — the CI guard rejects a tag whose
  `package.json` wasn't bumped (that mismatch shipped a build self-reporting the
  previous version, which then looped "update available" forever). Local
  `npm run build:desktop` (no env) still uses `package.json`.
- **Update UX (`updateRuntime` + `tray` + `notify`).** The tray has a disabled
  **version header** + two always-present items: "Check for updates"
  (`handleCheckClick` → `runCheck(true)`) and "Install update"
  (`handleInstallClick` → `runInstall`), the latter disabled unless an update is
  ready. When a check (manual OR the daily background one) finds an update,
  `offerInstall` shows an interactive **Install/Cancel** dialog (`notify.ts
  confirmInstall`); Cancel leaves it available (background offers de-dup per
  version per session). A manual no-update check pops an info popup (`notify`).
  **The Windows swap is a VISIBLE PowerShell window** (`buildSwapScript`) with an
  ascii progress bar: `Wait-Process` (not `tasklist|find`/`ping`), file-by-file
  `Copy-Item`. The **relaunch is windowless**: `wscript.exe` (invoked by name —
  never launch a script by file association; that opened a text editor on dev
  boxes and was the original install bug) runs `Resume Studio (no window).vbs`,
  so a tray-initiated update doesn't leave the app behind a console window. The
  console `.cmd` via `cmd /c` remains only as the missing-vbs fallback. POSIX
  stays a detached `sh` script.
