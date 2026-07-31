# Open items

**This file holds only what is NOT built.** Everything else that used to live in
`plans/` — the multi-resume plan, offline editing, the showcase unification,
cross-resume registries, the improvement roadmap, the code-quality cleanup, the
advanced-assist proposal menu — described work that has since shipped, and was
removed once it was done. What those features ARE is documented in
`.claude/feature-map.md`; the invariants that govern them are in `CLAUDE.md`.
The design deliberation that produced them is in git history, which is where a
finished plan belongs.

Three kinds of thing are recorded here, and the third matters most:

1. **Unbuilt features** someone might want next — with enough design notes to
   start, and an honest cost.
2. **Deferred infrastructure**, each with the condition that should trigger it.
   None of them has fired.
3. **Decisions that are closed.** Re-proposing these is the recurring cost this
   file exists to stop.

---

## 1. Unbuilt features

Effort: **S** ≈ a session, **M** ≈ a day, **L** ≈ multi-day / touches the data model.

These come from the advanced-assist menu; twelve of its eighteen candidates
shipped (CLAUDE.md §15). Each builds on the shared vocabulary in `lib/cvFields.ts`,
`lib/cvDigest.ts`, `lib/assistFindings.ts` and `lib/assistProposals.ts` — build on
those rather than forking them, and read §15 before starting any of them.

### B3. Interview defensibility brief — **the best value-per-hour left**
For a view + a posting: the questions each claim invites, and what you would
need to be able to back up. A read-only artifact, exportable as text.
It serves the app's existing anti-invention stance directly — it is the "can you
defend this?" pass — and needs no data-model change.
**Effort: S–M.**

### F1. Staffing fit across resumes
Given a posting, rank everyone in the instance and say why. Bid support, built on
`lib/whoKnowsWhat.ts` and the instance registry. Nothing else in the app reasons
across resumes, and it is the feature that makes the multi-resume model earn its
keep for a consultancy.
**Effort: M–L** — needs a whole-instance prompt bundle and a new panel beside
`WhoKnowsWhatPanel`.

### C2. Native multi-language authoring
Today: write one language, translate, review. Instead, one call writes the field
in every `supported_locale` natively, with the CV's existing translated pairs
supplied as a glossary (C3, `lib/glossary.ts`, already built) so terminology stays
stable across the document. Turns the dual-view pattern from "write then
translate" into "write once, get both" — which is the app's stated core promise.
**Effort: M.**

### F2. Registry harmonisation across resumes
Team-wide consistent skill naming over the instance-level registry. Mostly the
same machinery as C4 (registry hygiene) at a wider scope — and inherits C4's
safety model, which is not optional: proposal-only, nothing pre-ticked, every row
states what it deletes and how many references it rewrites.
**Effort: M.**

### B2. Posting-aligned rewrites, scoped to a view — ⚠️ needs a data-model decision
Propose rewritten short descriptions for the items a tailored view includes,
aligned to the posting's vocabulary, **without touching the master CV**.
Per-view text overrides do not exist: `ResumeView` selects and excludes, it never
rewrites. That is a shape bump plus new render-boundary handling in `applyView`.
Real value, real cost.
**Effort: L.**

### E1. Fit-to-N-pages by tightening rather than cutting — ⚠️ reverses a decision
`lib/pageFit.ts` proposes whole items to drop and explicitly "never rewrites prose
to fit". A high-end model could propose tightened wording instead. Worth doing
only if you actively want it, and it should be a separate opt-in mode beside the
cut-items one, not a replacement.
**Effort: M.**

### An alternative worth naming once
Instead of the single `llm_high_end` checkbox, a **second configured endpoint**:
a small local model for summarize/translate, a big hosted one for the reasoning
passes. More config surface, but it lets a local Ollama keep the routine work
private while a frontier model does the heavy passes. The checkbox is the cheap
version of this and can be upgraded to it without breaking the setting.

---

## 2. Deferred infrastructure

Each of these has a trigger. Until it fires, building it is speculative.

### Image asset table (was "A4 Phase 2")
`profile_photo`, `company_logo` and the per-view overrides live as data URLs
inside the resume JSON, so every auto-save PUT re-sends them and the localStorage
pending record carries them against a ~5 MB cap.

The measurement half shipped: `server/storage.ts` → `payloadStats`,
`db.storageStats()`, `GET /api/resumes/storage`, per-card weight warnings at
1 MB / 2.5 MB, and a DB-size footer on the picker. Snapshots are already stored
image-free (`stripSnapshotImages`).

**Trigger:** the picker actually warns on real data. **Then** build the
content-addressed `assets` table (`hash → bytes` + `asset_id`), which touches
persistence, both render paths, backup, the offline cache and every importer —
the most invasive change available in this codebase, which is exactly why it
waits for evidence.

