/**
 * Runtime path resolution for the desktop / self-deployed build.
 *
 * The web/VPS build never needed this — it ran from a checkout with `data/`
 * next to the server. A double-clickable desktop build can be launched from
 * anywhere (a Start-menu shortcut, a random folder), so its data must live in a
 * stable, per-user OS location that survives reinstalling/moving the app. This
 * module is the single source of truth for *where things go*.
 *
 * Everything here is a pure function of (env, platform, homedir) so it can be
 * unit-tested without touching the real filesystem. The launcher
 * (`desktop/launcher.ts`) calls `resolvePaths()` once at boot, creates the
 * directories, and exports the result into `process.env` so the rest of the
 * server (db.ts, app.ts) picks it up through the env vars it already honours.
 *
 * Override knobs (all optional — sensible defaults otherwise):
 *   RESUME_DATA_DIR    where the live SQLite DB + log live (default: OS app-data)
 *   RESUME_DB_PATH     exact DB file (default: <dataDir>/resume.db) — db.ts honours this
 *   RESUME_BACKUP_DIR  where the portable JSON store-backup is written for sync
 *                      (point this at a Google Drive / Dropbox / OneDrive folder)
 */

import path from 'path'
import os from 'os'

export interface RuntimePaths {
  /** Directory holding the live DB + log file. Always created on boot. */
  dataDir: string
  /** Absolute path to the SQLite file. */
  dbPath: string
  /**
   * Directory the periodic JSON store-backup is written to, or null when sync
   * isn't configured. Typically a cloud-synced folder so the file rides to
   * other machines. NOT where the live DB lives — see the module doc / §8.
   */
  backupDir: string | null
  /** Plain-text startup/diagnostic log (there's no terminal for a GUI launch). */
  logFile: string
}

/** Trim + treat empty string as "unset". */
function clean(v: string | undefined): string | undefined {
  const t = v?.trim()
  return t ? t : undefined
}

/**
 * The per-user, OS-appropriate base directory for this app's private data.
 * Mirrors the platform conventions Electron's `app.getPath('userData')` would
 * later give us, so a future Electron migration lands on the same folder.
 *
 *   Windows  %APPDATA%\ResumeStudio              (roaming profile)
 *   macOS    ~/Library/Application Support/ResumeStudio
 *   Linux    $XDG_DATA_HOME/resume-studio  or  ~/.local/share/resume-studio
 */
export function defaultDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (platform === 'win32') {
    const base = clean(env.APPDATA) ?? path.join(home, 'AppData', 'Roaming')
    return path.join(base, 'ResumeStudio')
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'ResumeStudio')
  }
  // Linux / other POSIX — follow the XDG base-dir spec.
  const base = clean(env.XDG_DATA_HOME) ?? path.join(home, '.local', 'share')
  return path.join(base, 'resume-studio')
}

/**
 * Resolve every runtime path from env (+ optional platform/home overrides for
 * tests). Pure: creates nothing. The launcher is responsible for mkdir.
 */
export function resolvePaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): RuntimePaths {
  const dataDir = clean(env.RESUME_DATA_DIR) ?? defaultDataDir(platform, env, home)
  const dbPath = clean(env.RESUME_DB_PATH) ?? path.join(dataDir, 'resume.db')
  const backupDir = clean(env.RESUME_BACKUP_DIR) ?? null
  const logFile = path.join(dataDir, 'resume-studio.log')
  return { dataDir, dbPath, backupDir, logFile }
}
