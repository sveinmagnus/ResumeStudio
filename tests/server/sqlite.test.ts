/**
 * The node:sqlite facade — the ONE module allowed to touch the driver
 * (CLAUDE.md §3), and the three behaviours it exists to bridge: rows copied to
 * plain objects, better-sqlite3-shaped pragma(), and nesting transactions via
 * SAVEPOINT. The full mutation sweep found most of these bridged behaviours
 * asserted only incidentally (through db.test.ts) or not at all — a wrong
 * branch here is a data defect in the layer that holds every resume.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, type SqliteDatabase } from '../../server/sqlite'

let db: SqliteDatabase

beforeEach(() => {
  db = openDatabase(':memory:')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)')
})
afterEach(() => db.close())

describe('row copying (the null-prototype bridge)', () => {
  it('get() and all() hand back plain Object.prototype rows', () => {
    db.prepare('INSERT INTO t (v) VALUES (?)').run('a')
    const one = db.prepare('SELECT v FROM t').get()
    const many = db.prepare('SELECT v FROM t').all()
    // node:sqlite's own rows are null-prototype; callers (and toStrictEqual)
    // need real objects — that copy is this facade's first reason to exist.
    expect(Object.getPrototypeOf(one)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(many[0])).toBe(Object.prototype)
    expect(one).toStrictEqual({ v: 'a' })
  })

  it('a missing row stays undefined, not an empty object', () => {
    expect(db.prepare('SELECT v FROM t WHERE id = 999').get()).toBeUndefined()
  })
})

describe('parameter normalisation', () => {
  it('a spread-in explicit undefined reads as "no parameters"', () => {
    db.prepare('INSERT INTO t (v) VALUES (\'x\')').run(undefined)
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get(undefined)).toStrictEqual({ n: 1 })
    expect(db.prepare('SELECT v FROM t').all(undefined)).toHaveLength(1)
  })

  it('but a real single NULL parameter is still bound', () => {
    // The shim keys on undefined specifically — null is a bindable value.
    expect(db.prepare('SELECT (? IS NULL) AS was_null').get(null)).toStrictEqual({ was_null: 1 })
  })

  it('run() reports numeric changes and lastInsertRowid', () => {
    const info = db.prepare('INSERT INTO t (v) VALUES (?)').run('a')
    expect(info).toStrictEqual({ changes: 1, lastInsertRowid: 1 })
    expect(typeof info.lastInsertRowid).toBe('number')
  })
})

describe('pragma()', () => {
  it('a name=value source APPLIES; a bare name QUERIES rows', () => {
    expect(db.pragma('user_version = 7')).toBeUndefined()
    expect(db.pragma('user_version')).toStrictEqual([{ user_version: 7 }])
  })

  it('simple: true returns the first column of the first row', () => {
    db.pragma('user_version = 9')
    expect(db.pragma('user_version', { simple: true })).toBe(9)
  })

  it('simple: true on an empty result is undefined, not a crash', () => {
    expect(db.pragma('table_info(no_such_table)', { simple: true })).toBeUndefined()
  })
})

describe('transaction()', () => {
  const count = (): number => (db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n
  const insert = (v: string): void => { db.prepare('INSERT INTO t (v) VALUES (?)').run(v) }

  it('commits on success and returns the function result', () => {
    const result = db.transaction((v: string) => { insert(v); return count() })('a')
    expect(result).toBe(1)
    expect(count()).toBe(1)
  })

  it('rolls back on a throw, rethrows the original error, and recovers for the next call', () => {
    const boom = db.transaction(() => { insert('gone'); throw new Error('boom') })
    expect(boom).toThrow('boom')
    expect(count()).toBe(0)
    // depth unwound: a follow-up transaction must BEGIN cleanly, not nest.
    db.transaction(() => insert('ok'))()
    expect(count()).toBe(1)
  })

  it('a nested transaction takes a savepoint — completing it must NOT commit the outer', () => {
    const inner = db.transaction(() => insert('inner'))
    const outer = db.transaction(() => {
      insert('outer')
      inner()
      throw new Error('outer fails')
    })
    expect(outer).toThrow('outer fails')
    // Were the inner call a real COMMIT, its row (and the outer's, already
    // written) would survive the outer rollback.
    expect(count()).toBe(0)
  })

  it('an inner failure caught by the outer discards only the inner writes', () => {
    const inner = db.transaction(() => { insert('inner'); throw new Error('inner fails') })
    db.transaction(() => {
      insert('outer')
      try { inner() } catch { /* the outer decides to continue */ }
      insert('outer-2')
    })()
    expect(db.prepare('SELECT v FROM t ORDER BY id').all()).toStrictEqual([
      { v: 'outer' }, { v: 'outer-2' },
    ])
  })
})
