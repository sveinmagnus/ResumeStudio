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
  drag-and-drop reordering, global content search (Ctrl/Cmd+K), per-section sort
  modes + a display-only editor **type Filter** (editor-only Category
  vocabularies for courses/certifications; never exported).
- **Profiles & competencies** — several **Profiles** (`key_qualifications`); a
  view presents exactly one, whose tag line is the default resume title. Each
  profile owns an **ordered competency bundle** (`competency_ids`, shape v12): a
  view shows exactly that bundle. Competencies are a shared library reusable
  across profiles. See §4.
- **Multi-language** — dual-view editing (§5), translation assist (Copy +
  server-proxied LibreTranslate/DeepL/etc. Draft), locale re-detection.
  **15 offered locales** (`LOCALE_LABELS`), all Latin/Cyrillic-script European:
  every one is fully translated in every export surface, and tests fail if a
  new code lands without its translations. Don't add a locale you can't
  translate everywhere — that's what the 19-language/4-translated state this
  replaced looked like from the user's side.
- **AI assist (BYO backend)** — server-proxied summarize (Docker-managed local
  Ollama / OpenAI / Anthropic / Google Gemini / Mistral / any OpenAI-compatible
  endpoint) drafts a one-line short description from a long one: per-column in
  `DualField`, or the whole section via "Bulk summarize" (confirmation-gated) in
  the section bar (`lib/summarizeBatch.ts`). Drafts are always review-required.
  Hidden entirely when nothing is configured. **Both paths send the item's
  HEADING with the text** (`summaryContext()`, derived from `cvFields`'
  `prose: false` identity fields) — a model shown only a description has no way
  to know the customer and job title are already printed above the line, so it
  restated them, which is what the field is for. The prompt also bans hedging by
  name and offers "write a shorter line" as the escape, because a padded "might
  have been involved in…" is worse in a CV than three true words.
  **Provider wire protocols:**
  `llm.ts → endpointFor()` splits on `protocol` — most speak OpenAI **Chat
  Completions** (ollama/openai/compat/gemini/mistral; Gemini via Google's
  OpenAI-compat endpoint, both Bearer-auth); **anthropic** is the native
  **Messages** API (`x-api-key`+`anthropic-version`, top-level `system`, no
  `temperature` — current Claude models reject it, `content[].text` reply). The
  model field is a free-text input plus a **controlled pick-list**
  (`settings/ModelField.tsx`) of what the provider actually offers, fetched by
  `server/llmModels.ts` (`GET /api/llm/models`, or a POST carrying the pending
  form values so a just-pasted key works before Save). **No hardcoded hosted
  model ids** — a curated shortlist rots and fails late (`gemini-2.5-flash` was
  offered after Google retired it). Ollama keeps `lib/ollamaCatalog.ts` only
  because it carries DOWNLOAD SIZES no endpoint reports. Not a `<datalist>`:
  browsers filter those by the input's current value, so the list vanished once
  a model was picked. The same model can also power **translation**
  (`translate_provider: 'llm'`) and the **writing coach** instead of a separate
  engine — `llm.ts → chatComplete()` is the one shared chat round-trip.
  **A REASONING model thinks out loud first, and both halves of that bite.**
  `chatComplete` strips the `<thought>`/`<think>`/… wrapper (`stripReasoning`,
  mirrored in `lib/llmAssist.ts` and cross-checked by
  `tests/reasoningReply.test.ts`) because the deliberation is not the answer:
  `summarize.ts` takes the reply's FIRST LINE, and `extractJson` hunts for
  brackets — and thinking prose is full of them, which is how a production
  install on `gemma-4-31b-it` answered every assist with "JSON.parse:
  unexpected character at line 1 column 1". `extractJson` now finds the first
  BALANCED value that actually parses rather than slicing first-bracket to
  last. The other half is budget: such a model spends `max_tokens` on thinking
  BEFORE it writes, so a cap sized for the answer stops it before there is one
  (measured: ~900 tokens of deliberation on a two-line course description,
  ~4,900 on a harder one). Hence `ASSIST_MAX_TOKENS` (8k) and the 8192 route
  cap — a cap is not a spend, so sizing for the slow case is free — and an
  answer that is empty after stripping is an ERROR naming the budget, never
  text handed to a caller to fail on later.
  **Config is named `llm_*` / `LLM_*`, never `summarize_*`** — the model powers
  far more than that one feature now; the old names are still read as a
  fallback (settings `legacyKey`, env fallback in `llm.ts`) so upgrades don't
  drop a configured key. A `llm_high_end` flag (declared by the operator, never
  sniffed) gates the **advanced assists** — see §15.
- **Registries** — shared Skill / Role / Industry registries with merge,
  usage counts, and a "By category" view (renamable Skill **and** Role
  categories); `SkillCategory` entities drive skill grouping + the Skills
  Showcase; Quadim skill-taxonomy autocomplete, normalization, related-skills,
  and offline auto-categorization. Shared registries also propagate across
  resumes and ride the desktop sync (§14).
- **Resume Views & export** — targeted section/item selection, per-view style +
  header/footer, export templates, BYO-LLM tailoring, anonymization, skill
  matrix, per-view sort; export to PDF / DOCX (lazy) / ATS text+Markdown /
  Europass XML / **JSON Resume** (jsonresume.org interchange) / **single-file
  HTML** (fonts inlined, opens from disk — `lib/htmlExport.ts`); live preview
  pane, plus a **read-through mode** (the view as one flowing document with
  flag-and-fix annotations that survive navigation — `lib/readThrough.ts`).
  **Cover Letters** are their own entity referencing a view, with
  PDF/DOCX/text export (`CoverLettersEditor`, `lib/coverLetter.ts`).
- **Import** — CVpartner JSON, LinkedIn (.zip), Europass XML, JSON Resume
  (positive detector, never the fallback), AI-assisted
  PDF/Word (BYO-LLM), per-section bulk add (BYO-LLM, `lib/bulkImport.ts`),
  portable JSON backup, and the identity-bearing backups (a sync file, a
  whole-set `.zip`) which **merge by resume id** rather than creating copies.
- **Truth & maintenance** — the Overview's structural, offline checks beside
  drift: **claim–evidence** (`lib/claimEvidence.ts` — expert ratings with no
  dated usage, showcased-but-unused skills, unmentioned competencies) and
  **repetition** (`lib/redundancy.ts` — the same sentence sold twice across
  items); **reference consent tracking** (status + confirmed-date on each
  reference, warned via `freshness.ts` for export-included ones only); and the
  **project debrief interview** (`lib/debrief.ts` — a recently-ended project
  nudges for a five-question debrief whose answers become highlights/skills/
  summary through review-required drafts; questions need no model, answers can
  go through BYO copy-paste).
- **Persistence & safety** — auth-gated server (cookie/bearer, named tokens),
  offline editing + conflict safety, per-resume snapshot history, freshness
  warnings, storage readout, React error boundary.
- **Desktop** — downloadable portable build with cross-computer JSON sync and
  auto-update (§14, `DESKTOP.md`).

**Intentionally simple:** the router is a hand-rolled ~220-line History API
hook (`src/lib/router.ts`, no dep; the URL is canonical, `EditorRoute`
two-way-syncs it — URL→store then store→URL, order load-bearing). Each
history entry also carries a **UI snapshot** (scroll + expanded card) so Back
returns you where you were; it is stamped CONTINUOUSLY, never at `navigate()`
time, because `setActiveSection` clears `expandedItemId` before navigation
runs. Restore uses `openItem` (not the toggling `setExpandedItem`).

**A resume's URL is a readable address, not its UUID** (`lib/resumeSlug.ts`):
derived from the header email — `name-domain`, a DASH between the parts,
symbols stripped within each, TLD dropped (`sveins@gmail.com` →
`/r/sveins-gmail`), the TLD as a third dash-joined part when the short form
collides (`/r/sveins-gmail-com`), the UUID when there is no usable email or
even that collides.
DERIVED, never stored — no second field to drift. `EditorResolver` (App.tsx)
turns the segment back into the id against the resume list (the local cache
offline); the UUID stays a working address forever, it just rewrites in place
(replace, never push — Back must not step through spellings). An ambiguous
slug resolves to NOTHING (picker), never to a guess — the wrong person's CV
is worse than a bounce. `ResumeMeta.email` exists (json_extract at read) so
the picker and resolver can derive addresses without fetching documents.

**Navigation is real links, not onClick.** Every sidebar item — each section and
each Resume View — is an `<a href>` rendered by `<Link>`, so Ctrl/Cmd-click,
middle-click and "Open in new tab" work; two sections of one CV side by side is a
genuine editing need. `<Link>` intercepts only the plain left-click, and anything
a nav item does IN ADDITION to navigating (closing the mobile drawer) must check
`isPlainLeftClick` first, or opening a section in a second tab also moves the tab
you're still reading. Nav items do NOT call `setActiveSection` — the URL⇄store
effect owns that, so there is one path, not two.

Styling is inline `<style>` blocks per component + CSS custom properties. No
Tailwind, no CSS-in-JS.

Wishlist: §12.

---

## 2. Stack and conventions

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Node 24+** (hard requirement) | `node:sqlite` is flagged on 22 and below. `engines` + CI + `build-desktop.mjs` all enforce it |
| Build | Vite 8 (Rolldown) | `npm run dev` / `npm run build` / `npm run preview` |
| Framework | React 19 + TypeScript | Strict mode on |
| State | Zustand (single store) | See `src/store/useStore.ts` |
| Persistence | Express + **`node:sqlite`** (multi-row `resumes` + scoped `resume_snapshots`) | See `server/`. `server/sqlite.ts` is the only module that touches it. Per-id localStorage fallback in `lib/localCache.ts` |
| Routing | Hand-rolled History API hook | `src/lib/router.ts` — `useRoute()`, `navigate()`, `<Link>`. No dep. |
| Tests | Vitest (+ jsdom for browser-tied tests) | `npm test`, `npm run test:watch`, `npm run test:coverage` |
| Icons | lucide-react | **Tree-shaken**: import each icon by name, never `import * as` |
| DOCX export | `docx` npm package | **Lazy-loaded** (~378 kB chunk, ~106 kB gzip) — only fetched when the user clicks Export DOCX |
| PDF export | `pdfmake` (vector) | **Lazy-loaded** (~950 kB lib + one font module per family — Roboto alone is ~835 kB) — one-click `.pdf` download built from the section catalog in `lib/pdfExporter.ts`, mirroring the DOCX exporter. Its own render engine, so it applies every view style control (§7) but is not pixel-identical to the HTML preview |
| Drag-and-drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Pointer + keyboard sensors |
| Styling | Inline `<style>` blocks per component + CSS custom properties in `src/index.css` | No Tailwind, no CSS-in-JS lib — keep it that way |

### Code style rules
- **TypeScript strict mode.** `npm run typecheck` covers client, server AND
  tests — three projects, because they need different `lib`/`types` and neither
  build config may ever compile a test file. `tsconfig.tests.json` owns
  `tests/`, `e2e/` and the three root config files (DOM + node + vitest/playwright
  types, plus `src/**/*.d.ts` for the ambient module declarations);
  `tsconfig.lint.json` now just extends it, so ESLint's type-aware rules and the
  compiler can never disagree about what a test file's types are. Tests went
  unchecked for a long time and it cost real coverage: fixtures named fields the
  types do not have (`proficiency` on `ProjectSkill`), calls carried arguments
  the function had stopped taking (`importFromEuropassXml(xml, 'en')`,
  `buildViewHtml(store, view, locale, {header, footer, tokens})`), and two
  section arrays were misspelled (`work_experience`, `honors_awards`) so the
  suites believed they were exercising employment and awards while both were
  empty. A fixture asserting a shape the app cannot produce is a test that
  passes and proves nothing.
