import { GitMerge, X, ArrowRight } from 'lucide-react'
import type { ResumeStore } from '../types'
import { diffStores } from '../lib/diffResume'
import { useDialog } from './ui/useDialog'

interface ConflictModalProps {
  /** The local (mine) store — the in-memory edits awaiting resolution. */
  mine: ResumeStore
  /** The server (theirs) store that changed under us. */
  theirs: ResumeStore
  onResolve: (choice: 'keep' | 'discard') => void
  /** Dismiss without resolving (keeps editing; the conflict badge stays). */
  onClose: () => void
}

/**
 * Keep/discard conflict resolution with a "what changed" panel.
 *
 * Shown when a save was refused because the resume changed elsewhere (another
 * tab/device). The diff is a read-only summary — section add/remove/change
 * counts + notable profile-field differences — not a merge. The user keeps
 * their version (overwrite the server) or discards it (take the server copy).
 */
export function ConflictModal({ mine, theirs, onResolve, onClose }: ConflictModalProps) {
  const dialogRef = useDialog(onClose)
  const diff = diffStores(mine, theirs)

  return (
    <div className="cm-overlay" role="dialog" aria-modal="true" aria-label="Resolve conflict" onClick={onClose}>
      <div className="cm-modal" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="cm-head">
          <span className="cm-title"><GitMerge size={16} /> This resume changed elsewhere</span>
          <button className="cm-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p className="cm-sub">
          Another tab or device saved this resume while you were editing. Your local
          changes haven't been saved yet. Choose which version to keep — this can't be undone.
        </p>

        <div className="cm-body">
          {diff.identical ? (
            <div className="cm-state">
              No field-level differences detected — the versions look equivalent.
              Keeping yours will simply re-save your copy.
            </div>
          ) : (
            <>
              {diff.profileFields.length > 0 && (
                <div className="cm-group">
                  <div className="cm-group-title">Personal details</div>
                  <ul className="cm-fields">
                    {diff.profileFields.map((f) => (
                      <li key={f.field} className="cm-field">
                        <span className="cm-field-name">{f.field}</span>
                        <span className="cm-field-vals">
                          <span className="cm-mine">{f.mine || '—'}</span>
                          <ArrowRight size={11} className="cm-arrow" />
                          <span className="cm-theirs">{f.theirs || '—'}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.sections.length > 0 && (
                <div className="cm-group">
                  <div className="cm-group-title">Sections</div>
                  <ul className="cm-sections">
                    {diff.sections.map((s) => (
                      <li key={s.section} className="cm-section">
                        <div className="cm-section-head">
                          <span className="cm-section-name">{s.section}</span>
                          <span className="cm-counts">
                            {s.added > 0 && <span className="cm-add">+{s.added} only yours</span>}
                            {s.removed > 0 && <span className="cm-rem">−{s.removed} only theirs</span>}
                            {s.changed > 0 && <span className="cm-chg">{s.changed} differ</span>}
                          </span>
                        </div>
                        {s.items.length > 0 && (
                          <ul className="cm-items">
                            {s.items.map((it, i) => (
                              <li key={`${it.label}-${i}`} className={`cm-item cm-item-${it.change}`}>
                                <span className="cm-item-mark">
                                  {it.change === 'added' ? '+' : it.change === 'removed' ? '−' : '~'}
                                </span>
                                {it.label}
                              </li>
                            ))}
                            {(s.added + s.removed + s.changed) > s.items.length && (
                              <li className="cm-item cm-item-more">
                                +{(s.added + s.removed + s.changed) - s.items.length} more…
                              </li>
                            )}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="cm-legend">
                “Yours” = your unsaved edits · “Theirs” = the version now on the server.
              </p>
            </>
          )}
        </div>

        <div className="cm-actions">
          <button className="cm-discard" onClick={() => onResolve('discard')}>
            Discard mine, use server
          </button>
          <button className="cm-keep" onClick={() => onResolve('keep')}>
            Keep my version
          </button>
        </div>
      </div>

      <style>{`
        .cm-overlay {
          position: fixed; inset: 0; background: rgba(15, 23, 42, .45);
          display: flex; align-items: center; justify-content: center;
          z-index: 100; padding: 24px; animation: fadeIn .15s ease;
        }
        .cm-modal {
          background: var(--paper); border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg); width: 100%; max-width: 540px;
          max-height: 82vh; display: flex; flex-direction: column;
          padding: 22px 24px; animation: fadeUp .2s ease;
        }
        .cm-head { display: flex; align-items: center; justify-content: space-between; }
        .cm-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
        .cm-close { color: var(--ink-faint); padding: 4px; border-radius: var(--r-sm); transition: all .12s; }
        .cm-close:hover { background: var(--paper-sunken); color: var(--ink); }
        .cm-sub { font-size: 12.5px; color: var(--ink-soft); margin: 8px 0 16px; line-height: 1.5; }
        .cm-body { overflow-y: auto; overscroll-behavior: contain; }
        .cm-state { padding: 20px 8px; text-align: center; color: var(--ink-faint); font-size: 13.5px; line-height: 1.5; }
        .cm-group { margin-bottom: 16px; }
        .cm-group-title {
          font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
          color: var(--accent); margin-bottom: 8px;
        }
        .cm-fields, .cm-sections { list-style: none; display: flex; flex-direction: column; gap: 6px; }
        .cm-field {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: 13px;
        }
        .cm-section {
          padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: 13px;
        }
        .cm-section-head {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
        }
        .cm-items { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
        .cm-item {
          font-size: 12px; color: var(--ink-soft); display: flex; align-items: center; gap: 6px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cm-item-mark { font-weight: 700; width: 10px; text-align: center; flex-shrink: 0; }
        .cm-item-added .cm-item-mark { color: #27ae60; }
        .cm-item-removed .cm-item-mark { color: #c0392b; }
        .cm-item-changed .cm-item-mark { color: #b87900; }
        .cm-item-more { color: var(--ink-faint); font-style: italic; }
        .cm-field-name, .cm-section-name { font-weight: 600; flex-shrink: 0; }
        .cm-field-vals { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
        .cm-mine, .cm-theirs { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cm-mine { color: var(--accent); }
        .cm-theirs { color: var(--ink-soft); }
        .cm-arrow { color: var(--ink-faint); flex-shrink: 0; }
        .cm-counts { display: inline-flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .cm-add { color: #27ae60; }
        .cm-rem { color: #c0392b; }
        .cm-chg { color: #b87900; }
        .cm-legend { font-size: 11px; color: var(--ink-faint); margin-top: 4px; }
        .cm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
        .cm-discard {
          padding: 9px 16px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          border: 1.5px solid var(--line-strong); color: var(--ink-soft); transition: all .13s;
        }
        .cm-discard:hover { border-color: #c0392b; color: #c0392b; }
        .cm-keep {
          padding: 9px 16px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          background: var(--accent); color: #fff; transition: background .13s;
        }
        .cm-keep:hover { background: var(--accent-bright); }
      `}</style>
    </div>
  )
}
