/**
 * Process-wide holder + orchestrator for the auto-updater.
 *
 * Mirrors `server/backupRuntime.ts`: the desktop launcher seeds it at boot with
 * the install dir + a shutdown hook, the auth-gated `/api/update` route drives
 * it (status / check / install), and the system tray reflects its state. On the
 * VPS build nothing seeds it, so it stays inert and the route reports
 * `supported:false`.
 *
 * State machine (also drives the tray title and the in-app banner):
 *   idle → checking → available | uptodate | error
 *   available → downloading → (writes swap script, relaunches) → applying
 *
 * The actual file swap is a detached per-OS script (`buildSwapScript`) that
 * waits for THIS process to exit, replaces the install dir with the staged
 * build, and relaunches — the only way a running process can replace its own
 * locked files cross-platform (esp. node.exe on Windows). See DESKTOP.md.
 */

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { resolvePaths } from '../config.js'
import {
  checkForUpdate, stageUpdate, nodeBinaryName, type UpdateInfo, type StagedUpdate,
} from './updater.js'

export type UpdateState =
  | 'idle' | 'checking' | 'available' | 'uptodate' | 'downloading' | 'staged' | 'applying' | 'error'

export interface UpdateRuntimeConfig {
  /** The portable build root (folder holding node[.exe] + app/ + shims). */
  installDir: string
  /** The running app version, compared against the latest release. */
  appVersion: string
  log: (msg: string) => void
  /** Begin the launcher's graceful shutdown (so the swap script can take over). */
  requestShutdown: () => void
  /**
   * Show a native info popup (e.g. a manual check's "up to date" result — the
   * tray has no browser to show feedback in). Optional + best-effort.
   */
  notify?: (title: string, message: string) => void
  /**
   * Show an interactive Install/Cancel dialog when an update is found; resolves
   * true if the user chose Install. Optional + best-effort (false if no GUI).
   */
  confirmInstall?: (title: string, message: string) => Promise<boolean>
}

/**
 * What the tray needs to render the update controls: a disabled version header
 * plus two separate items — "Check for updates" (always available) and "Install
 * update" (enabled only when an update is ready).
 */
export interface UpdateTrayView {
  versionLabel: string
  checkTitle: string
  checkEnabled: boolean
  installTitle: string
  installEnabled: boolean
}

/** The JSON the `/api/update/status` route returns. */
export interface UpdateStatusView {
  supported: boolean
  state: UpdateState
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  /** True only when a per-platform asset exists to install in place. An update
   *  can be available (newer version) yet not downloadable (no matching asset on
   *  the release) — then the UI points the user at the release page instead. */
  downloadable: boolean
  progress: number
  lastCheckedAt: string | null
  notes: string
  htmlUrl: string | null
  error: string | null
}

let cfg: UpdateRuntimeConfig | null = null
let state: UpdateState = 'idle'
let info: UpdateInfo | null = null
let staged: StagedUpdate | null = null
let progress = 0
let lastCheckedAt: string | null = null
let errorMsg: string | null = null
let trayRefresher: ((view: UpdateTrayView) => void) | null = null

/** Seed the runtime from the launcher. Enables the feature. */
export function initUpdateRuntime(config: UpdateRuntimeConfig): void {
  cfg = config
}

/** Whether the desktop launcher wired the updater (false on the VPS build). */
export function isUpdateSupported(): boolean {
  return cfg !== null
}

/** Register the tray's update-item updater; called once the tray is ready. */
export function setTrayRefresher(fn: ((view: UpdateTrayView) => void) | null): void {
  trayRefresher = fn
  if (fn) fn(trayView())
}

function setState(next: UpdateState): void {
  state = next
  trayRefresher?.(trayView())
}

/**
 * Map the current state to the two tray items + version header. "Check for
 * updates" is always enabled (except mid-operation); "Install update" is enabled
 * only when an installable update is ready. Both items always exist in the menu.
 */
