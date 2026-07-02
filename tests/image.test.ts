import { describe, it, expect } from 'vitest'
import { imageInfoFromDataUrl, clampCropRect, computeCropRect, fileToResizedDataUrl, fileToImage } from '../src/lib/image'

// Build a base64 data URL from raw bytes (Buffer is available in the node test env).
function dataUrl(mime: string, bytes: number[]): string {
  const b64 = Buffer.from(Uint8Array.from(bytes)).toString('base64')
  return `data:${mime};base64,${b64}`
}

// Pad an array out to at least `n` bytes with zeros.
function pad(bytes: number[], n: number): number[] {
  const out = bytes.slice()
  while (out.length < n) out.push(0)
  return out
}

describe('imageInfoFromDataUrl()', () => {
  it('parses PNG width/height from the IHDR chunk (big-endian)', () => {
    // signature + IHDR length/type + width@16 (0x0140=320) + height@20 (0x00F0=240)
    const bytes = pad([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + "IHDR"
      0x00, 0x00, 0x01, 0x40, // width = 320
      0x00, 0x00, 0x00, 0xf0, // height = 240
    ], 26)
    const info = imageInfoFromDataUrl(dataUrl('image/png', bytes))
    expect(info).not.toBeNull()
    expect(info!.type).toBe('png')
    expect(info!.width).toBe(320)
    expect(info!.height).toBe(240)
  })

  it('parses GIF width/height (little-endian uint16)', () => {
    const bytes = pad([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
      0x10, 0x00, // width = 16
      0x20, 0x00, // height = 32
    ], 26)
    const info = imageInfoFromDataUrl(dataUrl('image/gif', bytes))
    expect(info!.type).toBe('gif')
    expect(info!.width).toBe(16)
    expect(info!.height).toBe(32)
  })

  it('parses BMP width/height (little-endian int32)', () => {
    const bytes = pad([
      0x42, 0x4d, // "BM"
      0, 0, 0, 0, // file size
      0, 0, 0, 0, // reserved
      0, 0, 0, 0, // pixel offset
      0x28, 0, 0, 0, // DIB header size (40)
      0x40, 0x00, 0x00, 0x00, // width = 64 @18
      0x30, 0x00, 0x00, 0x00, // height = 48 @22
    ], 26)
    const info = imageInfoFromDataUrl(dataUrl('image/bmp', bytes))
    expect(info!.type).toBe('bmp')
    expect(info!.width).toBe(64)
    expect(info!.height).toBe(48)
  })

  it('parses JPEG dimensions from the SOF0 marker (big-endian)', () => {
    const bytes = pad([
      0xff, 0xd8,             // SOI
      0xff, 0xc0,             // SOF0 marker
      0x00, 0x11,             // segment length
      0x08,                   // precision
      0x00, 0x40,             // height = 64
      0x00, 0x80,             // width = 128
    ], 26)
    const info = imageInfoFromDataUrl(dataUrl('image/jpeg', bytes))
    expect(info!.type).toBe('jpg')
    expect(info!.width).toBe(128)
    expect(info!.height).toBe(64)
  })

  it('returns the decoded bytes for docx embedding', () => {
    const bytes = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 26)
    const info = imageInfoFromDataUrl(dataUrl('image/png', bytes))
    expect(info!.bytes).toBeInstanceOf(Uint8Array)
    expect(info!.bytes[0]).toBe(0x89)
  })

  it('returns null for null / empty / non-data-URL input', () => {
    expect(imageInfoFromDataUrl(null)).toBeNull()
    expect(imageInfoFromDataUrl(undefined)).toBeNull()
    expect(imageInfoFromDataUrl('')).toBeNull()
    expect(imageInfoFromDataUrl('https://example.com/x.png')).toBeNull()
  })

  it('returns null for SVG (unsupported by docx ImageRun here)', () => {
    const svg = dataUrl('image/svg+xml', pad([0x3c, 0x73, 0x76, 0x67], 26))
    expect(imageInfoFromDataUrl(svg)).toBeNull()
  })

  it('returns null for an unrecognised / truncated payload', () => {
    expect(imageInfoFromDataUrl(dataUrl('image/png', [1, 2, 3]))).toBeNull()
    expect(imageInfoFromDataUrl(dataUrl('image/png', pad([0xde, 0xad, 0xbe, 0xef], 26)))).toBeNull()
  })
})

