# Resume Studio

A multi-language consultant resume manager. Maintain one master CV across
languages, then export targeted variants — PDF or Microsoft Word — for
different audiences.

Built for a single consultant; runs as a small self-hosted web app (React +
Express + SQLite) with offline-tolerant persistence.

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

### Editing
- **Dual-language side-by-side editing.** Every translatable field renders as
  two inputs at once — pick any two of your supported locales, swap with one
  click, hide the secondary column when you want focus.
- **Translation assist.** Each secondary input gets a **Copy** button (seed it
  from the primary text) and, if you point the server at a self-hosted
  [LibreTranslate](https://libretranslate.com/) instance, a **Draft** button
  that pre-fills a machine translation for you to review. Nothing leaves your
  deployment — the browser talks only to your own server, which proxies the
  request. Optional; off unless `LIBRETRANSLATE_URL` is set.
- **Re-detect languages.** A refresh button in the language switcher scans
  the content and adds any new locale it finds to your supported list.
- **Drag-and-drop reordering** on every section that has a sort order, with
  keyboard up/down buttons retained for accessibility.
- **Undo / Redo** (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) with debounced history.
- **Skill / role registry merge** — the "Løsningarkitekt" vs
  "Løsningsarkitekt" problem: pick one as the canonical entry, the other
  gets rewritten into it and removed.

### Persistence
- **Auto-save to a SQLite-backed Express server** (debounced 1 s).
- **localStorage fallback** so a server outage doesn't cost you work — your
  edits flush to the server the moment it returns.
- **Status visible in the header**: Saving / Saved / Save failed (with
  Retry) / Local only.
- **Version history** — every save is snapshotted on the server (the last 50,
  duplicates skipped). The header's **History** button lists them and restores
  any version in one click; a restore is itself undoable.
- **Portable JSON backup** — "Save to file" downloads a versioned backup;
  "Load file" restores from a backup *or* imports a CVpartner JSON export.

### Export
- **Resume Views** — curated subsets of the master CV. Pick which sections
  to include, exclude individual items, toggle "starred only", add a custom
  introduction, with a **live preview pane** that re-renders as you tune the
  view (and estimates the page count against your page limit).
- **PDF** via the browser's print pipeline.
- **DOCX** (.docx) via the [`docx`](https://docx.js.org/) library, lazy-loaded
  so it only downloads when you actually click Export.

### Import
- **CVpartner JSON** exports. The importer handles both shapes CVpartner
  emits (object + interleaved-array localized values), normalises `int` →
  `en`, scans content for locales the export under-declares, and links
  projects to work experiences through the source IDs.

---

## Architecture

```
React 18 + TypeScript + Vite
  ├── Zustand store (single source of in-memory state)
  ├── Express + better-sqlite3 (single-row resume_store table)
  └── localStorage cache (fallback)
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

server/          Express API + SQLite persistence (resume CRUD, snapshots, translate proxy)
tests/           Vitest specs (280 tests, all green) — incl. server suites (db, auth, translate, supertest routes)
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

CI (`.github/workflows/ci.yml`) runs typecheck + test + build on every push
and PR.

---

## Configuration

`.env` (copy from `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `RESUME_API_TOKEN` | empty | Bearer token required by the API. Empty = auth disabled (local dev). |
| `PORT` | `3001` | Express listen port. |
| `LIBRETRANSLATE_URL` | empty | Base URL of a self-hosted LibreTranslate instance. Empty = the Draft-translation button is hidden. |
| `LIBRETRANSLATE_API_KEY` | empty | API key, if your LibreTranslate instance requires one. |

The SQLite database lives at `data/resume.db` (gitignored), holding the single
resume row plus a `resume_snapshots` history table (last 50 saves). WAL mode is on.

### Enabling draft translations (optional)

The "Draft translation" button is powered by a self-hosted
[LibreTranslate](https://libretranslate.com/) instance. A `docker-compose.yml`
is bundled to run it alongside the app:

```bash
npm run dev:translate     # docker compose up -d libretranslate (first boot pulls models)
# then in .env:
#   LIBRETRANSLATE_URL=http://localhost:5000
npm run dev               # restart so the server reads the URL
npm run translate:down    # stop the service when you're done
```

It loads only the `en, nb, sv, da` models (English + Norwegian/Swedish/Danish)
to stay light, and caches them in a named Docker volume. Translation is
entirely optional — without it, "Copy from primary" still works and the Draft
button stays hidden. CV text only travels browser → app server → this
container; nothing leaves the host.

---

## Working with the codebase

See [CLAUDE.md](./CLAUDE.md) for:
- The data model and layered architecture
- Store patterns (`updateItem` / `moveItem` / `replaceData` / `loadStore`)
- The dual-language `DualField` invariant
- The Cartavio brand tokens used throughout the UI
- Testing conventions
- Future work and known quirks
