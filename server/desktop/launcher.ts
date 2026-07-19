/**
 * Desktop launcher — the entry point the portable build runs.
 *
 * Unlike `server/index.ts` (the VPS entry: bind a fixed port, assume a
 * checkout), this is built for a double-click on a personal machine:
 *
 *   1. Resolve a stable per-user data dir (survives moving/reinstalling the app)
 *      and create it.                                          → config.ts
 *   2. Tee startup diagnostics to a log file (no terminal in a GUI launch).
 *   3. Load persisted user settings and apply them onto the env the rest of the
 *      server reads (translate URL/key, sync folder).          → settings.ts
 *   4. Point the DB + static client at the resolved locations via env.
 *   5. Boot-merge any newer store backup from the sync folder (so opening the
 *      app on machine B pulls machine A's latest edits).       → backup + db
 *   6. Start Express on a free loopback port and open the browser at it.
 *   7. Keep the sync-folder backup current while running.      → backupRuntime
 *   8. Optionally bring up the managed Docker LibreTranslate.  → translateDocker
 *   9. On Ctrl-C / window close / signal: flush a final backup, checkpoint and
 *      close the DB cleanly, then exit.
 *
 * Everything is plain ESM with no `import.meta`/`__dirname` so it bundles to a
 * single CJS file with esbuild *and* runs under tsx in dev unchanged. Locations
 * come from env (set by the portable launcher shim) with dev-friendly fallbacks.
 */

import fs from 'fs'
import path from 'path'
import { createApp } from '../app.js'
import { getDefaultDb, closeDefaultDb } from '../db.js'
import { resolvePaths } from '../config.js'
import { loadOrInitSettings } from '../settings.js'
import { readStoreBackup } from '../backup.js'
import { initBackupRuntime, reconfigureBackup, flushBackup, stopBackup } from '../backupRuntime.js'
import { startTranslate } from '../translateDocker.js'
import { findFreePort } from './freePort.js'
import { openBrowser } from './openBrowser.js'
import { startTray, type TrayHandle } from './tray.js'
import { notify, confirmInstall } from './notify.js'
import { APP_VERSION } from '../version.js'
import {
  initUpdateRuntime, setTrayRefresher, runCheck, trayView,
  handleCheckClick, handleInstallClick,
} from './updateRuntime.js'

const HOST = '127.0.0.1' // loopback only — never expose a personal CV store to the LAN
const PREFERRED_PORT = parseInt(process.env.PORT ?? '3001', 10)

