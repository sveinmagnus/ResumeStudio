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

/**
 * Accept only raster image files. `image/*` alone would admit `image/svg+xml`,
 * which can carry markup/script; while every upload is canvas-re-encoded to
 * PNG/JPEG (stripping any script) and the render boundary rejects SVG data URLs
 * anyway, refusing SVG here — before it ever touches an <img>/canvas — removes
 * the question entirely (an SVG referencing external resources can also taint
 * the canvas and make toDataURL throw a confusing error). Mirrors the
 * raster-only guard in viewFilter.isDataImage.
 */
function isRasterImageFile(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml'
}

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
    if (!isRasterImageFile(file)) {
      reject(new Error('Please choose a PNG, JPEG, GIF, or WebP image (SVG is not supported).'))
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

// ─── Crop rectangle within a source image (browser only) ─────────────────────

/**
 * A crop window expressed in **source pixels** of an `HTMLImageElement`. The
 * `(sx, sy)` is the top-left corner, `size` is the side length of the square
 * we want to extract. Stored as floats so the cropper UI can express
 * fractional pan/zoom positions without quantising too early.
 */
export interface CropRect {
  sx: number
  sy: number
  size: number
}

/**
 * Clamp a crop rect so it stays entirely inside the image's natural bounds
 * (no off-image bleed). Side length is clamped to the shorter image edge first
 * so we can never request a square larger than the source. Returned values are
 * integers — `drawImage` accepts floats but integer source coords give the
 * sharpest pixel mapping for the common photo case.
 */
export function clampCropRect(img: HTMLImageElement, rect: CropRect): CropRect {
  const maxSide = Math.max(1, Math.min(img.naturalWidth, img.naturalHeight))
  const size = Math.max(1, Math.min(maxSide, Math.round(rect.size)))
  const sx = Math.max(0, Math.min(img.naturalWidth  - size, Math.round(rect.sx)))
  const sy = Math.max(0, Math.min(img.naturalHeight - size, Math.round(rect.sy)))
  return { sx, sy, size }
}

/**
 * Render a square crop of `img` (in source pixels) to a downscaled data URL.
 * Used by the profile-photo cropper to produce the final stored image after
 * the user picks a pan + zoom. Output is a square `outSize × outSize` canvas.
 */
export function cropImageToDataUrl(
  img: HTMLImageElement,
  rect: CropRect,
  opts: ResizeOptions = {},
): string {
  const { maxDim = 600, format = 'jpeg', quality = 0.82 } = opts
  const { sx, sy, size } = clampCropRect(img, rect)
  const outSize = Math.max(1, Math.min(maxDim, size))
  const canvas = document.createElement('canvas')
  canvas.width = outSize
  canvas.height = outSize
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported.')
  ctx.drawImage(img, sx, sy, size, size, 0, 0, outSize, outSize)
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  return canvas.toDataURL(mime, quality)
}

/**
 * Decode an image File into an `HTMLImageElement` ready for the cropper to
 * measure + transform. Rejects on a non-image MIME or a decode failure, the
 * same contract as `fileToResizedDataUrl`. Caller is responsible for revoking
 * the returned object URL when finished (see `revokeImageObjectUrl`).
 */
export function fileToImage(file: File): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolveImg, reject) => {
    if (!isRasterImageFile(file)) {
      reject(new Error('Please choose a PNG, JPEG, GIF, or WebP image (SVG is not supported).'))
      return
    }
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolveImg({ image, objectUrl })
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not load the selected image.'))
    }
    image.src = objectUrl
  })
}

/** Pair with `fileToImage` once the caller no longer needs the source URL. */
export function revokeImageObjectUrl(objectUrl: string | null | undefined): void {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
}

/**
 * Convert an `ImageCropperModal` state (baseScale, zoom, pan-in-CSS-pixels) to
 * a square source-pixel CropRect. PURE — exported here so tests don't have to
 * import the React component to exercise the math.
 *
 *   effective scale (CSS-px per src-px) = baseScale × zoom
 *   crop side (src-px)                  = viewportPx / effectiveScale
 *   viewport centre maps to source pixel:
 *       sourceCx = naturalW/2 − pan.x / effectiveScale
 *       sourceCy = naturalH/2 − pan.y / effectiveScale
 */
export function computeCropRect(
  img: { naturalWidth: number; naturalHeight: number },
  baseScale: number,
  zoom: number,
  pan: { x: number; y: number },
  viewportPx: number,
): CropRect {
  const effective = baseScale * zoom
  const size = viewportPx / effective
  const sourceCx = img.naturalWidth  / 2 - pan.x / effective
  const sourceCy = img.naturalHeight / 2 - pan.y / effective
  return {
    sx: sourceCx - size / 2,
    sy: sourceCy - size / 2,
    size,
  }
}

// ─── Profile-image shape masking (browser only) ───────────────────────────────

import type { ProfileImageShape } from '../types'

/**
 * Apply a shape mask to a square base64 PNG/JPEG data URL, returning a new
 * data URL. The output is always PNG so the rounded / circular alpha is
 * preserved (JPEG has no alpha channel and would fill the masked area with a
 * matte colour, which would clash against any non-white page background).
 *
 * Pass-through for `shape === 'square'` so callers don't have to special-case
 * the common path.
 */
export function applyShapeMaskToDataUrl(dataUrl: string, shape: ProfileImageShape): Promise<string> {
  if (shape === 'square') return Promise.resolve(dataUrl)
  return new Promise((resolveImg, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas not supported.')); return }
        ctx.save()
        if (shape === 'circle') {
          ctx.beginPath()
          ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2)
          ctx.closePath()
        } else {
          // 'rounded' — pick a radius proportional to the shorter edge so the
          // look is consistent regardless of the stored image resolution.
          const r = Math.max(1, Math.round(Math.min(w, h) * 0.18))
          roundedRectPath(ctx, 0, 0, w, h, r)
        }
        ctx.clip()
        ctx.drawImage(img, 0, 0, w, h)
        ctx.restore()
        // PNG so the masked-out alpha survives (DOCX embeds the bytes as-is).
        resolveImg(canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    img.onerror = () => reject(new Error('Could not decode the stored image for masking.'))
    img.src = dataUrl
  })
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
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
