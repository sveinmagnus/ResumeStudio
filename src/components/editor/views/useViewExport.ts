/**
 * The view editor's five export actions.
 *
 * PDF and DOCX lazy-load their (heavy) renderers and carry a busy flag; the
 * ATS text, Markdown and Europass paths build a string synchronously. All five
 * stamp `last_exported_at` on success, and all five funnel failures into one
 * dismissible error.
 */
import { useState } from 'react'
import type { ResumeStore, ResumeView } from '../../../types'
import type { GlobalFonts } from '../../../lib/fonts'
import { buildViewText, buildViewMarkdown } from '../../../lib/viewText'
import { exportEuropassXml } from '../../../lib/exporterEuropass'
import { exportFilename } from '../../../lib/exportFilename'
import { downloadText } from '../../../lib/download'

export type TextExportKind = 'txt' | 'md' | 'xml'

export interface ViewExport {
  pdfBusy: boolean
  docxBusy: boolean
  error: string | null
  clearError: () => void
  exportPdf: () => void
  exportDocx: () => void
  /** The synchronous string exports: ATS text, Markdown, Europass XML. */
  exportTextual: (kind: TextExportKind) => void
}

export function useViewExport(
  data: ResumeStore,
  view: ResumeView,
  exportLocale: string,
  globalFonts: GlobalFonts,
  onExported: () => void,
): ViewExport {
  const [pdfBusy, setPdfBusy] = useState(false)
  const [docxBusy, setDocxBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Run a lazy-loaded exporter behind a busy flag, reporting any failure. */
  const runHeavy = (
    label: string,
    setBusy: (v: boolean) => void,
    run: () => Promise<void>,
  ) => {
    setError(null)
    setBusy(true)
    void (async () => {
      try {
        await run()
        onExported()
      } catch (e) {
        setError(`Could not export ${label}: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    })()
  }

  // pdfmake is ~1.5 MB and docx ~400 kB — both are lazy-loaded only when the
  // user actually exports (CLAUDE.md §11).
  const exportPdf = () => runHeavy('PDF', setPdfBusy, async () => {
    const { exportPdf: run } = await import('../../../lib/pdfExporter')
    await run(data, view, exportLocale, globalFonts)
  })

  const exportDocx = () => runHeavy('DOCX', setDocxBusy, async () => {
    const { exportDocx: run } = await import('../../../lib/exporter')
    await run(data, view, exportLocale, globalFonts)
  })

  const exportTextual = (kind: TextExportKind) => {
    const { content, mime } = kind === 'xml'
      ? { content: exportEuropassXml(data, view, exportLocale), mime: 'application/xml;charset=utf-8' }
      : {
          content: kind === 'txt'
            ? buildViewText(data, view, exportLocale)
            : buildViewMarkdown(data, view, exportLocale),
          mime: 'text/plain;charset=utf-8',
        }
    downloadText(content, exportFilename(data.resume?.full_name, view.name, kind), mime)
    onExported()
  }

  return {
    pdfBusy, docxBusy, error,
    clearError: () => setError(null),
    exportPdf, exportDocx, exportTextual,
  }
}
