---
title: Download
---

# Download

Resume Studio is a portable, double-clickable folder — no installer, no admin
rights, no Node.js install needed. Unzip and run.

Builds are published as assets on the GitHub Releases page.

> **No release yet?** Until the first release is cut, the download links
> below 404. In the meantime you can [build from source](#build-from-source)
> on your own machine — it takes about a minute.

## Latest release

| Platform | File | How to launch |
|---|---|---|
| **Windows** (10 / 11, x64) | [ResumeStudio-windows-x64.zip]({{ site.repo_url }}/releases/latest/download/ResumeStudio-windows-x64.zip) | Unzip, then double-click **Resume Studio.cmd** (a small log window stays open). Use **Resume Studio (no window).vbs** for a silent launch. |
| **macOS** (Intel / Apple Silicon) | [ResumeStudio-macos.zip]({{ site.repo_url }}/releases/latest/download/ResumeStudio-macos.zip) | Unzip, then double-click **Resume Studio.command** in Finder. On first launch, right-click → Open to bypass Gatekeeper for unsigned apps. |
| **Linux** (x64) | [ResumeStudio-linux-x64.tar.gz]({{ site.repo_url }}/releases/latest/download/ResumeStudio-linux-x64.tar.gz) | Extract, then run **`./resume-studio.sh`** from a terminal. Optional: add a `.desktop` entry pointing at the absolute path of the script. |

Every download is a self-contained folder containing the bundled Node runtime,
the built app, and the launcher. There is nothing to install into your system.

Browse all releases at **[{{ site.repo_url }}/releases]({{ site.repo_url }}/releases)**.

## What you get

```
Resume Studio/
  node[.exe]                     ← the Node runtime (per-platform)
  Resume Studio.cmd              ← Windows launcher (with log window)
  Resume Studio (no window).vbs  ← Windows launcher (silent)
  resume-studio.sh               ← Linux/macOS launcher
  Resume Studio.command          ← macOS Finder-double-clickable
  README.txt                     ← end-user quick start
  app/                           ← the bundled server + React client
```

Your CVs and snapshot history live in a **private per-user folder** outside the
app folder, so you can move, replace, or delete the app without touching your
data:

| OS | Data folder |
|----|-------------|
| Windows | `%APPDATA%\ResumeStudio` |
| macOS | `~/Library/Application Support/ResumeStudio` |
| Linux | `$XDG_DATA_HOME/resume-studio` or `~/.local/share/resume-studio` |

The local server binds **loopback only** (`127.0.0.1`) — the app is never
exposed to your network.

## Build from source

If you'd rather build your own copy, or you're on a platform we don't ship a
binary for yet, all you need is Node.js 20+ and Git.

```bash
git clone {{ site.repo_url }}.git
cd resumestudio
npm install
npm run build:desktop
```

`npm run build:desktop` runs the client build and assembles a portable
`release/` folder identical in shape to the downloads above. The bundled
Node binary and the SQLite native addon are platform-specific, so **run the
build on the same OS you want to target** — there is no cross-compilation.

Want to try it without packaging?

```bash
npm run desktop
```

That builds the client and runs the launcher straight from source — useful for
a one-off try, or for the multi-CV sync flow described in the
[how-to](how-to.html#sync-cvs-across-computers).

## Self-host the server build

A second deployment mode runs Resume Studio as a small Node service (typically
on a VPS) instead of as a desktop app. See the
[README]({{ site.repo_url }}/blob/main/README.md) and
[DESKTOP.md]({{ site.repo_url }}/blob/main/DESKTOP.md) for the differences —
this site focuses on the desktop download.

---

Got it running? **[Open the how-to →](how-to.html)**
