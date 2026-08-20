import { useEffect, useState } from 'react'
import { api, type AuthStatus } from '../../lib/api'
import { navigate } from '../../lib/router'

/**
 * The way accounts are discovered on an instance that does not have them yet.
 *
 * WHY THIS EXISTS. `AuthGate` renders the first-run setup form, but the gate is
 * only mounted after a 401 — and an instance in `open` mode never returns one.
 * So on a fresh server the code was printed to the console, the API reported
 * `bootstrap_available: true`, and the app showed the ordinary picker: the
 * entire accounts feature was unreachable through the UI.
 *
 * OFFERED, NOT FORCED. An `open` instance genuinely works without accounts —
 * that is the desktop build and every local dev run — so blocking on a setup
 * form would be wrong. What is worth saying either way is the part people
 * cannot see: with no accounts, anybody who can reach this server reads and
 * edits every CV on it. That sentence is the reason to set them up, so it is
 * the notice rather than a bare button.
 *
 * Dismissible, and it stays dismissed for the session only. A permanent
 * dismissal would quietly hide an accurate warning about an open server.
 */
export function SetupNotice() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.authStatus()
      .then((s) => { if (!cancelled) setStatus(s) })
      .catch(() => { /* offline or unreachable — the picker says so already */ })
    return () => { cancelled = true }
  }, [])

  if (dismissed || !status?.bootstrap_available) return null

  return (
    <section className="setup-notice" role="status" aria-label="Account setup available">
      <div className="setup-notice-body">
        <strong className="setup-notice-title">This instance has no accounts</strong>
        <p className="setup-notice-text">
          Anyone who can reach this server can read and edit every CV on it. Set up
          accounts to give each person their own, private by default. You will need
          the one-time code printed in the server&rsquo;s output.
        </p>
      </div>
      <div className="setup-notice-actions">
        <button type="button" className="setup-notice-go" onClick={() => navigate('/setup')}>
          Set up accounts
        </button>
        <button
          type="button"
          className="setup-notice-hide"
          onClick={() => setDismissed(true)}
        >
          Not now
        </button>
      </div>
      <style>{`
        .setup-notice {
          display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;
          justify-content: space-between;
          margin: 0 0 20px; padding: 14px 16px;
          background: var(--warn-wash); border: 1px solid var(--line);
          border-left: 3px solid var(--warn-ink); border-radius: var(--r-md);
        }
        .setup-notice-body { flex: 1 1 320px; min-width: 0; }
        .setup-notice-title {
          display: block; font-size: 13px; color: var(--warn-ink); margin-bottom: 4px;
        }
        .setup-notice-text {
          margin: 0; font-size: 12px; line-height: 1.5; color: var(--ink-soft);
        }
        .setup-notice-actions { display: flex; gap: 8px; align-items: center; }
        .setup-notice-go, .setup-notice-hide {
          font: inherit; font-size: 12px; padding: 7px 12px;
          border-radius: var(--r-sm); cursor: pointer;
          transition: background-color .15s ease, border-color .15s ease;
        }
        .setup-notice-go {
          background: var(--accent); color: #fff; border: 1px solid var(--accent);
        }
        .setup-notice-go:hover { background: var(--accent-bright); }
        .setup-notice-hide {
          background: transparent; color: var(--ink-soft); border: 1px solid var(--line);
        }
        .setup-notice-hide:hover { border-color: var(--ink-faint); color: var(--ink); }
      `}</style>
    </section>
  )
}