- **`npm run lint` must be clean** (CI runs it first). `eslint.config.js` is
  deliberately NOT a style guide — no formatting opinions, no import ordering.
  Every rule in it either enforces an invariant written down in this file or
  catches a class of bug the type system can't see. What it holds:
  - **Project invariants** (`no-restricted-syntax` / `no-restricted-imports`):
    lucide namespace imports, a static import of `lib/exporter`/`lib/pdfExporter`,
    `process.env` in client code, `transition: all`, `dangerouslySetInnerHTML`,
    `target="_blank"` without `rel`, `lib/exportStrings` reaching into
    `components/`, redefining a `.pf-*` primitive in a component `<style>`
    block (§6), and `font-size` below the 11px minimum (§6).
  - **A raw control character in a string literal** (`Literal[raw=…]`). A NUL
    makes git and grep treat the whole FILE as binary: `git diff` hides the
    change behind "Binary files differ", and `grep`/ripgrep report only
    "Binary file … matches" without the line or its number — so an edit escapes
    review and a sweep returns something that does not read as a hit. Write `\u0000`. Three instances existed when
    the rule was added. It matches the RAW source, so the escape is legal and
    the raw byte is not.
  - **Conventions that were previously discipline-only**, each measured at zero
    violations before being switched on: `eqeqeq` (with `{ null: 'ignore' }` —
    the `== null` nullish check stays idiomatic), `import-x/no-default-export`
    in `components/`/`lib/`/`store/` (§2; `main.tsx` and `App.tsx` sit outside
    those and need no exception), and `consistent-type-imports` — which is a
    layering rule, not a style one: an unmarked type-only import is a real
    runtime module edge, and those are what `no-cycle` and §3 police.
  - **The §3 layering, mechanically** (`import-x/no-restricted-paths`): lib/ may
    not import components/ or store/; types/ imports nothing; store/ may not
    import components/ **except** `ui/ConfirmDialog` (imperative by design).
    Plus `no-cycle`, because the codebase already dodges one by hand.
  - **Type-aware rules** (five, chosen individually — the full preset is not
    enabled): `no-floating-promises`, `no-misused-promises`, `await-thenable`,
    `require-await`, `return-await`. Cheap here because `void f()` is already
    the house fire-and-forget marker, so they only fire on unmarked promises.
  - **Accessibility** (`jsx-a11y`), complementing the jest-axe suite: axe only
    sees what a test mounts, this sees all ~80 components.
  - **Test correctness** (`@vitest/eslint-plugin`, `testing-library`): a
    `findBy*` without `await` is always truthy and always passes.
  Rules that are OFF are off with a recorded reason, never silently: the React
  Compiler rules (no compiler adopted), three jsx-a11y interaction rules
  (enlarged hit-areas next to real controls — adding tabIndex would create a
  duplicate tab stop, which is worse), and three testing-library/vitest rules
  that fight this suite's deliberate style. Read the config before adding to it.
  `eslint-plugin-jsx-a11y` still declares a peer of `eslint@<=9` (6.10.2 is its
  latest); it runs fine on 10, so `package.json → overrides` pins that peer to
  `$eslint`. **Never regenerate `package-lock.json` with `--legacy-peer-deps`
  or `--force`** — that writes a lockfile whose peer conflicts `npm ci` then
  rejects, and CI fails at Install before a single gate runs (it did, in
  `216f9e1`). Drop the override once the plugin ships an eslint-10 peer.
- **Other gates** — `npm run check:bundle` asserts the initial-payload budget
  (340 kB gzip) and that the heavy chunks stay lazy; `npm run test:coverage`
  enforces a ratchet (global 78 % statements / 81 % lines, `src/lib` 86 % / 89 %)
  set just below current so it catches decay, not noise; `npm run test:mutation` (Stryker over
  `src/lib` **and** `server/`) is an **audit you run before a release**, not a
  CI gate — it reports which assertions aren't there. Both halves are logic
  whose failure is silent: a wrong branch in `src/lib` is a data defect, and a
  wrong one in `server/` is a wrong answer to "may this person read this row".
  It measures ONE module at a time (`scripts/mutation-run.mjs`) and generates a
  scoped config per module — `stryker.config.json` is only for a bare
  `npx stryker run`. `npm run check:arch` fails when a module is
  missing from the §3 architecture map, because a map that quietly stops being
  complete makes a module read as one that does not exist — the next reader
  writes a second one beside it. `npm run check:text` fails on a raw control character
  anywhere git tracks — ESLint covers the same ground for `.ts`/`.tsx` only, and
  the last stray NUL landed in CLAUDE.md, outside its reach. `.gitattributes`
  backs it up on git's side (`diff` keeps a file textual to `git diff`/`git grep`
  regardless of content), but plain grep ignores that file, so the CI check is
  the enforcement. CI also runs CodeQL (`security-extended`) and gitleaks.
- **A map lookup on a key that came from DATA goes through `lib/lookup.ts`**,
  never `MAP[key] ?? fallback`. Every object literal inherits `toString`,
  `constructor`, `valueOf` and friends, so a lookup with one of those as the key
  returns a **function** — neither null nor undefined, so `??` hands it straight
  to a caller expecting a string, a number or an array. No prototype pollution
  needed; the key alone does it, and keys reach these maps from imported resume
  and view JSON. Both failure shapes were live: a value INTERPOLATED into output
  (`presentLabel('toString')` writing a function body into an exported date) and
  a value USED (`slotsFor('toString').map(…)` throwing, so a crafted view
  crashed the exporter). `tests/lookup.test.ts` pins the helper AND its callers.
  The server mirrors the rule with `Object.hasOwn` (it targets ES2022, the
  client ES2020) — `server/translate.ts` takes its locale off the request body.
- **No `any`** unless interfacing with truly unknown shapes (e.g. raw imported JSON). Use `unknown` then narrow.
- **No default exports** for components — use named exports, now enforced by `import-x/no-default-export` in `components/`/`lib/`/`store/`. (`main.tsx` and `App.tsx` are the only existing default exports; they are entry points and sit outside those paths.)
- **Inline styles via `<style>` tag inside the component.** Each component owns its CSS. Tokens come from `src/index.css` (see §6). The only utility classes in `index.css` are widely-shared widgets: `.check-row`, `.skip-link`, `.sr-only`, `.pf-*` (plain-field primitives — wrap/label/input/year-stepper/ongoing). **`.pf-*` must stay in `index.css`, not a component's own `<style>` tag** — a component-scoped style block only exists in the DOM while that component is mounted, so a page using a bare `.pf-input` without ever mounting `TextField`/`DateField` gets an unstyled browser-default textbox (this regressed the registry `CategoryField` once already — see git history).
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
- **Comments are sparse, WHY-only, and never narrate the edit.** Full rules +
  the review pass: `.claude/skills/code-comments.md`. In brief: no commented-out
  code, no end-of-line comments, no "added/changed/now" vocabulary, and terse
  never means vague.
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

**This is a gate, not a promise.** `npm run check:arch` fails if a module under
`src/lib`, `src/store`, `server/` or `scripts/` is not named below, so adding
one means adding its line here. `src/components` is grouped by role instead —
folding a family into one phrase is the right altitude for ~80 files, so that
half stays a matter of review.

