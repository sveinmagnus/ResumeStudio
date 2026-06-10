# Improvement Roadmap — full-solution review (June 2026, v0.2.2)

A whole-codebase + documentation review against the product target: a
**no-dependencies, stand-alone, locally runnable resume manager for
individuals or a small team**, centred on one master CV extracted into
targeted Resume Views.

Baseline verified at review time: `npm run typecheck` clean (client +
server), `npm test` 930 passed / 1 skipped across 73 files, zero
TODO/FIXME/HACK markers in source. The codebase is in genuinely good shape —
this roadmap is about drift, hotspots, and the next ring of value, not
firefighting.

---

## Part A — Quality & consistency tasks

Ordered by value-for-effort. Items A1–A3 are cheap and overdue; A4–A6 are
real engineering chunks; A7+ are watchlist.

### A1. Fix README drift (small, do first)
`README.md` describes a much older build. Concretely stale:
- "Express + better-sqlite3 (single-row resume_store table)" in the
  architecture diagram and "the single resume row" under Configuration —
  the schema has been multi-resume for a long time.
- "349 tests, all green" — actual count is 930.
- "'Load file' restores from a backup *or* imports a CVpartner export" —
  the in-editor load affordance was removed; loading is picker-only and
  creates a new resume.
- The Configuration table lists only `RESUME_API_TOKEN` / `PORT` /
  `LIBRETRANSLATE_URL` / `LIBRETRANSLATE_API_KEY`. Missing:
  `TRANSLATE_PROVIDER` + per-provider keys (DeepL/Google/Azure),
  `RESUME_RATE_LIMIT_MAX` / `RESUME_RATE_LIMIT_WINDOW_MS`,
  `RESUME_DATA_DIR` / `RESUME_BACKUP_DIR` / `RESUME_DB_PATH`, and the
  update-related vars (`RESUME_NO_UPDATE`, `RESUME_UPDATE_REPO`).
- The feature list omits multi-resume, offline editing + conflict safety,
  AI-assisted import, per-view styling/header/footer, and the desktop
  Settings screen — all shipped and user-visible.

While in there: CLAUDE.md §3 says "~660 tests at last count" — refresh to
~930, or better, drop hardcoded counts from both files (they rot on every
feature) and say "see CI".

The `docs/` GitHub Pages site (index/features/how-to/download) was found
current — keep it as the model and make README defer to it for the feature
tour instead of duplicating it.

### A2. Decide the fate of `template_id` (tiny decision, unblocks 12.1)
`ResumeView.template_id` exists in `types/index.ts` and is set to `null` in
one place; nothing reads it. Either commit to **Export templates** (Part B,
F1 — recommended) or remove the field. A reserved-but-dead field on the
most-exported type is a standing trap for contributors.

### A3. Split `ResumeViewsEditor.tsx` (1,382 lines)
The largest file in the repo by a wide margin, holding ~10 components
(ViewList, ViewEditor, DetailToggle, ViewStyleControls, Select,
ViewHeaderControls, HeaderTextStyleControl, ViewFooterControls,
SectionStylePanel, Styles). Mechanical refactor, no behavior change:

```
components/editor/views/
├── ResumeViewsEditor.tsx   (route component + ViewList)
├── ViewEditor.tsx          (sections/items/preview/export orchestration)
├── ViewStyleControls.tsx
├── ViewHeaderControls.tsx  (+ HeaderTextStyleControl)
├── ViewFooterControls.tsx
└── SectionStylePanel.tsx   (+ DetailToggle, Select)
```

Existing RTL tests should pass unchanged — that's the acceptance gate.
`RegistryEditors.tsx` (848) and `SimpleEditors.tsx` (569) are the next
candidates but each is several related editors by design; only split if
they grow further.

### A4. Embedded base64 images: payload + snapshot weight — 🔶 Phase 1 done (June 2026)

*Status: snapshots are now stored image-free (strip in `server/db.ts`,
restore re-attach in `src/lib/snapshotImages.ts`), eliminating the ×50
duplication. Still open: the auto-save PUT payload weight, the localStorage
quota exposure, and the Phase 2 asset table if measurement warrants it.*
`profile_photo`, `company_logo`, and per-view `photo_override` /
`logo_override` live as data URLs **inside the resume JSON**. Consequences:

