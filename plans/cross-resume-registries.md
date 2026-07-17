# Cross-resume registries + "who knows what" matrix (Phase 2)

**Status: proposed (July 2026).** Design for review before implementation.
The end state is the owner's decision: **instance-level shared registries** —
skills / roles / industries / skill_categories owned by the instance, referenced
by resumes, so a rename or merge hits every CV. Plus a **who-knows-what matrix**
on the resume picker. This plan is about getting there *safely*, because it
touches the one assumption the whole persistence layer rests on.

---

## 1. Why this is hard (the load-bearing assumption)

Today a `ResumeStore` OWNS its registries (`data.skills`, `data.roles`,
`data.industries`, `data.skill_categories`). Everything downstream assumes that:

- **The store holds one resume in memory** (`currentResumeId`). Registries come
  and go with it. Instance-level registries mean the store must hold a *second*
  thing that outlives the current resume.
- **Auto-save PUTs the whole resume.** If registries are separate, editing
  "Java" is a different save than editing a project — with its own optimistic
  `version`, its own conflict surface.
- **Undo/redo snapshots the store.** Does renaming a shared skill undo? Across
  which resume?
- **A per-resume JSON backup is self-contained.** With id references to a shared
  registry, a backup imported into *another* instance has dangling ids. This is
  the sharpest edge (§4).
- **Desktop sync is newest-wins per resume.** Shared registries need their own
  merge story.
- **~27 files read `data.skills`/`roles`/`industries`** directly.

So the migration isn't "move an array" — it's re-drawing the store/sync/backup
boundaries. Done in one step it's high-risk and hard to reverse. Done in stages,
each stage ships value and is independently safe.

---

## 2. Staging (each stage ships and is reversible)

### Stage 1 — the matrix, ZERO data-model change ✅ do first

Deliver the headline goal — a **who-knows-what matrix on the picker** — reading
across every resume's EXISTING per-resume registries, matched on the
**normalized skill name** (`skillKey` — the Quadim normalization already makes
these canonical, the same key the skill-extraction assist interns against).

- New **read-only** server endpoint `GET /api/registry/matrix` that reads every
  `resumes.data` blob, extracts each resume's skills (name + proficiency + which
  person/resume), and aggregates by `skillKey`. Server-side aggregation over
  existing data — **no schema change, no migration, no write path.**
- Picker UI: a skill × person matrix (who has which skill, at what level),
  behind a toggle so the picker stays fast by default.
- Bonus: the matrix surfaces how consistent names ALREADY are across resumes —
  direct evidence for whether Stage 3 (authoritative shared registry) is worth
  its risk, and where the near-duplicates are.

Cost: one endpoint + aggregation lib (pure, testable) + one picker view.
Risk: near-zero (read-only, additive). **This alone may satisfy the intent.**

### Stage 2 — instance-level registry as an additive canonical layer

Introduce the server-owned registry WITHOUT dethroning the per-resume ones:

- New tables `registry_skills` / `_roles` / `_industries` / `_skill_categories`
  (id, localized name JSON, normalized key, version). New CRUD routes under
  `/api/registry/*`, `apiLimiter` + `authMiddleware`.
- A resume registry entry gains an OPTIONAL `canonical_id` link. Unlinked = today's
  behavior exactly. The matrix (Stage 1) prefers the canonical link, falling back
  to `skillKey` — so it keeps working through the transition.
- **Backup portability:** a per-resume backup EMBEDS a snapshot of every
  canonical entry it references (name + key). Import re-interns against the
  target instance's registry (match by key, create if absent) — the existing
  `mergeRegistry` logic at the import boundary. This is the rule that keeps
  backups portable across instances; it must land WITH the canonical link, not
  after.
- Store change is additive (a lookup table alongside the resume); the
  one-resume-in-memory model is untouched.

### Stage 3 — promotion to authoritative (CHOSEN — full instance-level)

Make the shared registry the source of truth. The reading of the entity shapes
revealed the linchpin below; the rest of Stage 3 hangs off it.

#### 3.0 The canonical / per-resume-use split (the linchpin)

