import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Stable key — when this changes, the boundary resets so the user can navigate away. */
  resetKey?: unknown
}

interface State {
  error: Error | null
}

/**
 * Catches render-time errors in a subtree and shows a friendly fallback.
 *
 * Users can:
 *   - Click "Try again" to reset the boundary in place.
 *   - Navigate the sidebar to a different section, which changes `resetKey`
 *     and clears the error automatically.
 *
 * The error is logged to the console so a developer can still inspect it.
 * In production you'd wire this to Sentry/etc — the indirection is here so
 * adding that later is a one-line change.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] caught render error', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="eb-wrap">
        <div className="eb-card">
          <div className="eb-icon"><AlertTriangle size={28} /></div>
          <h2 className="eb-title">This section crashed</h2>
          <p className="eb-msg">
            Something in this view threw an error while rendering. Your data
            is still safe — pick a different section in the sidebar to recover,
            or click below to try again.
          </p>
          <pre className="eb-err">{this.state.error.message}</pre>
          <button className="eb-btn" onClick={this.reset}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>

        <style>{`
          .eb-wrap { padding: 40px 28px; display: grid; place-items: center; }
          .eb-card {
            max-width: 540px; width: 100%; text-align: center;
            background: var(--paper-raised); border: 1px solid var(--line);
            border-radius: var(--r-lg); padding: 32px 28px; box-shadow: var(--shadow-md);
          }
          .eb-icon {
            width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%;
            background: var(--err-wash); color: var(--err-ink); display: grid; place-items: center;
          }
          .eb-title { font-size: 20px; margin-bottom: 8px; }
          .eb-msg { color: var(--ink-soft); font-size: 14px; line-height: 1.55; margin-bottom: 16px; }
          .eb-err {
            font-family: monospace; font-size: 12px; color: var(--err-ink);
            background: #fdf0ef; padding: 10px 14px; border-radius: var(--r-sm);
            margin: 0 0 18px; white-space: pre-wrap; word-break: break-word;
            text-align: left;
          }
          .eb-btn {
            display: inline-flex; align-items: center; gap: 7px;
            padding: 10px 18px; background: var(--accent); color: #fff;
            border-radius: var(--r-md); font-weight: 600; font-size: 14px;
            transition: opacity .15s;
          }
          .eb-btn:hover { opacity: .9; }
        `}</style>
      </div>
    )
  }
}
