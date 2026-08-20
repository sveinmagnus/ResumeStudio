import { ArrowLeft } from 'lucide-react'
import { Link } from '../../lib/router'
import { useId, type ReactNode } from 'react'

interface AccountFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'email'
  hint?: ReactNode
  autoComplete?: string
  disabled?: boolean
}

/** A labelled input inside an `.acct-card`. Same contract as `AuthField`. */
export function AccountField({
  label, value, onChange, type = 'text', hint, autoComplete, disabled,
}: AccountFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="acct-field">
      <label className="acct-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="acct-input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-describedby={hint ? hintId : undefined}
        spellCheck={false}
        disabled={disabled}
      />
      {hint && <span className="acct-hint" id={hintId}>{hint}</span>}
    </div>
  )
}

interface AccountPageProps {
  title: string
  intro?: ReactNode
  children: ReactNode
}

/**
 * Page chrome for the two signed-in account screens (profile, team).
 *
 * Owns the `.acct-*` styles both of them use — mounted whenever either is on
 * screen, which is the condition a shared style block has to meet (CLAUDE.md §6).
 */
export function AccountPage({ title, intro, children }: AccountPageProps) {
  return (
    <div className="acct-screen">
      <div className="acct-wrap">
        <Link to="/" className="acct-back">
          <ArrowLeft size={14} aria-hidden="true" /> Back to your resumes
        </Link>
        <h1 className="acct-title">{title}</h1>
        {intro && <p className="acct-intro">{intro}</p>}
        {children}
      </div>

      <style>{`
        .acct-screen { min-height: 100vh; padding: 48px 24px 80px; display: flex; justify-content: center; }
        .acct-wrap { width: 100%; max-width: 680px; }
        .acct-back {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12.5px; font-weight: 600; color: var(--accent);
          text-decoration: none; margin-bottom: 18px;
        }
        .acct-back:hover { text-decoration: underline; }
        .acct-title { font-size: 28px; color: var(--accent); letter-spacing: -.005em; }
        .acct-intro { font-size: 13.5px; color: var(--ink-soft); line-height: 1.6; margin-top: 8px; }

        /* ── Cards ──────────────────────────────────────────────────────── */
        .acct-card {
          margin-top: 20px; padding: 20px 22px;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-lg);
        }
        .acct-card h2 { font-size: 15px; color: var(--accent); margin-bottom: 4px; }
        .acct-card-note {
          font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 14px;
        }

        /* ── Fields ─────────────────────────────────────────────────────── */
        .acct-field { display: block; margin-bottom: 12px; }
        .acct-label {
          display: block; font-size: 12px; font-weight: 600;
          color: var(--ink-soft); margin-bottom: 5px;
        }
        .acct-input {
          width: 100%; padding: 9px 12px; border: 1.5px solid var(--line-strong);
          border-radius: var(--r-md); font-size: 13.5px;
          background: var(--paper); color: var(--ink);
        }
        .acct-input:focus { outline: none; border-color: var(--accent); }
        .acct-hint { display: block; font-size: 11.5px; color: var(--ink-faint); margin-top: 4px; line-height: 1.45; }

        /* ── Buttons ────────────────────────────────────────────────────── */
        .acct-btn {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 15px; border-radius: var(--r-md);
          background: var(--accent); color: #fff; font-weight: 600; font-size: 13px;
          transition: background .15s, opacity .15s;
        }
        .acct-btn:disabled { opacity: .45; cursor: not-allowed; }
        .acct-btn:not(:disabled):hover { background: var(--accent-bright); }
        .acct-btn-quiet {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 13px; border-radius: var(--r-md); font-size: 12.5px; font-weight: 600;
          border: 1.5px solid var(--line-strong); color: var(--ink-soft);
          transition: color .13s, border-color .13s;
        }
        .acct-btn-quiet:disabled { color: var(--ink-faint); cursor: not-allowed; }
        .acct-btn-quiet:not(:disabled):hover { color: var(--accent); border-color: var(--accent); }
        .acct-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 4px; }

        /* ── Messages ───────────────────────────────────────────────────── */
        .acct-err {
          font-size: 12.5px; color: var(--err-ink); background: var(--err-wash);
          padding: 8px 12px; border-radius: var(--r-sm); margin: 10px 0 0; line-height: 1.5;
        }
        .acct-ok {
          font-size: 12.5px; color: var(--ok-ink); background: var(--ok-wash);
          padding: 8px 12px; border-radius: var(--r-sm); margin: 10px 0 0; line-height: 1.5;
        }

        /* ── Status pills ───────────────────────────────────────────────── */
        .acct-pill {
          display: inline-block; padding: 2px 9px; border-radius: 999px;
          font-size: 11px; font-weight: 600;
        }
        .acct-pill-ok   { background: var(--ok-wash); color: var(--ok-ink); }
        .acct-pill-warn { background: var(--warn-wash); color: var(--warn-ink); }
        .acct-pill-info { background: var(--accent-wash); color: var(--accent); }
      `}</style>
    </div>
  )
}
