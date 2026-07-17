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

### Stage 3 — promotion to authoritative (the big, optional step)

Only if Stages 1–2 prove the value. Make the shared registry the source of
truth: a one-time server migration unions every resume's registries by key,
rewrites references to shared ids, and the store loads registries separately
from the resume. This is where sync/conflict/undo/backup all change, and where
the real risk lives — specced in full only when we commit to it.

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

## 6. Recommendation

Build **Stage 1 now** (ships the picker matrix, zero risk), then decide Stage 2/3
from what it reveals about name consistency across the real CVs. The owner chose
the instance-level end state; this staging reaches it without a big-bang
migration that would be painful to unwind.