export function trayView(): UpdateTrayView {
  const version = cfg?.appVersion ?? process.env.RESUME_APP_VERSION ?? '0.0.0'
  const view: UpdateTrayView = {
    versionLabel: `Cartavio Resume Studio v${version}`,
    checkTitle: 'Check for updates',
    checkEnabled: true,
    installTitle: 'Install update',
    installEnabled: false,
  }
  switch (state) {
    case 'checking':
      view.checkTitle = 'Checking for updates…'
      view.checkEnabled = false
      break
    case 'downloading':
      view.checkEnabled = false
      view.installTitle = `Downloading… ${Math.round(progress * 100)}%`
      break
    case 'applying':
      view.checkEnabled = false
      view.installTitle = 'Installing — restarting…'
      break
    case 'available':
    case 'staged':
      if (info?.assetUrl) {
        view.installTitle = `Install update (v${info.latestVersion})`
        view.installEnabled = true
      } else if (info) {
        // Newer version exists but no installable asset for this platform.
        view.installTitle = `Update v${info.latestVersion} (download manually)`
        view.installEnabled = false
      }
      break
    // uptodate / error / idle → defaults (Check enabled, Install disabled)
  }
  return view
}

/** Snapshot for the status route. */
export function getUpdateStatus(): UpdateStatusView {
  return {
    supported: isUpdateSupported(),
    state,
    currentVersion: cfg?.appVersion ?? process.env.RESUME_APP_VERSION ?? '0.0.0',
    latestVersion: info?.latestVersion ?? null,
    updateAvailable: info?.updateAvailable ?? false,
    downloadable: !!info?.assetUrl,
    progress,
    lastCheckedAt,
    notes: info?.notes ?? '',
    htmlUrl: info?.htmlUrl ?? null,
    error: state === 'error' ? errorMsg : null,
  }
}

const BUSY: UpdateState[] = ['checking', 'downloading', 'applying']

/**
 * Check GitHub for a newer release. Safe to call repeatedly; no-op while busy.
 * Pass `announce` for a MANUAL check (tray click) to pop a native result popup —
 * the daily background check leaves it false so it stays silent.
 */
export async function runCheck(announce = false): Promise<UpdateStatusView> {
  if (!cfg) return getUpdateStatus()
  if (BUSY.includes(state)) return getUpdateStatus()
  setState('checking')
  errorMsg = null
  try {
    info = await checkForUpdate(cfg.appVersion)
    lastCheckedAt = new Date().toISOString()
    setState(info.updateAvailable ? 'available' : 'uptodate')
    cfg.log(info.updateAvailable
      ? `  update     : v${info.latestVersion} available (current v${cfg.appVersion})`
      : `  update     : up to date (v${cfg.appVersion})`)
  } catch (err) {
    errorMsg = 'Could not check for updates.'
    setState('error')
    cfg.log(`  update     : check failed — ${(err as Error).message}`)
  }
  // When an update is found, offer to install it (manual check OR daily check).
  // Otherwise, a MANUAL check pops an info result ("up to date" / "error").
  if (state === 'available') void offerInstall(announce)
  else if (announce) announceResult()
  return getUpdateStatus()
}

const POPUP_TITLE = 'Cartavio Resume Studio'

/** Info popup for a manual check that found no update (best-effort). */
function announceResult(): void {
  if (!cfg?.notify) return
  if (state === 'uptodate') {
    cfg.notify(POPUP_TITLE, `You're already on the latest version (v${cfg.appVersion}).`)
  } else if (state === 'error') {
    cfg.notify(POPUP_TITLE, 'Could not check for updates. Please check your internet connection and try again.')
  }
}

/** Version we've already auto-prompted for this session (de-dup the daily check). */
let autoOfferedVersion: string | null = null

/**
 * An update was found. Offer an Install/Cancel dialog; install on confirm.
 * `manual` (a tray "Check for updates" click) always prompts; the background
 * daily check prompts at most once per version per session. On Cancel the
 * update stays available (the tray Install item remains enabled).
 */
async function offerInstall(manual: boolean): Promise<void> {
  if (!cfg || !info) return
  if (!info.assetUrl) {
    // Newer version exists but nothing to auto-install for this platform.
    cfg.notify?.(POPUP_TITLE, `Version ${info.latestVersion} is available, but there is no automatic install for this platform. Download it from the release page.`)
    return
  }
  if (!manual) {
    if (autoOfferedVersion === info.latestVersion) return
    autoOfferedVersion = info.latestVersion
  }
  const message = `New version ${info.latestVersion} available`
  if (cfg.confirmInstall) {
    const ok = await cfg.confirmInstall(POPUP_TITLE, message)
    if (ok) void runInstall()
  } else {
    cfg.notify?.(POPUP_TITLE, `${message}. Use the tray menu's Install update option to install it.`)
  }
}