1. Every debounced auto-save PUT re-sends the images (~100–300 kB each
   after downscale) on every mutation burst.
2. `resume_snapshots` stores the **full JSON per snapshot** — up to 50 ×
   (resume + all images) per resume. Dedupe only compares against the
   *latest* snapshot, so alternating edits multiply image copies.
3. The localStorage pending record carries the same blob — browsers cap
   localStorage around 5 MB per origin; a few photo-bearing resumes with
   dirty records could hit quota and silently break the offline queue.

Plan (phased):
- **Measure first**: add a size readout (db page count / row sizes) and an
  alert threshold; confirm real-world numbers.
- **Phase 1 (cheap)**: strip image fields from snapshot rows (restore
  re-attaches the current images) — snapshots are about *content* history.
- **Phase 2 (proper)**: a content-addressed `assets` table
  (`hash → bytes`), with the store holding `asset_id` references. Touches
  exporter/viewFilter (resolve refs at render), backup format (embed on
  export for portability), and the localCache. Do only if Phase 1 +
  measurement shows it's warranted.

### A5. Section catalog refactor — now justified (was §12.3 "maybe")
The "don't bother for rare sections" caveat has expired: `viewFilter.ts`
now carries **47 `case` labels** across `renderItem` / `getItemTitle` /
`getItemSubtitle` (vs. 17 in `exporter.renderSection`), and sections keep
arriving (key competencies, recommendations, promoted projects). A
section-descriptor registry — one entry per section declaring
`{ titleField, subtitleField, dateField, renderFull, renderSummary }` with
HTML and DOCX render adapters — collapses three parallel switches, shrinks
the "Adding a new section" checklist in CLAUDE.md from 9 steps to ~4, and
removes the standing risk that the HTML and DOCX paths drift (today only
discipline + the export-pipeline skill keeps them in sync). Keep the
security property explicit: descriptors return *data*, the two adapters own
escaping (`escapeHtml` / `renderRichHtml`), so the escape boundary stays in
one reviewed place per pipeline.

### A6. End-to-end smoke layer
930 unit/component/route tests, but nothing exercises the integrated app:
real server + built client + browser. One thin Playwright suite (3–5
flows): boot → create resume → edit a field in two locales → reload
(persistence) → build a view → assert preview HTML → export DOCX downloads.
Run it in CI after build. This is the only class of regression (wiring,
routing, CSP, lazy-chunk loading) the current pyramid can't catch — the
preview-tool port quirk in CLAUDE.md §11 is exactly the kind of thing it
would have flagged.

### A7. Data-shape versioning for the live store (small, preventive)
`backup.ts` has a versioned envelope + `migrateBackup()`, but the **DB
rows** have no shape version — new required-ish fields (`view.style`,
`header`, `footer`) rely on consumers tolerating `undefined` via
`with*Defaults`. That works but scatters migration logic into render
boundaries forever. Add a `shape_version` to the stored JSON and a single
`migrateStore()` applied in `loadResume`/`loadStore`, mirroring the backup
scaffold. Old tolerant defaults stay as defense-in-depth.

### A8. Watchlist (deliberately deferred — keep saying no until forced)
- **Generic `mergeRegistry`** (§12.2): still only two registry kinds.
- **Cross-tab BroadcastChannel lock** (§12.5): conflict path already makes
  it safe.
- **UI-chrome localization**: app labels are English-only. For a tool whose
  *content* is multi-locale and whose market is Norwegian, a tiny
  dictionary-based `t()` for chrome strings is a plausible ask — but it
  taxes every component forever. Decide once, record the decision in
  CLAUDE.md either way.
- **Accessibility audit**: dnd-kit keyboard sensors and up/down buttons are
  good bones; do a focused pass on modal focus traps, `aria-label`s on the
  icon-only buttons (copy/draft/star/merge), and contrast of the cyan
  secondary tint. Half a day, schedule alongside any template work.

---

## Part B — New functionality

Ordered by recommended priority. The filter applied throughout: must work
fully offline/local, must not add a runtime service or mandatory API key,
and must deepen the core loop (master CV → curated views → polished export)
rather than widen into a different product.

