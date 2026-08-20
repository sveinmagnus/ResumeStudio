import { useEffect, useRef, useState } from 'react'
import { UserRound, ChevronDown, LogOut, Users } from 'lucide-react'
import { api, type MeInfo } from '../../lib/api'
import { Link, navigate } from '../../lib/router'
import { signOut } from '../ui/signOut'

/**
 * "Signed in as …" plus the way out.
 *
 * Renders nothing at all on an instance with no accounts — the desktop build
 * and local dev are one person on loopback, where an identity control is
 * chrome that answers a question nobody asked. A SERVICE credential
 * (`RESUME_API_TOKEN`) authenticates but is nobody, so it gets the sign-out and
 * not the profile: there is no account behind it to edit.
 */
export function AccountMenu() {
  const [me, setMe] = useState<MeInfo | null>(null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    void api.me().then((m) => { if (!cancelled) setMe(m) })
    return () => { cancelled = true }
  }, [])

  // Close on outside click; Escape closes and returns focus to the trigger.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!me || me.mode === 'open') return null

  const label = me.service ? 'Service access' : (me.name ?? 'Signed in')

  return (
    <div className="am" ref={wrapRef}>
      {/* A disclosure, not an ARIA menu: the popup is plain links and buttons
          reached with Tab, so menu roles would promise arrow-key navigation
          nothing here implements. */}
      <button
        ref={triggerRef}
        className="am-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`Signed in as ${label}`}
      >
        <UserRound size={14} aria-hidden="true" />
        <span className="am-name">{label}</span>
        <ChevronDown size={13} className={open ? 'am-chev open' : 'am-chev'} aria-hidden="true" />
      </button>

      {open && (
        <div className="am-menu">
          <div className="am-head">
            <div className="am-head-name">Signed in as {label}</div>
            <div className="am-head-role">
              {me.service
                ? 'A shared service credential, not a person.'
                : me.role === 'owner' ? 'Owner — sees every resume' : 'Member'}
            </div>
          </div>

          {!me.service && (
            <Link to="/profile" className="am-item" onClick={() => setOpen(false)}>
              <UserRound size={14} aria-hidden="true" /> Your account
            </Link>
          )}
          {!me.service && me.role === 'owner' && (
            <Link to="/admin" className="am-item" onClick={() => setOpen(false)}>
              <Users size={14} aria-hidden="true" /> Team
            </Link>
          )}

          <button
            className="am-item am-signout"
            onClick={() => void (async () => {
              // Ending the session is only half of it — see `ui/signOut.ts`.
              if (!await signOut()) return
              setOpen(false)
              navigate('/')
              // A full reload is the honest way to drop every in-memory copy of
              // the CV that was on screen a moment ago.
              window.location.reload()
            })()}
          >
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}

      <style>{`
        .am { position: relative; display: inline-block; }
        .am-trigger {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 12px; border-radius: var(--r-md);
          border: 1.5px solid var(--line-strong); background: var(--paper-raised);
          color: var(--ink-soft); font-size: 12.5px; font-weight: 600;
          transition: color .13s, border-color .13s; max-width: 220px;
        }
        .am-trigger:hover { color: var(--accent); border-color: var(--accent); }
        .am-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
        .am-chev { transition: transform .15s; flex-shrink: 0; }
        .am-chev.open { transform: rotate(180deg); }

        .am-menu {
          position: absolute; top: 100%; right: 0; margin-top: 4px;
          background: var(--paper); border: 1px solid var(--line);
          border-radius: var(--r-md); box-shadow: var(--shadow-md);
          padding: 4px; z-index: 50; min-width: 230px;
          max-width: calc(100vw - 32px);
          display: flex; flex-direction: column; gap: 1px;
        }
        .am-head { padding: 9px 11px 10px; border-bottom: 1px solid var(--line); margin-bottom: 3px; }
        .am-head-name { font-size: 13px; font-weight: 600; color: var(--ink); }
        .am-head-role { font-size: 11.5px; color: var(--ink-faint); margin-top: 2px; }
        .am-item {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 11px; border-radius: var(--r-sm);
          font-size: 13px; color: var(--ink); text-align: left; text-decoration: none;
          transition: background .12s, color .12s;
        }
        .am-item:hover { background: var(--accent-wash); color: var(--accent); }
        .am-signout { color: var(--err-ink); }
        .am-signout:hover { background: var(--err-wash); color: var(--err-ink); }
      `}</style>
    </div>
  )
}
