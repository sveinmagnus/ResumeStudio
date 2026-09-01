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
export type ExportKind = 'pdf' | 'docx' | 'html' | TextExportKind

/**
 * The editor's opening export language: the view's persisted `export_locale`
 * while that is still a supported locale (a wipe or re-detect can orphan it),
 * else the resume's first locale. The LIST page deliberately does not use
 * this — its exports follow the visible primary/secondary/both selector, so
 * one choice explains every file the page produces.
 */
export function viewExportLocale(data: ResumeStore, view: ResumeView, fallback: string): string {
  const supported = data.resume?.supported_locales ?? []
  if (view.export_locale && supported.includes(view.export_locale)) return view.export_locale
  return supported[0] ?? fallback
}

/**
 * Run ONE export of ONE view to a downloaded file. The single implementation
 * behind both the editor's dropdown and the list's per-row / export-all
 * actions, so a format cannot behave differently depending on where it was
 * clicked. PDF/DOCX lazy-load their renderers (CLAUDE.md §11); HTML fetches
 * the fonts it inlines; the string formats build synchronously.
 */
export async function runViewExport(
  kind: ExportKind,
  data: ResumeStore,
  view: ResumeView,
  locale: string,
  globalFonts: GlobalFonts,
): Promise<void> {
  switch (kind) {
    case 'pdf': {
      const { exportPdf } = await import('../../../lib/pdfExporter')
      await exportPdf(data, view, locale, globalFonts)
      return
    }
    case 'docx': {
      const { exportDocx } = await import('../../../lib/exporter')
      await exportDocx(data, view, locale, globalFonts)
      return
    }
    case 'html': {
      const { collectFontAssets, buildStandaloneViewHtml } = await import('../../../lib/htmlExport')
      const fonts = await collectFontAssets()
      const html = buildStandaloneViewHtml(data, view, locale, globalFonts, fonts)
      downloadText(html, exportFilename(data.resume?.full_name, view.name, 'html'), 'text/html;charset=utf-8')
      return
    }
    case 'xml':
      downloadText(exportEuropassXml(data, view, locale), exportFilename(data.resume?.full_name, view.name, 'xml'), 'application/xml;charset=utf-8')
      return
    case 'jsonresume':
      downloadText(JSON.stringify(buildJsonResume(data, view, locale), null, 2), exportFilename(data.resume?.full_name, view.name, 'json'), 'application/json;charset=utf-8')
      return
    case 'txt':
      downloadText(buildViewText(data, view, locale), exportFilename(data.resume?.full_name, view.name, 'txt'), 'text/plain;charset=utf-8')
      return
    case 'md':
      downloadText(buildViewMarkdown(data, view, locale), exportFilename(data.resume?.full_name, view.name, 'md'), 'text/plain;charset=utf-8')
      return
  }
}

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

  const exportPdf = () => runHeavy('PDF', setPdfBusy, () => runViewExport('pdf', data, view, exportLocale, globalFonts))
  const exportDocx = () => runHeavy('DOCX', setDocxBusy, () => runViewExport('docx', data, view, exportLocale, globalFonts))
  const exportHtml = () => runHeavy('HTML', setHtmlBusy, () => runViewExport('html', data, view, exportLocale, globalFonts))

  const exportTextual = (kind: TextExportKind) => {
    // The string exports complete synchronously inside runViewExport — the
    // promise resolves without yielding, so no busy flag is needed.
    setError(null)
    void runViewExport(kind, data, view, exportLocale, globalFonts)
      .then(onExported)
      .catch((e: unknown) => setError(`Could not export: ${(e as Error).message}`))
  }

  return {
    pdfBusy, docxBusy, htmlBusy, error,
    clearError: () => setError(null),
    exportPdf, exportDocx, exportHtml, exportTextual,
  }
}

export interface ViewsExport {
  busy: boolean
  /** "Exporting 2/5…" while running; null at rest. */
  progress: string | null
  error: string | null
  clearError: () => void
  run: (kind: ExportKind) => void
}

/**
 * Export a SET of views in one chosen format, one file per view per language.
 * The list page's single engine: "Export all" hands it every view, a row's
 * Export hands it just that one — so the toolbar's language selector governs
 * both identically.
 *
 * `locales` is the selector's choice (primary/secondary/both). With more than
 * one, each file's view-name part carries the locale code — the two languages
 * of one view would otherwise download under the SAME filename and the browser
 * would dedupe one of them into "…(1)". The suffix rides the view name because
 * every exporter (including PDF/DOCX, which build their filenames internally)
 * derives its filename from it; the only content that sees it is the
 * standalone HTML's browser-tab <title>, where naming the language is a
 * feature.
 *
 * Sequential on purpose: the browser treats a burst of programmatic downloads
 * far better one at a time (Chrome asks once to allow multiple downloads and
 * then lets a sequence through), and the heavy renderers would otherwise all
 * load and lay out concurrently. A failure stops the run and names the file it
 * died on — the files already downloaded are real, so pretending the whole run
 * failed would be wrong, and continuing past an error would likely repeat it
 * for every remaining view.
 */
export function useViewsExport(
  data: ResumeStore,
  views: ResumeView[],
  locales: string[],
  globalFonts: GlobalFonts,
  onExported: (viewId: string) => void,
): ViewsExport {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = (kind: ExportKind) => {
    if (busy || views.length === 0 || locales.length === 0) return
    setError(null)
    setBusy(true)
    void (async () => {
      const total = views.length * locales.length
      let done = 0
      try {
        for (const view of views) {
          for (const locale of locales) {
            setProgress(`Exporting ${++done}/${total}…`)
            const named = locales.length > 1
              ? { ...view, name: `${view.name} ${locale.toUpperCase()}` }
              : view
            try {
              await runViewExport(kind, data, named, locale, globalFonts)
            } catch (e) {
              setError(`Could not export "${named.name}": ${(e as Error).message}`)
              return
            }
          }
          onExported(view.id)
        }
      } finally {
        setBusy(false)
        setProgress(null)
      }
    })()
  }

  return { busy, progress, error, clearError: () => setError(null), run }
}
