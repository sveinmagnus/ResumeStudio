import { Info, X } from 'lucide-react'
import { useStore } from '../store/useStore'

/**
 * Non-blocking notice shown when a shared-registry rename couldn't be applied
 * because the entry was renamed on another device (`store.registryNotice` — set
 * by `useCanonicalRegistrySync` on a 409). The server's value has already been
 * reconciled into the editor; this just tells the user their change didn't
 * stick, so they can redo it if they still want to. Dismiss clears the notice.
 */
export function RegistryConflictNotice() {
  const registryNotice = useStore((s) => s.registryNotice)
  const setRegistryNotice = useStore((s) => s.setRegistryNotice)
  if (!registryNotice) return null

  return (
    <div className="rcn-bar" role="status">
      <Info size={15} className="rcn-icon" />
      <span className="rcn-text">{registryNotice}</span>
      <button className="rcn-close" onClick={() => setRegistryNotice(null)} aria-label="Dismiss notice">
        <X size={14} />
      </button>

      <style>{`
        .rcn-bar {
          display: flex; align-items: flex-start; gap: 10px;
          margin: 12px 36px 0; padding: 10px 14px;
          background: var(--accent-wash); border: 1px solid var(--secondary-line);
          border-radius: var(--r-md); animation: fadeUp .2s ease;
        }
        .rcn-icon { color: var(--secondary-ink-text); flex-shrink: 0; margin-top: 1px; }
        .rcn-text { flex: 1; font-size: 13px; color: var(--ink); line-height: 1.5; }
        .rcn-close {
          flex-shrink: 0; padding: 3px; border-radius: var(--r-sm);
          color: var(--ink-soft); transition: background .12s;
        }
        .rcn-close:hover { background: var(--paper-sunken); }
        @media (max-width: 880px) {
          .rcn-bar { margin: 10px 16px 0; }
        }
      `}</style>
    </div>
  )
}
