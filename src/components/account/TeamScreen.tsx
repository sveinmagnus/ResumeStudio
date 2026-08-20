/**
 * The owner's view of everybody else's accounts.
 *
 * Two things here are deliberately un-automated. An invitation and a reset link
 * are handed back as TEXT for the owner to pass on through whatever channel the
 * firm already uses — the server never needs a mail transport for either. And
 * every refusal the server can raise (the last owner, your own account) is shown
 * with its own wording, because that wording names the way out.
 */
import { useEffect, useId, useState } from 'react'
import { Copy, Check, Link2, UserPlus } from 'lucide-react'
import { ServerError, api, type Role, type TeamUser } from '../../lib/api'
import { fmtRelativeTime } from '../../lib/locales'
import { AccountPage, AccountField } from './AccountPage'
import { confirmDialog } from '../ui/ConfirmDialog'

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof ServerError ? err.message : (err as Error).message || fallback

interface TeamScreenProps {
  /** The signed-in account, so it can be marked and its own row guarded. */
  meId: string | null
}

export function TeamScreen({ meId }: TeamScreenProps) {
  const [users, setUsers] = useState<TeamUser[] | null>(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((n) => n + 1)

  useEffect(() => {
    let cancelled = false
    api.listUsers()
      .then((u) => { if (!cancelled) { setUsers(u); setError('') } })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err, 'Could not load the user list.'))
      })
    return () => { cancelled = true }
  }, [reloadKey])

  return (
    <AccountPage
      title="Team"
      intro="Everyone with an account on this server. As an owner you can see and manage every resume here, which is what makes staffing work and recovering a departed colleague's CV possible."
    >
      {error && <p className="acct-err" role="alert">{error}</p>}
      <InviteCard onInvited={reload} />
      {users === null && !error && <p role="status">Loading…</p>}
      {users?.map((u) => (
        <UserCard key={u.id} user={u} isMe={u.id === meId} onChanged={reload} />
      ))}
    </AccountPage>
  )
}

// ─── Invite ─────────────────────────────────────────────────────────────────

function InviteCard({ onInvited }: { onInvited: () => void }) {
  const [role, setRole] = useState<Role>('member')
  const [email, setEmail] = useState('')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const invite = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await api.inviteUser({ role, email: email.trim() || undefined })
      setLink(res.url)
      onInvited()
    } catch (err) {
      setError(messageOf(err, 'Could not create an invitation.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="acct-card">
      <h2>Invite somebody</h2>
      <p className="acct-card-note">
        Creates a single-use link that expires in a week. The invitee chooses their own
        username and password — nothing is sent for you, so pass the link on yourself.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void invite() }}>
        <div className="acct-field">
          <label className="acct-label" htmlFor="invite-role">Role</label>
          <select
            id="invite-role"
            className="acct-input"
            value={role}
            onChange={(e) => setRole(e.target.value === 'owner' ? 'owner' : 'member')}
          >
            <option value="member">Member — owns their own resumes</option>
            <option value="owner">Owner — sees and manages every resume</option>
          </select>
        </div>
        <AccountField
          label="Email address (optional)" type="email" value={email} onChange={setEmail}
          autoComplete="off"
          hint="Only recorded on the invitation. The invitee still has to confirm it before it can receive a password reset."
        />
        <div className="acct-actions">
          <button type="submit" className="acct-btn" disabled={busy}>
            <UserPlus size={14} aria-hidden="true" /> {busy ? 'Creating…' : 'Create an invitation'}
          </button>
        </div>
      </form>
      {error && <p className="acct-err" role="alert">{error}</p>}
      {link && <CopyableLink label="Invitation link" value={link} />}
    </section>
  )
}

// ─── One account ────────────────────────────────────────────────────────────

