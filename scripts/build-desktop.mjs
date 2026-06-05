/**
 * Assemble the portable desktop build.
 *
 * Produces a self-contained `release/` folder that a user can copy anywhere and
 * launch by double-clicking a shim — no Node install required:
 *
 *   release/
 *     node[.exe]                 ← the Node runtime (copied from THIS machine)
 *     Resume Studio.(cmd|sh|...) ← double-clickable launcher shim(s)
 *     app/
 *       launcher.cjs             ← the whole server, bundled by esbuild
 *       dist/                    ← the built React client
 *       node_modules/            ← only the native deps esbuild can't bundle
 *
 * IMPORTANT: the Node binary and better-sqlite3's compiled `.node` are
 * platform-specific, so run this ON EACH target OS (Windows build on Windows,
 * Linux build on Linux, …). Run `npm run build:desktop` (which builds the
 * client first, then this script).
 *
 * Plain ESM, run directly by Node — no TS, no bundling of itself.
 */

import esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = path.join(root, 'release')
const appDir = path.join(release, 'app')
const isWin = process.platform === 'win32'

const log = (m) => console.log(`[build-desktop] ${m}`)

// ── 0. Preconditions ────────────────────────────────────────────────────────
const distSrc = path.join(root, 'dist')
if (!fs.existsSync(path.join(distSrc, 'index.html'))) {
  console.error('[build-desktop] dist/ is missing — run `npm run build` first ' +
    '(or use `npm run build:desktop`, which does it for you).')
  process.exit(1)
}

// ── 1. Clean ────────────────────────────────────────────────────────────────
fs.rmSync(release, { recursive: true, force: true })
fs.mkdirSync(appDir, { recursive: true })

