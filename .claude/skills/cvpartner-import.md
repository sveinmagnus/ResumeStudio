---
name: cvpartner-import
description: The reality of the CVpartner JSON export format and the invariants Resume Studio's importer must preserve. Use before changing src/lib/importer.ts, src/lib/migrate.ts, the localized()/scanLocales logic, or the data model in src/types/index.ts that the importer populates. Encodes the format quirks and importer invariants that have produced real bugs (e.g. project↔work links that were silently always null).
---

# CVpartner import & data model

The importer (`src/lib/importer.ts`) maps a messy, real-world external format
into our `ResumeStore`. It is the app's largest untrusted-input surface and the
place where "looks fine, silently wrong" bugs breed. Read this before touching
the importer, `migrate.ts`, or the model shapes they populate. Pairs with
CLAUDE.md §9.

## 1. The CVpartner format reality (don't assume clean data)

- **Localized values come in two shapes.** Either an object
  `{ no: "...", int: "..." }` **or** an interleaved array
  `['no', '...', 'int', '...']`. The `localized()` helper handles both — route
  every localized field through it; never index a raw field.
- **`int` is English.** Normalise `int → en` everywhere (the helper does;
  `scanLocales`/`detectLocalesInData` do too). The codes a CVpartner export
  carries are `no`, `int`, `se` and `dk`; the app's own set is the 15 in
  `LOCALE_LABELS`, so a detected locale outside CVpartner's four is legitimate
  and must survive the import.
- **Empty/whitespace values are dropped** and text is trimmed. A locale key with
  only whitespace must not appear in the result.
- **`language_codes` lies.** It often lists only `no` even when content is in
  `no/int/se/dk`. **Never trust it** — detect locales by scanning actual content
  (`scanLocales` in the importer; the generic version is
  `lib/locales.ts → detectLocalesInData`). Order with `sortLocales`
  (`no` first, then `en`, then the rest).
- **Dates are stringly-typed.** `year_from`/`month_from` etc. are strings;
  `yearMonth()` parses them. `year_to === ''` (empty string) means **ongoing**
  → `end: null`. Month may be absent → `month: null` (year-only precision).
- **Proficiency is often 0 across the board** — the source doesn't populate it.
  Don't write logic that assumes non-zero proficiency exists.

## 2. Importer invariants (preserve these)

- **No orphan skills.** The skill registry is built from
  `technologies[].technology_skills` **and** any skill referenced only inside a
  project (`project_experience_skills`). Dedup is **case-insensitive** on the
  skill name; a project skill matching an existing registry entry reuses its id.
- **Roles come from `cv_roles`;** project roles link via `cv_role_id`. A project
  role with no matching `cv_role_id` gets a fresh `role_id` (unlinked).
- **Build the work-experience id map BEFORE iterating projects.** Projects
  reference work experiences via `related_work_experience_id`; if the map isn't
  pre-built, every link resolves to `null`. *This was a real bug — the map was
  populated after the project loop, so `work_experience_id` was always null.
  There is a regression test; keep it.*
- **`customer_selected: 'customer_anonymized'` → `use_anonymized: true`.**
- **Fresh UUIDs for every entity** — never reuse CVpartner `_id` as our id.
  `resume_id` on every entity points at the one resume.
- **Role free-text is folded into the project description at import.** CVpartner
  project roles carry `long_description`/`summary`; our `ProjectRole` is a pure
  registry link with **no** free-text fields. The importer folds that text into
  the project's `long_description` via `buildRoleParagraph` + `appendLocalized`
  (from `migrate.ts`) — the *same* helpers `foldRoleDescriptions` uses on load.
  Keep import-time and load-time folding consistent.

## 3. Data-model invariants anything populating the store must hold

- **Resolve localized strings through `resolve()`** (`lib/locales.ts`) — request
  → fallback (`en`) → first non-empty. **Never** read `value[locale]` directly;
  empty-string handling lives in `resolve()`.
- **Snapshot names are denormalized.** `ProjectSkill.name`, `CategorySkill.name`,
  `ProjectRole.name` are copies of the registry name at link time so a later
  rename doesn't rewrite history. `merge.ts` updates them when rewriting refs.
- **`ProjectRole` is a registry link only** (`role_id` + snapshot `name` +
  `sort_order` + `disabled`). Do not re-add `long_description`/`summary` to it —
  `migrate.foldRoleDescriptions` exists precisely to strip them from legacy data.
- **Embedded vs. table.** A project's roles/skills/highlights and a tech
  category's skills are embedded arrays on the parent — don't promote them to
  top-level `ResumeStore` arrays.
- **`YearMonth` is month precision**, `end: null` = ongoing.

## 4. Security note (see security-review skill)

Imported text becomes resume fields that later flow into the export pipeline.
**Escaping happens in `viewFilter.ts`, not the importer** — do not escape on
import (it would corrupt the edit view). Prototype-pollution surface is
currently nil because `result[key] = string` on a plain `{}` is safe; never
switch to `Object.assign(target, untrustedJson)` or spread an untrusted object
as a key source.

## 5. Test discipline

`tests/importer.test.ts` is **table-driven** — one case per documented behavior
above. When you change the importer:

1. Add/adjust a row for the behavior you touched (both localized shapes,
   `int→en`, whitespace dropping, malformed-doesn't-throw, locale detection vs
   sparse `language_codes`, no-orphan skills, case-insensitive reuse, role
   linking, **project→work link resolution**, anonymized mapping, ID
   freshness/stability, role-folding).
2. Assert the *contract*, not the implementation — e.g. that a project's
   `work_experience_id` equals the imported work experience's new id, not a
   particular UUID.
3. Run `npm test` + `npm run typecheck`.

## 6. When you touch this — checklist

1. New CVpartner field? Route localized values through `localized()`; dates
   through `yearMonth()`.
2. New cross-entity link? Build the id map of the *target* collection before the
   loop that references it (the §2 work-experience lesson).
3. Changed a model shape the importer fills? Update `freshStore.ts`, the
   importer, and consider a `migrate.ts` step for already-persisted data.
4. Add the table-test row before you call it done.