// ─── Crop geometry (pure) ────────────────────────────────────────────────────
// The ImageCropperModal lets the user pan + zoom an image into a square frame.
// The math that turns its (baseScale, zoom, pan-px) state into a source-pixel
// crop rect lives in lib/image so it can be tested without rendering React or
// touching the DOM. These cases pin the contract and the clamp behaviour that
// keeps a malformed UI state from producing an off-image draw.

// Tiny stand-in for HTMLImageElement (only the bits clampCropRect / computeCropRect read).
const img = (w: number, h: number) =>
  ({ naturalWidth: w, naturalHeight: h } as HTMLImageElement)

describe('upload guard rejects non-raster files (before any decode)', () => {
  // Both entry points bail on the MIME check before touching URL.createObjectURL
  // or an <img>, so this exercises the guard without a DOM.
  it('rejects an SVG upload with a helpful message', async () => {
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    await expect(fileToResizedDataUrl(svg)).rejects.toThrow(/SVG is not supported/i)
    await expect(fileToImage(svg)).rejects.toThrow(/SVG is not supported/i)
  })

  it('rejects a non-image file', async () => {
    const pdf = new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' })
    await expect(fileToResizedDataUrl(pdf)).rejects.toThrow(/PNG, JPEG/i)
  })
})

describe('clampCropRect()', () => {
  it('caps the side at the shorter image edge', () => {
    expect(clampCropRect(img(400, 300), { sx: 0, sy: 0, size: 9999 })).toEqual({ sx: 0, sy: 0, size: 300 })
  })
  it('clamps the top-left so the crop stays inside the image', () => {
    expect(clampCropRect(img(400, 300), { sx: 350, sy: -50, size: 100 }))
      .toEqual({ sx: 300, sy: 0, size: 100 })
  })
  it('floors a fractional size and offsets to integers (sharp pixel mapping)', () => {
    const r = clampCropRect(img(400, 300), { sx: 12.7, sy: 8.3, size: 99.6 })
    expect(Number.isInteger(r.sx)).toBe(true)
    expect(Number.isInteger(r.sy)).toBe(true)
    expect(Number.isInteger(r.size)).toBe(true)
  })
  it('never returns a size below 1 (so the canvas is always drawable)', () => {
    expect(clampCropRect(img(400, 300), { sx: 0, sy: 0, size: 0 }).size).toBeGreaterThanOrEqual(1)
  })
})

describe('computeCropRect()', () => {
  it('extracts the centered shorter-edge square at zoom 1, pan 0', () => {
    // 400×300 image, viewport 100 ⇒ baseScale = max(100/400, 100/300) = 1/3.
    // At zoom 1 the source side that fills the viewport = 100/(1/3) = 300.
    // Centred on (200, 150) so sx=50, sy=0.
    const r = computeCropRect(img(400, 300), 1 / 3, 1, { x: 0, y: 0 }, 100)
    expect(Math.round(r.sx)).toBe(50)
    expect(Math.round(r.sy)).toBe(0)
    expect(Math.round(r.size)).toBe(300)
  })
  it('shrinks the source rect as the user zooms in (smaller window = enlarged output)', () => {
    const at1 = computeCropRect(img(400, 300), 1 / 3, 1, { x: 0, y: 0 }, 100)
    const at2 = computeCropRect(img(400, 300), 1 / 3, 2, { x: 0, y: 0 }, 100)
    expect(at2.size).toBeLessThan(at1.size)
    expect(Math.round(at2.size)).toBe(150)
  })
  it('shifts the source rect opposite to the pan direction', () => {
    // Dragging the image right (pan.x > 0) should reveal the LEFT side of the
    // source, i.e. push sourceCx leftward. We pin the sign here.
    const r = computeCropRect(img(400, 300), 1 / 3, 1, { x: 30, y: 0 }, 100)
    expect(r.sx).toBeLessThan(50) // less than the centred value
  })
})
