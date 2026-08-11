# Privacy and data handling

Resume Studio holds CVs. A CV is one identified person's employment history —
personal data by any definition, and often someone other than the person
running the software. This document says exactly what is stored, where, and
what leaves the machine.

**The short version:** everything stays on your machine unless you configure a
provider or a sync folder yourself. There is no account, no telemetry, no
analytics, and no Cartavio-operated server. Nothing is sent anywhere by default
except a version check for updates.

---

## 1. What is stored, and where

| Data | Where | Notes |
|---|---|---|
| Résumés (all content and images) | SQLite database on the machine running the app | Desktop: the per-user OS data directory (`%APPDATA%\ResumeStudio`, `~/Library/Application Support/ResumeStudio`, `~/.local/share/resume-studio`). Self-hosted: `data/resume.db`. |
| Snapshot history | Same database | Up to 50 per résumé, stored **image-free** — photos are re-attached from the live record on restore, so history never multiplies them. |
| Unsaved edits | Browser `localStorage` | One pending record per résumé, so an edit made offline is not lost. Cleared once it reaches the server. |
| Provider API keys | Desktop settings file / server environment | Write-only over the API: the settings screen reports whether a key is *set*, never its value. |
| Sync copies | The folder you choose, if you enable sync | One JSON file per résumé. See §3. |

On a self-hosted server the database file is chmod'ed `0600` and its directory
`0700` where the operating system supports it.

## 2. What leaves the machine

Nothing, unless one of the following applies.

### 2.1 Update checks (on by default, desktop only)

The desktop build asks GitHub whether a newer release exists, and downloads it
if you accept.

- **Hosts:** `api.github.com`, `github.com`
- **Sent:** an ordinary HTTPS request for public release metadata. No résumé
  content, no identifiers, no account. GitHub will see your IP address, as any
  web request does.
- **Turn it off:** set `RESUME_NO_UPDATE=1`.

A self-hosted server never updates itself and reports the feature as
unsupported.

### 2.2 AI assists (off until you configure them)

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

### 2.3 Translation (off until you configure it)

Same shape: the field being translated is sent to the configured backend.

| Provider | Host |
|---|---|
| LibreTranslate | your own instance (the bundled Docker option runs locally) |
| DeepL | `api.deepl.com` / `api-free.deepl.com` |
| Google | `translation.googleapis.com` |
| Azure | `api.cognitive.microsofttranslator.com` |
| The configured LLM | as §2.2 |

The **Copy** button beside every secondary-language field is a local copy and
uses no network at all.

### 2.4 Fonts and other assets

None. Fonts are self-hosted and the Content-Security-Policy forbids loading
from third-party origins, so opening the app makes no request to anyone.

### 2.5 No telemetry

There is no analytics, crash reporting, usage tracking or licence check.
Errors are shown to you and logged locally.

## 3. Cross-computer sync

Sync writes **one JSON file per résumé** into a folder you nominate — typically
one that a service like OneDrive, Dropbox or iCloud replicates.

Once a file is in that folder, that service's privacy terms apply to it. Resume
Studio does not encrypt the files: they are readable by anything with access to
the folder, including other people the folder is shared with. Choose the folder
accordingly.

The per-résumé split is deliberate and is a privacy decision: **erasure has to
be actionable per person.** With a single combined file, "remove this person
from the backups" meant rewriting a file containing everyone else.

## 4. Deleting someone's data

Deleting a résumé removes the row, its snapshots (database cascade) and its
file(s) in the sync folder.

To let other machines learn about the deletion, a **tombstone** is appended to
`deleted-resumes.json`: **an id and a timestamp, nothing else.** The record that
propagates an erasure is deliberately not itself personal data — no name, no
content. Tombstones expire after one year.

A copy saved *after* a deletion is treated as a revival and kept, so an erasure
cannot silently destroy newer work by someone else.

Caveat worth stating plainly: if your sync folder is cloud-backed, the provider
may retain its own version history of the deleted files. Resume Studio cannot
reach into that; use the provider's own controls.

## 5. Your rights over your own content

The résumé content is yours. Resume Studio is a tool you run; Cartavio AS
receives none of it and has no access to it. You can export everything at any
time as portable JSON (per résumé, or the whole set as a zip) and delete it from
the app.

If you process other people's CVs, you are the controller of that data and this
software is one of your processing tools. What that requires of you — a lawful
basis, retention limits, answering access and erasure requests — is your
responsibility, not the software's. §3 and §4 exist to make those requests
answerable.

## 6. Questions and reports

Privacy questions: https://cartavio.no. Security issues: see
[SECURITY.md](./SECURITY.md).

*Last reviewed: 2026-08-11.*
