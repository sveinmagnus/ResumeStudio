/**
 * @vitest-environment jsdom
 *
 * The canvas downscale path, which nothing reached before: jsdom has no canvas
 * and no image decoder, so `fileToResizedDataUrl` rejected long before the
 * geometry ran. Stubbing `Image` + the two canvas methods lets the arithmetic be
 * asserted directly — and that arithmetic decides what every stored profile
 * photo and company logo actually weighs, which is the one thing standing
 * between a resume and the 5 MB localStorage cap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fileToResizedDataUrl, imageUrlToResizedDataUrl, cropImageToDataUrl,
  applyShapeMaskToDataUrl, fileToImage, revokeImageObjectUrl,
} from '../src/lib/image'

/** What the stubbed decoder will report for the next load. */
let natural = { w: 1200, h: 600 }
/** Whether the stubbed decoder should fail instead of loading. */
let failLoad = false
/** The last canvas the code under test drew into. */
let drawn: { w: number; h: number; mime: string; quality: unknown } | null = null
let getContextReturns: unknown = { drawImage: vi.fn() }
/** Every 2d-context call the code under test made, in order. */
let calls: Array<[string, ...unknown[]]> = []

/** A recording 2d context: enough of the API for the mask + crop paths. */
function recordingCtx() {
  const rec = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]) }
  return {
    drawImage: rec('drawImage'), save: rec('save'), restore: rec('restore'),
    beginPath: rec('beginPath'), closePath: rec('closePath'), clip: rec('clip'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arc: rec('arc'),
    quadraticCurveTo: rec('quadraticCurveTo'),
  }
}
const revoked: string[] = []

class StubImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  crossOrigin: string | null = null
  #src = ''
  get src(): string { return this.#src }
  set src(v: string) {
    this.#src = v
    this.naturalWidth = natural.w
    this.naturalHeight = natural.h
    // The real decoder is async; resolve on a microtask so the promise chain in
    // the module under test is already wired up.
    queueMicrotask(() => (failLoad ? this.onerror?.() : this.onload?.()))
  }
}

beforeEach(() => {
  natural = { w: 1200, h: 600 }
  failLoad = false
  drawn = null
  calls = []
  getContextReturns = recordingCtx()
  revoked.length = 0

  vi.stubGlobal('Image', StubImage)
  URL.createObjectURL = vi.fn(() => 'blob:stub')
  URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u) })
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
    return getContextReturns
  }) as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toDataURL = vi.fn(function (this: HTMLCanvasElement, mime: string, quality: unknown) {
    drawn = { w: this.width, h: this.height, mime, quality }
    return `${mime};stub`
  }) as unknown as HTMLCanvasElement['toDataURL']
})

afterEach(() => { vi.unstubAllGlobals() })

const png = () => new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })

describe('fileToResizedDataUrl — the downscale geometry', () => {
  it('scales the LONGEST edge down to the cap and keeps the aspect ratio', async () => {
    natural = { w: 1200, h: 600 }
    await fileToResizedDataUrl(png(), { maxDim: 600 })
    expect(drawn).toMatchObject({ w: 600, h: 300 })
  })

  it('measures the cap against the taller edge when the image is portrait', async () => {
    natural = { w: 600, h: 1200 }
    await fileToResizedDataUrl(png(), { maxDim: 600 })
    expect(drawn).toMatchObject({ w: 300, h: 600 })
  })

  it('never UPSCALES an image already under the cap', async () => {
    // A 200px logo blown up to 600 is four times the bytes for no more detail.
    natural = { w: 400, h: 200 }
    await fileToResizedDataUrl(png(), { maxDim: 600 })
    expect(drawn).toMatchObject({ w: 400, h: 200 })
  })

  it('keeps a very thin edge at one pixel rather than zero', async () => {
    // A 2000x3 banner scales its height to 0.9 — and a zero-height canvas
    // throws in a real browser.
    natural = { w: 2000, h: 3 }
    await fileToResizedDataUrl(png(), { maxDim: 600 })
    expect(drawn).toMatchObject({ w: 600, h: 1 })
  })

  it('rounds rather than truncating the scaled edge', async () => {
    natural = { w: 1000, h: 333 }
    await fileToResizedDataUrl(png(), { maxDim: 600 })
    // 333 * 0.6 = 199.8 → 200, not 199.
    expect(drawn).toMatchObject({ w: 600, h: 200 })
  })

  it('defaults to a 600px cap', async () => {
    natural = { w: 3000, h: 1500 }
    await fileToResizedDataUrl(png())
    expect(drawn).toMatchObject({ w: 600, h: 300 })
  })
})

