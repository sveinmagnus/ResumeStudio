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
import { execFileSync } from 'child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = path.join(root, 'release')
const appDir = path.join(release, 'app')
const isWin = process.platform === 'win32'

const log = (m) => console.log(`[build-desktop] ${m}`)

// App version, baked into the launcher shims as RESUME_APP_VERSION (the bundle
// has no package.json to read at runtime, and the auto-updater compares this to
// the latest GitHub release). See server/version.ts.
//
// Precedence MIRRORS server/version.ts: an explicit RESUME_APP_VERSION wins,
// else package.json. In the tag-triggered release workflow CI sets
// RESUME_APP_VERSION from the git tag (the single source of truth for a
// published build) AND fails if package.json drifted from it — so the baked
// version can never silently fall back to a stale package.json again. Local
// `npm run build:desktop` (no env) keeps using package.json.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const VERSION = process.env.RESUME_APP_VERSION?.trim() || pkg.version || '0.0.0'
log(`version    : ${VERSION}${process.env.RESUME_APP_VERSION ? ' (from RESUME_APP_VERSION)' : ' (from package.json)'}`)

// The release-asset name for THIS platform/arch — must match
// server/desktop/updater.ts `assetNameFor` (intentionally duplicated: a build
// script can't import the TS module) and what the auto-updater downloads.
function assetNameFor(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'
  return `resume-studio-${os}-${arch}.tar.gz`
}

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
  // better-sqlite3 is a native addon; systray2 spawns a helper binary and does
  // stdio/readline wiring that esbuild's bundling breaks — both run from a
  // vendored node_modules instead (see below).
  external: ['better-sqlite3', 'systray2'],
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

// ── 3b. Verify the Quadim skill-library data is bundled ─────────────────────
// The skill artifacts (taxonomy / relations / classifications / domains) are
// imported as dynamic JSON chunks, so they ride along inside dist/assets and
// the local server serves them — the skill autocomplete, import normalization,
// related-skill suggestions and auto-categorization all work fully offline
// (translation is the ONLY intentionally-external feature). Confirm the data
// actually made it into the bundle so a client-build regression can't silently
// ship a build that reaches out for — or simply lacks — the skill library.
const assetsDir = path.join(appDir, 'dist', 'assets')
const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : []
const assetBlob = assetFiles
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
  .join('\n')
const failGuard = (label) => {
  console.error(`[build-desktop] ERROR: ${label} not found in dist/assets — the ` +
    'Quadim skill library would not be bundled. Regenerate the artifacts ' +
    '(node scripts/build-skill-taxonomy.mjs) and rebuild the client.')
  process.exit(1)
}
// Distinctive string VALUES prove the data content is bundled (Vite keeps
// space-containing domain names quoted; token keys get hoisted to consts, so
// the model is verified by its own emitted chunk file instead).
const contentSentinels = {
  'skill domains': 'Software Development',
  'skill classifications': 'Management_Leadership',
}
for (const [label, sentinel] of Object.entries(contentSentinels)) {
  if (!assetBlob.includes(sentinel)) failGuard(label)
}
if (!assetFiles.some((f) => /^skillDomainModel-.*\.js$/.test(f))) failGuard('skill domain model')
log('skill-library data present in bundle ✓')

