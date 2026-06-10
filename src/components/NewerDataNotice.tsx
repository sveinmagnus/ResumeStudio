import { useState } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { useStore } from '../store/useStore'

/**
 * Best-effort warning shown when the loaded resume was last saved by a build
 * with a NEWER data shape than this one (`store.dataFromNewerApp` — see
 * `lib/migrate.ts → isNewerShape`). Typical cause: the cloud-folder sync
 * carried data from an auto-updated machine to one that hasn't updated yet.
 * Editing stays enabled (decision: load anyway, best-effort), but a save from
 * this build may lose details only the newer shape knows about — so nudge the
 * user toward updating. Dismissible per mount; reappears on the next load of
 * newer-shaped data.
 */
export function NewerDataNotice() {
  const dataFromNewerApp = useStore((s) => s.dataFromNewerApp)
  const [dismissed, setDismissed] = useState(false)
  if (!dataFromNewerApp || dismissed) return null

  return (
    <div className="ndn-bar" role="alert">
      <TriangleAlert size={15} className="ndn-icon" />
      <span className="ndn-text">
        This resume was last saved by a <strong>newer version of Resume Studio</strong>.
        You can keep editing, but details this version doesn't understand may be
        lost when it saves — updating the app first is safer.
      </span>
      <button className="ndn-close" onClick={() => setDismissed(true)} aria-label="Dismiss warning">
        <X size={14} />
      </button>

      <style>{`
        .ndn-bar {
          display: flex; align-items: flex-start; gap: 10px;
          margin: 12px 36px 0; padding: 10px 14px;
          background: #fffbeb; border: 1px solid #f59e0b66;
          border-radius: var(--r-md); animation: fadeUp .2s ease;
        }
        .ndn-icon { color: #b45309; flex-shrink: 0; margin-top: 1px; }
        .ndn-text { flex: 1; font-size: 13px; color: #78350f; line-height: 1.5; }
        .ndn-close {
          flex-shrink: 0; padding: 3px; border-radius: var(--r-sm);
          color: #b45309; transition: background .12s;
        }
        .ndn-close:hover { background: #fef3c7; }
        @media (max-width: 880px) {
          .ndn-bar { margin: 10px 16px 0; }
        }
      `}</style>
    </div>
  )
}
