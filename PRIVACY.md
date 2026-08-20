# Privacy and data handling

Resume Studio holds CVs. A CV is one identified person's employment history —
personal data by any definition, and often someone other than the person
running the software. This document says exactly what is stored, where, who else
on the same instance can read it, and what leaves the machine.

**Two shapes of install, and the difference decides most of this document.** The
desktop build is one person on their own machine: no accounts, no login, nothing
shared. A self-hosted server can be that same thing for one consultant, or a
firm's shared instance where colleagues sign in and each owns their own résumés.
Section 2 is about the second case, and is the part to read first if you are one
of the people whose CV is in there.

**The short version:** nothing is sent anywhere by default except a version
check for updates. No telemetry, no analytics, no licence check, and no
Cartavio-operated server — every provider, relay and sync folder in here is one
somebody configured themselves.

---

## 1. What is stored, and where

| Data | Where | Notes |
|---|---|---|
| Résumés (all content and images) | SQLite database on the machine running the app | Desktop: the per-user OS data directory (`%APPDATA%\ResumeStudio`, `~/Library/Application Support/ResumeStudio`, `~/.local/share/resume-studio`). Self-hosted: `data/resume.db`. |
| Snapshot history | Same database | Up to 50 per résumé, stored **image-free** — photos are re-attached from the live record on restore, so history never multiplies them. |
| Who saved what | Same database | Each save and each snapshot carries a `saved_by` name: the signed-in user's display name, a service credential's label, or the name from Settings on a build without accounts. Attribution, shown in History and on the picker cards. |
| Accounts (a server with accounts only) | Same database | Username, display name, role, an optional email address and whether it has been confirmed, and the times the account was created, last signed in, and disabled. The password is stored only as a **scrypt hash** — never the password itself, and not recoverable from the hash. |
| Sessions | Same database | One row per signed-in browser: the SHA-256 of the cookie value, never the value, so a copy of the database yields no usable session. No expiry — see §5. |
| Invitations, reset and confirmation links | Same database | Hashed the same way, plus the address an invitation or confirmation was addressed to. Short-lived: 7 days for an invitation, 24 hours for an address confirmation, 30 minutes for a password reset, and single-use. |
| Recovery codes | Same database | Ten per account, displayed once when they are generated and stored only as hashes. |
| Unsaved edits | Browser `localStorage` | One pending record per résumé, so an edit made offline is not lost. Held in plaintext; cleared once it reaches the server, and on sign-out (§5). |
| Provider API keys, SMTP credentials | Desktop settings file / server environment | Write-only over the API: the settings screen reports whether a secret is *set*, never its value. |
| Sync copies | The folder you choose, if you enable sync | One JSON file per résumé. See §4. |

On a self-hosted server the database file is chmod'ed `0600` and its directory
`0700` where the operating system supports it.

## 2. Who can read a résumé on a shared instance

**A résumé is private by default.** A new one belongs to the account that
created it, and no other member can list it, open it, export it or learn that it
exists — a résumé another member may not read answers exactly as one that does
not exist, so the API cannot be used to find out who has a CV here.

**Sharing grants reading, never writing.** Setting a résumé's visibility to the
instance lets every signed-in member read it; none of them can edit, rename or
delete it. "Share with the team" has to be safe to switch on, and it would not
be if it also handed over the ability to rewrite somebody's history.

**The `owner` role can read every résumé on the instance, including private
ones.** It is a deliberate decision, not an oversight: staffing work means
reading across the firm, backups have to cover everything, and a colleague who
leaves takes their password with them but not their CV. An owner can open, edit,
rename, export, re-share and delete any résumé, and sees them all in a backup.
If you are a member of a firm's instance, assume whoever holds the owner role
can read what you write there.

**The registry is instance-wide, and so is every name in it.** Skills, roles,
industries and their categories are one shared vocabulary — that is what makes
"who here knows Kubernetes?" answerable at all, and a per-member registry would
just be a per-member spelling of "Kubernetes". Every signed-in
member can read the whole registry and add to it; only an owner can delete an
entry. So **a skill named after a client is visible to everyone on the
instance.** Name them with that in mind.

