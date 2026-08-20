/**
 * The transfer itself: pick an account (or nobody), confirm, apply.
 *
 * Lazy-loaded by `OwnerControl` for the reason the account screens are — it is
 * a rare action behind a button, and the initial payload is a budget CI
 * enforces.
 */
import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api, ServerError, type ResumeMeta, type TeamUser } from '../../lib/api'
import { confirmDialog } from '../ui/ConfirmDialog'
import { useDialog } from '../ui/useDialog'
import { accountName, ownerLabel } from './owners'

/** The `<select>` value standing for `owner_id: null`; no account has an empty id. */
const UNOWNED = ''

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof ServerError ? err.message : (err as Error).message || fallback

interface OwnerDialogProps {
  resume: ResumeMeta
  users: TeamUser[]
  onClose: () => void
  onApplied: (ownerId: string | null) => void
}

export function OwnerDialog({ resume, users, onClose, onApplied }: OwnerDialogProps) {
  const ref = useDialog<HTMLDivElement>(onClose)
  const selectId = useId()
  const current = resume.owner_id ?? null
  const [choice, setChoice] = useState<string>(current ?? UNOWNED)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const next = choice === UNOWNED ? null : choice
  const target = users.find((u) => u.id === next)

  const apply = async () => {
    if (next === current) { onClose(); return }
    const ok = await confirmDialog({
      title: target
        ? `Hand "${resume.name}" to ${accountName(target)}?`
        : `Leave "${resume.name}" unowned?`,
      message: target
        ? `${accountName(target)} will be able to edit this resume. The current owner ` +
          'will not be able to take it back — only an owner-role account can move it again.'
        : 'Nobody will own it. Until it is handed to someone, only owner-role ' +
          'accounts can read or edit it.',
      confirmLabel: 'Change owner',
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      await api.setResumeOwner(resume.id, next)
      onApplied(next)
    } catch (err) {
      setError(messageOf(err, 'Could not change the owner.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="oc-backdrop" onClick={onClose}>
      <div
        className="oc-card"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Change owner of ${resume.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="oc-title">Change owner</h2>
        <p className="oc-current">
          <span className="oc-name">{resume.name}</span> is currently owned by{' '}
          <strong>{ownerLabel(current, users)}</strong>.
        </p>

        <label className="oc-label" htmlFor={selectId}>New owner</label>
        <select
          id={selectId}
          className="oc-select"
          data-autofocus
          value={choice}
          disabled={busy}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value={UNOWNED}>Nobody (unowned)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {accountName(u)}{u.disabled_at ? ' (disabled account)' : ''}
            </option>
          ))}
        </select>
        <p className="oc-help">
          The owner is the only account that can edit this resume — everyone else
          sees it read-only, and only if it is shared with the team.
        </p>

        {error && <p className="oc-err" role="alert">{error}</p>}

        <div className="oc-actions">
          <button className="oc-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="oc-btn oc-primary" onClick={() => void apply()} disabled={busy}>
            {busy && <Loader2 size={14} className="oc-spin" />} Change owner
          </button>
        </div>
      </div>

      <style>{`
        .oc-backdrop {
          position: fixed; inset: 0; z-index: 60;
          background: rgba(15,23,42,.45);
          display: flex; align-items: center; justify-content: center; padding: 24px;
        }
        .oc-card {
          width: 100%; max-width: 420px; padding: 22px 24px;
          background: var(--paper); border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg); overscroll-behavior: contain;
        }
        .oc-title { font-size: 17px; font-weight: 600; margin-bottom: 8px; }
        .oc-current { font-size: 13.5px; color: var(--ink-soft); line-height: 1.55; }
        .oc-name { font-weight: 600; color: var(--ink); }
        .oc-label {
          display: block; margin: 16px 0 5px;
          font-size: 12px; font-weight: 600; color: var(--ink-soft);
        }
        .oc-select {
          width: 100%; padding: 8px 11px; font-size: 13px;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper); color: var(--ink);
        }
        .oc-select:focus { outline: none; border-color: var(--accent); }
        .oc-help { margin-top: 8px; font-size: 12px; color: var(--ink-faint); line-height: 1.5; }
        .oc-err {
          margin-top: 12px; padding: 8px 12px; border-radius: var(--r-sm);
          background: var(--err-wash); color: var(--err-ink); font-size: 12.5px;
        }
        .oc-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        .oc-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 9px 16px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          border: 1.5px solid var(--line-strong); color: var(--ink-soft);
          transition: color .13s, background .13s, border-color .13s;
        }
        .oc-btn:hover:not(:disabled) { background: var(--paper-sunken); color: var(--ink); }
        .oc-btn:disabled { opacity: .5; cursor: default; }
        .oc-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
        .oc-primary:hover:not(:disabled) { background: var(--accent-bright); color: #fff; }
        .oc-spin { animation: oc-spin 1s linear infinite; }
        @keyframes oc-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