/**
 * Download + stage the available update, then hand off to the detached swap
 * script and begin shutdown. Returns once staging is kicked off; progress is
 * observable via the status route / tray. No-op unless an update is available.
 */
export async function runInstall(): Promise<void> {
  if (!cfg || !info || !info.updateAvailable) return
  if (BUSY.includes(state)) return
  if (!info.assetUrl) {
    // Newer version exists but no installable asset for this platform — surface
    // it rather than no-op'ing silently (the UI offers the release page link).
    errorMsg = 'No downloadable build for this platform. Open the release page to update manually.'
    setState('error')
    cfg.log('  update     : no asset for this platform — manual download required')
    return
  }
  progress = 0
  setState('downloading')
  try {
    const stagingRoot = path.join(resolvePaths().dataDir, 'updates')
    staged = await stageUpdate(info, stagingRoot, (f) => {
      progress = f
      trayRefresher?.(trayView()) // live % in the tray title
    })
    setState('staged')
    cfg.log(`  update     : staged v${staged.version} — applying & restarting`)
    applyStaged(staged)
  } catch (err) {
    errorMsg = 'Update download failed.'
    setState('error')
    cfg.log(`  update     : install failed — ${(err as Error).message}`)
  }
}

/** Tray "Check for updates" click → a MANUAL check (announce=true). */
export function handleCheckClick(): void {
  if (!BUSY.includes(state)) void runCheck(true)
}

/** Tray "Install update" click → install if one is ready (else a no-op). */
export function handleInstallClick(): void {
  if (state === 'available' || state === 'staged') void runInstall()
}

