---
name: security-review
description: Pre-commit security check for Resume Studio. Use before committing code that touches HTML/string templating or the export/preview render pipeline, the Express server, auth, persistence (SQLite/localStorage/sessionStorage), file imports (CVpartner/backup/snapshot JSON), exports (PDF/DOCX), the translation proxy, the desktop launcher, or settings. Also use when the user asks "is this safe?", "review for security", or "audit this change". Encodes this codebase's trust boundaries and the patterns that have produced real vulnerabilities here.
---

# Resume Studio — security review

Read this before reviewing or writing code that touches any surface below. It encodes what *this* codebase looks like, not generic web-security advice. Skip the parts the diff doesn't touch.

## 1. The trust model in one paragraph

One consultant, one deployment (a VPS instance OR a portable desktop build). The Express server is the source of truth; the SPA is its only client. Auth is a single token (`RESUME_API_TOKEN`); the browser exchanges it at `POST /api/auth/login` for an **HttpOnly, SameSite=Strict session cookie**, so the token is no longer in JS-readable storage (a bearer header still works for non-browser clients). Persistence is **multi-resume**: SQLite (`resumes` + `resume_snapshots`) on the server, with a per-resume **plaintext `localStorage`** outbound queue/cache (`src/lib/localCache.ts`, key `resumestudio:store-cache:v1:<id>`). The untrusted-input surface is: imported CVpartner JSON, imported **backup/snapshot JSON**, anything already stored in a resume or a **view config** (because the export/preview pipeline re-renders it as HTML), and any HTTP request body.

**Implication: XSS is still serious** — it can drive the API as the user (the cookie auto-authenticates same-origin requests) and read the full resume from `localStorage`. It can no longer exfiltrate the token itself. Treat the render pipeline (§2) as the primary battleground; almost every finding here traces back to it.

## 2. The render pipeline is the #1 XSS surface

The export/preview pipeline turns stored data into an HTML **string** that is rendered in a same-origin `<iframe srcdoc>` (live preview) and a same-origin `window.open` + `document.write` popup (PDF print). This is where real bugs have happened — twice.

The pipeline spans several `lib/` files; **all of them must stay safe**:

- `src/lib/viewFilter.ts` → `buildViewHtml` / `renderItem` — the document builder. Plain text fields go through `escapeHtml`; description-shaped fields go through `renderRichHtml`.
- `src/lib/richText.ts` → `sanitizeRich` / `renderRichHtml` — the rich-text allowlist (tags `p,br,strong,b,em,i,u,ul,ol,li`; **all attributes stripped**; `script/style/iframe/object/embed/form/svg` removed with subtree). `renderRichHtml(value, escapeHtml)` is the only sanctioned way to emit a description field: plain values are escaped, marked-up values are allowlist-sanitised.
- `src/lib/viewStyle.ts` → `deriveTokens` — maps the view's style choices to concrete CSS values that are interpolated into the document's `<style>` block.
- `src/lib/viewHeader.ts` → `withHeaderDefaults` / `withFooterDefaults` — header/footer config consumed by both render paths.
- `src/lib/exporter.ts` — the DOCX path (the `docx` lib XML-escapes `TextRun`s, so it's safe by construction — but don't hand-roll XML/HTML there).

### The two rules that keep it safe

1. **Every value interpolated into the HTML string is escaped or sanitised.** Text → `escapeHtml`. Description/rich → `renderRichHtml`. No exceptions, even for values you "know" are constants (escape them defensively — `s.label` etc. are escaped).

2. **Validate untrusted view config at the boundary, not at the interpolation site.** `accent_color`, fonts, placements, sizes, separators flow into `<style>` blocks, inline `style="…"` attributes, and `class="…"` attributes — contexts `escapeHtml` is *not* applied to. The editor UI validates these, but **the import path does not**, so a crafted backup/snapshot can carry anything. They are sanitised at the render boundary:
   - `deriveTokens` runs `accent_color` through `sanitizeHexColor` (→ 6 hex digits or the brand default) and every enum map lookup has a `?? default` fallback (so a bad value can't break out of `<style>` *and* can't crash the renderer with `undefined.foo`).
   - `withHeaderDefaults` / `withFooterDefaults` coerce `photo_placement` / `logo_placement` / `footer.separator` / `copyright` to their enums, font choices to the known set, and `size_pt` to a finite clamped number-or-null.
   - Images are gated by `isDataImage` (only `data:image/…`) and the `src` is escaped. Uploads are re-encoded through a canvas (`lib/image.ts`), which strips any embedded script; `imageInfoFromDataUrl` rejects SVG.