**The desktop build has no accounts and asks nobody to sign in.** One person,
their own machine, a loopback address — a login screen there is friction and
nothing else. It does carry a **local identity**: a username, display name and
email address in Settings. That name is stamped on saves as `saved_by`, and it
travels with a synced or exported résumé as an `author` record, so a CV that
later moves to a shared instance arrives knowing whose it is rather than
arriving anonymous. It is descriptive only. Nothing in it authenticates anybody
or authorises anything, on any build — a file cannot prove who wrote it, so
nothing that arrives in one is trusted to assign ownership.

## 3. What leaves the machine

Nothing, unless one of the following applies.

### 3.1 Update checks (on by default, desktop only)

The desktop build asks GitHub whether a newer release exists, and downloads it
if you accept.

- **Hosts:** `api.github.com`, `github.com`
- **Sent:** an ordinary HTTPS request for public release metadata. No résumé
  content, no identifiers, no account. GitHub will see your IP address, as any
  web request does.
- **Turn it off:** set `RESUME_NO_UPDATE=1`.

A self-hosted server never updates itself and reports the feature as
unsupported.

### 3.2 AI assists (off until you configure them)

If — and only if — you configure a model, the text you are working on is sent
to that provider so it can answer. This includes the assists that read the
whole CV (review, job fit, consistency), which by their nature send most of the
document.

| Provider | Host |
|---|---|
| Ollama (local) | your own machine — **nothing leaves it** |
| OpenAI | `api.openai.com` |
| Anthropic | `api.anthropic.com` |
| Google Gemini | `generativelanguage.googleapis.com` |
| Mistral | `api.mistral.ai` |
| OpenAI-compatible | whatever endpoint you set |

The request always goes through your own server, never from the browser
directly, so keys stay server-side. **Ollama is the option that sends nothing
anywhere** — it runs on your machine.

Whatever you send is then governed by that provider's terms, including whether
they retain it or train on it. Resume Studio cannot control that. If you handle
other people's CVs under an employment or client agreement, this is the setting
to think hardest about.

The **copy-prompt / paste-result** import path sends nothing: it produces text
for you to paste into whatever tool you choose.

### 3.3 Translation (off until you configure it)

Same shape: the field being translated is sent to the configured backend.

| Provider | Host |
|---|---|
| LibreTranslate | your own instance (the bundled Docker option runs locally) |
| DeepL | `api.deepl.com` / `api-free.deepl.com` |
| Google | `translation.googleapis.com` |
| Azure | `api.cognitive.microsofttranslator.com` |
| The configured LLM | as §3.2 |

The **Copy** button beside every secondary-language field is a local copy and
uses no network at all.

### 3.4 Password-reset email (off until an operator configures it)

A server can be given a way to send mail, and it sends exactly two messages: a
password-reset link, and a link confirming that an address reaches its owner.
Nothing else in the app ever sends mail, and **no CV content ever goes into
one.**

- **What a message contains:** one link, how long it stays valid, and a line
  saying to ignore it if you did not ask. It deliberately does not name the
  account, the username or the display name. The mailbox is the only thing
  identifying the reader, and a message confirming whose account it belongs to
  is worth more to somebody who reached that mailbox by mistake than to its
  owner.
- **Where it goes:** to whatever relay the operator configured — the machine's
  own `sendmail` binary, or an SMTP server they name, with or without TLS as
  they set it up. Once handed over it is ordinary email, subject to that relay's
  terms and readable by whoever administers it. That is why a reset link expires
  in 30 minutes and works once: it rests in an inbox, and an inbox is a
  lower-trust channel than an owner handing a link over in person.
- **It is off by default** and stays off unless a transport *and* a valid sender
  address are configured. With it off, the "Forgot password?" link is hidden
  rather than shown-and-refusing, and an address on an account is only ever
  stored, never used.
