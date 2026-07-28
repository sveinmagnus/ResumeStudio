import { useState } from 'react'
import { useStore, newId } from '../../store/useStore'
import type { CoverLetter } from '../../types'
import { Plus, Pencil, Trash2, Mail, ChevronDown, FileText, FileDown, FileType } from 'lucide-react'
import { DualField } from '../ui/DualField'
import { AssistRun } from '../ui/AssistRun'
import { buildCoverLetterPrompt, buildCoverLetterText } from '../../lib/coverLetter'
import { getDefaultFonts } from '../../lib/appPrefs'
import { exportFilename } from '../../lib/exportFilename'
import { downloadText } from '../../lib/download'

/**
 * Cover Letters — the document-builder sibling of Resume Views. A letter is its
 * own entity that references a view (the CV it accompanies); its export reuses
 * that view's letterhead + fonts. List → single-letter editor, local selection
 * (no deep-linking yet — unlike views, which the sidebar links into).
 */
export function CoverLettersEditor() {
  const { data, addItem, removeItem, updateItem, primaryLocale } = useStore()
  const letters = data.cover_letters ?? []
  const [activeId, setActiveId] = useState<string | null>(null)

  const createLetter = () => {
    const now = new Date().toISOString()
    const letter: CoverLetter = {
      id: newId(),
      name: 'New cover letter',
      // Default to the first view if one exists — most letters accompany a CV.
      view_id: data.views[0]?.id ?? null,
      company: {}, recipient: {}, role_applied: {},
      greeting: {}, body: {}, closing: {},
      place_dated: null, posting: '',
      created_at: now, updated_at: now,
    }
    addItem('cover_letters', letter)
    setActiveId(letter.id)
  }

  const deleteLetter = (id: string) => {
    if (activeId === id) setActiveId(null)
    removeItem('cover_letters', id)
  }

  if (activeId) {
    const letter = letters.find((l) => l.id === activeId)
    if (!letter) { setActiveId(null); return null }
    return (
      <LetterEditor
        letter={letter}
        onBack={() => setActiveId(null)}
        onDelete={() => deleteLetter(letter.id)}
        onUpdate={(patch) => updateItem('cover_letters', letter.id, patch)}
        primaryLocale={primaryLocale}
      />
    )
  }

  return (
    <div className="cl-pane">
      <div className="cl-intro">
        <p>
          A cover letter accompanies a Resume View when you apply for a role. It's a separate
          document — write one per application, draft it from the job posting with your own AI,
          and export it beside the CV in matching fonts.
        </p>
        <button className="cl-create-btn" onClick={createLetter}>
          <Plus size={15} /> New cover letter
        </button>
      </div>

      {letters.length === 0 ? (
        <div className="cl-empty">
          <Mail size={36} />
          <p>No cover letters yet.</p>
          <p className="cl-empty-sub">Create one to pair a letter with a Resume View.</p>
        </div>
      ) : (
        <div className="cl-cards">
          {letters.map((l) => {
            const view = l.view_id ? data.views.find((v) => v.id === l.view_id) : null
            return (
              <div key={l.id} className="cl-card">
                <div className="cl-card-icon"><Mail size={20} /></div>
                <div className="cl-card-body">
                  <div className="cl-card-name">{l.name || 'Untitled letter'}</div>
                  <div className="cl-card-meta">
                    {view ? `for “${view.name}”` : 'no view linked'}
                  </div>
                </div>
                <div className="cl-card-actions">
                  <button className="cl-btn-edit" onClick={() => setActiveId(l.id)}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button className="cl-btn-del" onClick={() => deleteLetter(l.id)} title="Delete letter">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Styles />
    </div>
  )
}

// ─── Single-letter editor ───────────────────────────────────────────────────────

function LetterEditor({ letter, onBack, onDelete, onUpdate, primaryLocale }: {
  letter: CoverLetter
  onBack: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<CoverLetter>) => void
  primaryLocale: string
}) {
  const { data } = useStore()
  const [editingName, setEditingName] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const globalFonts = getDefaultFonts()

  const download = (content: string, ext: string, mime: string) => {
    downloadText(content, exportFilename(data.resume?.full_name, letter.name || 'cover-letter', ext), mime)
  }

  const onExport = async (kind: 'pdf' | 'docx' | 'txt') => {
    setExportError(null)
    try {
      if (kind === 'txt') {
        download(buildCoverLetterText(data, letter, primaryLocale), 'txt', 'text/plain;charset=utf-8')
      } else if (kind === 'pdf') {
        const { exportCoverLetterPdf } = await import('../../lib/pdfExporter')
        await exportCoverLetterPdf(data, letter, primaryLocale, globalFonts)
      } else {
        const { exportCoverLetterDocx } = await import('../../lib/exporter')
        await exportCoverLetterDocx(data, letter, primaryLocale, globalFonts)
      }
    } catch (e) {
      setExportError(`Could not export: ${(e as Error).message}`)
    }
  }

  return (
    <div className="cl-editor">
      <div className="cl-editor-top">
        <button className="cl-back" onClick={onBack}>← All cover letters</button>
        <ExportMenu onPick={onExport} />
        <button className="cl-btn-del cl-del-top" onClick={onDelete} title="Delete this letter">
          <Trash2 size={15} />
        </button>
      </div>
      {exportError && <p className="cl-export-err" role="alert">{exportError}</p>}

      {/* Name */}
      <div className="cl-block">
        {editingName ? (
          <>
            <label className="cl-label" htmlFor="cl-name">Cover letter name</label>
            <input
              id="cl-name" className="cl-name-input" value={letter.name} autoFocus
              onChange={(e) => onUpdate({ name: e.target.value })}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditingName(false) } }}
              placeholder="e.g. Equinor — Lead Architect"
            />
          </>
        ) : (
          <div className="cl-name-display">
            <h2 className="cl-name">{letter.name || 'Untitled letter'}</h2>
            <button className="cl-name-edit" onClick={() => setEditingName(true)} aria-label="Edit name" title="Edit name">
              <Pencil size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Linked view */}
      <div className="cl-block">
        <label className="cl-label" htmlFor="cl-view">Accompanies which CV (Resume View)</label>
        <select
          id="cl-view" className="cl-select"
          value={letter.view_id ?? ''}
          onChange={(e) => onUpdate({ view_id: e.target.value || null })}
        >
          <option value="">— none (use resume letterhead) —</option>
          {data.views.map((v) => <option key={v.id} value={v.id}>{v.name || 'Untitled view'}</option>)}
        </select>
        <p className="cl-hint">The letter borrows this view's fonts so it matches the CV you send with it.</p>
      </div>

      {/* Addressing */}
      <div className="cl-block">
        <DualField label="Company / organisation" value={letter.company} onChange={(v) => onUpdate({ company: v })} placeholder="e.g. Equinor ASA" />
      </div>
      <div className="cl-block">
        <DualField label="Recipient" value={letter.recipient} onChange={(v) => onUpdate({ recipient: v })} placeholder="e.g. Hiring Manager" />
      </div>
      <div className="cl-block">
        <DualField label="Role applied for" value={letter.role_applied} onChange={(v) => onUpdate({ role_applied: v })} placeholder="e.g. Lead Solutions Architect" />
        <p className="cl-hint">Used in the subject line (“Application for …”) and the AI draft.</p>
      </div>

      {/* Job posting (for the AI draft; never exported) */}
      <div className="cl-block">
        <label className="cl-label" htmlFor="cl-posting">Job posting <span className="cl-label-note">— for drafting only, never printed</span></label>
        <textarea
          id="cl-posting" className="cl-posting" rows={4}
          value={letter.posting ?? ''}
          onChange={(e) => onUpdate({ posting: e.target.value })}
          placeholder="Paste the job posting here so the AI can ground the letter in it…"
        />
      </div>

      {/* AI draft — writes the BODY. Manual path exists (copy the prompt). */}
      <div className="cl-block cl-assist">
        <AssistRun
          buildPrompt={() => buildCoverLetterPrompt(data, letter, primaryLocale)}
          onResult={(text) => onUpdate({ body: { ...letter.body, [primaryLocale]: text.trim() } })}
          wholeCv
          label="Draft the letter body"
          maxTokens={1200}
          hasManualPath
        >
          <CopyPromptButton getPrompt={() => buildCoverLetterPrompt(data, letter, primaryLocale)} />
        </AssistRun>
      </div>

      {/* Letter content */}
      <div className="cl-block">
        <DualField label="Greeting" value={letter.greeting} onChange={(v) => onUpdate({ greeting: v })} placeholder="e.g. Dear Hiring Manager," />
      </div>
      <div className="cl-block">
        <DualField label="Body" value={letter.body} onChange={(v) => onUpdate({ body: v })} multiline rows={12} placeholder="Write the letter, or draft it above then edit…" />
      </div>
      <div className="cl-block">
        <DualField label="Closing" value={letter.closing} onChange={(v) => onUpdate({ closing: v })} placeholder="e.g. Yours sincerely," />
      </div>
      <div className="cl-block">
        <label className="cl-label" htmlFor="cl-dated">Place &amp; date line <span className="cl-label-note">— blank = today at export</span></label>
        <input
          id="cl-dated" className="cl-name-input" value={letter.place_dated ?? ''}
          onChange={(e) => onUpdate({ place_dated: e.target.value || null })}
          placeholder="e.g. Oslo, 17 July 2026"
        />
      </div>

      <Styles />
    </div>
  )
}

function CopyPromptButton({ getPrompt }: { getPrompt: () => string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="cl-copy-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(getPrompt())
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied' : 'Copy prompt for your LLM'}
    </button>
  )
}

function ExportMenu({ onPick }: { onPick: (kind: 'pdf' | 'docx' | 'txt') => void }) {
  const [open, setOpen] = useState(false)
  const pick = (kind: 'pdf' | 'docx' | 'txt') => { onPick(kind); setOpen(false) }
  return (
    <div className="cl-exportmenu">
      <button className="cl-export-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <FileDown size={15} /> Export letter <ChevronDown size={13} />
      </button>
      {open && (
        <div className="cl-export-pop" role="menu">
          <button role="menuitem" className="cl-export-item" onClick={() => pick('pdf')}><FileText size={15} /> PDF</button>
          <button role="menuitem" className="cl-export-item" onClick={() => pick('docx')}><FileDown size={15} /> DOCX</button>
          <button role="menuitem" className="cl-export-item" onClick={() => pick('txt')}><FileType size={15} /> Text</button>
        </div>
      )}
    </div>
  )
}

function Styles() {
  return (
    <style>{`
      .cl-pane, .cl-editor { max-width: 760px; }
      .cl-intro p, .cl-hint { color: var(--ink-soft); font-size: 13px; line-height: 1.5; }
      .cl-intro { margin-bottom: 18px; }
      .cl-create-btn, .cl-back, .cl-export-trigger {
        display: inline-flex; align-items: center; gap: 7px; font-weight: 600; font-size: 14px;
        padding: 9px 15px; border-radius: var(--r-sm); background: var(--accent); color: #fff;
        margin-top: 12px;
      }
      .cl-create-btn:hover, .cl-export-trigger:hover { background: var(--accent-bright); }
      .cl-back { background: var(--paper-raised); color: var(--ink); border: 1px solid var(--line); margin: 0; }
      .cl-empty { text-align: center; color: var(--ink-faint); padding: 48px 0; }
      .cl-empty svg { color: var(--line-strong); }
      .cl-empty p { margin: 8px 0 0; }
      .cl-empty-sub { font-size: 13px; }
      .cl-cards { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
      .cl-card {
        display: flex; align-items: center; gap: 14px; padding: 14px 16px;
        background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--r-md);
      }
      .cl-card-icon { color: var(--secondary-ink); flex: none; }
      .cl-card-body { flex: 1; min-width: 0; }
      .cl-card-name { font-weight: 600; font-size: 15px; }
      .cl-card-meta { font-size: 12px; color: var(--ink-faint); margin-top: 2px; }
      .cl-card-actions { display: flex; gap: 6px; flex: none; }
      .cl-btn-edit {
        display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600;
        padding: 6px 11px; border-radius: var(--r-sm); border: 1px solid var(--line);
        background: var(--paper); color: var(--ink);
      }
      .cl-btn-edit:hover { border-color: var(--accent); color: var(--accent); }
      .cl-btn-del {
        display: grid; place-items: center; padding: 6px; border-radius: var(--r-sm);
        border: 1px solid transparent; color: var(--ink-faint); background: transparent;
      }
      .cl-btn-del:hover { color: var(--err-ink); background: var(--err-wash); }
      .cl-editor-top { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
      .cl-del-top { margin-left: auto; border: 1px solid var(--line); }
      .cl-export-err { color: var(--err-ink); background: var(--err-wash); padding: 8px 12px; border-radius: var(--r-sm); font-size: 13px; }
      .cl-block { margin-bottom: 18px; }
      .cl-label {
        display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
        text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
      }
      .cl-label-note { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--ink-faint); }
      .cl-name-input, .cl-select, .cl-posting {
        width: 100%; padding: 9px 11px; background: var(--paper-raised);
        border: 1px solid var(--line); border-radius: var(--r-sm); font-size: 14px;
        font-family: var(--sans);
      }
      .cl-name-input:focus, .cl-select:focus, .cl-posting:focus {
        outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash);
      }
      .cl-name-display { display: flex; align-items: center; gap: 8px; }
      .cl-name { font-size: 20px; font-weight: 600; margin: 0; }
      .cl-name-edit { display: grid; place-items: center; padding: 5px; color: var(--ink-faint); background: transparent; border-radius: var(--r-sm); }
      .cl-name-edit:hover { color: var(--accent); background: var(--accent-wash); }
      .cl-hint { margin-top: 6px; }
      .cl-assist { padding: 14px; background: var(--paper-sunken); border-radius: var(--r-md); border: 1px solid var(--line); }
      .cl-copy-btn {
        font-size: 13px; font-weight: 600; color: var(--accent); background: transparent;
        border: 1px solid var(--line); padding: 7px 12px; border-radius: var(--r-sm);
      }
      .cl-copy-btn:hover { border-color: var(--accent); background: var(--accent-wash); }
      .cl-exportmenu { position: relative; }
      .cl-export-pop {
        position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; min-width: 160px;
        background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--r-md);
        box-shadow: var(--shadow-md); padding: 4px;
      }
      .cl-export-item {
        display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
        padding: 8px 12px; border-radius: var(--r-sm); font-size: 14px; color: var(--ink); background: transparent;
      }
      .cl-export-item:hover { background: var(--accent-wash); color: var(--accent); }
    `}</style>
  )
}
