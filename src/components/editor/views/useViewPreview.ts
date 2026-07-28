/**
 * The live-preview machinery behind the view editor: the debounced HTML
 * rebuild, the pop-out window, the iframe measurement and the two page counts.
 *
 * This was ~120 lines of interleaved effects and refs inside ViewEditor, which
 * made a 1100-line component harder to read than the feature warrants. None of
 * it touches the editor's own state, so it lifts out cleanly.
 *
 * Two page counts, deliberately:
 *   estimate — the preview iframe's height / an A4 page. Instant and free, but
 *              it measures the HTML render, not the PDF, so it is only a
 *              ballpark (13 vs a true 10 on a real CV).
 *   exact    — pdfmake's real pagination (lazy, debounced, ~2 MB the first
 *              time). The truth, and what the page limit + AI advice run on.
 * The estimate paints immediately and is labelled "≈"; the exact count
 * replaces it when it lands.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ResumeStore, ResumeView } from '../../../types'
import { buildViewHtml } from '../../../lib/viewFilter'
import type { GlobalFonts } from '../../../lib/fonts'

/** A4 height at 96 dpi — rough; web fonts shift things slightly. */
const A4_PX = 1123
/** How often to check whether a pop-out window was closed from its title bar. */
const POPOUT_POLL_MS = 800
/** Debounce before rebuilding the preview HTML. */
const REBUILD_MS = 250
/** Debounce before the (expensive) real pagination. */
const EXACT_PAGES_MS = 700

export interface ViewPreview {
  html: string
  iframeRef: RefObject<HTMLIFrameElement>
  /** Best available page count: the exact one if it has landed, else the estimate. */
  pageCount: number | null
  /** The exact count alone — null until pdfmake has run. */
  exactPages: number | null
  showPreview: boolean
  setShowPreview: (v: boolean | ((p: boolean) => boolean)) => void
  poppedOut: boolean
  /** Open the preview in its own window. Returns false if the pop-up was blocked. */
  popOut: () => boolean
  /** Close that window and bring the inline pane back. */
  popIn: () => void
}

export function useViewPreview(
  data: ResumeStore,
  view: ResumeView,
  exportLocale: string,
  globalFonts: GlobalFonts,
): ViewPreview {
  const [html, setHtml] = useState(() => buildViewHtml(data, view, exportLocale, globalFonts))
  const [pageEstimate, setPageEstimate] = useState<number | null>(null)
  const [exactPages, setExactPages] = useState<number | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  // Kept as STATE (not just the ref) so the toolbar can flip Pop out / Pop in,
  // and so an externally-closed window re-enables popping out. Independent of
  // showPreview: the inline pane can be shown or hidden either way.
  const [poppedOut, setPoppedOut] = useState(false)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const popoutRef = useRef<Window | null>(null)
  // Preserved across rebuilds so tweaking a control doesn't fling the preview
  // back to the top of the résumé.
  const scrollRef = useRef(0)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setHtml(buildViewHtml(data, view, exportLocale, globalFonts))
    }, REBUILD_MS)
    return () => window.clearTimeout(t)
  }, [data, view, exportLocale, globalFonts])

  // Keep a popped-out window in sync with the live HTML.
  useEffect(() => {
    const win = popoutRef.current
    if (win && !win.closed) {
      win.document.open()
      win.document.write(html)
      win.document.close()
    }
  }, [html])

  // Close the pop-out when leaving the view editor.
  useEffect(() => () => { popoutRef.current?.close() }, [])

  // A window closed from its own title bar fires no event in the opener, so
  // poll while popped out: once it's gone, drop back to the "Pop out"
  // affordance so the button never lies and popping out again works.
  useEffect(() => {
    if (!poppedOut) return
    const id = window.setInterval(() => {
      if (!popoutRef.current || popoutRef.current.closed) {
        popoutRef.current = null
        setPoppedOut(false)
      }
    }, POPOUT_POLL_MS)
    return () => window.clearInterval(id)
  }, [poppedOut])

  // Measure the rendered height, and keep the user's scroll position.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    let refine: number | undefined
    const measure = () => {
      const body = iframe.contentDocument?.body
      if (!body) return
      setPageEstimate(Math.max(1, Math.ceil(body.scrollHeight / A4_PX)))
    }
    const restoreScroll = () => {
      try { iframe.contentWindow?.scrollTo(0, scrollRef.current) } catch { /* jsdom / cross-origin */ }
    }
    const onLoad = () => {
      const win = iframe.contentWindow
      if (win) {
        // Reapply the saved offset, then track scrolling on the freshly-loaded
        // document (the old window's listeners died with it).
        restoreScroll()
        win.addEventListener('scroll', () => { scrollRef.current = win.scrollY }, { passive: true })
      }
      measure()
      // Web fonts settle after load and shift the layout; re-measure and re-pin
      // the scroll so the position holds once heights are final.
      refine = window.setTimeout(() => { measure(); restoreScroll() }, 400)
    }
    iframe.addEventListener('load', onLoad)
    return () => {
      iframe.removeEventListener('load', onLoad)
      if (refine !== undefined) window.clearTimeout(refine)
    }
  }, [html])

  // The real pagination, debounced well behind the preview: it lazy-loads
  // pdfmake and lays the whole document out, so it must never run per
  // keystroke. Stale replies are dropped — a fast edit after a slow layout
  // would otherwise show the previous view's count.
  useEffect(() => {
    let alive = true
    const t = window.setTimeout(() => {
      // Dynamic import: pdfExporter pulls in pdfmake, which must never join the
      // always-loaded bundle (CLAUDE.md §11).
      void import('../../../lib/pdfExporter')
        .then(({ countPdfPages }) => countPdfPages(data, view, exportLocale, globalFonts))
        .then((n) => { if (alive) setExactPages(n) })
        // A failed count isn't worth an error in the user's face — the estimate
        // stays on screen and the export button is unaffected.
        .catch(() => { if (alive) setExactPages(null) })
    }, EXACT_PAGES_MS)
    return () => { alive = false; window.clearTimeout(t) }
  }, [data, view, exportLocale, globalFonts])

  const popOut = (): boolean => {
    const win = window.open('', 'rs-view-preview', 'width=900,height=1200')
    if (!win) return false
    popoutRef.current = win
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    setPoppedOut(true)
    // Popping out reclaims the editor width by default; the inline preview can
    // be brought back at any time, even while the window is open.
    setShowPreview(false)
    return true
  }

  const popIn = () => {
    popoutRef.current?.close()
    popoutRef.current = null
    setPoppedOut(false)
    setShowPreview(true)
  }

  return {
    html,
    iframeRef,
    pageCount: exactPages ?? pageEstimate,
    exactPages,
    showPreview,
    setShowPreview,
    poppedOut,
    popOut,
    popIn,
  }
}
