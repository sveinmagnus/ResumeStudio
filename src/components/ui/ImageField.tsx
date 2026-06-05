import { useRef, useState } from 'react'
import { Upload, X, ImageOff } from 'lucide-react'
import { fileToResizedDataUrl } from '../../lib/image'

/**
 * Upload / preview / remove control for an image stored as a base64 data URL.
 * Used for the master profile photo + company logo (HeaderEditor) and for the
 * per-view overrides (ResumeViewsEditor). The selected file is downscaled
 * client-side before being handed to `onChange` so the stored payload stays
 * small.
 */
export function ImageField({
  label, value, onChange, format = 'jpeg', maxDim = 600, hint, shape = 'square',
}: {
  label: string
  value: string | null
  onChange: (dataUrl: string | null) => void
  format?: 'jpeg' | 'png'
  maxDim?: number
  hint?: string
  shape?: 'square' | 'wide'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = () => inputRef.current?.click()

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const dataUrl = await fileToResizedDataUrl(file, { format, maxDim })
      onChange(dataUrl)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="imgf-wrap">
      <label className="imgf-label">{label}</label>
      <div className="imgf-row">
        <div className={`imgf-preview imgf-${shape} ${value ? '' : 'is-empty'}`}>
          {value
            ? <img src={value} alt={`${label} preview`} />
            : <ImageOff size={shape === 'wide' ? 22 : 26} />}
        </div>
        <div className="imgf-controls">
          <button type="button" className="imgf-btn" onClick={pick} disabled={busy}>
            <Upload size={13} /> {busy ? 'Processing…' : value ? 'Replace' : 'Upload'}
          </button>
          {value && (
            <button type="button" className="imgf-btn imgf-remove" onClick={() => onChange(null)} disabled={busy}>
              <X size={13} /> Remove
            </button>
          )}
          {hint && <span className="imgf-hint">{hint}</span>}
          {error && <span className="imgf-error">{error}</span>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="imgf-input"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <style>{`
        .imgf-wrap { margin-bottom: 16px; }
        .imgf-label {
          display: block; font-size: 11px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px;
        }
        .imgf-row { display: flex; align-items: flex-start; gap: 14px; }
        .imgf-preview {
          display: grid; place-items: center; overflow: hidden; flex-shrink: 0;
          background: var(--paper-sunken); border: 1px solid var(--line);
          border-radius: var(--r-sm); color: var(--ink-faint);
        }
        .imgf-preview img { width: 100%; height: 100%; object-fit: contain; }
        .imgf-square { width: 84px; height: 84px; }
        .imgf-square img { object-fit: cover; }
        .imgf-wide { width: 132px; height: 64px; }
        .imgf-preview.is-empty { border-style: dashed; }
        .imgf-controls { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; }
        .imgf-btn {
          display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
          background: var(--accent-wash); color: var(--accent); border-radius: var(--r-sm);
          font-size: 12.5px; font-weight: 600; transition: all .13s;
        }
        .imgf-btn:hover:not(:disabled) { background: var(--accent); color: #fff; }
        .imgf-btn:disabled { opacity: .6; cursor: progress; }
        .imgf-remove { background: transparent; color: var(--ink-faint); }
        .imgf-remove:hover:not(:disabled) { background: #fee2e2; color: #b91c1c; }
        .imgf-hint { font-size: 11.5px; color: var(--ink-faint); line-height: 1.4; max-width: 240px; }
        .imgf-error { font-size: 11.5px; color: #b91c1c; }
        .imgf-input { display: none; }
      `}</style>
    </div>
  )
}
