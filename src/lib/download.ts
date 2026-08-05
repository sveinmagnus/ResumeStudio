/**
 * Browser file download — the one place the anchor-click dance lives.
 *
 * This was written five times (exporter, pdfExporter's caller, backup,
 * CoverLettersEditor, BulkImportModal, ViewEditor) with three different revoke
 * strategies. Two of them revoked the object URL synchronously right after
 * `click()`, which races the browser's fetch of the blob — Firefox in
 * particular can drop the download. The version here is the safe one:
 *
 *   attach to the DOM → click → detach → revoke on the next macrotask
 *
 * Deliberately dependency-free and tiny so it can be imported from
 * always-loaded modules without pulling anything into the initial bundle
 * (the lazy `exporter` / `pdfExporter` chunks import it too).
 */

/** Trigger a download of `blob` as `filename`. No-op outside a browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // Firefox ignores a programmatic click on a detached anchor, so the element
  // has to be in the document before `click()` and is removed straight after.
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Deferred: revoking synchronously can cancel the in-flight download.
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

/** Download a string as a file. `mime` should carry a charset for text types. */
export function downloadText(content: string, filename: string, mime: string): void {
  downloadBlob(new Blob([content], { type: mime }), filename)
}