describe('fileToResizedDataUrl — the output format', () => {
  it('encodes JPEG at the requested quality by default', async () => {
    await fileToResizedDataUrl(png())
    expect(drawn).toMatchObject({ mime: 'image/jpeg', quality: 0.82 })
  })

  it('encodes PNG when asked, so a logo keeps its transparency', async () => {
    await fileToResizedDataUrl(png(), { format: 'png' })
    expect(drawn?.mime).toBe('image/png')
  })

  it('passes an explicit quality through', async () => {
    await fileToResizedDataUrl(png(), { quality: 0.4 })
    expect(drawn?.quality).toBe(0.4)
  })

  it('returns what the canvas encoded', async () => {
    await expect(fileToResizedDataUrl(png(), { format: 'png' })).resolves.toBe('image/png;stub')
  })
})

describe('fileToResizedDataUrl — the failure paths', () => {
  it('releases the object URL on success and on failure', async () => {
    // The blob stays in memory for the life of the document otherwise, and this
    // runs on every photo the user tries.
    await fileToResizedDataUrl(png())
    expect(revoked).toEqual(['blob:stub'])

    revoked.length = 0
    failLoad = true
    await expect(fileToResizedDataUrl(png())).rejects.toThrow(/Could not load/i)
    expect(revoked).toEqual(['blob:stub'])
  })

  it('rejects with a clear message when there is no 2d context', async () => {
    getContextReturns = null
    await expect(fileToResizedDataUrl(png())).rejects.toThrow(/Canvas not supported/i)
  })

  it('turns a throwing encoder into a rejection rather than a hang', async () => {
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => { throw new Error('tainted canvas') }) as never
    await expect(fileToResizedDataUrl(png())).rejects.toThrow(/tainted canvas/)
  })
})

describe('imageUrlToResizedDataUrl — the same geometry, from a URL', () => {
  it('refuses anything that is not an http(s) link', async () => {
    for (const bad of ['', '   ', 'ftp://x/y.png', 'data:image/png;base64,AAA', 'javascript:alert(1)']) {
      await expect(imageUrlToResizedDataUrl(bad), bad).rejects.toThrow(/http\(s\) link/i)
    }
  })

  it('requires the link to START with the scheme, not merely contain it', async () => {
    // "javascript:void('https://x')" contains the scheme; anchoring is what
    // stops a hostile string being handed to the loader.
    await expect(imageUrlToResizedDataUrl('javascript:void("https://x/y.png")'))
      .rejects.toThrow(/http\(s\) link/i)
  })

  it('accepts plain http as well as https, and tolerates padding', async () => {
    await expect(imageUrlToResizedDataUrl('http://example.test/p.png')).resolves.toContain('image/jpeg')
    await expect(imageUrlToResizedDataUrl('   https://example.test/p.png   ')).resolves.toContain('image/jpeg')
  })

  it('defaults to JPEG and rejects clearly when the canvas is unusable', async () => {
    await imageUrlToResizedDataUrl('https://example.test/p.png')
    expect(drawn?.mime).toBe('image/jpeg')

    getContextReturns = null
    await expect(imageUrlToResizedDataUrl('https://example.test/p.png')).rejects.toThrow(/Canvas not supported/i)
  })

  it('explains a cross-origin failure rather than surfacing the raw error', async () => {
    // A tainted canvas throws a SecurityError with no useful wording; the user
    // needs to be told to download the file instead.
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => { throw new Error('SecurityError') }) as never
    await expect(imageUrlToResizedDataUrl('https://example.test/p.png'))
      .rejects.toThrow(/cross-origin reads/i)
  })

  it('downscales a remote image the same way, without tainting the canvas', async () => {
    natural = { w: 1200, h: 600 }
    await expect(imageUrlToResizedDataUrl('https://example.test/p.png', { maxDim: 300, format: 'png' }))
      .resolves.toBe('image/png;stub')
    expect(drawn).toMatchObject({ w: 300, h: 150 })
  })

  it('rejects when the host does not allow the load', async () => {
    failLoad = true
    await expect(imageUrlToResizedDataUrl('https://example.test/p.png')).rejects.toThrow()
  })
})

describe('cropImageToDataUrl — the square crop the cropper produces', () => {
  const img = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h }) as HTMLImageElement

  it('draws the requested source square into a canvas of the same size', () => {
    cropImageToDataUrl(img(1000, 800), { sx: 100, sy: 50, size: 400 }, { maxDim: 600 })
    expect(drawn).toMatchObject({ w: 400, h: 400, mime: 'image/jpeg' })
    expect(calls).toContainEqual(['drawImage', expect.anything(), 100, 50, 400, 400, 0, 0, 400, 400])
  })

  it('caps the OUTPUT square at maxDim while still reading the full source square', () => {
    // The source rectangle is what the user framed; the output is what gets
    // stored, and only the output should shrink.
    cropImageToDataUrl(img(2000, 2000), { sx: 0, sy: 0, size: 1600 }, { maxDim: 600 })
    expect(drawn).toMatchObject({ w: 600, h: 600 })
    expect(calls).toContainEqual(['drawImage', expect.anything(), 0, 0, 1600, 1600, 0, 0, 600, 600])
  })

  it('never produces a zero-sized canvas', () => {
    cropImageToDataUrl(img(10, 10), { sx: 0, sy: 0, size: 0 }, { maxDim: 600 })
    expect(drawn).toMatchObject({ w: 1, h: 1 })
  })

  it('honours the PNG format for a crop too', () => {
    cropImageToDataUrl(img(100, 100), { sx: 0, sy: 0, size: 50 }, { format: 'png' })
    expect(drawn?.mime).toBe('image/png')
  })

  it('throws rather than returning a blank data URL with no context', () => {
    getContextReturns = null
    expect(() => cropImageToDataUrl(img(100, 100), { sx: 0, sy: 0, size: 50 })).toThrow(/Canvas not supported/i)
  })
})

