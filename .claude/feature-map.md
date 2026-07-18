# Resume Studio — Feature Map (detailed)

Reference detail extracted from `CLAUDE.md §1`. This is the exhaustive "what
exists and how it hangs together" catalog. CLAUDE.md keeps a one-line summary
of each feature and the load-bearing invariants; come here when you need the
deep design detail for a specific feature before changing it.

The **invariants** (the "don't change X", the render-boundary sanitisation
rules, the store contracts) live in CLAUDE.md — this file is descriptive, not
prescriptive.

---

## What works today

- **Multi-resume** — one instance can hold N distinct master CVs. Picker
  route at `/`; each resume lives at `/r/:uuid`; header dropdown switches
  between them; hard-delete with confirm (snapshots cascade). Each resume
  carries its own per-resume primary/secondary locales server-side. See §8.
- **"Who knows what" skill matrix** (`lib/whoKnowsWhat.ts` +
  `WhoKnowsWhatPanel`, picker) — the small-team affordance: with ≥2 resumes,
  the picker aggregates skills across everyone into a skill × person grid
  (proficiency per holder; a present-but-unrated ✓ for CVpartner's 0s; a
  shared-only filter for team overlap vs single-holder bus-factor risks; click a
  name to open that CV). **Interim data source**: groups by normalized
  `skillKey` across each resume's own registry, fetched client-side (fine at
  small-team scale). The panel also hosts **"Share registries across resumes"**
  (below).
- **Cross-resume shared registries** (`plans/cross-resume-registries.md`,
  Stage 3, additive-link path) — skills/roles/industries/categories can be
  linked to an instance-level canonical registry so a **rename in one resume
  propagates to all**. Reached WITHOUT a destructive migration: an additive
  `canonical_id?` on each registry entry (§3.0 split — shared identity is the
  name; per-person facts proficiency/highlight/ordering stay on the resume).
  Pieces: server `registry_entries` table + CRUD + `promoteFromResumes`
  (`server/registryDb.ts`, `/api/registry`, `server/skillKey.ts` mirrors the
  client key); pure `lib/registrySync.ts` (`overlayCanonicalNames` — canonical
  name wins at load; `planPublish`/`applyCanonicalLinks`); `lib/registryPublish.ts`
  (the picker "Share…" orchestrator — create canonical + link + save, cross-
  resume dedup via a growing registry); `reconcileRegistry` store action (boot
  overlay, raw set — no auto-save); `useCanonicalRegistrySync` (EditorRoute —
  debounced rename→canonical push, NAME only, never per-resume `category_id`).
  The overlay is authoritative, so a locally-diverged name self-heals to
  canonical on load. Remaining: backup portability (embed+re-intern), a
  registry conflict surface, desktop-merge — see the plan §4/§3.
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
  Category column. The Skill Registry's "By category" view also offers
  **offline auto-categorization** (`lib/skillCategorize.ts` +
  `lib/skillMatch.ts`): a one-click action fills each blank-category skill's
  `category_id` from the library's fine-grained `domain` via a **layered
  matcher** — `exact`
  (normalized: case/punctuation/version-insensitive, "React.js"/"Java 8" land) →
  `token` (a multi-word library name contained in the query) → `fuzzy` (bounded
  edit distance for typos) → `semantic` (a compact token→domain model,
  `generated/skillDomainModel.json`, places a skill by its words) → `graph`
  (relations-graph vote for domainless library nodes). Only `exact` is
  high-confidence; the rest are surfaced as "**inferred — worth a review**"
  (`INFERRED_TIERS`). Never overwrites a manually-set category; applied via
  `replaceData` (undoable + auto-saved).
