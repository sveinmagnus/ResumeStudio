import { useState, useRef, useCallback } from 'react'
import { Sparkles, X, Download, Copy, Check, Upload, AlertTriangle, FileCheck2 } from 'lucide-react'
import {
  validateAIImport, importFromAIDraft, summarizeImportedStore,
  InvalidAIImportError, type AIImportIssue, type ImportSummary,
} from '../lib/aiImport'
import type { ResumeStore } from '../types'
import { useDialog } from './ui/useDialog'

/** Public path the app serves the bundled template from (Vite copies public/ → dist/). */
const TEMPLATE_PATH = '/ai-import-template.md'

interface AIImportModalProps {
  /** Create a new resume from the parsed store. Same contract as ImportScreen.onImported. */
  onImported: (store: ResumeStore, suggestedName: string) => void | Promise<void>
  onClose: () => void
}

interface Parsed {
  store: ResumeStore
  summary: ImportSummary
}

function deriveName(summary: ImportSummary): string {
  const full = summary.full_name.trim()
  return full ? `${full} — CV` : 'AI-imported resume'
}

/**
 * AI-assisted import dialog (template-file approach).
 *
 * Three steps: (1) download the template, (2) run it in the user's own LLM with
 * their PDF/Word CV, (3) drop/paste the returned JSON. We validate the JSON
 * (field-pathed errors shown inline), preview what was found, then create the
 * resume on confirm. No server, no API keys — the user's LLM does the work.
 */
