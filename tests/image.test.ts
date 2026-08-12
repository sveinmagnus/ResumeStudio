import { describe, it, expect, vi } from 'vitest'
import { imageInfoFromDataUrl, clampCropRect, computeCropRect, fileToResizedDataUrl, fileToImage, imageUrlToResizedDataUrl, applyShapeMaskToDataUrl, revokeImageObjectUrl } from '../src/lib/image'

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

  it('accepts the raster types and refuses everything else, by MIME prefix', async () => {
    // The guard runs before any decode. A raster type gets PAST it and then
    // fails on the DOM this suite doesn't have, which is a different error —
    // that difference is what distinguishes "allowed" from "rejected" here.
    const rejection = async (type: string) => {
      try {
        await fileToResizedDataUrl(new File(['x'], 'f', { type }))
        return null
      } catch (e) {
        return (e as Error).message
      }
    }
    const guarded = /SVG is not supported|PNG, JPEG/i

    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(await rejection(type), type).not.toMatch(guarded)
    }
    // 'x-image/png' contains "image/" but does not START with it — a substring
    // test would let it through to the decoder.
    for (const type of ['image/svg+xml', 'application/pdf', 'text/plain', '', 'x-image/png']) {
      expect(await rejection(type), type || '(empty)').toMatch(guarded)
    }
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

describe('imageUrlToResizedDataUrl()', () => {
  it('rejects a non-http(s) URL before touching the network/canvas', async () => {
    await expect(imageUrlToResizedDataUrl('not-a-url')).rejects.toThrow(/http\(s\) link/i)
    await expect(imageUrlToResizedDataUrl('data:image/png;base64,AAAA')).rejects.toThrow(/http\(s\) link/i)
    await expect(imageUrlToResizedDataUrl('javascript:alert(1)')).rejects.toThrow(/http\(s\) link/i)
    await expect(imageUrlToResizedDataUrl('')).rejects.toThrow(/http\(s\) link/i)
  })
})

describe('applyShapeMaskToDataUrl()', () => {
  it("short-circuits 'square' without touching the canvas", async () => {
    // The pass-through is why callers don't special-case the common shape — and
    // it must be byte-identical, not a re-encode: re-encoding a stored JPEG on
    // every export would degrade the image a little each time.
    const url = dataUrl('image/png', pad([0x89, 0x50, 0x4e, 0x47], 26))
    await expect(applyShapeMaskToDataUrl(url, 'square')).resolves.toBe(url)
  })
})

describe('revokeImageObjectUrl()', () => {
  it('revokes a real object URL', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: revoke })
    revokeImageObjectUrl('blob:http://localhost/abc')
    expect(revoke).toHaveBeenCalledWith('blob:http://localhost/abc')
    vi.unstubAllGlobals()
  })

  it('is a no-op for a nullish url', () => {
    // fileToImage's caller revokes in a finally, which runs whether or not the
    // url was ever created — passing null there must not throw.
    const revoke = vi.fn()
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: revoke })
    expect(() => { revokeImageObjectUrl(null); revokeImageObjectUrl(undefined); revokeImageObjectUrl('') }).not.toThrow()
    expect(revoke).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

/**
 * The JPEG marker walk and the parser's edges.
 *
 * 48 mutants survived here. The existing cases all put the SOF marker
 * immediately after SOI, which never exercises the segment-skipping loop — and
 * that loop is the part that decides whether a real photo (which always has
 * JFIF/EXIF segments first) is measured or silently rejected. A rejected header
 * image is one that never appears in the export.
 */
