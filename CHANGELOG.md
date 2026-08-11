# Changelog

Notable changes to Cartavio Resume Studio. Newest first.

The version a build reports is the git tag it was built from; anything else
reports `Dev-<commit>`. Desktop builds update themselves — see
[DESKTOP.md](./DESKTOP.md).

## [Unreleased] — 1.0.0

The 1.0.0 release is a **quality and assurance milestone, not a feature
release**. Everything the app does was already there in 0.10.2; this cycle went
looking for the ways it could be wrong.

### Fixed

- **Field labels failed WCAG AA contrast inside expanded cards.** `--ink-faint`
  had been verified against the white background only (4.83:1) but labels sit
  on `--paper-sunken`, where it measured 4.37:1 — under the 4.5:1 floor.
  Darkened to pass on all three surfaces. The existing jsdom accessibility
  suite could not see this: jsdom has no layout engine, so axe's colour-contrast
  rule is inert there.
- **Unlabelled controls in the Resume Views editor.** The hex colour inputs had
  no accessible name (only the paired swatch did), and the header typography
  selects and size inputs took their name from a `<span>` covering two controls,
  so neither inherited one.
- **Disabled header rows were dimmed below AA.** `opacity: .55` composites text
  toward the background; the field name measured 4.07:1. Raised to `.7`
  (6.76:1), which still reads as off.
- **The development server reported a release version number.** A dev build
  claimed `0.10.2`, indistinguishable from the artifact users downloaded. Builds
  now report `Dev-<commit>` unless the tagged release workflow declares
  otherwise; the semver the updater compares is unchanged.
- **The dev API server collided with the client's port.** Launchers that inject
  `PORT` to choose the client port also drove the API server, so the two raced
  for one port and the app loaded with every request failing.
- **`nanoid` advisory** (GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8) resolved by
  patch bumps in the dependency tree.

### Added

- **DOCX package integrity tests** covering what makes Word offer to "recover"
  a file: malformed XML parts, dangling relationship ids, and undeclared content
  types. Includes negative controls that corrupt a real archive, so the checks
  are proven able to fail.
- **Real-browser accessibility suite** (`e2e/a11y.spec.ts`) — axe over the main
  routes with real CSS applied, plus keyboard-only journeys: skip-link
  behaviour, reaching and editing a field by Tab alone, and a visible focus
  indicator on every focusable control.
- **Scale measurements** for a realistic large CV (50 projects × 15 locales with
  a photo): payload weight against the offline-queue thresholds, and render
  budgets for the view filter, HTML preview, text export and global search.
  Server-side, that snapshots stay image-free as history accumulates.
- **Licensing and policy documents**: `LICENSE`, `THIRD-PARTY-LICENSES.md`,
  `SECURITY.md`, `PRIVACY.md`, `RELEASING.md`. The desktop build now hard-fails
  if the legal texts are missing rather than shipping without them.
- **A per-entry size cap on client-side zip import**, matching the guard the
  server already applied.

### Measured, not changed

A large CV (50 projects, 15 locales, 300 kB photo) weighs **1.30 MB**, of which
**35.7 %** is images. That crosses the picker's "large" warning line but stays
well under the 2.5 MB offline-queue risk line. This is the evidence
`plans/open-items.md` names as the trigger for a content-addressed asset table;
it is recorded here so the decision can be made from a number.

---

## 0.10.x — 2026-07-29 onward

**The advanced (high-end) assist tier.** Twelve AI assists that read the whole
CV rather than one field, gated behind an operator-declared `llm_high_end`
flag: whole-CV review, consistency and voice proposals, cross-language meaning
comparison, achievement mining, profile and competency generation, view
introduction drafting, per-section gap analysis, job-fit reporting, cover-letter
angles, freeform intake, ATS keyword audit, and registry hygiene proposals.
Plus the **bilingual glossary** (C3), which harvests term pairs from the
registries to keep terminology stable in translation.

Also in this line: rich text gained **one canonical kind of line break**, so the
editor, HTML, DOCX and PDF all render a paragraph boundary identically.

## 0.9.x — 2026-07-22 onward

**Cross-resume shared registries** (a rename in one resume propagates to all,
carried in backups and desktop sync), **profile competency bundles**, and
**continuous desktop sync** — the sync folder is now merged in both directions
while the app runs, not only at launch.

## 0.8.x — 2026-07-16 onward

Cover letters as their own entity, and the first half of the shared-registry
work.

## 0.5.x–0.7.x — 2026-07

The desktop build matured: portable per-OS bundles, system tray, auto-update
with checksum verification, and cross-computer JSON sync with per-resume files,
tombstone-based deletion propagation, and three-way merge so non-overlapping
edits reconcile without a conflict prompt.

## 0.4.x — 2026-06-15 onward

The **section-descriptor catalog** (one descriptor feeds every render adapter),
**export templates**, **BYO-LLM view tailoring**, **per-view anonymization**,
**ATS plain-text and Markdown exports**, **LinkedIn and Europass importers**,
the **skill matrix**, the full **Quadim skill-taxonomy integration**, the
**storage readout**, and **freshness warnings**.

## 0.3.x — 2026-06-12 onward

The **UX and accessibility wave**: programmatic names on every form control,
live regions for async status, focus management in modals, the AA-verified
colour tokens, and an 11px minimum text size. Plus the generic `mergeRegistry`,
the Industry registry, the career timeline, and global content search.

## 0.2.x — 2026-06-09 onward

Multi-resume support, offline editing with conflict safety, server-side
snapshot history, and the live preview pane.

## 0.1.0 — 2026-06-05

First tagged release. The core promise: one master CV across multiple
languages, dual-language side-by-side editing, Resume Views as curated subsets,
and PDF/DOCX export.

---

Per-commit detail for any release is in git history and on the
[releases page](https://github.com/sveinmagnus/resumestudio/releases).