If you add a field to `ViewStyle` / `ViewHeaderConfig` / `ViewFooterConfig`, or a new interpolation into a `<style>`/`style=`/`class=`, **you must extend the matching boundary validator and add a breakout regression test.**

### Defence in depth (do not rely on these alone)

- `buildViewHtml` emits a strict `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; …">` in the generated document.
- `server/app.ts` sends a CSP + `nosniff`/`DENY`/`no-referrer`/`Permissions-Policy` on every response (the live preview iframe inherits it).

Both block script execution from an injection — but a `</style>` or attribute breakout is still a real bug. **Escaping/validation is the primary defence; CSP is the backstop.**

### Grep the diff

- `` \$\{ `` inside a `` ` `` template containing `<`, `style=`, or `class=` → is each value escaped / sanitised / from a sanitised token?
- `innerHTML`, `srcdoc`/`srcDoc`, `document.write`, `dangerouslySetInnerHTML` → any new occurrence needs written justification. (Today: none use `dangerouslySetInnerHTML`; keep it that way.)
- New `lib/viewStyle.ts` / `lib/viewHeader.ts` fields → boundary validator updated?

## 3. Server (`server/`)

The server is hardened in `server/app.ts` — keep it that way:
- **CSP + security headers** on every response; `x-powered-by` disabled; JSON body limit **2 MB** (don't raise without reason); **rate limiter** (`skipSuccessfulRequests` — counts ≥400s, so brute-forcing the token gets 429'd but auto-save doesn't). Runs before `authMiddleware`. New routers go under `/api/...` with `apiLimiter, authMiddleware`, or are explicitly justified as public (only `/api/health` is).
- **`auth.ts` / `routes/auth.ts`**: `crypto.timingSafeEqual` compare; single generic `{error:'Unauthorized'}` for all failures; token read lazily; accepts the HttpOnly cookie or a bearer header. `/api/auth/login` is rate-limited but NOT auth-gated (it's how you authenticate) — keep it that way, and never log the token or echo it (only the `Set-Cookie` carries it, HttpOnly).
- **`routes/resume.ts`** (multi-resume `/api/resumes`): validate body shape; `version` optimistic-concurrency (409 on stale `base_version`); errors must not leak SQL/internal detail. SQL is parameterised in `db.ts` — keep it parameterised (never string-build SQL).
- **`translate.ts`** (provider proxy): upstream URLs/keys stay server-side; errors **never echo upstream detail** (could leak an internal URL/key); timeout via `AbortSignal.timeout`; Google key is `encodeURIComponent`'d in the query. The upstream URL is operator-configured (env / desktop settings), not attacker-supplied per request.
- **`settings.ts`** (desktop-only; VPS reports `managed:false`, PUT 403s): API keys are **write-only over the API** — `toView()` returns `*_set` booleans, never the value. `settings.json` is written `0600`. Don't add a route or log line that echoes a key. PUT validates types + the provider enum.
- **`translateDocker.ts`**: shells out with `spawn` + **explicit argv** (never a shell string) and a fixed service name. No user input reaches the command line. Keep it that way — no `exec`, no template-string commands.
- **`routes/backup.ts`**: the backup dir comes from `RESUME_BACKUP_DIR` (operator env), never from the request body — the client can't choose a filesystem path. Don't add a body-supplied path.
- **Desktop launcher** (`server/desktop/launcher.ts`, `app.ts`, `db.ts`): must not use `import.meta`/`__dirname` (esbuild bundles to CJS and emits `""`). DB file + data dir are chmod'd `0600`/`0700` (best-effort, no-op on Windows).

## 4. File imports (CVpartner / backup / snapshot JSON)

`src/lib/importer.ts`, `src/lib/backup.ts`, and snapshot restore accept untrusted JSON.

- Imported text becomes resume fields and view config, which the render pipeline re-emits. **§2 is what protects you** — escaping/validation at render, not at import. Don't move escaping into the importer (it would break editing) and don't assume the importer cleaned anything.
- **No prototype pollution today**: importers assign string values onto fresh `{}`. Keep it that way — never `Object.assign(target, untrustedJson)`, never spread an untrusted object as a *key source* into a privileged object.
- `isBackupFormat` is deliberately lenient; `migrateBackup` is the gatekeeper (throws `UnsupportedBackupVersionError`). New format versions add a `migrateV{n-1}toV{n}` step.
- View config from a backup/snapshot is the sharpest edge — it reaches `<style>`/attribute contexts (§2 rule 2).

## 5. Token & cache handling

- The API token is **not** in JS-readable storage. The client POSTs it to
  `POST /api/auth/login` (`server/routes/auth.ts`), which sets an **HttpOnly,
  SameSite=Strict** session cookie; the auth middleware accepts that cookie or
  an `Authorization: Bearer` header (`server/auth.ts → presentedToken`). So an
  XSS bug can no longer read or exfiltrate the token. Keep it that way: don't
  reintroduce `sessionStorage`/`localStorage` token storage, don't drop
  `HttpOnly`/`SameSite=Strict`, and remember the cookie is the CSRF surface —
  `SameSite=Strict` is the defence (a same-origin SPA needs no token in headers).
- `localStorage` holds the full resume per-resume in plaintext as the offline outbound queue. A mid-session 401 clears the plaintext caches **only when nothing is unsynced** (so a wrong token doesn't destroy queued edits); the AuthGate "Clear local data" button calls `api.logout()` + `clearAllCaches()`. Don't move secrets into `localStorage`; don't add cache keys without thinking through their lifecycle (and the `beforeunload`/dirty-queue guards).

## 6. Pre-commit checklist

1. Grep the diff for the §2 patterns. Every `${…}` in HTML/`style=`/`class=` is escaped, sanitised, or a sanitised token.
2. New `ViewStyle`/`ViewHeaderConfig`/`ViewFooterConfig` field, or new style/class interpolation → boundary validator extended + breakout regression test added (`tests/viewFilter.test.ts` "HTML escaping (XSS)", `tests/viewStyle.test.ts`, `tests/viewHeader.test.ts`).
3. New server route → under `apiLimiter, authMiddleware`; body validated; no secret/SQL/upstream detail in errors or logs.
4. New file-import field → trace where it flows; if it reaches the render pipeline, confirm the escape/validate chain.
5. New dependency → `npm audit`; a moderate+ advisory in a **prod** dep is a stop (dev deps like vite/esbuild/vitest don't ship — lower priority).
6. Never expose store/state on `window`.
7. Run `npm run typecheck` + `npm test` + `npm run build`. The XSS/breakout suites are the canary for this whole class.

## 7. Known residual risks (don't re-flag — do prioritise fixing)

Closed: rate limiting, SPA-shell CSP, DB/settings file ACLs, clean-401 cache
clearing, the render-pipeline XSS class (§2), the **token→HttpOnly-cookie**
migration, the `/api/settings/translate/test` SSRF (pending overrides ignored
on non-desktop builds), and SVG data URLs (`isDataImage` is raster-only).
Remaining:

- **Session cookie carries the token value** (HttpOnly), not an opaque random
  session id backed by a server store. Deliberate for the single-tenant model —
  it keeps the desktop/no-restart story simple — but if a server-side session
  table ever appears, switch the cookie to an opaque id so the long-lived secret
  isn't in the cookie at all.
- **Schema validation at the import boundary** — imports are still `as`-cast, not validated. A Zod schema for `BackupV1`/CVpartner would give better errors and a firmer trust boundary (more robustness than security now that §2 holds).
- **CSRF depends on `SameSite=Strict`** alone (no token/anti-CSRF header, since the cookie auto-authenticates). Fine for a same-origin SPA; if a cross-origin client is ever added, add an `Origin`/`Sec-Fetch-Site` check on mutating routes.

## 8. What is *not* a finding here

- `localStorage`/`sessionStorage` existing — load-bearing for offline-first; the fix is closing XSS, not removing storage.
- `docx` output — it XML-escapes; the DOCX path is safe.
- PDF via `window.print()` — browser-driven; no PDF library = no PDF-engine CVE surface.
- `alert()` for error UX — renders text, not HTML.
- Operator-configured upstreams (LibreTranslate URL, backup dir, compose file) — these are the operator's own server, not remote-attacker input.
- `uuid < 11.1.1` advisory — only the `buf` parameter path; we call `uuidv4()` with no args. `esbuild`/`vite` advisories — dev-only, don't ship.

## 9. Reference commits

- `d6d7c25` — *Close stored-XSS in Resume View export and harden the server.* The original escape-at-render + CSP + server-hardening work; read it (and `tests/viewFilter.test.ts` "HTML escaping (XSS)") before touching `viewFilter.ts`/`exporter.ts`/`server/`.
- The `viewStyle.ts`/`viewHeader.ts` boundary validators (`sanitizeHexColor`, `safe*` coercers) — the second-round fix for CSS-injection / attribute breakout via crafted view config. The pattern to copy when adding view-config fields.
- The `routes/auth.ts` + `auth.ts` cookie-session work — token moved out of `sessionStorage` into an HttpOnly cookie; the `/api/settings/translate/test` SSRF gate; and `isDataImage` raster-only. See `tests/server/authRoutes.test.ts` and the `/translate/test` SSRF-guard test in `settingsRoutes.test.ts`.