A registry entity is NOT wholly shareable. It mixes the skill's **identity**
(shared — a rename should propagate everywhere) with **per-person facts** (Ada's
Java proficiency is not Bob's). So each entity splits:

| Entity | Canonical (instance-level, shared) | Per-resume "use" (stays in the resume) |
|---|---|---|
| Skill | `name`, normalized `key`, `classification`, `category_id`, `version` | `proficiency`, `total_duration_in_years`, `experience_offset_years`, `is_highlighted` |
| Role | `name`, `key`, `version` | (none beyond the existing reference links) |
| Industry | `name`, `key`, `version` | `sort_order`, `disabled` |
| SkillCategory | `name`, `version` | `sort_order` (the By-category display order) |

- **In-memory shape is unchanged.** `ResumeStore.skills` is RECONSTRUCTED at
  load by joining the instance canonical entry (name/key/classification/
  category) with this resume's use record (proficiency/highlight/offset). So the
  ~27 files reading `data.skills` don't change — the projection preserves the
  `Skill` shape. Only the store's load/save boundary and the registry-mutating
  actions change.
- **A rename writes the canonical entry** (instance endpoint, its own version) →
  propagates to every resume on next load. **A proficiency/highlight edit writes
  the per-resume use** (the normal per-resume save). The action layer routes each
  mutation to the right place.
- `ProjectSkill.name` etc. (denormalized link snapshots) still resolve as today;
  `merge.ts` semantics move to the canonical rename.

#### 3.1 Server + migration

- Instance tables `registry_skills` / `_roles` / `_industries` /
  `_skill_categories` (canonical columns above + `version`).
- One-time migration: union every resume's registries by `key` into the instance
  tables (localized names merged), rewrite each resume's `data` so its registry
  arrays become per-resume USE records keyed by the new canonical ids. Idempotent,
  transactional, snapshots each rewritten resume first (reversible from History).

#### 3.2 Store, backup, sync, UI

- **Store**: `loadStore` fetches the instance registry once + the resume, joins
  them into the in-memory `ResumeStore`. Auto-save PUTs only the per-resume use
  data; registry edits hit `/api/registry/*`.
- **Backup portability** (§4) is now mandatory, not optional: a per-resume backup
  embeds referenced canonical entries; import re-interns by key.
- **Sync/conflict** (§3): registry gets its own `version` + conflict surface.
- **Desktop merge**: whole-store backup carries the instance registry; union by key.
- **Matrix** (Stage 1's endpoint) now reads canonical skills + per-resume uses
  directly — cleaner than the name-matching fallback.

This is multi-session work; build it as green, non-breaking increments in the
order above, never leaving `main` broken.

---

## 3. Sync & conflict (Stage 3 detail, noted now)

- Shared registries get their own optimistic `version`; a registry edit is its
  own save. Two tabs renaming "Java" → 409 on the registry, routed to a
  registry-scoped conflict (distinct from the per-resume `ConflictModal`).
- Desktop whole-store backup carries the shared registry; merge is union by key
  (never delete), consistent with the resume merge rule.

## 4. Backup portability (the rule that must not break)

A backup is exported from instance A and may be imported into instance B, which
has a DIFFERENT shared registry. So:

- **Export:** embed a copy (name + normalized key) of every referenced canonical
  entry in the backup file.
- **Import:** for each embedded entry, find B's registry entry by key; reuse it,
  or create it. Rewrite the imported resume's links to B's ids. Never import a
  dangling `canonical_id`.
- This is `mergeRegistry` semantics moved to the import boundary. It is the
  single reason Stage 2 embeds snapshots rather than bare ids.

## 5. What NOT to do

- Don't put the live shared registry only in the cloud-sync folder (same
  corruption trap as the live DB — see DESKTOP.md §5).
- Don't break the one-resume-in-memory model before Stage 3, or the store/undo/
  auto-save invariants (store-and-persistence skill) all move at once.
- Don't skip the matrix (Stage 1) and jump to migration — the matrix is the
  cheap win AND the evidence base for whether the migration pays off.

---

## 6. Decision (July 2026)

The owner chose **full instance-level (Stage 3)**. Building it as green,
non-breaking increments per §2/§3.0–3.2, in order: server foundation + migration
→ store projection rewire → backup portability → sync/conflict → desktop merge →
picker matrix. Each increment compiles, tests green, and leaves `main` shippable.

**Implication the owner should know:** "shared registries" shares the skill's
*identity* (name/spelling/classification/category), so a rename or merge
propagates across all CVs — but **per-person facts (proficiency, years,
showcase highlight) stay per-resume** by necessity (they differ per consultant).
The who-knows-what matrix reads the shared identity plus each person's own
proficiency. This is the only sane meaning of "shared" and is baked into §3.0.
