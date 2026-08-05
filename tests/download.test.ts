/**
 * @vitest-environment jsdom
 *
 * Every export in the app ends here. jsdom has no createObjectURL, so the two
 * URL functions are stubbed — which is also how the anchor's href and the
 * revoke timing are observed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { downloadBlob, downloadText } from '../src/lib/download'

let created: Blob[] = []
let revoked: string[] = []
let clicked: HTMLAnchorElement[] = []

beforeEach(() => {
  created = []
  revoked = []
  clicked = []
  vi.useFakeTimers()
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    configurable: true,
    value: (b: Blob) => { created.push(b); return `blob:${created.length}` },
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    configurable: true,
    value: (u: string) => { revoked.push(u) },
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this)
  })
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('downloadBlob()', () => {
  it('clicks an anchor carrying the object URL and the filename', () => {
    downloadBlob(new Blob(['x']), 'Consultant_CV.pdf')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('Consultant_CV.pdf')
    expect(clicked[0].href).toContain('blob:')
  })

  it('attaches the anchor before clicking and detaches it after', () => {
    // Some browsers only honour a programmatic click on a connected element,
    // and leaving the anchor behind litters the DOM of a long-lived session.
    let wasConnected = false
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      wasConnected = this.isConnected
    })
    downloadBlob(new Blob(['x']), 'file.txt')
    expect(wasConnected).toBe(true)
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  it('revokes the URL later, never during the click', () => {
    // Revoking synchronously cancels the in-flight download in some browsers.
    downloadBlob(new Blob(['x']), 'file.txt')
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(200)
    expect(revoked).toEqual(['blob:1'])
  })
})

describe('downloadText()', () => {
  it('wraps the content in a blob of the given type', async () => {
    downloadText('Name\tRole\n', 'cv.txt', 'text/plain;charset=utf-8')
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('text/plain;charset=utf-8')
    expect(await created[0].text()).toBe('Name\tRole\n')
    expect(clicked[0].download).toBe('cv.txt')
  })
})
