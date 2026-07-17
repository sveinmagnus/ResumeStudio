# Resume Studio — Desktop build & cross-computer sync

This is the downloadable, self-deployable build: a double-clickable launcher
that starts the app locally and opens it in your browser, with your data stored
privately on your machine and an optional one-folder backup that syncs across
computers via Google Drive / Dropbox / OneDrive.

It is the **same** Express + SQLite + React app as the server build — just
packaged so a non-technical user can run it without installing Node, and wired
to keep data in a stable per-user location with a safe sync story. The
architecture is unchanged, so a future move to Electron is repackaging, not a
rewrite (see CLAUDE.md §1 / the desktop notes there).

---

## 1. Building the portable folder

```
npm install
npm run build:desktop
```

This runs the client build and then `scripts/build-desktop.mjs`, producing a
self-contained `release/` folder:

```
release/
  node[.exe]                     ← the Node runtime (copied from your machine)
  Resume Studio.cmd              ← Windows launcher (shows a status/log window)
  Resume Studio (no window).vbs  ← Windows launcher, no console window
  resume-studio.sh               ← Linux/macOS launcher
  Resume Studio.command          ← macOS Finder-double-clickable (macOS builds)
  README.txt                     ← end-user quick start
  app/
    launcher.cjs                 ← the whole server, bundled by esbuild
    dist/                        ← the built React client
    node_modules/                ← only better-sqlite3 + its native deps
```

Zip `release/`, hand it to a user, and they unzip + double-click. No install.

> **Build on each target OS.** The bundled Node binary and better-sqlite3's
> compiled `.node` addon are platform-specific. Run `npm run build:desktop` on
> Windows to make the Windows build, on Linux for Linux, on macOS for macOS.
> There is no cross-compilation step.

### Quick local run (no packaging)

```
npm run desktop
```

Builds the client and runs the launcher straight from the source via `tsx` —
handy for trying the desktop boot/sync behavior without assembling `release/`.

---

## 2. Launching & stopping

Double-click the launcher. A small window appears showing startup logs and the
URL, your browser opens the app automatically, and a **Resume Studio icon
appears in the system tray** (notification area).

**To stop the app, use the tray icon** — right-click it and choose **Quit Resume
Studio**. The tray menu also has **Open Resume Studio**, which reopens the app in
your browser (handy after you've closed the tab).

> Why the tray, and not a button in the web page? Closing the browser tab does
> **not** stop the app — the little local server keeps running. And quitting from
> inside the web UI would be confusing: any other open tab would then start
> erroring. The tray lives outside the page, so Quit is unambiguous. Quitting
> from the tray runs a clean shutdown (final backup written, database closed
> safely).

Other ways to stop, if you prefer: **close the launcher window**, or press
**Ctrl-C** in it — both do the same clean shutdown. (The `.vbs` "no window"
launcher has no window to close, which is exactly why the tray Quit exists.)

If the tray icon doesn't appear (e.g. a minimal Linux desktop with no system
tray, or Docker-style headless box), the app still runs — just use the window /
Ctrl-C to stop it. The log notes when the tray is unavailable.

To make a Start-menu / desktop shortcut, create a normal OS shortcut pointing at
the launcher file. (On Linux you can write a `~/.local/share/applications/
resume-studio.desktop` entry whose `Exec=` is the absolute path to
`resume-studio.sh`.)

The launcher picks the first free port starting at 3001, so multiple things on
3001 won't collide, and writes the chosen URL into the window + log.

---

## 3. Where your data lives

The live SQLite database and a log file live in a **private per-user folder**,
deliberately *outside* the `release/` folder so you can move, replace, or delete
the app folder without touching your data:

| OS | Data folder |
|----|-------------|
| Windows | `%APPDATA%\ResumeStudio` |
| macOS | `~/Library/Application Support/ResumeStudio` |
| Linux | `$XDG_DATA_HOME/resume-studio` or `~/.local/share/resume-studio` |