### F1. Export templates (promote §12.1 — do first)
Two or three named templates — *compact technical*, *formal management*,
*minimal one-pager* — as styling deltas over the existing
`ViewStyle`/`ViewHeaderConfig` machinery, selected via the already-reserved
`template_id`. The live preview pane makes template choice instantly
tunable; this is the single biggest visible-value item and it's mostly
plumbing that already exists. Implementation note: a template is a *preset
that seeds* style/header/footer (user can still tweak after), not a fork of
the render logic — keeps `buildViewHtml`/`exporter` untouched except for a
preset table.

### F2. BYO-LLM view tailoring ("paste the job posting")
The AI-import flow proved the pattern: a deliberately simple exchange
schema, the user's own LLM, no keys, no service. Apply it to the *other*
end of the pipeline:

1. User pastes a job posting / tender text into a "Tailor view" dialog.
2. App generates a prompt bundling the posting + a compact catalog of the
   master CV (section keys, item titles, skills, starred flags) + a
   `resumestudio-tailor/v1` response schema.
3. User runs it in any LLM, pastes the JSON back.
4. App validates (same field-pathed-errors discipline as
   `validateAIImport`) and shows a **preview diff**: proposed section
   detail levels, item exclusions, a drafted localized intro, and a gap
   list ("posting asks for X, CV has no evidence") — apply creates or
   updates a view.

This converts the app's core promise (curated views per audience) from
manual to assisted while staying 100% dependency-free. Reuses
`aiImport.ts` validation patterns, the view normalizers, and the preview
pane. Medium effort; highest strategic fit of anything on this list.

### F3. Overview dashboard: freshness & expiry warnings (cheap win)
`Certification.expires` is already in the model. Surface on Overview:
- certifications expiring within N months / already expired,
- "ongoing" projects/employments with no edits in over a year,
- resumes not updated in N months (picker badge).
Pure `lib/` computation + dashboard cards, in the spirit of
`completeness.ts`. Small effort, recurring real value for a consultant.

### F4. Application / tender log per view
A view already has `last_exported_at`. Extend to an export+application log:
when exporting, optionally record *recipient, date, role/tender name,
status (sent / interview / won / lost), notes*. A small top-level
`applications` collection linked to `view_id`, a log panel in the view
editor, and a picker/Overview rollup ("3 open applications"). For a small
team this doubles as lightweight pipeline tracking without becoming a CRM.
Keep it deliberately flat — no statuses workflow engine.

### F5. Per-view anonymization toggle
`Project.use_anonymized` + `customer_anonymized` exist per project, but
anonymity is an *audience* property, not a master-data property — exactly
what views are for. Add `ResumeView.force_anonymized: boolean`: when set,
every project renders its anonymized customer (and references render
name-redacted). Small change in `viewFilter.applyView` + both render paths
+ a checkbox; big deal for agency/broker submissions where client names
must not leak.

### F6. ATS-friendly exports: plain text & Markdown
A third and fourth export format that are nearly free given
`applyView()` already produces the filtered store: walk the same section
order and emit clean UTF-8 text / Markdown (no tables, no columns — the
shapes ATS parsers and online application forms want). Also useful as the
paste-into-LinkedIn/email format. Lives beside `buildViewHtml` as a pure
`buildViewText`; trivially testable.

### F7. More importers: LinkedIn + Europass
CVpartner import works; the next most common "I already have my CV in…"
sources are the **LinkedIn data export** (ZIP of CSVs — positions,
educations, certifications, skills map cleanly onto the model) and
**Europass** (XML/JSON, common in EU tenders). Each is a pure
`lib/importerX.ts` + picker wiring, following the table-test discipline of
`importer.test.ts`. The AI-import path already covers arbitrary PDFs, so
these are about *fidelity* (structured data, no LLM round-trip) for the
two most structured sources.

### F8. Cover-letter companion document
A localized rich-text letter attached to a view, sharing the view's
header/footer/branding config, exporting through the same PDF/DOCX
pipeline (one more "section" with its own page). Consultants almost always
send letter + CV as a pair styled identically; today the letter is the one
document still maintained outside the tool. Bonus: F2's tailoring schema
can draft it from the job posting.

