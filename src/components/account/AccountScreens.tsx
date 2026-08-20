/**
 * The screens a person reaches WITHOUT being signed in.
 *
 * That is the whole reason they live outside `AuthGate` rather than inside it:
 * everyone who follows a reset link, an invitation, or a verification link is
 * by definition somebody the sign-in gate would otherwise swallow — and
 * dropping them on a login form they cannot fill in is exactly the dead end
 * these links exist to open.
 *
 * All five share one shape: read the one-time token out of the query string
 * once on mount, POST it, and say plainly what happened.
 */
import { useEffect, useState } from 'react'
import { ServerError, api, type InviteInfo } from '../../lib/api'
import { navigate } from '../../lib/router'
import type { AccountScreen } from '../../lib/router'
import { AuthShell, AuthField } from './AuthShell'
import { RecoveryCodesPanel } from './RecoveryCodesPanel'

/** The minimum the server enforces; stated up front rather than after a refusal. */
const PASSWORD_HINT = 'At least 12 characters. No other rules — length is what matters.'

/**
 * The token from `?token=`, read once.
 *
 * The router keys on `pathname` alone (see `lib/router.ts`), so the query is
 * read here rather than routed on — which is all a single-use link needs.
 */
function useLinkToken(): string {
  const [token] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('token') ?? ''
  })
  return token
}

/** The server's own wording where there is one; a plain fallback otherwise. */
function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ServerError) return err.message
  return err instanceof Error && err.message ? err.message : fallback
}

interface ScreenProps {
  /** Called once a session exists, so the app drops its sign-in gate. */
  onSignedIn: () => void
}

// ─── Reset ──────────────────────────────────────────────────────────────────

/**
 * `/reset?token=` — the single redemption path behind all four reset triggers.
 *
 * It does NOT sign the user in afterwards, and that is the server's design
 * rather than an omission: setting a password ends every session for the
 * account, because a reset exists precisely because the old credential may be
 * in somebody else's hands.
 */
export function ResetScreen() {
  const token = useLinkToken()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setError('')
    if (password !== confirm) { setError('The two passwords do not match.'); return }
    setBusy(true)
    try {
      await api.resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(messageOf(err, 'Could not reset the password.'))
    } finally {
      setBusy(false)
    }
  }

  if (!token) return <MissingToken title="Set a new password" />

  if (done) {
    return (
      <AuthShell
        title="Password changed"
        intro="Every session for this account has been signed out, including any the old password left open. Sign in with the new one."
      >
        <button type="button" className="auth-submit" onClick={() => navigate('/')}>
          Go to sign in
        </button>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Set a new password" intro="This link works once.">
      <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <AuthField
          label="New password" type="password" value={password} onChange={setPassword}
          autoComplete="new-password" hint={PASSWORD_HINT}
        />
        <AuthField
          label="Repeat the new password" type="password" value={confirm} onChange={setConfirm}
          autoComplete="new-password"
        />
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button type="submit" className="auth-submit" disabled={busy || !password}>
          {busy ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </AuthShell>
  )
}

// ─── Recovery code ──────────────────────────────────────────────────────────

/**
 * `/recover` — spend one of the codes issued at signup.
 *
 * The only way back in that needs neither an administrator nor a mailbox, so it
 * is offered unconditionally: unlike the email trigger it cannot be
 * unconfigured.
 */
export function RecoverScreen() {
  const [login, setLogin] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState<number | null>(null)

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      setLeft(await api.recoverWithCode(login, code, password))
    } catch (err) {
      setError(messageOf(err, 'Could not use that recovery code.'))
    } finally {
      setBusy(false)
    }
  }

  if (left !== null) {
    return (
      <AuthShell
        title="Password changed"
        intro={left === 0
          ? 'That was your last recovery code. Generate a new set from your profile once you are signed in.'
          : `${left} recovery code${left === 1 ? '' : 's'} left. Each one works once.`}
      >
        <button type="button" className="auth-submit" onClick={() => navigate('/')}>
          Go to sign in
        </button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Use a recovery code"
      intro="One of the codes you saved when the account was created. Dashes and capitals do not matter."
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <AuthField
          label="Username or email address" value={login} onChange={setLogin}
          autoComplete="username"
        />
        <AuthField label="Recovery code" value={code} onChange={setCode} autoComplete="off" />
        <AuthField
          label="New password" type="password" value={password} onChange={setPassword}
          autoComplete="new-password" hint={PASSWORD_HINT}
        />
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button
          type="submit" className="auth-submit"
          disabled={busy || !login.trim() || !code.trim() || !password}
        >
          {busy ? 'Checking…' : 'Set new password'}
        </button>
      </form>
      <div className="auth-links">
        <a className="auth-link" href="/">Back to sign in</a>
      </div>
    </AuthShell>
  )
}

// ─── Forgot password ────────────────────────────────────────────────────────

/**
 * `/forgot` — ask for a reset email.
 *
 * The server answers identically whether or not the account exists, whether or
 * not it has an address, and whether or not that address is verified — so the
 * screen must not claim a message was sent. Saying "if that account exists…"
 * is not hedging; it is the only true sentence available here, and a cheerful
 * "check your inbox" would turn this form into a "does this person work here"
 * oracle for anyone who cared to ask.
 */