```
src/
├── types/index.ts   ← single source of truth for the data model (zero runtime imports)
├── store/           ← useStore (Zustand + generic CRUD, currentResumeId, unloadStore),
│                      useUndoRedo, useResumePersistence (boot+auto-save+3-way merge),
│                      saveState (the status one live region renders), useTranslation,
│                      useSortedItems, useReorderGuard, useStableExpanded,
│                      useCanonicalRegistrySync (debounced rename→canonical push),
│                      useAdvisors + useAdvisorRun (AI runs; a SEPARATE store — never
│                      saved/synced/undone). See the store-and-persistence skill
├── lib/             ← PURE logic (no React); a few touch browser APIs but stay jsdom-testable
│   │ — core: locales (resolve/bcp47/detectLocalesInData), sections (GROUP_ORDER,
│   │   canonicalSectionKey), router (hand-rolled History API), resumeSlug (the
│   │     readable /r/ address DERIVED from the person's email — never stored;
│   │     uuid stays a valid alias forever, ambiguity resolves to nothing, not
│   │     to a guess), freshStore, migrate
│   │   (CURRENT_SHAPE_VERSION; single migration choke point), usage, merge (generic
│   │   mergeRegistry), completeness (+ shared collectTrackedFields), drift
│   │   (cross-language divergence; reuses collectTrackedFields), wipeLocale,
│   │   contentSearch, careerTimeline, experience (months/years arithmetic),
│   │   freshness (incl. reference-consent warnings), claimEvidence (claims the
│   │     CV's own structure doesn't back — expert ratings with no dated usage,
│   │     showcased-but-unused skills, unmentioned competencies; drift's sibling),
│   │   redundancy (near-duplicate prose across items — the same sentence sold
│   │     twice; sentence + whole-field passes, offline),
│   │   readThrough (read-through mode's flags: per-(resume,view) localStorage
│   │     annotations — deliberately NOT store data, so they never sync/undo),
│   │   undoHistory (the pure burst-undo rule), download (blob → file),
│   │   coerce (defensive JSON narrowing), settingsBus, uuid (the one id generator —
│   │   crypto.randomUUID with a non-secure-context fallback; no `uuid` package),
│   │   lookup (getBy/hasKey — the ONLY safe read of a map keyed by DATA; see §2)
│   │ — editor-only vocabularies (never exported): courseCategories (the ONE
│   │   category vocabulary, shared by courses/certs/presentations/publications),
│   │   employmentTypes,
│   │   positionTypes, publicationTypes, recommendationRelationships, cefr
│   │ — persistence/sync: api, localCache (per-id fallback+queue), connectivity,
│   │   syncEngine (PURE boot/drain decisions), diffResume, threeWayMerge (base/mine/
│   │   theirs reconciliation so a 409 over non-overlapping edits never asks the user),
│   │   storage (weight thresholds), backup (per-resume JSON), snapshotDiff, snapshotImages
│   │ — render/export: exportStrings (localized EXPORT chrome + xs/xt/fmtYears;
│   │   export-only by design — see §12), sectionCatalog (one descriptor feeds ALL render adapters),
│   │   sectionExtras (the OPTIONAL fact groups a view switches on — links/metrics/
│   │     contact/…; declared per section, normalised at the render boundary),
│   │   viewFilter (applyView + buildViewHtml; escapeHtml; SECURITY-CRITICAL),
│   │   viewSectionPlan (planViewSections + sectionItems + renderKeyFor — the
│   │     section PLAN all four render adapters share; owns isExportableSection/
│   │     defaultViewDetail/promotedProjectItems, re-exported by viewFilter),
│   │   itemLayout (summary slot order + full-item date placement — the LAYOUT all
│   │     four adapters share, as viewSectionPlan is the plan they share),
│   │   sectionIcon (the heading glyph as a standalone SVG, for PDF + DOCX),
│   │   exporter (LAZY-LOADED docx; SECURITY: TextRun escapes),
│   │   pdfExporter (LAZY-LOADED pdfmake; the vector .pdf, same catalog),
│   │   viewText (ATS text/MD),
│   │   htmlExport (the single-file standalone .html: buildViewHtml with the six
│   │     brand fonts inlined as data: URIs and the CSP rewritten for file:// —
│   │     its tests pin the exact font paths + CSP literals so viewFilter can't
│   │     drift under it silently),
│   │   exporterEuropass (SkillsPassport XML; DOM+XMLSerializer, NOT string XML; round-trips importerEuropass),
│   │   exporterJsonResume (jsonresume.org v1 over a VIEW: applyView first, so
│   │     exclusions + anonymization hold — the anonymized-customer rule is
│   │     regression-tested; round-trips importerJsonResume),
│   │   coverLetter (letter prompt + resolveLetterParts + text export; PDF/DOCX letter builders ride the lazy exporter/pdfmake chunks),
│   │   viewStyle (tokens + dividerSpec/tagChipHex — one description per visual
│   │     effect) + viewHeader (render-boundary sanitisers) + socialSite (the
│   │     platform a URL names — curated map + hostname fallback; feeds the
│   │     social header label and JSON Resume's network), richText (allowlist;
│   │   SECURITY-CRITICAL), image (canvas downscale; rejects SVG), sectionSort,
│   │   viewItemSelect (editor type Filter + view item selection), pageFit,
│   sortPrefs (the section sort mode, persisted per resume in localStorage —
│     a DISPLAY preference, so never in `data`; see §7),
│   │   exportFilename, fonts (catalog + pdfFont mapping) + appPrefs (app-wide
│   │   default fonts, localStorage), viewTemplates, viewTailor (BYO-LLM),
│   │   skillMatrix, showcase (showcaseGroups), anonCheck
│   │ — skills/taxonomy: skillTaxonomy (Quadim lazy JSON), skillNormalize (imports only),
│   │   skillMatch (exact/token/fuzzy/semantic tiers), skillCategorize (SkillCategory
│   │   CRUD + auto-categorization; effectiveSkillCategory)
│   │ — cross-resume registries: registrySync (overlayCanonicalNames — canonical
│   │   name wins at load), registryPublish (the picker's "Share…" orchestrator),
│   │   registryReintern, whoKnowsWhat (the skill × person grid),
│   │   competencyBundles (pure profile-bundle reassignment)
│   │ — AI assist (ordinary tier): translateClient + llmClient (memoized availability
│   │   + high-end probe), llmAssist (looksHighEnd + the shared prompt scaffolding),
│   │   summarizeBatch (SUMMARY_FIELDS source→target per section; emptySummaryTargets
│   │   work list; summarizableSource — the ONE "has a source" rule, shared with DualField),
│   │   skillExtract, keyPoints, writingCoach, debrief (the project debrief
│   │     interview: structural questions derived from what the project lacks —
│   │     NO model needed for pass 1 — then answers reshaped via the
│   │     resumestudio-debrief/v1 contract into highlights/skills/summary;
│   │     applyDebrief is one replaceData batch; debriefCandidates drives the
│   │     Overview "recently finished" nudge), modelPicker + cloudModelCatalog,
│   │   ollamaCatalog (curated open-weight models + sizes; merged with installed),
│   │   translateLanguages (which Argos langs to install; forced pivot + editing pair),
│   │   glossary (C3 — term pairs harvested from the registries; NOT gated)
│   │ — AI assist (advanced tier, §15): cvFields + cvDigest (the shared vocabulary —
│   │   build new advisors on these), assistFindings (A1/A3/D3) + assistProposals (A2),
│   │   cvReview, voicePass, semanticDrift, achievementMining + achievementTranslate,
│   │   profileGenerator, introDraft, sectionAdvice, jobFit, letterAdvice,
│   │   atsAudit (pass 1 needs no model), registryHygiene (proposal-only)
│   └ — importers: importer (CVpartner), importerLinkedIn (CSV/zip), importerEuropass
│       (XML+JSON), importerJsonResume (jsonresume.org v1; POSITIVE detector that
│       can never claim our own or CVpartner files; skills-with-keywords become a
│       SkillCategory + member skills), aiImport (resumestudio-ai/v1), bulkImport
│       (resumestudio-bulk/v1;
│       ONE spec per section drives instructions+validation+mapping+preview), translateClient
├── components/
│   ├── shell: App (routes + URL⇄store sync), AppHeader, ErrorBoundary, ResumeList (picker),
│   │   ImportScreen, AIImportModal, AuthGate, SnapshotHistory (restores via replaceData),
│   │   ConflictModal, NewerDataNotice, RemoteUpdateNotice, RegistryConflictNotice,
│   │   SyncPanel, SettingsModal, UpdateBanner, GlobalSearch, WhoKnowsWhatPanel
│   ├── layout/      ← Sidebar (GROUP_ORDER), LanguageSwitcher (popover), SaveStatus (live region)
│   ├── ui/          ← DualField (THE KEY COMPONENT), EditorCard, Fields, RichField,
│   │                  ImageField + ImageCropperModal, Autocomplete (ARIA combobox),
│   │                  SortableList, SortBar, SectionIntro, CollapsibleSection,
│   │                  ConfirmDialog, BulkImportModal, TranslationPopover (here to avoid
│   │                  a circular import), useDialog (shared modal focus behaviour),
│   │                  AssistRun + AdvisorToast + AdvancedAssistCard (§15) and the
│   │                  advisor result panels (AssistFindings/AssistProposals/JobFit/
│   │                  AtsAudit/IntroDraft/ProfileGenerator/RegistryHygiene/LetterAdvice/
│   │                  KeyPoints/WritingCoach/SectionAdviceButton/SummarizeAllButton)
│   ├── settings/    ← SettingsTabs + the tabs (Translation, AiAssist incl. ModelField,
│   │                  Sync, Address, Version) + FolderPicker + a shared context
│   └── editor/      ← Overview, HeaderEditor, ProjectsEditor, SimpleEditors (every
│                      list section INCLUDING Profiles + Key Competencies and their
│                      bundles), RegistryEditors, RegistryCategoryView, CareerTimeline,
│                      UsagePanel, CvAdvisors (§15), EvidencePanels (the claim-evidence
│                      + repetition Overview cards), DebriefModal (the debrief
│                      interview, opened from a project card + the Overview nudge),
│                      ResumeViewsEditor,
│                      CoverLettersEditor (own entity referencing a view; letter exports),
│                      views/ (ViewEditor + the style/header/footer/item-select panels
│                      + ReadThroughMode, the full-screen reading overlay with flags)
├── sw.js            ← shell-only service worker: precaches index.html + the entry
│                      chunk + the fonts from a build-injected list. Has NO
│                      `cache.put` at all, so an /api response cannot be stored
│                      even in principle — see §16
├── swRegister.ts    ← its own index.html entry; registers in prod, unregisters in
│                      dev, owns the "new version — reload" prompt
└── index.css        ← self-hosted @font-face + design tokens + global a11y rules + utilities

server/              ← Express API + SQLite persistence
├── index.ts (VPS/dev entry: loads .env, refuses a damaged DB, prints the
│   bootstrap code) + app.ts (createApp: security headers, routers, static serving)
├── env.ts (reads `.env` for the server build — the REAL environment always
│   wins, so a stray file cannot override a systemd unit or a Docker -e)
├── auth.ts (session cookie OR Bearer service token; three modes derived from
│   state, never declared: open / token / accounts) · accounts.ts (users,
│   sessions, grants, recovery codes — the identity half) · passwords.ts
│   (node:crypto scrypt, async, self-describing so cost is raisable) ·
│   access.ts (THE read/write rule — canRead/canWrite/readableWhere; the ONE
│   place authorization is decided) · bootstrap.ts (the one-time first-account
│   code, held in memory so a restart re-issues it) · csrf.ts (double-submit
│   token; exempt list is exact paths, never prefixes) · mail.ts (optional
│   outbound: sendmail argv-only or a hand-rolled SMTP client; addresses are
│   REJECTED not sanitised)
├── db.ts (createResumeDb +
│   lazy singleton; snapshots; dump/restore; close checkpoints WAL) · config.ts (PURE paths)
├── sqlite.ts (THE connection: node:sqlite behind a better-sqlite3-shaped facade —
│   adds pragma()/transaction(), copies null-prototype rows. No native addon)
├── registryDb.ts (instance-level cross-resume registry: canonical entries,
│   promoteFromResumes, mergeRegistry for desktop sync) · skillKey.ts
│   (server mirror of the client skill key; cross-check test guards drift)
├── resumeId.ts (isValidResumeId — the ONE charset rule for an inbound id, which
│   is also the only untrusted field that becomes a FILENAME. Zero imports so
│   both inbound parsers can share it without a cycle)
├── backupFiles.ts (THE sync-folder layout: one `<slug>__<id>.json` per resume +
│   resume-studio-registry.json + tombstones; scan/reconcile/write/recordDeletion) ·
│   backupZip.ts (the same files as one manual-export archive) ·
│   backup.ts (LEGACY combined StoreBackupV1 — still read, never written) +
│   backupScheduler (writes edits OUT) + backupWatcher (fs.watch+fingerprint poll;
│   merges other machines' edits IN while running, not just at launch, and applies
│   tombstones) + backupRuntime (owns both)
├── settings.ts (settings.json: a desktop SNAPSHOT, a server sparse OVERLAY;
│   applyToEnv/applyServerSettings; OWNER_EDITABLE_KEYS) · storage.ts (payloadStats) ·
│   folders.ts (the sync-folder browser behind Settings' picker)
├── cookies.ts (THE `Secure` decision — follows req.secure, never NODE_ENV; see
│   §16. Every Set-Cookie in the app is built here)
├── localHost.ts (the `.localhost`/`.local` name: validation, the PURE hosts-file
│   text transform, the elevated write, and the loopback predicate app.ts guards on)
├── translate.ts (pluggable proxy: libretranslate/deepl/google/azure/llm) · translateDocker.ts
├── llm.ts (THE LLM layer: 7 providers, 2 wire protocols, chatComplete, high-end flag) ·
│   llmModels.ts (asks the provider what it offers — no hardcoded hosted model ids) ·
│   summarize.ts (one FEATURE on top of it: the one-line short description) ·
│   glossary.ts (C3 per provider: prompt block / DeepL resource / notranslate spans) ·
│   ollamaDocker.ts (app-driven local Ollama, like translateDocker)
├── version.ts (APP_VERSION + APP_VERSION_LABEL) · desktop/ (launcher, freePort,
│   openBrowser, notify, tray, trayIcon, updater, updateRuntime — CJS-bundled, see §14)
└── routes/          ← auth (login/logout/bootstrap/me), users (invites, the four
                        reset triggers, profiles, owner administration), resume,
                        registry, translate, llm, summarize, backup, settings, update

scripts/             ← build-desktop (assembles the portable release/ folder, per target
                        OS), check-bundle-size + check-control-chars + check-arch-map
                        (CI gates — the last asserts this very map is complete), dev-server
                        (pins the API port — see §11), recover (mints a reset link from
                        the machine itself — the owner's floor when nobody can issue one),
                        mutation-run, and the two codegen steps: gen-section-icons,
                        build-skill-taxonomy
tests/               ← Vitest (lib/store/components/server); e2e/ holds the Playwright
                        smoke + accessibility suites. See §10
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
- **Courses use a `start`/`end` range** (shape v11) like the other ranged
  sections — the pre-v11 single `completed` date migrated to `end` (a new course
  defaults `end` to today). `end: null` = ongoing, as everywhere.
- **Presentations use a `start`/`end` range too** (shape v13), for talks given
  regularly over a period — same shape/migration as Courses (`date` → `end`).

### Editor-only organizing fields (never exported)
Some fields exist purely to organize the editor and are stripped from every
export (like the anonymization/internal-notes fields):
- **`category`** on **Course / Certification / Presentation / Publication** — ONE
  shared, English-only vocabulary (`lib/courseCategories.ts`), mirroring
  employment/position types. Drives the per-section **type Filter** and the view
  editor's "By type" quick-select (`lib/viewItemSelect.ts`), never a heading.
  One vocabulary across all four because the question it answers — which subject
  area is this — doesn't change with the section, so a view can select the
  security material whether it was a course, a certificate, a talk or a paper.
  Additive/optional on all four; no shape bump. Note it is **orthogonal to
  `Publication.publication_type`**, which says what KIND of artefact it is and
  IS exported — publications carry both facets, and neither subsumes the other.
- Every section with a type/facet (item category, position/publication/
  employment type, project/employment role) offers a display-only **Filter**
  control beside Sort — it hides rows in the editor only, never in views/exports.

### Rich text — ONE kind of line break
Description-shaped fields store sanitised HTML (`lib/richText.ts`). The storage
shape is **canonical**: after `sanitizeRich` the root holds only `<p>`, `<ul>`
and `<ol>`; a `<p>` holds only inline content. Every break — a `<br>`, a raw
newline in a text node, a blank line — is turned into a **paragraph boundary**
by `blockify`, with the inline formatting rebuilt around each half. The one
exception is inside an `<li>`, where a break stays a `<br>` (splitting there
would invent a bullet nobody wrote) and every renderer draws it as a real break.
Plain text (imports, the view intro, cover-letter bodies) goes through
`plainParagraphs`, which applies the same rule.

**Why it's an invariant, not a preference.** A value could encode "new line"
three ways, invisible in the editor, and each rendered differently per target:
the `<p>` got spacing, the `<br>` got a tight break, and a raw newline was a
break in the editor and the PDF but a plain SPACE in the HTML preview and in
Word. So: the editor emits one thing (Enter *and* Shift+Enter both route
through `exec('insertParagraph')`, which pins `defaultParagraphSeparator` to
`p` with the caret live — Chrome ignores that command at focus time, and its
default `<div>` is unwrapped by the allowlist, silently merging the two lines),
`parseRichBlocks` canonicalises before walking so legacy values render the same,
and the paragraph gap is ONE number: `PARA_GAP_LINES` (0.5 of a line box →
1.5-line spacing), surfaced as `paraGapEm`/`paraGapPt`/`paraGapTwips` on
`StyleTokens` and consumed by the editor, HTML, DOCX and PDF alike.
`tests/paragraphSpacing.test.ts` pins all four against every encoding.

### Shared registries
- **`Skill`** — global registry (`data.skills`), referenced by `ProjectSkill` via `skill_id`. `countSkillReferences()`.
- **`Role`** — global registry (`data.roles`), referenced by `ProjectRole` + `WorkExperience.role_id`. `countRoleReferences()`.
- **`Industry`** — `data.industries`; a project references one or more via `Project.industries[]` (`ProjectIndustry` links; shape v4 — single `industry_id` pre-v4). `countIndustryReferences()`. All three merge through the generic `mergeRegistry` / `countRegistryReferences`.
- **`SkillCategory`** (shape v6) — `data.skill_categories`; a skill links to at most one via `Skill.category_id`. Lighter than the other three: no `mergeRegistry` yet (delete + reassign covers it), but has `renameSkillCategory` + curated `moveSkillCategory` reorder (drives both the By-category editor header order AND the Skills Showcase group order).
- **Snapshot names**: `ProjectSkill.name`, `ProjectRole.name`, `ProjectIndustry.name` are denormalized copies of the registry name at link time, so a rename doesn't rewrite history. `merge.ts` updates these when it rewrites references. (`SkillCategory` has no per-link snapshot — `category_id` resolves live via `categoryNameIndex()`.)
- **Role registry categories** are renamable (plain-string rename in
  `RegistryCategoryView`), matching `SkillCategory`.

### Profiles & competencies — the bundle model
- **`KeyQualification`** (a "Profile", `data.key_qualifications`) is the opening
  statement: `tag_line` (the profile's identity, and the **default resume title**
  in each view), plus a long `summary` and a short `summary_short`. Multiple
  profiles are allowed, but **a view presents exactly ONE** — the first
  non-disabled, non-excluded one (`viewFilter.ts → selectedViewProfile`, enforced
  in `applyView`). Its tag line flows through every header/export path + Overview,
  falling back to the legacy master title. A per-view "Hide tag line" toggle
  (default on, since it doubles as the title) controls whether it also shows in
  the profile body.
- **`KeyCompetency`** (`data.key_competencies`) is a **shared library** of
  headline strengths (title + description + optional `short_description`).
- **A profile OWNS an ordered bundle** of competencies:
  `KeyQualification.competency_ids: string[]` (shape v12). A view renders
  **exactly the selected profile's bundle, in bundle order** (strict scoping) —
  minus any individually excluded / disabled / (starred-only) members. A
  competency id may appear on **several** profiles' bundles (reuse). Membership
  lives only on the profile (single source of truth); it's edited from the
  Profile card (add / add-existing / reorder / remove) and viewed in the Key
  Competencies library (which shows each competency's bundle membership). This
  replaced the inert, editor-only `KeyCompetency.profile_id` grouping + "By
  profile" facet that shipped in v11 — see `migrate.ts → migrateBundleMembership`.

### Resume Views
`ResumeView` (in `data.views`) is the "targeted resume" config: name, localized intro, enabled sections in display order, excluded-items list, starred-only toggle, optional page limit. `lib/viewFilter.ts → applyView()` produces a filtered `ResumeStore`; the exporter and HTML renderer consume it.

### What's an entity vs. an embedded array
- Tables (`projects`, `educations`, `courses`, …) live as top-level arrays in `ResumeStore`.
- Sub-collections tightly bound to a parent (a project's roles/skills) are **embedded arrays** on the parent. Don't promote these to top-level tables. (Profile competencies are the deliberate exception: they're a *shared* top-level library referenced by id from `KeyQualification.competency_ids`, so one competency can be reused across profiles — see the bundle model above.)

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

**Contrast is verified against all THREE surfaces, not just white.** `--paper`,
`--paper-raised` and `--paper-sunken` are different backgrounds, and a token
that clears AA on white can fail on the sunken one — `--ink-faint` did exactly
that (4.83:1 on paper, 4.37:1 on sunken, and field labels sit on sunken inside
an expanded card). Two consequences worth holding: **never dim text with
`opacity`** on a container — it composites the text toward the background, so
the real ratio is whatever the blend lands on and no token can tell you what
that is; and `--gold` is an **indicator colour only** (3.6:1 — clears the 3:1
non-text threshold, fails the 4.5:1 text one). `e2e/a11y.spec.ts` is what
actually enforces this: the jsdom axe suite cannot, because jsdom has no layout
and its colour-contrast rule is inert.

**Utility classes** (use instead of redefining inline): `.check-row`, `.skip-link`, `.sr-only`, `.pf-*`. `index.css` also owns the global `:focus-visible` ring, `forced-colors` outline fallback, and `prefers-reduced-motion` collapse — don't duplicate those per component.

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

### The editor's sort mode is a DISPLAY preference, and it persists
`sectionSort` never enters `data`: nothing about it is resume content, so it
must not auto-save, sync, snapshot or land on the undo stack. But it also must
not evaporate — it lived only in Zustand memory, so every reload (and every
`loadStore`, i.e. also a remote-update reload and a snapshot restore) silently
dropped the user back to Custom. It is stored per resume in localStorage
(`lib/sortPrefs.ts`), restored inside `loadStore`, and written by BOTH
`setSectionSort` and the flip-to-Custom that `moveItem` performs — persisting
one without the other resurrects a stale mode over a hand-baked order.

The type filter is deliberately NOT persisted; it hides rows, and silently
restoring a filtered view is worse than re-picking it.

**A reorder that cannot move anything must change nothing** — no `sort_order`
rewrite, no mode flip, no `mutationCount` bump. `moveItem` treats `from === to`
as a no-op in every mode, `reorderItem` refuses to run off either end, and the
card's arrows are disabled at the list boundaries.

**A reorder index means a position in the list the user is LOOKING at.** That
list is the section sorted, then type-filtered, then reordered by the
expanded-card pin — and the pin lives in a React ref inside `useStableExpanded`,
so the store cannot rebuild it. `moveItem`/`reorderItem` therefore take an
optional `visibleIds`, which `SortableList` (its `ids` prop) and `EditorCard`
(`useSortable`'s `items`) already hold. The store rearranges only those rows,
writing them back into the slots they already occupied so a **hidden item keeps
its absolute position**; omit `visibleIds` and the full sorted order is assumed,
which is what it is when no filter is on. Without this, dragging the second of
two visible rows above the first sent it to the top of the whole section, past
every filtered-out item.

### Adding a new section
1. Add the array to `ResumeStore` in `types/index.ts`.
2. Add the empty array to both `emptyStore()` and `freshStore()` in `lib/freshStore.ts`.
3. Add an entry to `SECTIONS` in `lib/sections.ts`. Sidebar *group* order comes from `GROUP_ORDER` (export-first); SECTIONS order drives the view editor's default section sequence. If the section is edited on another section's page, extend `canonicalSectionKey()`.
4. Add the icon import to `Sidebar.tsx`'s `ICON_MAP`.
5. Create the editor component and wire it into `App.tsx`'s `EditorRoute` switch (the key is auto a valid URL segment; EditorRoute validates against SECTIONS). Any new `lib/`, `store/`, `server/` or `scripts/` module also needs its line in the §3 map — `npm run check:arch` will tell you.
6. If sortable by `sort_order`, wrap `<EditorCard>`s in `<SortableList section="…" ids={…}>`. Else pass `sortable={false}` to each card.
7. If it should appear in Resume View exports: add **one descriptor** to `lib/sectionCatalog.ts` (title/subtitle + `summary()`/`full()` data views). Every render path (HTML/PDF, DOCX, text/Markdown) consumes the catalog through its generic adapter. Descriptors return **data only** — adapters own escaping; never build markup in a descriptor. **`ctx.target` selects LAYOUT ONLY** (title sizing, spacing, title composition) — never which FACTS an item carries. Optional facts are per-VIEW, declared as a group in `lib/sectionExtras.ts` and read via `ctx.extras`; see the note below on why. Views pick it up via `isExportableSection` + `normalizeViewSections`; give it a `defaultViewDetail` if not `full`. A **synthetic** section (derives its items instead of owning a store array, like `promoted_projects`) is declared once in `lib/viewSectionPlan.ts` — add its `RENDER_KEY` entry and a `sectionItems` branch there, never a `key === '…'` check in a renderer. See the **export-pipeline** and **security** skills.
8. If you add a configurable **style/header field** to a view, it is untrusted-import surface — sanitise at the render boundary (`viewStyle.ts → deriveTokens` / `viewHeader.ts → withHeaderDefaults`) and add a breakout regression test. See the security skill.
9. If sortable by something other than `sort_order`, wire it into `lib/sectionSort.ts`.

**Every export states the same facts (July 2026).** The catalog used to carry a
different set of fields per target: the DOCX shape printed a project's team
size, allocation and highlights, and the HTML preview dropped them — so the
preview could not show a consultant what their PDF contained — while the ATS
text export, which asked for the same shape as the preview, shipped less than
either. Eight more fields (employment headcounts, project case-study URL and
country, award "awarded for", recommendation link, reference LinkedIn, study
abroad) were editable but reached no export at all.

The fix is one rule: **content is identical in the preview, the PDF, the Word
file and the ATS text; anything optional is chosen per view, not per target.**
`lib/sectionExtras.ts` declares the switchable groups per section (`links`,
`metrics`, `contact`, …); `SectionStyle.extras` stores which are on, normalised
against the declared keys at the render boundary (untrusted-import surface, as
in step 8). **Every group defaults OFF**, including the ones that used to ship
unconditionally in DOCX/PDF — a view that wants them says so. Two suites hold
the line: `tests/sectionCatalog.test.ts` pins the descriptor data as equal
across targets, and `tests/exportParity.test.ts` renders one view through all
five outputs and asserts each fact reaches every one of them. A group that
changes no output fails the "checkbox that lies" test.

**Every export also LOOKS the way the view asked (August 2026).** The same
defect, one layer up: seven of the view editor's style controls moved the
preview and nothing else — Skill tags (chips vs inline), Item dividers (eight
choices), Summary layout (six slot orders), Full-item layout (four), Summaries
(free-flowing vs aligned columns), Section icons, and, in Word alone, density's
line height. Two of the four full-item layouts rendered identically in the PDF
and the Word file, because both hung the date off the end of the title line
instead of placing it in the details line the control reorders.

The rule extends: **a style control reaches every target that can express it,
and the description of the effect lives in ONE module, not in each adapter.**
`lib/itemLayout.ts` owns slot ordering (summary + full item) for all four
renderers; `viewStyle.dividerSpec` describes the between-items rule in terms
CSS, pdfmake and Word can each draw; `viewStyle.tagChipHex` is the one chip
fill; `lib/sectionIcon.ts` builds the one heading glyph. Format differences are
fine and expected — a short rule is a background gradient in CSS, a
fixed-`widths` table in pdfmake and a one-cell table in Word — but they are
three renderings of one spec, never three opinions.

`tests/exportVisualParity.test.ts` holds the line: flip each control and assert
the EXACT set of targets whose output moved, so a purely visual choice leaking
into the ATS text fails as loudly as a missing one. Known format limits, both
deliberate: Word draws the section icon from Office 2016 on (its required
raster fallback is blank, because an older Word cannot draw a vector glyph and
a missing icon beats a wrong bitmap), and the ATS text has no chips, so it
keeps the "Skills:" label the chip drops — pick "Inline list" if a Word file
headed for an ATS needs that label too.

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
- **Conflict** = 409 from a stale `base_version`. A 409 is **not** a conflict by
  itself: `useResumePersistence` first tries a **three-way merge**
  (`lib/threeWayMerge.ts`) of `base` / `mine` / `theirs`, and when the two sides'
  edits don't overlap it applies the result via `replaceData` and re-saves at the
  server's version — silently, no modal. Only a value BOTH sides changed
  differently reaches the non-blocking `ConflictModal`, which then lists just
  those values (keep mine / discard mine). This is what stopped one drag in
  another window presenting as "48 projects differ" here: `moveItem` renumbers
  `sort_order` across a whole section, and a merge attributes every one of those
  to the side that made them.
  - **The base document is held in memory only** (`baseData` ref). Persisting it
    beside the queued edit would double a pending record that already carries
    base64 images against a ~5 MB localStorage cap. No base (offline edits queued
    by a previous session, a reload mid-conflict) → `conflicts: null` → the modal
    falls back to the whole-document diff, i.e. the old behaviour.
  - Array ORDER is deliberately not merged: every sortable section displays by
    `sort_order`, never by position in the JSON, so merging it would invent a
    conflict nobody can see.
  - Sync decisions are pure functions in `lib/syncEngine.ts`; connectivity
    recovery is health-poll-confirmed (`lib/connectivity.ts`).
- **Backup** (`lib/backup.ts`, per-resume `BackupV1`): loading one from the
  picker creates a **new** resume, because that download carries no identity.
  Distinct from the server's identity-bearing sync files (§14), which merge by
  resume id instead.
- **Live sync (desktop)**: the sync folder holds **one file per resume**
  (`server/backupFiles.ts`) and is kept current in BOTH directions while the app
  runs, not only at launch — `backupScheduler` writes our edits out,
  `backupWatcher` (fs.watch + folder-fingerprint poll backstop) merges other
  machines' edits in as a sync service drops them into the folder. The open
  editor polls its resume's server `version` and, when a background merge moved
  it past what the editor holds (and there are no local edits), surfaces
  `RemoteUpdateNotice` → one-click reload. With local edits the next save 409s
  into the conflict modal instead. See §14.
- **Snapshots** (server-side, 50/resume, deduped, stored **image-free** via
  `stripSnapshotImages`; restore re-attaches current images). The History modal
  restores via **`replaceData`** so a restore is undoable + re-saved.
- **Data-shape versioning** (`lib/migrate.ts`): `shape_version` (absent = 1;
  `CURRENT_SHAPE_VERSION` = 14). `migrateStore()` is the single choke point for
  data entering from outside (`loadStore` + snapshot restore; `replaceData`
  never migrates). Migrations are **idempotent shape-sniffers**. Newer-build
  data loads best-effort (stamp never downgraded; `NewerDataNotice`). **Bump
  only for structural migrations** — additive optional fields stay covered by
  `with*Defaults` render tolerance. The three most recent bumps: **v12**
  (`migrateBundleMembership` — competency `profile_id` → the owning profile's
  ordered `competency_ids` bundle; see §4), **v13** (`migratePresentationDates`
  — Presentation `date` → `start`/`end` range, mirroring Courses' v11), and
  **v14** (`stripSkillTags` — the scaffold-era `skill_tags` array, declared on
  ten entities and read by none, is dropped on load rather than left to linger
  in stored resumes). The full version history lives in the header comment of
  `lib/migrate.ts`.
- **Translation assist**: the client never calls a translation backend directly
  — `POST /api/translate` proxies to the configured provider
  (`TRANSLATE_PROVIDER` ∈ `off|libretranslate|deepl|google|azure|llm`; unset +
  `LIBRETRANSLATE_URL` → libretranslate for back-compat). Keys/URLs stay
  server-side; per-provider locale maps differ; errors never echo upstream
  detail. The client memoizes `GET /api/translate/status` once; drafts are
  always review-required.
  - **`llm`** carries no config: it borrows the Summarize model via
    `chatComplete()`. A locale it can't NAME (`languageNameOf`) is rejected up
    front rather than sent as a bare code for the model to guess at.
  - **Pinning the target language is the whole game on a small model.** en→no
    coming back Swedish was reported twice, and naming "Norwegian Bokmål" more
    often in the system prompt did not fix it. What the prompt does now: the
    target is restated in the USER turn (above the delimited source and below
    it), because a chat template renders the system message far from the
    generation point and some Ollama modelfiles dilute it; the closing line is
    `languageDirective()` — the instruction WRITTEN IN the target language,
    which is the one anchor that separates bokmål from svenska; and temperature
    is 0. Never write the wrong language's name into the prompt ("not Swedish")
    — that puts Swedish in the context, which is the opposite of the goal.
    Behind that sits `looksWrongLanguage()`: two distinct function-word/letter
    markers of a neighbouring mainland-Scandinavian language trigger exactly ONE
    retry with the miss named. Two markers, not one, so a Swedish customer name
    in correct Norwegian doesn't cost a re-run.
  - **Per-provider locale maps must track the 15 offered locales.** DeepL wants
    UPPERCASE (its fallback upper-cases; the others lower-case). This is the
    surface that silently breaks when a locale is added — a wrong code doesn't
    throw, it returns the wrong language or a 400.
  - **Docker LibreTranslate installs only the picked languages**
    (`translate_languages` → `ltLoadOnly()` → `LT_LOAD_ONLY`, read by
    docker-compose.yml). Each language is a few-hundred-MB Argos package.
    `en` is always installed (Argos pivots through it) and the current
    primary/secondary are force-selected — see `lib/translateLanguages.ts`.

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

### Per-section bulk add (`lib/bulkImport.ts`)

The narrow sibling of `aiImport.ts`: it ADDS ITEMS TO ONE SECTION of the open
resume instead of building a new one. The user pastes source material into
their own LLM with the generated instructions and pastes the JSON back
(`resumestudio-bulk/v1`). Invariants:

- **One `BulkSectionSpec` per section drives everything** — generated
  instructions, validation, mapping, preview label, duplicate keys. Adding a
  section = adding a spec, nothing else. Content sections only: **not**
  Languages, **not** the registries (`isBulkSection`).
- **`section` is carried in the file** and checked against the section the user
  is standing in, so a Projects file can't land in Courses.
- **Text fields take `string | { locale: text }`** — a plain string lands in the
  primary locale; an object fills several language columns at once (the point:
  the master CV is multi-language). `bulkInstructions` names the resume's actual
  locales so the model knows which to fill.
- **`dupKeys` returns one key per locale** and a match on ANY of them flags a
  duplicate — an incoming NO+EN item must match an existing NO-only one, which
  a single representative name silently missed (fixed; regression-tested).
- Registries intern against what the resume **already** has (all locales of each
  name), so a bulk add reuses skills/roles rather than duplicating them.
- Apply through **`replaceData`** (never `loadStore`) so the batch is one undo
  step and auto-saves — see §7.

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
- **E2E accessibility** — `e2e/a11y.spec.ts` runs axe with REAL layout (so contrast is actually evaluated, unlike the jsdom suite) plus keyboard-only journeys: skip link, reaching a field by Tab, and a visible focus ring on every stop. The two suites are complementary, not redundant — see §6.
- **Export integrity** — `tests/exportIntegrity.test.ts` asserts the DOCX is a valid OOXML *package* (well-formed parts, no dangling relationship ids, every content type declared), which is what decides whether Word offers to "recover" the file. `exporter.test.ts` asserts what the document SAYS; this asserts that it opens. Its negative-control block corrupts a real archive to prove the checks can fail.
- **Scale** — `tests/scale.test.ts` + `tests/server/scale.test.ts` measure a realistic large CV (50 projects × 15 locales + images, `tests/helpers/largeStore.ts`) against the payload-weight thresholds and the render budgets, and pin that snapshots stay image-free. The budgets are set above today's measurements: read the printed number before changing one.
- **Fixtures** — `tests/fixtures.ts` exports `emptyStore()` + `makeProject()`/`makeWork()`/… — use these so shape changes are one-place fixes. That includes the
  denormalized project links: `makeProjectSkill()` / `makeProjectRole()` /
  `makeProjectIndustry()`. Build them with the makers rather than an inline
  literal — the literals were where the drift lived, each one missing the `id`
  and `sort_order` the real link carries and several naming a `proficiency`
  field `ProjectSkill` has never had.

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
npm test                 # vitest run      npm run typecheck    # client + server + tests tsc
npm run test:watch       # vitest watch    npm run test:coverage  # v8 coverage + ratchet
npm run test:e2e         # build + Playwright (smoke + a11y, three engines)
npm run lint             # eslint (CI gate)   npm run lint:fix     # eslint --fix
npm run check:bundle     # initial-payload budget (needs a build first)
npm run check:text       # raw control characters anywhere git tracks (CI gate)
npm run check:arch       # every module is named in the §3 architecture map (CI gate)
npm run test:mutation    # Stryker over src/lib + server/ — slow, pre-release audit
npm start                # production server (NODE_ENV=production)
npm run desktop          # build client + run the desktop launcher from source (tsx)
npm run build:desktop    # assemble the portable release/ folder (per target OS)
npm run gen:icons        # regenerate the section-icon SVGs
npm run gen:taxonomy     # rebuild the slim Quadim skill-taxonomy JSON
```

