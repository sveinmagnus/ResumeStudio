import { Eye } from 'lucide-react'
import { useStore } from '../store/useStore'

/**
 * Shown when the open resume belongs to a colleague and was shared with the
 * team: readable here, never writable (`server/access.ts`).
 *
 * NOT dismissible, unlike the other notices. The others warn about something
 * that might go wrong later; this one explains why the editor in front of you
 * does not accept anything you type. Hiding it would leave a page that looks
 * broken.
 */
export function ReadOnlyNotice() {
  const readOnly = useStore((s) => s.readOnly)
  if (!readOnly) return null

  return (
    <div className="ron-bar" role="status">
      <Eye size={15} className="ron-icon" aria-hidden="true" />
      <span className="ron-text">
        <strong>Shared with the team — read only.</strong> This CV belongs to a
        colleague. You can read it and export from it; nothing you change here is
        saved. Only its owner (and an owner-role account) can edit it.
      </span>

      <style>{`
        .ron-bar {
          display: flex; align-items: flex-start; gap: 10px;
          margin: 12px 36px 0; padding: 10px 14px;
          background: var(--accent-wash); border: 1px solid var(--line-strong);
          border-radius: var(--r-md);
        }
        .ron-icon { color: var(--accent); flex-shrink: 0; margin-top: 1px; }
        .ron-text { flex: 1; font-size: 13px; color: var(--ink-soft); line-height: 1.5; }
        @media (max-width: 880px) {
          .ron-bar { margin: 10px 16px 0; }
        }
      `}</style>
    </div>
  )
}
