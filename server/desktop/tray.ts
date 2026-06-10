/**
 * System-tray icon for the desktop build (Windows / macOS / Linux).
 *
 * Built on `systray2`, which drives a tiny per-platform helper binary over
 * stdio — so menu clicks arrive back here as ordinary in-process events (no
 * Electron, no native addon). The menu:
 *
 *   Cartavio Resume Studio vX.Y.Z   (disabled header — shows the current version)
 *   ───────────────
 *   Open Resume Studio
 *   ───────────────
 *   Check for updates               (always enabled; disabled only mid-operation)
 *   Install update                  (enabled only when an update is ready)
 *   ───────────────
 *   Quit Resume Studio
 *
 * Everything here is best-effort and MUST NOT be fatal: on a headless box, a
 * Linux session without a StatusNotifier, or if the helper can't start, we log
 * and carry on — the launcher window (or Ctrl-C) is always the fallback.
 */

import * as systray2NS from 'systray2'
import { trayIconBase64 } from './trayIcon.js'

// systray2 is a CommonJS module (`exports.default = SysTray`, `__esModule`).
// CJS→ESM interop lands the actual constructor in different places under tsx
// (dev) vs the esbuild Node-mode bundle (where the default is the whole
// module.exports), so resolve it defensively rather than trusting one shape.
type SysTrayCtor = typeof import('systray2').default
const SysTray: SysTrayCtor = (() => {
  const ns = systray2NS as unknown as { default?: { default?: unknown } }
  const d = ns.default
  if (typeof d === 'function') return d as SysTrayCtor
  if (d && typeof d.default === 'function') return d.default as SysTrayCtor
  return systray2NS as unknown as SysTrayCtor
})()

export const TRAY_OPEN = 'Open Resume Studio'
export const TRAY_QUIT = 'Quit Resume Studio'
export const TRAY_CHECK_DEFAULT = 'Check for updates'
export const TRAY_INSTALL_DEFAULT = 'Install update'

export interface TrayHandlers {
  /** Re-open the app in the browser. */
  onOpen: () => void
  /** Begin a graceful shutdown. */
  onQuit: () => void
  /** Manually check for updates. */
  onCheck: () => void
  /** Install the available update. */
  onInstall: () => void
}

/** How the version header + the two update items should currently render. */
export interface TrayUpdateView {
  versionLabel: string
  checkTitle: string
  checkEnabled: boolean
  installTitle: string
  installEnabled: boolean
}

/**
 * Pure dispatch: map a clicked menu-item title to the right handler. The update
 * items' titles change over time (Check → Checking…, Install → Downloading…),
 * so the caller passes the CURRENT titles for a robust match. Exported so the
 * routing is unit-tested without spawning the helper binary.
 */
export function routeClick(
  title: string | undefined,
  handlers: TrayHandlers,
  titles: { check: string; install: string },
): void {
  if (title === TRAY_OPEN) handlers.onOpen()
  else if (title === TRAY_QUIT) handlers.onQuit()
  else if (title && title === titles.check) handlers.onCheck()
  else if (title && title === titles.install) handlers.onInstall()
}

export interface TrayHandle {
  kill: () => void
  /** Update the version header + the two update items live. */
  setUpdate: (view: TrayUpdateView) => void
}

export interface TrayOptions extends TrayHandlers {
  log: (msg: string) => void
  /** Initial version header + item state (so the menu shows the version at once). */
  initialView: TrayUpdateView
}

/**
 * Create the tray icon. Resolves to a handle (with `kill` + `setUpdate`) on
 * success, or null if the tray couldn't start — callers treat null as "no tray,
 * that's fine".
 */
export async function startTray(opts: TrayOptions): Promise<TrayHandle | null> {
  try {
    const versionItem = { title: opts.initialView.versionLabel, tooltip: 'Installed version', enabled: false }
    const checkItem = { title: opts.initialView.checkTitle, tooltip: 'Check GitHub for a newer version', enabled: opts.initialView.checkEnabled }
    const installItem = { title: opts.initialView.installTitle, tooltip: 'Install the available update', enabled: opts.initialView.installEnabled }
    // Current titles for routeClick — kept in sync with the items so clicks
    // match even after the titles change.
    let checkTitle = checkItem.title
    let installTitle = installItem.title

    const systray = new SysTray({
      menu: {
        icon: trayIconBase64(),
        // macOS renders a template (monochrome) icon better; our mark is
        // coloured, so opt out so it shows as-is.
        isTemplateIcon: false,
        title: 'Resume Studio',
        tooltip: 'Resume Studio',
        items: [
          versionItem,
          SysTray.separator,
          { title: TRAY_OPEN, tooltip: 'Open Resume Studio in your browser', enabled: true },
          SysTray.separator,
          checkItem,
          installItem,
          SysTray.separator,
          { title: TRAY_QUIT, tooltip: 'Stop Resume Studio', enabled: true },
        ],
      },
      debug: false,
      copyDir: false,
    })

    // Order matters: SysTray.init() is async, so _process/_rl stay null until
    // ready() resolves. Registering onClick/onError before that dereferences
    // null (systray2's onError does `this._process.on(...)`). So wait first.
    await systray.ready()
    await systray.onClick((action) => routeClick(action.item?.title, opts, { check: checkTitle, install: installTitle }))
    systray.onError((err) => opts.log(`  tray       : error — ${err.message}`))
    opts.log('  tray       : ready (right-click the tray icon for Open / Updates / Quit)')

    const push = (item: { title: string }) => {
      try { void systray.sendAction({ type: 'update-item', item: item as never }) } catch { /* best-effort */ }
    }

    return {
      // kill(false): tear down the helper WITHOUT exiting node — the launcher's
      // own shutdown sequence owns the exit so the DB/backup are flushed first.
      kill: () => { try { void systray.kill(false) } catch { /* ignore */ } },
      setUpdate: (view: TrayUpdateView) => {
        versionItem.title = view.versionLabel
        checkItem.title = view.checkTitle
        checkItem.enabled = view.checkEnabled
        installItem.title = view.installTitle
        installItem.enabled = view.installEnabled
        checkTitle = view.checkTitle
        installTitle = view.installTitle
        push(versionItem); push(checkItem); push(installItem)
      },
    }
  } catch (err) {
    opts.log(`  tray       : unavailable (${(err as Error).message}) — use the window/Ctrl-C to quit`)
    return null
  }
}
