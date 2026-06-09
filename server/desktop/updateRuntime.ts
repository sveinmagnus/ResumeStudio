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
}

/** What the tray needs to render the update menu item. */
export interface UpdateTrayView {
  title: string
  tooltip: string
  enabled: boolean
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

/** Map the current state to the tray menu item's title/tooltip/enabled. */
export function trayView(): UpdateTrayView {
  switch (state) {
    case 'checking':
      return { title: 'Checking for updates…', tooltip: 'Contacting GitHub', enabled: false }
    case 'available':
    case 'staged':
      // Available but no per-platform asset → can't install in place; point at
      // the release page (disabled so the click doesn't dead-end).
      if (info && !info.assetUrl) {
        return {
          title: `Update v${info.latestVersion} available`,
          tooltip: 'No auto-install build for this platform — download it from the release page',
          enabled: false,
        }
      }
      return {
        title: `Install update (v${info?.latestVersion ?? '?'})`,
        tooltip: 'Download and install the new version, then restart',
        enabled: true,
      }
    case 'downloading':
      return {
        title: `Downloading… ${Math.round(progress * 100)}%`,
        tooltip: 'Downloading the update',
        enabled: false,
      }
    case 'applying':
      return { title: 'Installing — restarting…', tooltip: 'Applying the update', enabled: false }
    case 'error':
      return { title: 'Update check failed — retry', tooltip: errorMsg ?? 'Try again', enabled: true }
    default:
      return { title: 'Check for updates', tooltip: 'Check GitHub for a newer version', enabled: true }
  }
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

/** Check GitHub for a newer release. Safe to call repeatedly; no-op while busy. */
export async function runCheck(): Promise<UpdateStatusView> {
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
  return getUpdateStatus()
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

/** Tray/banner click dispatch: install when ready, otherwise check. */
export function handleUpdateClick(): void {
  if (state === 'available' || state === 'staged') void runInstall()
  else if (!BUSY.includes(state)) void runCheck()
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
    const scriptPath = path.join(scriptDir, 'apply-update.cmd')
    const launcher = path.join(installDir, 'Resume Studio.cmd')
    // `ping` is the redirect-safe sleep (timeout fails with redirected stdin).
    const contents = [
      '@echo off',
      'setlocal',
      ':waitloop',
      `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul`,
      'if not errorlevel 1 (',
      '  ping 127.0.0.1 -n 2 >nul',
      '  goto waitloop',
      ')',
      `robocopy "${stagedDir}" "${installDir}" /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 >nul`,
      `start "" "${launcher}"`,
      `rmdir /s /q "${stagingVersionDir}" >nul 2>&1`,
      'del "%~f0"',
      '',
    ].join('\r\n')
    return {
      path: scriptPath,
      contents,
      spawn: { cmd: 'cmd.exe', args: ['/c', scriptPath] },
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
}
