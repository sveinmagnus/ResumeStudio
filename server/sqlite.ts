/**
 * The SQLite connection — Node's built-in `node:sqlite`, behind a
 * better-sqlite3-shaped facade.
 *
 * WHY A BUILT-IN AT ALL: better-sqlite3 is a native addon, and every consumer
 * paid for that. v12 pulled the deprecated `prebuild-install`; v13 dropped it
 * but made `npm ci` (and a plain `npm install` from the committed lockfile)
 * compile from source on any machine without a C++ toolchain — which broke
 * Windows dev boxes and the `windows-latest` release runner. `node:sqlite`
 * ships INSIDE the Node binary: nothing to download, nothing to compile,
 * nothing to vendor into the desktop bundle, and no ABI to track per Node
 * release. That is the whole point of this module. Requires Node 24, where the
 * module is available without a flag (Node 22 gates it behind
 * `--experimental-sqlite`).
 *
 * WHY A FACADE rather than rewriting the callers: `db.ts` and `registryDb.ts`
 * are built around prepared statements plus two better-sqlite3 conveniences
 * that `node:sqlite` does not offer — `pragma()` and `transaction()`. Bridging
 * those two in one place keeps the storage layer's shape (and its tests)
 * intact, so the swap is a dependency change rather than a rewrite of the code
 * that holds every resume.
 *
 * The three behaviours worth knowing, because they are the ones that differ:
 *
 *  - **Rows are copied.** `node:sqlite` returns null-prototype objects.
 *    They read the same but are not interchangeable — `toStrictEqual`,
 *    `instanceof Object` and anything walking the prototype chain all behave
 *    differently. Every row is spread into a plain object here so callers see
 *    exactly what better-sqlite3 gave them.
 *  - **Transactions nest** via SAVEPOINT, matching better-sqlite3. A nested
 *    `transaction()` must not COMMIT the outer one, so only the outermost call
 *    issues BEGIN/COMMIT; inner calls take a savepoint.
 *  - **Named parameters stay bare.** `node:sqlite` accepts `{ id }` for `@id`
 *    by default, so `registryDb`'s object-style `.run()` calls are unchanged.
 *    It rejects UNKNOWN named parameters, as better-sqlite3 does — passing an
 *    object with a spare key is an error, not a silently ignored extra.
 */

import { DatabaseSync } from 'node:sqlite'

/** The result of a write, matching better-sqlite3's `RunResult`. */
export interface SqliteRunResult {
  changes: number
  lastInsertRowid: number
}

export interface SqliteStatement {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): SqliteRunResult
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  /**
   * Run a PRAGMA. A `name = value` source is applied as a statement; a bare
   * `name` (or `name(arg)`) is queried and its rows returned. `simple: true`
   * returns just the first column of the first row, as better-sqlite3 does.
   */
  pragma(source: string, opts?: { simple?: boolean }): unknown
  /**
   * Wrap `fn` so it runs inside a transaction, rolling back if it throws.
   * Re-entrant: a transaction started inside another takes a SAVEPOINT.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
  close(): void
}

/** node:sqlite hands back null-prototype rows; callers expect plain objects. */
function plain(row: unknown): unknown {
  return row && typeof row === 'object' ? { ...(row as Record<string, unknown>) } : row
}

/**
 * `.all(a, b)` and `.all({ named })` are both valid. node:sqlite takes the same
 * two shapes, so parameters pass straight through — but an explicit `undefined`
 * (a caller spreading a missing optional) must not become a bound `undefined`,
 * which node:sqlite rejects with a TypeError rather than treating as absent.
 */
function args(params: unknown[]): unknown[] {
  return params.length === 1 && params[0] === undefined ? [] : params
}

export function openDatabase(dbPath: string): SqliteDatabase {
  const db = new DatabaseSync(dbPath)

  // Depth of the current transaction nest: 0 = none. Drives BEGIN-vs-SAVEPOINT.
  let depth = 0

  const prepare = (sql: string): SqliteStatement => {
    const stmt = db.prepare(sql)
    return {
      all: (...params) => stmt.all(...(args(params) as [])).map(plain),
      get: (...params) => plain(stmt.get(...(args(params) as []))),
      run: (...params) => {
        const info = stmt.run(...(args(params) as []))
        // lastInsertRowid is a bigint only for ids beyond 2^53; the snapshot
        // table's AUTOINCREMENT never gets there, and callers type it `number`.
        return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) }
      },
    }
  }

  const pragma = (source: string, opts?: { simple?: boolean }): unknown => {
    if (source.includes('=')) {
      db.exec(`PRAGMA ${source}`)
      return undefined
    }
    const rows = db.prepare(`PRAGMA ${source}`).all().map(plain) as Record<string, unknown>[]
    if (!opts?.simple) return rows
    const first = rows[0]
    return first ? Object.values(first)[0] : undefined
  }

  const transaction = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => {
    const nested = depth > 0
    const name = `rs_sp_${depth}`
    db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN')
    depth++
    try {
      const result = fn(...a)
      db.exec(nested ? `RELEASE ${name}` : 'COMMIT')
      return result
    } catch (err) {
      // Best-effort unwind: the original error is what the caller needs to see,
      // so a failure to roll back must not replace it.
      try {
        db.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK')
        if (nested) db.exec(`RELEASE ${name}`)
      } catch { /* ignore */ }
      throw err
    } finally {
      depth--
    }
  }

  return {
    prepare,
    exec: (sql) => db.exec(sql),
    pragma,
    transaction,
    close: () => db.close(),
  }
}
