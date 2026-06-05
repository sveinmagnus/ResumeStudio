/**
 * Image helpers for profile photos & company logos.
 *
 * Images are stored as base64 data URLs directly in the resume / view JSON
 * (no file server) — they sync and back up with everything else. To keep the
 * payload reasonable, uploads are downscaled client-side via a canvas before
 * being stored.
 *
 * `fileToResizedDataUrl` touches the DOM (Image + canvas) — like exporter.ts
 * and localCache.ts it lives in lib but is browser-only. `imageInfoFromDataUrl`
 * is pure (decodes a base64 header) and is used by the DOCX exporter, which
 * needs the intrinsic dimensions + format to embed an image.
 */

// ─── Upload → resized data URL (browser only) ────────────────────────────────

export interface ResizeOptions {
  /** Longest-edge cap in pixels. */
  maxDim?: number
  /** Output format. PNG preserves transparency (logos); JPEG is smaller (photos). */
  format?: 'jpeg' | 'png'
  /** JPEG quality 0..1 (ignored for PNG). */
  quality?: number
}

/**
 * Read an image File, downscale so its longest edge is at most `maxDim`, and
 * return a base64 data URL. Rejects on a non-image file or a decode failure.
 */
export function fileToResizedDataUrl(file: File, opts: ResizeOptions = {}): Promise<string> {
  const { maxDim = 600, format = 'jpeg', quality = 0.82 } = opts
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Selected file is not an image.'))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas not supported.')); return }
        ctx.drawImage(img, 0, 0, w, h)
        const mime = format === 'png' ? 'image/png' : 'image/jpeg'
        resolve(canvas.toDataURL(mime, quality))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not load the selected image.'))
    }
    img.src = url
  })
}

// ─── Data-URL inspection (pure) ───────────────────────────────────────────────

export type DocxImageType = 'jpg' | 'png' | 'gif' | 'bmp'

export interface ImageInfo {
  type: DocxImageType
  width: number
  height: number
  /** Raw bytes of the decoded image (for docx ImageRun data). */
  bytes: Uint8Array
}

function base64ToBytes(b64: string): Uint8Array {
  // atob is available in browsers and Node ≥16; fall back to Buffer for older.
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer
  if (B) return new Uint8Array(B.from(b64, 'base64'))
  throw new Error('No base64 decoder available.')
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

/**
 * Decode a base64 image data URL into its format + intrinsic dimensions + bytes.
 * Returns null for anything we can't confidently parse (e.g. SVG, malformed).
 * Supports PNG, JPEG, GIF, BMP — the formats docx's ImageRun accepts.
 */
export function imageInfoFromDataUrl(dataUrl: string | null | undefined): ImageInfo | null {
  if (!dataUrl) return null
  const m = /^data:(image\/[a-zA-Z.+-]+);base64,(.*)$/.exec(dataUrl.trim())
  if (!m) return null
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(m[2])
  } catch {
    return null
  }
  if (bytes.length < 26) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width@16 height@20 (big-endian)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { type: 'png', width: u32be(bytes, 16), height: u32be(bytes, 20), bytes }
  }
  // GIF: "GIF8", width@6 height@8 (little-endian uint16)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { type: 'gif', width: u16le(bytes, 6), height: u16le(bytes, 8), bytes }
  }
  // BMP: "BM", width@18 height@22 (little-endian int32)
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { type: 'bmp', width: u32le(bytes, 18), height: Math.abs(u32le(bytes, 22) | 0), bytes }
  }
  // JPEG: FF D8 ... scan for an SOF marker
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) { o++; continue }
      const marker = bytes[o + 1]
      // SOF0..SOF15 carry the frame size, excluding DHT/JPG/DAC (C4/C8/CC)
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        return { type: 'jpg', height: u16be(bytes, o + 5), width: u16be(bytes, o + 7), bytes }
      }
      const len = u16be(bytes, o + 2)
      if (len < 2) return null
      o += 2 + len
    }
    return null
  }
  return null
}
