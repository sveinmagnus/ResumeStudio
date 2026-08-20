import { useEffect, useState } from 'react'
import { ServerError, UnauthorizedError, api, type AuthStatus, type BootstrapResult } from '../lib/api'
import { AuthShell, AuthField } from './account/AuthShell'
import { RecoveryCodesPanel } from './account/RecoveryCodesPanel'
import { signOut } from './ui/signOut'

interface AuthGateProps {
  /**
   * Called once a session exists. The app drops the gate and remounts its
   * route so every fetch runs again with the new cookie.
   */
  onAuthenticated: () => void
}

/**
 * The sign-in screen, shown whenever the API answers 401.
 *
 * It asks the server what kind of instance this is before deciding what to
 * render, because three different things can be true:
 *
 *  - **no accounts yet, a bootstrap code waiting** — the first-run setup form.
 *  - **accounts** — username-or-email and a password.
 *  - **token** — the pre-accounts single shared secret, still valid until
 *    somebody creates the first account. An instance mid-upgrade must not be
 *    shown a login form it has no accounts for.
 */
export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.authStatus().then((s) => { if (!cancelled) setStatus(s) })
    return () => { cancelled = true }
  }, [])

  if (!status) {
    return <AuthShell title="Resume Studio"><p role="status">Connecting…</p></AuthShell>
  }
  if (status.bootstrap_available) {
    return <BootstrapForm onAuthenticated={onAuthenticated} />
  }
  if (status.mode === 'token') {
    return <TokenForm onAuthenticated={onAuthenticated} />
  }
  return <PasswordForm status={status} onAuthenticated={onAuthenticated} />
}

// ─── Accounts mode ──────────────────────────────────────────────────────────

function PasswordForm({ status, onAuthenticated }: AuthGateProps & { status: AuthStatus }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      await api.loginWithPassword(login, password)
      onAuthenticated()
    } catch (err) {
      // The server's message, verbatim. It is deliberately identical for an
      // unknown account and a wrong password — rewording it into something more
      // specific would answer "does this person have an account here", which
      // for a CV tool is itself the sensitive answer.
      setError(err instanceof ServerError ? err.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Sign in"
      intro="Resume Studio"
      footer={
        <>
          {/* Hidden rather than disabled when this server cannot send mail —
              the same rule the AI surface follows. A disabled control
              advertises a feature while refusing it. */}
          {status.mail_configured && <a className="auth-link" href="/forgot">Forgotten password?</a>}
          <a className="auth-link" href="/recover">Use a recovery code</a>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <AuthField
          label="Username or email address"
          value={login}
          onChange={setLogin}
          autoComplete="username"
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button type="submit" className="auth-submit" disabled={busy || !login.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <ClearLocalData />
    </AuthShell>
  )
}

// ─── Legacy token mode ──────────────────────────────────────────────────────

function TokenForm({ onAuthenticated }: AuthGateProps) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    try {
      await api.login(token)
      await api.listResumes()
      onAuthenticated()
    } catch (err) {
      setError(err instanceof UnauthorizedError
        ? 'Token is incorrect. Please try again.'
        : 'Could not connect to server.')
    }
  }

  return (
    <AuthShell
      title="Resume Studio"
      intro="This instance is protected. Enter your API token to continue."
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <input
          className="auth-input"
          type="password"
          placeholder="Paste token here…"
          aria-label="API token"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button type="submit" className="auth-submit" disabled={!token.trim()}>
          Connect
        </button>
      </form>
      <ClearLocalData />
    </AuthShell>
  )
}

// ─── First run ──────────────────────────────────────────────────────────────

/**
 * The zero-configuration first account.
 *
 * The one-time code is printed to stdout and the server log and held in memory
 * only, so a restart re-issues it — which is why the error names the log rather
 * than telling the operator to look in a file.
 */
function BootstrapForm({ onAuthenticated }: AuthGateProps) {
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BootstrapResult | null>(null)

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      setResult(await api.bootstrap({
        code, username, display_name: displayName, password,
      }))
    } catch (err) {
      setError(err instanceof ServerError ? err.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <AuthShell
        title="You are set up"
        intro={result.claimed_resumes > 0
          ? `${result.claimed_resumes} existing resume${result.claimed_resumes === 1 ? '' : 's'} now belong to your account.`
          : undefined}
      >
        {result.converted_tokens.length > 0 && (
          <div className="auth-note">
            <strong>Named API tokens have become accounts.</strong> They no longer sign
            anyone in, and each was created without a usable password:
            <ul className="bs-converted">
              {result.converted_tokens.map((name) => <li key={name}><code>{name}</code></li>)}
            </ul>
            Issue each of them a reset link from the team page before they can sign in.
          </div>
        )}
        <RecoveryCodesPanel codes={result.recovery_codes} onAcknowledge={onAuthenticated} />
        <style>{`
          .bs-converted { list-style: none; margin: 8px 0; display: flex; flex-wrap: wrap; gap: 6px; }
          .bs-converted code {
            font-size: 12px; padding: 2px 7px; border-radius: var(--r-sm);
            background: var(--paper); border: 1px solid var(--line); color: var(--ink);
          }
        `}</style>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Set up your account"
      intro="Nobody has an account on this server yet. Paste the one-time code the server printed to its log to create the first one, which becomes the owner."
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <AuthField
          label="One-time setup code" value={code} onChange={setCode} autoComplete="off"
          hint="Printed to stdout and resume-studio.log at start-up. Restarting issues a new one."
        />
        <AuthField
          label="Username" value={username} onChange={setUsername} autoComplete="username"
          hint="Letters, digits, dot, dash or underscore."
        />
        <AuthField
          label="Display name" value={displayName} onChange={setDisplayName} autoComplete="name"
          hint="How your name appears on saves and in the team list."
        />
        <AuthField
          label="Password" type="password" value={password} onChange={setPassword}
          autoComplete="new-password"
          hint="At least 12 characters. No other rules — length is what matters."
        />
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button
          type="submit" className="auth-submit"
          disabled={busy || !code.trim() || !username.trim() || !password}
        >
          {busy ? 'Creating…' : 'Create the owner account'}
        </button>
      </form>
    </AuthShell>
  )
}

// ─── Shared ─────────────────────────────────────────────────────────────────

/**
 * Explicit logout from the gate itself: end the session AND wipe the plaintext
 * resume caches this browser holds. Sitting at a sign-in screen is exactly when
 * the person at the keyboard may not be the one whose CV is cached here.
 */
function ClearLocalData() {
  return (
    <button className="auth-clear" onClick={() => void signOut()}>
      Clear local data
      <style>{`
        .auth-clear {
          display: block; margin: 14px auto 0;
          font-size: 12px; color: var(--ink-faint); text-decoration: underline;
        }
        .auth-clear:hover { color: var(--accent); }
      `}</style>
    </button>
  )
}
