/**
 * Move a resume to a different account, from the picker.
 *
 * Ownership decides who may edit, and an import always makes the importer the
 * owner: a backup file carries an `author` block, but a file cannot prove who
 * wrote it, so nothing in it is allowed to assign anything (server/db.ts →
 * setOwner). This control is the correction for that guess, and without one a
 * wrong guess would be permanent.
 *
 * `null` — unowned — is offered as a named choice rather than a blank, because
 * it is a real state with real consequences: a desktop-authored resume arrives
 * that way, and while it lasts only owner-role accounts can read or write it.
 */
import { Suspense, lazy, useState } from 'react'
import { UserCog } from 'lucide-react'
import type { ResumeMeta, TeamUser } from '../../lib/api'
import { ownerLabel } from './owners'

const OwnerDialog = lazy(() =>
  import('./OwnerDialog').then((m) => ({ default: m.OwnerDialog })))

interface OwnerControlProps {
  resume: ResumeMeta
  /** Every account on the instance — the owner already fetched the list. */
  users: TeamUser[]
  onChanged: (ownerId: string | null) => void
}

export function OwnerControl({ resume, users, onChanged }: OwnerControlProps) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')

  return (
    <>
      <button
        className="oc-open"
        onClick={() => setOpen(true)}
        title={`Owned by ${ownerLabel(resume.owner_id, users)} — click to hand it to someone else`}
        aria-label={`Change owner of ${resume.name}`}
      >
        <UserCog size={14} />
      </button>
      {/* Persistent live region: the dialog closes on success, so this is where
          the outcome is announced. */}
      <span role="status" className="sr-only">{notice}</span>
      {open && (
        <Suspense fallback={null}>
          <OwnerDialog
            resume={resume}
            users={users}
            onClose={() => setOpen(false)}
            onApplied={(ownerId) => {
              setOpen(false)
              setNotice(`${resume.name} is now owned by ${ownerLabel(ownerId, users)}.`)
              onChanged(ownerId)
            }}
          />
        </Suspense>
      )}

      <style>{`
        .oc-open {
          display: grid; place-items: center; width: 40px;
          color: var(--ink-faint); transition: color .12s, background .12s;
        }
        .oc-open:hover { color: var(--accent); background: var(--accent-wash); }
      `}</style>
    </>
  )
}
