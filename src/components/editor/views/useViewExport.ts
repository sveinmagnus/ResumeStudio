/**
 * The view editor's export actions.
 *
 * PDF, DOCX and standalone HTML run asynchronously behind a busy flag (the
 * first two lazy-load heavy renderers; HTML fetches the fonts it inlines); the
 * ATS text, Markdown, Europass and JSON Resume paths build a string
 * synchronously. Every path stamps `last_exported_at` on success and funnels
 * failures into one dismissible error.
 */
import { useState } from 'react'
import type { ResumeStore, ResumeView } from '../../../types'
import type { GlobalFonts } from '../../../lib/fonts'
import { buildViewText, buildViewMarkdown } from '../../../lib/viewText'
import { exportEuropassXml } from '../../../lib/exporterEuropass'
import { buildJsonResume } from '../../../lib/exporterJsonResume'
import { exportFilename } from '../../../lib/exportFilename'
import { downloadText } from '../../../lib/download'

export type TextExportKind = 'txt' | 'md' | 'xml' | 'jsonresume'

export interface ViewExport {
  pdfBusy: boolean
  docxBusy: boolean
  htmlBusy: boolean
  error: string | null
  clearError: () => void
  exportPdf: () => void
  exportDocx: () => void
  /** Single-file standalone HTML — fonts inlined, opens from disk (lib/htmlExport). */
  exportHtml: () => void
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
  const [htmlBusy, setHtmlBusy] = useState(false)
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

  // Not heavy like pdfmake, but async: the brand fonts are fetched and inlined
  // so the file opens from disk (file://) with nothing to reach back for.
  const exportHtml = () => runHeavy('HTML', setHtmlBusy, async () => {
    const { collectFontAssets, buildStandaloneViewHtml } = await import('../../../lib/htmlExport')
    const fonts = await collectFontAssets()
    const html = buildStandaloneViewHtml(data, view, exportLocale, globalFonts, fonts)
    downloadText(html, exportFilename(data.resume?.full_name, view.name, 'html'), 'text/html;charset=utf-8')
  })

  const exportTextual = (kind: TextExportKind) => {
    const { content, mime, ext } = ((): { content: string; mime: string; ext: string } => {
      switch (kind) {
        case 'xml':
          return { content: exportEuropassXml(data, view, exportLocale), mime: 'application/xml;charset=utf-8', ext: 'xml' }
        case 'jsonresume':
          return { content: JSON.stringify(buildJsonResume(data, view, exportLocale), null, 2), mime: 'application/json;charset=utf-8', ext: 'json' }
        case 'txt':
          return { content: buildViewText(data, view, exportLocale), mime: 'text/plain;charset=utf-8', ext: 'txt' }
        case 'md':
          return { content: buildViewMarkdown(data, view, exportLocale), mime: 'text/plain;charset=utf-8', ext: 'md' }
      }
    })()
    downloadText(content, exportFilename(data.resume?.full_name, view.name, ext), mime)
    onExported()
  }

  return {
    pdfBusy, docxBusy, htmlBusy, error,
    clearError: () => setError(null),
    exportPdf, exportDocx, exportHtml, exportTextual,
  }
}
