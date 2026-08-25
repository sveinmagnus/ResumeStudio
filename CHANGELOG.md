# Changelog

Notable changes to Cartavio Resume Studio. Newest first.

The version a build reports is the git tag it was built from; anything else
reports `Dev-<commit>`. Desktop builds update themselves — see
[DESKTOP.md](./DESKTOP.md).

## 1.2.0 — 2026-08-25

The truth-and-maintenance release. Everything before this stored and shaped a
CV; this release helps keep it *true and current* — the claims backed, the
prose unrepeated, the references consenting, the just-finished project captured
while you still remember it — and teaches the app one more open interchange
format plus two new ways to read and share a view.

### Added

- **Project debrief interview.** When an engagement ends, the Overview nudges:
  "recently finished — capture it while it's fresh." The interview asks three
  to six pointed questions *derived from what the project lacks* (no AI needed
  to ask), and your answers are reshaped — by your configured model, or through
  the copy-prompt/paste-reply path with any AI — into project highlights,
  registry-interned skill links and a short description. Everything is a review
  list you tick: existing skills pre-ticked, new registry entries a deliberate
  click, and a drafted one-liner never replaces a line you wrote without an
  explicit tick. Applying is one undo step; "nothing new" retires the nudge
  too. Also available any time from the project card.
- **Claim–evidence check.** An Overview panel for the claims the CV's own
  structure doesn't back: a 4–5/5 skill rating with no dated project behind it,
  a showcased skill no project links, a role claiming years with no linked
  engagements, a key competency no project or employment prose ever mentions.
  Offline and structural, like the cross-language check beside it — hints with
  a click-to-open, not verdicts, and each row can be dismissed for a year once
  you've judged it defensible.
- **Repetition check.** The same achievement sold twice — usually pasted into
  both the employment and its project — found by sentence-level matching
  (exact and near-identical) plus whole-field similarity, across every
  language. A summary restating its own long description is by design and never
  flagged; both sides of a real pair are one click away.
- **Reference consent tracking.** A reference is another person's contact data,
  so each now carries a consent status — not asked / asked / confirmed (with a
  stamped date) / declined. Only export-included references are policed:
  declined-but-still-exported is the loudest warning, never-confirmed next, and
  a confirmation older than two years asks to be refreshed. Private references
  never nag.
- **Read-through mode.** "Read through" in the view editor opens the view as
  one flowing document — what the PDF says, minus the layout — with a flag
  gutter on every item and a notes rail. Flags survive leaving to fix the first
  one ("Open in editor" jumps straight to the flagged card), persist per view,
  and the button shows how many are still standing.
- **Single-file HTML export.** One self-contained `.html` per view: brand fonts
  inlined, images already embedded, opens straight from disk or an email
  attachment with nothing to reach back for. If a font can't be fetched the
  export degrades to system fallbacks rather than failing.
- **JSON Resume import and export.** The open jsonresume.org format joins
  CVpartner, LinkedIn and Europass. Import detects the format positively (our
  own files can never be misrouted), turns a skills group's keywords into a
  skill category with members, and lands JSON Resume "references" — testimonial
  quotes — as Recommendations, not as our consent-bearing References. Export is
  per-view like every other format: exclusions, anonymization and the view's
  skill-section choices all hold, so an anonymized view leaks no client name
  through a skill list.

### Quality

- The whole wave went through a pre-release audit: a live click-through of
  every new surface, the three-engine browser suite, axe accessibility checks
  over the three new components (clean), and a mutation-testing pass over all
  eight touched modules with targeted tests added for what it caught —
  boundary conditions, disabled-item filters and orderings the first tests
  asserted from only one side.

## 1.1.0 — 2026-08-22

Multi-user accounts for hosted instances. A server used to authenticate a
shared secret; it now authenticates a person, and scopes what each person can
see. The desktop build is untouched by all of it — one person on loopback gains
nothing from a login screen, so it never shows one.

### Added

