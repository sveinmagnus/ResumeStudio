import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_PATH  = path.join(DATA_DIR, 'resume.db')

// Ensure the data directory exists before opening the database
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(DB_PATH)

// Enable WAL mode for better concurrent-read performance
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS resume_store (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    data     TEXT    NOT NULL,
    saved_at TEXT    NOT NULL
  )
`)

export interface StoredRow {
  data: string
  saved_at: string
}

/** Return the stored resume JSON, or null if nothing has been saved yet. */
export function getResume(): Record<string, unknown> | null {
  const row = db
    .prepare('SELECT data FROM resume_store WHERE id = 1')
    .get() as StoredRow | undefined
  if (!row) return null
  return JSON.parse(row.data) as Record<string, unknown>
}

/** Persist the resume JSON, replacing any previously stored data. */
export function saveResume(data: unknown): string {
  const saved_at = new Date().toISOString()
  db.prepare(`
    INSERT INTO resume_store (id, data, saved_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at
  `).run(JSON.stringify(data), saved_at)
  return saved_at
}

/** Return the ISO timestamp of the last save, or null if nothing has been saved. */
export function getLastSavedAt(): string | null {
  const row = db
    .prepare('SELECT saved_at FROM resume_store WHERE id = 1')
    .get() as StoredRow | undefined
  return row?.saved_at ?? null
}
