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
import { fileToResizedDataUrl, imageUrlToResizedDataUrl } from '../src/lib/image'

/** What the stubbed decoder will report for the next load. */
let natural = { w: 1200, h: 600 }
/** Whether the stubbed decoder should fail instead of loading. */
let failLoad = false
/** The last canvas the code under test drew into. */
let drawn: { w: number; h: number; mime: string; quality: unknown } | null = null
let getContextReturns: unknown = { drawImage: vi.fn() }
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
  getContextReturns = { drawImage: vi.fn() }
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
