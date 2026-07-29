import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { listFolders, FolderError } from '../../server/folders'

let root: string

/**
 * `listFolders` resolves with `path.resolve`, which normalises a path but does
 * NOT follow symlinks — and that is the behaviour we want: the picker should
 * show the user the path they navigated to, not its canonical target.
 *
 * The temp root has to be realpath'd HERE instead, because on macOS
 * `os.tmpdir()` is `/var/folders/…`, which is a symlink to `/private/var/…`.
 * Comparing the function's output against the un-resolved temp path passed on
 * Linux and Windows (where the two are identical) and failed only on macOS —
 * which is exactly where it was caught: in the release build's mac matrix leg.
 */
beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rs-folders-')))
  fs.mkdirSync(path.join(root, 'Beta'))
  fs.mkdirSync(path.join(root, 'alpha'))
  fs.writeFileSync(path.join(root, 'a-file.txt'), 'x') // a file, must be ignored
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('listFolders()', () => {
  it('lists only subdirectories, sorted case-insensitively', () => {
    const out = listFolders(root)
    expect(out.entries.map((e) => e.name)).toEqual(['alpha', 'Beta'])
    // Full paths are absolute and under the root.
    expect(out.entries[0].path).toBe(path.join(root, 'alpha'))
    expect(out.path).toBe(root)
  })

  it('reports the parent directory', () => {
    const out = listFolders(root)
    expect(out.parent).toBe(path.dirname(root))
  })

  it('defaults to the home directory when given no path', () => {
    const out = listFolders()
    expect(out.path).toBe(os.homedir())
    expect(out.home).toBe(os.homedir())
  })

  it('throws 404 for a missing folder', () => {
    const err = (() => { try { listFolders(path.join(root, 'nope')); return null } catch (e) { return e } })()
    expect(err).toBeInstanceOf(FolderError)
    expect((err as FolderError).status).toBe(404)
  })

  it('throws 400 when the path is a file, not a folder', () => {
    const err = (() => { try { listFolders(path.join(root, 'a-file.txt')); return null } catch (e) { return e } })()
    expect((err as FolderError).status).toBe(400)
  })
})
