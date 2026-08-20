#!/usr/bin/env node
/**
 * Recovery mode — the way back in when the owner has forgotten their password.
 *
 * WHY THIS EXISTS AND WHY IT IS SAFE. Every other reset path needs somebody
 * else: a member asks the owner, and anybody can spend a recovery code they
 * filed away in advance. The owner who has neither has nobody above them, so
 * without this an instance can lock its administrator out permanently.
 *
 * It grants nothing new. Running this requires the ability to execute a command
 * on the machine holding `resume.db` — and anyone who can do that can already
 * read every CV in it with `sqlite3`. The trust boundary is unchanged; what
 * changes is that recovering is a supported action rather than a hand-edit of
 * the users table. Grafana, Gitea and Discourse all solve it the same way.
 *
 *   npm run recover                → list the accounts
 *   npm run recover -- <username>  → mint a one-time reset link for that account
 *
 * The link is an ordinary `reset` grant, redeemed by the same route that serves
 * an owner-issued link, a recovery code and a reset email. Four triggers, one
 * mechanism — see server/routes/users.ts.
 */

import { getAccounts, closeDefaultDb } from '../server/db.js'
import { GRANT_TTL_MS } from '../server/accounts.js'

function baseUrl() {
  const configured = (process.env.RESUME_APP_BASE_URL ?? '').trim().replace(/\/+$/, '')
  return configured || 'http://localhost:3001'
}

function listAccounts(accounts) {
  const users = accounts.listUsers()
  if (users.length === 0) {
    console.log(
      '\nNo accounts exist yet. Start the server and use the bootstrap code it prints\n'
      + 'to create the first one.\n',
    )
    return
  }
  console.log('\n  Accounts on this instance:\n')
  for (const u of users) {
    const flags = [
      u.role,
      u.disabled_at ? 'disabled' : null,
      u.email ? (u.email_verified_at ? `${u.email} (verified)` : `${u.email} (unverified)`) : null,
    ].filter(Boolean).join(', ')
    console.log(`    ${u.username.padEnd(24)} ${u.display_name.padEnd(28)} ${flags}`)
  }
  console.log('\n  Mint a reset link with:  npm run recover -- <username>\n')
}

function mintReset(accounts, login) {
  const user = accounts.findByLogin(login)
  if (!user) {
    console.error(`\nNo account matches "${login}". Run without an argument to list them.\n`)
    process.exitCode = 1
    return
  }
  const token = accounts.mintGrant('reset', { userId: user.id })
  const minutes = Math.round(GRANT_TTL_MS.reset / 60000)
  console.log([
    '',
    `  Reset link for ${user.display_name} (${user.username}):`,
    '',
    `    ${baseUrl()}/reset?token=${encodeURIComponent(token)}`,
    '',
    `  Valid for ${minutes} minutes, and can be used once.`,
    '  Opening it ends every existing session for that account.',
    '',
  ].join('\n'))
}

function main() {
  // A login is the only argument. `npm run recover -- kari` puts it here.
  const login = process.argv[2]?.trim()
  let accounts
  try {
    accounts = getAccounts()
  } catch (err) {
    console.error('\nCould not open the database. Is RESUME_DB_PATH set correctly?')
    console.error(String(err?.message ?? err), '\n')
    process.exitCode = 1
    return
  }

  try {
    if (login) mintReset(accounts, login)
    else listAccounts(accounts)
  } finally {
    // Checkpoints the WAL and closes; without it a recovery run can leave a
    // -wal file beside a database the server is about to open.
    closeDefaultDb()
  }
}

main()