### F9. Skill matrix export (consultancy bid format)
Nordic tenders routinely demand a competency matrix: skill × years ×
proficiency × last-used. All the data exists (`Skill`,
`ProjectSkill.duration_in_years`, project dates). Add a synthetic view
section "Skill matrix" (like Promoted Projects) rendering a table in both
HTML and DOCX paths, with per-view filters (highlighted-only, skill type).
Medium-small; very high value for the target user.

### F10. Small-team affordances (named users, not RBAC)
Today "small team" = one shared bearer token. The honest next step is
modest: support **multiple named tokens** (`RESUME_API_TOKEN` →
`RESUME_API_TOKENS=name:token,name:token` or a tokens table on desktop
settings), stamp `saved_by` on saves/snapshots, and show it in History and
on picker cards ("edited by Kari, 2 h ago"). No permissions model, no user
admin UI — just attribution, which is what a 2–5 person consultancy
actually needs first. Defer real auth until someone asks for per-resume
access control.

### F11. Per-view default export locale
The export-locale dropdown currently defaults to `supported_locales[0]`
per session. A Board CV is *always* Norwegian; a partner CV is *always*
English. Persist the chosen locale on the view (`export_locale: string |
null`). Tiny, removes a recurring footgun (exporting the right view in the
wrong language).

### F12. Skill-taxonomy integration (Quadim Public Skill Library)
A local, Apache-2.0-licensed taxonomy of **1,227 curated skill definitions**
exists at `C:\Users\svein\Documents\Development\Public-SkillDefinitions`
(canonical JSONs in `quadim-public-skilldefinitions/`, lean pre-built index
in `docs/data/skills-index.json`, relationship graph in
`docs/data/graph-edges.json`). Each entry has a UUID, name, ~440-char
description, classification (Technical / Management / Analytical / …),
skill-type, and `relatesTo`/`isCompositeOf`/`isExtensionOf` links.
Integration points, in rough order of value:
1. **Autocomplete enrichment** — when adding a skill in `Autocomplete.tsx`,
   suggest canonical library names alongside existing registry entries;
   prevents the "Løsningarkitekt vs Løsningsarkitekt" duplicates *before*
   merge has to fix them.
2. **Import normalization** — match free-text skills from CVpartner / AI /
   future LinkedIn imports against library names.
3. **Related-skill suggestions** — "you list Scrum; consider Agile Software
   Development" via the relatesTo graph.
4. **Skill-matrix wording** (pairs with F9) — authoritative descriptions and
   classifications for tender competency matrices.
Implementation rule: stay dependency-free — derive a slimmed static JSON
from `skills-index.json` at build time and lazy-load it like the DOCX
exporter; never fetch the live site at runtime. Note: library descriptions
are English-only, so suggested names enter the registry as `en` values with
the normal translation workflow applying.

### F13. Deferred / conditional
- **PWA offline-load** (§12.4): only if "cold start with zero network"
  becomes real — the desktop build already covers the practical case.
- **Electron repackaging**: the per-user data dir was chosen to make this
  cheap; pull the trigger only when tray/updater/browser-opening friction
  on some OS outweighs the packaging cost.
- **Career timeline / gap visualization** on Overview: nice, not core.
- **Global content search**: becomes worth it when resumes are large
  enough that the sidebar stops being enough; revisit after F2–F9.

---

## Suggested sequencing

| Wave | Items | Theme |
|---|---|---|
| 1 (days) | A1, A2, F3, F11 | Doc truth + two cheap user-visible wins |
| 2 (1–2 wks) | F1, A3 | Templates (the flagship gap) + the refactor that makes view code workable |
| 3 (1–2 wks) | A5, F5, F6, F9 | Section-descriptor registry, then the three export features it makes cheap |
| 4 (2+ wks) | F2, F8 | BYO-LLM tailoring + cover letter (the "assisted curation" arc) |
| 5 (as needed) | A4, A6, A7, F4, F7, F10 | Storage hygiene, e2e net, attribution, importers |

Rationale for the ordering: Wave 3's export features (anonymization, text
export, skill matrix) each touch the same three switches A5 collapses — do
the refactor first and each feature drops from "edit 3 files in sync" to
"add one descriptor + one renderer".