export function AIImportModal({ onImported, onClose }: AIImportModalProps) {
  const dialogRef = useDialog(onClose)
  const [jsonText, setJsonText] = useState('')
  const [issues, setIssues] = useState<AIImportIssue[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => { setIssues([]); setParseError(null); setParsed(null) }

  // ── Step 1 affordances ────────────────────────────────────────────────────
  const downloadTemplate = useCallback(() => {
    const a = document.createElement('a')
    a.href = TEMPLATE_PATH
    a.download = 'resume-studio-ai-import-template.md'
    a.click()
  }, [])

  const copyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + TEMPLATE_PATH)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — the Download button still works */
    }
  }, [])

  // ── Step 3: validate the pasted/dropped JSON ───────────────────────────────
  const validate = useCallback((text: string) => {
    reset()
    const trimmed = text.trim()
    if (!trimmed) { setParseError('Paste the JSON your LLM produced, or choose a .json file.'); return }

    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch (e) {
      setParseError(`That isn't valid JSON: ${(e as Error).message}`)
      return
    }

    try {
      const validated = validateAIImport(json)
      const store = importFromAIDraft(validated)
      setParsed({ store, summary: summarizeImportedStore(store) })
    } catch (e) {
      if (e instanceof InvalidAIImportError) setIssues(e.issues)
      else setParseError((e as Error).message)
    }
  }, [])

  const onFile = useCallback(async (file: File) => {
    const text = await file.text()
    setJsonText(text)
    validate(text)
  }, [validate])

  const confirm = useCallback(async () => {
    if (!parsed) return
    setCreating(true)
    try {
      await onImported(parsed.store, deriveName(parsed.summary))
    } finally {
      setCreating(false)
    }
  }, [parsed, onImported])

  return (
    <div className="aim-overlay" role="dialog" aria-modal="true" aria-label="AI-assisted import" onClick={onClose}>
      <div className="aim-modal" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="aim-head">
          <span className="aim-title"><Sparkles size={16} /> AI-assisted import</span>
          <button className="aim-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {parsed ? (
          // ── Preview phase ──────────────────────────────────────────────
          <div className="aim-body">
            <div className="aim-preview-head">
              <FileCheck2 size={18} /> Ready to import
            </div>
            <div className="aim-summary">
              <div className="aim-sum-name">{parsed.summary.full_name || 'Unnamed resume'}</div>
              <div className="aim-sum-locale">Primary language: {parsed.summary.primary_locale.toUpperCase()}</div>
              {parsed.summary.total === 0 ? (
                <div className="aim-warn">
                  <AlertTriangle size={14} />
                  The file parsed, but no resume content was found. You can still create
                  an (almost empty) resume, or go back and check the JSON.
                </div>
              ) : (
                <ul className="aim-sum-list">
                  {parsed.summary.lines.map((l) => (
                    <li key={l.label}><strong>{l.count}</strong> {l.label}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="aim-actions">
              <button className="aim-secondary" onClick={reset} disabled={creating}>Back</button>
              <button className="aim-primary" onClick={() => void confirm()} disabled={creating}>
                {creating ? 'Creating…' : 'Create resume'}
              </button>
            </div>
          </div>
        ) : (
          // ── Input phase ────────────────────────────────────────────────
          <div className="aim-body">
            <p className="aim-lede">
              Use your own AI (Claude, ChatGPT, Gemini, a local model…) to turn an existing
              PDF or Word CV into a Resume Studio draft. Nothing is sent to any server here.
            </p>

            <ol className="aim-steps">
              <li>
                <div className="aim-step-title">Get the template</div>
                <div className="aim-step-body">
                  <button className="aim-chip" onClick={downloadTemplate}>
                    <Download size={14} /> Download template
                  </button>
                  <button className="aim-chip" onClick={() => void copyUrl()}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              </li>
              <li>
                <div className="aim-step-title">Run it in your LLM</div>
                <div className="aim-step-body aim-step-text">
                  Open your AI assistant and attach <em>both</em> the template and your
                  PDF/Word CV. Ask it to follow the template. It returns a block of JSON.
                </div>
              </li>
              <li>
                <div className="aim-step-title">Paste the result back</div>
                <div className="aim-step-body">
                  <textarea
                    className="aim-textarea"
                    placeholder='Paste the JSON here (starts with { "$schema": "resumestudio-ai/v1", … )'
                    value={jsonText}
                    aria-label="Import JSON"
                    onChange={(e) => { setJsonText(e.target.value); if (issues.length || parseError) reset() }}
                  />
                  <div className="aim-textarea-actions">
                    <button className="aim-link" onClick={() => fileRef.current?.click()}>
                      <Upload size={13} /> or choose a .json file
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".json,application/json"
                      hidden
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }}
                    />
                  </div>
                </div>
              </li>
            </ol>

            {parseError && <div className="aim-error" role="alert">{parseError}</div>}
            {issues.length > 0 && (
              <div className="aim-issues">
                <div className="aim-issues-title">
                  <AlertTriangle size={14} /> The JSON doesn't match the template:
                </div>
                <ul>
                  {issues.slice(0, 12).map((iss, i) => (
                    <li key={`${iss.path}-${i}`}>
                      <code>{iss.path}</code> — {iss.reason}
                    </li>
                  ))}
                  {issues.length > 12 && <li className="aim-issues-more">+{issues.length - 12} more…</li>}
                </ul>
                <div className="aim-issues-hint">
                  Fix the JSON above (or paste the list back to your LLM and ask it to correct them).
                </div>
              </div>
            )}

            <div className="aim-actions">
              <button className="aim-secondary" onClick={onClose}>Cancel</button>
              <button className="aim-primary" onClick={() => validate(jsonText)}>Preview import</button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .aim-overlay {
          position: fixed; inset: 0; background: rgba(15, 23, 42, .45);
          display: flex; align-items: center; justify-content: center;
          z-index: 100; padding: 24px; animation: fadeIn .15s ease;
        }
        .aim-modal {
          background: var(--paper); border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg); width: 100%; max-width: 560px;
          max-height: 86vh; display: flex; flex-direction: column;
          padding: 22px 24px; animation: fadeUp .2s ease;
        }
        .aim-head { display: flex; align-items: center; justify-content: space-between; }
        .aim-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
        .aim-title svg { color: var(--accent); }
        .aim-close { color: var(--ink-faint); padding: 4px; border-radius: var(--r-sm); transition: all .12s; }
        .aim-close:hover { background: var(--paper-sunken); color: var(--ink); }
        .aim-body { overflow-y: auto; margin-top: 8px; }
        .aim-lede { font-size: 13px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 16px; }

        .aim-steps { list-style: none; counter-reset: step; display: flex; flex-direction: column; gap: 16px; }
        .aim-steps > li { counter-increment: step; position: relative; padding-left: 34px; }
        .aim-steps > li::before {
          content: counter(step); position: absolute; left: 0; top: 0;
          width: 24px; height: 24px; border-radius: 50%;
          background: var(--accent-wash); color: var(--accent);
          font-size: 12px; font-weight: 700; display: grid; place-items: center;
        }
        .aim-step-title { font-size: 13.5px; font-weight: 600; margin-bottom: 7px; }
        .aim-step-body { display: flex; gap: 8px; flex-wrap: wrap; }
        .aim-step-text { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; }

        .aim-chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 13px; border-radius: var(--r-md);
          border: 1.5px solid var(--line-strong); color: var(--ink-soft);
          font-size: 12.5px; font-weight: 600; transition: all .13s;
        }
        .aim-chip:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }

        .aim-textarea {
          width: 100%; min-height: 96px; resize: vertical;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
          padding: 10px 12px; border: 1px solid var(--line-strong);
          border-radius: var(--r-sm); background: var(--paper-sunken); color: var(--ink);
          line-height: 1.45;
        }
        .aim-textarea:focus { outline: none; border-color: var(--accent); background: var(--paper); }
        .aim-textarea-actions { margin-top: 6px; }
        .aim-link {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 12px; color: var(--accent); font-weight: 600;
        }
        .aim-link:hover { text-decoration: underline; }

        .aim-error {
          margin-top: 14px; padding: 10px 14px; background: #fef2f2; color: #b91c1c;
          border-radius: var(--r-sm); font-size: 12.5px; line-height: 1.45;
        }
        .aim-issues {
          margin-top: 14px; padding: 12px 14px; background: #fff7e6;
          border: 1px solid #f0d8a8; border-radius: var(--r-sm); font-size: 12.5px; color: #8a5a00;
        }
        .aim-issues-title { display: flex; align-items: center; gap: 6px; font-weight: 700; margin-bottom: 8px; }
        .aim-issues ul { list-style: none; display: flex; flex-direction: column; gap: 4px; }
        .aim-issues code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px; font-size: 11.5px;
        }
        .aim-issues-more { font-style: italic; opacity: .8; }
        .aim-issues-hint { margin-top: 9px; font-size: 11.5px; opacity: .85; }

        .aim-preview-head {
          display: flex; align-items: center; gap: 8px;
          font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 14px;
        }
        .aim-summary {
          padding: 16px; border: 1px solid var(--line); border-radius: var(--r-md);
          background: var(--paper-raised);
        }
        .aim-sum-name { font-size: 16px; font-weight: 700; }
        .aim-sum-locale { font-size: 12px; color: var(--ink-faint); margin-top: 2px; margin-bottom: 12px; }
        .aim-sum-list {
          list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px;
          font-size: 13px; color: var(--ink-soft);
        }
        .aim-sum-list strong { color: var(--ink); font-weight: 700; }
        .aim-warn {
          display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px;
          color: #8a5a00; line-height: 1.45;
        }
        .aim-warn svg { flex-shrink: 0; margin-top: 1px; }

        .aim-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        .aim-secondary {
          padding: 9px 16px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          border: 1.5px solid var(--line-strong); color: var(--ink-soft); transition: all .13s;
        }
        .aim-secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .aim-secondary:disabled { opacity: .5; cursor: default; }
        .aim-primary {
          padding: 9px 18px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          background: var(--accent); color: #fff; transition: background .13s;
        }
        .aim-primary:hover:not(:disabled) { background: var(--accent-bright); }
        .aim-primary:disabled { opacity: .6; cursor: default; }
      `}</style>
    </div>
  )
}