/** Write the swap script, spawn it detached, then ask the launcher to shut down. */
function applyStaged(s: StagedUpdate): void {
  if (!cfg) return
  const script = buildSwapScript({
    installDir: cfg.installDir,
    stagedDir: s.dir,
    stagingVersionDir: path.dirname(s.dir),
    pid: process.pid,
  })
  fs.writeFileSync(script.path, script.contents)
  if (process.platform !== 'win32') {
    try { fs.chmodSync(script.path, 0o755) } catch { /* best-effort */ }
  }
  const child = spawn(script.spawn.cmd, script.spawn.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  setState('applying')
  // Give the detached process a beat to start watching our PID, then shut down.
  setTimeout(() => cfg?.requestShutdown(), 400)
}

// ── Swap script (pure builder, unit-tested) ──────────────────────────────────

export interface SwapScriptInput {
  installDir: string
  stagedDir: string
  /** The per-version staging dir to delete after a successful swap. */
  stagingVersionDir: string
  pid: number
  platform?: NodeJS.Platform
}

export interface SwapScript {
  path: string
  contents: string
  spawn: { cmd: string; args: string[] }
}

/**
 * Build the per-OS script that (1) waits for `pid` to exit so files unlock,
 * (2) replaces `installDir` with `stagedDir`, (3) relaunches the app, and
 * (4) cleans up staging + itself. Pure: returns the path/contents/spawn argv;
 * the caller writes + spawns it.
 */
export function buildSwapScript(input: SwapScriptInput): SwapScript {
  const platform = input.platform ?? process.platform
  const { installDir, stagedDir, stagingVersionDir, pid } = input
  const scriptDir = stagingVersionDir

  if (platform === 'win32') {
    // A PowerShell script run in a VISIBLE window. Why not the old detached
    // `cmd /c` approach: it ran with no console, so tasklist/find/ping each
    // popped their own window, and the relaunch used `start "" "X.cmd"` which
    // goes through file association (a text editor on dev machines). PowerShell
    // gives a clean Wait-Process (no tasklist|find), a real ascii progress bar,
    // and an association-proof relaunch via `cmd /c`.
    const scriptPath = path.join(scriptDir, 'apply-update.ps1')
    const psLit = (s: string) => `'${s.replace(/'/g, "''")}'` // single-quoted PS literal
    const contents = [
      `$ErrorActionPreference = 'SilentlyContinue'`,
      `$Host.UI.RawUI.WindowTitle = 'Cartavio Resume Studio Updater'`,
      `$src = ${psLit(stagedDir)}`,
      `$dst = ${psLit(installDir)}`,
      `$stage = ${psLit(stagingVersionDir)}`,
      `Write-Host ''`,
      `Write-Host '  Cartavio Resume Studio - installing update'`,
      `Write-Host '  ==========================================='`,
      `Write-Host ''`,
      `Write-Host '  Waiting for the app to close...'`,
      // Reliable wait for OUR process to exit so node.exe unlocks (no tasklist).
      `Wait-Process -Id ${pid} -Timeout 60 -ErrorAction SilentlyContinue`,
      `Start-Sleep -Milliseconds 400`,
      `Write-Host '  Copying files...'`,
      `$files = @(Get-ChildItem -LiteralPath $src -Recurse -File)`,
      `$total = [Math]::Max($files.Count, 1)`,
      `$i = 0`,
      `foreach ($f in $files) {`,
      `  $i++`,
      `  $rel = $f.FullName.Substring($src.Length).TrimStart([char]92)`,
      `  $target = Join-Path $dst $rel`,
      `  $tdir = Split-Path -Parent $target`,
      `  if (-not (Test-Path -LiteralPath $tdir)) { New-Item -ItemType Directory -Path $tdir -Force | Out-Null }`,
      // Retry per file in case a handle lingers briefly after exit.
      `  for ($t = 0; $t -lt 40; $t++) {`,
      `    try { Copy-Item -LiteralPath $f.FullName -Destination $target -Force -ErrorAction Stop; break }`,
      `    catch { Start-Sleep -Milliseconds 500 }`,
      `  }`,
      `  $fill = [int](40 * $i / $total)`,
      `  $bar = ('#' * $fill) + ('-' * (40 - $fill))`,
      `  Write-Host ([char]13 + ('  [' + $bar + '] ' + [int](100 * $i / $total) + '%  ' + $i + '/' + $total + ' files')) -NoNewline`,
      `}`,
      `Write-Host ''`,
      `Write-Host ''`,
      `Write-Host '  Update installed. Restarting Resume Studio...'`,
      `Start-Sleep -Milliseconds 800`,
      // Relaunch the shim via cmd /c (executes it; never opens it by association).
      `Start-Process -FilePath $env:ComSpec -ArgumentList '/c', ('"' + (Join-Path $dst 'Resume Studio.cmd') + '"') -WorkingDirectory $dst`,
      `Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue`,
      `Start-Sleep -Milliseconds 1200`,
      '',
    ].join('\r\n')
    return {
      path: scriptPath,
      contents,
      // `start ""` opens the PowerShell script in its own VISIBLE console window
      // (powershell.exe invoked by name → no file-association detour).
      spawn: {
        cmd: 'cmd.exe',
        args: ['/c', 'start', '', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      },
    }
  }

  // macOS / Linux
  const scriptPath = path.join(scriptDir, 'apply-update.sh')
  const launcherName = platform === 'darwin' ? 'Resume Studio.command' : 'resume-studio.sh'
  const launcher = path.join(installDir, launcherName)
  const nodeBin = path.join(installDir, nodeBinaryName(platform))
  const sh = (p: string) => `'${p.replace(/'/g, `'\\''`)}'` // single-quote-safe
  const contents = [
    '#!/bin/sh',
    `while kill -0 ${pid} 2>/dev/null; do sleep 1; done`,
    // Overlay the staged build onto the install dir (data lives elsewhere).
    `cp -R ${sh(stagedDir)}/. ${sh(installDir)}/`,
    `chmod +x ${sh(nodeBin)} 2>/dev/null || true`,
    `chmod +x ${sh(launcher)} 2>/dev/null || true`,
    `nohup ${sh(launcher)} >/dev/null 2>&1 &`,
    `rm -rf ${sh(stagingVersionDir)}`,
    '',
  ].join('\n')
  return {
    path: scriptPath,
    contents,
    spawn: { cmd: 'sh', args: [scriptPath] },
  }
}

/** Test seam: reset module state between unit tests. */
export function __resetUpdateRuntimeForTests(): void {
  cfg = null
  state = 'idle'
  info = null
  staged = null
  progress = 0
  lastCheckedAt = null
  errorMsg = null
  trayRefresher = null
  autoOfferedVersion = null
}
