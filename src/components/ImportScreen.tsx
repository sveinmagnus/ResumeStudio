import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { Upload, FileJson, Sparkles, FilePlus } from 'lucide-react'
import { isBackupFormat, importFromBackup } from '../lib/backup'

const YEAR = new Date().getFullYear()

export function ImportScreen() {
  const { loadFromCVPartner, loadStore, startFresh } = useStore()
  const [error, setError]       = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError(null)
    try {
      const text = await file.text()
      const json = JSON.parse(text) as unknown

      if (isBackupFormat(json)) {
        loadStore(importFromBackup(json))
      } else {
        loadFromCVPartner(json as Record<string, unknown>)
      }
    } catch (e) {
      setError(`Could not parse file: ${(e as Error).message}`)
    }
  }

  return (
    <div className="import-screen">
      <div className="is-inner">

        {/* Cartavio logo — full colour on white background */}
        <img src="/cartavio-logo.png" alt="Cartavio" className="is-logo" />

        <h1 className="is-title">Resume Studio</h1>
        <p className="is-lede">
          Maintain one master consultant resume across multiple languages, then extract
          targeted CVs for any skill area.
        </p>

        <div
          className={`is-drop ${dragging ? 'drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) void handleFile(f)
          }}
          onClick={() => inputRef.current?.click()}
        >
          <div className="is-drop-icon"><Upload size={28} /></div>
          <div className="is-drop-title">Drop your resume file here</div>
          <div className="is-drop-sub">or click to browse — accepts Resume Studio backups and CVpartner exports</div>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          />
        </div>

        {error && <div className="is-error">{error}</div>}

        <div className="is-features">
          <div className="is-feat"><FileJson size={16} /> Resume Studio backup (.json) — restore a previous session</div>
          <div className="is-feat"><FileJson size={16} /> CVpartner export (.json) — import projects, employment, education, skills &amp; more</div>
          <div className="is-feat"><Sparkles size={16} /> Side-by-side dual-language editing in any two locales</div>
        </div>

        <div className="is-divider"><span>or</span></div>

        <button className="is-fresh" onClick={startFresh}>
          <FilePlus size={16} />
          Start with an empty resume
        </button>
      </div>

      {/* Page footer */}
      <footer className="is-page-footer">
        <span>© {YEAR} Cartavio AS</span>
        <span className="is-footer-dot">·</span>
        <a href="https://cartavio.no" target="_blank" rel="noopener noreferrer">
          cartavio.no
        </a>
      </footer>

      <style>{`
        .import-screen {
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 60px 40px 80px; position: relative; z-index: 1;
        }
        .is-inner { max-width: 540px; width: 100%; text-align: center; animation: fadeUp .5s ease; }

        /* Logo */
        .is-logo { width: 200px; height: auto; margin: 0 auto 18px; display: block; }

        /* Title */
        .is-title {
          font-size: 38px; letter-spacing: -.01em; margin-bottom: 12px;
          color: var(--accent);
        }
        .is-lede { color: var(--ink-soft); font-size: 15px; line-height: 1.6; margin-bottom: 32px; }

        /* Drop zone */
        .is-drop {
          border: 2px dashed var(--line-strong); border-radius: var(--r-lg);
          padding: 40px 30px; cursor: pointer; transition: all .2s; background: var(--paper-raised);
        }
        .is-drop:hover, .is-drop.drag {
          border-color: var(--accent); background: var(--accent-wash);
          transform: translateY(-2px); box-shadow: var(--shadow-md);
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

        /* Start fresh button */
        .is-fresh {
          display: inline-flex; align-items: center; gap: 8px; width: 100%;
          justify-content: center; padding: 11px 22px; border-radius: var(--r-md);
          border: 1.5px solid var(--line-strong);
          font-size: 14px; font-weight: 600; color: var(--ink-soft);
          transition: all .15s;
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
