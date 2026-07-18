import { Router, type Request, type Response } from 'express'
import {
  listRegistry, getRegistryEntry, upsertRegistryEntry, deleteRegistryEntry,
} from '../db.js'
import type { RegistryKind } from '../registryDb.js'

/**
 * Instance-level registry API (cross-resume registries, Increment 1).
 * Auth-gated + rate-limited like the rest (wired in app.ts). Additive: no client
 * consumes it yet — it's the endpoint the store-projection rewire (Increment 2)
 * will use. Errors stay generic (no SQL/internal detail), matching the codebase.
 */
const router = Router()

const KINDS = new Set<RegistryKind>(['skill', 'role', 'industry', 'category'])
type IdParams = { id: string }

function isLocalized(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every((s) => typeof s === 'string')
}

/** GET /api/registry?kind=skill — list canonical entries (optionally one kind). */
router.get('/', (req: Request, res: Response): void => {
  const kind = req.query.kind
  if (kind !== undefined && (typeof kind !== 'string' || !KINDS.has(kind as RegistryKind))) {
    res.status(400).json({ error: 'Unknown registry kind' })
    return
  }
  res.json({ entries: listRegistry(kind as RegistryKind | undefined) })
})

/** GET /api/registry/:id — one entry. */
router.get('/:id', (req: Request<IdParams>, res: Response): void => {
  const entry = getRegistryEntry(req.params.id)
  if (!entry) { res.status(404).json({ error: 'Not found' }); return }
  res.json({ entry })
})

/**
 * POST /api/registry — create a canonical entry.
 * Body: { kind, name: LocalizedString, extra? }.
 */
router.post('/', (req: Request, res: Response): void => {
  const body = req.body as Record<string, unknown> | undefined
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Body must be an object' }); return }
  if (typeof body.kind !== 'string' || !KINDS.has(body.kind as RegistryKind)) {
    res.status(400).json({ error: 'Unknown registry kind' }); return
  }
  if (!isLocalized(body.name)) { res.status(400).json({ error: 'name must be a localized string map' }); return }
  const result = upsertRegistryEntry({
    kind: body.kind as RegistryKind,
    name: body.name,
    extra: (body.extra && typeof body.extra === 'object' && !Array.isArray(body.extra))
      ? (body.extra as Record<string, unknown>) : {},
  })
  // Create can't conflict/not-found; narrow for the type.
  if (result.ok) res.status(201).json({ entry: result.entry })
  else res.status(500).json({ error: 'Could not create entry' })
})

/**
 * PUT /api/registry/:id — update a canonical entry (rename / re-classify).
 * Body: { name, extra?, base_version? }. A stale base_version → 409 with the
 * current entry, mirroring the resume optimistic-concurrency contract.
 */
router.put('/:id', (req: Request<IdParams>, res: Response): void => {
  const body = req.body as Record<string, unknown> | undefined
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Body must be an object' }); return }
  if (!isLocalized(body.name)) { res.status(400).json({ error: 'name must be a localized string map' }); return }
  const existing = getRegistryEntry(req.params.id)
  if (!existing) { res.status(404).json({ error: 'Not found' }); return }

  const base = body.base_version
  const result = upsertRegistryEntry({
    id: req.params.id,
    kind: existing.kind,
    name: body.name,
    extra: (body.extra && typeof body.extra === 'object' && !Array.isArray(body.extra))
      ? (body.extra as Record<string, unknown>) : existing.extra,
    expectedVersion: typeof base === 'number' ? base : undefined,
  })
  if (result.ok) { res.json({ entry: result.entry }); return }
  if (result.reason === 'conflict') { res.status(409).json({ error: 'Version conflict', current: result.current }); return }
  res.status(404).json({ error: 'Not found' })
})

/** DELETE /api/registry/:id. */
router.delete('/:id', (req: Request<IdParams>, res: Response): void => {
  res.json({ deleted: deleteRegistryEntry(req.params.id) })
})

export default router
