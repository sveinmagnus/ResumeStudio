/**
 * Best-effort native popup for the desktop build.
 *
 * The system tray has no browser context, so when the user clicks "Check for
 * updates" and is already up to date, there's nowhere to show the result. This
 * module pops a small OS-native message so a manual check always gives feedback:
 *
 *   Windows  PowerShell MessageBox (System.Windows.Forms — always present)
 *   macOS    osascript `display dialog`
 *   Linux    notify-send (libnotify; common on GNOME/KDE)
 *
 * Everything is best-effort and MUST NOT throw into the caller: the child is
 * detached + unref'd, and a missing helper (e.g. no notify-send) just means no
 * popup — the tray title still reflects the state. argv-only spawns (never a
 * shell string); the message/title are our own strings, but we escape them for
 * the embedded PowerShell/AppleScript literals anyway.
 */

import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

export interface NotifyCommand {
  cmd: string
  args: string[]
}

/** Escape a string for a PowerShell single-quoted literal ('' = one quote). */
function psLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** Escape a string for an AppleScript double-quoted literal. */
function asLiteral(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The per-OS command to show a popup with `title`/`message`. Pure + exported so
 * the escaping is unit-tested without spawning anything. Single-line messages
 * only (avoids cross-platform newline-escaping quirks).
 */
export function buildNotifyCommand(
  title: string,
  message: string,
  platform: NodeJS.Platform = process.platform,
): NotifyCommand {
  if (platform === 'win32') {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms;' +
      `[void][System.Windows.Forms.MessageBox]::Show(${psLiteral(message)},${psLiteral(title)})`
    return {
      cmd: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    }
  }
  if (platform === 'darwin') {
    const script =
      `display dialog ${asLiteral(message)} with title ${asLiteral(title)} ` +
      'buttons {"OK"} default button "OK" with icon note'
    return { cmd: 'osascript', args: ['-e', script] }
  }
  // Linux / other POSIX — libnotify. Args are passed directly (no shell), so no
  // quoting needed; if notify-send is absent the spawn 'error' is swallowed.
  return { cmd: 'notify-send', args: [title, message] }
}

/**
 * Show a native popup, best-effort. Never throws; logs nothing on failure
 * (the optional `onError` lets the caller note it if desired).
 */
export function notify(
  title: string,
  message: string,
  onError?: (msg: string) => void,
): void {
  try {
    const { cmd, args } = buildNotifyCommand(title, message)
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (err) => onError?.(`notify unavailable: ${err.message}`))
    child.unref()
  } catch (err) {
    onError?.(`notify failed: ${(err as Error).message}`)
  }
}

// ── Interactive Install / Cancel confirmation ────────────────────────────────

/**
 * A WinForms dialog (Install / Cancel) as a PowerShell script. Exits 0 for
 * Install, 1 for Cancel/closed. Pure + exported for unit-testing the escaping;
 * run via `powershell -File` (written to a temp file to avoid command-line
 * quoting of the multi-line script).
 */
export function buildConfirmPowerShellScript(title: string, message: string): string {
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$f = New-Object System.Windows.Forms.Form',
    `$f.Text = ${psLiteral(title)}`,
    '$f.ClientSize = New-Object System.Drawing.Size(400,150)',
    `$f.StartPosition = 'CenterScreen'`,
    `$f.FormBorderStyle = 'FixedDialog'`,
    '$f.TopMost = $true',
    '$f.MaximizeBox = $false',
    '$f.MinimizeBox = $false',
    '$l = New-Object System.Windows.Forms.Label',
    `$l.Text = ${psLiteral(message)}`,
    '$l.SetBounds(20,20,360,55)',
    '$f.Controls.Add($l)',
    '$ok = New-Object System.Windows.Forms.Button',
    `$ok.Text = 'Install'`,
    '$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK',
    '$ok.SetBounds(200,95,85,30)',
    '$cancel = New-Object System.Windows.Forms.Button',
    `$cancel.Text = 'Cancel'`,
    '$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel',
    '$cancel.SetBounds(295,95,85,30)',
    '$f.Controls.Add($ok)',
    '$f.Controls.Add($cancel)',
    '$f.AcceptButton = $ok',
    '$f.CancelButton = $cancel',
    '$r = $f.ShowDialog()',
    'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { exit 0 } else { exit 1 }',
    '',
  ].join('\r\n')
}

/** osascript Install/Cancel dialog. Exits 0 on Install, non-zero on Cancel. */
export function buildConfirmAppleScript(title: string, message: string): string {
  return (
    `display dialog ${asLiteral(message)} with title ${asLiteral(title)} ` +
    'buttons {"Cancel", "Install"} default button "Install" with icon note'
  )
}

/** zenity Install/Cancel question args. Exit 0 = Install, 1 = Cancel. */
export function buildConfirmZenityArgs(title: string, message: string): string[] {
  return ['--question', `--title=${title}`, `--text=${message}`, '--ok-label=Install', '--cancel-label=Cancel']
}

/**
 * Show a native Install/Cancel dialog and resolve true iff the user chose
 * Install. Best-effort: resolves false (never rejects) if no GUI helper is
 * available. The launcher passes this into the updater runtime.
 */
export function confirmInstall(
  title: string,
  message: string,
  onError?: (msg: string) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => resolve(ok)
    try {
      const platform = process.platform
      if (platform === 'win32') {
        const tmp = path.join(os.tmpdir(), `rs-confirm-${process.pid}-${Date.now()}.ps1`)
        fs.writeFileSync(tmp, buildConfirmPowerShellScript(title, message))
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { windowsHide: true })
        child.on('error', (err) => { onError?.(`confirm unavailable: ${err.message}`); done(false) })
        child.on('close', (code) => { try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ } done(code === 0) })
        return
      }
      if (platform === 'darwin') {
        const child = spawn('osascript', ['-e', buildConfirmAppleScript(title, message)])
        child.on('error', (err) => { onError?.(`confirm unavailable: ${err.message}`); done(false) })
        child.on('close', (code) => done(code === 0))
        return
      }
      const child = spawn('zenity', buildConfirmZenityArgs(title, message))
      child.on('error', (err) => { onError?.(`confirm unavailable: ${err.message}`); done(false) })
      child.on('close', (code) => done(code === 0))
    } catch (err) {
      onError?.(`confirm failed: ${(err as Error).message}`)
      done(false)
    }
  })
}
