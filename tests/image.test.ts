import { describe, it, expect } from 'vitest'
import { imageInfoFromDataUrl } from '../src/lib/image'

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