Override with `RESUME_DATA_DIR` if you want it elsewhere.

The database keeps full snapshot history per resume (the in-app **History**
button), so accidental edits are recoverable independently of backups.

---

## 4. Settings

Click the **gear icon** (top-right of the resume picker) to open Settings. This
is where a desktop user turns features on or off — no shell variables, no
editing the launcher. It is one form with one **Save**; the tabs just organize
it. Changes land in `settings.json` in the data folder (§3) and take effect
immediately.

- **Version** — the installed version, **Check for updates**, and **Install
  update** (see §6).
- **Translation** (the "Draft translation" button on the second language) —
  pick a provider:
  - **Off** (default) — no machine translation. "Copy from primary" still works.
  - **LibreTranslate — local (Docker-managed)** — the app runs a LibreTranslate
    container for you via Docker. Requires **Docker Desktop** installed and
    running. You **choose which languages to install** (each is a
    few-hundred-MB download, so the first start takes minutes; English is
    always included — the engine pivots through it). Use **Start / Stop /
    Check status**, then **Save** to auto-start it on every launch. Nothing
    leaves your machine.
  - **LibreTranslate — remote URL** — an instance you host elsewhere, with an
    optional API key.
  - **DeepL** — paste a DeepL API key. Free and Pro keys both work
    (auto-detected from the `:fx` suffix). Best quality for
    Norwegian/Swedish/Danish.
  - **Google Cloud Translation** — paste an API key.
  - **Microsoft Azure Translator** — paste the key and its **region** (e.g.
    `westeurope`).
  - **Use the AI model from Summarize** — no config at all: translation drafts
    run on whatever model the AI assist tab configures.
  - For any provider except "off", **Test connection** drafts one short phrase
    to confirm the key/URL works. CV text only ever travels browser → this
    app → the chosen provider.
- **AI assist** — the model behind Summarize, every "Run with my AI" button,
  and (optionally) translation:
  - **Ollama — local (Docker-managed)** — the app runs an Ollama container and
    pulls your chosen model for you (Docker Desktop required; models are
    GB-scale downloads). Content never leaves your machine.
  - **Ollama — remote URL**, **OpenAI** (API key), or **any OpenAI-compatible
    endpoint** (URL + optional key — LM Studio, Groq, OpenRouter, …).
  - The **model** field offers a curated shortlist of open-weight models plus
    whatever your Ollama instance has already pulled (**Refresh** re-probes),
    and stays free-text so any tag works. **Test** runs one tiny summary.
  - Every AI button in the app states whether content stays on this computer
    or is sent to the configured provider, based on where the endpoint
    actually is.
- **Sync & backup** — the cloud-synced folder described in §5.
- **Appearance** — the app-wide default heading/body fonts that views with
  fonts set to "inherit" pick up.

> On a server (VPS) deployment the gear shows a read-only view instead: there,
> these are controlled by environment variables, not the app.

## 5. Backup & sync across computers

This is the recommended way to use one set of CVs on several machines.

**How it works.** In **Settings → Backup & sync folder**, set a cloud-synced
folder (Google Drive / Dropbox / OneDrive). Resume Studio then keeps a single
JSON file, `resume-studio-backup.json`, in that folder containing **all** your
resumes. It is written atomically (so the sync client never sees a half file):

- once at startup,
- whenever the store changes while running (about once a minute, only if
  something actually changed — no idle churn),
- once on a clean shutdown,
- and on demand from the picker's **Sync & backup** panel ("Back up now").

On every launch, Resume Studio also **merges in** anything newer from that file.
So the typical flow is:

1. On computer A, open **Settings** and set the backup folder to e.g.
   `…/Google Drive/ResumeStudio`, then use the app normally.
