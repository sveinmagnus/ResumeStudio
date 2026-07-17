---
title: How to use Resume Studio
---

# How to use Resume Studio

A walkthrough of the things you'll do in your first hour, then the day-to-day
tasks once you're set up. If you haven't installed it yet, head to the
[download page](download.html) first.

## Contents

- [First launch](#first-launch)
- [Add your first CV](#add-your-first-cv)
- [Edit in two languages](#edit-in-two-languages)
- [Build a Resume View](#build-a-resume-view)
- [Export to PDF or Word](#export-to-pdf-or-word)
- [Snapshot history & undo](#snapshot-history--undo)
- [Translation assist](#translation-assist)
- [AI assist](#ai-assist)
- [Sync CVs across computers](#sync-cvs-across-computers)
- [Backups](#backups)
- [Stopping & uninstalling](#stopping--uninstalling)
- [Troubleshooting](#troubleshooting)

---

## First launch

Double-click the launcher for your platform (see the [download page](download.html)
if you're not sure which file). A small log window opens, the app picks a free
port starting at 3001, your browser opens automatically to the home screen,
and a **Resume Studio icon appears in the system tray**.

That home screen is the **picker** — your list of CVs. It starts empty.

Stop the app at any time from the **tray icon → Quit Resume Studio** (closing
the browser tab does not stop it). Closing the launcher window or pressing
**Ctrl-C** in it works too; the tray is the way to quit the no-window `.vbs`
launcher.

## Add your first CV

Two ways to start, both from the picker:

1. **Start fresh** — opens an empty CV with a name you pick. Add sections as
   you go.
2. **Import** — bring an existing CV in:
   - a **CVpartner** JSON export (languages your export under-declared are
     detected from the content),
   - a **LinkedIn** data-export `.zip`,
   - a **Europass** XML or JSON file,
   - a Resume Studio **backup** file (`.json`), or
   - **any PDF / Word CV via AI import** — paste the text, run it with your
     configured model (or any LLM you trust, manually), and preview the
     result before it becomes a resume.

Each CV gets its own URL, so you can keep multiple master CVs (one per line of
business, joint venture, or career chapter) side by side. Use the picker — or
the resume dropdown in the editor header — to switch between them.

## Edit in two languages

The big idea: **every translatable field shows both languages on screen at
once.** No tabs, no toggling. The primary language is on the left, the
secondary on the right with a soft cyan tint.

From the header's **language switcher** you can:

- Pick which language is primary and which is secondary.
- Swap them with one click.
- Hide the secondary column when you want to focus on one language.
- Click the refresh icon to **re-detect languages** in your content (handy
  after import, in case your file had locales the metadata didn't list).

The two columns are independent — typing in the secondary input never touches
the primary, and vice versa.

> **Tip:** the **Overview** section shows your translation completeness as a
> percentage per language, plus exactly which fields are missing.

## Build a Resume View

A **Resume View** is a curated subset of your master CV with its own intro,
styling, and section choices — that's what you actually send to a client.

1. Open **Resume Views** from the sidebar and add a new view.
2. Give it a name, a custom **introduction**, and (optionally) a page limit.
3. Tick the **sections** to include and drag them into the order you want.
4. For each included section, pick a **detail level** — *Off*, *Summary*
   (one line per item, optionally as aligned *tabulated* columns), or *Full*.
5. Exclude individual items you don't want in this view (e.g. early-career
   roles for a senior position).
6. Toggle **starred only** if the view should show only your starred
   projects/skills/etc.
7. Tune the **styling** (density, font, accent color, margins, tag style) and
   the **header/footer** (which contact fields, labels, separators, photo and
   logo placement, footer note) — these live on the view, not the master CV.

The **live preview pane** re-renders as you tune the view, and shows a
page-count estimate against your page limit, so you can dial it in without
exporting first. A one-click **template** (compact technical, formal
management, minimal one-pager) is the fastest starting point — apply one,
then adjust.

## Export to PDF or Word

From inside the Resume View editor, pick the **export language**, then:

- **Export PDF** — downloads a `.pdf` in one click. No print dialog, no
  pop-ups.
- **Export DOCX** — downloads a `.docx` file. The first export fetches the
  word-export library (~350 kB, cached afterward), so the very first click can
  feel a touch slower.
- **Export text / Markdown** — ATS-friendly plain formats for application
  portals that mangle rich documents.

Every export respects your view's section list, detail levels, exclusions,
styling, and header/footer — and all document labels (headings, months,
"Present", contact labels) come out in the export language.

## Snapshot history & undo

Resume Studio saves snapshots of your CV on every save (deduplicated, last 50
kept per CV). The **History** button in the header opens the list — pick any
entry, preview it, and restore it in one click.

- A restore is itself a saved mutation, so you can undo it (Ctrl/Cmd+Z) if it
  wasn't what you wanted.
- Snapshots are per-CV, so restoring one CV never touches another.

Beyond snapshots, the editor has **undo / redo** with debounced history:

- **Ctrl/Cmd+Z** — undo
- **Ctrl/Cmd+Shift+Z** — redo

Or use the arrow buttons in the header.

## Translation assist

When you start filling in the secondary language, two buttons appear next to
each field:

- **Copy from primary** — duplicates the primary value into the secondary
  field. No network, no provider needed. A good starting point if you'll
  edit the wording yourself.
- **Draft translation** — appears only when a translation provider is
  configured. Sends the field's primary value to your chosen provider and
  pre-fills the result. The draft is always flagged as **review-required**;
  editing the field clears the flag.

To turn on **Draft translation**, click the **gear icon** in the picker to
open **Settings**, then pick a provider:

| Provider | What you need | Notes |
|---|---|---|
| **LibreTranslate — local (Docker)** | Docker Desktop installed | You pick which languages to install (each a few-hundred-MB download on first start). Use Start / Stop / Check status. Fully self-hosted. |
| **LibreTranslate — remote URL** | The URL of a LibreTranslate instance you host | Optional API key. |
| **DeepL** | A DeepL API key | Free and Pro keys both work. Best quality for Norwegian/Swedish/Danish. |
| **Google Cloud Translation** | A Google Cloud API key | |
| **Microsoft Azure Translator** | The key + a region (e.g. `westeurope`) | |
| **Use the AI model from Summarize** | An AI assist backend (next section) | Zero extra config — drafts run on that model. |

After saving, **Test connection** drafts one short phrase to confirm the
configuration works.

CV text only ever travels from your browser through the app to the provider
you chose — there is no Resume Studio backend in the loop.

## AI assist

The AI features — one-line summaries, "Summarize all empty", job-posting
tailoring, AI import, bulk add, skill suggestions, drafted highlights, the
anonymization check, and page-fit advice — all run on **one model you
configure** in **Settings → AI assist**:

- **Local Ollama (Docker-managed)** — the app starts the container and pulls
  your chosen model for you. Your CV never leaves the computer; the buttons
  say so.
- **Remote Ollama, OpenAI, or any OpenAI-compatible endpoint** — paste a URL
  and/or key. The buttons then say content is sent to that provider, and
  whole-CV tasks confirm once per session before the first send.

Pick a model (the field suggests a curated shortlist plus whatever your
Ollama has already pulled), hit **Test**, and Save. Every AI result is a
draft you review before it touches your CV.

No model configured? Every AI feature still works manually: copy the
generated prompt into whatever AI you already use and paste the answer back.
Nothing is ever sent by the app itself on that path.

## Sync CVs across computers

If you want the same set of CVs on more than one machine, use the backup
folder feature. **This is not real-time collaboration** — it's a sync for one
person hopping between computers.

1. On computer A, open **Settings → Backup & sync folder** and paste in a
   folder inside your cloud sync client (Google Drive, Dropbox, OneDrive).
   Save.
2. Use the app normally. Resume Studio writes a single
   `resume-studio-backup.json` in that folder, atomically, whenever your CVs
   change (about once a minute, only if something actually changed).
3. On computer B, set the **same** folder in Settings and relaunch — or click
   **Restore from folder** in the picker's **Sync & backup** panel. B pulls
   in A's CVs automatically.

**Merge rules** (safe by design):

- A CV that's newer in the backup replaces the local copy.
- A CV that's only in the backup is added.
- A CV that's only local stays.
- **Nothing is ever deleted** by a normal restore, and a restore drops a
  snapshot first so it's reversible from History.

If you edit the *same* CV on two machines without syncing in between, the last
one to sync wins. (The in-app **Conflict** modal protects you on a single
machine across browser tabs, but it can't see edits that haven't been written
to the shared folder yet.)

## Backups

Two independent backup mechanisms; use whichever fits the situation:

- **Per-CV export** (from the editor's header) — downloads a single `.json`
  file for the active CV. Versioned and portable. Loading it from the picker
  creates a new CV rather than overwriting one.
- **Whole-store sync backup** (Settings → Backup & sync folder) — the JSON
  file in your cloud-sync folder, described above. Holds every CV in the app.

And, server-side, every save is snapshotted automatically (last 50 per CV).

## Stopping & uninstalling

- **Stop the app** — tray icon → **Quit Resume Studio** (or close the
  launcher window / Ctrl-C in it).
- **Move the app** — drag the folder anywhere. Your data is in the per-user
  folder (see the [download page](download.html#what-you-get)), not in the
  app folder.
- **Uninstall** — delete the app folder. Delete the per-user data folder
  separately if you also want to remove your CVs.

## Troubleshooting

- **The browser didn't open.** The launcher window prints the URL — open it
  manually. Some pop-up / launch blockers prevent the auto-open.
- **Where are the logs?** `resume-studio.log` in the per-user data folder.
- **"Draft translation" button is missing.** Open **Settings**, pick a
  provider, and save. With the Docker option, models download on first
  launch — until that finishes, drafts will fail and **Test connection**
  reports "not reachable".
- **AI buttons are missing.** No model is configured — set one up in
  **Settings → AI assist** (or use each feature's manual copy/paste path,
  which is always there).
- **"Restore from folder" is greyed out.** No backup file exists in the sync
  folder yet — click **Back up now** on the first machine first, and wait for
  your cloud client to sync the file across.
- **Conflict modal popped up.** That CV was edited somewhere else (another
  browser tab, or another machine that synced first). The modal shows what
  changed and lets you **keep mine** (re-save your version on top) or
  **discard mine** (take the other side).
- **Port 3001 is busy.** The launcher tries 3001 first, then climbs until it
  finds a free port. Check the launcher window for the actual URL.

If something else goes wrong, **[file an issue]({{ site.repo_url }}/issues)** —
include the contents of `resume-studio.log` and your OS.

---

That's the tour. **[Head back to the home page →](index.html)**
