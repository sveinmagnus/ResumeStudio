import type { ResumeStore, ResumeView } from '../types'

/**
 * Server-side snapshots strip embedded base64 images (profile photo, company
 * logo, per-view header overrides) to keep history rows small — see
 * `server/db.ts → stripSnapshotImages`. When restoring a snapshot, carry the
 * *current* images over so a content restore never silently deletes them.
 *
 * Rules: a stripped field is *absent* from the snapshot (checked with `in`),
 * so re-attach fills it from the current store. A field that is present —
 * including explicitly `null` from a pre-strip snapshot — is the snapshot's
 * own statement and is respected. Pure; returns a new store, inputs untouched.
 */
export function reattachImages(snapshot: ResumeStore, current: ResumeStore): ResumeStore {
  const out: ResumeStore = { ...snapshot }

  if (out.resume && current.resume) {
    const resume = { ...out.resume }
    if (!('profile_photo' in resume) && current.resume.profile_photo != null) {
      resume.profile_photo = current.resume.profile_photo
    }
    if (!('company_logo' in resume) && current.resume.company_logo != null) {
      resume.company_logo = current.resume.company_logo
    }
    out.resume = resume
  }

  if (Array.isArray(out.views) && Array.isArray(current.views)) {
    const currentById = new Map(current.views.map((v) => [v.id, v]))
    out.views = out.views.map((view): ResumeView => {
      const live = currentById.get(view.id)
      if (!view.header || !live?.header) return view
      const header = { ...view.header }
      // The override fields are required on ViewHeaderConfig, but a stripped
      // snapshot omits them in the JSON — view through Partial so TS lets us
      // test for that. JSON can't encode `undefined`, so `=== undefined` is
      // exactly "absent" here; an explicit null stays the snapshot's choice.
      const h = header as Partial<ResumeView['header']>
      if (h.photo_override === undefined && live.header.photo_override != null) {
        header.photo_override = live.header.photo_override
      }
      if (h.logo_override === undefined && live.header.logo_override != null) {
        header.logo_override = live.header.logo_override
      }
      return { ...view, header }
    })
  }

  return out
}
