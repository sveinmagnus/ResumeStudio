/**
 * Promise-based confirmation dialog — a branded replacement for window.confirm.
 *
 * Native confirm() can't be styled, and browsers offer a "prevent this page
 * from creating more dialogs" checkbox that silently disables it mid-session
 * (which would neuter a delete confirmation). This renders the app's own modal
 * instead, reusing useDialog (focus trap / Esc / focus restore).
 *
 * Imperative + self-portaling on purpose: call `await confirmDialog({…})` from
 * anywhere (event handlers, hooks) without threading a provider through the
 * tree — and it works in isolated component tests, which render a single
 * component with no app-level provider mounted.
 *
 *   if (await confirmDialog({ message: 'Delete this?', danger: true })) { … }
 */
import { createRoot, type Root } from 'react-dom/client'
import { useDialog } from './useDialog'

export interface ConfirmOptions {
  /** Heading. Defaults to "Are you sure?". */
  title?: string
  /** Body text. Required — this is the actual question. */
  message: string
  /** Confirm-button label. Defaults to "Confirm". */
  confirmLabel?: string
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string
  /** Red confirm button for destructive actions. */
  danger?: boolean
  /** Append "You can undo this with Ctrl+Z." — for reversible store mutations. */
  undoHint?: boolean
}

function ConfirmModal({ opts, onChoice }: { opts: ConfirmOptions; onChoice: (ok: boolean) => void }) {
  const ref = useDialog<HTMLDivElement>(() => onChoice(false))
  const title = opts.title ?? 'Are you sure?'
  const message = opts.undoHint ? `${opts.message} You can undo this with Ctrl+Z.` : opts.message
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={() => onChoice(false)}>
      <div className="confirm-modal" ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-title">{title}</h2>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={() => onChoice(false)}>
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={`confirm-ok${opts.danger ? ' confirm-danger' : ''}`}
            data-autofocus
            onClick={() => onChoice(true)}
          >
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>

      <style>{`
        .confirm-overlay {
          position: fixed; inset: 0; background: rgba(15, 23, 42, .45);
          display: flex; align-items: center; justify-content: center;
          z-index: 200; padding: 24px; animation: fadeIn .15s ease;
        }
        .confirm-modal {
          background: var(--paper); border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg); width: 100%; max-width: 420px;
          padding: 22px 24px; animation: fadeUp .2s ease;
        }
        .confirm-title { font-size: 17px; font-weight: 600; margin-bottom: 8px; }
        .confirm-message { font-size: 13.5px; color: var(--ink-soft); line-height: 1.55; white-space: pre-line; }
        .confirm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        .confirm-cancel {
          padding: 9px 16px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          border: 1.5px solid var(--line-strong); color: var(--ink-soft);
          transition: color .13s, background .13s, border-color .13s, box-shadow .13s;
        }
        .confirm-cancel:hover { background: var(--paper-sunken); color: var(--ink); }
        .confirm-ok {
          padding: 9px 16px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          background: var(--accent); color: #fff; transition: background .13s;
        }
        .confirm-ok:hover { background: var(--accent-bright); }
        .confirm-danger { background: var(--err-ink); }
        .confirm-danger:hover { background: var(--err-ink); filter: brightness(1.1); }
      `}</style>
    </div>
  )
}

/**
 * Show the dialog and resolve to the user's choice (true = confirmed). Mounts
 * its own root, cleans it up on choice. Resolves false if there's no DOM.
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
      // Defer teardown so we don't unmount during React's own event dispatch.
      setTimeout(() => { root.unmount(); container.remove() }, 0)
    }
    root.render(<ConfirmModal opts={opts} onChoice={finish} />)
  })
}