describe('imageInfoFromDataUrl() — the JPEG scan and the edges', () => {
  /**
   * SOI, then the given segments, then a SOF0 carrying 64x128, then a little
   * trailing data — the scan loop needs a byte beyond the frame header, which
   * every real JPEG has (the entropy-coded image follows it).
   */
  const jpeg = (segments: number[]): number[] => pad([
    0xff, 0xd8,
    ...segments,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x80,
    0, 0, 0, 0,
  ], 40)

  it('walks PAST earlier segments to find the frame header', () => {
    // A JFIF APP0 (16 bytes) comes before SOF in every camera/editor JPEG.
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)]
    const info = imageInfoFromDataUrl(dataUrl('image/jpeg', jpeg(app0)))
    expect(info).not.toBeNull()
    expect(info!.width).toBe(128)
    expect(info!.height).toBe(64)
  })

  it('skips several segments, using each one’s own declared length', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)]
    const com = [0xff, 0xfe, 0x00, 0x06, ...Array(4).fill(0x41)]
    const info = imageInfoFromDataUrl(dataUrl('image/jpeg', jpeg([...app0, ...com])))
    expect(info!.width).toBe(128)
  })

  it('skips a segment’s PAYLOAD rather than scanning through it', () => {
    // Real EXIF payloads contain arbitrary bytes, including pairs that look
    // exactly like a frame header. Advancing by the DECLARED length steps over
    // them; advancing by anything less lands inside the payload, and the next
    // 0xFF it finds there is read as the image's own dimensions.
    //
    // The two bytes at the tail of this APP0 payload are that trap: they sit
    // precisely where a skip that forgets to count the 2-byte marker lands.
    const app0 = [
      0xff, 0xe0, 0x00, 0x10,       // APP0, declared length 16
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 12 bytes of payload…
      0xff, 0xc0,                   // …then a decoy that looks like SOF0
    ]
    const info = imageInfoFromDataUrl(dataUrl('image/jpeg', jpeg(app0)))
    expect(info).not.toBeNull()
    expect(info!.width).toBe(128)
    expect(info!.height).toBe(64)
  })

  it('reads a progressive JPEG’s SOF2 as well as a baseline SOF0', () => {
    const bytes = pad([
      0xff, 0xd8, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x80,
    ], 26)
    expect(imageInfoFromDataUrl(dataUrl('image/jpeg', bytes))!.width).toBe(128)
  })

  it('does NOT mistake DHT/JPG/DAC for a frame header', () => {
    // C4, C8 and CC sit inside the C0..CF range but carry no dimensions —
    // reading them as SOF yields whatever bytes follow, as confident nonsense.
    for (const marker of [0xc4, 0xc8, 0xcc]) {
      const seg = [0xff, marker, 0x00, 0x06, 0x11, 0x22, 0x33, 0x44]
      const info = imageInfoFromDataUrl(dataUrl('image/jpeg', jpeg(seg)))
      expect(info, `marker ${marker.toString(16)}`).not.toBeNull()
      // Still the real SOF0 further along, not the decoy.
      expect(info!.width, `marker ${marker.toString(16)}`).toBe(128)
    }
  })

  it('steps over 0xFF fill bytes between segments', () => {
    const info = imageInfoFromDataUrl(dataUrl('image/jpeg', jpeg([0x00, 0x00])))
    expect(info!.width).toBe(128)
  })

  it('gives up rather than looping on a segment claiming an impossible length', () => {
    // len < 2 cannot be advanced past; without the guard the scan never
    // terminates on a corrupt file.
    const bytes = pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0, 0, 0, 0, 0, 0], 26)
    expect(imageInfoFromDataUrl(dataUrl('image/jpeg', bytes))).toBeNull()
  })

  it('is null for a JPEG with no frame header at all', () => {
    const bytes = pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)], 40)
    expect(imageInfoFromDataUrl(dataUrl('image/jpeg', bytes))).toBeNull()
  })

  it('reads a bottom-up BMP’s negative height as a positive one', () => {
    // A negative height means rows are stored bottom-up; it is still that many
    // rows, and a negative would scale the image inside out in the export.
    const bytes = pad([
      0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x28, 0, 0, 0,
      0x40, 0x00, 0x00, 0x00,             // width = 64
      0xd0, 0xff, 0xff, 0xff,             // height = -48
    ], 26)
    const info = imageInfoFromDataUrl(dataUrl('image/bmp', bytes))
    expect(info!.height).toBe(48)
    expect(info!.width).toBe(64)
  })

  it('rejects a payload too short to hold any header', () => {
    expect(imageInfoFromDataUrl(dataUrl('image/png', [0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })

  it('rejects a data URL whose base64 will not decode', () => {
    expect(imageInfoFromDataUrl('data:image/png;base64,!!!not base64!!!')).toBeNull()
  })

  it('rejects a data URL that is not base64-encoded', () => {
    expect(imageInfoFromDataUrl('data:image/png,rawbytes')).toBeNull()
  })

  it('tolerates surrounding whitespace', () => {
    const url = dataUrl('image/png', pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 26))
    expect(imageInfoFromDataUrl(`  ${url}\n`)).not.toBeNull()
  })
})

/**
 * `imageInfoFromDataUrl` reads the intrinsic size out of the file's own header,
 * per format, because both exporters need it to fit a photo into its box without
 * decoding the image. A wrong offset or endianness reads a plausible-looking
 * number, so each format is checked against a header built byte by byte.
 */
describe('imageInfoFromDataUrl — the four headers it can read', () => {
  const toDataUrl = (mime: string, bytes: number[]): string => {
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return `data:${mime};base64,${btoa(binary)}`
  }
  const pad = (bytes: number[], length = 40): number[] =>
    [...bytes, ...new Array(Math.max(0, length - bytes.length)).fill(0)]
  const be32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
  const le32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
  const le16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff]
  const be16 = (v: number) => [(v >>> 8) & 0xff, v & 0xff]

  const png = (w: number, h: number) => toDataUrl('image/png', pad([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), 0x49, 0x48, 0x44, 0x52,
    ...be32(w), ...be32(h),
  ]))
  const gif = (w: number, h: number) => toDataUrl('image/gif', pad([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(w), ...le16(h),
  ]))
  const bmp = (w: number, h: number) => toDataUrl('image/bmp', pad([
    0x42, 0x4d, ...new Array(16).fill(0), ...le32(w), ...le32(h),
  ], 40))
  const jpg = (w: number, h: number, marker = 0xc0) => toDataUrl('image/jpeg', pad([
    0xff, 0xd8, 0xff, marker, 0x00, 0x11, 0x08, ...be16(h), ...be16(w),
  ]))

  it('reads a PNG\u2019s size from its IHDR, big-endian', () => {
    expect(imageInfoFromDataUrl(png(300, 200)))
      .toMatchObject({ type: 'png', width: 300, height: 200 })
    // Four-byte fields: a two-byte read would see 0 for anything above 65535.
    expect(imageInfoFromDataUrl(png(70000, 1))?.width).toBe(70000)
  })

  it('reads a GIF\u2019s size, little-endian and only two bytes wide', () => {
    expect(imageInfoFromDataUrl(gif(300, 200)))
      .toMatchObject({ type: 'gif', width: 300, height: 200 })
  })

  it('reads a BMP\u2019s size, little-endian', () => {
    expect(imageInfoFromDataUrl(bmp(300, 200)))
      .toMatchObject({ type: 'bmp', width: 300, height: 200 })
  })

  it('takes a BMP\u2019s bottom-up (negative) height as its magnitude', () => {
    // A negative height means the rows are stored bottom-up; the SIZE is the
    // absolute value, and a raw negative would scale the image to nothing.
    expect(imageInfoFromDataUrl(bmp(300, -200 >>> 0))?.height).toBe(200)
  })

  it('reads a JPEG\u2019s size from the frame header, height BEFORE width', () => {
    // JPEG is the one format that puts height first; swapping them rotates
    // every exported photo.
    expect(imageInfoFromDataUrl(jpg(300, 200)))
      .toMatchObject({ type: 'jpg', width: 300, height: 200 })
  })

  it('accepts any of the SOF markers that carry a frame size', () => {
    for (const marker of [0xc0, 0xc1, 0xc2, 0xc9, 0xcf]) {
      expect(imageInfoFromDataUrl(jpg(300, 200, marker)), String(marker))
        .toMatchObject({ width: 300, height: 200 })
    }
  })

  it('skips the JPEG markers that carry no frame size', () => {
    // C4 (DHT), C8 (JPG) and CC (DAC) look like SOF markers but are not; using
    // one reads two bytes of a Huffman table as the image size.
    for (const marker of [0xc4, 0xc8, 0xcc]) {
      expect(imageInfoFromDataUrl(jpg(300, 200, marker)), String(marker)).toBeNull()
    }
  })

  it('finds a frame header that is not the first marker', () => {
    const withPreamble = toDataUrl('image/jpeg', pad([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0x20), // APP0
      0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(200), ...be16(300),
    ], 48))
    expect(imageInfoFromDataUrl(withPreamble)).toMatchObject({ width: 300, height: 200 })
  })

  it('refuses anything that is not a data URL for an image', () => {
    expect(imageInfoFromDataUrl(null)).toBeNull()
    expect(imageInfoFromDataUrl(undefined)).toBeNull()
    expect(imageInfoFromDataUrl('')).toBeNull()
    expect(imageInfoFromDataUrl('https://example.com/photo.png')).toBeNull()
    expect(imageInfoFromDataUrl('data:text/plain;base64,aGk=')).toBeNull()
  })

  it('refuses a payload too short to hold a header, and one that is not base64', () => {
    expect(imageInfoFromDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull()
    expect(imageInfoFromDataUrl('data:image/png;base64,!!!not base64!!!')).toBeNull()
  })

  it('refuses a payload whose bytes match no known signature', () => {
    expect(imageInfoFromDataUrl(toDataUrl('image/webp', pad([0x52, 0x49, 0x46, 0x46])))).toBeNull()
  })

  it('tolerates whitespace around the data URL', () => {
    expect(imageInfoFromDataUrl(`  ${png(10, 20)}  `)).toMatchObject({ width: 10, height: 20 })
  })

  it('carries the decoded bytes through, so the caller need not decode again', () => {
    const info = imageInfoFromDataUrl(png(10, 20))!
    expect(info.bytes[0]).toBe(0x89)
    expect(info.bytes.length).toBeGreaterThan(26)
  })
})

