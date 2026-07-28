# Code-quality cleanup — findings & sequenced plan

Status: **review output, nothing applied.** Full-codebase read of `src/` +
`server/` (46 412 lines). Baseline at time of review: `npm test` green —
143 files, 2339 passed / 1 skipped.

Scope of this review: **code bloat, duplication, messy decision trees, over-nested
and parallel conditionals.** Not a bug hunt, not a security review (that's
`.claude/skills/security-review.md`), not an architecture change.

---

## 0. What is deliberately NOT a finding

Calling these out first so they don't get "cleaned up" by mistake:

- **Inline `<style>` blocks per component** (50 components, ~1075 CSS rule
  lines). This is a documented architecture choice (CLAUDE.md §6), not bloat.
  Only *duplicated* class definitions violate it — see F3.
- **The per-section editors in `SimpleEditors.tsx` looking alike.** Each is a
  declarative field list with genuinely different fields. Repetitive by nature,
  readable as-is. One narrow exception in F13.
- **`translateClient.LOCALE_TO_SERVICE` duplicating `server/translate.ts`.**
  Deliberate and commented ("kept duplicated to avoid coupling the two build
  trees"), and `tests/localeCoverage.test.ts` guards it.
- **Short per-provider locale maps in `server/translate.ts`.** The lower-case /
  upper-case fallbacks are documented as correct for every pass-through locale.
  Verified, not stale.
- **The hand-rolled router, no-Tailwind styling, lazy export chunks.** All
  documented invariants.

---

## 1. Findings

Ranked by *drift risk first*, line count second. "Already bitten" means the
duplication has demonstrably produced a defect.

### Tier 1 — duplication that has already caused defects

**F1 · The settings field list is enumerated 7 times.** ★ already bitten
The ~21 settings keys are written out separately in:
`AppSettings` interface, `DEFAULT_SETTINGS`, `coerce()`, `applyToEnv()`,
`settingsFromEnv()`+`summarizeFromEnv()`, `SettingsView`+`toView()`
(all `server/settings.ts`), the PUT validation in `server/routes/settings.ts`,
and `SettingsView`/`SettingsUpdate` in `src/lib/api.ts`.
Adding one provider means editing all of them — which is exactly what the last
provider commit had to do.
The bug is documented in the code itself, `server/routes/settings.ts:52`:
> *"Validate against the canonical list — an inline copy here is how the 'llm'
> provider shipped rejectable (the UI offered it, this 400'd it)."*

*Fix:* one `SETTING_FIELDS` descriptor table
(`{ key, kind: 'string'|'secret'|'bool'|'num'|'enum'|'locales', env, default, validate? }`).
`coerce`/`applyToEnv`/`settingsFromEnv`/`toView` and the route validator all
become table walks. The interface stays hand-written (it's the type source of
truth) but can be derived-checked.
*Removes:* ~180 lines. *Risk:* medium — behaviour-preserving but wide. Covered
by `tests/server/settings.test.ts` + the supertest route suite.

**F2 · The view "section plan" is copy-pasted across all 4 render paths.**
This identical ~30-line block appears in `viewFilter.ts:601` (HTML),
`exporter.ts:366` (DOCX), `pdfExporter.ts:410` (PDF), `viewText.ts:126`
(ATS text/MD), plus a 5th partial copy in `ViewEditor.tsx:565`:

```ts
SECTIONS.filter(isExportableSection).map((s) => { const vs = view.sections.find(…)
  return { ...s, sort_order: vs?.sort_order ?? 999, detail: vs?.detail ?? defaultViewDetail(s.key),
           sectionStyle: vs?.style, sort: vs?.sort ?? view.style?.sort ?? 'custom' } })
  .filter((s) => s.detail !== 'off').sort((a, b) => a.sort_order - b.sort_order)
```

…immediately followed by the same 3-way item-source dispatch
(`promoted_projects` → `promotedProjectItems`, `technology_categories` →
`showcaseGroups`, else `filtered[storeKey]`), the same `renderKeyFor` mapping,
and the same `sortItems` call. Across the codebase there are **28 inline
`key === 'promoted_projects' | 'skill_matrix' | 'technology_categories'` checks
in 8 files.**

This directly contradicts the stated invariant ("one descriptor feeds ALL
render adapters", CLAUDE.md §7.7): the *content* is unified, the *section plan*
is not. Adding a synthetic section today means editing four files identically.

*Fix:* `lib/viewSectionPlan.ts` — `planViewSections(view)` +
`sectionItems(store, view, filtered, planned, locale)` + the existing private
`renderKeyFor`. All four adapters call it.
*Removes:* ~120 lines and a 4-way drift surface. *Risk:* medium-high blast
radius, but pure functions with strong existing coverage
(`tests/viewFilter.test.ts`, exporter/pdf/viewText suites).

**F3 · The same CSS classes are defined in two components — and have drifted.**
★ already bitten
`.skill-chip-w` / `.skill-chip` / `.skill-chip-x` / `.skill-chip-list` /
`.sub-block` / `.sub-head` are defined in **both**
`ProjectsEditor.tsx:584-602` and `RegistryEditors.tsx:1754-1761`.
They no longer match: `.sub-block` is `margin: 16px 0` in one and `16px 0 0` in
the other, so the block's margin depends on which component mounted last.
This is precisely the failure CLAUDE.md §6 documents for `.pf-*`
("a component-scoped style block only exists in the DOM while that component is
mounted… this regressed the registry `CategoryField` once already").

*Fix:* move the shared widget classes to `src/index.css`, delete both copies,
pick one margin deliberately.
*Removes:* ~20 lines, one mount-order bug. *Risk:* very low. **Best first task.**

### Tier 2 — mechanical duplication, low risk, high line savings

**F4 · `api.ts` repeats the same error-extraction block 11 times.**
```ts
let message = `X failed (${res.status})`
try { const json = await res.json() as { error?: string }; if (json.error) message = json.error }
catch { /* keep default */ }
throw new ServerError(res.status, message)
```
Plus ~10 copies of the "never throws → fallback value" try/catch wrapper.
*Fix:* `async function fail(res, fallback): Promise<never>` and a
`safe(fn, fallback)` wrapper. *Removes:* ~90 lines. *Risk:* low.

**F5 · The translation-assist state machine is implemented twice.**
`DualField.tsx:93-264` and `RichField.tsx:43-131` both own
`busyLocale`/`draftedLocale`/`error` state, `copyBetween`, `draftBetween`,
`renderAssist`, `renderNotes` — differing only in CSS prefix (`df-` vs `rf-`).
Already drifted: DualField has Summarize and shows Copy per-button; RichField
has neither and hides the whole assist row when the source is empty.
*Fix:* `useTranslationAssist({ value, set, textOf })` hook + a shared
`<AssistButtons>`; keep the prefix as a prop.
*Removes:* ~90 lines, one drift surface. *Risk:* low-medium (UI); both have
component tests.

**F6 · Import coercion helpers are duplicated between `aiImport` and `bulkImport`.**
`isPlainObject`, `str`, `strOrNull`, `norm`, `toYearMonth`, `checkDate` exist in
both. `checkDate` is byte-identical apart from the issue type name (whose shape
`{path, reason}` is also identical). `viewTailor.ts` has a third `isPlainObject`.
**They have already diverged:** `bulkImport.toYearMonth` clamps month to 1–12;
`aiImport.toYearMonth` only checks `Number.isInteger`. Latent today (validation
runs first) but exactly the drift duplication invites.
*Fix:* `lib/coerce.ts` with a shared `Issue = {path, reason}`. Adopt the
**stricter** (bulkImport) month clamp and add a regression test for it.
*Removes:* ~80 lines. *Risk:* low. *Note:* this is a deliberate small behaviour
change in the aiImport edge case — call it out in the commit.

**F7 · Blob-download is written 4 times.**
`exporter.ts:709` (`downloadBlob`), `ViewEditor.tsx:525` (`downloadText`),
`backup.ts:544`, `CoverLettersEditor.tsx:124`, `BulkImportModal.tsx:76`.
*Fix:* `lib/download.ts → downloadBlob(blob, filename)`. *Removes:* ~35 lines.
*Risk:* very low.

### Tier 3 — messy decision trees & god components

**F8 · `migrateStore` is an 11-deep nested call pyramid.** (`migrate.ts:119-139`)
Reading the migration order means counting parentheses inward-out; adding one
adds a nesting level.
*Fix:*
```ts
const MIGRATIONS = [foldRoleDescriptions, extractKeyPointsToCompetencies, …]
return { ...MIGRATIONS.reduce((s, m) => m(s), store), shape_version: CURRENT_SHAPE_VERSION }
```
20 lines → 3, order reads top-to-bottom. *Risk:* very low — every migration is
already a pure idempotent shape-sniffer, and order is preserved verbatim.
**Second-best first task** (30 minutes, visible payoff, zero blast radius.)

**F9 · The three registry editors triplicate their whole scaffolding.**
(`RegistryEditors.tsx`, 1781 lines — the largest file in the repo.)
`SkillsEditor` / `RolesEditor` / `IndustriesEditor` each repeat, near-verbatim:
the `usage` map memo, the `counts` memo, the `items` filter memo,
`useStableExpanded`, the `missingItems` memo, `useFrozenMissing`, and the
`onMerge` confirm-then-merge wrapper — 5 blocks × 3.
`SkillUsagePanel` and `IndustryUsagePanel` are the same component with a
different empty-state sentence; `RoleUsagePanel` is that plus two more groups.
The project-label expression
`resolve(p.customer) || resolve(p.description) || 'Untitled project'` + `fmtRange`
appears verbatim 3 times. The List/By-category toggle is duplicated verbatim.
`RolesEditor`'s render is a 3-branch ternary chain
(`view==='list' && filter==='missing-translation' ? … : view==='list' ? … : …`)
that renders `<FilterBar>` in two separate branches.
*Fix:* `useRegistryFilter(section, items, countRefs)` returning
`{ counts, items, displayItems, batchRows }`; a generic `<UsagePanel groups={…}>`;
a `<RegistryViewToggle>`; flatten the ternary chain to early-returned
sub-renders.
*Removes:* ~250 lines. *Risk:* medium (biggest single component change) —
but every editor has a component test.

**F10 · `ProjectsEditor` triplicates its registry-link UI.**
`ProjectIndustryChip` / `ProjectRoleChip` / `ProjectSkillChip` are the same
component with different nouns (their own doc-comments say "mirroring
ProjectRoleChip" / "mirroring ProjectSkillChip"), and their three parent
sub-editors repeat the same `linkExisting` / `createAndLink` / `remove` +
`<Autocomplete>` shape.
*Fix:* one `<RegistryLinkEditor kind="industry"|"role"|"skill">`.
*Removes:* ~200 lines. *Risk:* medium.

**F11 · `ViewEditor.tsx` is a 1126-line god component.**
It owns: preview lifecycle (debounced rebuild, iframe measure, scroll
preservation, pop-out window + close-poll ≈ 120 lines), page counting (estimate
+ lazy exact), five export handlers, section list config, item selection, name/
purpose inline editing, and styling — plus the F2 section-plan copy.
*Fix:* extract `useViewPreview(...)` and `useViewExport(...)` hooks; the
component keeps the JSX.
*Removes:* nothing net, but ~300 lines move out of the render path and the
preview machinery becomes independently testable. *Risk:* medium.
**Depends on F2** (its `totalItems`/`storeItems` blocks should consume the new
plan module, not a 6th copy).

### Tier 4 — small / dead

**F12 · ~~Dead code.~~ WITHDRAWN — there is no meaningful dead code.**
*Retracted during step 3, after re-verification. The original claim was wrong.*

The nine symbols listed here (`countRegistryReferences`, `cefrCategoryLabel`,
`DEFAULT_FULL_LAYOUT`, `defaultDateline`, `tailorableSectionKeys`,
`safeProfileImageShape`, `defaultFieldLabels`, `SNOOZE_MONTHS`,
`startConnectivity`) are all **used inside their own module**. My check
(`grep -rl <name> | wc -l` → 1) counted *files*, and a function used only
within its own file naturally matches one file. That is evidence of a
redundant `export` keyword, not of dead code — I read it as the latter.

Re-examined properly, even the redundant-`export` framing doesn't hold up:

- `countRegistryReferences` is **named in CLAUDE.md §4** as the documented
  generic behind the three `count*References` wrappers. Public on purpose.
- `DEFAULT_FULL_LAYOUT` is the documented twin of `DEFAULT_SUMMARY_LAYOUT`,
  which *is* imported by `ViewStyleControls`. De-exporting one of a symmetric
  documented pair is worse than leaving both.
- `SNOOZE_MONTHS` sits in the same exported policy-constant group as
  `DEFAULT_FRESHNESS` (used by `tests/freshness.test.ts`).
- `promoteFromResumes` in `server/db.ts` is one of **six** symmetric singleton
  wrappers over `RegistryStore`. Only it is currently uncalled; deleting one
  member would break a deliberate facade for no gain.

*Action taken: none.* Stripping these would be churn that fights the codebase's
own documentation. The absence of dead code in 46k lines is a positive finding
and is recorded as such.

**Lesson for the rest of this series:** a static-analysis "unused" list is a
question, not an answer. Both F12 items it produced were wrong in opposite
directions — the scripts it called unused are load-bearing (F12b), and the
exports it called unused are all live.

**F12b · Two codegen scripts are undiscoverable — keep them, don't delete them.**
`scripts/gen-section-icons.mjs` and `scripts/build-skill-taxonomy.mjs` are
flagged as "unused files" by static analysis because nothing *imports* them —
but they are the generators for committed artifacts (`gen-section-icons.mjs`
reads `src/lib/sections.ts` and writes `src/generated/sectionIcons.ts`, which
`viewFilter.ts` depends on). Verified: neither is wired into `package.json`
scripts or CI, so the only way to know how to regenerate those artifacts is to
find the file.
*Fix:* add `"gen:icons"` / `"gen:taxonomy"` npm scripts and a one-line header
comment in each. **Do not delete.** *Risk:* none.

**F13 · Small repetition, optional.**
- `<DualField label="Short description (summary mode)" … placeholder="One concise line shown in summary mode" />`
  appears verbatim 9× in `SimpleEditors.tsx` → `<ShortDescriptionField section item from />`.
- `useStore`'s 6 resume-patching actions repeat
  `data: { ...st.data, resume: { ...st.data.resume, … } }` → a `patchResume` helper.
- `useResumePersistence` repeats the "adopt a server copy" 5-line block 4×
  (`applyBoot`, `reloadFromServer`, `resolveConflict`, `submitToken`) →
  `adoptServerCopy(res)`.
- `CategoryField` (RegistryEditors) re-implements a combobox that
  `ui/Autocomplete.tsx` already provides. Worth *investigating*, not assuming —
  CategoryField's "New category" affordance and blur-commit may not fit.

---

## 2. Sequenced plan

Each step is one commit, `npm run typecheck && npm test && npm run build` between.

| # | Step | Findings | Size | Risk |
|---|------|----------|------|------|
| 1 | Shared CSS classes → `index.css` | F3 | XS | very low |
| 2 | `migrateStore` pyramid → `MIGRATIONS` array | F8 | XS | very low |
| 3 | ~~Delete dead exports~~ (withdrawn); wire codegen scripts into npm | ~~F12~~, F12b | XS | very low |
| 4 | `lib/download.ts` | F7 | S | very low |
| 5 | `api.ts` error/safe helpers | F4 | S | low |
| 6 | `lib/coerce.ts` for the importers | F6 | S | low |
| 7 | **`lib/viewSectionPlan.ts`** — all 4 render paths | F2 | L | medium-high |
| 8 | **`SETTING_FIELDS` table** | F1 | L | medium |
| 9 | `useTranslationAssist` (DualField + RichField) | F5 | M | low-med |
| 10 | `useRegistryFilter` + `<UsagePanel>` + flatten ternaries | F9 | L | medium |
| 11 | `<RegistryLinkEditor>` in ProjectsEditor | F10 | M | medium |
| 12 | `useViewPreview` / `useViewExport` | F11 | M | medium |
| 13 | Optional small repetition | F13 | S | low |

Net: roughly **−1100 lines**, and four multi-file drift surfaces collapsed to one
definition each.

### Outcome (all 13 applied)

Every step landed as its own commit, each verified with typecheck + the full
suite + a production build, and the user-visible ones checked in the browser
against a real 4-view / 48-project resume. Final suite: **144 files, 2359
tests** (up from 143 / 2339 — the difference is new regression tests).

The **−1100 line** estimate was wrong, and worth recording as such. Actual:

| | insertions | deletions |
|---|---|---|
| src/ + server/ | 1727 | 1510 |
| tests/ | 204 | 1 |
| docs (CLAUDE.md, plans, package.json) | 342 | 1 |

Call-site code did shrink roughly as predicted — RegistryEditors −253,
ViewEditor −176, the four render adapters −171, the two importers −110,
api.ts −42 — but the eight new shared modules carry ~990 lines, most of it
the doc comments explaining *why* each abstraction exists and what drifted
before it. That is the trade this codebase's conventions ask for, and it is
the right one, but it means **line count was the wrong yardstick** and the
plan should not have quoted one so prominently.

The measures that actually mattered:

| | before | after |
|---|---|---|
| synthetic-key `if` checks across the codebase | 28 in 8 files | 22, and **1 per render adapter** |
| `api.ts` error-handling boilerplate blocks | 11 | 0 |
| hand-rolled blob-download copies | 6 | 0 |
| places the settings key list is enumerated | 7 | 1 |
| largest file | 1781 | 1528 |

Two findings were **withdrawn** rather than implemented (F12, and the
sub-editor half of F10) — see their entries. One pre-existing problem was
found and is unresolved: see §4.

**Rationale for the order.** Steps 1–6 are near-zero-risk and independent — they
buy confidence and immediate line reduction before anything structural. Steps 7
and 8 are the two findings with real defect history and real drift cost; they go
next, while attention is fresh, and each gets its own commit. Steps 9–12 are
component surgery: highest line savings, but UI regressions are the ones tests
catch least well, so they come last and one at a time.

---

## 3. Consistency check

Re-reading the plan against itself:

1. **Ordering dependency, respected.** F11 (ViewEditor) contains a 5th partial
   copy of the F2 section plan. Step 12 must come after step 7 or it will
   preserve the duplicate. ✅ ordered correctly — flagged inline in F11.
2. **F3 vs F10 don't conflict.** Moving `.skill-chip*` to `index.css` (step 1)
   and later collapsing the three chip components (step 11) are independent:
   step 11 deletes *components*, not CSS. Step 1 makes step 11 slightly easier
   (one place to check the classes still apply). ✅
3. **F5 vs F9 don't overlap.** `RegistryEditors` consumes `DualField` as a
   black box; changing DualField's internals doesn't touch it. ✅
4. **F6 carries a behaviour change, not just a move.** Unifying `toYearMonth`
   must pick one month-validation rule. The plan says adopt the stricter one and
   add a test — that is a deliberate change and must not be described as a pure
   refactor in the commit message. ✅ flagged.
5. **F12 initially carried a wrong assumption; resolved.** Static analysis
   listed the two `scripts/*.mjs` as "unused files", but a codegen script is
   invoked from a CLI, not imported — absence of imports proves nothing. On
   inspection they generate committed artifacts that shipping code depends on.
   Split out as F12b: *keep and document*, the opposite of the original read.
   ✅ corrected — do not let tool output drive deletions.
6. **Claimed line savings are estimates**, derived from measured duplicate-block
   sizes × occurrence counts. Treat −1100 as an order of magnitude, not a target.
   Nothing in the plan should be judged by lines removed.
7. **The plan never contradicts a documented invariant.** Cross-checked each
   step against CLAUDE.md §§6, 7, 8, 11, 14: no step touches DualField's
   dual-view contract (F5 is internal), the `loadStore`/`replaceData` split, the
   lazy `exporter`/`pdfExporter` imports (F7's `download.ts` is tiny and
   statically safe), or the registry design. F2 *restores* the §7.7 invariant
   rather than bending it. ✅
8. **Coverage assumption verified, not assumed.** The 2339-test baseline was run
   before writing this, and every module named above has a corresponding suite
   (`tests/lib`, `tests/components`, `tests/server`). The plan leans on that;
   without it, steps 7–12 would need to be reordered behind new tests first.

**One thing the plan deliberately does not do:** it does not touch the inline-
`<style>` architecture, the section-editor repetition, or the hand-rolled
router. Those are documented choices, and "consistency" here means consistency
with the project's decisions, not with a generic style guide.

---

## 4. Unresolved: the test suite is flaky under default parallelism

Found while verifying step 4, unrelated to any of these changes.

`npm test` fails intermittently on this machine — **different tests each run**.
Observed across the series: `ResumeViewsEditor` pop-out (×3 runs), `Autocomplete`
debounce (×1), and clean runs on identical code. Every failure is a timeout, and
every one of them passes in isolation.

Cause is resource contention, not a bad test. Vitest defaults to one worker per
core; on this 12-core machine a 143-file run reports ~370 s of environment setup
against ~100 s wall clock, and the jsdom component tests miss their budget.
`vite.config.ts` already raises `testTimeout` to 15 s with a comment
acknowledging exactly this class of problem — the ceiling is simply still too
low under full load.

**Confirmed fix:** `npx vitest run --maxWorkers=4` is green, repeatedly
(129 s vs 97 s — ~30 % slower wall clock, deterministic). Every verification run
in this series used it.

**Not applied**, because it is a project-infrastructure decision with a real
cost and it belongs to the owner: CI runners are typically 2–4 cores and may not
need it at all. Options, cheapest first:

1. `poolOptions.threads.maxThreads: 4` in `vite.config.ts` — deterministic
   locally, mildly slower; CI unaffected if it already has few cores.
2. Raise RTL's `asyncUtilTimeout` in `tests/setup-rtl.ts` (it does **not**
   inherit `testTimeout`; it is still at its 1 s default). Tried in isolation
   during this work and it did **not** fix the failures on its own — the
   failures are whole-test timeouts, not query timeouts — so this is a
   correctness tidy-up, not the fix.
3. Leave as-is and re-run on red. Cheapest, but it trains everyone to ignore a
   red suite, which is how a real regression gets waved through.

One related fix WAS applied, because it removes real work rather than changing
policy: the two test files that mount the view editor now stub `lib/pdfExporter`,
which was pulling ~2 MB of pdfmake into 34 component tests and laying out a real
PDF in each. See the step-4 commit.
