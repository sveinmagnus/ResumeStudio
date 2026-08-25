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
  name to open that CV). **Data source**: groups by normalized `skillKey` across
  each resume's own registry, fetched client-side — deliberately simple, and
  sized for a small team rather than an org. The panel also hosts **"Share registries across resumes"**
  (below).
- **Cross-resume shared registries** (the additive-link design) — skills/roles/industries/categories can be
  linked to an instance-level canonical registry so a **rename in one resume
  propagates to all**. Reached WITHOUT a destructive migration: an additive
  `canonical_id?` on each registry entry (the split: shared identity is the
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
  canonical on load. Backups are portable: a resume file embeds the canonical
  entries it references and `lib/registryReintern.ts` re-interns them on import,
  so one file can rebuild the registry it depends on in a fresh instance. A
  divergence surfaces as `RegistryConflictNotice`, and the desktop sync merges
  registries by key (`db.mergeRegistry`, driven by `backupWatcher`).
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
  Showcase" feature's own curated `technology_categories[]` groups (see the
  2026-07 showcase unification below). **`category_id` is a skill's SINGLE grouping
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
- **Reference consent tracking** — a reference is another person's contact
  data, so each carries a consent status (`not_asked / asked / confirmed /
  declined`, `Reference.consent_status` + `consent_confirmed_at`, stamped when
  confirmed; editor-only, never exported). The References editor shows the
  state inline; `freshnessReport` adds consent rows to Needs attention for
  **export-included** references only (private entries never leave the machine):
  declined-but-exported (loudest), never-confirmed, and confirmations older
  than 24 months ("confirm again?"). Same snooze/dismiss machinery as the rest.
- **Claim–evidence check** (`lib/claimEvidence.ts` + `EvidencePanels`) — the
  inverse of `lib/experience.ts`: offline, structural findings for claims the
  CV's own structure doesn't back. Four kinds: a proficiency ≥ 4 skill with no
  dated project usage (high) or thin usage (low), a showcased skill no project
  links, a role whose legacy years claim has no dated assignments, and a
  bundled competency whose title words appear in no project/employment prose.
  Hints, not verdicts — each row navigates to the item; dismissals snooze a
  year via `attention_dismissals` (`claim:<kind>:<id>`).
- **Repetition check** (`lib/redundancy.ts` + `EvidencePanels`) — near-duplicate
  prose across DIFFERENT items (the same achievement pasted into both the
  employment and its project): exact + Jaccard sentence matching (≥ 8 tokens)
  and whole-field trigram similarity, across every locale, one finding per item
  pair with both sides clickable. Same-item overlap is by design (a summary
  restates its long description) and never flagged.
- **Project debrief interview** (`lib/debrief.ts` + `DebriefModal`) — the
  maintenance ritual: when an engagement ends (Overview nudges for projects
  ended within 6 months, `debriefCandidates`; also a per-card button in the
  Projects editor), the app asks 3–6 pointed questions DERIVED from what the
  project lacks (no model needed to ask). Answers are reshaped — configured
  model or BYO copy-prompt/paste-JSON (`resumestudio-debrief/v1`) — into
  highlights, registry-interned skill links (`skillExtract` machinery: existing
  pre-ticked, new deliberate) and an optional short description; a drafted
  one-liner never overwrites an existing line without an explicit tick. Applies
  as ONE `replaceData` undo step and stamps `Project.debriefed_at`, which
  retires the nudge; "nothing new" stamps without changes.
- **Targeted exports via Resume Views** — pick sections, exclude items,
  starred-only filter, custom intro, then export PDF (one-click vector
  download via lazy-loaded pdfmake), DOCX (lazy-loaded docx lib),
  ATS-friendly **plain text / Markdown** (`lib/viewText.ts`), **Europass
  XML** (`lib/exporterEuropass.ts` — the `SkillsPassport` format public
  tenders ask for, round-trip partner of the Europass importer; covers
  identity/work/education/languages only, by the schema's design, and builds
  a DOM serialized by XMLSerializer so escaping is structural), **JSON
  Resume** (`lib/exporterJsonResume.ts` — the open jsonresume.org v1
  interchange object over the same `applyView` filter, anonymization rule
  regression-tested), or a **single-file HTML** (`lib/htmlExport.ts` — the
  `buildViewHtml` document made genuinely standalone: the six brand woff2
  fonts fetched and inlined as data: URIs, CSP rewritten for `file://`, images
  already data: URLs by construction; failed font fetches degrade to the
  fallback stacks rather than failing the export). A **live
  preview pane** in the view editor re-renders the document as you tune it
  (iframe + page-count estimate + optional pop-out window). All catalog-driven
  render paths share the
  **section-descriptor catalog** (`lib/sectionCatalog.ts`).
