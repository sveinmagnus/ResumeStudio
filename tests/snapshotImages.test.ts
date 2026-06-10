import { describe, it, expect } from 'vitest'
import { reattachImages } from '../src/lib/snapshotImages'
import { emptyStore, makeResume, makeView } from './fixtures'
import type { Resume, ResumeStore } from '../src/types'

// Simulate the server-side strip: the snapshot arrives with the image keys
// ABSENT (deleted before storage), not set to null.
function stripped(store: ResumeStore): ResumeStore {
  const clone = JSON.parse(JSON.stringify(store)) as ResumeStore
  if (clone.resume) {
    delete (clone.resume as Partial<Resume>).profile_photo
    delete (clone.resume as Partial<Resume>).company_logo
  }
  for (const v of clone.views) {
    if (v.header) {
      delete (v.header as Partial<typeof v.header>).photo_override
      delete (v.header as Partial<typeof v.header>).logo_override
    }
  }
  return clone
}

const PHOTO = 'data:image/jpeg;base64,PHOTO'
const LOGO = 'data:image/png;base64,LOGO'
const OVR = 'data:image/jpeg;base64,OVR'

function currentStore(): ResumeStore {
  const store = emptyStore()
  store.resume = makeResume({ profile_photo: PHOTO, company_logo: LOGO })
  store.views = [makeView({ id: 'v1' })]
  store.views[0].header.photo_override = OVR
  return store
}

describe('reattachImages', () => {
  it('fills stripped resume images from the current store', () => {
    const current = currentStore()
    const snap = stripped(current)
    const out = reattachImages(snap, current)
    expect(out.resume?.profile_photo).toBe(PHOTO)
    expect(out.resume?.company_logo).toBe(LOGO)
  })

  it('fills stripped view header overrides from the current view with the same id', () => {
    const current = currentStore()
    const snap = stripped(current)
    const out = reattachImages(snap, current)
    expect(out.views[0].header.photo_override).toBe(OVR)
  })

  it('respects values the snapshot explicitly carries (pre-strip history)', () => {
    const current = currentStore()
    const snap = JSON.parse(JSON.stringify(current)) as ResumeStore
    snap.resume!.profile_photo = 'data:image/jpeg;base64,OLD'
    snap.views[0].header.photo_override = null // explicit "no override" statement
    const out = reattachImages(snap, current)
    expect(out.resume?.profile_photo).toBe('data:image/jpeg;base64,OLD')
    expect(out.views[0].header.photo_override).toBeNull()
  })

  it('leaves snapshot views untouched when no current view shares the id', () => {
    const current = currentStore()
    const snap = stripped(current)
    snap.views[0] = { ...snap.views[0], id: 'gone' }
    const out = reattachImages(snap, current)
    expect('photo_override' in out.views[0].header).toBe(false)
  })

  it('is a no-op when the current store has no images to offer', () => {
    const current = currentStore()
    current.resume = makeResume() // fixtures default: no photo/logo
    current.views = []
    const snap = stripped(currentStore())
    const out = reattachImages(snap, current)
    expect('profile_photo' in (out.resume ?? {})).toBe(false)
  })

  it('handles a current store with resume null (nothing loaded)', () => {
    const current = emptyStore()
    current.resume = null
    const snap = stripped(currentStore())
    expect(() => reattachImages(snap, current)).not.toThrow()
  })

  it('does not mutate its inputs', () => {
    const current = currentStore()
    const snap = stripped(current)
    const snapJson = JSON.stringify(snap)
    const currentJson = JSON.stringify(current)
    reattachImages(snap, current)
    expect(JSON.stringify(snap)).toBe(snapJson)
    expect(JSON.stringify(current)).toBe(currentJson)
  })
})
