import { useState } from 'react'
import { UnauthorizedError, api } from '../lib/api'
import { clearAllCaches, listDirty } from '../lib/localCache'

const YEAR = new Date().getFullYear()

interface AuthGateProps {
  /**
   * Exchange the entered token for a load. Resolves on success; rejects with
   * the underlying error so we can show the right message. Provided by
   * `useResumePersistence().submitToken`.
   */
  onSubmit: (token: string) => Promise<void>
}

/**
 * Token-entry modal shown when the server returns 401. Owns only its own
 * input/error UI state; the actual token exchange + load lives in the
 * persistence hook (passed in as `onSubmit`).
 */
export function AuthGate({ onSubmit }: AuthGateProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [authError, setAuthError]   = useState('')

  const handleSubmit = async () => {
    setAuthError('')
    try {
      await onSubmit(tokenInput)
    } catch (err) {
      setAuthError(
        err instanceof UnauthorizedError
          ? 'Token is incorrect. Please try again.'
          : 'Could not connect to server.',
      )
    }
  }

  return (
    <div className="auth-overlay">
      <div className="auth-card">

        {/* Cartavio branding */}
        <img src="/cartavio-logo.png" alt="Cartavio" className="auth-logo" />
        <h2 className="auth-title">Resume Studio</h2>
        <p className="auth-desc">
          This instance is protected. Enter your API token to continue.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}
        >
          <input
            className="auth-input"
            type="password"
            placeholder="Paste token here…"
            aria-label="API token"
            autoComplete="off"
            spellCheck={false}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            autoFocus
          />
          {authError && <div className="auth-error">{authError}</div>}
          <button
            type="submit"
            className="auth-submit"
            disabled={!tokenInput.trim()}
          >
            Connect
          </button>
        </form>
        <button
          className="auth-clear"
          onClick={() => {
            // Deliberate logout: clear the server session cookie AND the
            // plaintext resume caches in localStorage. Closes the shared-machine
            // data-leak residual (security skill). Guard first — clearing the
            // caches also discards any unsynced offline edits, so warn if the
            // queue is non-empty and let the user back out to export a backup.
            const dirty = listDirty().length
            if (
              dirty > 0 &&
              !window.confirm(
                `You have ${dirty} resume(s) with unsynced changes. ` +
                `Clearing local data also deletes the local copies — ` +
                `export a backup first if unsure. Clear anyway?`,
              )
            ) return
            void api.logout()
            clearAllCaches()
            setTokenInput('')
          }}
        >
          Clear local data
        </button>

        <div className="auth-footer">
          © {YEAR} Cartavio AS ·{' '}
          <a href="https://cartavio.no" target="_blank" rel="noopener noreferrer">
            cartavio.no
          </a>
        </div>
      </div>

      <style>{`
        .auth-overlay { min-height: 100vh; display: grid; place-items: center; padding: 40px; }
        .auth-card {
          max-width: 400px; width: 100%; text-align: center;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-lg); padding: 36px 32px 28px; box-shadow: var(--shadow-lg);
        }

        /* Logo */
        .auth-logo { width: 160px; height: auto; margin: 0 auto 16px; display: block; }

        /* Headings */
        .auth-title { font-size: 20px; margin-bottom: 8px; color: var(--accent); }
        .auth-desc  { color: var(--ink-soft); font-size: 13.5px; line-height: 1.6; margin-bottom: 22px; }

        /* Input */
        .auth-input {
          width: 100%; padding: 10px 14px; border: 1.5px solid var(--line-strong);
          border-radius: var(--r-md); font-size: 14px; margin-bottom: 10px;
          background: var(--paper-sunken); color: var(--ink);
        }
        .auth-input:focus { outline: none; border-color: var(--accent); }

        /* Error */
        .auth-error {
          font-size: 13px; color: #c0392b; background: #fdf0ef;
          padding: 8px 12px; border-radius: var(--r-sm); margin-bottom: 10px;
        }

        /* Buttons */
        .auth-submit {
          width: 100%; padding: 11px; background: var(--accent); color: #fff;
          border-radius: var(--r-md); font-weight: 600; font-size: 15px;
          transition: opacity .15s; margin-bottom: 8px;
        }
        .auth-submit:disabled { opacity: .4; cursor: not-allowed; }
        .auth-submit:not(:disabled):hover { opacity: .88; }
        .auth-clear { font-size: 12px; color: var(--ink-faint); text-decoration: underline; }

        /* Card footer */
        .auth-footer {
          margin-top: 20px; padding-top: 16px;
          border-top: 1px solid var(--line);
          font-size: 11px; color: var(--ink-faint);
        }
        .auth-footer a { color: var(--ink-faint); text-decoration: none; }
        .auth-footer a:hover { color: var(--accent); }
      `}</style>
    </div>
  )
}
