import { useState, useRef, useCallback, useMemo } from 'react'
import {
  Upload, X, Copy, Check, Download, AlertTriangle, FileCheck2, ListPlus,
} from 'lucide-react'
import {
  validateBulkImport, mapBulkItems, appendBulkItems, findDuplicates,
  bulkInstructions, InvalidBulkImportError,
  type BulkSectionSpec, type BulkImportIssue, type BulkRegistryAdditions,
} from '../../lib/bulkImport'
import { useStore } from '../../store/useStore'
import { useDialog } from './useDialog'
import { AssistRun } from './AssistRun'
import { extractJson } from '../../lib/llmAssist'

interface BulkImportModalProps {
  spec: BulkSectionSpec
  onClose: () => void
}

interface Staged {
  items: Record<string, unknown>[]
  additions: BulkRegistryAdditions
  duplicates: Set<number>
}

/**
 * Per-section bulk add (lightbox).
 *
 * Mirrors the AI-import flow (`AIImportModal`) but adds items to the section
 * the user is standing in rather than creating a resume: (1) copy the generated
 * instructions into any LLM along with the source material, (2) paste the JSON
 * back, (3) tick what should land. Nothing is sent to a server — the user's own
 * LLM does the conversion.
 *
 * The confirm applies through `replaceData` so the whole batch is ONE undo step
 * and auto-save picks it up (CLAUDE.md §7).
 */
