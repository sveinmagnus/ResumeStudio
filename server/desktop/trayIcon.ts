/**
 * Generate the system-tray icon at runtime — no committed binary, no image
 * dependency, just Node's zlib. Draws a 32×32 Cartavio-brand mark (navy with a
 * cyan base, rounded corners) and returns it base64-encoded in the format the
 * tray helper wants: ICO on Windows, PNG on macOS/Linux.
 *
 * Pure logic; safe to bundle (uses only `zlib`, a Node builtin). The buffers are
 * memoized so we build them at most once.
 */

import zlib from 'zlib'

const SIZE = 32
const NAVY: [number, number, number, number] = [0x00, 0x2e, 0x6e, 0xff] // --accent
const CYAN: [number, number, number, number] = [0x00, 0xb8, 0xde, 0xff] // --secondary
const CLEAR: [number, number, number, number] = [0, 0, 0, 0]

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/** True inside a rounded rectangle [left,top]‥[right,bottom] with `radius` corners. */
function inRoundedRect(x: number, y: number, left: number, top: number, right: number, bottom: number, radius: number): boolean {
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = x < left + radius ? left + radius : (x > right - radius ? right - radius : x)
  const cy = y < top + radius ? top + radius : (y > bottom - radius ? bottom - radius : y)
  const dx = x - cx, dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

let pngCache: Buffer | null = null
/** A 32×32 RGBA PNG of the brand mark. */
export function pngIcon(): Buffer {
  if (pngCache) return pngCache
  const m = 2, r = 7 // margin + corner radius (0-indexed pixel coords)
  const left = m, top = m, right = SIZE - 1 - m, bottom = SIZE - 1 - m
  const splitY = 20 // navy above, cyan below

  // Raw scanlines: each row is a filter byte (0) + width*4 RGBA bytes.
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
  for (let y = 0; y < SIZE; y++) {
    const rowStart = y * (1 + SIZE * 4)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < SIZE; x++) {
      const px = inRoundedRect(x, y, left, top, right, bottom, r)
        ? (y <= splitY ? NAVY : CYAN)
        : CLEAR
      const o = rowStart + 1 + x * 4
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = px[3]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // compression / filter / interlace

  pngCache = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return pngCache
}

/** Wrap a PNG in a single-image ICO container (PNG-in-ICO, valid on Win Vista+). */
export function icoFromPng(png: Buffer): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count
  const entry = Buffer.alloc(16)
  entry[0] = SIZE >= 256 ? 0 : SIZE // width  (0 = 256)
  entry[1] = SIZE >= 256 ? 0 : SIZE // height
  entry[2] = 0  // palette colors
  entry[3] = 0  // reserved
  entry.writeUInt16LE(1, 4)  // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8)  // image data size
  entry.writeUInt32LE(6 + 16, 12)     // offset to image data
  return Buffer.concat([header, entry, png])
}

let icoCache: Buffer | null = null
function icoIcon(): Buffer {
  if (!icoCache) icoCache = icoFromPng(pngIcon())
  return icoCache
}

/** Base64 tray icon for the platform: ICO on Windows, PNG elsewhere. */
export function trayIconBase64(platform: NodeJS.Platform = process.platform): string {
  return (platform === 'win32' ? icoIcon() : pngIcon()).toString('base64')
}