/**
 * Near-miss headers.
 *
 * Each signature is several bytes, and every byte carries its weight: a payload
 * that matches all but one of them is not that format, and reading it as one
 * takes the "size" from whatever those offsets happen to hold. A spoofed or
 * truncated header must come back as "not an image" instead.
 */
describe('imageInfoFromDataUrl — a header that nearly matches is not a match', () => {
  const toDataUrl = (mime: string, bytes: number[]): string => {
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return `data:${mime};base64,${btoa(binary)}`
  }
  const padded = (bytes: number[], length = 48): number[] =>
    [...bytes, ...new Array(Math.max(0, length - bytes.length)).fill(0)]

  const SIGNATURES: Array<[string, number[]]> = [
    ['png', [0x89, 0x50, 0x4e, 0x47]],
    ['gif', [0x47, 0x49, 0x46, 0x38]],
    ['bmp', [0x42, 0x4d]],
    ['jpeg', [0xff, 0xd8]],
  ]

  for (const [name, signature] of SIGNATURES) {
    it(`refuses a ${name} header with any ONE byte wrong`, () => {
      for (let i = 0; i < signature.length; i++) {
        const broken = [...signature]
        // 0x01 matches no format's byte at any position.
        broken[i] = 0x01
        expect(imageInfoFromDataUrl(toDataUrl(`image/${name}`, padded(broken))), `${name} byte ${i}`)
          .toBeNull()
      }
    })
  }

  it('reads a JPEG frame header only when a marker actually introduces it', () => {
    // 0xff is the marker prefix; a byte pair that is not preceded by one is
    // payload, and treating it as a marker reads image data as a size.
    const notAMarker = padded([0xff, 0xd8, 0x00, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x2c])
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', notAMarker))).toBeNull()
  })

  it('skips a segment by its declared length to reach the frame header', () => {
    const be16 = (v: number) => [(v >>> 8) & 0xff, v & 0xff]
    const jpeg = padded([
      0xff, 0xd8,
      0xff, 0xe1, ...be16(6), 0, 0, 0, 0, // a 6-byte segment (4 bytes of payload)
      0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(200), ...be16(300),
    ], 48)
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', jpeg)))
      .toMatchObject({ type: 'jpg', width: 300, height: 200 })
  })

  it('gives up on a segment whose declared length cannot be right', () => {
    // A length below 2 would leave the scan on the spot forever; the file is
    // corrupt, so there is nothing to read.
    const jpeg = padded([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', jpeg))).toBeNull()
  })

  it('needs the frame header to be followed by data, as a real JPEG always is', () => {
    // The scan asks for one byte beyond the size fields. A file that ends the
    // instant the frame header does carries no image at all, and the guard is
    // what stops the walk reading past the buffer.
    const be16 = (v: number) => [(v >>> 8) & 0xff, v & 0xff]
    const header = [0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(200), ...be16(300)]
    const flush = [...padded([0xff, 0xd8], 28), ...header]
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', flush))).toBeNull()
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', [...flush, 0x00])))
      .toMatchObject({ width: 300, height: 200 })
  })

  it('returns null for a JPEG that carries no frame header at all', () => {
    const jpeg = padded([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0, 0], 48)
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', jpeg))).toBeNull()
  })
})

describe('imageInfoFromDataUrl — the scan is only for real JPEGs', () => {
  const toDataUrl = (mime: string, bytes: number[]): string => {
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return `data:${mime};base64,${btoa(binary)}`
  }
  const padded = (bytes: number[], length = 48): number[] =>
    [...bytes, ...new Array(Math.max(0, length - bytes.length)).fill(0)]
  const be16 = (v: number) => [(v >>> 8) & 0xff, v & 0xff]
  const SOF = [0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(200), ...be16(300)]

  it('does not scan an unknown format for JPEG markers', () => {
    // A WEBP (or anything else) can contain the same byte pair by chance; the
    // signature is what says the scan means something.
    const webpWithSof = padded([0x52, 0x49, 0x46, 0x46, ...new Array(10).fill(0), ...SOF])
    expect(imageInfoFromDataUrl(toDataUrl('image/webp', webpWithSof))).toBeNull()
  })

  it('needs BOTH bytes of the JPEG signature before it will scan', () => {
    // Each half on its own is not a JPEG. With a real frame header further in,
    // accepting either byte alone would parse a size out of a foreign file.
    const halfOne = padded([0xff, 0x00, ...SOF, 0x00])
    const halfTwo = padded([0x00, 0xd8, ...SOF, 0x00])
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', halfOne))).toBeNull()
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', halfTwo))).toBeNull()
  })

  it('refuses a marker below the SOF range, however SOF-shaped the bytes are', () => {
    // 0xa0 is not a frame header; reading it as one takes two bytes of some
    // other segment as the image size.
    const jpeg = padded([0xff, 0xd8, 0xff, 0xa0, 0x00, 0x11, 0x08, ...be16(200), ...be16(300)])
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', jpeg))).toBeNull()
  })

  it('accepts an empty segment (length exactly 2) and keeps scanning past it', () => {
    // 2 is the smallest legal length — the two length bytes themselves. Calling
    // that corrupt would abandon a perfectly good file.
    const jpeg = padded([0xff, 0xd8, 0xff, 0xe1, ...be16(2), ...SOF, 0x00])
    expect(imageInfoFromDataUrl(toDataUrl('image/jpeg', jpeg)))
      .toMatchObject({ width: 300, height: 200 })
  })

  it('refuses a data URL with anything before the scheme', () => {
    const png = padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const url = toDataUrl('image/png', png)
    expect(imageInfoFromDataUrl(url)).not.toBeNull()
    expect(imageInfoFromDataUrl(`javascript:alert(1)//${url}`)).toBeNull()
  })
})