describe('applyShapeMaskToDataUrl — the mask paths', () => {
  const src = 'data:image/png;base64,AAA'

  it('returns a square image untouched, without decoding it', async () => {
    await expect(applyShapeMaskToDataUrl(src, 'square')).resolves.toBe(src)
    expect(calls).toEqual([])
  })

  it('clips a CIRCLE centred on the image, radius half the shorter edge', async () => {
    natural = { w: 400, h: 200 }
    await applyShapeMaskToDataUrl(src, 'circle')
    expect(calls).toContainEqual(['arc', 200, 100, 100, 0, Math.PI * 2])
    expect(calls.map((c) => c[0])).toContain('clip')
  })

  it('draws the rounded path from the corners it computed', async () => {
    // 100x100 at 18% → radius 18. Every corner is one lineTo plus one curve,
    // and each of those coordinates is a separate piece of arithmetic.
    natural = { w: 100, h: 100 }
    await applyShapeMaskToDataUrl(src, 'rounded')
    expect(calls).toContainEqual(['moveTo', 18, 0])
    expect(calls).toContainEqual(['lineTo', 82, 0])
    expect(calls).toContainEqual(['quadraticCurveTo', 100, 0, 100, 18])
    expect(calls).toContainEqual(['lineTo', 100, 82])
    expect(calls).toContainEqual(['quadraticCurveTo', 100, 100, 82, 100])
    expect(calls).toContainEqual(['lineTo', 18, 100])
    expect(calls).toContainEqual(['quadraticCurveTo', 0, 100, 0, 82])
    expect(calls).toContainEqual(['lineTo', 0, 18])
    expect(calls).toContainEqual(['quadraticCurveTo', 0, 0, 18, 0])
  })

  it('scales the corner radius to the SHORTER edge', async () => {
    natural = { w: 1000, h: 200 }
    await applyShapeMaskToDataUrl(src, 'rounded')
    // 200 * 0.18 = 36.
    expect(calls).toContainEqual(['moveTo', 36, 0])
  })

  it('keeps a radius of at least one pixel on a tiny image', async () => {
    natural = { w: 4, h: 4 }
    await applyShapeMaskToDataUrl(src, 'rounded')
    expect(calls).toContainEqual(['moveTo', 1, 0])
  })

  it('always encodes PNG, so the masked-out corners stay transparent', async () => {
    // JPEG has no alpha and would fill the corners with a matte colour that
    // clashes against any non-white page background.
    natural = { w: 100, h: 100 }
    await expect(applyShapeMaskToDataUrl(src, 'circle')).resolves.toBe('image/png;stub')
    expect(drawn?.mime).toBe('image/png')
  })

  it('rejects when the stored image cannot be decoded', async () => {
    failLoad = true
    await expect(applyShapeMaskToDataUrl(src, 'circle')).rejects.toThrow(/could not decode/i)
  })
})

describe('fileToImage — decoding for the cropper', () => {
  it('resolves with the decoded image and the URL the caller must release', async () => {
    const { image, objectUrl } = await fileToImage(png())
    expect(objectUrl).toBe('blob:stub')
    expect(image.naturalWidth).toBe(1200)
    // Deliberately NOT revoked here: the cropper still needs to draw from it.
    expect(revoked).toEqual([])

    revokeImageObjectUrl(objectUrl)
    expect(revoked).toEqual(['blob:stub'])
  })

  it('releases the URL when the decode fails', async () => {
    failLoad = true
    await expect(fileToImage(png())).rejects.toThrow(/could not load/i)
    expect(revoked).toEqual(['blob:stub'])
  })

  it('refuses a non-raster file before creating a URL at all', async () => {
    const svg = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })
    await expect(fileToImage(svg)).rejects.toThrow(/SVG is not supported/i)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})

describe('applyShapeMaskToDataUrl — the failure arms', () => {
  it('rejects with a clear message when there is no 2d context', async () => {
    getContextReturns = null
    await expect(applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'circle'))
      .rejects.toThrow(/Canvas not supported/i)
  })

  it('turns a throwing encoder into a rejection rather than a hang', async () => {
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => { throw new Error('tainted') }) as never
    await expect(applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'circle')).rejects.toThrow(/tainted/)
  })
})