// ── 2. Bundle the server (+ launcher) into one CJS file ─────────────────────
// better-sqlite3 is a native addon esbuild can't inline; keep it external and
// ship its package subtree under app/node_modules so the bundle's
// `require('better-sqlite3')` resolves at runtime.
log('bundling server with esbuild …')
await esbuild.build({
  entryPoints: [path.join(root, 'server', 'desktop', 'launcher.ts')],
  outfile: path.join(appDir, 'launcher.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['better-sqlite3'],
  legalComments: 'none',
  logLevel: 'warning',
  // app.ts / db.ts read import.meta.url for their __dirname, but only use it for
  // fallbacks the launcher overrides via env. We guard the "" case explicitly
  // (see those files), so this expected warning is just noise here.
  logOverride: { 'empty-import-meta': 'silent' },
})

// ── 3. Copy the built client ────────────────────────────────────────────────
log('copying client (dist/) …')
fs.cpSync(distSrc, path.join(appDir, 'dist'), { recursive: true })

// ── 4. Copy the native runtime deps esbuild left external ───────────────────
// Runtime closure of better-sqlite3: itself + bindings + file-uri-to-path.
// (prebuild-install is install-time only, so it's intentionally omitted.)
const nativeDeps = ['better-sqlite3', 'bindings', 'file-uri-to-path']
const nmOut = path.join(appDir, 'node_modules')
for (const dep of nativeDeps) {
  const src = path.join(root, 'node_modules', dep)
  if (!fs.existsSync(src)) {
    if (dep === 'better-sqlite3') {
      console.error(`[build-desktop] required dependency ${dep} not found — run npm install`)
      process.exit(1)
    }
    log(`(optional dep ${dep} absent — skipping)`)
    continue
  }
  fs.cpSync(src, path.join(nmOut, dep), { recursive: true, dereference: true })
}
// Sanity-check the compiled native binary made it across.
const nodeAddon = path.join(nmOut, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
if (!fs.existsSync(nodeAddon)) {
  console.error('[build-desktop] WARNING: better_sqlite3.node not found in the copied ' +
    'package. The build may not run. Was better-sqlite3 compiled (npm install)?')
}

// ── 5. Copy the Node runtime ────────────────────────────────────────────────
log('copying Node runtime …')
const nodeOut = path.join(release, isWin ? 'node.exe' : 'node')
fs.copyFileSync(process.execPath, nodeOut)
if (!isWin) fs.chmodSync(nodeOut, 0o755)

// ── 5b. Copy the docker-compose file (managed-translate feature) ────────────
// Lets a user enable Docker-managed LibreTranslate from the in-app Settings
// screen. Harmless if they never use it / don't have Docker.
const composeSrc = path.join(root, 'docker-compose.yml')
if (fs.existsSync(composeSrc)) {
  fs.copyFileSync(composeSrc, path.join(release, 'docker-compose.yml'))
} else {
  log('(docker-compose.yml absent — managed-translate will be unavailable)')
}

// ── 6. Write launcher shim(s) for this platform ─────────────────────────────
log('writing launcher shim(s) …')
if (isWin) {
  // Primary: a .cmd whose console window shows live status/logs; close it (or
  // Ctrl-C) to stop the app.
  fs.writeFileSync(path.join(release, 'Resume Studio.cmd'),
`@echo off
setlocal
set "RESUME_CLIENT_DIR=%~dp0app\\dist"
set "RESUME_COMPOSE_FILE=%~dp0docker-compose.yml"
rem Tip: the sync folder and translation are configured from the in-app
rem Settings screen (gear icon) — no need to edit this file.
"%~dp0node.exe" "%~dp0app\\launcher.cjs"
`)
  // Optional: launch with no console window. Stopping then needs Task Manager
  // (or the app shuts down when you close the browser? no — it keeps running),
  // so the .cmd is recommended for most users.
  fs.writeFileSync(path.join(release, 'Resume Studio (no window).vbs'),
`Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\\"))
sh.Environment("PROCESS")("RESUME_CLIENT_DIR") = root & "app\\dist"
sh.Environment("PROCESS")("RESUME_COMPOSE_FILE") = root & "docker-compose.yml"
sh.Run """" & root & "node.exe"" """ & root & "app\\launcher.cjs""", 0, False
`)
} else {
  const sh =
`#!/bin/sh
# Resume Studio launcher
DIR="$(cd "$(dirname "$0")" && pwd)"
export RESUME_CLIENT_DIR="$DIR/app/dist"
export RESUME_COMPOSE_FILE="$DIR/docker-compose.yml"
# Tip: the sync folder and translation are configured from the in-app
# Settings screen (gear icon) — no need to edit this file.
exec "$DIR/node" "$DIR/app/launcher.cjs"
`
  const shPath = path.join(release, 'resume-studio.sh')
  fs.writeFileSync(shPath, sh)
  fs.chmodSync(shPath, 0o755)
  if (process.platform === 'darwin') {
    // Finder-double-clickable variant.
    const cmdPath = path.join(release, 'Resume Studio.command')
    fs.writeFileSync(cmdPath, sh)
    fs.chmodSync(cmdPath, 0o755)
  }
}

// ── 7. Drop a README into the release ───────────────────────────────────────
const launchName = isWin ? 'Resume Studio.cmd'
  : process.platform === 'darwin' ? 'Resume Studio.command' : 'resume-studio.sh'
fs.writeFileSync(path.join(release, 'README.txt'),
`Resume Studio — portable desktop build
=======================================

To start:  double-click "${launchName}".
A small window opens (status/logs) and your browser opens the app
automatically. Close that window (or press Ctrl-C in it) to stop.

Your data:
  Everything is stored in a private per-user folder, NOT inside this build
  folder, so you can move or replace this folder without losing data:
    Windows : %APPDATA%\\ResumeStudio
    macOS   : ~/Library/Application Support/ResumeStudio
    Linux   : ~/.local/share/resume-studio

Backup & sync across computers (optional):
  Set RESUME_BACKUP_DIR to a cloud-synced folder (Google Drive / Dropbox /
  OneDrive) before launching — see the commented line in the launcher shim.
  Resume Studio then keeps a single JSON backup of all your CVs in that folder
  and, on every launch, merges in anything newer from it. Open the app on a
  second computer pointed at the same folder to get your CVs there too.
  (The live database itself stays local — only the safe JSON backup syncs.)

See DESKTOP.md in the source repo for full details.
`)

// ── 8. Done ─────────────────────────────────────────────────────────────────
const platName = isWin ? 'windows' : process.platform
log(`done → ${release}  (platform: ${platName})`)
log(`launch with: ${launchName}`)
