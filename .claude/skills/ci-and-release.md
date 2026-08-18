---
name: ci-and-release
description: How Resume Studio's GitHub Actions CI and release pipeline actually work, and how to triage a failing check. Use when a CI job (verify/coverage/e2e/depcheck) is red, when a `v*` release build fails or ships wrong artifacts, when cutting a release, or when touching .github/workflows/ci.yml or release.yml. Encodes the real failure modes these workflows were built to prevent (version drift, split releases, missing update sidecars, the SQLite runtime requirement).
---

# CI & release pipeline

Two workflows, one app. Read this before changing `.github/workflows/*` or when
a check is red. Pairs with CLAUDE.md §11 (verifying changes) and §14 (desktop
build & release invariants), and the `software-testing` skill (the local gate).

## 1. What runs, and where the same check runs locally

`ci.yml` (on every push to `main`/`master` + every PR) has four jobs:

| Job | Steps | Local equivalent |
|---|---|---|
| **verify** | `npm ci` → `npm run lint` → `npm run check:text` → `npm run typecheck` → `npm test` → `npm run build` → `npm run check:bundle` | the §11 gate, in order |
| **coverage** | `npm run test:coverage` (thresholds in `vite.config.ts`) | `npm run test:coverage` |
| **e2e smoke** | build → `npx playwright install --with-deps chromium firefox webkit` → `npx playwright test` | `npm run test:e2e` |
| **depcheck** (advisory, `continue-on-error`) | `npx depcheck@1.4.7` | `npx depcheck@1.4.7` |

**Triage order = the gate order** (each catches what the previous misses):
lint → check:text → typecheck → test → build → check:bundle → e2e. Reproduce locally with the *same* command the
job ran before touching anything — CI failures here are almost always real, not
environmental (the harness noise in `software-testing` §6 is about *local* runs).

- **verify red** → run `npm run typecheck` (covers client **and** server
  tsconfig), then `npm test`, then `npm run build`. The build catches what
  `tsc` can't: missing third-party exports, broken dynamic imports, lazy-chunk
  regressions (see the `export-pipeline` skill — `exporter`/`pdfmake` must stay
  split chunks).
- **e2e red** → the job boots the REAL prod server and runs BOTH suites in
  `e2e/` on all three engines: `smoke.spec.ts` (create → edit/auto-save/reload →
  view preview → unknown-id bounce) and `a11y.spec.ts` (axe with real layout,
  plus keyboard-only journeys). The job name says "smoke" but the command is a
  bare `npx playwright test`, so an accessibility regression reports here too —
  check which spec failed before assuming a functional break. Failure artifacts: the job uploads `test-results/` as
  `playwright-traces` on failure (7-day retention) — open the trace before
  guessing. Keep this suite thin (happy paths only); a flaky assertion here is
  usually a missing readiness wait, not a product bug (`software-testing` §5).
  Which engines fail is itself the diagnosis: **all three** is a product bug,
  **firefox only, locally, on Windows** is the browsers-path trap documented in
  `playwright.config.ts` (not the app).
- **depcheck red does NOT block merge** — it's advisory (`continue-on-error`,
  `|| true`), surfaced in the job summary. It flags unused deps + phantom
  (undeclared) imports. Act on real findings; never "fix" CI by making it
  blocking. It's the cheap guardrail chosen instead of migrating npm→pnpm.

Node is pinned to **24** across all jobs, and it is a hard requirement rather
than a preference: storage is `node:sqlite`, which Node 22 and below gate behind
`--experimental-sqlite`. The desktop build bundles whatever Node it runs on, so
`build-desktop.mjs` probes `process.execPath` for a usable `node:sqlite` and
hard-fails instead of shipping a release that dies on first save.