- **Accounts and roles.** Sign in with a username or email address and a
  password (scrypt from `node:crypto` — no new dependency, no native addon).
  An **owner** sees and administers everything; a **member** owns what they
  create, may read what a colleague has shared, and may write only their own.
  Sharing grants READ — "share with the team" never means "let the team rewrite
  my CV". A resume that exists but is not yours to see answers as if it did not
  exist, so ids cannot be enumerated. Sessions never expire on a timer; they
  end on sign-out, a password change, or an account being disabled.
- **First-run setup with a one-time code.** A fresh instance prints a bootstrap
  code to its console — "first visitor becomes the owner" is a race a port
  scanner wins, so the trust boundary is "can read this machine's log", where
  it already sits. The first account becomes the owner, inherits any existing
  resumes, and receives ten single-use **recovery codes**, shown once.
  A token-authenticated instance keeps working untouched; start it with
  `RESUME_SETUP=1` to migrate, and any named legacy tokens become real accounts
  awaiting a reset link. `RESUME_API_TOKEN` survives as a service credential
  for scripts and CI — it authenticates but is nobody.
- **Four ways back in, one mechanism.** An owner-issued reset link, a recovery
  code, `npm run recover` on the machine itself, and — when mail is configured
  — a self-service reset email. All four end at the same redemption, and
  redeeming any of them signs out every session for that account.
- **Optional email**, off by default: sendmail or a dependency-free SMTP client
  (STARTTLS/TLS, AUTH PLAIN/LOGIN), used for exactly two messages — the reset
  link and address verification. An address must be verified before a reset
  will be mailed to it, and **no CV content is ever emailed**. Addresses with
  control characters are rejected outright, never sanitised.
- **Team administration** for owners: invite links that carry their role,
  enable/disable, promote/demote (never the last owner), owner-issued resets,
  and editing a colleague's identifiers. Members edit their own profile;
  changing a login identifier or replacing recovery codes costs the current
  password, so a borrowed screen cannot take the account over.
- **Hosted settings, the safe subset.** A hosted owner can configure mail, the
  app's base URL and their identity from the gear icon; everything
  machine-level (ports, folders, hostnames, providers) stays with the
  environment, because a web request that could move those is how an instance
  talks itself off the network. On a server, `settings.json` is a sparse
  overlay holding only what was saved in the app — delete it and the instance
  is back on its environment.
- **Identity without accounts.** The desktop build gets an optional profile
  (username, display name, email) so saves are attributed and an exported
  resume carries its author — descriptive, never authorising: an import assigns
  nothing from it.
- **The app shell loads offline** (a minimal service worker, deliberately not a
  PWA): the editor opens and cached work is readable while the server or
  network is away. `/api` responses are never cached — the worker has no code
  path that could.
- **Session cookies follow the connection, not the build.** `Secure` is set
  when the request arrived over TLS — deciding it from NODE_ENV broke sign-in
  on plain-http LAN boxes in Safari (and only visibly there). Behind a TLS
  proxy, set `RESUME_TRUST_PROXY`; the server warns at startup when that looks
  forgotten. CSRF is a double-submit pair; recovery routes carry their own
  success-inclusive rate limit so the mail-sending endpoint cannot be a mail
  bomb, while accepting an invitation counts only failures — a whole office
  onboarding through one NAT address is not an attack.

### Fixed

- **A hosted instance could overwrite its own environment with defaults.** The
  settings file was read as if every key in it had been chosen, but the parser
  fills absent keys in — so the first in-app save wrote all 36 keys and handed
  the default set authority over the operator's real environment:
  `RESUME_APP_BASE_URL` cleared (reset links became bare unopenable paths) and
  `MAIL_TRANSPORT` forced off, silently. Presence is now read from the raw
  file, and a server's save accumulates only the keys actually set.
- **Spending a recovery code threw the replacement set away.** Setting a
  password clears every code, so the server mints ten more and returns them
  once — the client read a field the server never sent, told the user "that was
  your last recovery code", and dropped the only readable copy. The profile's
  "generate a new set" button could never succeed either: the endpoint requires
  the current password and the form never asked for one.
- **The hosts-file reader counted an inline comment's words as managed
  hostnames**, diverging from the sibling that reads the same line correctly.

### Tested