- **Read-through mode** (`views/ReadThroughMode.tsx` + `lib/readThrough.ts`) —
  a full-screen reading overlay ("Read through" in the view editor header):
  the view's content as ONE flowing document, rendered from the same section
  catalog the exports use (so it can't drift from what ships), with a **flag**
  gutter on every item and a rail of flagged items with notes. Flags persist
  in localStorage per (resume, view) — deliberately NOT store data, so they
  never sync/snapshot/undo — and survive leaving to fix one ("Open in editor"
  navigates and closes; the other flags wait). The view editor button shows
  the outstanding count.
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
- **Advanced assists (high-end model only)** — a second AI tier that appears
  only when the operator ticks "This is a high-end model" (`llm_high_end`).
  Gated in exactly two places: `AdvancedAssistCard` renders nothing on the
  client, and `POST /api/llm/complete` 403s an `advanced: true` request on the
  server (which also grants the bigger budget: 240 k prompt chars / 16 k output
  tokens / 180 s). Declared rather than detected — a small model answers a
  whole-CV review fluently and wrongly rather than failing, and no model name
  reliably reports capability. Shared vocabulary: `lib/cvFields.ts` (which
  fields are prose and therefore rewritable), `lib/cvDigest.ts` (the one way a
  CV is rendered into a prompt; the bilingual variant reads RAW locale slots so
  the fallback chain can't hide the gap it's looking for),
  `lib/assistFindings.ts` (advisory results — no replacement text, unknown refs
  dropped not fatal) and `lib/assistProposals.ts` (field rewrites — carries the
  original, refuses non-prose fields, re-checks at apply time so a field edited
  after the run is skipped rather than overwritten; one `replaceData` per batch).
  Twelve shipped. The seven about the CV itself: **whole-CV review**,
  **consistency & voice pass**, **cross-language
  meaning check** (drift.ts's long-noted missing third signal), **achievement
  mining** (every proposal must quote its supporting sentence or it's dropped),
  **profile + competency-bundle generator** (requires a written focus brief —
  Run stays disabled without one, because the CV can't say which career you want
  to be read as having next), **view introduction draft** (written against the
  view's FILTERED content) and **per-section "what's missing"**.
  Then three more for the application itself: the **job fit report**
  (`lib/jobFit.ts` — every requirement in a pasted posting scored
  evidenced/adjacent/missing with CV item citations; `adjacent` is the valuable
  one, and an `evidenced` row whose citation doesn't resolve is downgraded rather
  than believed), **letter angles + critique** (`lib/letterAdvice.ts` — three
  complete alternative letters with the trade-off spelled out, or a second read
  of the one you wrote, checked against the linked view's evidence), and
  **freeform intake** (`intakeInstructions` — the same `resumestudio-bulk/v1`
  contract read out of an email or meeting notes; the BYO copy-and-paste path is
  untouched, so quality-assured imports through an external model still work).
  Then the **ATS keyword audit** (`lib/atsAudit.ts` — pass 1 is a literal search
  over `buildViewText`'s real output and needs NO model; three-way status where
  `elsewhere` means "in your CV but this view excluded it", fixable without
  writing a word; a `missing` term never gets a suggestion and an unquoted
  `covered` is downgraded, so it can't become a keyword stuffer) and
  **registry hygiene** (`lib/registryHygiene.ts` — semantic merge + category
  proposals; proposal-only by construction, nothing pre-ticked, no "select all"
  for merges, each row states what it deletes and how many references it
  rewrites, a confirm names the totals, and a skill the user categorised is
  never re-categorised). See CLAUDE.md §15.
- **Bilingual glossary (C3)** (`src/lib/glossary.ts` + `server/glossary.ts`) —
  terminology consistency for the ORDINARY Draft translation, with no UI and no
  high-end gate. Harvested rather than inferred: registry names and short
  both-locale identity fields are already curated term pairs, and a name written
  identically in both columns is a do-not-translate instruction. Scoped per
  field so it stays a few lines and a small local model can honour it; derived
  per call, so nothing persists and no shape changes. Provider reach: `llm` via
  a prompt block, **DeepL** via a real glossary resource (cached by pair +
  content hash, best-effort), **Google v2** via `format=html` + `notranslate`
  spans (v2 has no glossary API — that's v3 Advanced), LibreTranslate unchanged.
  This is the prevention for what A3 detects.
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
  long sections, plus a **"By type"** popover of **tri-state facet chips** for
  sections whose items carry a classification — enum fields (Other roles →
  `position_type`, Publications → `publication_type`, Employment → type,
  Courses/Certifications → `category`) AND **registry role links** (a project's
  roles, an employment's `role_ids`): "include every board seat / every project
  where I was PM, drop the rest" in one click. A multi-valued item simply lands
  in every group its values name (the confirmed "toggle affects all items with
  that role" behaviour). Facets are data-driven (one `sectionFacets` entry).
  Operations are set-math over the view's flat `excluded_item_ids`, so they never
  touch another section's exclusions. **Key Competencies have no facet** — a view
  shows the selected profile's bundle (below), not a per-item pick.
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
- **Profiles & competency bundles** — the resume can hold several **Profiles**
  (`key_qualifications`: tag line + long/short summary). A view presents exactly
  ONE (`viewFilter.selectedViewProfile`); the presented profile's **tag line is
  the resume title** in that view (header/DOCX/PDF/Europass/text + Overview all
  resolve it, falling back to the legacy master title), with a per-view "Hide tag
  line" toggle (default on). Each profile **owns an ordered bundle** of
  competencies — `KeyQualification.competency_ids` (shape v12) — and a view
  renders **exactly that bundle, in bundle order** (strict scoping in
  `applyView`). Key Competencies themselves are a **shared library** (title +
  description + short); one competency can sit in several bundles (reuse).
  Membership is edited on the Profile card — add / **add-existing (checkbox
  multi-select** with All/None, for pulling a range in after a bulk add) /
  reorder (**drag handle** + up/down) / remove, sharing a `CompetencyFields`
  component. The Key Competencies library mirrors membership read-only and offers
  a **List / By profile** toggle: the by-profile view groups each profile's
  bundle under its tag line (a competency in several profiles shows once per
  profile) with a lightbox to edit — like the registries' "By category". This
  replaced the inert `KeyCompetency.profile_id` grouping + "By profile" facet
  that shipped in v11 (`migrateBundleMembership`).
- **Courses & Certifications** carry a shared **editor-only Category** vocabulary
  (`lib/courseCategories.ts`, English-only, never exported) that drives the
  per-section type Filter; Courses use a **from/to date range** (shape v11,
  `start`/`end`; a new course defaults `end` to today) and sort like the other
  ranged sections. **Presentations** gained the same from/to range (shape v13,
  `migratePresentationDates`) for talks given regularly over a period.
- **CVpartner JSON import** and **portable JSON backup** (export + load) with
  a versioned format and a migration scaffold. Loading either kind of file
  from the picker creates a new resume (the in-editor "load file" button is
  gone — backup load is picker-only). The picker also imports **LinkedIn data
  exports** (.zip of CSVs, lazy fflate; `lib/importerLinkedIn.ts`),
  **Europass CVs** (SkillsPassport XML + profile JSON;
  `lib/importerEuropass.ts`) and **JSON Resume** files
  (`lib/importerJsonResume.ts` — positive detector that can never claim our own
  or CVpartner files; a skills entry with keywords becomes a SkillCategory
  plus member skills; JSON Resume "references" are testimonial quotes, so they
  land as Recommendations, not our contactable References).
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
- **AI summarize assist** (`server/llm.ts` + `server/summarize.ts`, `server/ollamaDocker.ts`,
  `lib/llmClient.ts`, `lib/summarizeBatch.ts`) — drafts a one-line short
  description from a long one, mirroring the translate architecture: a
  pluggable server proxy (`LLM_PROVIDER` ∈ `off|ollama|openai|anthropic|gemini|mistral|compat`)
  with an app-driven **local Ollama in Docker** as the first-class option, keys
  server-side, availability memoized client-side. **No heuristic fallback** —
  unconfigured means the affordances don't exist. Two surfaces:
  - **Per column** — a Summarize button on `DualField`'s short-description
    input, shown when that column has source text. Same-locale: the model
    writes in the language it reads.
  - **Whole section** — "Bulk summarize (N)" (with a confirm dialog) in the section bar next to
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
  folder; an optional cloud-synced folder (Google Drive/Dropbox/OneDrive) holding
  **one JSON file per resume** (`<slug>__<id>.json`) plus `resume-studio-registry.json` syncs
  CVs across computers via a newest-wins-by-id merge — kept current in BOTH
  directions **continuously while the app runs** (`backupScheduler` writes out;
  `backupWatcher` = fs.watch + a folder-fingerprint poll backstop merges other
  machines' edits in), not only at launch. The open editor polls its resume's
  `version` and shows `RemoteUpdateNotice` when a background merge advances it.
  Build with `npm run build:desktop`. See CLAUDE.md §8/§14 and `DESKTOP.md`. The
  persistence architecture is unchanged, so a later move to Electron is
  repackaging, not a rewrite.
- **Per-person backup files + right to be forgotten** — the sync folder's unit is
  one identified person, so a single CV can be handed over or deleted as one
  file. Deleting a resume removes its file and writes an id-only tombstone
  (`resume-studio-deleted-resumes.json`) that other machines honour, so an erasure can't be
  undone by the next machine to sync; a copy edited *after* the deletion is
  treated as a revival and kept. **Export all resumes (.zip)** in Settings
  bundles the same files into one archive, and importing that zip (or any single
  resume file) **merges by resume id** instead of duplicating — the bug that made
  setting up a second computer clone the whole list. `server/backupFiles.ts`,
  `server/backupZip.ts`, `POST /api/backup/import`.
- **Automatic updates (desktop build)** — the system-tray "Check for updates"
  item (plus an in-app picker banner + Settings → Updates) checks GitHub
  Releases daily / on demand, toggles to "Install update (vX.Y.Z)" when a newer
  release exists, and on click downloads the per-platform `.tar.gz` and swaps
  the build in place via a detached per-OS script, then relaunches. Desktop-only
  + `isUpdateSupported()`-gated (the VPS build reports `supported:false`). No
  Electron, no code signing. See CLAUDE.md §14 and `DESKTOP.md` §6.

## What's intentionally simple

- The **router** is a hand-rolled ~220-line History API hook
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
the showcase-unification plan, now in git history).

**v0.8.x–v0.9.0 wave:** **cross-resume shared registries** (Stage-3 additive
`canonical_id` links so a rename in one resume propagates to all; portable in
backups + carried in the desktop sync — `server/registryDb.ts`,
`lib/registrySync.ts`). The **Profiles rework** — a view renders exactly one
profile, its **tag line is the resume title** (the Personal Details "Title" was
removed), a new per-view "Hide tag line" toggle, and a newly-added profile is
excluded from existing views so it can't surface as a surprise second block.
**Courses & Certifications categories** + Course **from/to date ranges** (shape
v11), a display-only per-section **type Filter** beside Sort, a **"Side venture"**
Other-roles type (position type is now editor-only), a **global per-view sort**
(`ViewStyle.sort`, overridden per section), and **renamable Role categories**.
**Cover letters** shipped as their own view-referencing entity (shape v10; see
the Cover letters bullet above). **Profile bundles** (v0.9.0): a profile owns an
ordered competency bundle (`competency_ids`, shape v12) and a view shows exactly
that bundle — `migrateBundleMembership`. **v0.9.1+ follow-ups:** competency-bundle
**drag reorder** + **checkbox multi-select** add-existing, a **By profile** view
in the Key Competencies library, **Presentations from/to range** (shape v13),
category-vocabulary revisions, a fix so a hidden section heading keeps its **top
margin**, a fix so the editor **type Filter can't trap** the user on one item,
and **"Bulk summarize"** (renamed from "Summarize all empty", now confirm-gated).

**v0.9.2–v0.9.4 wave:** **continuous desktop sync** — the
whole-store sync folder is now merged IN while the app runs, not only at launch
(`server/backupWatcher.ts` = fs.watch on the folder + an mtime-poll backstop;
feedback-guarded against `backupScheduler`'s own writes), with a
`RemoteUpdateNotice` in the open editor driven by a `version` poll
(`useResumePersistence`). **Whole-store backup restore from the picker** — the
import dispatcher now defaults unrecognised input to Resume Studio's own content
(whole-store + per-resume + bare `ResumeStore`), with a POSITIVE CVpartner
detector, so a self-export never restores blank (`importResumeStudio`,
`isCVPartnerFormat`). A view **purpose note** (`ResumeView.purpose`) records why
a view exists — read-only with an edit pencil, never exported. An AI **writing
coach** (`lib/writingCoach.ts` + `WritingCoachPanel`) strengthens an existing
description's prose without inventing facts. **Europass XML export**
(`lib/exporterEuropass.ts`, `SkillsPassport` — DOM + `XMLSerializer`, the
round-trip partner of the Europass importer). **Drift** false-positive fixes
(numeral-vs-word, one-sided incidental numbers, short structured fields) + a
per-finding **permanent ignore**. Overview panel/heading layout polish; the
short summary moved below the full profile. **Competency profile-membership
editing** (v0.9.4) — a "Belongs to profiles" line on every competency card with
an edit pencil (multi-select popover to toggle profiles), plus **drag a
competency chip between profile groups** in the By-profile view; both write the
single source of truth (each profile's `competency_ids`), with the reassignment
branching factored into pure, unit-tested `lib/competencyBundles.ts` (a chip id
carries source group + competency so a drop detaches only the dragged instance;
dropping onto a profile that already holds it is a no-op; other profiles keep
their shared memberships). **CI / supply-chain hardening** (v0.9.4) — every
GitHub Action SHA-pinned with Dependabot keeping the pins fresh, a
least-privilege `GITHUB_TOKEN`, workflow concurrency + per-job timeouts;
canonical registry create + cross-machine merge hardened (`body-parser` bumped).
**Repo hygiene** — regenerable build output swept from the working tree; the
committed tree carries only app code + build/release config (no personal data).

**v0.10.x wave — the advanced (high-end) assist tier.** A second AI tier that
appears only when the operator declares the configured model high-end
(`llm_high_end`), gated in exactly two places (`AdvancedAssistCard` on the
client, `POST /api/llm/complete` with `advanced: true` on the server). Twelve
assists shipped: **A1** whole-CV review, **A2** consistency & voice,
**A3** cross-language MEANING (`semanticDrift.ts` — drift.ts's missing third
signal), **A4** achievement mining (bilingual, via `achievementTranslate.ts`),
**D1** profile + bundle generator, **D2** view-introduction draft, **D3**
per-section "what's missing", **B1** job-fit report, **B5** letter angles &
critique, **C1** freeform intake (an upgrade to bulk add, not a new surface),
**B4** ATS keyword audit (**pass 1 needs no model at all**), and **C4** registry
hygiene (proposal-only by construction). Plus **C3**, the invisible bilingual
glossary (`lib/glossary.ts` + `server/glossary.ts`) — NOT gated, and the thing
that makes the small-model translate path behave. Their shared vocabulary is
`cvFields` / `cvDigest` / `assistFindings` / `assistProposals`; build new
advisors on those rather than forking them. See CLAUDE.md §15.

**Advisor runs outlive the page** (`store/useAdvisors.ts` + `store/useAdvisorRun.ts`):
a run costs real tokens and every result invites you to navigate away, so runs
live in their own store — raw reply kept (re-validated on render), per-suggestion
resolution, localStorage-persisted with a 7-day expiry, and an app-level
`AdvisorToast`. Runs can be **scoped** (`AdvisorRef.scope`) so one advisor can
target several things — a view's intro, a section's gaps — without collision,
and carry the user's own `input` where the result is only readable beside it (the
ATS audit's posting). All ten result panels read through `useAdvisorRun`.

**Also in v0.10.x:** rich text has **one kind of line break** (`blockify`
canonicalises `<br>`, raw newlines and blank lines to paragraph boundaries; the
gap is ONE number, `PARA_GAP_LINES`, pinned across editor/HTML/DOCX/PDF by
`tests/paragraphSpacing.test.ts`), **Back returns you where you were** (each
history entry carries a scroll + expanded-card snapshot, stamped continuously),
writing assist on every section, a **three-way merge on save conflict**
(`lib/threeWayMerge.ts` — non-overlapping concurrent edits merge silently
instead of raising a whole-document keep/discard), and **real `<a href>` sidebar
navigation** (Ctrl-click / "Open in new tab" work on every section and view).

**Per-person backup files (August 2026).** The sync folder went from one
`resume-studio-backup.json` holding everybody to **one file per resume**
(`server/backupFiles.ts`: `<slug>__<resume-id>.json` + `resume-studio-registry.json` +
`resume-studio-deleted-resumes.json`), because a resume is one identified person's data and
GDPR erasure has to be actionable at that granularity on disk, not only in the
DB. Identity is the id INSIDE the file, so a rename moves the file rather than
adding a second one and two machines converge on one resume. Deleting a resume
now removes its file and writes an **id-only tombstone** that other machines
honour — with the "an edit after the delete is a revival" rule so a stale
deletion can't destroy newer work. Each resume file also embeds the canonical
registry entries it references in full, so one file alone can rebuild them
elsewhere. **Manual backup is now a zip** of exactly those files
(`server/backupZip.ts`, Settings → Backup & export), and — the bug this fixes —
**every inbound path merges by resume id** (`POST /api/backup/import`), where
dropping the sync file on the picker used to run each resume through
`createResume`, mint a new id, and duplicate the whole list back onto the first
machine. The legacy combined file is still read, then retired once superseded.

**Multi-user (August 2026).** The server authenticated a SECRET; it now
authenticates a person and scopes what they see. The plan that carried the
design is deleted (it shipped); the invariants are CLAUDE.md §16.

- **Identity** — `server/accounts.ts` (users, sessions, grants, recovery codes),
  `server/passwords.ts` (scrypt from `node:crypto`, no dependency and no native
  addon). Login takes a username OR an email. Sessions never expire on a timer;
  they end on logout, a password change, or disable. The cookie carries an
  opaque id and the table stores its SHA-256.
- **Authorization** — `server/access.ts` is the ONE place the rule lives, and
  every `ResumeDb` method takes a required `Viewer` so an unscoped call site is
  a type error. Private by default; sharing grants READ only; the owner sees
  everything. A row that exists but is not visible answers as not-found, never
  403, so a member cannot probe which ids exist.
- **Four ways back in, one redemption** — an owner-issued link, a recovery code,
  `npm run recover` on the machine, and an optional reset email all mint a grant
  and end at one route.
- **Email** (`server/mail.ts`) is optional and off by default: sendmail via
  argv-only `execFile`, or a hand-rolled SMTP client over `node:net`/`node:tls`.
  No CV content is ever sent. Addresses are rejected, never sanitised.
- **CSRF** (`server/csrf.ts`) double-submit, because `SameSite` and
  `Sec-Fetch-Site` are both signals the browser volunteers.
- **The desktop build never asks anyone to log in**, and gained an identity
  anyway (Settings: username, display name, email) so a resume moving to a
  shared instance arrives with an author rather than anonymous. That `author`
  is descriptive and never authorising — ownership is corrected deliberately via
  `POST /api/resumes/:id/owner`.
- **Hosted/desktop divergences closed**: `.env` is actually loaded (real env
  wins), a damaged database explains itself on both, a hosted owner can
  configure mail and ask whether a release exists, and the sync panel reports
  whether continuous sync is running rather than implying it.

**Offline load, short of a PWA (August 2026).** `listCached()` so the picker
shows local copies instead of an empty screen, plus a shell-only service worker
with no `cache.put` at all — an `/api` response cannot be stored even in
principle. The lazy export chunks stay out by construction rather than by a
deny-list.

**Export parity (1.0.1, August 2026) — the one that changes how you reason
about the render paths.** The four targets used to disagree with each other in
both directions, and both halves are now enforced by a suite:

- **Content.** `lib/sectionCatalog.ts` carried a different set of FIELDS per
  target — the Word and PDF files printed a project's team size, allocation and
  highlights while the HTML preview printed none of them, and the ATS text
  shipped less than either. Eight more fields were editable and reached no
  export at all. The rule is now: **content is identical in the preview, the
  PDF, the Word file and the ATS text, and anything optional is chosen per VIEW,
  not per target** — `lib/sectionExtras.ts` declares the switchable groups per
  section, `SectionStyle.extras` stores which are on, and **every group defaults
  OFF** (including the ones DOCX/PDF used to ship unconditionally, so an
  existing view renders less until it opts in — the point being that an export's
  contents become a decision rather than an accident).
  `tests/exportParity.test.ts` renders one view through all five outputs and
  asserts each fact reaches every one.
- **Appearance.** Seven style controls moved the preview and nothing else (skill
  tags, item dividers, summary layout, full-item layout, aligned summary
  columns, section icons, and Word's line height), and two of the four
  full-item layouts rendered identically in the PDF and Word. So the description
  of a visual effect now lives in ONE module — `lib/itemLayout.ts` (slot order),
  `viewStyle.dividerSpec`, `viewStyle.tagChipHex`, `lib/sectionIcon.ts` — and
  the adapters render it, rather than each holding an opinion.
  `tests/exportVisualParity.test.ts` flips each control and asserts the EXACT
  set of targets whose output moved, so a purely visual choice leaking into the
  ATS text fails as loudly as a missing one.

**Also in 1.0.x:** a **map lookup keyed on DATA goes through `lib/lookup.ts`**
(`MAP[key] ?? fallback` was the idiom in 21 places, and an inherited
`toString`/`constructor` key is neither null nor undefined — both failure
shapes were live: a function body interpolated into an exported date, and a
crafted view crashing the exporter). A **local name for the desktop build**
(`resumestudio.localhost`, no setup; `resumestudio.local` behind one elevated
hosts-file write — `server/localHost.ts`) and **port 80 before 1923**. **Intel
macOS release assets**, without which the updater failed closed on every Intel
Mac. A **completeness gate on the architecture map** (`npm run check:arch`) —
CLAUDE.md §3 calls itself one line per file, and it was short by 48 of ~100 lib
modules, so the claim became a CI check rather than a promise.

The 1.0.0 cycle before it was a quality milestone rather than a feature
release: AA contrast fixed on all three paper surfaces (the jsdom axe suite
could not see it — no layout engine), unlabelled view-editor controls named,
and the legal/policy texts written (LICENSE, PRIVACY, SECURITY,
THIRD-PARTY-LICENSES, RELEASING).

**Toolchain (July 2026):** **Vite 5 → 8** (Rolldown — the production build went
from ~16 s to under a second, and the dev-server advisories that had no fix
within Vite 5 are gone; `npm audit` is clean). **ESLint** added as a CI gate
(`npm run lint`) — deliberately not a style guide: every custom rule encodes an
invariant from CLAUDE.md, including the lucide-namespace-import ban, the
lazy-exporter rule, no `process.env` in client code, no `transition: all`, and
`lib/exportStrings` being unreachable from `src/components/**`. The `uuid`
package was dropped for `crypto.randomUUID` (`lib/uuid.ts`).

**Quality gates (July 2026, 1.0 prep).** The pipeline is now: **lint →
typecheck → test → build → bundle budget**, plus parallel **coverage
thresholds**, **e2e on three engines** (chromium/firefox/webkit), **CodeQL**
(`security-extended`, free on a public repo), **gitleaks**, and advisory
depcheck. ESLint grew from five project-invariant rules to also enforce the §3
layering (`import-x/no-restricted-paths` + `no-cycle`), five selected type-aware
rules, `jsx-a11y`, and the vitest/testing-library correctness rules — see
CLAUDE.md §2 for what is deliberately OFF and why. Coverage is a **ratchet** set
just below current (global 78 % statements / 81 % lines, `src/lib` 86 % / 89 %),
and the bundle budget asserts the initial payload (340 kB gzip) plus that
pdfmake, the DOCX `exporter`, and each pdfmake font family (Roboto / Times /
Helvetica / Courier — 0.3 ships one module per family, so any one of them
folding into the entry is a bigger regression than the whole library was) stay
in their own chunks. **Stryker** mutation testing
(`npm run test:mutation`, `src/lib` only) is a pre-release audit rather than a
gate — it answers the question coverage cannot: not "did this line run" but
"would any test have noticed if it were wrong".

**Deferred and dropped work is not catalogued here** — `plans/open-items.md`
is its single home, with the trigger condition for each deferral and the closed
decisions that must not be re-proposed. This file records only what exists.

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