### PWA offline-load
Offline *editing* shipped (durable queue, reconnect drain, conflict safety, and
now three-way merge). Loading the app cold with no network still fails: no
service worker caches the shell. A PWA layer would need SW caching for
index.html/JS/CSS/fonts, an update prompt for version skew, and an offline
fallback for the lazy exporter chunks.
**Trigger:** "open and edit with zero connectivity" becomes a real need. The
desktop build already covers the practical case. Multi-day.

### Electron repackaging
The portable desktop build (bundled Node, tray, auto-updater, browser opener)
covers the practical case. The per-user data dir was deliberately chosen to match
Electron's `app.getPath('userData')`, so this is repackaging, not a rewrite.
**Trigger:** tray / updater / browser-opening friction on some OS outweighs the
packaging cost.

### Cross-tab coordination (BroadcastChannel)
Two tabs editing one resume share a localStorage pending slot. This is *safe* —
the server `version` check refuses the second flush, and since the three-way
merge landed, non-overlapping edits reconcile silently instead of prompting. A
`BroadcastChannel` lock would stop the local thrash, not a correctness bug.
**Trigger:** the thrash becomes visible in practice. Low priority.

---

## 3. Closed — do not re-propose

### UI-chrome localization — **decided, English-only**
The editor UI is English-only, permanently, until the owner says otherwise. Do
not propose a `t()` layer, do not add one incrementally, and do not treat an
English literal in a component as a defect. This was deferred three times before
being settled in July 2026; the deliberation itself was the recurring cost.

**Export chrome is a different thing and is already done**: everything a client
reads — section headings, months and "Present", header field labels, skill-matrix
columns, CEFR words, publication/position/relationship picks — is localized for
all 15 offered locales. The boundary is load-bearing: a string is localized if it
lands in an exported `.pdf`/`.docx`/`.txt`, and stays a hardcoded English literal
if it only ever shows in the editor. ESLint enforces it — `lib/exportStrings.ts`
cannot be imported from `src/components/**`.

### Application / tender log per view — **dropped, out of scope**
An application log (recipient, status, pipeline rollup) pulls the product toward
bid-management software. Resume Studio is a *resume* tool: one master CV
extracted into targeted views. Don't re-propose pipeline/CRM features.

### Cover letters — **dropped, then un-dropped and shipped**
Recorded because the reasoning flipped: letters were cut as "a different document
class with its own lifecycle", then built anyway as their own view-referencing
entity (`CoverLettersEditor`, `lib/coverLetter.ts`, shape v10). Nothing to do —
listed so the old "don't build this" note doesn't resurface.

### Automatic field-level merge — **was out of scope, now built**
The offline-editing plan explicitly excluded it: "a three-way merge over the
registries / embedded arrays / sort_order is its own project and risks silent
corruption." That call was right at the time and wrong by the end: the whole-
document conflict modal became the most-complained-about surface in the app.
`lib/threeWayMerge.ts` does it, and the corruption risk is answered by only
auto-applying when the merge finds *zero* contested values.

---

## 4. Guidance that outlived its plan

Salvaged from the code-quality review so it isn't rediscovered the hard way.

**Things that are deliberately NOT defects** — don't "clean these up":

- **Inline `<style>` blocks per component** (~50 components). A documented
  architecture choice (CLAUDE.md §6), not duplication. Only *duplicated class
  definitions across components* violate it.
- **The per-section editors in `SimpleEditors.tsx` looking alike.** Each is a
  declarative field list with genuinely different fields — repetitive by nature,
  readable as-is.
- **`translateClient.LOCALE_TO_SERVICE` duplicating `server/translate.ts`.**
  Deliberate, commented, and guarded by `tests/localeCoverage.test.ts`; the two
  build trees are kept uncoupled on purpose.
- **The hand-rolled router, no-Tailwind styling, and the lazy export chunks.**
  All documented invariants.

**Two lessons worth keeping:**

- *A static-analysis "unused" list is a question, not an answer.* The review's
  dead-code finding was wrong in both directions at once: the scripts it called
  unused are load-bearing codegen (`gen:icons`, `gen:taxonomy` — now npm
  scripts), and the exports it called unused are all live, several named in
  CLAUDE.md as public API. Verify before deleting.
- *Line count was the wrong yardstick.* That cleanup predicted −1100 lines and
  landed roughly net-neutral, because the shared modules carry the doc comments
  explaining what drifted before them. The measures that mattered were
  drift surfaces collapsed: the settings key list enumerated 7 times → 1, eleven
  copies of an error-handling block → 0, six hand-rolled blob downloads → 0.