2. On computer B, set the **same** synced folder in Settings and relaunch (or
   click **Restore from folder** in the picker's Sync panel). B pulls A's
   resumes in automatically (the log shows `sync-in: +N new`).

**Merge rules (safe by design).** Merging is *newest-wins per resume*, keyed on
each resume's last-saved time, and a union across machines:

- A resume that's newer in the backup replaces the local copy.
- A resume you don't have yet is added.
- A resume that's newer locally is kept.
- **Nothing is ever deleted** by a normal restore. (A restore also drops a
  snapshot first, so you can undo it from History.)

This means it's last-writer-wins if you edit the *same* resume on two machines
without syncing in between — fine for a single person hopping between computers,
but it is not a real-time multi-writer collaboration system.

### Why not just put the database in Google Drive?

Because a live SQLite file (plus its `-wal`/`-shm` sidecars) inside a cloud-sync
folder is a known corruption trap: the sync client uploads the pieces at
inconsistent moments and two machines can clobber each other. The JSON backup
sidesteps that entirely — only a plain, atomically-written file syncs, and the
merge is deterministic. (If you really want the live DB in a synced folder
anyway, set `RESUME_DB_JOURNAL=TRUNCATE` so no WAL sidecars are left around —
but the JSON-backup route above is strongly preferred.)

### Manual / portable backups

Independent of the sync folder, the in-editor **Export backup** button still
downloads a single resume's portable JSON, and **History** keeps server-side
snapshots. The sync folder backup is the *whole store*; the export button is
*one resume*.

---

## 6. Automatic updates

Resume Studio keeps itself current from its **GitHub Releases**, with no
installer and no app store — the same self-contained portable folder, swapped in
place.

**How it checks.** The app checks for a newer release **once shortly after
launch and then daily**, and you can check on demand. The tray menu shows the
**installed version** in its header, then:

- **System tray** — right-click the Resume Studio tray icon. **"Check for
  updates"** is always available; click it to check now (a native popup reports
  "you're on the latest version" if there's nothing new). **"Install update"**
  sits below it and is greyed out until an update is ready.
- **When an update is found** (by the manual or the daily check) a pop-up
  appears — *"New version X available"* with **Install** / **Cancel**. Cancel
  just dismisses it; the update stays available via the tray's **Install update**
  item and the in-app banner.
- **In the app** — the resume picker shows an **"Update available"** banner with
  an **Install update** button (and a *Release notes* link); **Settings →
  Version** shows your current version with a **Check for updates** button; and
  the picker footer always shows the installed version.

**How it installs.** Click **Install** (the pop-up), or **Install update** (tray
or banner). The app downloads the new build for your OS, then a small **updater
window opens and shows a progress bar** while it swaps the files and restarts
onto the new version. Your data is untouched — it lives in the per-user folder
(§3), not inside the app folder that gets replaced.

**Cross-platform, by design.** This works on Windows, macOS and Linux without
Electron. Because a running program can't overwrite its own files (especially
the Node binary on Windows, which is locked while running), the install hands
off to a tiny helper script (a visible PowerShell window on Windows) that waits
for the app to exit, copies the new files with a progress bar, and relaunches.
On Windows the relaunch uses the **no-window launcher** (`Resume Studio
(no window).vbs`), so after an update the app runs without a console window —
exactly as if you had started it windowless yourself; quit it from the tray
icon as usual. The downloaded asset is a `.tar.gz` (extracted with the system
`tar`, present on Windows 10+/macOS/Linux).

> The desktop build is **not code-signed**. The updater swaps files inside the
> app folder you already trust and relaunches directly, which avoids the
> first-run Gatekeeper/SmartScreen prompts — but if your OS still warns, that's
> why. Updates are a desktop-only feature: a server (VPS) deployment never
> self-updates (it reports "not supported").

**Turning it off.** Set `RESUME_NO_UPDATE=1` before launching to disable the
background check and the install action entirely.

---

## 7. Configuration reference

