# High-end LLM assists — proposal menu

Status: **proposal, nothing decided.** Pick from §3; §2 is the prerequisite that
every pick depends on.

---

## 1. Where we are today

Every AI affordance in the app already rides ONE path:

```
src/lib/<feature>.ts   buildXPrompt() → validateXResponse() → applyX()
components/ui/AssistRun.tsx        the single Run button + provenance line
POST /api/llm/complete             server/routes/llm.ts
server/summarize.ts → chatComplete()   one endpoint resolution, 7 providers
```

Shipped assists: summarize (field + bulk), LLM translation, writing coach,
project highlights, skill extraction, anonymisation leak check, page fitting,
view tailoring, AI import, per-section bulk add, cover-letter body.

**What they have in common:** each one is a *narrow, single-item, low-context*
task, deliberately scoped so a 3B local Ollama can do it without embarrassing
itself. Prompts are built to survive a weak model — reshaping not writing,
"use only facts in the text", JSON schemas with tolerant validators.

**The gap:** nothing in the app uses judgement across the *whole* CV. Nothing
compares two items, weighs one section against another, or reasons about
positioning. That's exactly the class of work a frontier model does well and a
3B model does badly — and it's the class of work that actually saves the owner
an evening.

---

## 2. The gate (prerequisite for everything in §3)

### 2.1 Setting

New setting `summarize_high_end: boolean` ("This is a high-end model") in
`server/settings.ts`, alongside the existing summarize block:

- `AppSettings.summarize_high_end` + `DEFAULT_SETTINGS` (false) + `coerce()`
  (`=== true`, like `summarize_docker`)
- `applyToEnv()` → `SUMMARIZE_HIGH_END=1`/unset
- `SettingsView.summarize_high_end` (plain boolean — not a secret)
- `settingsFromEnv()` so a VPS can set it too

### 2.2 Surfacing

- `server/summarize.ts`: `SummarizeConfig.highEnd`, `resolveConfig()` reads the
  env, `summarizeInfo()` returns `high_end: boolean`.
- `src/lib/api.ts`: `AssistStatus.highEnd` (default **false**, fail closed —
  same discipline as `local`).
- `src/lib/llmAssist.ts`: `supportsAdvanced(status) => status.configured &&
  status.highEnd`, plus `inputBudget()` returns `LARGE_MODEL_BUDGET` when the
  flag is set (today it guesses from a parsed param count, which never matches a
  hosted model name like `claude-opus-4-6`).

### 2.3 UI

`src/components/settings/AiAssistTab.tsx` — a `.check-row` under the model
field:

> ☑ **This is a high-end model** — unlocks the advanced assists (whole-CV
> review, structured intake, positioning). Turn off for small local models;
> they produce confident nonsense on these tasks.

Auto-suggestion (tick it *for* the user, never lock it): a `looksHighEnd(model)`
helper matching the known frontier names in `lib/cloudModelCatalog.ts` and
Ollama tags ≥ ~30B via the existing `paramsOf()`. The checkbox stays
authoritative — a `compat` endpoint pointed at an unknown proxy can't be
detected, and the owner knows what they configured.

### 2.4 Visibility rule — **decision needed**

| Option | Behaviour when the flag is off |
|---|---|
| **A (recommended)** | Advanced features are **hidden entirely** — same as how the whole AI surface hides when nothing is configured. No dead buttons, no explaining. |
| **B** | Shown, Run disabled, BYO copy-prompt/paste path still offered (`AssistRun` `children`) so a user with no key can paste into ChatGPT. |
| **C** | Hybrid: hidden in-editor (panels have no manual path today), but modal-based ones keep the manual path. |

A matches the request as written. C is the honest one if you want the BYO story
to stay first-class for the big features too — a whole-CV review prompt is
perfectly pasteable.

### 2.5 Limits to raise

- `MAX_PROMPT_CHARS` is 60 000 in `server/routes/llm.ts`. A whole-CV review
  bundle on a dense master CV will brush that. Needs a higher cap for
  high-end runs (or a documented truncation point).
- `MAX_OUTPUT_TOKENS` is 4096. A multi-item rewrite proposal blows through it.
  Raise for flagged runs.