### Verifying changes
After any significant change: 1. `npm run lint` (clean) → 2. `npm run check:text` (clean) → 3. `npm run check:arch` (clean — only bites if you added a module) → 4. `npm run typecheck` (clean) → 5. `npm test` (green) → 6. `npm run build` (clean — catches what tsc misses) → 7. `npm run check:bundle` → 8. for UI, click through the affected flow. CI runs steps 1–7 in that order, plus the coverage ratchet, the Playwright suites on three engines, CodeQL, gitleaks, and an advisory depcheck. Before committing anything touching HTML/string templating, the server, auth, persistence, imports, or exports, run through the **security skill** (`.claude/skills/security-review.md`).

### Server / env
- Copy `.env.example` to `.env`; set `RESUME_API_TOKEN` for a deployed instance (empty disables auth — fine for local dev).
- `data/resume.db` is gitignored, WAL on, foreign keys on (required for snapshot CASCADE). `createResumeDb` defensively drops the pre-multi-resume `resume_store` table.
- **Hardening (`server/app.ts`):** CSP + `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy`/`Permissions-Policy` on every response (CSP `'self'` scripts/fonts + inline styles; fonts self-hosted). Auth-gated API is rate-limited with a **failure-focused** limiter (`skipSuccessfulRequests`), tunable via `RESUME_RATE_LIMIT_MAX`/`_WINDOW_MS`.
- **DB file ACLs:** `createResumeDb` chmods a file-backed DB to `0600`, `defaultDb` tightens `data/` to `0700`. Best-effort, no-op on Windows.
- **Translation is optional.** Bundled `docker-compose.yml` runs LibreTranslate (`en,nb,sv,da`); `npm run dev:translate` (`translate:down` to stop), then set `LIBRETRANSLATE_URL` + restart. Intentionally *not* part of `npm run dev` (first boot pulls a multi-GB image). Unset = Draft hides, Copy still works.

