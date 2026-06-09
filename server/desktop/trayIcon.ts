/**
 * Tray icon used by the desktop launcher.
 *
 * We embed the real Cartavio favicon (the brand mark served from cartavio.no)
 * as a base64-encoded PNG and hand it to systray2 as-is on macOS/Linux, or
 * wrap it in a PNG-in-ICO container on Windows. Embedding the bytes keeps the
 * launcher single-file (no extra asset to copy at build time) and means the
 * tray icon always matches what the user sees on cartavio.no — the previous
 * programmatically-drawn navy/cyan square didn't match the brand mark and got
 * called out as wrong.
 *
 * Pure logic; safe to bundle (no I/O, only base64 + buffer manipulation). The
 * results are memoised so the per-platform buffer is built at most once.
 */

// Base64-encoded PNG of the Cartavio favicon
// (https://www.cartavio.no/wp-content/uploads/2023/01/cartavio-invest-logo-symbol-350px-150x150.png,
// 150×150, RGBA, 6.3 KB). Embedded so the tray icon ships with the launcher
// rather than depending on a runtime file path or a network fetch.
const CARTAVIO_FAVICON_B64 =
  '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'

let pngCache: Buffer | null = null
/**
 * The Cartavio brand mark as a PNG buffer (decoded from the embedded base64).
 * Exported so unit tests can sanity-check the embedded payload without booting
 * the tray helper.
 */
export function pngIcon(): Buffer {
  if (!pngCache) pngCache = Buffer.from(CARTAVIO_FAVICON_B64, 'base64')
  return pngCache
}

/**
 * Read the intrinsic width/height from a PNG's IHDR chunk. Both fields are
 * big-endian uint32 at offsets 16 and 20 from the start of the file (the
 * IHDR data immediately follows the 8-byte signature + 4-byte length + 4-byte
 * type). The favicon may not be 32×32, so the ICO container needs the real
 * dimensions or Windows draws garbage.
 */
function pngDims(png: Buffer): { width: number; height: number } {
  const width  = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  return { width, height }
}

/** Wrap a PNG in a single-image ICO container (PNG-in-ICO, valid on Win Vista+). */
export function icoFromPng(png: Buffer): Buffer {
  const { width, height } = pngDims(png)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count
  const entry = Buffer.alloc(16)
  entry[0] = width  >= 256 ? 0 : width   // width  (0 = 256+)
  entry[1] = height >= 256 ? 0 : height  // height
  entry[2] = 0  // palette colors
  entry[3] = 0  // reserved
  entry.writeUInt16LE(1, 4)  // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8)  // image data size
  entry.writeUInt32LE(6 + 16, 12)     // offset to image data
  return Buffer.concat([header, entry, png])
}

let icoCache: Buffer | null = null
function icoIcon(): Buffer {
  if (!icoCache) icoCache = icoFromPng(pngIcon())
  return icoCache
}

/** Base64 tray icon for the platform: ICO on Windows, PNG elsewhere. */
export function trayIconBase64(platform: NodeJS.Platform = process.platform): string {
  return (platform === 'win32' ? icoIcon() : pngIcon()).toString('base64')
}
