// @vitest-environment jsdom
//
// jsdom gives us `document` and a DOM to hang a stub canvas off; it implements
// no canvas and no image decoding itself, which is exactly why these paths were
// never entered. tests/image.test.ts stays in the node env for the pure
// byte-parsing half.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyShapeMaskToDataUrl, imageUrlToResizedDataUrl } from '../src/lib/image'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/**
 * The canvas paths — 97 unreached mutants, because jsdom implements no canvas
 * and no image decoding, so nothing in the suite ever entered them.
 *
 * A recording stub is enough: every one of these functions is a fixed sequence
 * of context calls, and what matters is the GEOMETRY it asks for. A shape mask
 * that clips the wrong path silently crops someone's face; a downscale that
 * picks the wrong dimension distorts the photo in every export.
 */
describe('image — the canvas paths', () => {
  interface Call { op: string; args: number[] }
  let calls: Call[]
  let lastCanvas: { width: number; height: number } | null

  /** Record every context call, and hand back a recognisable data URL. */
  function installCanvas(): void {
    calls = []
    lastCanvas = null
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => (...args: unknown[]) => {
        calls.push({ op: prop, args: args.filter((a) => typeof a === 'number') as number[] })
      },
    })
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return realCreateElement.call(document, tag)
      const canvas = {
        width: 0, height: 0,
        getContext: () => ctx,
        toDataURL: (type?: string) => `data:${type ?? 'image/png'};base64,STUBBED`,
      }
      lastCanvas = canvas as unknown as { width: number; height: number }
      return canvas as unknown as HTMLElement
    }) as typeof document.createElement)
  }
  const realCreateElement = document.createElement

  /** An Image whose load fires with the given intrinsic size. */
  function installImage(w: number, h: number, fail = false): void {
    class FakeImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = w
      naturalHeight = h
      width = w
      height = h
      set src(_v: string) {
        setTimeout(() => (fail ? this.onerror?.() : this.onload?.()), 0)
      }
    }
    vi.stubGlobal('Image', FakeImage)
  }

  const opsOf = () => calls.map((c) => c.op)
  const args = (op: string) => calls.find((c) => c.op === op)?.args ?? []

  describe('applyShapeMaskToDataUrl', () => {
    it('returns the SAME url for square, without touching the canvas', async () => {
      installCanvas()
      installImage(100, 100)
      expect(await applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'square'))
        .toBe('data:image/png;base64,AAA')
      expect(calls).toEqual([])
    })

    it('clips a circle centred on the image, radius from the SHORTER edge', async () => {
      // Using the longer edge would push the circle outside the canvas and cut
      // the subject off.
      installCanvas()
      installImage(200, 100)
      await applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'circle')
      expect(opsOf()).toContain('arc')
      expect(args('arc').slice(0, 3)).toEqual([100, 50, 50])
    })

    it('clips a rounded rect whose radius scales with the shorter edge', async () => {
      installCanvas()
      installImage(400, 200)
      await applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'rounded')
      // 18% of 200, and no arc — this is the quadratic-curve path.
      expect(opsOf()).not.toContain('arc')
      expect(opsOf().filter((o) => o === 'quadraticCurveTo')).toHaveLength(4)
      expect(args('moveTo')).toEqual([36, 0])
    })

    it('saves, clips, draws and restores — in that order', async () => {
      // Drawing before the clip would ignore the mask entirely; not restoring
      // leaks the clip into whatever the caller draws next.
      installCanvas()
      installImage(100, 100)
      await applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'circle')
      const ops = opsOf()
      expect(ops.indexOf('save')).toBeLessThan(ops.indexOf('clip'))
      expect(ops.indexOf('clip')).toBeLessThan(ops.indexOf('drawImage'))
      expect(ops.indexOf('drawImage')).toBeLessThan(ops.indexOf('restore'))
    })

    it('sizes the canvas to the image, and emits PNG so the alpha survives', async () => {
      // A masked JPEG would fill the transparent corners with black.
      installCanvas()
      installImage(320, 240)
      const out = await applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'circle')
      expect(lastCanvas).toMatchObject({ width: 320, height: 240 })
      expect(out).toContain('image/png')
    })

    it('rejects when the stored image cannot be decoded', async () => {
      installCanvas()
      installImage(100, 100, true)
      await expect(applyShapeMaskToDataUrl('data:image/png;base64,BAD', 'circle'))
        .rejects.toThrow(/decode/i)
    })
  })

  describe('the rounded-rect path geometry', () => {
    it('clamps the radius to half the shorter edge on a tiny image', async () => {
      // Without the clamp the corner curves overlap and the path self-crosses.
      installCanvas()
      installImage(10, 10)
      await applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'rounded')
      // 18% of 10 rounds to 2, which is below half (5), so 2 stands.
      expect(args('moveTo')).toEqual([2, 0])
    })

    it('keeps a minimum radius of 1 on a very small image', async () => {
      // 18% of 2px rounds to ZERO, and a zero radius makes the path a plain
      // rectangle — the floor is what keeps the corners rounded at any size.
      installCanvas()
      installImage(2, 2)
      await applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'rounded')
      expect(args('moveTo')).toEqual([1, 0])
    })

    it('closes the path so the clip is a region, not an outline', async () => {
      installCanvas()
      installImage(100, 100)
      await applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'rounded')
      expect(opsOf()).toContain('closePath')
      expect(opsOf().indexOf('beginPath')).toBeLessThan(opsOf().indexOf('closePath'))
    })

    it('closes the CIRCLE path too', async () => {
      // Its own closePath, separate from the rounded-rect one.
      installCanvas()
      installImage(100, 100)
      await applyShapeMaskToDataUrl('data:image/png;base64,AAA', 'circle')
      const ops = opsOf()
      expect(ops.indexOf('arc')).toBeLessThan(ops.indexOf('closePath'))
      expect(ops.indexOf('closePath')).toBeLessThan(ops.indexOf('clip'))
    })
  })

  describe('imageUrlToResizedDataUrl', () => {
    it('scales a wide image down by its WIDTH', async () => {
      installCanvas()
      installImage(2000, 1000)
      await imageUrlToResizedDataUrl('https://example.test/x.png', { maxDim: 500 })
      expect(lastCanvas).toMatchObject({ width: 500, height: 250 })
    })

    it('scales a tall image down by its HEIGHT', async () => {
      installCanvas()
      installImage(1000, 2000)
      await imageUrlToResizedDataUrl('https://example.test/x.png', { maxDim: 500 })
      expect(lastCanvas).toMatchObject({ width: 250, height: 500 })
    })

    it('never enlarges an image that already fits', async () => {
      installCanvas()
      installImage(100, 80)
      await imageUrlToResizedDataUrl('https://example.test/x.png', { maxDim: 500 })
      expect(lastCanvas).toMatchObject({ width: 100, height: 80 })
    })

    it('draws the whole image into the resized canvas', async () => {
      installCanvas()
      installImage(2000, 1000)
      await imageUrlToResizedDataUrl('https://example.test/x.png', { maxDim: 500 })
      expect(opsOf()).toContain('drawImage')
      expect(args('drawImage')).toEqual([0, 0, 500, 250])
    })
  })
})
