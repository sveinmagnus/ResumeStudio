import { describe, it, expect } from 'vitest'
import { payloadStats } from '../../server/storage'

const photo = (n: number) => `data:image/jpeg;base64,${'A'.repeat(n)}`

describe('payloadStats', () => {
  it('measures UTF-8 bytes, not characters', () => {
    // ø is 2 bytes in UTF-8
    const json = JSON.stringify({ name: 'Sørensen' })
    expect(payloadStats(json).bytes).toBe(Buffer.byteLength(json, 'utf8'))
    expect(payloadStats(json).bytes).toBeGreaterThan(json.length)
  })

  it('reports zero image bytes when no data-URLs are embedded', () => {
    const json = JSON.stringify({ resume: { name: { en: 'CV' } }, projects: [] })
    expect(payloadStats(json).image_bytes).toBe(0)
  })

  it('counts a single embedded image data-URL', () => {
    const url = photo(400)
    const json = JSON.stringify({ resume: { profile_photo: url } })
    expect(payloadStats(json).image_bytes).toBe(url.length)
  })

  it('sums multiple embedded images (photo + logo + per-view override)', () => {
    const a = photo(100)
    const b = `data:image/png;base64,${'B'.repeat(200)}`
    const c = `data:image/webp;base64,${'C'.repeat(50)}`
    const json = JSON.stringify({
      resume: { profile_photo: a, company_logo: b },
      views: [{ header: { photo_override: c } }],
    })
    expect(payloadStats(json).image_bytes).toBe(a.length + b.length + c.length)
  })

  it('ignores non-image data-URLs', () => {
    const json = JSON.stringify({ note: 'data:text/plain;base64,aGVsbG8=' })
    expect(payloadStats(json).image_bytes).toBe(0)
  })

  it('image share never exceeds total bytes', () => {
    const json = JSON.stringify({ resume: { profile_photo: photo(1000) } })
    const stats = payloadStats(json)
    expect(stats.image_bytes).toBeLessThan(stats.bytes)
  })
})