The suite grew from 6,403 to **7,093 tests in 227 files**, and the mutation
audit now covers `server/` — where every authorization decision lives — as
well as `src/lib`: `access.ts`, the one module that answers "may this person
read this row", measures **100%**. New end-to-end journeys drive the whole
account lifecycle on all three browser engines, WebKit included, against a real
server with a real SMTP sink — which is how three of the bugs above were found.

## 1.0.2 — 2026-08-20

A security fix and the tail of the mutation-testing work 1.0.1 started. No new
features; nothing about the app looks different.

### Fixed

- **A resume id could write outside the sync folder.** A resume id arrives
  inside an imported or synced file and is the one field on that path that
  becomes a filename — `<slug>__<id>.json`, joined onto the sync folder. Only
  the slug half was sanitised, so an id of `x/../../../../tmp/pwn` wrote
  elsewhere on disk; on the desktop build nobody had to click anything, because
  the watcher merges inbound files and the scheduler republishes them a minute
  later. Both readers now charset-check the id against one shared rule
  (`server/resumeId.ts`), and the filename builder throws as a second lock at
  the interpolation site. Rejected rather than sanitised: an id is an identity,
  and quietly rewriting one merges a person's CV into the wrong row.
- **Six more `MAP[key] ?? fallback` reads** on maps keyed by data, the same
  inherited-property hole 1.0.1 swept out of 21 others. Three were one line
  copied around (`LOCALE_LABELS[c]?.name ?? c`), now a single `localeName`.
- **Two AI assists shared one reply schema id, and one of those collided with a
  file format the importer merges by identity.** The registry-hygiene assist
  stamped `resumestudio-registry/v1` — byte-identical to the sync folder's
  registry file — and the importer routes anything under that prefix straight
  to the server's merge endpoint, so a saved hygiene reply dropped on the picker
  was read as a registry to merge rather than refused. Page-fit and job-fit
  shared a second id. Both renamed; the file format could not move, because it
  is what is already on disk in users' sync folders.
- **A bulk-imported skill or role kept its padding.** The name was trimmed into
  the key it matched on but not into the entry it created, so `" Kubernetes "`
  became its own registry entry — visible in the registry, the skill matrix and
  every export as a second skill.

### Removed

Three pieces of code with no reachable caller, each surfaced by a mutant that
could not be killed because nothing ran the line: a `hasExtras` helper the view
editor never used, a `'number'` field kind no bulk-import spec declares (with
its validator branch, example value and doc label), and a `year_to` guard
repeated at four import sites that `yearMonth` already made redundant.

### Tested

The mutation score over `src/lib` went **87.1 % → 90.6 %** across three passes,
with mutants no test executed at all falling from 351 to 144. The suite is now
**6,403 tests in 196 files**.

Four modules the export rework had shipped without tests of their own account
for most of it: `itemLayout` (2.3 % → 100 %), `sectionExtras`, `sectionIcon` and
`viewTemplates`. The rest went to assertions that existed but proved less than
they read as — a Content-Security-Policy checked only for its first directive,
`completeness` field lists exercised for three sections of fifteen, export
endpoints asserted through mocked responses that held whatever URL was
requested, and a divider control checked for "the output changed" rather than
for which rule was drawn.

One existing test passed for the wrong reason and was fixed: `fontInstallInfo`
was asked about a family name rather than a catalog id, so it returned null
because the id was unknown, not because that font needs no install.

Where a surviving mutant is equivalent it is recorded as such in the commit
that examined it — including two guards proven unreachable by probe rather than
by assumption, which are kept as defensive code rather than removed to move a
number.

### Changed (development)

`npm run check:arch` is now a CI gate: CLAUDE.md's architecture map has to name
every module under `src/lib`, `src/store`, `server/` and `scripts/`. The map was
short by 48 of ~100 lib modules when it was measured, and a module missing from
a map that calls itself complete reads as a module that does not exist.

---

## 1.0.1 — 2026-08-19

**What you export is now what you saw.** 1.0.0 shipped four render targets that
quietly disagreed with each other; this release makes the preview, the PDF, the
Word file and the ATS text say the same things and draw them the same way. The
rest of the cycle was a mutation-testing pass over `src/lib` — not new
behaviour, but the assertions that would have caught these defects earlier.

### Fixed

