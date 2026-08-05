#!/usr/bin/env node
/**
 * No raw control characters in tracked text files.
 *
 * A single raw control byte — a NUL, most often — makes git and grep classify
 * the whole FILE as binary, and the tools you would use to inspect it stop
 * showing its contents. `git diff` prints "Binary files differ", so a real
 * edit is invisible in review. `grep -rn` and ripgrep print
 * "Binary file … matches" — the match survives, but the line and its number do
 * not, so the hit no longer reads like a result in a sweep. The type checker,
 * meanwhile, is perfectly happy.
 *
 * That is not hypothetical here: three tracked files carried raw control bytes
 * when this check was written (AtsAuditPanel's NUL separator, and a 0x1F in
 * lib/viewItemSelect plus its test), and a fourth was written into CLAUDE.md
 * while the ESLint rule for it was being documented.
 *
 * ESLint enforces the same thing, but only for .ts/.tsx — which is exactly
 * where the CLAUDE.md slip escaped it. This covers the whole tree: Markdown,
 * JSON, YAML, CSS, workflows, everything git tracks that is not a declared
 * binary. Fix by writing the escape instead of the byte: '\u0000' is the same
 * string to JavaScript and keeps the file readable as text.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

/**
 * TAB (0x09), LF (0x0A) and CR (0x0D) are how text files are built. Every other
 * byte below 0x20 is a control character with no business in source, and each
 * one is enough to trip binary detection.
 */
const isForbidden = (b) => b === 0x0b || b === 0x0c || (b <= 0x08) || (b >= 0x0e && b <= 0x1f)

/**
 * Files that are legitimately binary. Checked by extension rather than by
 * sniffing content, because sniffing content is the very heuristic this exists
 * to stop relying on.
 */
const BINARY_EXT = new Set([
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'avif', 'bmp',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z',
  'node', 'exe', 'dll', 'so', 'dylib', 'wasm',
  'mp3', 'mp4', 'webm', 'mov', 'ogg',
])

const ext = (p) => {
  const i = p.lastIndexOf('.')
  return i < 0 ? '' : p.slice(i + 1).toLowerCase()
}

/** Byte offset → 1-based line and column, counting LF. */
function locate(buf, offset) {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset; i++) {
    if (buf[i] === 0x0a) { line++; lineStart = i + 1 }
  }
  return { line, column: offset - lineStart + 1 }
}

function main() {
  let tracked
  try {
    // -z: NUL-delimited, so a path containing a newline can't split a record.
    tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8').split('\u0000').filter(Boolean)
  } catch (err) {
    console.error('[check:text] could not list tracked files — is this a git repo?')
    console.error(String(err.message || err))
    process.exit(1)
  }

  const findings = []
  let scanned = 0

  for (const file of tracked) {
    if (BINARY_EXT.has(ext(file))) continue
    let buf
    try {
      if (!statSync(file).isFile()) continue
      buf = readFileSync(file)
    } catch {
      // Deleted or unreadable in this checkout — not this check's problem.
      continue
    }
    scanned++
    for (let i = 0; i < buf.length; i++) {
      if (!isForbidden(buf[i])) continue
      const { line, column } = locate(buf, i)
      findings.push({ file, line, column, byte: buf[i] })
      // One per file is enough to act on; more is noise from the same mistake.
      break
    }
  }

  if (findings.length > 0) {
    console.error(`[check:text] raw control characters in ${findings.length} file(s):\n`)
    for (const f of findings) {
      const hex = '0x' + f.byte.toString(16).padStart(2, '0').toUpperCase()
      console.error(`  ${f.file}:${f.line}:${f.column}  ${hex}`)
    }
    console.error(
      '\nA raw control byte makes git and grep treat the whole file as binary:' +
      '\ngit diff hides the change, and grep reports only "Binary file matches"' +
      '\nwithout the line. Write the escape instead — in JS and TS, "\\u0000"' +
      '\nis the same string and keeps the file text.',
    )
    process.exit(1)
  }

  console.log(`[check:text] ${scanned} tracked text files, no raw control characters.`)
}

main()
