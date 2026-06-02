---
name: security-review
description: Pre-commit security check for Resume Studio. Use before committing code that touches HTML/string templating, the Express server, auth, persistence (SQLite/localStorage/sessionStorage), file imports (CVpartner/backup JSON), or exports (PDF/DOCX). Also use when the user asks "is this safe?", "review for security", or "audit this change". Encodes this codebase's trust boundaries and the patterns that have produced real vulnerabilities here.
---

# Resume Studio — security review

Read this before reviewing or writing code that touches any of the surfaces below. It encodes what the codebase actually looks like — not generic web-security advice. Skip the parts that don't apply to the diff.

## 1. The trust model in one paragraph

One consultant, one deployment. The Express server is the source of truth; the SPA is its only client. Auth is a single bearer token (`RESUME_API_TOKEN`) carried in `Authorization: Bearer` headers, stored client-side in **`sessionStorage`** (`src/lib/api.ts`). Any JavaScript that runs in the app's origin can read that token and call `/api/resume` as the user. The DB is a single-row SQLite table (`server/db.ts`, `CHECK (id = 1)`). The resume is also cached unencrypted in **`localStorage`** (`src/lib/localCache.ts`). The "untrusted input" surface is: imported CVpartner JSON, imported backup JSON, anything stored in the resume after import (because it'll be re-rendered by the export pipeline), and any HTTP request body.

**Implication:** **XSS = total compromise.** The token leaves with the attacker, and so does the entire resume. Every finding below traces back to this fact.

## 2. The patterns that have produced real bugs here

### 2.1 String-built HTML (CRITICAL — has bitten us)

`src/lib/viewFilter.ts → buildViewHtml` concatenates user fields into an HTML document that gets rendered into a same-origin iframe (`srcDoc={previewHtml}`) and a same-origin popup (`win.document.write(html)`). Before commit `d6d7c25` everything was interpolated raw.

**Grep for any new template-string HTML:**
```
Grep: \$\{[a-zA-Z_]   in *.ts/*.tsx, paths matching lib/, exporter, viewFilter, render
```
Every `${...}` inside a `` ` `` containing `<` must call `escapeHtml(...)` from `viewFilter.ts`. The only exceptions are values you've personally verified are hardcoded constants (e.g. `SECTIONS[i].label`) — and even those we escape defensively.

**Also check:** any new code that writes to a `Document` / `Window` we open:
- `iframe.srcDoc = ...`
- `win.document.write(...)`
- `el.innerHTML = ...`
- `dangerouslySetInnerHTML={{ __html: ... }}` (none currently — keep it that way)

If a new export format appears (HTML email, RTF, anything), apply the same `escapeHtml` discipline and add the same `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ...">` defence-in-depth meta from `buildViewHtml`.

### 2.2 The `LocalizedString` rendering pipeline

`resolve(value, locale)` returns a raw string. **It does not escape.** Anywhere it's used to build HTML, the result must be escaped. React JSX is safe (`{resolve(...)}` auto-escapes), but string-built HTML is not.

Hot files: `viewFilter.ts`, `exporter.ts`. The DOCX `exporter.ts` is safe because the `docx` library's `TextRun` XML-escapes automatically — don't introduce a custom XML/HTML emitter without re-checking.

### 2.3 Server input handling

`server/index.ts`:
- Body limit is **2 MB** (was 50 MB — a memory-exhaustion amplifier). Don't raise it without a real reason; resumes are ~100 KB.
- Security headers middleware sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Don't remove these.
- `app.disable('x-powered-by')` — leave disabled.

`server/auth.ts`:
- Token compared with `crypto.timingSafeEqual`. Don't switch back to `===`/`!==`.
- All 401 paths return the same generic `{ error: 'Unauthorized' }`. Don't add granular messages — they leak parser state.
- Env vars are read **lazily** inside the middleware so tests can `vi.stubEnv`. Don't pull `process.env.RESUME_API_TOKEN` to module top-level.

`server/routes/resume.ts`:
- Any new route must be mounted under the `authMiddleware`-gated `/api/resume` prefix, **or** explicitly justified as public (like `/api/health`).
- Validate body shape at the boundary. `typeof body === 'object'` is the floor; better: a real schema (Zod) if you're adding non-trivial fields.

### 2.4 File imports (CVpartner JSON and backup JSON)

`src/lib/importer.ts` and `src/lib/backup.ts` accept untrusted JSON.

