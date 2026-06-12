import { useRef, useState } from 'react'
import { Upload, FileJson, Sparkles, FilePlus, Wand2 } from 'lucide-react'
import { isBackupFormat, importFromBackup, UnsupportedBackupVersionError } from '../lib/backup'
import { importFromCVPartner } from '../lib/importer'
import {
  isAIImportFormat, validateAIImport, importFromAIDraft, InvalidAIImportError,
} from '../lib/aiImport'
import { isLinkedInExport, importFromLinkedIn } from '../lib/importerLinkedIn'
import {
  isEuropassJson, isEuropassXml, importFromEuropassJson, importFromEuropassXml,
} from '../lib/importerEuropass'
import { AIImportModal } from './AIImportModal'
import type { ResumeStore } from '../types'

const YEAR = new Date().getFullYear()

export interface ImportScreenProps {
  /** Render in compact mode (inside the picker panel — no brand block, no footer). */
  compact?: boolean
  /** Called when the user starts with an empty resume. */
  onStartFresh: () => void | Promise<void>
  /** Called with the parsed store + a suggested name derived from the file. */
  onImported: (store: ResumeStore, suggestedName: string) => void | Promise<void>
}

function deriveName(store: ResumeStore, fallback: string): string {
  const full = store.resume?.full_name?.trim()
  return full ? `${full} — CV` : fallback
}

