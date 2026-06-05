import { describe, it, expect, vi } from 'vitest'
import { pngIcon, icoFromPng, trayIconBase64 } from '../../server/desktop/trayIcon'
import { routeClick, TRAY_OPEN, TRAY_QUIT } from '../../server/desktop/tray'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('trayIcon — PNG generation', () => {
  it('produces a valid PNG (signature, IHDR 32×32, IEND)', () => {
    const png = pngIcon()
    expect(png.subarray(0, 8).equals(PNG_SIG)).toBe(true)
    // IHDR width/height live at byte 16/20.
    expect(png.readUInt32BE(16)).toBe(32)
    expect(png.readUInt32BE(20)).toBe(32)
    // Ends with the IEND chunk type.
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND')
  })

  it('memoizes — returns the same buffer instance', () => {
    expect(pngIcon()).toBe(pngIcon())
  })
})

describe('trayIcon — ICO wrapping', () => {
  it('wraps a PNG in a single-image ICO container', () => {
    const ico = icoFromPng(pngIcon())
    expect(ico.readUInt16LE(0)).toBe(0) // reserved
    expect(ico.readUInt16LE(2)).toBe(1) // type: icon
    expect(ico.readUInt16LE(4)).toBe(1) // one image
    expect(ico[0]).toBe(0)              // ICONDIR reserved byte
    // The embedded image starts at the declared offset and is our PNG.
    const offset = ico.readUInt32LE(6 + 12)
    expect(ico.subarray(offset, offset + 8).equals(PNG_SIG)).toBe(true)
  })
})

describe('trayIconBase64 — per platform', () => {
  it('returns ICO bytes on Windows', () => {
    const buf = Buffer.from(trayIconBase64('win32'), 'base64')
    expect(buf.readUInt16LE(0)).toBe(0)
    expect(buf.readUInt16LE(2)).toBe(1) // ICO type
  })
  it('returns PNG bytes elsewhere', () => {
    expect(Buffer.from(trayIconBase64('linux'), 'base64').subarray(0, 8).equals(PNG_SIG)).toBe(true)
    expect(Buffer.from(trayIconBase64('darwin'), 'base64').subarray(0, 8).equals(PNG_SIG)).toBe(true)
  })
})

describe('routeClick — menu dispatch', () => {
  it('routes Open and Quit to their handlers', () => {
    const onOpen = vi.fn(); const onQuit = vi.fn()
    routeClick(TRAY_OPEN, { onOpen, onQuit })
    expect(onOpen).toHaveBeenCalledOnce(); expect(onQuit).not.toHaveBeenCalled()
    routeClick(TRAY_QUIT, { onOpen, onQuit })
    expect(onQuit).toHaveBeenCalledOnce()
  })

  it('ignores unknown / separator clicks', () => {
    const onOpen = vi.fn(); const onQuit = vi.fn()
    routeClick(undefined, { onOpen, onQuit })
    routeClick('something else', { onOpen, onQuit })
    expect(onOpen).not.toHaveBeenCalled(); expect(onQuit).not.toHaveBeenCalled()
  })
})