// ── 4. Vendor the deps esbuild left external ────────────────────────────────
// better-sqlite3's closure (itself + bindings + file-uri-to-path) and systray2's
// closure (itself + debug/ms + fs-extra/graceful-fs/jsonfile/universalify). The
// bundle's require()s resolve these from app/node_modules at runtime.
// (prebuild-install is install-time only, so it's intentionally omitted.)
const requiredDeps = new Set(['better-sqlite3'])
const vendoredDeps = [
  'better-sqlite3', 'bindings', 'file-uri-to-path',
  'systray2', 'debug', 'ms', 'fs-extra', 'graceful-fs', 'jsonfile', 'universalify',
]
const nmOut = path.join(appDir, 'node_modules')
for (const dep of vendoredDeps) {
  const src = path.join(root, 'node_modules', dep)
  if (!fs.existsSync(src)) {
    if (requiredDeps.has(dep)) {
      console.error(`[build-desktop] required dependency ${dep} not found — run npm install`)
      process.exit(1)
    }
    log(`(optional dep ${dep} absent — skipping; its feature will be unavailable)`)
    continue
  }
  fs.cpSync(src, path.join(nmOut, dep), { recursive: true, dereference: true })
}
// Prune systray2's tray helpers to just this platform's (~3.5 MB each, 3 shipped).
const trayDir = path.join(nmOut, 'systray2', 'traybin')
const keepTrayBin = {
  win32: 'tray_windows_release.exe', darwin: 'tray_darwin_release', linux: 'tray_linux_release',
}[process.platform]
if (fs.existsSync(trayDir)) {
  for (const f of fs.readdirSync(trayDir)) {
    if (f !== keepTrayBin) fs.rmSync(path.join(trayDir, f), { force: true })
  }
  if (!isWin && keepTrayBin) {
    try { fs.chmodSync(path.join(trayDir, keepTrayBin), 0o755) } catch { /* best-effort */ }
  }
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
set "RESUME_INSTALL_DIR=%~dp0."
set "RESUME_CLIENT_DIR=%~dp0app\\dist"
set "RESUME_COMPOSE_FILE=%~dp0docker-compose.yml"
set "RESUME_APP_VERSION=${VERSION}"
rem Tip: the sync folder and translation are configured from the in-app
rem Settings screen (gear icon) — no need to edit this file.
"%~dp0node.exe" "%~dp0app\\launcher.cjs"
`)
  // Optional: launch with no console window. Quit via the system-tray icon
  // (right-click → Quit). The .cmd is still handy when you want to see the log.
  fs.writeFileSync(path.join(release, 'Resume Studio (no window).vbs'),
`Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\\"))
sh.Environment("PROCESS")("RESUME_INSTALL_DIR") = root
sh.Environment("PROCESS")("RESUME_CLIENT_DIR") = root & "app\\dist"
sh.Environment("PROCESS")("RESUME_COMPOSE_FILE") = root & "docker-compose.yml"
sh.Environment("PROCESS")("RESUME_APP_VERSION") = "${VERSION}"
sh.Run """" & root & "node.exe"" """ & root & "app\\launcher.cjs""", 0, False
`)
} else {
  const sh =
`#!/bin/sh
# Resume Studio launcher
DIR="$(cd "$(dirname "$0")" && pwd)"
export RESUME_INSTALL_DIR="$DIR"
export RESUME_CLIENT_DIR="$DIR/app/dist"
export RESUME_COMPOSE_FILE="$DIR/docker-compose.yml"
export RESUME_APP_VERSION="${VERSION}"
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
A small window opens (status/logs), your browser opens the app automatically,
and a Resume Studio icon appears in the system tray.

To stop:   right-click the tray icon and choose "Quit Resume Studio".
           (Closing the launcher window or pressing Ctrl-C also stops it.)
           Note: closing the browser tab does NOT stop the app.

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

// ── 7b. Emit the per-platform release archive (for the auto-updater + CI) ────
// A .tar.gz of release/ contents, named per platform/arch. The auto-updater
// downloads this from the GitHub release and `tar -xzf`s it (works on Win10+,
// macOS, Linux). Written OUTSIDE release/ so it isn't archived into itself.
const archiveName = assetNameFor()
const distDir = path.join(root, 'release-dist')
fs.mkdirSync(distDir, { recursive: true })
const archivePath = path.join(distDir, archiveName)
fs.rmSync(archivePath, { force: true })
log(`creating ${archiveName} (v${VERSION}) …`)
try {
  // Run with cwd = distDir and a BARE archive filename. A Windows drive letter
  // in the -f path (e.g. C:\…) is misread as a remote host (`host:path`) by GNU
  // tar; a relative -f avoids that. The -C source dir is never host-parsed.
  execFileSync('tar', ['-czf', archiveName, '-C', release, '.'], { cwd: distDir, stdio: 'inherit' })
} catch (err) {
  console.error(`[build-desktop] failed to create ${archiveName} (${err.message}). Is tar available?`)
  process.exit(1)
}

// ── 8. Done ─────────────────────────────────────────────────────────────────
const platName = isWin ? 'windows' : process.platform
log(`done → ${release}  (platform: ${platName}, v${VERSION})`)
log(`archive → ${archivePath}`)
log(`launch with: ${launchName}`)