Most users never touch these — **Settings** (§4) covers translation and the sync
folder, with everything else defaulted. These env vars are an advanced/override
layer (set them in the shell or the launcher shim before launching). On the
desktop build, `settings.json` is authoritative: it's seeded from these on the
first run, then overrides them.

| Variable | Purpose | Default |
|----------|---------|---------|
| `RESUME_DATA_DIR` | Where the live DB + log live | per-user OS folder (§3) |
| `RESUME_BACKUP_DIR` | Cloud-synced folder for the store backup (usually set via Settings) | unset (sync off) |
| `RESUME_BACKUP_INTERVAL_MS` | How often to refresh the backup when changed | `60000` |
| `LIBRETRANSLATE_URL` | LibreTranslate base URL (usually set via Settings) | unset (translate off) |
| `LIBRETRANSLATE_API_KEY` | Optional LibreTranslate key | unset |
| `SUMMARIZE_PROVIDER` / `SUMMARIZE_MODEL` (+ per-provider URL/key vars) | AI-assist backend seed values (usually set via Settings → AI assist; see `.env.example`) | unset (AI assist off) |
| `RESUME_DB_PATH` | Exact DB file (overrides data-dir derivation) | `<dataDir>/resume.db` |
| `RESUME_DB_JOURNAL` | SQLite journal mode | `WAL` |
| `RESUME_CLIENT_DIR` | Where the built client lives | set by the launcher shim |
| `RESUME_COMPOSE_FILE` | docker-compose file for managed translate | set by the launcher shim |
| `PORT` | Preferred port (auto-advances if taken) | `3001` |
| `RESUME_NO_BROWSER` | Don't auto-open a browser (headless/CI) | unset |
| `RESUME_API_TOKEN` | Require a bearer token (not needed for loopback-only) | unset |
| `RESUME_NO_UPDATE` | Disable the auto-updater (background check + install) | unset (updates on) |
| `RESUME_UPDATE_REPO` | GitHub `owner/repo` to check for releases | `sveinmagnus/resumestudio` |
| `RESUME_INSTALL_DIR` | The portable build root to swap on update (set by the shim) | derived from `RESUME_CLIENT_DIR` |
| `RESUME_APP_VERSION` | The running version. Baked into the shim at build time — from the **git tag** in a CI release (which must match `package.json`), or `package.json` for a local `build:desktop`/`tsx` run | from `package.json` |

The server binds **loopback only** (`127.0.0.1`), so the app is never exposed to
your local network.

---

## 8. Troubleshooting

- **Nothing opened in the browser.** The window/log prints the URL — open it
  manually. Pop-up/launch blockers can stop the auto-open.
- **Where are the logs?** `resume-studio.log` in the data folder (§3).
- **"Restore from folder" is greyed out.** No backup file exists in the sync
  folder yet — click **Back up now** on the first machine first (or let it run a
  minute), and make sure the cloud client has finished syncing the file down to
  this machine.
- **Moved the app and lost data?** You didn't — data is in the per-user folder
  (§3), not in `release/`. Set the same backup folder in Settings on the new copy
  if you also want the synced backup.
- **Translate "Draft" button missing.** Open **Settings** and choose Local
  (Docker) or Remote URL, then **Save**. With the local option, the container's
  first run downloads models — until that finishes, **Check status** / **Test
  connection** report "not reachable" and drafts will fail.
- **Docker option says "not available".** Install Docker Desktop and make sure
  it's running, or use a Remote URL instead.
- **"Check for updates" never finds anything / the install didn't restart.**
  The check needs internet access to GitHub. The install replaces the app folder
  and relaunches a few seconds after the app exits — if your browser tab errored
  briefly, reopen it from the tray's **Open Resume Studio**. The update log lines
  are in `resume-studio.log` (§3). If an anti-virus blocks the swap helper
  script, download the new release manually instead. Set `RESUME_NO_UPDATE=1` to
  turn the feature off.
