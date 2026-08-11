# Releasing

Cutting a release is three commands. Everything else here is the checking that
happens before them, and it exists because the release path has already gone
wrong in three distinct ways — each of which is now guarded, and each of which
is worth understanding before you trust the guard.

## The one-minute version

```bash
npm version patch --no-git-tag-version
```

Then commit both `package.json` and `package-lock.json`, and push the tag:

```bash
git commit -am "chore(release): 1.0.1"
```

```bash
git tag v1.0.1 && git push origin main --tags
```

The tag triggers `.github/workflows/release.yml`, which builds for Windows,
macOS and Linux and attaches the artifacts.

**The version number is your call.** Default to a patch bump unless you decide
otherwise.

---

## Before you tag

### 1. The gates CI runs

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run check:bundle
```

`npm run check:text` also runs in CI and catches raw control characters
anywhere git tracks — including Markdown, which ESLint does not cover.

### 2. The gates CI does *not* run

These are pre-release audits, deliberately kept out of the per-commit path:

```bash
npm run test:e2e
```

```bash
npm run test:mutation
```

The mutation run reports which assertions are missing rather than pass/fail —
read it, don't just run it. The e2e suite needs all three browser engines
installed (`npx playwright install chromium firefox webkit`); on Windows,
Firefox may fail to launch locally, which is an OS-level spawn block, not a
test failure. CI runs all three on Linux.

```bash
npm audit
```

Should report zero. A high-severity advisory in a *production* dependency
blocks a release; a dev-only one is a judgement call.

### 3. The things no gate can check

- **Open an exported `.docx` in Word.** `tests/exportIntegrity.test.ts` proves
  the package is structurally valid OOXML — well-formed parts, no dangling
  relationships, every content type declared — which is what makes Word offer
  to "recover" a file. It cannot tell you the document *looks* right. Check one
  in Word, one in LibreOffice, and a PDF in a real reader.
- **The upgrade actually working.** See below; this is the big one.
- **A visual pass** over an editor page and a view preview.

### 4. Version bookkeeping

- `package.json` **and** `package-lock.json` must both carry the new version.
  The release workflow hard-fails if `package.json` disagrees with the tag, but
  the lockfile is not checked — and a stale lockfile version is confusing
  rather than dangerous.
- Add the release to [CHANGELOG.md](./CHANGELOG.md).
- If dependencies changed, re-check [THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md)
  (the command to re-read them is at the bottom of that file).

---

## Rehearse the upgrade — the step worth more than the rest

**Auto-update is the only failure that cannot be fixed by shipping a fix**,
because the fix would ship through the mechanism that is broken. Every install
in the field would have to be replaced by hand.

The parts CI cannot exercise are exactly the fragile ones: a detached swap
script that waits on the running process's PID, replacing files the process
holds open (`node.exe` on Windows), and a windowless relaunch via `wscript.exe`.
`tests/server/updater.test.ts` covers the decision logic; nothing covers the
swap.

So before a release that matters — certainly before a major one:

1. Install the **currently published** build on a real machine, per OS.
2. Push the new tag and let the workflow publish.
3. In the installed old build: tray → **Check for updates** → install.
4. Confirm it restarts, reports the new version, and the data directory
   survived.

If you only do this on one OS, do it on Windows: it is the platform with the
file-locking problem, the visible PowerShell swap window and the `wscript.exe`
relaunch that once opened a text editor instead of the app.

## After the release

- Check all three platform archives are attached, plus the updater `.tar.gz`
  assets **and their `.sha256` sidecars**. The updater **fails closed** without
  a checksum: drop those and every desktop build in the field silently stops
  updating.
- Download one archive and launch it.
- Confirm the build reports `v<version>`, not `Dev-<commit>`. If it says
  `Dev-…`, the workflow did not declare the release channel and the artifact is
  mislabelled.

---

## Failures this process has already had

Kept because each one looked impossible until it happened.

- **Two releases for one tag.** Three matrix jobs each "created the release if
  absent" — a check-then-act race. v0.8.0 published with no macOS download.
  Fixed by creating the release once, before the matrix.
- **A stale version baked into artifacts.** `package.json` was not bumped with
  the tag, so builds self-reported an old version and every client sat in a
  perpetual "update available" loop. Fixed by deriving the version from the tag
  and hard-failing on a mismatch.
- **`npm ci` failing before any gate ran.** A lockfile regenerated with
  `--legacy-peer-deps` wrote peer conflicts that `npm ci` then rejected. Never
  regenerate the lockfile with `--legacy-peer-deps` or `--force`.
