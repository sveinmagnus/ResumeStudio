import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface RecoveryCodesPanelProps {
  codes: string[]
  /**
   * Shown as a confirmation the user must tick before continuing. Omit on a
   * screen where there is nothing to continue to (the profile's regenerate).
   */
  onAcknowledge?: () => void
  acknowledgeLabel?: string
}

/**
 * The one and only showing of a set of recovery codes.
 *
 * They are stored hashed, so this is not a "you can look them up later"
 * screen — leaving it without them means the account has lost the one way back
 * in that needs neither an administrator nor a mailbox. Hence the confirmation:
 * it is not ceremony, it is the last moment the codes exist in readable form.
 */
export function RecoveryCodesPanel({
  codes, onAcknowledge, acknowledgeLabel = 'I have saved these codes',
}: RecoveryCodesPanelProps) {
  const [confirmed, setConfirmed] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
    } catch {
      // Clipboard access can be refused (permissions, an insecure origin). The
      // codes are on screen and selectable, so this is a convenience failing,
      // not the feature failing.
      setCopied(false)
    }
  }

  return (
    <div className="rc-panel">
      <h2 className="rc-title">Your recovery codes</h2>
      <p className="rc-intro">
        Save these somewhere safe — a password manager is ideal. Each one can be used
        once to set a new password without an administrator or an email address.
        <strong> They are not shown again.</strong>
      </p>

      <ul className="rc-codes">
        {codes.map((code) => <li key={code}><code>{code}</code></li>)}
      </ul>

      <button type="button" className="rc-copy" onClick={() => void copy()}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? 'Copied' : 'Copy all codes'}
      </button>
      <span role="status" className="sr-only">{copied ? 'Recovery codes copied.' : ''}</span>

      {onAcknowledge && (
        <>
          <label className="check-row rc-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>{acknowledgeLabel}</span>
          </label>
          <button
            type="button"
            className="auth-submit"
            disabled={!confirmed}
            onClick={onAcknowledge}
          >
            Continue
          </button>
        </>
      )}

      <style>{`
        .rc-panel { text-align: left; }
        .rc-title { font-size: 15px; color: var(--accent); margin-bottom: 6px; }
        .rc-intro { font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 12px; }
        .rc-codes {
          list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px;
          padding: 12px 14px; margin-bottom: 10px;
          background: var(--paper-sunken); border: 1px solid var(--line);
          border-radius: var(--r-sm);
        }
        .rc-codes code {
          font-size: 12.5px; letter-spacing: .04em; color: var(--ink);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .rc-copy {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 12px; border-radius: var(--r-sm);
          border: 1px solid var(--line-strong); font-size: 12.5px; font-weight: 600;
          color: var(--ink-soft); transition: color .13s, border-color .13s;
        }
        .rc-copy:hover { color: var(--accent); border-color: var(--accent); }
        .rc-check { margin: 14px 0 4px; font-size: 13px; }
        @media (max-width: 420px) {
          .rc-codes { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}