### Known quirks
- An injected `PORT` means the CLIENT's port. `npm run dev:server` goes through `scripts/dev-server.mjs`, which pins the API to `RESUME_SERVER_PORT ?? 3001` before handing off to `server/index.ts` — so the in-app preview (which injects `PORT=5173`) no longer has Express win the race for 5173 and leave Vite's `/api` proxy pointing at nothing. Use `RESUME_SERVER_PORT`, never `PORT`, to move the API.
- `.pdf` export is a **vector one-click download** via lazy-loaded `pdfmake` (`lib/pdfExporter.ts`) — no print dialog, no pop-up. Like the DOCX path it's a *separate* render engine (bundled Roboto font, not the brand Open Sans Condensed/Ubuntu), so its layout is close to but not pixel-identical with the HTML preview. Don't statically import `lib/pdfExporter.ts` or `pdfmake` from any always-loaded file.
- The DOCX exporter (`lib/exporter.ts`) is lazy-loaded via dynamic import in `views/ViewEditor.tsx` (~378 kB chunk). Don't statically import it from any always-loaded file.
- CVpartner project skills may have proficiency=0 across the board — don't assume non-zero.

### What NOT to change without good reason
- The dual-view multi-language pattern (DualField). It's the whole point of the app.
- The shared role/skill registry design.
- The CVpartner importer's locale detection (handles real-world malformed exports).
- The `loadStore` vs `replaceData` split (§7) — load-bearing for undo + auto-save.
- The lazy import of `lib/exporter.ts` (removing it adds ~350 kB to the initial bundle).