- Imported text becomes resume fields, which later flow into `buildViewHtml`. **Escaping in viewFilter is what protects you here**, not the importer. Don't move escaping into the importer — it would break editing.
- Prototype pollution surface is currently nil because `result[key] = stringValue` on a plain `{}` doesn't pollute (assigning a string to `__proto__` is a no-op). Don't change this: never use `Object.assign(target, untrustedJson)`, never use spread with a top-level untrusted object as a key source.
- `isBackupFormat` is lenient on purpose — `migrateBackup` is the gatekeeper. New format versions add a `migrateV{n-1}toV{n}` step and chain.

### 2.5 Token and cache handling

- `sessionStorage` holds the bearer token. JS-readable. Future XSS = stolen token. **The XSS escaping in viewFilter is the only thing standing between an imported file and full account takeover.** Treat every change to the export pipeline accordingly.
- `localStorage` cache (`resumestudio:store-cache:v1`) holds the full resume in plaintext. Persists across tabs. Cleared on successful server sync; **not cleared on auth failure** (open issue — see writeup).
- Don't move secrets into `localStorage`. Don't add new `sessionStorage` keys without thinking about their lifecycle.

### 2.6 `window.open` and printable popups

`ResumeViewsEditor.handleExport` opens a same-origin popup and writes HTML into it. Same XSS rules apply. The popup inherits the parent origin and can call `window.opener.sessionStorage` — `noopener` would block that but also break `win.print()` from the parent. The defence is escape + CSP `<meta>`, both of which are already in `buildViewHtml`.

## 3. Pre-commit checklist

Run through this for any diff that touches the surfaces in §2.

1. **Grep the diff** for HTML-building patterns. For each `${...}` inside a `<...>` template literal:
   - Is the value escaped via `escapeHtml`?
   - Or is it provably a hardcoded constant?
   - If neither: stop, fix, re-run.
2. **Grep the diff** for `innerHTML`, `srcDoc`, `document.write`, `dangerouslySetInnerHTML`. Any new occurrence needs a written justification.
3. **For new server routes**: confirm auth, body-size validation, and that any user data echoed in error messages is the kind we want echoed (no token fragments, no SQL).
4. **For new file imports**: trace what fields the imported value flows into. If any reach `buildViewHtml`/`renderItem`/`exporter.ts`, confirm the escape chain is intact.
5. **For new dependencies**: `npm audit` — moderate or higher in a prod dep is a stop. Dev deps (`vite`, `vitest`, `esbuild`, `tsx`) don't ship and are lower priority.
6. **Don't expose internal state on `window`**. No `window.useStore` or similar; XSS would read it.
7. **Run `npm test` and `npm run typecheck`**. The XSS regression tests (`tests/viewFilter.test.ts → HTML escaping (XSS)`) are the canary for this whole class.

## 4. Known residual risks (don't re-flag, do prioritize fixing)

These are documented findings from the security review on commit `d6d7c25`. Don't open new tickets for them; do close them when you can.

- **Token in `sessionStorage`** — migrate to HTTP-only cookie + login endpoint when feasible.
- **No rate limit on `/api/resume`** — add `express-rate-limit` with a tight 429 on the auth-failure path.
- **No CSP header on the SPA shell** — the print-popup CSP is per-document; the SPA itself has none. Add one to the Express static handler.
- **`localCache` not cleared on auth gate** — clear it in `submitToken` on `UnauthorizedError`.
- **DB file ACLs are OS-default** — chmod 0600/0700 after create.

## 5. What is *not* a security finding here

Pre-empt the usual noise:

- **CVpartner skill proficiency = 0 across the board.** Data quality, not a bug.
- **`alert()` for error UX.** UX issue, not XSS (alert renders text).
- **localStorage / sessionStorage in general.** They're load-bearing for offline-first; the fix is closing XSS, not removing storage.
- **`docx` library output.** It XML-escapes. The DOCX path is safe.
- **PDF export via `window.print()`.** Browser-driven; no PDF library means no PDF-engine CVE surface.
- **`uuid < 11.1.1` advisory.** Only the `buf` parameter path is affected; we don't use it.
- **`esbuild`/`vite` advisories.** Dev-only, don't ship.

## 6. Reference commit

`d6d7c25` — *Close stored-XSS in Resume View export and harden the server.* Read the diff and the body of the commit before reviewing anything in `viewFilter.ts`, `exporter.ts`, or the `server/` tree — it captures the exact patterns and the exact rationale, and the added tests in `tests/viewFilter.test.ts` are the regression net.