export function ForgotScreen() {
  const [login, setLogin] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    await api.forgotPassword(login)
    setBusy(false)
    setSent(true)
  }

  return (
    <AuthShell
      title="Forgotten password"
      intro="Enter your username or email address and we will send a reset link to the verified address on the account."
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <AuthField
          label="Username or email address" value={login} onChange={setLogin}
          autoComplete="username" disabled={sent}
        />
        {sent
          ? (
            <div className="auth-ok" role="status">
              If that account exists and has a verified address, a link is on its way.
              It expires in 30 minutes and works once.
            </div>
          )
          : (
            <button type="submit" className="auth-submit" disabled={busy || !login.trim()}>
              {busy ? 'Sending…' : 'Send a reset link'}
            </button>
          )}
      </form>
      <div className="auth-links">
        <a className="auth-link" href="/">Back to sign in</a>
        <a className="auth-link" href="/recover">Use a recovery code instead</a>
      </div>
    </AuthShell>
  )
}

// ─── Accept an invitation ───────────────────────────────────────────────────

/** `/accept?token=` — redeem an invitation and choose your own credentials. */
export function AcceptInviteScreen({ onSignedIn }: ScreenProps) {
  const token = useLinkToken()
  const [info, setInfo] = useState<InviteInfo | null | 'loading'>('loading')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)

  useEffect(() => {
    if (!token) { setInfo(null); return }
    let cancelled = false
    void api.inviteInfo(token).then((i) => { if (!cancelled) setInfo(i) })
    return () => { cancelled = true }
  }, [token])

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await api.acceptInvite({
        token, username, display_name: displayName, password,
      })
      setCodes(res.recovery_codes)
    } catch (err) {
      setError(messageOf(err, 'Could not create that account.'))
    } finally {
      setBusy(false)
    }
  }

  if (!token) return <MissingToken title="Accept your invitation" />

  if (codes) {
    return (
      <AuthShell title="Account created" intro="You are signed in. One thing first.">
        <RecoveryCodesPanel
          codes={codes}
          onAcknowledge={() => { onSignedIn(); navigate('/') }}
        />
      </AuthShell>
    )
  }

  if (info === 'loading') {
    return <AuthShell title="Accept your invitation"><p role="status">Checking the invitation…</p></AuthShell>
  }

  if (info === null) {
    return (
      <AuthShell
        title="Accept your invitation"
        intro="That invitation has expired or has already been used. Ask whoever invited you for a new link."
      >
        <a className="auth-link" href="/">Back to sign in</a>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Accept your invitation"
      intro={info.role === 'owner'
        ? 'You have been invited as an owner, which can see and manage every resume on this instance.'
        : 'Choose how you sign in. Your resumes are private to you unless you share them.'}
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <AuthField
          label="Username" value={username} onChange={setUsername} autoComplete="username"
          hint="Letters, digits, dot, dash or underscore."
        />
        <AuthField
          label="Display name" value={displayName} onChange={setDisplayName}
          autoComplete="name" hint="How your name appears on saves and in the team list."
        />
        <AuthField
          label="Password" type="password" value={password} onChange={setPassword}
          autoComplete="new-password" hint={PASSWORD_HINT}
        />
        {info.email && (
          <div className="auth-note">
            This invitation was addressed to <strong>{info.email}</strong>. You can confirm
            that address from your profile afterwards so it can receive a password reset.
          </div>
        )}
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button
          type="submit" className="auth-submit"
          disabled={busy || !username.trim() || !password}
        >
          {busy ? 'Creating…' : 'Create my account'}
        </button>
      </form>
    </AuthShell>
  )
}

// ─── Verify an email address ────────────────────────────────────────────────

/**
 * `/verify-email?token=` — confirm that an address actually reaches its owner.
 *
 * Until this happens the address cannot receive a reset, which is the point: a
 * mistyped address would otherwise mean credential-bearing links posted to a
 * stranger.
 */
export function VerifyEmailScreen() {
  const token = useLinkToken()
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setState('failed'); setError('This link is missing its token.'); return }
    let cancelled = false
    api.verifyEmail(token)
      .then(() => { if (!cancelled) setState('done') })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(messageOf(err, 'Could not confirm that address.'))
        setState('failed')
      })
    return () => { cancelled = true }
  }, [token])

  return (
    <AuthShell title="Confirm your email address">
      {state === 'working' && <p role="status">Confirming…</p>}
      {state === 'done' && (
        <div className="auth-ok" role="status">
          Confirmed. This address can now receive a password reset.
        </div>
      )}
      {state === 'failed' && <div className="auth-error" role="alert">{error}</div>}
      <div className="auth-links">
        <a className="auth-link" href="/">Back to Resume Studio</a>
      </div>
    </AuthShell>
  )
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function MissingToken({ title }: { title: string }) {
  return (
    <AuthShell title={title}>
      <div className="auth-error" role="alert">
        This link is missing its token. Copy the whole address out of the message it came
        in — some mail clients cut it at the question mark.
      </div>
      <div className="auth-links">
        <a className="auth-link" href="/">Back to sign in</a>
      </div>
    </AuthShell>
  )
}

/** Route one of the five signed-out account paths to its screen. */
export function PublicAccountScreen({ screen, onSignedIn }: ScreenProps & { screen: AccountScreen }) {
  switch (screen) {
    case 'reset': return <ResetScreen />
    case 'recover': return <RecoverScreen />
    case 'forgot': return <ForgotScreen />
    case 'accept': return <AcceptInviteScreen onSignedIn={onSignedIn} />
    default: return <VerifyEmailScreen />
  }
}