---

## 12. Future work

**Everything not yet built lives in `plans/open-items.md`.** It holds the
unbuilt features with their design notes and cost, the deferred infrastructure
with the condition that should trigger each, and — the part that matters most —
the decisions that are CLOSED, so they stop being re-proposed. Read it before
proposing anything.

`plans/` holds that file plus, at most, the plan for whatever is **in flight**
right now (nothing is, currently). A plan whose work has shipped is deleted,
because the deliberation belongs in git history and a stale plan reads like a
commitment.

**Recently shipped — don't re-propose.** The catalog is
`.claude/feature-map.md → Recently shipped`. In brief: multi-resume, offline
editing + conflict safety + three-way merge, the desktop build with JSON sync and
auto-update, the section-descriptor catalog + export templates + BYO-LLM
tailoring + ATS text/Markdown, LinkedIn/Europass/AI import, the Quadim
skill-taxonomy integration, the showcase→category unification, the Industry
registry + generic `mergeRegistry`, career timeline, global search, cross-resume
shared registries, the Profiles rework and profile bundles, cover letters, the
v0.3.1 UX/accessibility wave, the v0.10 advanced-assist tier (twelve assists +
the bilingual glossary), multi-user accounts with per-resume ownership (§16),
the non-PWA offline shell, and the 1.0.1 export parity work — one set of facts and
one set of style choices across the preview, PDF, Word and ATS text, with the
optional extras chosen per view (`lib/sectionExtras.ts`) rather than per target.

**Two things are settled and are not open questions:**

- **UI chrome is English-only, permanently** (July 2026) — no `t()` layer, and an
  English literal in a component is not a defect. **Export chrome is a different
  thing and is already localized** for all 15 locales; the boundary is that a
  string is localized if it lands in an exported `.pdf`/`.docx`/`.txt`. ESLint
  enforces it — `lib/exportStrings.ts` cannot be imported from `src/components/**`.
- **An application/tender log is out of scope** — it pulls the product toward
  bid-management software. This stays a resume tool.

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
- **The launcher is bundled to CJS** (esbuild; only `systray2` is external — there is no native addon left to keep out). So **launcher code must not use `import.meta`/`__dirname`** — it uses env + `process.cwd()`. `app.ts`/`db.ts` guard `import.meta.url` (`import.meta.url ? … : process.cwd()`) because esbuild emits `""` for it; don't "simplify" that back or the bundle crashes at boot.
- **The local address is a NAME, and the guard knows two kinds** (`server/localHost.ts`).
  `resumestudio.localhost` needs no setup — RFC 6761 reserves the whole
  `.localhost` TLD for loopback, browsers resolve it internally, and it is not
  delegated in the DNS root, so `app.ts`'s rebinding guard accepts **any**
  `.localhost` name unconditionally. **It is also the DEFAULT**
  (`DEFAULT_SETTINGS.local_hostname`): the launcher opens the name on every OS
  with zero configuration, and an ABSENT `local_hostname` key coerces to it —
  that absence was exactly why an upgraded install kept opening `127.0.0.1`. An
  explicitly stored `''` remains the Address tab's "Use the IP address" opt-out
  and is preserved. `resumestudio.local` needs a hosts-file
  line, so it is accepted only when the user configured it
  (`RESUME_LOCAL_HOSTNAME`). Names are constrained to those two suffixes: an
  arbitrary one written into a hosts file could shadow a real site on the user's
  machine. The hosts rewrite is a PURE text transform over a delimited managed
  block (nothing outside it is ever touched) plus a per-platform elevated COPY
  of a staged temp file — no user-supplied text ever reaches a command line, and
  success is confirmed by re-reading the file, never by a helper's exit code
  (a cancelled prompt exits 0). Port preference is **80, then 1923**, because
  a developer machine running IIS is the normal case; an explicitly pinned port
  is the only candidate tried. The launcher only opens a configured name after
  `resolvesToLoopback()` confirms it reaches this machine — otherwise a removed
  hosts entry would present as "the app won't start".
