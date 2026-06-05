/**
 * System-tray icon for the desktop build (Windows / macOS / Linux).
 *
 * Built on `systray2`, which drives a tiny per-platform helper binary over
 * stdio — so menu clicks arrive back here as ordinary in-process events (no
 * Electron, no native addon). The tray gives the user a clean way to **quit**
 * the app: closing the browser tab leaves the local server running, and quitting
 * from inside the web UI would be confusing (the page would then error). The
 * tray Quit runs the same graceful shutdown as Ctrl-C in the launcher window.
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

export interface TrayHandlers {
  /** Re-open the app in the browser. */
  onOpen: () => void
  /** Begin a graceful shutdown. */
  onQuit: () => void
}

/**
 * Pure dispatch: map a clicked menu-item title to the right handler. Exported so
 * the routing is unit-tested without spawning the helper binary.
 */
export function routeClick(title: string | undefined, handlers: TrayHandlers): void {
  if (title === TRAY_OPEN) handlers.onOpen()
  else if (title === TRAY_QUIT) handlers.onQuit()
}

export interface TrayHandle { kill: () => void }

export interface TrayOptions extends TrayHandlers {
  log: (msg: string) => void
}

/**
 * Create the tray icon. Resolves to a handle (with `kill`) on success, or null
 * if the tray couldn't start — callers treat null as "no tray, that's fine".
 */
export async function startTray(opts: TrayOptions): Promise<TrayHandle | null> {
  try {
    const systray = new SysTray({
      menu: {
        icon: trayIconBase64(),
        // macOS renders a template (monochrome) icon better; our mark is
        // coloured, so opt out so it shows as-is.
        isTemplateIcon: false,
        title: 'Resume Studio',
        tooltip: 'Resume Studio',
        items: [
          { title: TRAY_OPEN, tooltip: 'Open Resume Studio in your browser', enabled: true },
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
    await systray.onClick((action) => routeClick(action.item?.title, opts))
    systray.onError((err) => opts.log(`  tray       : error — ${err.message}`))
    opts.log('  tray       : ready (right-click the tray icon for Open / Quit)')
    // kill(false): tear down the helper WITHOUT exiting node — the launcher's
    // own shutdown sequence owns the exit so the DB/backup are flushed first.
    return { kill: () => { try { void systray.kill(false) } catch { /* ignore */ } } }
  } catch (err) {
    opts.log(`  tray       : unavailable (${(err as Error).message}) — use the window/Ctrl-C to quit`)
    return null
  }
}