- Timeout is 45 s (`TIMEOUT_MS`). Whole-CV reasoning on a frontier model can
  exceed that; needs a longer cap on the advanced path.

### 2.6 Invariants that must not bend

- **Drafts never save.** Everything below produces a review surface; the user
  ticks and applies. No assist writes to the store directly.
- **Apply through `replaceData`**, one undo step per batch (§7 CLAUDE.md).
- **`providerBlurb` provenance line on every new control** — these prompts carry
  more of the CV than anything shipped so far, so `wholeCv` consent applies.
- **No new facts.** The writing-coach split (rewrite = source facts only; asks =
  questions back to the user) is the house rule and every writing feature below
  inherits it.

**Alternative worth naming once:** instead of a checkbox, a *second* configured
endpoint ("small model for summarize/translate, big model for reasoning"). More
config surface, but it lets a local Ollama keep the routine work private while a
hosted model does the heavy passes. The checkbox is the cheap version of this
and can be upgraded later without breaking the setting.

---

## 3. Feature menu

Effort: **S** ≈ a session, **M** ≈ a day, **L** ≈ multi-day / touches the data model.

### A. Whole-CV quality

**A1. CV Review — the flagship.** One pass over the master CV producing a
prioritised, actionable findings list: descriptions with no outcome, wildly
uneven detail (a 6-line project next to a 4-word one), duplicated phrasing
across items, timeline gaps, items whose prose implies skills the registry
never got, sections a reader expects and doesn't find. Each finding links
straight to the item (`setActiveSection` + `setExpandedItem` already exist).
Read-only; a checklist you work through.
*Why high-end only:* it's a relative-judgement task over the whole document.
**Effort: M** (one lib + one panel; no data model change).

**A2. Consistency & voice pass.** Enforce one register across the CV: same
person (first vs third), same tense, consistent capitalisation of tech names,
consistent phrasing of role/period. Returns per-item proposed rewrites, shown
as a batch diff with tick-to-apply. Pairs with the existing `lib/drift.ts`.
**Effort: M–L** (the batch-diff review UI is the real work).

**A3. Semantic cross-language check.** `lib/drift.ts` today has two structural
heuristics (numbers, length) and the feature map already names a semantic pass
as "the natural third signal". Does the Norwegian actually say what the English
says? Flags dropped sentences, mistranslated terms, terminology that drifted
between items.
*Why high-end only:* small models can't reliably compare meaning across
languages — that's the exact failure that made `LANG_NAMES` carry native names.
**Effort: M**, and it slots into an existing feature rather than adding a
surface.

**A4. Achievement mining.** CV-wide triage for outcomes buried inside long
prose, proposed for promotion to project highlights or Key Competencies.
`lib/keyPoints.ts` does this per item; this is the sweep.
**Effort: S–M** (reuses the keyPoints validator shape).

### B. Applications & targeting — highest day-to-day value

**B1. Job fit report.** Beyond tailoring (which only *selects* items):
requirement-by-requirement, what in the CV evidences it, what's missing, and
what's adjacent-but-unstated ("they want Kubernetes; project X mentions Docker
and Helm — worth naming explicitly?"). Output is a gap table plus a short
verdict, not a view.
**Effort: M.** Highest value-per-hour on this list for a consultant bidding.

**B2. Posting-aligned rewrites, scoped to a view.** Propose rewritten short
descriptions for the items a tailored view includes, aligned to the posting's
vocabulary — *without touching the master CV*.
⚠️ Needs a data-model decision: per-view text overrides don't exist today
(`ResumeView` selects and excludes; it never rewrites). That's a shape bump and
new render-boundary handling in `applyView`. Real value, real cost.
**Effort: L.**

**B3. Interview defensibility brief.** For a view + posting: the questions each
claim invites, and what you need to be able to back up. Read-only artifact,
exportable as text. Directly serves the app's existing anti-invention stance —
it's the "can you defend this?" pass.
**Effort: S–M.**

**B4. ATS keyword audit.** Run the existing ATS text export
(`lib/viewText.ts`) against a posting: which of the posting's terms appear,
which don't, and where a truthful mention would fit. No rewriting, just
coverage.
**Effort: S** (the text export already exists).