- **Paths come from `server/config.ts`** (pure). The launcher sets `RESUME_DB_PATH` + `RESUME_CLIENT_DIR` before `createApp()`/first DB use. **Data dir** is per-user OS-standard (`%APPDATA%\ResumeStudio`, `~/Library/Application Support/ResumeStudio`, `~/.local/share/resume-studio`), overridable via `RESUME_DATA_DIR` — matches Electron's `app.getPath('userData')`.
- **Sync model = ONE FILE PER RESUME, NOT the live DB in the cloud folder.** `RESUME_BACKUP_DIR` holds `<slug>__<resume-id>.json` per resume (`resumestudio-resume/v1`), plus `resume-studio-registry.json` (`resumestudio-registry/v1`) and `resume-studio-deleted-resumes.json` (`resumestudio-tombstones/v1`), each written atomically — see `server/backupFiles.ts`. **One file per person because erasure has to be actionable per person:** a resume is one identified individual's data, and with a monolith "remove this person from the backups" meant rewriting a file containing everybody else. Merge is **newest-wins per resume by `saved_at`, union** (`db.restoreResumes`, `merge` mode). Live SQLite in a sync folder is intentionally avoided (corruption); `RESUME_DB_JOURNAL=TRUNCATE` is the documented escape hatch.
- **Identity is the id INSIDE the file; the filename is a hint.** `scanBackupDir` keys on `resume.id`, so two machines converge on one resume even mid-rename, and `writeResumeFiles` deletes the stale-named file afterwards. The slug is ASCII-folded (Nordic letters transliterated, combining marks stripped) so Windows/macOS/Linux derive byte-identical names from the same resume. A write pass **never deletes a file for an id it doesn't hold** — another machine may have just published a resume this one hasn't merged, and treating "not in my DB" as "delete" would make two machines erase each other's new work every round.
- **Every inbound path merges by id.** `POST /api/backup/import` (zip, single resume file, or legacy combined JSON) shares `restoreResumes` with folder sync. This fixes a real duplication bug: dropping the sync file on the picker — the obvious way to set up a second computer — used to run each resume through `createResume`, minting a NEW id per import, which then synced back and duplicated machine one. `isMergeableBackupFormat` (client) is the router; `resumestudio/v1` deliberately does NOT match, because that download carries no identity and legitimately creates a new resume.
- **Deletion propagates via tombstones.** `DELETE /api/resumes/:id` calls `recordDeletion`: removes the resume's file(s) and appends `{id, deleted_at}` to `resume-studio-deleted-resumes.json` — **id and timestamp only**, so the record that propagates an erasure is not itself personal data. `applyTombstoneRules` treats a delete as just another timestamped change: a copy saved AFTER the deletion is a revival and is kept. Erasure runs AFTER the merge so a stale file can't resurrect the resume, and a pending tombstone is checked against the LOCAL row's `saved_at` (a resume edited here but not yet published has no file arguing for it). Tombstones expire after `TOMBSTONE_TTL_MS` (1 year).
- **Registries are carried twice, on purpose.** `resume-studio-registry.json` syncs the whole instance registry, AND each resume file embeds the canonical entries that resume references in full (id, kind, localized name, extra) — so a single file lifted out of the folder can recreate the registry it depends on in a fresh instance. `db.mergeRegistry` unions by key (newest-wins by `updated_at`, keeps the existing id, never deletes); a dangling `canonical_id` degrades to per-resume display, fixable by re-publishing.
- **Sync runs continuously, both directions (not just at launch).** `backupScheduler` polls the DB and writes edits OUT on `backup_interval_ms`, gated on `storeSignature` = resumes **+ registry** (`resume-studio-registry.json` is its own file now, so gating on resume `saved_at` alone would leave it stale); `backupWatcher` (fs.watch on the folder + a `folderFingerprint` poll backstop for cloud/network folders where events are unreliable) merges other machines' edits IN. The fingerprint covers every JSON file's name/size/mtime — one file's mtime would miss another machine ADDING a person, which touches nothing existing. This matters because the app is normally left running for days, so a launch-only boot restore would rarely re-read the folder. Both are owned by `backupRuntime` and started/stopped together by `reconfigureBackup`/`stopBackup`. **Feedback-loop guard:** before merging, the watcher compares the folder's `backupSignature` to the live DB's — our own scheduler write matches, so it's a no-op. The watcher merge bumps each affected resume's `version`, which the open editor's `version` poll notices → `RemoteUpdateNotice` (reload); half-written files mid-sync land in `scan.unreadable`, which holds the change gate back so the next tick retries.
- **The pre-split monolith is read, then retired.** `resume-studio-backup.json` (`resumestudio-store/v1`, `server/backup.ts`) still parses through `reconcileSources`, so an existing folder upgrades with nothing lost; once every resume it held has its own file, `writeResumeFiles` deletes it. Leaving it would keep a file holding everyone's CV that per-person erasure can't touch.
- **`db.close()`** does `wal_checkpoint(TRUNCATE)` then close. Keep shutdown ordering: `tray.kill()` → `flushBackup()` → `closeDefaultDb()` → `server.close()`.
- **System-tray icon = the user's Quit affordance** (`desktop/tray.ts`, `systray2`). Tray Quit calls the same `shutdown()` — never add a "quit" control to the web UI. Gotchas: register `onClick`/`onError` only after `await systray.ready()`; the CJS↔ESM interop puts the `SysTray` constructor in different places under `tsx` vs the bundle (`tray.ts` resolves defensively). `systray2` is **external + vendored** in the build; best-effort (any failure → null, app keeps running).
- **Three backup concepts, don't conflate:** `src/lib/backup.ts` = per-resume client download, no identity, creates a copy (`resumestudio/v1`); `server/backupFiles.ts` = the sync folder's per-resume files, identity-bearing (`resumestudio-resume/v1`); `server/backupZip.ts` = the manual "Export all resumes" archive, which is just those same files zipped (`GET /api/backup/export`, `POST /api/backup/import`). `server/backup.ts` is now only the LEGACY combined format's reader.
- **MACHINE-level settings are desktop-only; a hosted owner edits a named
  subset.** The launcher sets `RESUME_DESKTOP=1`; `settings.ts → isDesktop()`
  gates the full editable surface. `loadOrInitSettings()` seeds `settings.json`
  from env, then `applyToEnv()` pushes it back onto `process.env` so the
  lazily-env-reading translate/backup code picks up changes with no restart.
  Keep translate/backup reading **env**; route runtime changes through
  `applyToEnv` (+ `reconfigureBackup` for the stateful scheduler). A VPS never
  sets `RESUME_DESKTOP` → `/api/settings` reports `managed:false`, and PUT
  refuses anything outside `OWNER_EDITABLE_KEYS` (mail, the base URL, the
  operator's own identity). Everything else — ports, the local hostname, the
  sync folder — is a property of the machine, and a web request that could move
  those is how an instance talks itself off the network.
  - **The file means something different on each.** On the desktop it is an
    authoritative SNAPSHOT of everything. On a server it is a **sparse OVERLAY**
    on the environment: it holds only the owner-editable keys actually saved,
    and only those are projected onto env at startup. Both halves are
    load-bearing and both were wrong. Presence must be read from the RAW parse,
    never from a `coerce`d object — coerce fills in every key, so
    `saved[key] !== undefined` is always true, and that dead guard projected
    every unsaved key's DEFAULT over the operator's real environment. And a
    save must accumulate into the file rather than merge into
    `loadSettings()`, which answers `DEFAULT_SETTINGS` when there is no file —
    so the first save wrote all 36 keys, handing the whole default set
    authority over the environment from then on. Live symptoms:
    `RESUME_APP_BASE_URL` cleared (invite and reset links became bare
    unopenable paths) and `MAIL_TRANSPORT` forced to `off` (mail stopped),
    silently.
- **Managed translate = the app drives Docker** (it doesn't bundle the engine). `translateDocker.ts` shells out argv-only; best-effort, never throws into the request path. After changing translate settings the client calls `resetTranslationAvailability()`. Keys are write-only over the API (`toView()` returns `*_set` booleans, never the value).
- **Auto-update = staged-swap, not Electron.** `updater.ts` checks GitHub Releases, downloads the per-platform `.tar.gz` (host-allowlisted — SSRF guard), extracts with system `tar`, validates the tree. To replace files a running process can't overwrite (esp. `node.exe` on Windows) it writes a detached per-OS swap script (`buildSwapScript`) that waits for our PID, mirrors the staged build over `RESUME_INSTALL_DIR`, relaunches, and self-deletes. Gated by `isUpdateSupported()` — VPS reports `supported:false` and 403s (a server must never rewrite its own files). `RESUME_NO_UPDATE` disables; `RESUME_UPDATE_REPO` overrides. Keep `assetNameFor` in `updater.ts` and its copy in `build-desktop.mjs` in sync.
- **Version source of truth (don't reintroduce the v0.3.2 drift bug).** A *published* build's version is the **git tag** — `release.yml` derives it from `GITHUB_REF_NAME`, exports `RESUME_APP_VERSION`, and **hard-fails if `package.json` doesn't match the tag**. To cut a release: bump `package.json` **and** `package-lock.json`, commit, then tag `vX.Y.Z`. Local `npm run build:desktop` (no env) uses `package.json`.
- **Two version strings, and only CI may claim the release one.** `APP_VERSION` stays a bare semver (the updater compares it to the latest release); `APP_VERSION_LABEL` is what humans read — `v<semver>` **only** when `RESUME_BUILD_CHANNEL=release`, which is set in exactly one place (`release.yml`, beside the tag check), otherwise `Dev-<commit>`. The channel is **declared, never sniffed**, for the same reason as `llm_high_end` (§15): a local `build:desktop` produces a near-identical tree, so anything the tree can observe about itself would let a working copy claim to be the artifact users downloaded. The tray, the Version tab, the picker footer and the update banner all render the server's label **verbatim** — don't re-add a `v` prefix at a display site, since `Dev-…` has no version number to prefix.
- **Windows update UX:** the swap is a **visible PowerShell window** with a progress bar (file-by-file `Copy-Item`); the **relaunch is windowless** via `wscript.exe` (invoked by name — never by file association, which opened a text editor and was the original install bug) running `Resume Studio (no window).vbs`. POSIX stays a detached `sh` script. **The swap never waits on a bare PID** — a freed PID can be reassigned within the shutdown handoff, and `Wait-Process -Id <pid> -Timeout 60` once sat a full minute on the stranger (a ~70s update that should have taken ~10). Windows waits (bounded) until no process is running the *installed* `node.exe`; POSIX bounds its wait and checks the PID still names a node process. A locked destination file is **renamed aside** (`*.updater-old`, swept next run) rather than retried into oblivion — the plain retry loop once exhausted its budget on `node.exe` and silently skipped it, leaving the new app on the old binary; any file that still fails is named in a visible WARNING, never skipped silently. See `DESKTOP.md §6`.

---

## 15. The advanced (high-end) assists

A second tier of AI features that only appear when the operator has declared the
configured model **high-end** (`llm_high_end` / `LLM_HIGH_END`). They differ from
the ordinary assists in kind, not just degree: every earlier assist looks at ONE
field or ONE item, because that is all a small model can hold. These read the
whole CV and make comparative judgements about it.

### The gate

- **Declared, never sniffed.** Nothing in a model name reliably reports
  capability (`claude-opus-4-5` parses to no parameter count; a `compat`
  endpoint can front anything), and being wrong doesn't fail loudly — a 3B model
  answers a whole-CV review fluently and wrongly. The settings checkbox is
  pre-ticked by `llmAssist.looksHighEnd()` but the user always decides; the
  suggestion stops re-firing once they express an opinion.
- **Two enforcement points.** Client: `AdvancedAssistCard` (+ `useAdvancedAssist`)
  renders *nothing* when the flag is off — the ONE place the client checks, so
  twelve features can't each get it wrong. Server: `POST /api/llm/complete` with
  `advanced: true` **403s** unless the flag is set, and only then grants the
  bigger budget (240 k prompt chars / 16 k output tokens / 180 s vs 60 k / 4 k /
  45 s). The server half is what a stale tab can't bypass.
- Hidden, never disabled — same rule as the rest of the AI surface. A disabled
  control advertises a feature while refusing it, with the fix three screens away.

### The shared vocabulary (build new advisors on these, don't fork them)

- **`lib/cvFields.ts`** — the key-oriented per-section map of text fields.
  `prose: false` marks identity fields (customer, employer, school): readable,
  **never rewritable**. Distinct from `completeness.collectTrackedFields`, which
  is label-oriented for reporting; a cross-check test pins them together.
- **`lib/cvDigest.ts`** — the ONE way a CV is rendered into a prompt, so an item
  id in one advisor's reply resolves in another's validator. `buildBilingualDigest`
  reads **raw locale slots, never `resolve()`** — the fallback chain would show
  the English text in the Norwegian column and report perfect agreement.
- **`lib/assistFindings.ts`** — advisory results (A1/A3/D3). Findings carry NO
  replacement text; `ask` (a question back to the user) is the escape valve.
  Unknown references are **dropped with a note, not fatal** (viewTailor's rule).
- **`lib/assistProposals.ts`** — field rewrites (A2). Carries the original for
  before/after, refuses non-prose fields, and **re-checks at apply time**: the
  panel is non-blocking, so a field edited after the run is skipped rather than
  overwritten. The batch applies through `replaceData` as ONE undo step.

### The twelve

| | What | Where |
|---|---|---|
| A1 | Whole-CV review → findings | Overview (`CvAdvisors`) |
| A2 | Consistency & voice → proposals | Overview |
| A3 | Cross-language MEANING (drift.ts's missing third signal) | Overview, needs a secondary locale |
| A4 | Achievement mining → highlights / competencies | Overview |
| D1 | Profile + competency bundle generator | Profiles editor |
| D2 | View introduction draft | View editor, under the intro field |
| D3 | "What's missing" per section | Section bar, next to Bulk summarize |
| B1 | Job fit report vs a pasted posting | Overview (`JobFitPanel`) |
| B5 | Letter angles + critique | Cover letter editor, under the body |
| C1 | Freeform intake from messy prose | Bulk add modal — **upgrade, not a new surface** |
| B4 | ATS keyword audit of a view's export | View editor, last block. **Pass 1 needs no model** |
| C4 | Registry merge + category proposals | Skill Registry — **proposals only, never applies** |

**B4** audits the ARTIFACT, not the CV: it reads `buildViewText`'s real output.
Its free first pass is a string search with no model at all, so it works on an
install with no AI — only the synonym/cross-language second pass is gated.
Three-way status, and the middle one is the prize: `elsewhere` (in the master CV
but excluded by THIS view) is fixed by re-including an item, with no writing.
It must never become a keyword-stuffer: a `missing` term carries no suggestion,
and a `covered` verdict with no supporting quote is downgraded, because the
quote *is* the evidence.

**C4 is proposal-only by construction** — `validateHygiene` has no code path to
a mutation, nothing is pre-ticked, merges have no "select all", each row states
what it deletes and how many references it rewrites, and a confirm names the
totals before `applyHygiene` runs. It also never re-categorises a skill the user
placed themselves. A registry merge is the most destructive act in the app and
the least noticeable when wrong.

### Advisor runs outlive the page (`store/useAdvisors.ts`)

An advisor run costs real tokens and can take a minute, and every result invites
you to navigate away (each finding has an "Open" button). So runs do NOT live in
component state:

- **A separate store from `useStore`** — advisor state must never be auto-saved,
  synced, snapshotted or pushed onto the undo stack, and living in the resume
  store would do all four.
- **The RAW reply is stored, not the parsed result.** Validators resolve ids
  against the live CV, so re-parsing on render means a finding about an item you
  since deleted drops out by itself — no invalidation logic to get wrong.
- **Resolution is per suggestion** (`resolved: Record<key, 'accepted'|'dismissed'>`).
  Accepting one of five must leave four; that was the reported bug.
- Persisted to localStorage (7-day expiry) so a reload doesn't bin paid-for work.
  A run that was in flight when the tab closed restores as an ERROR, never as a
  spinner nothing can finish.
- `AssistRun` takes an optional `advisor={ref}`: with it, the request is fired
  into the store and the component can unmount mid-flight.
  `components/ui/AdvisorToast.tsx` is mounted at APP level so the "ready"
  notice reaches you wherever you went.
- **Runs can be SCOPED** (`AdvisorRef.scope`): one advisor, several targets — a
  view id for D2/B4, a section key for D3, `fieldScope(section, itemId)` for the
  field advisors. Without it, drafting an intro for the second view would
  silently replace the one you were still reading for the
  first. `advisorSection(run)` sends a finished scoped run back to where it
  belongs rather than to a static per-advisor home.
- **The FIELD advisors are in this store for the same reason, one level down**
  (`FIELD_ADVISORS` = `write` / `points` / `skills` — the writing assist,
  suggested points and suggested skills). `EditorCard` renders its body only
  while the card is expanded, and clicking any other item collapses it, so a
  panel holding its run in `useState` lost the spinner mid-request — you could
  not tell whether a reply was still coming — and lost the finished suggestion
  on the way back. They persist now until the user accepts or discards, which
  is the only thing that ends a run. Their TICKS ride along too, in `resolved`:
  coming back to find a carefully-pruned list of eight all re-ticked is the same
  loss in miniature. `AdvisorToast`'s "Show me" must `openItem` AFTER
  `setActiveSection` — the latter clears `expandedItemId`, so the other order
  lands you on the right list with everything shut.
- **`AdvisorRun.input` keeps the user's own input** (the pasted posting) where
  the result can only be read beside it — B4 maps the model's answers onto terms
  extracted from the posting, so a restored report with an empty textarea is a
  table of verdicts about nothing.

**Every panel reads through `store/useAdvisorRun.ts`** — the one adapter between
the run store and a result view (parse-on-render, per-suggestion resolution,
markSeen, collapse). It was extracted from `CvAdvisors` when the remaining five
panels were wired; use it rather than reading `useAdvisors` directly, and use
`jsonReply()` for the usual JSON-payload validators. All ten advanced panels
(A1–A4, B1, D1, D2, D3, B4, C4) go through it, and so do the three field
assists, so no assist result is lost to navigation any more.

**A4 fills both language columns.** An accepted achievement is translated into
the secondary locale (`lib/achievementTranslate.ts`, via the ordinary Draft path
so it carries the C3 glossary) before the write, because a highlight landing in
one column silently makes the other version of the CV say less. Best-effort: no
translator configured means primary-only, which is what happened unconditionally
before.

### C3 — the invisible glossary (NOT gated; helps the small-model path)

`lib/glossary.ts` harvests term pairs from the data that already holds them —
the **registries** (`Skill`/`Role`/`Industry`/`SkillCategory` names are curated
`LocalizedString`s) and short **identity** fields filled in both locales — plus
a do-not-translate list from names written identically in both columns. Prose is
deliberately not mined: that needs a model and would put guesses into a
mechanism whose value is being certain. `scopeGlossary` narrows it to terms
present in the field being translated, so a 300-entry glossary becomes three
lines and a 3B model can obey it. Derived per call — no persistence, no shape
bump. It rides the ordinary Draft button; there is no UI for it.

Provider reach is uneven and `server/glossary.ts` owns that: **llm** gets a
prompt block; **DeepL** gets a real glossary resource, cached by (pair + content
hash) and best-effort (a failure translates without it); **Google v2** has no
glossary API at all, so terminology is pinned structurally with `format=html`
and `notranslate` spans; **LibreTranslate** has nothing to hook into and is
unchanged.

**B1** answers a different question from `viewTailor` — tailoring SELECTS items
once you've decided to apply; this asks whether you can answer the posting at
all. Its third status, **`adjacent`** (the CV shows Docker and Helm; they asked
for Kubernetes), is the one worth having — it's the gap the user can close
honestly by editing their own words. An `evidenced` row whose citation doesn't
resolve is **downgraded to `adjacent`, not dropped**: unproven isn't proof, but
losing the row would break the completeness that makes the report useful.

**C1 is a prompt, not a pipeline.** Freeform intake reuses the section's one
`BulkSectionSpec` for validation/mapping/duplicates/preview — only what the model
READS changes (`intakeInstructions` wraps `bulkInstructions` with messy-source
rules + the text inline, and asks for the advanced budget). **The BYO
copy-prompt/paste-JSON path is untouched and always hands over the plain
instructions**, so a quality-assured import through a stronger external model
stays available whatever is configured locally.

Rules they all keep: **drafts never save** (review, tick, apply); **no invented
facts** — A4 must quote the sentence supporting each proposal or it is dropped,
and A2 may change how something is said but never what; **D1 requires a written
brief** (Run stays disabled without one) because the CV cannot say which career
you want to be read as having next.

---

## 16. Accounts, authorization and the ways back in

The server used to authenticate a **secret**; it now authenticates a **person**,
and scopes what that person can see. Read this before touching `server/auth.ts`,
`server/accounts.ts`, `server/access.ts`, `db.ts`'s query layer, or any route
that returns resume data.

### Three modes, derived from state — never declared

`authMode()` (`server/auth.ts`) answers `open` / `token` / `accounts` by looking
at what exists, not at configuration:

- **accounts** — any user row exists. A session cookie is the way in.
- **token** — no users, but `RESUME_API_TOKEN` is set. The pre-accounts
  behaviour, so an existing server survives the upgrade untouched.
- **open** — neither. The desktop build and local dev.

Derived rather than declared because an env var can disagree with the database,
and the failure of that disagreement is either a lockout or an open server. The
desktop build is `open` and **must stay that way** — one person on loopback
gains nothing from a login screen.

`RESUME_API_TOKEN` survives as a **service credential**: `userId: null`,
`role: 'owner'`. It authenticates but is nobody, so resumes it creates are left
unowned. Real people get accounts; scripts and CI get this. Named
`RESUME_API_TOKENS` are retired — converted into real accounts during bootstrap,
and dead thereafter.

### Authorization lives in ONE module

`server/access.ts` is the only place that decides who may read or write a
resume, for the same reason `lib/lookup.ts` exists: a rule spread across eleven
query sites gets written ten times.

- **owner** sees and changes everything.
- **member** owns what they created; may READ `visibility: 'instance'`; may
  never WRITE a resume they do not own. Sharing grants read only, or "share with
  the team" would mean "let the team rewrite my CV".
- An **unowned** resume is visible only to an owner.

Two invariants that are easy to break and silent when broken:

1. **Every `ResumeDb` method takes a required `Viewer`.** Required, so a call
   site that has not thought about scope is a type error rather than a leak.
   Adding a method means adding the parameter.
2. **A row that exists but is not visible answers exactly as a nonexistent
   one** — `null` / `false` / 404, never 403. A distinct refusal tells a member
   which resume ids exist. This is why a member writing a shared resume gets 404,
   and why the client needs a read-only mode rather than trusting the server to
   say "forbidden".

`tests/server/scoping.test.ts` is the route × role matrix and is
negative-controlled: strip a guard and it goes red. Do not weaken it to make a
change pass.

### Four reset triggers, ONE redemption

An owner-issued link, a recovery code, `npm run recover` on the machine, and the
optional reset email all `mintGrant` and all end at `POST /api/users/reset`.
Four ways in must not become four classes of bug, so there is exactly one place
that sets a password from a token. Add a trigger, never a second mechanism.

Redemption always ends every session for that user: a reset exists because the
old credential may be in someone else's hands.

- `/forgot` answers **identically** whether the account exists, has no address,
  or has an unverified one. It is a "does this person work here" oracle
  otherwise.
- Because it always answers 200, the general limiter (which skips successes)
  never fires on it — hence the separate, success-inclusive recovery limiter in
  `app.ts`. Do not fold them back together.
- The bootstrap code is held **in memory**, so a restart re-issues it and it
  cannot be recovered from disk. Never ship "first visitor becomes the owner".

### The `Secure` cookie flag follows the CONNECTION

`server/cookies.ts` is the one place it is decided, and it keys on `req.secure`
— never on `NODE_ENV`. Deciding it from the build was wrong in both directions:
a production server on plain http (a LAN box) set `Secure` on a cookie the
browser then discarded, and TLS terminated at a proxy with `trust proxy` unset
is the same mismatch in reverse.

The symptom was a **silent sign-in loop** in Safari, which is strictest about
it. Chrome and Firefox hid the same defect behind their trustworthy-origin
exemption for `http://localhost`, which does not extend to an arbitrary host —
so it was a LAN bug everywhere and only ever reproduced in WebKit.

The residual, and why the startup warning exists: an operator terminating TLS
upstream without `RESUME_TRUST_PROXY` now loses the flag rather than getting a
broken login. That is a downgrade instead of a break, so `server/index.ts` says
so loudly at boot.

### Passwords and sessions

`server/passwords.ts` is scrypt from `node:crypto` — no dependency, and no
native addon (see `open-items.md` §3 for what the last one cost). Two things
that bite: the memory cost at the configured parameters exceeds Node's default
`maxmem` and must be passed explicitly, and the **async** form is mandatory —
`scryptSync` holds the event loop for the whole derivation and would stall every
other request.

Hashes are self-describing, so cost can be raised without invalidating anyone;
login upgrades a stale hash through `rehashPassword`, which deliberately does
NOT end sessions (it runs during a successful login).

Sessions are a table; the cookie carries an opaque id and the row stores its
SHA-256. **They do not expire on a timer** — they end on logout, a password
change, or disable. `last_seen_at` is refreshed at most once per five minutes,
because auto-save fires about once a second per open editor.

### Four things an adversarial review found, and the rules they left behind

- **The bootstrap check and the insert must share a transaction.** Hashing a
  password is a several-hundred-millisecond yield, and two requests carrying one
  code both passed `hasAnyUser()` across it — one code, two owners.
  `accounts.createFirstOwner` does the check and the insert with no `await`
  between them. Hash BEFORE calling it, never inside.
- **A locked hash must cost what a real one costs.** `verifyPassword` rejects
  the `locked$` sentinel on its first line, so a locked account answered about
  ten times faster — and a locked account is precisely a converted legacy token:
  existing, password-less, waiting for a reset link. Login runs `dummyVerify`
  for it.
- **A password change clears every recovery code.** A code outlives the session
  that minted it and on its own sets a new password, so one harvested earlier
  survived the victim's only remedy. Regenerating a set costs the current
  password, like every other credential change. `/recover` re-issues, so
  spending your last resort does not leave you with none.
- **A username collides with USERNAMES.** `findByLogin` searches the email
  column too, so a row whose email was a bare word denied that word to a real
  colleague. Addresses are format-checked on the way in, and the collision check
  uses `usernameInUse`, which handles rows planted before the check existed.

### Email is optional and must stay so

`server/mail.ts` is off by default and unlocks exactly one thing: self-service
reset. **No CV content is ever emailed.** Addresses are **rejected, never
sanitised** — a CR or LF injects a header, and `String.trim()` silently removes
exactly those two characters, which is how an injected address once came out
looking valid. Same rule as `server/resumeId.ts`.

### Identity without accounts

The desktop build has no accounts but does have an identity (Settings:
username, display name, email). It stamps `saved_by` and travels with an
exported resume as `ResumeBackupEntry.author`.

`author` is **descriptive, never authorising**. A file cannot prove who wrote
it, so an import assigns nothing from it — the importer owns what they import,
and an owner corrects it afterwards via `POST /api/resumes/:id/owner`. That
route is what makes the import rule safe to keep.
