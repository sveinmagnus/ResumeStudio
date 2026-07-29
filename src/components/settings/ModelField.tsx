/**
 * The model field: a free-text input with a browsable list of what the provider
 * actually offers.
 *
 * It replaces a `<datalist>`, which was wrong in two ways that both showed up in
 * use:
 *
 *  1. **The list appeared once.** A datalist is FILTERED by the input's current
 *     value, so once you'd picked `gemini-2.5-flash` the field contained an
 *     exact option and re-focusing offered nothing. The only way back to the
 *     full list was to switch the provider off and on again — i.e. to clear the
 *     field. Browsers give no control over that filtering, so the fix is to stop
 *     using a datalist and own the popup.
 *  2. **Password managers targeted it.** A plain text input immediately above a
 *     `type="password"` field looks exactly like a username, so 1Password et al.
 *     offered to fill a login. `autoComplete="off"` plus the per-manager opt-out
 *     attributes stops that; the key inputs use `new-password` for the same
 *     reason.
 *
 * The list is always the FULL set — that's the point of a pick-list — with a
 * type-ahead filter of its own inside the popup, which we can make behave.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, ChevronDown, Check } from 'lucide-react'
import { useSettingsForm } from './context'
import { modelPlaceholder, noModelsHint } from '../../lib/cloudModelCatalog'

export function ModelField() {
  const {
    llmProvider, llmModel, setLlmModel, llmKeys, llmKeySet,
    modelOpts, modelsBusy, refreshModels, isOllama,
  } = useSettingsForm()

  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Close on an outside click / Esc, like every other popover in the app.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return modelOpts
    return modelOpts.filter((m) => m.name.toLowerCase().includes(q))
  }, [modelOpts, filter])

  const anyKeyTyped = Object.values(llmKeys).some((k) => k.trim().length > 0)
  const anyKeySaved = Object.values(llmKeySet).some(Boolean)
  const hasKey = anyKeyTyped || anyKeySaved || isOllama

  return (
    <>
      <label className="sm-field-label" htmlFor="sm-llm-model">Model</label>
      <div className="mf-wrap" ref={wrapRef}>
        <div className="sm-field-row">
          <input
            id="sm-llm-model"
            className="sm-input"
            value={llmModel}
            placeholder={modelPlaceholder(llmProvider)}
            onChange={(e) => setLlmModel(e.target.value)}
            aria-label="AI assist model"
            // Not a credential field. Without these a password manager sees a
            // text input above a password input and offers to fill a login.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            name="llm-model-id"
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
          />
          <button
            type="button"
            className="sm-btn sm-btn-icon"
            onClick={() => { setFilter(''); setOpen((o) => !o) }}
            aria-expanded={open}
            aria-controls={listId}
            title="Show the models this provider offers"
            aria-label="Show available models"
          >
            <ChevronDown size={13} className={open ? 'mf-open' : ''} />
          </button>
          <button
            type="button"
            className="sm-btn sm-btn-icon"
            onClick={() => void refreshModels()}
            disabled={modelsBusy}
            title="Ask the provider for its current model list"
            aria-label="Refresh model list"
          >
            {modelsBusy ? <Loader2 size={13} className="sm-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>

        {open && (
          <div className="mf-pop" id={listId} role="listbox" aria-label="Available models">
            {modelOpts.length > 8 && (
              <input
                className="mf-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter…"
                aria-label="Filter models"
                autoComplete="off"
                data-1p-ignore=""
                data-lpignore="true"
              />
            )}
            {shown.length === 0 && (
              <div className="mf-empty">
                {modelOpts.length === 0 ? noModelsHint(llmProvider, hasKey) : 'Nothing matches that filter.'}
              </div>
            )}
            {shown.map((m) => (
              <button
                key={m.name}
                type="button"
                role="option"
                aria-selected={m.name === llmModel}
                className={`mf-row${m.name === llmModel ? ' mf-picked' : ''}`}
                onClick={() => { setLlmModel(m.name); setOpen(false) }}
              >
                <span className="mf-name">{m.name}</span>
                <span className="mf-label">{m.label}</span>
                {m.name === llmModel && <Check size={12} className="mf-check" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="sm-help">
        {modelOpts.length > 0
          ? `${modelOpts.length} model(s) listed — from the provider itself, so it stays current. Any id the provider accepts still works.`
          : noModelsHint(llmProvider, hasKey)}
      </p>

      <style>{`
        .mf-wrap { position: relative; }
        .mf-open { transform: rotate(180deg); }
        .mf-pop {
          position: absolute; z-index: 20; left: 0; right: 0; top: calc(100% + 4px);
          max-height: 280px; overflow-y: auto; overscroll-behavior: contain;
          background: var(--paper); border: 1px solid var(--line-strong);
          border-radius: var(--r-sm); box-shadow: var(--shadow-md);
          padding: 4px; display: flex; flex-direction: column; gap: 1px;
        }
        .mf-filter {
          width: 100%; padding: 6px 8px; margin-bottom: 4px; font: inherit; font-size: 12.5px;
          border: 1px solid var(--line); border-radius: var(--r-sm);
          background: var(--paper-sunken); color: var(--ink);
        }
        .mf-empty { padding: 10px; font-size: 12.5px; color: var(--ink-faint); line-height: 1.45; }
        .mf-row {
          display: flex; align-items: baseline; gap: 8px; width: 100%;
          padding: 6px 8px; border: none; background: none; cursor: pointer;
          border-radius: var(--r-sm); text-align: left; color: var(--ink);
        }
        .mf-row:hover { background: var(--accent-wash); }
        .mf-picked { background: var(--accent-wash); }
        .mf-name { flex: 1; font-size: 13px; font-family: var(--sans); }
        .mf-label { font-size: 11px; color: var(--ink-faint); flex-shrink: 0; }
        .mf-check { color: var(--accent); flex-shrink: 0; }
      `}</style>
    </>
  )
}
