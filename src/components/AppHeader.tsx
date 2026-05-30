import { useRef } from 'react'
import { Download, Upload, Undo2, Redo2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useUndoRedo } from '../store/useUndoRedo'
import { SaveStatus, type SaveState } from './layout/SaveStatus'
import { LanguageSwitcher } from './layout/LanguageSwitcher'
import { downloadBackup } from '../lib/backup'
import type { SectionDef } from '../lib/sections'

interface AppHeaderProps {
  section: SectionDef | undefined
  saveState: SaveState
  cacheSavedAt: string | null
  onRetry: () => void
  onLoadFile: (file: File) => void
}

/**
 * The editor's top bar: breadcrumb + title, save status, undo/redo, language
 * switcher, and the load/save-file buttons. Owns the undo/redo hook (it's the
 * sole consumer and the keyboard shortcuts only matter once data is loaded)
 * and the hidden file input. Reads `data` lazily at click time for the backup
 * download so the header doesn't re-render on every keystroke.
 */
export function AppHeader({ section, saveState, cacheSavedAt, onRetry, onLoadFile }: AppHeaderProps) {
  const { undo, redo, canUndo, canRedo } = useUndoRedo()
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <header className="app-header">
      <div className="ah-titles">
        <div className="ah-crumb">{section?.group}</div>
        <h1 className="ah-title">{section?.label}</h1>
      </div>
      <div className="ah-controls">
        <SaveStatus state={saveState} cacheSavedAt={cacheSavedAt} onRetry={onRetry} />
        <div className="ah-history">
          <button
            className="ah-hist-btn"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo"
          >
            <Undo2 size={15} />
          </button>
          <button
            className="ah-hist-btn"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo"
          >
            <Redo2 size={15} />
          </button>
        </div>
        <LanguageSwitcher />

        {/* Load file — accepts backup JSON or CVpartner JSON */}
        <button
          className="ah-btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          title="Load a backup file or CVpartner export"
        >
          <Upload size={15} /> Load file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onLoadFile(f)
            // Reset so the same file can be reloaded
            e.target.value = ''
          }}
        />

        {/* Save to file — downloads backup JSON */}
        <button
          className="ah-export"
          onClick={() => downloadBackup(useStore.getState().data)}
          title="Download a portable backup of your resume"
        >
          <Download size={16} /> Save to file
        </button>
      </div>

      <style>{`
        .app-header {
          display: flex; align-items: flex-end; justify-content: space-between; gap: 20px;
          padding: 22px 36px 18px; border-bottom: 1px solid var(--line);
          position: sticky; top: 0; background: var(--paper); z-index: 10; flex-wrap: wrap;
        }
        .ah-crumb { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }
        .ah-title { font-size: 30px; margin-top: 2px; }
        .ah-controls { display: flex; align-items: center; gap: 10px; }
        .ah-history {
          display: inline-flex; align-items: stretch; gap: 1px;
          background: var(--paper-raised); border: 1px solid var(--line);
          border-radius: var(--r-sm); overflow: hidden;
        }
        .ah-hist-btn {
          width: 30px; height: 32px; display: grid; place-items: center;
          color: var(--ink-soft); transition: all .13s;
        }
        .ah-hist-btn:hover:not(:disabled) { background: var(--accent-wash); color: var(--accent); }
        .ah-hist-btn:disabled { opacity: .3; cursor: default; }
        .ah-btn-secondary {
          display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px;
          border: 1.5px solid var(--line-strong); border-radius: var(--r-md);
          font-weight: 600; font-size: 13px; color: var(--ink-soft); transition: all .15s;
        }
        .ah-btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
        .ah-export {
          display: inline-flex; align-items: center; gap: 7px; padding: 11px 18px;
          background: var(--ink); color: var(--paper); border-radius: var(--r-md);
          font-weight: 600; font-size: 14px; transition: all .15s; align-self: stretch;
        }
        .ah-export:hover { background: var(--accent); }
      `}</style>
    </header>
  )
}
