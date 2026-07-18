/**
 * Publish resumes' own registries to the instance-level shared registry
 * (Stage 3 / Increment 2c). A client I/O orchestrator (like translateClient) —
 * the pure planning is in `registrySync.ts`; this drives the `api.*` writes.
 *
 * For each target resume: plan what to create/link (`planPublish`), create the
 * missing canonical entries, then write the `canonical_id` links back onto the
 * resume and save it. The working registry GROWS as entries are created, so a
 * skill first seen in resume A is CREATED once and then LINKED (not duplicated)
 * when resume B is processed — cross-resume dedup falls out of the ordering.
 *
 * Idempotent: an already-linked entry is skipped, so re-running publishes only
 * what's new. A resume whose save conflicts (someone edited it meanwhile) is
 * counted and skipped, not fatal — re-run to pick it up.
 */

import { api, ConflictError } from './api'
import { planPublish, applyCanonicalLinks } from './registrySync'
import type { ResumeStore, RegistryEntry } from '../types'

export interface PublishTarget {
  id: string
  data: ResumeStore
  /** The resume's server `version`, for the optimistic-concurrency save. */
  version: number
}

export interface PublishResult {
  /** Canonical entries newly created. */
  created: number
  /** Resume entries linked to an existing/created canonical entry. */
  linked: number
  /** Resumes saved with their new links. */
  saved: number
  /** Resumes skipped because their save conflicted (edited elsewhere). */
  conflicts: number
}

export async function publishToInstanceRegistry(targets: PublishTarget[]): Promise<PublishResult> {
  let registry: RegistryEntry[] = await api.listRegistry()
  const result: PublishResult = { created: 0, linked: 0, saved: 0, conflicts: 0 }

  for (const t of targets) {
    const plan = planPublish(t.data, registry)
    if (!plan.creates.length && !plan.links.length) continue // nothing to publish

    const linkMap: Record<string, string> = {}
    for (const c of plan.creates) {
      const entry = await api.createRegistryEntry({ kind: c.kind, name: c.name, extra: c.extra })
      registry = [...registry, entry] // so later resumes LINK to it, not re-create
      result.created++
      for (const localId of c.localIds) linkMap[localId] = entry.id
    }
    for (const l of plan.links) { linkMap[l.localId] = l.canonicalId; result.linked++ }

    const newData = applyCanonicalLinks(t.data, linkMap)
    try {
      await api.saveResume(t.id, newData, undefined, t.version)
      result.saved++
    } catch (e) {
      if (e instanceof ConflictError) { result.conflicts++; continue }
      throw e
    }
  }
  return result
}