- **An address must be confirmed before it can receive a reset.** Unconfirmed,
  one typo would post a credential-bearing link to a stranger.

### 3.5 Fonts and other assets

None. Fonts are self-hosted and the Content-Security-Policy forbids loading
from third-party origins, so opening the app makes no request to anyone.

### 3.6 No telemetry

There is no analytics, crash reporting, usage tracking or licence check.
Errors are shown to you and logged locally.

## 4. Cross-computer sync

Sync writes **one JSON file per résumé** into a folder you nominate — typically
one that a service like OneDrive, Dropbox or iCloud replicates.

Once a file is in that folder, that service's privacy terms apply to it. Resume
Studio does not encrypt the files: they are readable by anything with access to
the folder, including other people the folder is shared with. Choose the folder
accordingly.

Each file carries the résumé, the registry entries it references, and the
`author` record described in §2 — a name, not a credential.

The per-résumé split is deliberate and is a privacy decision: **erasure has to
be actionable per person.** With a single combined file, "remove this person
from the backups" meant rewriting a file containing everyone else.

## 5. Sessions and signing out

On an instance with accounts, a session lasts until something makes it
untrustworthy — signing out, a password change, a password reset, or the account
being disabled — and not until a timer says so. Somebody editing a CV should not
be asked to sign in again for no reason, and revocation on those four events is
a stronger guarantee than an expiry would be: a password change ends **every**
session for that account,
including the one that changed it, and disabling an account ends its sessions
immediately.

The cookie a browser holds is a random id that means nothing on its own; the
server stores only its hash, so a copy of the database yields no way in.

Signing out also wipes this browser's local copies of every résumé — the offline
queue keeps them in plaintext, and a shared machine is exactly where that
matters. If any of them hold edits the server has not received yet, you are told
how many and can back out to export a backup before anything is discarded.

## 6. Deleting someone's data

### A résumé

Deleting a résumé removes the row, its snapshots (database cascade) and its
file(s) in the sync folder.

To let other machines learn about the deletion, a **tombstone** is appended to
`resume-studio-deleted-resumes.json`: **an id and a timestamp, nothing else.**
The record that propagates an erasure is deliberately not itself personal data —
no name, no content. Tombstones expire after one year.

A copy saved *after* a deletion is treated as a revival and kept, so an erasure
cannot silently destroy newer work by someone else.

Caveat worth stating plainly: if your sync folder is cloud-backed, the provider
may retain its own version history of the deleted files. Resume Studio cannot
reach into that; use the provider's own controls.

### An account

Accounts are **disabled, not deleted**. Disabling ends every session for that
account at once and stops it signing in again; the account row and the résumés
it owns both remain, the résumés still readable by the owner role. That split is
deliberate for the departing-colleague case: revoking access and destroying
somebody's CV are different decisions, and one should not quietly perform the
other.

So erasing a person means two acts, in this order: disable the account, then
delete each résumé it owns, which behaves exactly as above. Nothing in the app
removes a user row — the account itself, and the hashed sessions, grants and
recovery codes attached to it, are removed at the database.

## 7. Your rights over your own content

The résumé content is yours. Resume Studio is a tool you run; Cartavio AS
receives none of it and has no access to it. You can export at any time as
portable JSON — one résumé, or a zip of the set — and delete it from the app. On
an instance with accounts, that export gives a member **the résumés they own**;
one shared with them is readable in the app but is somebody else's data to carry
off the machine. An owner's export covers the instance.

If you process other people's CVs, you are the controller of that data and this
software is one of your processing tools. What that requires of you — a lawful
basis, retention limits, answering access and erasure requests — is your
responsibility, not the software's. §4 and §6 exist to make those requests
answerable.

## 8. Questions and reports

Privacy questions: https://cartavio.no. Security issues: see
[SECURITY.md](./SECURITY.md).

*Last reviewed: 2026-08-20.*
