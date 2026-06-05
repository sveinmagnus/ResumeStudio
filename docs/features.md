---
title: Features
---

# Features

A tour of what Resume Studio does today. Most of these are visible the moment
you open the app — nothing here is buried behind config files.

## Editing

- **Dual-language side-by-side editing.** Every translatable field renders as
  two inputs at once. Pick any two of your supported locales as primary and
  secondary, swap them with one click, or hide the secondary column when you
  want to focus.
- **Translation assist on every field.** Each secondary input has a **Copy
  from primary** button (no network) and, when a translation provider is
  configured, a **Draft translation** button that pre-fills a machine
  translation for you to review. Drafts are always flagged as review-required.
- **Multiple translation providers.** LibreTranslate (Docker-managed local
  instance, or a remote URL you host), DeepL, Google Cloud Translation, or
  Microsoft Azure Translator. Switch between them from Settings.
- **Re-detect languages.** A refresh button in the language switcher scans
  your content and adds any locale it finds to your supported list — handy
  after importing a CV.
- **Rich text where it matters.** Project and role descriptions support
  bold, italic, underline, and bullet/numbered lists.
- **Profile photo and company logo.** Uploaded, downscaled in-browser,
  embedded in exports.
- **Drag-and-drop reordering** on every section, with keyboard up/down
  buttons retained for accessibility.
- **Undo / Redo** with debounced history (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z).
- **Skill / role registry merge.** The "Løsningarkitekt" vs
  "Løsningsarkitekt" problem: pick one as canonical, the other gets rewritten
  everywhere it's referenced and removed.

## Multi-resume

- **One app, many master CVs.** Keep separate CVs for different lines of
  work, joint ventures, or career chapters. The picker is the home screen;
  each CV has its own URL, history, and supported languages.
- **Per-resume language pair.** Each CV remembers which two languages you
  were last editing in.

## Resume Views — targeted exports

- **Curated subsets of the master CV.** A view names a set of sections to
  include, items to exclude, a starred-only toggle, and a custom intro.
- **Per-section detail levels.** Each section can be Off, Summary, or Full —
  so a one-pager and a deep technical CV share the same source data.
- **Per-view styling.** Density, body size, heading font, accent color, page
  margin, tag style — all stored on the view, not the master CV.
- **Configurable header and footer.** Choose which contact fields appear,
  the labels and separators, name/title type size, photo and logo placement,
  and a footer note.
- **Live preview pane.** The document re-renders as you tune the view, with a
  page-count estimate against your page limit.
- **Promoted Projects** as a synthetic section — surface your starred
  projects without restructuring the master.

## Export

- **PDF** via the browser's print pipeline — uses the system's native
  Save-as-PDF, so the result matches what you see in the preview.
- **DOCX** (`.docx`) via the [`docx`](https://docx.js.org/) library, lazy-
  loaded so the bundle only grows when you actually export.

## Import & backup

- **CVpartner JSON import.** The importer handles both shapes CVpartner
  emits (object and interleaved-array localized values), normalises `int` →
  `en`, scans content for under-declared locales, and links projects to work
  experiences through the source IDs.
- **Portable JSON backup.** Per-resume export from the editor; versioned
  format with a migration scaffold so older backups keep loading.
- **Server-side snapshot history.** Every save is snapshotted (last 50 per
  resume, duplicates skipped). The header's **History** button restores any
  version — and the restore itself is undoable.

## Persistence & offline tolerance

- **Auto-save** to a local SQLite database (debounced ~1 s).
- **localStorage fallback** per resume, so a momentary outage never costs
  work. Edits flush the moment the server returns.
- **Status visible in the header** — Saving / Saved / Offline / Queued /
  Conflict, with a count of any resumes still waiting to sync.
- **Optimistic concurrency.** If two devices race on the same resume, the
  loser sees a non-blocking **Conflict** modal with a labelled diff and a
  keep-mine / discard-mine choice.

## Cross-computer sync (desktop)

- **Backup folder in your existing cloud sync** (Google Drive, Dropbox,
  OneDrive). Resume Studio writes a single JSON file there, atomically, and
  merges newer content from it on every launch.
- **Newest-wins per resume, never deletes.** Safe by design — a restore
  drops a snapshot first, so it's reversible from History.
- **No real-time multi-writer.** Designed for one person hopping between
  computers, not for two people editing the same CV at once.

## Privacy & security posture

- **Your CV never leaves your machine** unless you turn translation on, in
  which case the chosen provider sees only the text fragments you draft.
- **No account, no telemetry, no analytics.**
- **Loopback-only on desktop.** The local server binds `127.0.0.1` — the app
  is never exposed to your network.
- **Auth-gated when self-hosted.** Server deployments require a bearer token;
  the browser exchanges it for an HttpOnly session cookie so the token never
  lives in JavaScript-readable storage.
- **Content sanitised at the render boundary.** Rich text, view styling, and
  imported view configs are sanitised before they reach the export or preview
  pipelines.

---

Ready to try it? [Head to the downloads.](download.html)