- **Skill categories are first-class entities** (`SkillCategory` —
  `{ id, resume_id, name: LocalizedString, sort_order }`, shape v6,
  `ResumeStore.skill_categories`) linked from `Skill.category_id`, replacing
  both the old free-text `Skill.category` string AND the separate "Skills
  Showcase" feature's own curated `technology_categories[]` groups (roadmap:
  showcase unification, 2026-07). **`category_id` is a skill's SINGLE grouping
  concept** — the old `skill_type` enum was removed earlier and stays gone;
  only importers/backups may carry legacy `category`/`technology_categories`
  leftovers, converted on load by `migrate.ts → unifyShowcaseCategories` (shape
  v6: a pre-v6 skill's showcase membership WINS over a differing registry
  string, and every skill that was in a legacy showcase group is marked
  `is_highlighted: true`). `effectiveSkillCategory(skill, namesById)` (explicit
  category name, else **"Uncategorized"**; takes a `categoryNameIndex()` built
  once per render) is what the list card subtitle, the By-category grouping,
  and the registry's **category filter** (a dropdown of used categories with
  per-category skill counts) all group on, so the three never disagree. A
  skill with no category groups under "Uncategorized" (sorted last).
  Categories can be **cleared** to make skills auto-categorizable again: a
  per-chip "x" in the By-category view removes one skill's category, and the
  filtered list offers a bulk **"Clear all skills from category (N)"** for the
  shown group (`clearSkillCategories`). By-category headers render in the
  categories' curated **`sort_order`** (not alphabetically) with **↑/↓
  reorder** and a **rename** affordance (a `TranslationPopover` editing the
  category's `LocalizedString` name — `moveSkillCategory` /
  `renameSkillCategory` in `lib/skillCategorize.ts`); the quick-drop panel and
  the category filter dropdown stay alphabetical. A category persists after
  its last skill leaves and is removed only by an explicit delete
  (`deleteSkillCategory`).
- **Skills Showcase** is now a **virtual view section** (`technology_categories`,
  unchanged key for saved-view/template compatibility) that derives its
  groups at render time from `lib/showcase.ts → showcaseGroups()`: every
  non-excluded category (curated order), paired with its **highlighted**
  skills (alphabetical within a group). "Showcase a skill" = highlight it;
  its linked category picks the group. A category with zero qualifying
  skills is omitted from every export but still shows (so it can be filled)
  in the By-category editor. `full`/`summary` view detail is a pure FORMAT
  toggle (tags vs. one-line) — it does not change which skills appear.
- **Freshness & expiry warnings** — the Overview's "Needs attention" panel
  flags expired/expiring certifications and long-running "ongoing" items, and
  the picker badges resumes not updated in 6+ months (`lib/freshness.ts`). The
  current engagement is auto-exempt (a single ongoing employment = the main
  job; a single open full-time project — 100% **or** unspecified allocation =
  the main project), and any remaining warning can be dismissed ("looks fine")
  to snooze it for a year (`Resume.attention_dismissals`, surfaced as a
  recoverable "snoozed" list).
- **Targeted exports via Resume Views** — pick sections, exclude items,
  starred-only filter, custom intro, then export PDF (one-click vector
  download via lazy-loaded pdfmake), DOCX (lazy-loaded docx lib),
  ATS-friendly **plain text / Markdown** (`lib/viewText.ts`), or **Europass
  XML** (`lib/exporterEuropass.ts` — the `SkillsPassport` format public
  tenders ask for, round-trip partner of the Europass importer; covers
  identity/work/education/languages only, by the schema's design, and builds
  a DOM serialized by XMLSerializer so escaping is structural). A **live
  preview pane** in the view editor re-renders the document as you tune it
  (iframe + page-count estimate + optional pop-out window). All catalog-driven
  render paths share the
  **section-descriptor catalog** (`lib/sectionCatalog.ts`).
- **Item bullets** (opt-in, `viewStyle.item_bullets` + `bullet_style`): a glyph
  (• – › ▪) before each item heading with the item's content **hang-indented**
  to line up under the heading, not the bullet. View-wide default + per-section
  override (inherit / off / glyph), resolved like `item_divider`. Off by default
  so existing exports are byte-identical. Implemented in all four adapters —
  HTML (2-column flex), PDF (columns node), DOCX (hanging indent + glyph/tab),
  ATS text (glyph prefix + 2-space indent; Markdown keeps its own `###`
  structure). Full-item layouts only — summary lines, the skill-matrix table and
  the quote/inline layouts are excluded. Helps heading-only sections (Key
  Competencies) read as a list rather than a flat wall.
