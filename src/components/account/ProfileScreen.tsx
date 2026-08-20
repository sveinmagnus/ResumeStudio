/**
 * Your own account: display name, the two login identifiers, password,
 * recovery codes, and the state of your email address.
 *
 * The screen is organised by what each change COSTS rather than by what it
 * touches. A display name is cosmetic and saves on its own. A username or an
 * email address is a login identifier — changing the first locks the old one
 * out, changing the second repoints where a password reset goes — so the server
 * demands the current password for both, and this asks for it in the same form
 * rather than letting the user discover the requirement through a 403.
 */
import { useEffect, useId, useState } from 'react'
import { KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { ServerError, api, type AccountProfile } from '../../lib/api'
import { navigate } from '../../lib/router'
import { AccountPage, AccountField } from './AccountPage'
import { RecoveryCodesPanel } from './RecoveryCodesPanel'
import { confirmDialog } from '../ui/ConfirmDialog'

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof ServerError ? err.message : (err as Error).message || fallback

interface ProfileScreenProps {
  /** The session ended (a password change signs every session out). */
  onSignedOut: () => void
}

export function ProfileScreen({ onSignedOut }: ProfileScreenProps) {
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [loadError, setLoadError] = useState('')
  // Bumped by any card that changed something, so the page re-reads the server's
  // truth rather than each card patching a local copy of it.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((n) => n + 1)

  useEffect(() => {
    let cancelled = false
    api.profile()
      .then((p) => { if (!cancelled) setProfile(p) })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err, 'Could not load your profile.'))
      })
    return () => { cancelled = true }
  }, [reloadKey])

  if (loadError) {
    return (
      <AccountPage title="Your account">
        <div className="acct-err" role="alert">{loadError}</div>
      </AccountPage>
    )
  }
  if (!profile) {
    return (
      <AccountPage title="Your account">
        <p role="status">Loading…</p>
      </AccountPage>
    )
  }

  return (
    <AccountPage
      title="Your account"
      intro={
        <>
          Signed in as <strong>{profile.display_name}</strong> (@{profile.username}) ·{' '}
          <span className="acct-pill acct-pill-info">
            {profile.role === 'owner' ? 'Owner' : 'Member'}
          </span>
        </>
      }
    >
      <DisplayNameCard profile={profile} onSaved={reload} />
      <IdentifiersCard profile={profile} onSaved={reload} />
      <PasswordCard onSignedOut={onSignedOut} />
      <RecoveryCard profile={profile} onChanged={reload} />
    </AccountPage>
  )
}

// ─── Display name ───────────────────────────────────────────────────────────

