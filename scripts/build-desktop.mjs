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
 *       node_modules/            ← only the deps esbuild can't bundle
 *
 * IMPORTANT: the bundled Node binary is platform-specific, so run this ON EACH
 * target OS (Windows build on Windows, Linux build on Linux, …). Run
 * `npm run build:desktop` (which builds the client first, then this script).
 * The Node binary is the ONLY per-platform artifact: SQLite lives inside it
 * (`node:sqlite`), so there is no compiled `.node` addon to match.
 *
 * Plain ESM, run directly by Node — no TS, no bundling of itself.
 */

import esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'

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

// Which build IS this, for the version string a user reads (server/version.ts)?
//
// `release` is DECLARED by the tag-triggered workflow, never inferred here: a
// local `build:desktop` produces a near-identical tree, so any sniffing would
// let a working-tree build claim to be the artifact people downloaded. Default
// dev, and bake the commit so a `Dev-<commit>` report is actionable.
const CHANNEL = process.env.RESUME_BUILD_CHANNEL?.trim().toLowerCase() === 'release' ? 'release' : 'dev'
const COMMIT = (() => {
  const baked = process.env.RESUME_BUILD_COMMIT?.trim() || process.env.GITHUB_SHA?.trim()
  if (baked) return baked.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: root, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
})()
log(`channel    : ${CHANNEL}${CHANNEL === 'release' ? '' : ` (reports Dev-${COMMIT || 'local'})`}`)

// The release-asset name for THIS platform/arch — must match
// server/desktop/updater.ts `assetNameFor` (intentionally duplicated: a build
// script can't import the TS module) and what the auto-updater downloads.
function assetNameFor(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'
  return `resume-studio-${os}-${arch}.tar.gz`
}

// Wrap a PNG in a single-image ICO container (PNG-in-ICO, valid on Vista+) —
// must match server/desktop/trayIcon.ts `icoFromPng` (intentionally duplicated
// for the same reason as assetNameFor above; its unit tests pin the format).
// Used to ship ResumeStudio.ico so Windows shortcuts can carry the brand mark.
function icoFromPng(png) {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = width >= 256 ? 0 : width
  entry[1] = height >= 256 ? 0 : height
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(6 + 16, 12)
  return Buffer.concat([header, entry, png])
}

