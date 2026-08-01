/**
 * Minimal ambient types for pdfmake's browser build submodules. We don't pull
 * in @types/pdfmake — the doc definition is built as loose `Record` shapes and
 * pdfmake validates at runtime, so we only need to type the entry points we
 * lazy-import in `lib/pdfExporter.ts`.
 */
declare module 'pdfmake/build/pdfmake' {
  interface PdfDocGenerator {
    /** Resolves once the document is laid out and handed to the browser. */
    download(filename?: string): Promise<void>
    open(): Promise<void>
    getBlob(): Promise<Blob>
  }
  /**
   * A doc definition's `footer` callback. pdfmake hands it the total page count
   * once layout is done — the only public way to learn the real pagination, and
   * how `countPdfPages` in lib/pdfExporter.ts gets a truthful number.
   */
  type FooterFn = (currentPage: number, pageCount: number, pageSize: unknown) => unknown
  /**
   * A font bundle as pdfmake ships them: the font files themselves keyed by the
   * name the PDF references, plus the family's style→filename map. Registering
   * one is how a family becomes available — see `FontContainer` consumers in
   * lib/pdfExporter.ts.
   */
  interface FontContainer {
    vfs: Record<string, string | { data: string, encoding?: string }>
    fonts: Record<string, Record<string, string>>
  }
  interface PdfMakeStatic {
    /** Adds a family's files AND its style map in one call (pdfmake >= 0.3). */
    addFontContainer(container: FontContainer): void
    createPdf(docDefinition: unknown): PdfDocGenerator
  }
  const pdfMake: PdfMakeStatic
  export default pdfMake
  export type { FooterFn, PdfMakeStatic, FontContainer }
}

/**
 * The font containers. Roboto is pdfmake's embedded default; the standard-fonts
 * modules carry the standard-14 metrics, which the 0.3 browser build no longer
 * bundles into pdfmake.js itself.
 */
declare module 'pdfmake/build/fonts/Roboto' {
  import type { FontContainer } from 'pdfmake/build/pdfmake'
  const container: FontContainer
  export default container
}
declare module 'pdfmake/build/standard-fonts/Times' {
  import type { FontContainer } from 'pdfmake/build/pdfmake'
  const container: FontContainer
  export default container
}
declare module 'pdfmake/build/standard-fonts/Helvetica' {
  import type { FontContainer } from 'pdfmake/build/pdfmake'
  const container: FontContainer
  export default container
}
declare module 'pdfmake/build/standard-fonts/Courier' {
  import type { FontContainer } from 'pdfmake/build/pdfmake'
  const container: FontContainer
  export default container
}
