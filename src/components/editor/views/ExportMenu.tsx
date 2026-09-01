/**
 * The export dropdown: one trigger, every export format behind it.
 *
 * Shared between the view editor's header and the view LIST (per-row export +
 * "Export all"), so the format set can never differ by surface — a format
 * added here is everywhere at once. Closes on outside-click / Escape.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileCode, FileDown, FileText, FileType } from 'lucide-react'

export function ExportMenu({
  label, onPdf, onDocx, onHtml, onText, onMarkdown, onEuropass, onJsonResume,
  pdfBusy, docxBusy, htmlBusy, lastExportedAt,
}: {
  /** Trigger text — "Export view" in the editor, "Export"/"Export all" on the list. */
  label: string
  onPdf: () => void
  onDocx: () => void
  onHtml: () => void
  onText: () => void
  onMarkdown: () => void
  onEuropass: () => void
  onJsonResume: () => void
  pdfBusy: boolean
  docxBusy: boolean
  htmlBusy: boolean
  lastExportedAt: string | null
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The heavy exporters run asynchronously and show a busy label — keep the
  // menu open for those so the progress is visible; the string exports complete
  // synchronously and close.
  const pick = (fn: () => void, keepOpen = false) => { fn(); if (!keepOpen) setOpen(false) }

  return (
    <div className="rv-exportmenu" ref={ref}>
      <button
        type="button"
        className="rv-export-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <FileDown size={15} /> {label}
        <ChevronDown size={13} className={open ? 'rv-exp-chev open' : 'rv-exp-chev'} />
      </button>
      {open && (
        <div className="rv-export-pop" role="menu">
          <button type="button" role="menuitem" className="rv-export-item" onClick={() => pick(onPdf, true)} disabled={pdfBusy}>
            <FileText size={15} /> {pdfBusy ? 'Building PDF…' : 'Export PDF'}
          </button>
          <button type="button" role="menuitem" className="rv-export-item" onClick={() => pick(onDocx, true)} disabled={docxBusy}>
            <FileDown size={15} /> {docxBusy ? 'Building DOCX…' : 'Export DOCX'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="rv-export-item"
            onClick={() => pick(onHtml, true)}
            disabled={htmlBusy}
            title="One self-contained .html file — fonts embedded, opens anywhere, share as a link-sized attachment"
          >
            <FileCode size={15} /> {htmlBusy ? 'Building HTML…' : 'HTML (single file)'}
          </button>
          <button type="button" role="menuitem" className="rv-export-item" onClick={() => pick(onText)}>
            <FileType size={15} /> Text (ATS)
          </button>
          <button type="button" role="menuitem" className="rv-export-item" onClick={() => pick(onMarkdown)}>
            <FileCode size={15} /> Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            className="rv-export-item"
            onClick={() => pick(onEuropass)}
            title="Europass covers identity, work, education and languages — other sections are not part of the format"
          >
            <FileType size={15} /> Europass XML
          </button>
          <button
            type="button"
            role="menuitem"
            className="rv-export-item"
            onClick={() => pick(onJsonResume)}
            title="The open jsonresume.org interchange format — for themes, other CV tools and pipelines"
          >
            <FileCode size={15} /> JSON Resume
          </button>
          {lastExportedAt && (
            <div className="rv-export-menu-foot">
              Last exported {new Date(lastExportedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