export function BulkImportModal({ spec, onClose }: BulkImportModalProps) {
  const dialogRef = useDialog(onClose)
  const data = useStore((s) => s.data)
  const primaryLocale = useStore((s) => s.primaryLocale)
  const replaceData = useStore((s) => s.replaceData)

  const [jsonText, setJsonText] = useState('')
  // Source material for the in-app run. The manual path doesn't use it — the
  // user pastes their source straight into their own AI.
  const [source, setSource] = useState('')
  const [issues, setIssues] = useState<BulkImportIssue[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [staged, setStaged] = useState<Staged | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const locales = data.resume?.supported_locales?.length
    ? data.resume.supported_locales
    : [primaryLocale]

  const instructions = useMemo(() => bulkInstructions(spec, locales), [spec, locales])

  const reset = () => { setIssues([]); setParseError(null); setStaged(null) }

  // ── Step 1: hand the instructions to an LLM ───────────────────────────────
  const copyInstructions = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(instructions)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — Download still works */
    }
  }, [instructions])

  const downloadInstructions = useCallback(() => {
    const blob = new Blob([instructions], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `resume-studio-bulk-${spec.key}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [instructions, spec.key])

  // ── Step 2: validate + stage the pasted JSON ──────────────────────────────
  const validate = useCallback((text: string) => {
    reset()
    // Tolerate ```json fences / a chatty preamble — models add them whatever the
    // instructions say, and a pasted reply usually carries them too.
    const trimmed = extractJson(text)
    if (!trimmed) { setParseError('Paste the JSON your LLM produced, or choose a .json file.'); return }

    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch (e) {
      setParseError(`That isn't valid JSON: ${(e as Error).message}`)
      return
    }

    try {
      const file = validateBulkImport(json, spec.key)
      const { items, additions } = mapBulkItems(file, spec, data, primaryLocale)
      const existing = (data[spec.key] ?? []) as unknown as Record<string, unknown>[]
      const duplicates = findDuplicates(items, existing, spec)
      setStaged({ items, additions, duplicates })
      // Likely duplicates start unchecked; the user can override.
      setChecked(new Set(items.map((_, i) => i).filter((i) => !duplicates.has(i))))
    } catch (e) {
      if (e instanceof InvalidBulkImportError) setIssues(e.issues)
      else setParseError((e as Error).message)
    }
  }, [spec, data, primaryLocale])

  const onFile = useCallback(async (file: File) => {
    const text = await file.text()
    setJsonText(text)
    validate(text)
  }, [validate])

  // ── Step 3: append what's ticked ──────────────────────────────────────────
  const confirm = useCallback(() => {
    if (!staged || checked.size === 0) return
    const picked = staged.items.filter((_, i) => checked.has(i))
    // Only intern the registry entries the kept items actually reference, so
    // deselecting every project that used a skill doesn't leave it orphaned.
    const usedIds = new Set<string>()
    for (const item of picked) {
      for (const link of (item['skills'] ?? []) as { skill_id?: string }[]) {
        if (link.skill_id) usedIds.add(link.skill_id)
      }
      for (const link of (item['roles'] ?? []) as { role_id?: string }[]) {
        if (link.role_id) usedIds.add(link.role_id)
      }
    }
    const additions: BulkRegistryAdditions = {
      skills: staged.additions.skills.filter((s) => usedIds.has(s.id)),
      roles: staged.additions.roles.filter((r) => usedIds.has(r.id)),
    }
    replaceData(appendBulkItems(data, spec, picked, additions))
    onClose()
  }, [staged, checked, data, spec, replaceData, onClose])

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const allChecked = !!staged && checked.size === staged.items.length
  const newSkillCount = staged?.additions.skills.length ?? 0
  const newRoleCount = staged?.additions.roles.length ?? 0

  return (
    <div
      className="bim-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Bulk add to ${spec.label}`}
      onClick={onClose}
    >
      <div className="bim-modal" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="bim-head">
          <span className="bim-title"><ListPlus size={16} /> Bulk add to {spec.label}</span>
          <button className="bim-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {staged ? (
          // ── Preview phase ───────────────────────────────────────────────
          <div className="bim-body">
            <div className="bim-preview-head">
              <FileCheck2 size={18} /> {staged.items.length} {staged.items.length === 1 ? 'item' : 'items'} found
            </div>
            {staged.duplicates.size > 0 && (
              <div className="bim-dup-note" role="status">
                <AlertTriangle size={14} />
                {staged.duplicates.size} {staged.duplicates.size === 1 ? 'item looks' : 'items look'} like
                {' '}{staged.duplicates.size === 1 ? 'one' : 'ones'} already in {spec.label} — unticked below. Tick to add anyway.
              </div>
            )}

            <div className="bim-select-all">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => setChecked(allChecked ? new Set() : new Set(staged.items.map((_, i) => i)))}
                />
                <span>{allChecked ? 'Deselect all' : 'Select all'}</span>
              </label>
              <span className="bim-count">{checked.size} of {staged.items.length} selected</span>
            </div>

            <ul className="bim-list">
              {staged.items.map((item, i) => {
                const title = spec.title(item, primaryLocale)
                const subtitle = spec.subtitle(item, primaryLocale)
                return (
                  <li key={i} className={staged.duplicates.has(i) ? 'bim-item bim-item-dup' : 'bim-item'}>
                    <label className="check-row">
                      <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                      <span className="bim-item-text">
                        <span className="bim-item-title">
                          {title || <em>(untitled)</em>}
                          {staged.duplicates.has(i) && <span className="bim-dup-tag">possible duplicate</span>}
                        </span>
                        {subtitle && <span className="bim-item-sub">{subtitle}</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>

            {(newSkillCount > 0 || newRoleCount > 0) && (
              <div className="bim-registry-note">
                Adds{' '}
                {newSkillCount > 0 && <><strong>{newSkillCount}</strong> new {newSkillCount === 1 ? 'skill' : 'skills'}</>}
                {newSkillCount > 0 && newRoleCount > 0 && ' and '}
                {newRoleCount > 0 && <><strong>{newRoleCount}</strong> new {newRoleCount === 1 ? 'role' : 'roles'}</>}
                {' '}to the registries. Names already there are reused.
              </div>
            )}

            <div className="bim-actions">
              <button className="bim-secondary" onClick={reset}>Back</button>
              <button className="bim-primary" onClick={confirm} disabled={checked.size === 0}>
                Add {checked.size} to {spec.label}
              </button>
            </div>
          </div>
        ) : (
          // ── Input phase ─────────────────────────────────────────────────
          <div className="bim-body">
            <p className="bim-lede">
              Add many {spec.label.toLowerCase()} at once. Give the instructions below to your
              own AI along with your source material — a CV, a project list, an export from
              another system — or, if you've configured a model in Settings, let the app run it
              for you.
            </p>

            {/* The app has no source material of its own, so Run needs it pasted
                here. Empty → no Run (nothing to send); the manual steps below
                never depend on it. */}
            <div className="bim-source">
              <div className="bim-step-title">Your source material</div>
              <textarea
                className="bim-textarea"
                placeholder="Paste the CV text / project list / export to read items from…"
                value={source}
                aria-label="Source material"
                onChange={(e) => setSource(e.target.value)}
              />
              <AssistRun
                buildPrompt={() => `${instructions}\n\n---\n\nSOURCE MATERIAL:\n\n${source}`}
                onResult={validate}
                wholeCv
                disabled={!source.trim()}
                label={`Extract ${spec.label.toLowerCase()}`}
                maxTokens={4096}
              />
            </div>

            <ol className="bim-steps">
              <li>
                <div className="bim-step-title">Copy the instructions</div>
                <div className="bim-step-body">
                  <button className="bim-chip" onClick={() => void copyInstructions()}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy instructions'}
                  </button>
                  <button className="bim-chip" onClick={downloadInstructions}>
                    <Download size={14} /> Download .md
                  </button>
                </div>
                <div className="bim-step-note">
                  {locales.length > 1
                    ? `Tailored to this resume: asks for ${locales.map((l) => l.toUpperCase()).join(' + ')} in one pass.`
                    : `Tailored to this resume (${locales[0]?.toUpperCase()}).`}
                </div>
              </li>
              <li>
                <div className="bim-step-title">Run it with your source material</div>
                <div className="bim-step-body bim-step-text">
                  Paste the instructions into your AI assistant, then your source below them.
                  It returns a block of JSON.
                </div>
              </li>
              <li>
                <div className="bim-step-title">Paste the result back</div>
                <div className="bim-step-body">
                  <textarea
                    className="bim-textarea"
                    placeholder={`Paste the JSON here (starts with { "$schema": "resumestudio-bulk/v1", "section": "${spec.key}", … )`}
                    value={jsonText}
                    aria-label="Bulk import JSON"
                    onChange={(e) => { setJsonText(e.target.value); if (issues.length || parseError) reset() }}
                  />
                  <div className="bim-textarea-actions">
                    <button className="bim-link" onClick={() => fileRef.current?.click()}>
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

            {parseError && <div className="bim-error" role="alert">{parseError}</div>}
            {issues.length > 0 && (
              <div className="bim-issues" role="alert">
                <div className="bim-issues-title">
                  <AlertTriangle size={14} /> The JSON doesn't match the format:
                </div>
                <ul>
                  {issues.slice(0, 12).map((iss, i) => (
                    <li key={`${iss.path}-${i}`}><code>{iss.path}</code> — {iss.reason}</li>
                  ))}
                  {issues.length > 12 && <li className="bim-issues-more">+{issues.length - 12} more…</li>}
                </ul>
                <div className="bim-issues-hint">
                  Fix the JSON above, or paste this list back to your LLM and ask it to correct them.
                </div>
              </div>
            )}

            <div className="bim-actions">
              <button className="bim-secondary" onClick={onClose}>Cancel</button>
              <button className="bim-primary" onClick={() => validate(jsonText)}>Preview items</button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .bim-overlay {
          position: fixed; inset: 0; background: rgba(15, 23, 42, .45);
          display: flex; align-items: center; justify-content: center;
          z-index: 100; padding: 24px; animation: fadeIn .15s ease;
        }
        .bim-modal {
          background: var(--paper); border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg); width: 100%; max-width: 600px;
          max-height: 86vh; display: flex; flex-direction: column;
          padding: 22px 24px; animation: fadeUp .2s ease;
          overscroll-behavior: contain;
        }
        .bim-head { display: flex; align-items: center; justify-content: space-between; }
        .bim-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
        .bim-title svg { color: var(--accent); }
        .bim-close { color: var(--ink-faint); padding: 4px; border-radius: var(--r-sm); transition: color .12s, background .12s; }
        .bim-close:hover { background: var(--paper-sunken); color: var(--ink); }
        .bim-body { overflow-y: auto; margin-top: 8px; }
        .bim-lede { font-size: 13px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 16px; }

        /* In-app run: paste the source material and let the configured model do it. */
        .bim-source {
          display: flex; flex-direction: column; gap: 8px;
          padding: 12px; margin-bottom: 14px;
          background: var(--paper-sunken); border: 1px solid var(--line);
          border-radius: var(--r-md);
        }
        .bim-steps { list-style: none; counter-reset: step; display: flex; flex-direction: column; gap: 16px; }
        .bim-steps > li { counter-increment: step; position: relative; padding-left: 34px; }
        .bim-steps > li::before {
          content: counter(step); position: absolute; left: 0; top: 0;
          width: 24px; height: 24px; border-radius: 50%;
          background: var(--accent-wash); color: var(--accent);
          font-size: 12px; font-weight: 700; display: grid; place-items: center;
        }
        .bim-step-title { font-size: 13.5px; font-weight: 600; margin-bottom: 7px; }
        .bim-step-body { display: flex; gap: 8px; flex-wrap: wrap; }
        .bim-step-text { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; }
        .bim-step-note { font-size: 11.5px; color: var(--ink-faint); margin-top: 6px; }

        .bim-chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 13px; border-radius: var(--r-md);
          border: 1.5px solid var(--line-strong); color: var(--ink-soft);
          font-size: 12.5px; font-weight: 600; transition: color .13s, background .13s, border-color .13s;
        }
        .bim-chip:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }

        .bim-textarea {
          width: 100%; min-height: 96px; resize: vertical;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
          padding: 10px 12px; border: 1px solid var(--line-strong);
          border-radius: var(--r-sm); background: var(--paper-sunken); color: var(--ink);
          line-height: 1.45;
        }
        .bim-textarea:focus { outline: none; border-color: var(--accent); background: var(--paper); }
        .bim-textarea-actions { margin-top: 6px; }
        .bim-link {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 12px; color: var(--accent); font-weight: 600;
        }
        .bim-link:hover { text-decoration: underline; }

        .bim-error {
          margin-top: 14px; padding: 10px 14px; background: var(--err-wash); color: var(--err-ink);
          border-radius: var(--r-sm); font-size: 12.5px; line-height: 1.45;
        }
        .bim-issues {
          margin-top: 14px; padding: 12px 14px; background: var(--warn-wash);
          border: 1px solid var(--line); border-radius: var(--r-sm);
          font-size: 12.5px; color: var(--warn-ink);
        }
        .bim-issues-title { display: flex; align-items: center; gap: 6px; font-weight: 700; margin-bottom: 8px; }
        .bim-issues ul { list-style: none; display: flex; flex-direction: column; gap: 4px; }
        .bim-issues code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px; font-size: 11.5px;
        }
        .bim-issues-more { font-style: italic; opacity: .8; }
        .bim-issues-hint { margin-top: 9px; font-size: 11.5px; opacity: .85; }

        .bim-preview-head {
          display: flex; align-items: center; gap: 8px;
          font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 12px;
        }
        .bim-dup-note {
          display: flex; gap: 8px; align-items: flex-start;
          padding: 9px 12px; margin-bottom: 12px; border-radius: var(--r-sm);
          background: var(--warn-wash); color: var(--warn-ink);
          font-size: 12px; line-height: 1.45;
        }
        .bim-dup-note svg { flex-shrink: 0; margin-top: 2px; }

        .bim-select-all {
          display: flex; align-items: center; justify-content: space-between;
          padding-bottom: 8px; border-bottom: 1px solid var(--line);
          font-size: 12.5px; font-weight: 600;
        }
        .bim-count { font-size: 11.5px; color: var(--ink-faint); font-weight: 500; }

        .bim-list { list-style: none; display: flex; flex-direction: column; }
        .bim-item { border-bottom: 1px solid var(--line); }
        .bim-item .check-row { align-items: flex-start; padding: 9px 2px; width: 100%; }
        .bim-item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .bim-item-title {
          font-size: 13px; font-weight: 600; color: var(--ink);
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .bim-item-sub {
          font-size: 11.5px; color: var(--ink-faint); line-height: 1.4;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .bim-item-dup .bim-item-title { color: var(--ink-soft); }
        .bim-dup-tag {
          font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
          padding: 1px 6px; border-radius: 999px;
          background: var(--warn-wash); color: var(--warn-ink);
        }

        .bim-registry-note {
          margin-top: 12px; padding: 9px 12px; border-radius: var(--r-sm);
          background: var(--paper-raised); border: 1px solid var(--line);
          font-size: 12px; color: var(--ink-soft); line-height: 1.45;
        }
        .bim-registry-note strong { color: var(--ink); }

        .bim-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        .bim-secondary {
          padding: 9px 16px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          border: 1.5px solid var(--line-strong); color: var(--ink-soft); transition: color .13s, border-color .13s;
        }
        .bim-secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .bim-primary {
          padding: 9px 18px; border-radius: var(--r-md); font-size: 13px; font-weight: 600;
          background: var(--accent); color: #fff; transition: background .13s;
        }
        .bim-primary:hover:not(:disabled) { background: var(--accent-bright); }
        .bim-primary:disabled { opacity: .6; cursor: default; }
      `}</style>
    </div>
  )
}