function DisplayNameCard({ profile, onSaved }: { profile: AccountProfile; onSaved: () => void }) {
  const headingId = useId()
  const [name, setName] = useState(profile.display_name)
  const [state, setState] = useState<{ ok?: string; err?: string }>({})
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setState({})
    setBusy(true)
    try {
      await api.updateProfile({ display_name: name })
      setState({ ok: 'Display name updated.' })
      onSaved()
    } catch (err) {
      setState({ err: messageOf(err, 'Could not update your display name.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="acct-card" aria-labelledby={headingId}>
      <h2 id={headingId}>Display name</h2>
      <p className="acct-card-note">
        How you appear on saves and in the team list. Cosmetic — you do not sign in with it.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        <AccountField label="Display name" value={name} onChange={setName} autoComplete="name" />
        <div className="acct-actions">
          <button
            type="submit" className="acct-btn"
            disabled={busy || !name.trim() || name === profile.display_name}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        {state.ok && <p className="acct-ok" role="status">{state.ok}</p>}
        {state.err && <p className="acct-err" role="alert">{state.err}</p>}
      </form>
    </section>
  )
}

// ─── Username + email ───────────────────────────────────────────────────────

function IdentifiersCard({ profile, onSaved }: { profile: AccountProfile; onSaved: () => void }) {
  const headingId = useId()
  const [username, setUsername] = useState(profile.username)
  const [email, setEmail] = useState(profile.email ?? '')
  const [current, setCurrent] = useState('')
  const [state, setState] = useState<{ ok?: string; err?: string }>({})
  const [busy, setBusy] = useState(false)
  const [verifySent, setVerifySent] = useState('')

  const changed = username !== profile.username || email !== (profile.email ?? '')

  const save = async () => {
    setState({})
    setBusy(true)
    try {
      await api.updateProfile({ username, email, current_password: current })
      setCurrent('')
      setState({ ok: 'Saved. A new address has to be confirmed before it can receive a reset.' })
      onSaved()
    } catch (err) {
      setState({ err: messageOf(err, 'Could not update your sign-in details.') })
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setVerifySent('')
    try {
      await api.sendVerificationEmail()
      setVerifySent('Sent. Open the link in that message to confirm the address.')
    } catch (err) {
      setVerifySent(messageOf(err, 'Could not send that message.'))
    }
  }

  return (
    <section className="acct-card" aria-labelledby={headingId}>
      <h2 id={headingId}>How you sign in</h2>
      <p className="acct-card-note">
        Both of these are login identifiers, so both need your current password. Without
        that, anyone who got hold of your open session could change your address and then
        ask for a password reset.
      </p>

      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        <AccountField
          label="Username" value={username} onChange={setUsername} autoComplete="username"
          hint="Letters, digits, dot, dash or underscore."
        />
        <AccountField
          label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email"
          hint={
            profile.mail_configured
              ? 'Optional. Only used to send you a password reset. Leave empty to remove it.'
              : 'Optional. This server cannot send email, so an address here does nothing yet.'
          }
        />

        <p className="acct-card-note">
          {!profile.email && <>No address on the account.</>}
          {profile.email && profile.email_verified && (
            <>
              <span className="acct-pill acct-pill-ok">Confirmed</span>{' '}
              <strong>{profile.email}</strong> can receive a password reset.
            </>
          )}
          {profile.email && !profile.email_verified && (
            <>
              <span className="acct-pill acct-pill-warn">Not confirmed</span>{' '}
              <strong>{profile.email}</strong> cannot receive a password reset until you
              open the link sent to it. Until an address is proven to reach you, a typo
              would post a reset link to a stranger.
            </>
          )}
        </p>

        <AccountField
          label="Your current password" type="password" value={current} onChange={setCurrent}
          autoComplete="current-password"
          hint="Required to change either of the two fields above."
        />

        <div className="acct-actions">
          <button type="submit" className="acct-btn" disabled={busy || !changed || !current}>
            {busy ? 'Saving…' : 'Save sign-in details'}
          </button>
          {profile.email && !profile.email_verified && profile.mail_configured && (
            <button type="button" className="acct-btn-quiet" onClick={() => void resend()}>
              <Mail size={14} aria-hidden="true" /> Send the confirmation link
            </button>
          )}
        </div>
        {state.ok && <p className="acct-ok" role="status">{state.ok}</p>}
        {state.err && <p className="acct-err" role="alert">{state.err}</p>}
        {verifySent && <p className="acct-ok" role="status">{verifySent}</p>}
      </form>
    </section>
  )
}

// ─── Password ───────────────────────────────────────────────────────────────

function PasswordCard({ onSignedOut }: { onSignedOut: () => void }) {
  const headingId = useId()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError('')
    if (next !== confirm) { setError('The two new passwords do not match.'); return }
    setBusy(true)
    try {
      await api.changePassword(current, next)
      // The server ends every session for the account, including this one —
      // which is the correct outcome after a credential change, so send the
      // user to sign in rather than leaving a page that will 401 on its next
      // request.
      onSignedOut()
      navigate('/')
    } catch (err) {
      setError(messageOf(err, 'Could not change your password.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="acct-card" aria-labelledby={headingId}>
      <h2 id={headingId}>Password</h2>
      <p className="acct-card-note">
        Changing it signs out every session on every device, including this one. You will
        be asked to sign in again straight away.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        <AccountField
          label="Current password" type="password" value={current} onChange={setCurrent}
          autoComplete="current-password"
        />
        <AccountField
          label="New password" type="password" value={next} onChange={setNext}
          autoComplete="new-password"
          hint="At least 12 characters. No other rules — length is what matters."
        />
        <AccountField
          label="Repeat the new password" type="password" value={confirm} onChange={setConfirm}
          autoComplete="new-password"
        />
        <div className="acct-actions">
          <button type="submit" className="acct-btn" disabled={busy || !current || !next}>
            <KeyRound size={14} aria-hidden="true" /> {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
        {error && <p className="acct-err" role="alert">{error}</p>}
      </form>
    </section>
  )
}

// ─── Recovery codes ─────────────────────────────────────────────────────────

function RecoveryCard({ profile, onChanged }: { profile: AccountProfile; onChanged: () => void }) {
  const headingId = useId()
  const [codes, setCodes] = useState<string[] | null>(null)
  const [current, setCurrent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const regenerate = async () => {
    const ok = await confirmDialog({
      title: 'Generate new recovery codes?',
      message:
        `Your ${profile.recovery_codes_left} remaining code(s) stop working immediately. ` +
        `The new set is shown once and cannot be looked up afterwards.`,
      confirmLabel: 'Generate new codes',
    })
    if (!ok) return
    setError('')
    setBusy(true)
    try {
      setCodes(await api.regenerateRecoveryCodes(current))
      setCurrent('')
      onChanged()
    } catch (err) {
      setError(messageOf(err, 'Could not generate recovery codes.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="acct-card" aria-labelledby={headingId}>
      <h2 id={headingId}>Recovery codes</h2>
      <p className="acct-card-note">
        Single-use codes that set a new password without an administrator or a mailbox.
        {' '}
        <strong>
          {profile.recovery_codes_left} unused code{profile.recovery_codes_left === 1 ? '' : 's'} left.
        </strong>
      </p>
      {codes
        ? <RecoveryCodesPanel codes={codes} />
        : (
          <form onSubmit={(e) => { e.preventDefault(); void regenerate() }}>
            {/*
              * The server has always required this, and the form never asked, so
              * the button answered 403 every time. It is required for a stronger
              * reason than most credential changes: a code outlives the session
              * that minted it and on its own sets a new password, so a borrowed
              * screen could otherwise mint ten and silently void the set the
              * real user had saved.
              */}
            <AccountField
              label="Your current password" type="password" value={current} onChange={setCurrent}
              autoComplete="current-password"
              hint="Required, because a recovery code can set a new password on its own."
            />
            <div className="acct-actions">
              <button type="submit" className="acct-btn-quiet" disabled={busy || !current}>
                <ShieldCheck size={14} aria-hidden="true" />
                {busy ? 'Generating…' : 'Generate a new set'}
              </button>
            </div>
          </form>
        )}
      {error && <p className="acct-err" role="alert">{error}</p>}
    </section>
  )
}