- **The preview did not contain what the export contained.** The section
  catalog carried a different set of FIELDS per target: the Word and PDF files
  printed a project's team size, allocation and highlights, an education grade,
  a certification expiry and credential URL, presentation and publication URLs
  and referee contact details — and the HTML preview carried none of them. The
  document a consultant checked before sending was not the document they sent,
  and the ATS text export shipped less than either. A further eight fields were
  editable and reached no export at all: the employment headcount triple, the
  company URL, a project case-study URL, an award's "awarded for", a
  recommendation link and a study-abroad marker.
- **Seven view style controls moved the preview and nothing else** — skill tags
  (chips vs inline), item dividers, summary layout, full-item layout, aligned
  summary columns, section icons, and, in Word alone, density's line height.
  Two of the four full-item layouts rendered identically in the PDF and the Word
  file, so even at the defaults the preview and the PDF disagreed about where a
  CV's dates sit.
- **A map lookup keyed on an inherited property name returned a function.**
  `MAP[key] ?? fallback` was the idiom in 21 places, and every object literal
  inherits `toString`, `constructor`, `valueOf` and `hasOwnProperty` — which are
  neither null nor undefined, so `??` handed one straight to a caller expecting
  a string or an array. Both failure shapes were live: a date field could be
  exported containing `function toString() { [native code] }` and the same value
  sent to a translation provider as a target language; elsewhere a crafted view
  crashed the exporter instead of falling back to a default layout, and the
  translation language check returned a 500 instead of "no opinion". Keys reach
  these maps from imported resume and view JSON, and on the server from the
  request body. No prototype pollution is needed — the key alone does it.
- **The ATS text export dropped the "Skills:" label** that every other export
  carries, and the preview's inline tag list dropped it too.

### Added

- **Optional export content is chosen per view, not per target**
  (`lib/sectionExtras.ts`). Links, team and allocation metrics, referee contact
  details, company size, highlights, the project lead-in line, location, grade,
  expiry, study abroad and "awarded for" are declared per section and switched
  on per view. **Every group defaults off**, including the ones the Word and PDF
  exports used to ship unconditionally: an existing view renders less until it
  opts in, which is the point — what an export contains is now a decision rather
  than an accident of which button was pressed.
- **A local name for the desktop build, and port 80 when it is free.**
  `resumestudio.localhost` works in any browser with no setup (RFC 6761 reserves
  the TLD for loopback); `resumestudio.local` needs one elevated hosts-file
  write and is offered only once configured. The hosts rewrite touches only its
  own delimited block, passes no user text to a command line, and confirms
  success by re-reading the file rather than trusting an exit code — a cancelled
  UAC prompt exits 0.
- **Intel macOS release assets.** The updater fails closed without a matching
  archive, so an absent `resume-studio-macos-x64.tar.gz` left every Intel Mac
  silently unable to update itself.
- **Project country and reference LinkedIn** became editable, and export behind
  their groups. The country renders as a name via `Intl`, so there is no country
  table to maintain per locale. The certification expiry is now localized; it
  printed English in every language.

### Tested

A mutation-testing campaign over `src/lib` added **~16,700 lines of tests**
across 77 files, including ten new suites. The suite runs **6,195 tests in 192
files**. Two new parity suites hold the fixes above in place:
`tests/exportParity.test.ts` renders one view through all five outputs and
asserts each fact reaches every one of them, and
`tests/exportVisualParity.test.ts` flips each style control and asserts the
exact set of targets whose output moved — so a purely visual choice leaking
into the ATS text fails as loudly as a missing one.

Where a surviving mutant turned out to be equivalent, it is recorded as such in
the commit that examined it rather than papered over with an assertion that
proves nothing. One real dead branch fell out of the audit: the global search
snippet trimmer had a no-match arm no caller could reach.

### Known format limits

Both deliberate, both commented at the code. Word draws the section icon from
Office 2016 onward — its required raster fallback is blank, because an older
Word cannot draw a vector glyph and a missing icon beats a wrong bitmap. The
ATS text has no chips, so it keeps the "Skills:" label the chip style drops:
pick "Inline list" if a Word file headed for an ATS needs that label too.

---

## 1.0.0 — 2026-08-12

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