**Workflow-level hardening (don't regress):** `ci.yml` runs with
`permissions: contents: read` (least privilege — CI never writes), a
`concurrency` group that supersedes redundant **PR** runs but never cancels an
in-flight run on `main`, and a `timeout-minutes` on every job so a hang can't
burn the 6-hour default. `release.yml` keeps `permissions: contents: write`
(it must attach release assets) and its own per-job timeouts. If you add a job,
give it a `timeout-minutes`; if a job needs a broader token, scope the extra
permission on that job, not the whole workflow.

**Actions are SHA-pinned (supply-chain hardening) — keep them that way.** Every
`uses:` in both workflows points at a full **commit SHA** with a trailing
`# vX` comment, not a floating tag. A moved tag can't silently swap the code
that runs in CI or builds the release artifacts users auto-update from. This
matters most for the third-party `softprops/action-gh-release` (it publishes
the release + assets), but all actions are pinned uniformly. When adding an
action, resolve its SHA (`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`)
and pin to that, `# <version>`. **`.github/dependabot.yml`** (github-actions
ecosystem only, weekly, grouped into one PR) is what keeps these pins current —
without it, SHA pins rot silently. Don't replace a SHA pin with a bare tag to
"simplify"; that's the regression this closes.

## 2. The release pipeline (`release.yml`, on `v*` tags)

Tag-driven: `git tag vX.Y.Z && git push origin vX.Y.Z` builds the portable
desktop bundle on Windows/macOS/Linux and attaches artifacts to the GitHub
Release. Structure and the races it was built to avoid:

- **`create-release` runs once, before the build matrix.** Do NOT delete it and
  let the matrix auto-create on first upload — three OS jobs creating
  concurrently is a check-then-act race that split v0.8.0 across two releases
  (public one missing the macOS download). With the release pre-created, every
  matrix job takes the idempotent "update existing" path.
- **Version = the git tag, verified twice** (in `create-release` AND each build
  job): `TAG_VERSION` (from `GITHUB_REF_NAME`) must equal `package.json`
  version, else the job hard-fails with no release published. This is the fix
  for the v0.3.2 version-drift bug (a stale self-reported version caused a
  perpetual "update available" loop). The tag value is baked in via
  `RESUME_APP_VERSION`.
- **Three asset families per release** (see the header comment in release.yml —
  keep it accurate):
  1. `ResumeStudio-<os>.(zip|tar.gz)` — human download; `docs/download.md`
     links to these, so **filenames must stay stable** or those URLs 404.
  2. `resume-studio-<os>-<arch>.tar.gz` — the **auto-updater** asset; names must
     match `server/desktop/updater.ts → assetNameFor`, format must stay
     `.tar.gz` (the updater extracts with `tar -xzf`).
  3. `resume-studio-<os>-<arch>.tar.gz.sha256` — checksum sidecar; the updater
     **fails closed without it** (`ChecksumError`). Drop it and every field
     build stops updating. `build-desktop.mjs` emits (2) and (3) together;
     `fail_on_unmatched_files: true` guards against a missing upload.

## 3. Cutting a release (checklist)

1. Bump **`package.json` AND `package-lock.json`** to `X.Y.Z`, commit. (Version
   numbers are the owner's call — default to a patch bump; don't volunteer
   semver advice.)
2. Green `main` first — the release build re-runs typecheck+test as a sanity
   gate, but don't lean on it.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. Watch the run: `gh run watch` / `gh run list --workflow=release.yml`.
5. Verify the published release has all three asset families for all three OSes
   (the split-release failure mode looks like a *missing* asset, not an error).

## 4. Common release failures → cause

- **"Tag vX does not match package.json"** → you tagged before bumping
  `package.json`/`package-lock.json`. Fix both, commit, delete + re-push the tag.
- **Release exists but an OS's download is missing** → the split-release race
  (someone removed `create-release` or reintroduced auto-create). Restore the
  single pre-create job.
- **Field builds stopped updating** → the `.sha256` sidecar upload was dropped,
  or `assetNameFor`/`checksumNameFor` in `updater.ts` drifted from
  `build-desktop.mjs`. Keep those name-builders in sync (CLAUDE.md §14).
- **Windows build fails compiling a native addon** → should be impossible now
  that SQLite comes from the Node binary. If it returns, something re-added a
  native dependency; the windows-latest image cannot drive node-gyp, so that is
  a blocker, not a slow build.
- **Desktop build hard-fails on `node:sqlite`** → the runner dropped below Node
  24. Keep `node-version: '24'` everywhere.

## 5. Reference

- `.github/workflows/ci.yml`, `.github/workflows/release.yml` — the header
  comments there are load-bearing; update them when you change behaviour.
- CLAUDE.md §14 — the desktop/updater invariants the release pipeline serves.
- `scripts/build-desktop.mjs` — emits the updater asset + sidecar.
- For docs-grounded GitHub Actions *syntax* questions (not this repo's
  triage), use the `github-actions-docs` skill.