- **LLM assists (BYO-or-run)** — every AI affordance renders ONE control,
  `components/ui/AssistRun.tsx`, over `POST /api/llm/complete` → `chatComplete()`.
  It owns the two promises: a provenance line saying where content goes
  (`providerBlurb`; "does not leave this computer" only when the server reports
  a LOCAL endpoint — derived from the HOST, so LM Studio on localhost counts and
  a remote Ollama doesn't, failing closed), and a once-per-session confirm before
  a remote *whole-CV* send. `sizeHint()` warns when a prompt looks too big for
  the model but never blocks. **BYO copy-paste is first-class**: the only path
  with no model configured, and a deliberate choice for big content.
  `extractJson()` unwraps the ```json fences and preambles models emit regardless
  of instructions — which also fixed pasting a fenced ChatGPT reply.
  Assists: **tailor / AI import / bulk add** (the existing
  buildX→validateX→applyX libs, unchanged — only the modals gained Run);
  **skill extraction** from a project's prose, interned against the registry via
  `skillKey` so React.js resolves to React and never duplicates it (no fuzzy
  matching: Spring Boot ≠ Spring); **anonymisation leak check** (pass 1 is free
  and needs no model — the store knows every real customer, so a literal scan of
  the rendered view catches "Led the Acme migration"; pass 2 is an opt-in model
  residual for names never recorded); **project highlights** drafted from the
  description (reshaping, never invention); **page-limit fitting** (proposes whole
  items to cut through `excluded_item_ids` — never rewrites prose to fit);
  **cover-letter body** drafted from the posting + the linked view's filtered
  evidence (see below).
- **Cover letters** (shape v10, `lib/coverLetter.ts` + `CoverLettersEditor`) —
  their OWN entity (`data.cover_letters[]`), a document-builder sibling of
  Resume Views in the Export sidebar group. A letter is per-APPLICATION and
  REFERENCES a view (`view_id`) — the CV it accompanies — so you write several
  against one view. Reader-facing fields are `LocalizedString` (DualField;
  multi-language like everything else); the body is plain multiline prose.
  The AI draft returns the body verbatim (prose, not JSON — unlike tailoring),
  grounded in the posting + the linked view's `applyView` catalog so the letter
  pitches the same story the tailored CV tells (or the master CV when no view is
  linked). Export to PDF / DOCX / text via `resolveLetterParts` (one shared
  parts resolver, so the three paths agree): the letter reuses the linked view's
  resolved fonts + accent so letter and CV read as one submission. NOT a resume
  section — `cover_letters` is in `NON_EXPORT_KEYS`, so it never appears inside a
  view. Backup round-trips it (`BackupV1.cover_letters?`, `validateBackup` gates
  it as an id-array); `wipeLocale` clears its localized fields.
- **Bulk item selection** in a section's expanded item list
  (`ItemSelectTools` over pure `lib/viewItemSelect.ts`): **All / None** for
  long sections, plus **tri-state type chips** for sections whose items carry a
  classification field (Other roles → `position_type`, Publications →
  `publication_type`) — "include every board seat, drop the rest" in one click.
  Facets are data-driven (one entry in `TYPE_FACETS`); registry links (a
  project's roles) are deliberately excluded — many-per-item makes "select all
  with role X" ambiguous. Operations are set-math over the view's flat
  `excluded_item_ids`, so they never touch another section's exclusions.
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
- **Per-section bulk add** (`lib/bulkImport.ts`,
  `components/ui/BulkImportModal.tsx`) — the narrow sibling of the AI import,
  for when a pile of material needs to land in ONE section of a resume that
  already exists. Every content section's `SortBar` carries a **Bulk add**
  button top-right (not Languages, not the registries); the lightbox generates
  section-specific instructions (Copy / Download .md) to paste into any LLM
  with the source material, then takes the returned `resumestudio-bulk/v1`
  JSON back. **One `BulkSectionSpec` per section** drives the instructions,
  validation, mapping, preview and duplicate keys — adding a section is adding
  a spec. The file carries a `section` discriminator checked against where the
  user stands (a Projects file can't land in Courses). Text fields accept
  `string | { no: …, en: … }` so an LLM fills both language columns in one
  pass, and the instructions name the resume's actual locales. The preview
  lists every item with a checkbox; likely duplicates (name matching in ANY
  locale + date) are flagged and unticked but overridable. Confirm applies via
  `replaceData` → one undo step, auto-saved. Skills/roles intern into the
  existing registries; a deselected item's registry entries never land. The
  `SortBar` renders for bulk even with zero items — an empty section is when
  it's most useful.
- **Languages is a deliberate one-line special case.** Every other section's
  modes trade a summary line for a prose block; a language and its level is a
  fact, so all three modes are densities of the same line: `summary` = the
  compact scan flow (name — level, every language side by side, no passport),
  `full` = one line per language with the Europass levels (appended when
  they're a single value, dropped onto their own lines via `cefrLines` when
  understanding / spoken / written disagree — a group whose own categories
  disagree spells them out), `tabulated` = name | level | passport columns.
  The descriptor emits the passport only when `CatalogCtx.detail ===
  'tabulated'` so it earns a column without bloating the plain line; a `'\n'`
  in a `SummaryPart` is the cell's line break (escaped per line, then joined
  with our own `<br>`).
- **Per-section `starred_only`** (`SectionStyle.starred_only`,
  `sectionStarredOnly`) — one view can list every course but only the featured
  projects. Tri-state: an explicit `false` beats a view-wide `starred_only`
  (hence `??`, not `||`), so the style panel offers view-default / starred /
  all rather than a checkbox.
- **Footer note placement** (`ViewFooterConfig.note_placement`,
  `viewHeader.footerLines`) — after / before the copyright on one line, or
  above / below it on its own. Composed once in `footerLines` and consumed by
  all three render paths, so a note can't sit beside the copyright in the PDF
  and above it in the preview. Absent = 'after' (how it always rendered).
- **AI summarize assist** (`server/summarize.ts`, `server/summarizeDocker.ts`,
  `lib/summarizeClient.ts`, `lib/summarizeBatch.ts`) — drafts a one-line short
  description from a long one, mirroring the translate architecture: a
  pluggable server proxy (`SUMMARIZE_PROVIDER` ∈ `off|ollama|openai|compat`)
  with an app-driven **local Ollama in Docker** as the first-class option, keys
  server-side, availability memoized client-side. **No heuristic fallback** —
  unconfigured means the affordances don't exist. Two surfaces:
  - **Per column** — a Summarize button on `DualField`'s short-description
    input, shown when that column has source text. Same-locale: the model
    writes in the language it reads.
  - **Whole section** — "Summarize all empty (N)" in the section bar next to
    Bulk add, shown only when a backend is configured AND N > 0. The work list
    is every (item, *visible* locale) whose summary is empty and whose long
    description has text — `SUMMARY_FIELDS` maps source→target per section
    (Projects/Employment read `long_description`, Publications the `abstract`,
    Recommendations the `text`). Disabled items are skipped. Requests run
    sequentially (a local Ollama would drown in twenty at once) with progress
    and a stop control; results apply in ONE `replaceData` at the end — even
    when stopped or failed partway, so no completed work is lost, and the whole
    batch is a single undo step. Both surfaces share `summarizableSource` so
    the count can never disagree with the buttons. Drafts are review-required.
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
  `project.roles[].role_id`. **Industries** are the third registry kind: a
  project links to one or MORE via `Project.industries[]` (ProjectIndustry
  snapshots; shape v4 — a single `industry_id` pre-v4), edited as chips like
  skills/roles. `migrate.ts → internProjectIndustries` interns existing/imported
  free-text industries into `data.industries` (deduped) and produces the
  `industries[]` array; `mergeIndustries` rewrites the links (deduping when a
  project already lists the target).
- **Global content search** (`lib/contentSearch.ts`) — a Ctrl/Cmd+K command
  palette (`GlobalSearch`) substring-searches every section, registry and the
  header, ranks title matches first, and jumps to the item.
- **Career timeline** — an Overview card (`lib/careerTimeline.ts`) showing
  employments, education + projects as an overlap-packed timeline with
  work-history-gap detection (education counts as coverage, so study periods
  aren't gaps) and a full-viewport-width zoom modal for readability.
- **Cross-language drift check** (`lib/drift.ts`) — the Overview panel below
  translation completeness. Where completeness asks "is this field translated
  at all?", drift asks the follow-up the app's whole promise rests on: for a
  field filled in BOTH the editing-pair locales, have the two versions
  diverged? Two structural, offline heuristics (no LLM): **numbers** (high
  severity — the multiset of digits differs; `numberDiff` reports only the
  delta, e.g. "2027 only in EN", so a 20-year timeline doesn't dump a wall) and
  **length** (low — one side ≥2× the other and the longer side is ≥6 words, so
  title-like fields are spared). Walks the SAME curated field set as
  completeness via the shared `collectTrackedFields` (add a field once, both
  reports see it), and each finding carries the completeness `MissingField`
  locator so a click navigates to the item. Only shown with a second language
  selected. A semantic (LLM/AssistRun) pass is the natural third signal, not
  yet built.
- **Accessibility regression net** — `tests/components/a11y.test.tsx` runs
  jest-axe (dev-only) over the editor surfaces; keep new editors passing it.
- **Registry management** — Skill, Role and Industry lists carry an "Unused /
  Missing translation" filter bar; each card shows its usage breakdown as
  "N projects | M categor(y|ies)" (skills) or "N projects | M employments"
  (roles), and a per-card expansion lists the actual referencing items with
  click-to-jump. The **"Missing translation" filter is a batch surface**
  (`MissingTranslationList` + the `useFrozenMissing` freeze hook): instead of
  collapsed cards it renders a compact list of directly-editable `DualField`s
  (name only — the one translatable registry field) with the Copy button, so a
  consultant can type/Copy many translations without opening each entry;
  completed rows stay (✓) until the filter changes so they don't vanish
  mid-keystroke. A **"Show all" toggle** swaps the frozen-missing list for every
  entry (review/correct any translation), and each row can **expand to the full
  editor** in place (`renderEditor`). The **category field** in the Skill/Role
  editor is a bound styled autocomplete (`CategoryField`) — NOT a native
  `<datalist>`: it stores raw text so spaces type freely (commits/trims on
  blur), and shows a distinct "New category" row so creating vs. picking an
  existing category is obvious. The Skills list's **category selector lives in
  the filter bar** (`FilterBar`'s `extra` slot), not on its own line. Project / tech-category skill chips are added through an
  **autocomplete** (existing skill OR auto-create from typed text); clicking
  an already-attached chip opens a `DualField` popover (the shared
  `TranslationPopover`) that edits the **registry** entry's translation (so the
  change propagates to every reference). The **same chip + autocomplete +
  dual-language popover** pattern is used for **project roles** and the
  **employment role link** (picking an existing role fills both languages; the
  popover edits the registry Role), plus linking a reference to a project /
  employment. The **Skill and Role registries** also have a **"By category"
  view** (`Skill.category_id` → a `SkillCategory` entity; `Role.category`,
  still optional free-text): a compact grouping of item titles under category
  headers, where dragging an item onto another header recategorizes it
  (dnd-kit `useDraggable`/`useDroppable`). While
  dragging, a **`DragOverlay`** floats a copy of the chip under the cursor (the
  original dims), and a **fixed quick-select panel** lists every category as a
  drop target on the right, so a long list needs no scrolling (panel droppables
  mount mid-drag, hence `MeasuringStrategy.Always` + `pointerWithin`;
  `dropTargetCategory` resolves a header/panel drop id to the category).
  Clicking a chip opens the full editor in a **lightbox** (with a trash
  **delete** button); the "Add" button here creates the item AND opens that
  lightbox. Each header has a **trash button** that DELETES the category
  ("Delete category and all skill assignments") — the per-chip "×" only removes
  one item's assignment. **Skill categories are first-class entities**
  (`ResumeStore.skill_categories: SkillCategory[]`, shape v6): a category
  persists in the list/filter/By-category view after its last skill leaves,
  and is removed ONLY by an explicit delete — see `skillCategoryList` /
  `assignSkillCategory` / `deleteSkillCategory` / `renameSkillCategory` /
  `moveSkillCategory` in `lib/skillCategorize.ts`. Skill category headers also
  render in their curated **`sort_order`** with **↑/↓ reorder** and a
  **rename** popover. (Role categories are still purely derived string groups —
  no entity, no empty-persistence, no reorder.) Both
  editors share the generic `RegistryCategoryView` / `CatGroup` / `CatChip` /
  `RegistryLightbox` (a skill's category is the consultant's own organisation;
  distinct from the Quadim `classification`); the shared `TranslationPopover`
  used for the rename affordance (and every registry-chip translation edit)
  lives in `components/ui/TranslationPopover.tsx` — not `RegistryEditors.tsx`,
  to avoid a circular import with `RegistryCategoryView.tsx`.
- **React error boundary** around the editor so a crashed view never traps the
  user.
- **Downloadable desktop build** — a portable folder (bundled Node + esbuild'd
  server + built client) with a double-clickable launcher that boots the app on
  a free loopback port and opens the browser. Data lives in a stable per-user OS
  folder; an optional **whole-store JSON backup** written to a cloud-synced
  folder (Google Drive/Dropbox/OneDrive) syncs CVs across computers via a
  newest-wins merge on launch. Build with `npm run build:desktop`. See
  CLAUDE.md §14 and `DESKTOP.md`. The persistence architecture is unchanged, so
  a later move to Electron is repackaging, not a rewrite.
- **Automatic updates (desktop build)** — the system-tray "Check for updates"
  item (plus an in-app picker banner + Settings → Updates) checks GitHub
  Releases daily / on demand, toggles to "Install update (vX.Y.Z)" when a newer
  release exists, and on click downloads the per-platform `.tar.gz` and swaps
  the build in place via a detached per-OS script, then relaunches. Desktop-only
  + `isUpdateSupported()`-gated (the VPS build reports `supported:false`). No
  Electron, no code signing. See CLAUDE.md §14 and `DESKTOP.md` §6.

## What's intentionally simple

- The **router** is a hand-rolled ~150-line History API hook
  (`src/lib/router.ts`) — no dep. Routes: `/` picker, `/r/:id` editor,
  `/r/:id/:section` (active section in the URL — refresh keeps your place,
  Back walks sections), `/r/:id/views/:viewId` (one view open), plus a 404.
  The URL is canonical: `EditorRoute` two-way-syncs it with the store
  (URL→store first, store→URL second — order is load-bearing). Express prod
  has a catch-all so bookmarked URLs work.
- Styling is **inline `<style>` blocks per component** + CSS custom properties
  in `src/index.css`. No Tailwind, no CSS-in-JS lib.

---

## Recently shipped (don't re-propose)

Live preview pane in the Resume View editor, field-level translation assist
(Copy + provider-proxied Draft), server-side snapshot history, **multi-resume
support**, **offline editing + conflict safety**, the **downloadable desktop
build + cross-computer JSON sync**.

**June 2026 wave:** **section-descriptor catalog** (`lib/sectionCatalog.ts` —
one descriptor feeds the editor titles + all render adapters), **export
templates** (`lib/viewTemplates.ts`, via `template_id`), **BYO-LLM view
tailoring** (`lib/viewTailor.ts`, paste a job posting), **per-view
anonymization** (`force_anonymized`), **ATS plain-text + Markdown exports**
(`lib/viewText.ts`), **LinkedIn + Europass importers**, the **skill-matrix
view section** (`lib/skillMatrix.ts`), **named tokens + saved_by attribution**
(`RESUME_API_TOKENS`), the full **Quadim skill-taxonomy integration**
(`lib/skillTaxonomy.ts` autocomplete + relations; `lib/skillNormalize.ts`
import normalization + classification stamping; the matrix Category column),
the **storage readout** (`server/storage.ts` + picker weight warnings),
**freshness & expiry warnings** (`lib/freshness.ts`), and a **per-view export
locale** (`export_locale`).

**July 2026 wave:** the **generic `mergeRegistry`** + an **Industry registry**
(third mergeable kind; `Project.industry_id`, shape v3 migration interns
existing/imported industry text), an **accessibility audit** (jest-axe
regression suite + fixed unlabelled controls), the **career-timeline** Overview
card (`lib/careerTimeline.ts`), and **global content search**
(`lib/contentSearch.ts` + `GlobalSearch` palette, Ctrl/Cmd+K).

**2026-07 showcase unification** folded the separate "Skills Showcase" editor
page and its `technology_categories[]`/`CategorySkill` structures into the
Skill registry's own category system: `SkillCategory` entities
(`ResumeStore.skill_categories`, shape v6) linked from `Skill.category_id`, a
`unifyShowcaseCategories` migration ("showcase wins" on conflict + carries
forward `is_highlighted`), the Showcase reborn as a virtual view section
deriving from highlighted+categorized skills (`lib/showcase.ts`), and
By-category header **rename + ↑/↓ reorder** (see
`plans/unify-showcase-into-categories.md`).

**Deferred / dropped:** **A4 Phase 2** (content-addressed asset table) was
deliberately deferred — measurement infra shipped; build the table only when
real data warrants. **F4/F8** (application log, cover letter) were dropped as
out of scope.

The **v0.3.1 UX/accessibility wave** (12 `ux/*` branches) shipped: programmatic
labels + per-locale `lang` everywhere (`bcp47()`), live regions for save
status/errors, keyboard paths (import drop zone, EditorCard toggle), shared
modal focus management (`ui/useDialog.ts`), WCAG-AA contrast tokens
(`--secondary-ink-text`, `--ok/warn/err-*`), global
focus-visible/forced-colors/reduced-motion handling, responsive DualField
stacking, **URL-carried sections** (`/r/:id/:section`), full combobox ARIA,
**self-hosted fonts**, skip link, and meta polish. The follow-up wave:
**export-first sidebar** (`GROUP_ORDER`), the **compact language-switcher
popover**, a **global settings cogwheel** (editor header), and the **Profile &
Competencies page** replacing the Personal Details sub-tabs
(`canonicalSectionKey()` keeps old deep links working).