export function ImportScreen({ compact = false, onStartFresh, onImported }: ImportScreenProps) {
  const [error, setError]       = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [showAI, setShowAI]     = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError(null)
    try {
      // LinkedIn data export: a ZIP of CSVs. fflate is lazy-loaded so the
      // unzip code only ships when someone actually drops a .zip.
      if (/\.zip$/i.test(file.name)) {
        const { unzipSync, strFromU8 } = await import('fflate')
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
        const files: Record<string, string> = {}
        for (const [name, bytes] of Object.entries(entries)) {
          if (/\.csv$/i.test(name)) files[name] = strFromU8(bytes)
        }
        if (!isLinkedInExport(files)) {
          setError('That ZIP doesn’t look like a LinkedIn data export (no Profile/Positions/Skills CSVs found).')
          return
        }
        const store = importFromLinkedIn(files)
        await onImported(store, deriveName(store, 'LinkedIn import'))
        return
      }

      const text = await file.text()

      // Europass XML (SkillsPassport) — the classic europa.eu CV download.
      if (/\.xml$/i.test(file.name) || isEuropassXml(text)) {
        const store = importFromEuropassXml(text)
        await onImported(store, deriveName(store, 'Europass import'))
        return
      }

      const json = JSON.parse(text) as unknown

      if (isEuropassJson(json)) {
        const store = importFromEuropassJson(json)
        await onImported(store, deriveName(store, 'Europass import'))
      } else if (isAIImportFormat(json)) {
        // AI-import drafts get validated up-front; the field-pathed message is
        // far more useful than a generic parse failure. (The guided AI modal
        // shows the full issue list — here we surface the first problem.)
        const store = importFromAIDraft(validateAIImport(json))
        await onImported(store, deriveName(store, 'AI-imported resume'))
      } else if (isBackupFormat(json)) {
        const store = importFromBackup(json)
        await onImported(store, deriveName(store, 'Imported resume'))
      } else {
        const store = importFromCVPartner(json as Record<string, unknown>)
        await onImported(store, deriveName(store, 'Imported CV'))
      }
    } catch (e) {
      const msg = e instanceof UnsupportedBackupVersionError || e instanceof InvalidAIImportError
        ? e.message
        : `Could not parse file: ${(e as Error).message}`
      setError(msg)
    }
  }

  const innerClass = compact ? 'is-inner is-inner-compact' : 'is-inner'

  return (
    <div className={compact ? 'import-screen is-compact' : 'import-screen'}>
      <div className={innerClass}>

        {!compact && (
          <>
            <div className="is-brand">
              <img src="/cartavio-symbol.png" alt="Cartavio" className="is-symbol" />
              <h1 className="is-title">Cartavio Resume Studio</h1>
            </div>
            <p className="is-lede">
              Maintain one master consultant resume across multiple languages, then extract
              targeted CVs for any skill area.
            </p>
          </>
        )}

        <div
          className={`is-drop ${dragging ? 'drag' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Choose a resume file to import (or drop one here)"
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) void handleFile(f)
          }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            // The hidden file input is unreachable by Tab — the zone itself is
            // the keyboard affordance (WCAG 2.1.1).
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
        >
          <div className="is-drop-icon"><Upload size={28} /></div>
          <div className="is-drop-title">Drop your resume file here</div>
          <div className="is-drop-sub">or click to browse — Resume Studio backups, CVpartner exports, LinkedIn data exports (.zip), Europass (.xml/.json), or AI import files</div>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json,.zip,application/zip,.xml,text/xml"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          />
        </div>

        {error && <div className="is-error" role="alert">{error}</div>}

        {!compact && (
          <div className="is-features">
            <div className="is-feat"><FileJson size={16} /> Resume Studio backup (.json) — restore a previous session</div>
            <div className="is-feat"><FileJson size={16} /> CVpartner export (.json) — import projects, employment, education, skills &amp; more</div>
            <div className="is-feat"><FileJson size={16} /> LinkedIn data export (.zip) and Europass CV (.xml / .json)</div>
            <div className="is-feat"><Wand2 size={16} /> Start from a PDF/Word CV with your own AI — no account or API key needed</div>
            <div className="is-feat"><Sparkles size={16} /> Side-by-side dual-language editing in any two locales</div>
          </div>
        )}

        <div className="is-divider"><span>or</span></div>

        <button className="is-ai" onClick={() => setShowAI(true)}>
          <Wand2 size={16} />
          Start from a PDF/Word file with AI
        </button>

        <button className="is-fresh" onClick={() => void onStartFresh()}>
          <FilePlus size={16} />
          Start with an empty resume
        </button>
      </div>

      {showAI && (
        <AIImportModal
          onClose={() => setShowAI(false)}
          onImported={onImported}
        />
      )}

      {!compact && (
        <footer className="is-page-footer">
          <span>© {YEAR} Cartavio AS</span>
          <span className="is-footer-dot">·</span>
          <a href="https://cartavio.no" target="_blank" rel="noopener noreferrer">
            cartavio.no
          </a>
        </footer>
      )}

      <style>{`
        .import-screen {
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 60px 40px 80px; position: relative; z-index: 1;
        }
        .import-screen.is-compact { min-height: 0; padding: 0; }
        .is-inner { max-width: 540px; width: 100%; text-align: center; animation: fadeUp .5s ease; }
        .is-inner-compact { animation: none; }

        /* Brand block */
        .is-brand {
          display: flex; align-items: center; justify-content: center;
          gap: 16px; margin-bottom: 14px;
        }
        .is-symbol { width: 52px; height: 52px; object-fit: contain; flex-shrink: 0; }
        .is-title {
          font-size: 44px; letter-spacing: -.01em;
          color: var(--accent); text-align: left;
        }
        .is-lede { color: var(--ink-soft); font-size: 15px; line-height: 1.6; margin-bottom: 32px; }

        /* Drop zone */
        .is-drop {
          border: 2px dashed var(--line-strong); border-radius: var(--r-lg);
          padding: 40px 30px; cursor: pointer; transition: color .2s, background .2s, border-color .2s, box-shadow .2s, transform .2s; background: var(--paper-raised);
        }
        .is-drop:hover, .is-drop.drag, .is-drop:focus-visible {
          border-color: var(--accent); background: var(--accent-wash);
          transform: translateY(-2px); box-shadow: var(--shadow-md);
        }
        .is-drop:focus-visible {
          outline: 2px solid var(--accent); outline-offset: 2px;
        }
        .is-drop-icon {
          width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%;
          background: var(--paper-sunken); color: var(--accent); display: grid; place-items: center;
        }
        .is-drop.drag .is-drop-icon { background: var(--accent); color: #fff; }
        .is-drop-title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
        .is-drop-sub { color: var(--ink-faint); font-size: 13px; }

        /* Error */
        .is-error {
          margin-top: 14px; padding: 10px 14px; background: var(--accent-wash);
          color: var(--accent); border-radius: var(--r-sm); font-size: 13px; text-align: left;
        }

        /* Feature list */
        .is-features {
          margin-top: 28px; display: flex; flex-direction: column; gap: 10px;
          align-items: flex-start; text-align: left;
        }
        .is-feat { display: flex; align-items: center; gap: 10px; color: var(--ink-soft); font-size: 13.5px; }
        .is-feat svg { color: var(--accent); flex-shrink: 0; }

        /* Or divider */
        .is-divider {
          display: flex; align-items: center; gap: 12px; margin: 24px 0 18px;
          color: var(--ink-faint); font-size: 11px; font-weight: 600;
          letter-spacing: .08em; text-transform: uppercase;
        }
        .is-divider::before, .is-divider::after {
          content: ''; flex: 1; height: 1px; background: var(--line);
        }

        /* AI-assisted import button — prominent (accent outline) */
        .is-ai {
          display: inline-flex; align-items: center; gap: 8px; width: 100%;
          justify-content: center; padding: 11px 22px; border-radius: var(--r-md);
          border: 1.5px solid var(--accent); background: var(--accent-wash);
          font-size: 14px; font-weight: 600; color: var(--accent);
          transition: color .15s, background .15s, border-color .15s, box-shadow .15s; margin-bottom: 10px;
        }
        .is-ai:hover { background: var(--accent); color: #fff; }
        .is-ai svg { flex-shrink: 0; }

        /* Start fresh button */
        .is-fresh {
          display: inline-flex; align-items: center; gap: 8px; width: 100%;
          justify-content: center; padding: 11px 22px; border-radius: var(--r-md);
          border: 1.5px solid var(--line-strong);
          font-size: 14px; font-weight: 600; color: var(--ink-soft);
          transition: color .15s, background .15s, border-color .15s, box-shadow .15s;
        }
        .is-fresh:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
        .is-fresh svg { flex-shrink: 0; }

        /* Page footer */
        .is-page-footer {
          position: fixed; bottom: 0; left: 0; right: 0;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 12px 24px; font-size: 11px; color: var(--ink-faint);
          background: linear-gradient(to top, var(--paper) 70%, transparent);
          pointer-events: none;
        }
        .is-page-footer a {
          color: var(--ink-faint); text-decoration: none; pointer-events: all;
          transition: color .15s;
        }
        .is-page-footer a:hover { color: var(--accent); }
        .is-footer-dot { opacity: .5; }
      `}</style>
    </div>
  )
}
