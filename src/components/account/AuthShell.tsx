import { useId, type ReactNode } from 'react'

const YEAR = new Date().getFullYear()

interface AuthFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'email'
  /** Explains why the field is being asked for. Rendered under the input. */
  hint?: ReactNode
  autoComplete?: string
  required?: boolean
  disabled?: boolean
}

/**
 * A labelled text input for the account screens.
 *
 * The label is a real `<label for>` rather than a placeholder: a placeholder
 * disappears the moment anyone types, which on a form asking for "your current
 * password, to change your email address" is exactly when the reason for the
 * field stops being visible.
 */
export function AuthField({
  label, value, onChange, type = 'text', hint, autoComplete, required, disabled,
}: AuthFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="auth-field">
      <label className="auth-field-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="auth-input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-describedby={hint ? hintId : undefined}
        spellCheck={false}
        required={required}
        disabled={disabled}
      />
      {hint && <span className="auth-field-hint" id={hintId}>{hint}</span>}
    </div>
  )
}

interface AuthShellProps {
  title: string
  /** One or two sentences under the title. Optional. */
  intro?: ReactNode
  children: ReactNode
  /** Links out of this screen (sign in, forgot password, …). */
  footer?: ReactNode
}

/**
 * The card every signed-out screen renders inside: sign-in, first-run setup,
 * reset, invite acceptance, address verification.
 *
 * It owns the `.auth-*` styles for all of them. That is deliberate rather than
 * incidental — a component's `<style>` block only exists in the DOM while the
 * component is mounted, so styles shared by seven screens have to live in
 * something all seven mount (CLAUDE.md §6, the same rule that keeps `.pf-*` in
 * index.css).
 */
export function AuthShell({ title, intro, children, footer }: AuthShellProps) {
  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <img src="/cartavio-logo.png" alt="Cartavio" className="auth-logo" />
        <h1 className="auth-title">{title}</h1>
        {intro && <p className="auth-desc">{intro}</p>}

        {children}

        {footer && <div className="auth-links">{footer}</div>}

        <div className="auth-footer">
          © {YEAR} Cartavio AS ·{' '}
          <a href="https://cartavio.no" target="_blank" rel="noopener noreferrer">
            cartavio.no
          </a>
        </div>
      </div>

      <style>{`
        .auth-overlay { min-height: 100vh; display: grid; place-items: center; padding: 40px 20px; }
        .auth-card {
          max-width: 440px; width: 100%; text-align: center;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-lg); padding: 36px 32px 28px; box-shadow: var(--shadow-lg);
        }
        .auth-logo { width: 160px; height: auto; margin: 0 auto 16px; display: block; }
        .auth-title { font-size: 20px; margin-bottom: 8px; color: var(--accent); }
        .auth-desc  { color: var(--ink-soft); font-size: 13.5px; line-height: 1.6; margin-bottom: 22px; }

        /* ── Fields ─────────────────────────────────────────────────────── */
        .auth-field { display: block; text-align: left; margin-bottom: 12px; }
        .auth-field-label {
          display: block; font-size: 12px; font-weight: 600;
          color: var(--ink-soft); margin-bottom: 5px;
        }
        .auth-field-hint {
          display: block; font-size: 11.5px; color: var(--ink-faint);
          margin-top: 4px; line-height: 1.45;
        }
        .auth-input {
          width: 100%; padding: 10px 14px; border: 1.5px solid var(--line-strong);
          border-radius: var(--r-md); font-size: 14px;
          background: var(--paper); color: var(--ink);
        }
        .auth-input:focus { outline: none; border-color: var(--accent); }
        .auth-select {
          width: 100%; padding: 9px 12px; border: 1.5px solid var(--line-strong);
          border-radius: var(--r-md); font-size: 13.5px;
          background: var(--paper); color: var(--ink);
        }

        /* ── Messages ───────────────────────────────────────────────────── */
        .auth-error {
          font-size: 13px; color: var(--err-ink); background: var(--err-wash);
          padding: 9px 12px; border-radius: var(--r-sm); margin: 4px 0 10px;
          text-align: left; line-height: 1.5;
        }
        .auth-ok {
          font-size: 13px; color: var(--ok-ink); background: var(--ok-wash);
          padding: 9px 12px; border-radius: var(--r-sm); margin: 4px 0 10px;
          text-align: left; line-height: 1.5;
        }
        .auth-note {
          font-size: 12.5px; color: var(--ink-soft); background: var(--paper-sunken);
          padding: 10px 12px; border-radius: var(--r-sm); margin: 4px 0 12px;
          text-align: left; line-height: 1.55;
        }

        /* ── Buttons ────────────────────────────────────────────────────── */
        .auth-submit {
          width: 100%; padding: 11px; background: var(--accent); color: #fff;
          border-radius: var(--r-md); font-weight: 600; font-size: 15px;
          transition: opacity .15s, background .15s; margin-top: 6px;
        }
        .auth-submit:disabled { opacity: .45; cursor: not-allowed; }
        .auth-submit:not(:disabled):hover { background: var(--accent-bright); }
        .auth-secondary {
          width: 100%; padding: 10px; margin-top: 8px;
          border: 1.5px solid var(--line-strong); border-radius: var(--r-md);
          font-weight: 600; font-size: 13.5px; color: var(--ink-soft);
          transition: color .15s, border-color .15s;
        }
        .auth-secondary:hover { color: var(--accent); border-color: var(--accent); }

        /* ── Links row ──────────────────────────────────────────────────── */
        .auth-links {
          margin-top: 16px; display: flex; flex-wrap: wrap;
          justify-content: center; gap: 6px 14px;
        }
        .auth-links a, .auth-link {
          font-size: 12.5px; color: var(--accent); text-decoration: underline;
        }
        .auth-links a:hover, .auth-link:hover { color: var(--accent-bright); }

        .auth-footer {
          margin-top: 20px; padding-top: 16px;
          border-top: 1px solid var(--line);
          font-size: 11px; color: var(--ink-faint);
        }
        .auth-footer a { color: var(--ink-faint); text-decoration: none; }
        .auth-footer a:hover { color: var(--accent); }
      `}</style>
    </div>
  )
}
