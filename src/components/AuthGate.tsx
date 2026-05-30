import { useState } from 'react'
import { Server } from 'lucide-react'
import { UnauthorizedError, getStoredToken, clearStoredToken } from '../lib/api'

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
  const [authError, setAuthError] = useState('')

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
        <div className="auth-icon"><Server size={28} /></div>
        <h2 className="auth-title">API Token Required</h2>
        <p className="auth-desc">
          This Resume Studio server is protected. Enter your API token to continue.
        </p>
        <input
          className="auth-input"
          type="password"
          placeholder="Paste token here…"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit() }}
          autoFocus
        />
        {authError && <div className="auth-error">{authError}</div>}
        <button
          className="auth-submit"
          onClick={() => void handleSubmit()}
          disabled={!tokenInput.trim()}
        >
          Connect
        </button>
        {getStoredToken() && (
          <button className="auth-clear" onClick={() => { clearStoredToken(); setTokenInput('') }}>
            Clear saved token
          </button>
        )}
      </div>

      <style>{`
        .auth-overlay { min-height: 100vh; display: grid; place-items: center; padding: 40px; }
        .auth-card {
          max-width: 420px; width: 100%; text-align: center;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-lg); padding: 40px 36px; box-shadow: var(--shadow-lg);
        }
        .auth-icon {
          width: 60px; height: 60px; margin: 0 auto 20px; border-radius: 50%;
          background: var(--accent-wash); color: var(--accent); display: grid; place-items: center;
        }
        .auth-title { font-size: 22px; margin-bottom: 10px; }
        .auth-desc  { color: var(--ink-soft); font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
        .auth-input {
          width: 100%; padding: 10px 14px; border: 1.5px solid var(--line-strong);
          border-radius: var(--r-md); font-size: 14px; margin-bottom: 10px;
          background: var(--paper-sunken); color: var(--ink);
        }
        .auth-input:focus { outline: none; border-color: var(--accent); }
        .auth-error {
          font-size: 13px; color: #c0392b; background: #fdf0ef;
          padding: 8px 12px; border-radius: var(--r-sm); margin-bottom: 10px;
        }
        .auth-submit {
          width: 100%; padding: 11px; background: var(--accent); color: #fff;
          border-radius: var(--r-md); font-weight: 600; font-size: 15px;
          transition: opacity .15s; margin-bottom: 10px;
        }
        .auth-submit:disabled { opacity: .4; cursor: not-allowed; }
        .auth-submit:not(:disabled):hover { opacity: .88; }
        .auth-clear { font-size: 12px; color: var(--ink-faint); text-decoration: underline; }
      `}</style>
    </div>
  )
}
