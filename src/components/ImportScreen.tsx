import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { Upload, FileJson, Sparkles } from 'lucide-react'
import { isBackupFormat, importFromBackup } from '../lib/backup'

export function ImportScreen() {
  const { loadFromCVPartner, loadStore } = useStore()
  const [error, setError]     = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError(null)
    try {
      const text = await file.text()
      const json = JSON.parse(text) as unknown

      if (isBackupFormat(json)) {
        // Resume Studio backup file — load directly
        loadStore(importFromBackup(json))
      } else {
        // Assume CVpartner export format
        loadFromCVPartner(json as Record<string, unknown>)
      }
    } catch (e) {
      setError(`Could not parse file: ${(e as Error).message}`)
    }
  }

  return (
    <div className="import-screen">
      <div className="is-inner">
        <div className="is-badge"><Sparkles size={13} /> Multi-language resume manager</div>
        <h1 className="is-title">Resume Studio</h1>
        <p className="is-lede">
          Maintain one master consultant resume across multiple languages, then extract
          targeted CVs for any skill area. Begin by importing a file below.
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
      </div>

      <style>{`
        .import-screen {
          min-height: 100vh; display: grid; place-items: center; padding: 40px;
          position: relative; z-index: 1;
        }
        .is-inner { max-width: 540px; text-align: center; animation: fadeUp .5s ease; }
        .is-badge {
          display: inline-flex; align-items: center; gap: 6px; padding: 5px 13px;
          background: var(--accent-wash); color: var(--accent); border-radius: 20px;
          font-size: 12px; font-weight: 600; margin-bottom: 22px;
        }
        .is-title { font-size: 56px; letter-spacing: -.01em; margin-bottom: 14px; }
        .is-lede { color: var(--ink-soft); font-size: 16px; line-height: 1.6; margin-bottom: 34px; }
        .is-drop {
          border: 2px dashed var(--line-strong); border-radius: var(--r-lg);
          padding: 44px 30px; cursor: pointer; transition: all .2s; background: var(--paper-raised);
        }
        .is-drop:hover, .is-drop.drag {
          border-color: var(--accent); background: var(--accent-wash);
          transform: translateY(-2px); box-shadow: var(--shadow-md);
        }
        .is-drop-icon {
          width: 60px; height: 60px; margin: 0 auto 16px; border-radius: 50%;
          background: var(--paper-sunken); color: var(--accent); display: grid; place-items: center;
        }
        .is-drop.drag .is-drop-icon { background: var(--accent); color: #fff; }
        .is-drop-title { font-size: 17px; font-weight: 600; margin-bottom: 4px; }
        .is-drop-sub { color: var(--ink-faint); font-size: 13px; }
        .is-error {
          margin-top: 16px; padding: 11px 15px; background: var(--accent-wash);
          color: var(--accent); border-radius: var(--r-sm); font-size: 13px; text-align: left;
        }
        .is-features {
          margin-top: 34px; display: flex; flex-direction: column; gap: 12px;
          align-items: flex-start; text-align: left;
        }
        .is-feat { display: flex; align-items: center; gap: 10px; color: var(--ink-soft); font-size: 14px; }
        .is-feat svg { color: var(--accent); flex-shrink: 0; }
      `}</style>
    </div>
  )
}