async function main(): Promise<void> {
  const paths = resolvePaths()
  fs.mkdirSync(paths.dataDir, { recursive: true })

  // ── Logging: tee to console + a rolling-ish log file ─────────────────────
  // Reset the log if it has grown large so it can't fill the disk over years.
  try {
    if (fs.existsSync(paths.logFile) && fs.statSync(paths.logFile).size > 1_000_000) {
      fs.rmSync(paths.logFile)
    }
  } catch { /* non-fatal */ }
  const logStream = fs.createWriteStream(paths.logFile, { flags: 'a' })
  const log = (msg: string): void => {
    const line = `${new Date().toISOString()} ${msg}`
    console.log(line)
    try { logStream.write(line + '\n') } catch { /* ignore */ }
  }

  // ── Wire the rest of the server at the resolved locations ────────────────
  process.env.RESUME_DESKTOP = '1'            // flips on the in-app settings surface
  process.env.RESUME_DATA_DIR = paths.dataDir // so settings.ts resolves the same dir
  process.env.RESUME_DB_PATH = paths.dbPath
  // Make the version visible to child processes (and the status route fallback).
  if (!process.env.RESUME_APP_VERSION?.trim()) process.env.RESUME_APP_VERSION = APP_VERSION
  // The portable shim sets RESUME_CLIENT_DIR to an absolute dist path. If it's
  // unset (dev run, or a shim that didn't export it) fall back to whichever of
  // these exists relative to the working directory: `dist` (repo checkout) or
  // `app/dist` (portable folder launched from its root).
  if (!process.env.RESUME_CLIENT_DIR?.trim()) {
    const candidates = [
      path.join(process.cwd(), 'dist'),
      path.join(process.cwd(), 'app', 'dist'),
    ]
    process.env.RESUME_CLIENT_DIR = candidates.find((c) => fs.existsSync(c)) ?? candidates[0]
  }
  // docker-compose file for the managed-translate feature. The shim sets this in
  // the portable build; dev falls back to the repo's compose file if present.
  if (!process.env.RESUME_COMPOSE_FILE?.trim()) {
    const devCompose = path.join(process.cwd(), 'docker-compose.yml')
    if (fs.existsSync(devCompose)) process.env.RESUME_COMPOSE_FILE = devCompose
  }

  // ── Settings: load (seed from env on first run) + apply onto process.env ──
  // Must precede reading the effective backup dir / createApp, since applyToEnv
  // sets LIBRETRANSLATE_URL, RESUME_BACKUP_DIR, RESUME_BACKUP_INTERVAL_MS.
  const settings = loadOrInitSettings()
  const backupDir = process.env.RESUME_BACKUP_DIR?.trim() || null
  const intervalMs = settings.backup_interval_ms
  const translateMode = settings.translate_docker
    ? 'managed Docker LibreTranslate'
    : (process.env.LIBRETRANSLATE_URL?.trim() ? process.env.LIBRETRANSLATE_URL.trim() : '(off)')

  log('────────────────────────────────────────────────')
  log('Resume Studio (desktop) starting')
  log(`  version    : ${APP_VERSION}`)
  log(`  data dir   : ${paths.dataDir}`)
  log(`  database   : ${paths.dbPath}`)
  log(`  client dir : ${process.env.RESUME_CLIENT_DIR}`)
  log(`  backup dir : ${backupDir ?? '(not configured)'}`)
  log(`  translate  : ${translateMode}`)

  // Build the singleton DB now (reads RESUME_DB_PATH we just set) so the boot
  // restore, the routes, and the scheduler all share one handle.
  const db = getDefaultDb()

  // ── Boot restore: pull newer edits from the sync folder ──────────────────
  // Non-destructive merge (newest-wins per resume) — safe to run every launch.
  if (backupDir) {
    try {
      const backup = readStoreBackup(backupDir)
      if (backup) {
        const summary = db.restoreResumes(backup.resumes) // merge mode
        // Merge the shared registry too so synced resumes' canonical links resolve.
        const reg = db.mergeRegistry(backup.registry)
        log(
          `  sync-in    : +${summary.inserted} new, ${summary.updated} updated, ` +
          `${summary.skipped} already current; registry +${reg.added}/${reg.updated}`,
        )
      } else {
        log('  sync-in    : no backup file yet (first run on this sync folder)')
      }
    } catch (err) {
      // A bad/foreign file must not block startup — just skip the merge.
      log(`  sync-in    : skipped — ${(err as Error).message}`)
    }
  }

  // ── HTTP server ──────────────────────────────────────────────────────────
  const app = createApp()
  const port = await findFreePort(PREFERRED_PORT, HOST)
  const url = `http://${HOST}:${port}`

  const server = app.listen(port, HOST, () => {
    log(`  server     : ${url}`)
    log('────────────────────────────────────────────────')
    log(`Resume Studio is running. Opening ${url} …`)
    log('Close this window (or press Ctrl-C) to stop the app.')
    // RESUME_NO_BROWSER lets a headless run (CI, a server, a smoke test) start
    // the app without trying to launch a GUI browser.
    if (!process.env.RESUME_NO_BROWSER?.trim()) openBrowser(url)
  })

  // ── Periodic backup to the sync folder while running ─────────────────────
  // Owned by backupRuntime so the in-app Settings screen can reconfigure it
  // live when the user changes the folder.
  initBackupRuntime(log)
  reconfigureBackup(backupDir, intervalMs)

  // ── Optionally bring up the managed Docker LibreTranslate ────────────────
  // Best-effort + non-blocking: the editor must start whether or not Docker is
  // present. First run pulls a large image + models, so this can take minutes.
  if (settings.translate_docker) {
    log('  translate  : starting Docker LibreTranslate (first run downloads models — this can take minutes) …')
    void startTranslate().then((r) => log(`  translate  : ${r.message}`))
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────
  let trayHandle: TrayHandle | null = null
  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    log(`Shutting down (${signal}) …`)
    trayHandle?.kill()        // remove the tray icon (doesn't exit node itself)
    flushBackup()             // one last sync-folder write
    stopBackup()
    closeDefaultDb()          // WAL checkpoint + close so the .db is self-contained
    server.close(() => {
      log('Stopped cleanly.')
      logStream.end(() => process.exit(0))
    })
    // Hard cap: if something hangs, don't leave a zombie process behind.
    setTimeout(() => process.exit(0), 3000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  // On Windows a closed console window arrives as SIGHUP/SIGBREAK on some shells.
  process.on('SIGHUP', () => shutdown('SIGHUP'))

  // ── Auto-updater (best-effort, desktop-only) ─────────────────────────────
  // Seed the updater runtime with where this build lives + a shutdown hook the
  // swap script needs. RESUME_NO_UPDATE disables the whole feature (headless/CI
  // / packaged-by-a-store deployments that shouldn't self-update).
  const updatesEnabled = !process.env.RESUME_NO_UPDATE?.trim()
  if (updatesEnabled) {
    // The portable build root = the folder holding node[.exe] + app/ + shims.
    // The shim exports RESUME_INSTALL_DIR; otherwise derive it from the client
    // dir (which is <installDir>/app/dist).
    const installDir = process.env.RESUME_INSTALL_DIR?.trim()
      || path.dirname(path.dirname(process.env.RESUME_CLIENT_DIR as string))
    initUpdateRuntime({
      installDir,
      appVersion: APP_VERSION,
      log,
      requestShutdown: () => shutdown('update'),
      // Native popup so a manual tray "Check for updates" always gives feedback
      // (the tray has no browser to show an "up to date" message in).
      notify: (title, message) => notify(title, message, log),
      // Interactive Install/Cancel dialog when an update is found.
      confirmInstall: (title, message) => confirmInstall(title, message, log),
    })
    log(`  updates    : enabled (install dir: ${installDir})`)
  }

  // ── System-tray icon (version • Open • Check/Install • Quit) ──────────────
  // Non-blocking + best-effort: a tray failure never stops the server, and the
  // launcher window / Ctrl-C remains a working way to quit. With the tray, the
  // no-window (.vbs) launcher is fully usable — Quit lives in the tray.
  void startTray({
    onOpen: () => openBrowser(url),
    onQuit: () => shutdown('tray'),
    onCheck: () => handleCheckClick(),
    onInstall: () => handleInstallClick(),
    initialView: trayView(),
    log,
  }).then((h) => {
    trayHandle = h
    // Let the updater push its state (Check ↔ Install ↔ Downloading…) into the
    // tray menu item as it changes.
    if (h && updatesEnabled) setTrayRefresher((view) => h.setUpdate(view))
  })

  // ── Periodic update check (daily) + one shortly after boot ───────────────
  if (updatesEnabled) {
    setTimeout(() => { void runCheck() }, 10_000).unref()
    setInterval(() => { void runCheck() }, 24 * 60 * 60 * 1000).unref()
  }
}

main().catch((err) => {
  console.error('Fatal: Resume Studio failed to start.')
  console.error(err)
  process.exit(1)
})
