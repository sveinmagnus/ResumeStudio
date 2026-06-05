/**
 * Open a URL in the user's default browser, cross-platform, with zero deps.
 *
 * We deliberately avoid the `open` npm package: it's one more dependency to
 * vendor into the portable build, and the platform incantations are trivial.
 * Fire-and-forget — the child is detached and unref'd so it never keeps the
 * server process alive, and a failure to launch the browser is non-fatal (the
 * launcher logs the URL so the user can open it manually).
 */

import { spawn } from 'child_process'

export function openBrowser(url: string): void {
  const platform = process.platform
  try {
    if (platform === 'win32') {
      // `start` is a cmd builtin; the empty "" is the (ignored) window title,
      // required so a quoted URL isn't itself treated as the title.
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      // Linux / BSD — xdg-open is the freedesktop standard.
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {
    // Swallow — the caller already logged the URL as a fallback.
  }
}
