# Cartavio Resume Studio

A multi-language consultant resume manager. Maintain one master CV across
languages, then export targeted variants — PDF, Microsoft Word, or ATS
text — for different audiences.

Built for a single consultant or small team; runs as a small self-hosted web app (React +
Express + SQLite) with offline-tolerant persistence.

---

## Download

The easiest way to run Resume Studio is the **portable desktop app** — no
install and no Node required. Get the newest build for your OS:

**➜ [Download the latest release](https://github.com/sveinmagnus/resumestudio/releases/latest)**

Direct downloads (these URLs always point at the most recent release):

| OS | Download |
|----|----------|
| Windows | [ResumeStudio-windows-x64.zip](https://github.com/sveinmagnus/resumestudio/releases/latest/download/ResumeStudio-windows-x64.zip) |
| macOS | [ResumeStudio-macos.zip](https://github.com/sveinmagnus/resumestudio/releases/latest/download/ResumeStudio-macos.zip) |
| Linux | [ResumeStudio-linux-x64.tar.gz](https://github.com/sveinmagnus/resumestudio/releases/latest/download/ResumeStudio-linux-x64.tar.gz) |

Unzip, double-click the launcher, and the app opens in your browser. It keeps
itself up to date automatically (tray → **Check for updates**). Full details in
[DESKTOP.md](./DESKTOP.md).

---

## Quick start

```bash
npm install
npm run dev
```

Opens the client on `http://localhost:5173` and the API on `http://localhost:3001`.

For production:

```bash
cp .env.example .env       # set RESUME_API_TOKEN for a deployed instance
npm run build
npm start                  # serves dist/ + API from the same Express process
```

On Windows, if PowerShell blocks scripts, use `npm.cmd` instead of `npm`, or
run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

---

## What's in the box

The full feature tour lives on the
[documentation site](https://sveinmagnus.github.io/resumestudio/features.html)
— this is the short version:

- **Multi-resume.** One instance holds any number of master CVs; the picker is
  the home screen, each CV has its own URL, history, and language pair.
- **Dual-language side-by-side editing.** Every translatable field renders as
  two inputs at once — pick any two locales, swap with one click, hide the
  secondary column when you want focus.
- **Translation assist.** Per-field **Copy from primary** (no network) and an
  optional **Draft translation** button proxied through your own server.
  Providers: self-hosted [LibreTranslate](https://libretranslate.com/)
  (Docker-managed or remote, with a pick-your-languages install), DeepL,
  Google Cloud Translation, Azure Translator — or the same local/remote LLM
  you configured for AI assist, with zero extra setup.
- **AI assist, bring-your-own model.** Point the app at a local Ollama
  (Docker-managed for you), OpenAI, or any OpenAI-compatible endpoint, and
  one model powers the whole assist suite: one-line summaries (per field or
  "Summarize all empty"), skill suggestions from project prose, drafted
  project highlights, an anonymization leak check, and over-length page-fit
  advice. Every button says honestly whether content stays on this machine
  or leaves it; every result is a review-before-apply draft; and with no
  model configured the buttons simply hide — the copy-the-prompt-into-any-AI
  manual path always works.
- **Resume Views — targeted exports.** Curated subsets of the master CV:
  per-section detail levels (off / summary / tabulated / full), item
  exclusions and bulk selection, starred-only, custom intro, per-view styling
  (density, fonts, colors, dividers, bullets, section icons, custom
  headings, date formats, per-section sort and layout), **named templates**
  (compact technical / formal management / minimal one-pager), a configurable
  header/footer (localized contact fields, photo + logo placement), and a
  **live preview pane** with a page-count estimate. Export as **PDF**
  (one-click vector download), **DOCX** (lazy-loaded
  [`docx`](https://docx.js.org/)), or ATS-friendly **plain text / Markdown** —
  with every heading, month name and label a client reads localized in all
  15 offered languages.
- **Tailor a view to a job posting.** Paste the posting and either run it
  with your configured model in one click, or run the generated prompt in any
  LLM you trust and paste the JSON back — get a proposed view with detail
  levels, exclusions, a drafted intro, and a gap list.
- **Anonymized submissions.** A per-view toggle renders every project with
  its anonymized customer alias and redacts reference names to initials —
  for agency/broker submissions where client names must not leak.
- **Skill matrix.** A view section rendering skill × years × proficiency ×
  last-used (the competency-matrix format tenders ask for), derived from the
  skill registry and project history.
- **Rich content.** Limited rich text (bold/italic/underline/lists) in
  descriptions, uploaded profile photo with cropper, company logo, key
  competencies, recommendations.
- **Import.** CVpartner JSON, **LinkedIn data exports** (.zip), **Europass**
  (XML/JSON), portable JSON backups, an **AI-assisted import** from any
  PDF/Word CV, and a per-section **bulk add** that turns pasted source
  material into many items at once — both AI flows run with your configured
  model or as a bring-your-own-LLM copy/paste, no external service required.
  Imported skills are **normalized** to a curated skill library's canonical
  spellings so you don't accumulate near-duplicates.
- **Skill intelligence.** A local, dependency-free skill library (Quadim,
  Apache-2.0) powers canonical-name autocomplete, **related-skill suggestions**
  in the registry, and authoritative classifications in the skill-matrix export.
- **Shared registries with merge.** Skills, roles, **and industries** each live
  once and are referenced everywhere; "Merge this into…" consolidates
  duplicates ("Finance" / "finance") and rewrites every reference.
- **Career timeline.** The Overview draws your employments and projects as a
  timeline and flags gaps in your work history.
- **Global search.** Ctrl/Cmd+K opens a command palette that searches every
  section, registry and field, and jumps straight to the match.
- **Stay current.** An Overview "Needs attention" panel flags expired/expiring
  certifications and long-running "ongoing" entries; the picker badges resumes
  you haven't touched in a while.
- **Small-team attribution.** Optional named tokens
  (`RESUME_API_TOKENS=kari:…,ola:…`) stamp who saved what — shown on picker
  cards and in version history. No permissions model, just attribution.
- **Offline-tolerant persistence.** Auto-save (debounced ~1 s) to SQLite via
  Express, a per-resume localStorage queue that survives outages, reconnect
  draining, and optimistic concurrency with a keep-mine / discard-mine
  conflict dialog. Server-side **version history** (last 50 snapshots per
  resume) restorable from the header.
- **Editing comfort.** Undo/redo, drag-and-drop reordering everywhere (with
  keyboard fallback), skill/role registries with merge ("Løsningarkitekt" vs
  "Løsningsarkitekt" — pick one, the other is rewritten everywhere), usage
  breakdowns, and autocomplete linking.
- **Desktop build.** A portable folder with bundled Node — unzip,
  double-click, edit. System-tray icon, automatic updates from GitHub
  Releases, in-app Settings, and cross-computer sync via a JSON backup file
  in your existing cloud folder (Drive/Dropbox/OneDrive). See
  [DESKTOP.md](./DESKTOP.md).

---

## Architecture

```
React 18 + TypeScript + Vite
  ├── Zustand store (one resume in memory at a time)
  ├── Express + better-sqlite3 (multi-row `resumes` + per-resume `resume_snapshots`)
  └── localStorage offline queue (per-resume fallback + reconnect outbox)
```

Detailed conventions live in [CLAUDE.md](./CLAUDE.md) — read that before
making non-trivial changes.

### Layout
```
src/
├── types/       single source of truth for the data model
├── store/       Zustand store + undo/redo hook
├── lib/         pure logic: importer, exporter, viewFilter, backup, locales,
│                completeness, merge, localCache, api, sections, translateClient
├── components/  React UI (layout, ui primitives, per-section editors)
└── App.tsx      routes the active section to the right editor

server/          Express API + SQLite persistence (resume CRUD, snapshots,
                 translate proxy, settings, backup, updater) + desktop launcher
tests/           Vitest specs (see CI for the live count) — pure libs, store, every
                 React component (RTL), and server suites (db, auth, translate,
                 supertest routes)
```

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Concurrently runs Vite (5173) and Express (3001) |
| `npm run build` | Production client bundle to `dist/` |
| `npm run preview` | Serve `dist/` to verify the prod build |
| `npm start` | Production: serves `dist/` + API from one Express process |
| `npm test` | One-shot Vitest run |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | v8 coverage report (HTML in `coverage/`) |
| `npm run typecheck` | `tsc --noEmit` for both client and server |
| `npm run desktop` | Build the client and run the desktop launcher from source |
| `npm run build:desktop` | Assemble the portable desktop `release/` folder (per target OS) |
| `npm run dev:translate` | Start the bundled LibreTranslate Docker service (`translate:down` stops it) |

CI (`.github/workflows/ci.yml`) runs typecheck + test + build on every push
and PR.

---

## Configuration

`.env` (copy from `.env.example` — that file documents every variable in
detail; this is the overview). On the **desktop build** you don't edit `.env`
at all: the in-app Settings screen (gear icon on the picker) manages
translation, sync, and updates.

| Variable | Default | Meaning |
|---|---|---|
| `RESUME_API_TOKEN` | empty | Bearer token required by the API. Empty = auth disabled (local dev). |
| `PORT` | `3001` | Express listen port (the desktop launcher picks a free port itself). |
| `TRANSLATE_PROVIDER` | empty | Translation backend: `off` / `libretranslate` / `deepl` / `google` / `azure` / `llm` (`llm` reuses the AI-assist model below). Unset + `LIBRETRANSLATE_URL` set = `libretranslate` (back-compat). |
| `LIBRETRANSLATE_URL` / `LIBRETRANSLATE_API_KEY` | empty | Self-hosted LibreTranslate base URL + optional key. |
| `DEEPL_API_KEY` | empty | DeepL key (Free vs Pro auto-detected from the `:fx` suffix). |
| `GOOGLE_TRANSLATE_API_KEY` | empty | Google Cloud Translation v2 key. |
| `AZURE_TRANSLATOR_KEY` / `AZURE_TRANSLATOR_REGION` | empty | Azure Translator key + resource region. |
| `SUMMARIZE_PROVIDER` + `SUMMARIZE_MODEL` | empty | AI-assist backend: `off` / `ollama` / `openai` / `compat`, plus the chat model name. Powers Summarize, every "Run with my AI" button, and `TRANSLATE_PROVIDER=llm`. Per-provider URL/key vars in `.env.example`. |
| `RESUME_RATE_LIMIT_MAX` / `RESUME_RATE_LIMIT_WINDOW_MS` | `50` / `900000` | Failure-focused API rate limiter (only ≥400 responses count, so auto-save is never throttled). |
| `RESUME_DATA_DIR` | per-user OS folder | Desktop build: where the live SQLite DB + log live. |
| `RESUME_BACKUP_DIR` | empty | Desktop build: cloud-synced folder for the whole-store JSON backup (cross-computer sync). |
| `RESUME_BACKUP_INTERVAL_MS` | `60000` | Desktop build: backup refresh cadence. |
| `RESUME_DB_JOURNAL` | `WAL` | SQLite journal mode (`TRUNCATE` escape hatch if the DB must live in a synced folder). |

In dev/VPS mode the SQLite database lives at `data/resume.db` (gitignored):
one row per resume in `resumes`, plus per-resume snapshot history in
`resume_snapshots` (last 50 saves each, duplicates skipped). WAL mode is on.
The desktop build keeps the same schema in `RESUME_DATA_DIR` instead.

### Enabling draft translations (optional)

The "Draft translation" button needs a configured provider. The zero-key
option is a self-hosted [LibreTranslate](https://libretranslate.com/)
instance — a `docker-compose.yml` is bundled to run it alongside the app:

```bash
npm run dev:translate     # docker compose up -d libretranslate (first boot pulls models)
# then in .env:
#   LIBRETRANSLATE_URL=http://localhost:5000
npm run dev               # restart so the server reads the URL
npm run translate:down    # stop the service when you're done
```

By default it loads the `en, nb, sv, da` models (English +
Norwegian/Swedish/Danish) to stay light — each language is a few hundred MB —
and caches them in a named Docker volume; set `LT_LOAD_ONLY` to install a
different set. Key-based providers (DeepL, Google, Azure) are configured via
`TRANSLATE_PROVIDER` + the matching key instead, and `TRANSLATE_PROVIDER=llm`
translates with the AI-assist model — see `.env.example`. On the desktop
build, all of this lives in Settings, which can also start/stop the Docker
services and pick the installed languages for you.

Translation is entirely optional — without it, "Copy from primary" still works
and the Draft button stays hidden. CV text only travels browser → app server →
the provider you configured; there is no third-party middleman.

---

## Working with the codebase

See [CLAUDE.md](./CLAUDE.md) for:
- The data model and layered architecture
- Store patterns (`updateItem` / `moveItem` / `replaceData` / `loadStore`)
- The dual-language `DualField` invariant
- The Cartavio brand tokens used throughout the UI
- Testing conventions
- Future work and known quirks