function UserCard({ user, isMe, onChanged }: {
  user: TeamUser
  isMe: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(user.display_name)
  const [username, setUsername] = useState(user.username)
  const [email, setEmail] = useState(user.email ?? '')
  const [resetLink, setResetLink] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  /** Run one owner action, showing the server's own refusal where there is one. */
  const run = async (label: string, action: () => Promise<void>) => {
    setError('')
    setNote('')
    setBusy(true)
    try {
      await action()
      setNote(label)
      onChanged()
    } catch (err) {
      setError(messageOf(err, 'That did not work.'))
    } finally {
      setBusy(false)
    }
  }

  const save = () => run('Saved.', async () => {
    await api.updateUser(user.id, { display_name: displayName, username, email })
    setEditing(false)
  })

  const issueReset = () => run('Reset link created.', async () => {
    setResetLink(await api.userResetLink(user.id))
  })

  const toggleDisabled = async () => {
    const disabling = !user.disabled_at
    if (disabling) {
      const ok = await confirmDialog({
        title: `Disable ${user.display_name}?`,
        message:
          'They are signed out everywhere immediately and cannot sign in again until you ' +
          're-enable them. Their resumes stay where they are — deleting a departing ' +
          'colleague’s CV is a separate, deliberate act.',
        confirmLabel: 'Disable', danger: true,
      })
      if (!ok) return
    }
    void run(disabling ? 'Disabled.' : 'Enabled.', () => api.setUserDisabled(user.id, disabling))
  }

  const toggleRole = async () => {
    const next: Role = user.role === 'owner' ? 'member' : 'owner'
    const ok = await confirmDialog({
      title: next === 'owner' ? `Make ${user.display_name} an owner?` : `Make ${user.display_name} a member?`,
      message: next === 'owner'
        ? 'An owner can read, edit and delete every resume on this server, and manage every account.'
        : 'They keep their own resumes and lose access to everybody else’s.',
      confirmLabel: next === 'owner' ? 'Make owner' : 'Make member',
    })
    if (!ok) return
    void run(next === 'owner' ? 'Now an owner.' : 'Now a member.', () => api.setUserRole(user.id, next))
  }

  return (
    <section className="acct-card">
      <div className="tm-head">
        <div className="tm-who">
          <h2>
            {user.display_name}
            {isMe && <span className="acct-pill acct-pill-info tm-tag">You</span>}
          </h2>
          <p className="tm-meta">
            @{user.username}
            {user.email && <> · {user.email}</>}
            {user.email && (
              <span className={user.email_verified_at ? 'acct-pill acct-pill-ok tm-tag' : 'acct-pill acct-pill-warn tm-tag'}>
                {user.email_verified_at ? 'Confirmed' : 'Not confirmed'}
              </span>
            )}
          </p>
          <p className="tm-meta">
            {user.role === 'owner' ? 'Owner' : 'Member'}
            {' · '}
            {user.last_login_at ? `last signed in ${fmtRelativeTime(user.last_login_at)}` : 'never signed in'}
            {user.disabled_at && <span className="acct-pill acct-pill-warn tm-tag">Disabled</span>}
          </p>
        </div>
      </div>

      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); void save() }} className="tm-form">
          <AccountField label="Display name" value={displayName} onChange={setDisplayName} />
          <AccountField label="Username" value={username} onChange={setUsername} />
          <AccountField
            label="Email address" type="email" value={email} onChange={setEmail}
            hint="Setting an address here leaves it unconfirmed: only the person reading that inbox can prove it reaches them."
          />
          <div className="acct-actions">
            <button type="submit" className="acct-btn" disabled={busy}>Save</button>
            <button type="button" className="acct-btn-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {!editing && (
        <div className="acct-actions">
          <button type="button" className="acct-btn-quiet" onClick={() => setEditing(true)}>
            Edit details
          </button>
          <button type="button" className="acct-btn-quiet" onClick={() => void issueReset()} disabled={busy}>
            <Link2 size={14} aria-hidden="true" /> Reset link
          </button>
          <button type="button" className="acct-btn-quiet" onClick={() => void toggleDisabled()} disabled={busy}>
            {user.disabled_at ? 'Enable' : 'Disable'}
          </button>
          <button type="button" className="acct-btn-quiet" onClick={() => void toggleRole()} disabled={busy}>
            {user.role === 'owner' ? 'Make a member' : 'Make an owner'}
          </button>
        </div>
      )}

      {note && <p className="acct-ok" role="status">{note}</p>}
      {error && <p className="acct-err" role="alert">{error}</p>}
      {resetLink && (
        <CopyableLink
          label={`Reset link for ${user.display_name}`}
          value={resetLink}
          hint="Valid for 30 minutes, works once. Hand it over directly — anyone holding it can set this account's password."
        />
      )}

      <style>{`
        .tm-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .tm-who h2 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .tm-meta { font-size: 12.5px; color: var(--ink-faint); margin-top: 3px; }
        .tm-tag { margin-left: 6px; }
        .tm-form { margin-bottom: 6px; }
      `}</style>
    </section>
  )
}

// ─── A link the owner passes on by hand ─────────────────────────────────────

function CopyableLink({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false)
  const id = useId()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Refused clipboard access (insecure origin, permissions). The value is
      // in a selectable read-only input, so copying by hand still works.
      setCopied(false)
    }
  }

  return (
    <div className="cl-wrap">
      <label className="acct-label" htmlFor={id}>{label}</label>
      <div className="cl-row">
        <input id={id} className="acct-input" readOnly value={value} />
        <button type="button" className="acct-btn-quiet" onClick={() => void copy()}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <span role="status" className="sr-only">{copied ? 'Link copied.' : ''}</span>
      {hint && <span className="acct-hint">{hint}</span>}

      <style>{`
        .cl-wrap { margin-top: 14px; }
        .cl-row { display: flex; gap: 8px; align-items: center; }
        .cl-row .acct-input { font-size: 12.5px; }
      `}</style>
    </div>
  )
}