// Wrap a PNG in a single-entry ICNS container for the macOS .app bundle's
// icon. Modern icns entries carry raw PNG payloads: magic + total length,
// then type + length + bytes per entry. The brand PNG is 150×150, filed under
// ic07 (the 128-pt slot, the nearest); Finder scales foreign icns leniently,
// and a rejected icon degrades to the generic one — never an error.
function icnsFromPng(png) {
  const entry = Buffer.concat([Buffer.from('ic07', 'ascii'), u32(8 + png.length), png])
  return Buffer.concat([Buffer.from('icns', 'ascii'), u32(8 + entry.length), entry])
}
function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
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
// Everything the server needs is inlined here except systray2 (below). SQLite
// comes from the Node binary itself, so there is no native addon to keep
// external and no package subtree to ship for it.
log('bundling server with esbuild …')
await esbuild.build({
  entryPoints: [path.join(root, 'server', 'desktop', 'launcher.ts')],
  outfile: path.join(appDir, 'launcher.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  // systray2 spawns a helper binary and does stdio/readline wiring that
  // esbuild's bundling breaks — it runs from a vendored node_modules instead
  // (see below). `node:sqlite` is a builtin, so esbuild leaves it alone.
  external: ['systray2'],
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
// Only systray2's closure remains (itself + debug/ms +
// fs-extra/graceful-fs/jsonfile/universalify). The bundle's require()s resolve
// these from app/node_modules at runtime. Nothing in this list is REQUIRED:
// SQLite comes from the Node binary, and systray2 is best-effort by design
// (its absence only costs the tray icon).
const requiredDeps = new Set()
const vendoredDeps = [
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
// Sanity-check that the Node runtime we're about to ship can actually open a
// database. SQLite comes from the Node binary, and Node 22 and below gate
// `node:sqlite` behind --experimental-sqlite — building on one of those
// produces a release that unpacks, launches, and then dies the first time it
// touches storage. Probing process.execPath is what makes the check honest:
// that is the exact binary copied in step 5 below.
try {
  execFileSync(process.execPath, ['-e', "require('node:sqlite').DatabaseSync"], { stdio: 'pipe' })
} catch {
  console.error(`[build-desktop] the Node runtime being bundled (${process.version}) has no ` +
    'usable node:sqlite — the shipped app would fail on first save. Build on Node 24+.')
  process.exit(1)
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

// ── 5c. Copy the legal texts ────────────────────────────────────────────────
// A desktop build is a REDISTRIBUTION, and several bundled components require
// their licence and attribution to travel with it: Apache-2.0 (the Quadim
// skill taxonomy in src/generated, and Roboto inside pdfmake), the Ubuntu Font
// Licence (public/fonts), and the MIT/ISC notice requirements. Shipping the
// binaries without these is the one packaging mistake that is invisible in
// testing and is nevertheless a licence breach. Hard-fail rather than warn:
// a release that quietly drops them is worse than a build that stops.
for (const legal of ['LICENSE', 'THIRD-PARTY-LICENSES.md', 'PRIVACY.md']) {
  const src = path.join(root, legal)
  if (!fs.existsSync(src)) {
    console.error(`[build-desktop] ERROR: ${legal} is missing — it must ship with the build.`)
    process.exit(1)
  }
  fs.copyFileSync(src, path.join(release, legal))
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
set "RESUME_BUILD_CHANNEL=${CHANNEL}"
set "RESUME_BUILD_COMMIT=${COMMIT}"
rem Tip: the sync folder and translation are configured from the in-app
rem Settings screen (gear icon) — no need to edit this file.
"%~dp0node.exe" "%~dp0app\\launcher.cjs"
`)
  // Primary double-click entry: launch with no console window. Quit via the
  // system-tray icon (right-click → Quit). The .cmd above is still handy when
  // you want to see the log. Named -Windows because this shim is the one file
  // people pin and make shortcuts to, and the suffix says which build it is.
  const noWindowVbs =
`Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\\"))
sh.Environment("PROCESS")("RESUME_INSTALL_DIR") = root
sh.Environment("PROCESS")("RESUME_CLIENT_DIR") = root & "app\\dist"
sh.Environment("PROCESS")("RESUME_COMPOSE_FILE") = root & "docker-compose.yml"
sh.Environment("PROCESS")("RESUME_APP_VERSION") = "${VERSION}"
sh.Environment("PROCESS")("RESUME_BUILD_CHANNEL") = "${CHANNEL}"
sh.Environment("PROCESS")("RESUME_BUILD_COMMIT") = "${COMMIT}"
sh.Run """" & root & "node.exe"" """ & root & "app\\launcher.cjs""", 0, False
`
  fs.writeFileSync(path.join(release, 'ResumeStudio-Windows.vbs'), noWindowVbs)
  // LEGACY NAME, kept deliberately: the swap script that runs DURING an update
  // is generated by the OLD installed build, and every build up to 1.2.1 bakes
  // this exact filename into its relaunch step. Without it, updating from one
  // of those builds would finish and then fail to restart the app. Same
  // content, so whichever name runs behaves identically. Drop it once no
  // supported release references it.
  fs.writeFileSync(path.join(release, 'Resume Studio (no window).vbs'),
    `' Legacy name — see ResumeStudio-Windows.vbs (kept so updates from older builds can relaunch).\r\n${noWindowVbs}`)

  // The brand mark as a real .ico so SHORTCUTS can carry it. A .vbs cannot
  // embed an icon (scripts take the file-type association's), which is why
  // the icon ships beside the launcher rather than "in" it.
  fs.writeFileSync(path.join(release, 'ResumeStudio.ico'),
    icoFromPng(fs.readFileSync(path.join(root, 'public', 'cartavio-favicon.png'))))

  // One double-click makes a Desktop shortcut with the Cartavio icon — the
  // manual route (right-click → new shortcut) lands on the generic VBS icon
  // and finding "Change icon" is nobody's idea of onboarding. The shortcut
  // targets wscript.exe BY NAME with the shim as an argument (never by file
  // association — see DESKTOP.md §6 for the association bug that rule closed).
  fs.writeFileSync(path.join(release, 'Create Desktop Shortcut.vbs'),
`Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\\"))
Set lnk = sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\\Resume Studio.lnk")
lnk.TargetPath = "wscript.exe"
lnk.Arguments = """" & root & "ResumeStudio-Windows.vbs"""
lnk.WorkingDirectory = root
lnk.IconLocation = root & "ResumeStudio.ico"
lnk.Description = "Resume Studio"
lnk.Save
MsgBox "A Resume Studio shortcut was placed on your Desktop.", vbInformation, "Resume Studio"
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
export RESUME_BUILD_CHANNEL="${CHANNEL}"
export RESUME_BUILD_COMMIT="${COMMIT}"
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

    // A minimal .app bundle, because macOS attaches icons to BUNDLES, not to
    // scripts — a bare .command always shows the generic Terminal document
    // icon. The bundle's executable is a shell stub that resolves the release
    // root (three levels up from Contents/MacOS) and hands off to the same
    // launcher; the icon is the brand PNG in an icns container. Unsigned like
    // everything else here — the right-click → Open dance applies once.
    const appDir = path.join(release, 'Resume Studio.app', 'Contents')
    fs.mkdirSync(path.join(appDir, 'MacOS'), { recursive: true })
    fs.mkdirSync(path.join(appDir, 'Resources'), { recursive: true })
    fs.writeFileSync(path.join(appDir, 'Info.plist'),
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Resume Studio</string>
  <key>CFBundleIdentifier</key><string>no.cartavio.resumestudio</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleExecutable</key><string>ResumeStudio</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
`)
    const stubPath = path.join(appDir, 'MacOS', 'ResumeStudio')
    fs.writeFileSync(stubPath,
`#!/bin/sh
# Resume Studio launcher stub — the release root is the bundle's parent.
DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
exec "$DIR/resume-studio.sh"
`)
    fs.chmodSync(stubPath, 0o755)
    fs.writeFileSync(path.join(appDir, 'Resources', 'AppIcon.icns'),
      icnsFromPng(fs.readFileSync(path.join(root, 'public', 'cartavio-favicon.png'))))
  } else {
    // Linux: icons attach to .desktop ENTRIES, and those need absolute paths —
    // unknowable until the folder is unpacked. So ship the icon plus a helper
    // that writes ~/.local/share/applications/resume-studio.desktop with the
    // paths resolved, giving the app a launcher-menu entry with the brand mark.
    fs.copyFileSync(path.join(root, 'public', 'cartavio-favicon.png'),
      path.join(release, 'resume-studio.png'))
    const desktopHelper = path.join(release, 'create-desktop-entry.sh')
    fs.writeFileSync(desktopHelper,
`#!/bin/sh
# Writes a freedesktop launcher entry for THIS copy of Resume Studio, so the
# app appears in your application menu with its icon. Run it again after
# moving the folder — the entry carries absolute paths.
DIR="$(cd "$(dirname "$0")" && pwd)"
APPS="\${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS"
cat > "$APPS/resume-studio.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Resume Studio
Comment=One master resume, targeted CVs
Exec="$DIR/resume-studio.sh"
Icon=$DIR/resume-studio.png
Terminal=false
Categories=Office;
EOF
echo "Installed: $APPS/resume-studio.desktop"
`)
    fs.chmodSync(desktopHelper, 0o755)
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
${isWin ? `
Prefer no console window? Double-click "ResumeStudio-Windows.vbs" instead —
and run "Create Desktop Shortcut.vbs" once to get a Desktop shortcut with the
Resume Studio icon (a plain shortcut to a .vbs shows the generic script icon;
ResumeStudio.ico ships here so any shortcut can use it).
` : ''}

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

// ── 7c. Emit the checksum sidecar the updater verifies against ───────────────
// `<archive>.sha256` in sha256sum(1) format ("<hex>  <name>"), so `sha256sum -c`
// works by hand and server/desktop/updater.ts can parse it after downloading.
// Emitted HERE rather than in CI so a local build:desktop and a release build
// produce the same asset set, and the digest is computed by whoever made the
// archive. The updater FAILS CLOSED when this file is absent — if you change the
// name, change `checksumNameFor` in updater.ts with it.
const checksumName = `${archiveName}.sha256`
const digest = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
fs.writeFileSync(path.join(distDir, checksumName), `${digest}  ${archiveName}\n`)
log(`checksum → ${checksumName} (${digest.slice(0, 16)}…)`)

// ── 8. Done ─────────────────────────────────────────────────────────────────
const platName = isWin ? 'windows' : process.platform
log(`done → ${release}  (platform: ${platName}, v${VERSION})`)
log(`archive → ${archivePath}`)
log(`launch with: ${launchName}`)