**B5. Cover-letter critique + variants.** The draft exists; add "give me three
angles" and "critique this draft I wrote" against the linked view's evidence.
**Effort: S.**

### C. Faster content entry — "quicker editing"

**C1. Freeform intake ("tell me about this project").** Paste or dictate a
messy paragraph — an email, a statement of work, meeting notes — and get a
fully structured item back: customer, dates, roles, skills (interned against
the registry), description, highlights, **in every supported locale at once**.
Review card, tick to add.
*Why high-end only:* it's simultaneous extraction + structuring + registry
resolution + multilingual writing. A 3B model does maybe one of those.
*Delta over `lib/bulkImport.ts`:* that expects the user to have already
produced spec-shaped JSON from clean source material; this takes prose and does
one item well, in-place in the section you're standing in.
**Effort: M** (a `BulkSectionSpec`-style spec already exists to reuse for
validation and mapping).

**C2. Native multi-language authoring.** Today: write one language, translate,
review. Instead, one call writes the field in all `supported_locales` natively,
with the CV's *existing* translated pairs supplied as a glossary so terminology
stays stable across the document.
**Effort: M.** Turns the dual-view pattern from "write then translate" into
"write once, get both" — which is the app's core promise.

**C3. Bilingual glossary memory.** Derive a term glossary from the CV's already
translated field pairs and inject it into every future translate/authoring
call. Small feature, multiplies the quality of C2 and the existing `llm`
translate provider.
**Effort: S.**

**C4. Registry hygiene assistant.** Propose skill/role merges the deterministic
tiers in `lib/skillMatch.ts` can't reach (semantic near-duplicates), assign
`SkillCategory` to the uncategorised tail, propose new categories with
reasoning. Applies through the existing `mergeRegistry`.
**Effort: M.**

### D. Positioning & structure

**D1. Profile & bundle generator.** Read the whole CV and propose 3–5
*Profiles* — distinct positioning angles ("Cloud architect", "Delivery lead") —
each with tag line, long summary, short summary, and an **ordered competency
bundle** drawn from the existing library plus proposals for genuinely new
competencies. Maps exactly onto the v12 bundle model (§4 CLAUDE.md).
*Why high-end only:* it's positioning judgement over an entire career.
**Effort: M–L**, and it's the feature that best matches what the profiles
rework was built for.

**D2. Section intros per audience.** Draft the per-view intro and section
intros (`SectionIntro` exists) for a given audience/posting.
**Effort: S.**

**D3. "What's missing" per section.** The writing coach's `asks`, at section
and CV scale — what a reader of *this* section expects that isn't there.
**Effort: S.**

### E. Export polish

**E1. Fit-to-N-pages by tightening, not cutting.** `lib/pageFit.ts` today
proposes whole items to drop and explicitly "never rewrites prose to fit".
A high-end model could propose tightened wording instead.
⚠️ This is a deliberate reversal of a stated design decision — worth doing only
if you actually want it, and it should stay a separate opt-in mode next to the
cut-items one, not replace it.
**Effort: M.**

### F. Cross-resume / team (multi-resume is already there)

**F1. Staffing fit across resumes.** Given a posting, rank everyone in the
instance and say why — bid support, built on `lib/whoKnowsWhat.ts` and the
instance registry. Consultancy-shaped, and nothing else in the app does it.
**Effort: M–L** (needs a whole-instance prompt bundle + a new panel next to
`WhoKnowsWhatPanel`).

**F2. Registry harmonisation across resumes.** Team-wide consistent skill
naming, over the instance-level registry.
**Effort: M.** Mostly the same machinery as C4, wider scope.

---

## 4. Suggested phase 1

If the goal is "most usable improvement for the least new surface":

1. **§2 gate** (required).
2. **A1 CV Review** — the flagship; makes the flag obviously worth ticking.
3. **C1 Freeform intake** — the biggest editing-speed win.
4. **B1 Job fit report** — the biggest business-value win.
5. **A3 semantic drift** — cheap, slots into an existing feature, already
   anticipated in the codebase.

C3 (glossary) is a good cheap rider on any translation-touching pick. B2 and E1
are the two that need an explicit "yes, change that decision" from you.
