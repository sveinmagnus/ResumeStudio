---
name: security-review
description: Pre-commit security check for Resume Studio. Use before committing code that touches HTML/string templating or the export/preview render pipeline, the Express server, authentication, accounts/sessions/password reset, the authorization and per-user scoping layer, CSRF, outbound mail, persistence (SQLite/localStorage/sessionStorage), file imports (CVpartner/backup/snapshot JSON), exports (PDF/DOCX), the translation proxy, the desktop launcher, or settings. Also use when the user asks "is this safe?", "review for security", or "audit this change". Encodes this codebase's trust boundaries and the patterns that have produced real vulnerabilities here.
---

# Resume Studio — security review

Read this before reviewing or writing code that touches any surface below. It encodes what *this* codebase looks like, not generic web-security advice. Skip the parts the diff doesn't touch.

## 1. The trust model in one paragraph

One deployment (a VPS instance OR a portable desktop build), holding one person's CVs or a firm's. The Express server is the source of truth; the SPA is its only client. Persistence is **multi-resume**: SQLite (`resumes` + `resume_snapshots` + `users`/`sessions`/`grants`/`recovery_codes`, one connection) on the server, with a per-resume **plaintext `localStorage`** outbound queue/cache (`src/lib/localCache.ts`, key `resumestudio:store-cache:v1:<id>`). The untrusted-input surface is: imported CVpartner JSON, imported **backup/snapshot JSON**, anything already stored in a resume or a **view config** (because the export/preview pipeline re-renders it as HTML), and any HTTP request body.

**Auth has three modes**, derived from what exists rather than declared (`server/auth.ts → authMode()`): `accounts` (any user row exists — a session cookie, plus `RESUME_API_TOKEN` as an owner-equivalent *service* credential), `token` (no users, a token configured — the pre-accounts behaviour, and the only mode where `RESUME_API_TOKENS` still authenticates), and `open` (neither — dev and the desktop build, every request passes as an owner-equivalent viewer). A browser gets an **HttpOnly, SameSite=Strict cookie holding an opaque session id**; the table stores only its SHA-256.

**The threat model includes another user of the same instance**, not only a remote attacker. A `member` sees what it owns plus what is marked `visibility: 'instance'` (read only); an `owner` sees everything. A missing scope filter is therefore a silent cross-user disclosure, and §3's authorization pass is the checklist for it.

**Implication: XSS is still serious** — it can drive the API as the signed-in user (the cookie auto-authenticates same-origin requests, and the CSRF token is readable by our own page by design) and read the full resume from `localStorage`. It cannot exfiltrate a reusable credential: the cookie is HttpOnly and its value is a session id, not a token. Treat the render pipeline (§2) as the primary battleground; almost every finding here traces back to it.

## 2. The render pipeline is the #1 XSS surface

The export/preview pipeline turns stored data into an HTML **string** that is rendered in a same-origin `<iframe srcdoc>` (live preview) and a same-origin `window.open` + `document.write` popup (PDF print). This is where real bugs have happened — twice.

The pipeline spans several `lib/` files; **all of them must stay safe**:

- `src/lib/viewFilter.ts` → `buildViewHtml` / `renderItem` — the document builder. Plain text fields go through `escapeHtml`; description-shaped fields go through `renderRichHtml`.
- `src/lib/richText.ts` → `sanitizeRich` / `renderRichHtml` — the rich-text allowlist (tags `p,br,strong,b,em,i,u,ul,ol,li`; **all attributes stripped**; `script/style/iframe/object/embed/form/svg` removed with subtree). `renderRichHtml(value, escapeHtml)` is the only sanctioned way to emit a description field: plain values are escaped, marked-up values are allowlist-sanitised.
- `src/lib/viewStyle.ts` → `deriveTokens` — maps the view's style choices to concrete CSS values that are interpolated into the document's `<style>` block.
- `src/lib/viewHeader.ts` → `withHeaderDefaults` / `withFooterDefaults` — header/footer config consumed by both render paths.
- `src/lib/exporter.ts` — the DOCX path (the `docx` lib XML-escapes `TextRun`s, so it's safe by construction — but don't hand-roll XML/HTML there).
- `src/lib/exporterEuropass.ts` — the Europass XML path. Safe by construction the same way: it builds a **DOM tree and hands it to `XMLSerializer`**, so text/attribute escaping is structural, not per-`${}` discipline. The file's header says why in full — the one rule is **don't rewrite it into template-literal XML strings**, which would opt it back into the escape-every-value tax and let a `&`/`</` in a field corrupt or inject.
- `components/ui/RichField.tsx` — the **live editor** is a render boundary too: its `useLayoutEffect` assigns the stored value to `contentEditable.innerHTML`, and the store can be filled by an untrusted import, so that write goes through `sanitizeRich` (regression-tested). Any new `innerHTML`/DOM-write of stored rich text must do the same.

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
- **CSP + security headers** on every response; `x-powered-by` disabled; JSON body limit **2 MB** (don't raise without reason); **rate limiter** (`skipSuccessfulRequests` — counts ≥400s, so brute-forcing the token gets 429'd but auto-save doesn't). Runs before `authMiddleware`. New routers go under `/api/...` with `apiLimiter, authMiddleware`, or are explicitly justified as public (`/api/health`, `/api/auth`).
- **Cross-site guard** (CSRF brake, layer one): a global middleware 403s state-changing requests (non-GET/HEAD/OPTIONS) with `Sec-Fetch-Site: cross-site`. It is the whole defence on the desktop build — there the API runs auth-less on loopback, so a visited web page could otherwise fire a simple no-preflight POST (e.g. `/api/update/install`, `/api/backup/restore`). Same-origin SPA fetches and header-less non-browser clients are unaffected. Don't regress it; new mutating routes inherit it automatically.
- **`csrf.ts`** (CSRF brake, layer two — double-submit): the server sets a **readable** `rs_csrf` cookie, the client echoes it in `x-csrf-token`, and the two must match on any unsafe method **that carries the session cookie**. It exists because `SameSite` and `Sec-Fetch-Site` are both signals the *browser* volunteers, while a cross-origin page simply cannot read a cookie. Two invariants: the token is deliberately NOT HttpOnly and is not a credential (knowing it grants nothing without the session), and `EXEMPT` is matched as **exact paths, never prefixes** — a prefix match on `/api/auth` would silently exempt whatever gets added under it later. Only endpoints that establish or repair a credential (they carry their own proof: a password, a one-time code, a grant token) belong on that list.
- **`auth.ts`**: the three modes (§1), derived not declared. `crypto.timingSafeEqual` compare with no early return across every configured token; single generic `{error:'Unauthorized'}` for all failures; env read lazily. `presentedToken` reads the `Authorization` header only and **never falls back to the cookie** — treating a session id as a token would make a stolen session usable as a service credential; the one exception is `token` mode, which has no session table to key on. `resolveViewer` checks the session first so a service token cannot shadow a real user's identity on a request carrying both.
- **`accounts.ts` / `passwords.ts`**: every token handed out is high-entropy random and stored as **SHA-256** (sessions, grants, recovery codes) — right for random values, wrong for passwords, and the two must not be confused. Passwords are **async scrypt** with self-describing cost; verification uses the *stored* parameters, `decode` rejects parameters whose memory cost exceeds `MAXMEM` (a crafted hash would otherwise turn every login into a thrown error), and a malformed stored value is a failed verify, never a 500. `setPassword` and `setDisabled` delete the user's sessions **in the same transaction** — don't split them.
- **`routes/auth.ts` / `routes/users.ts`**: `/login` and the reset flows are rate-limited but NOT auth-gated (that is how you get in) — keep it that way. Login is **timing-equalised** (an unknown login still runs a scrypt verify against a dummy hash); `/forgot` returns an identical body in every case including "no such account". Bootstrap 404s once any user exists, and the legacy-token→account migration runs **inside** bootstrap, never at boot (creating users at boot would flip the mode to `accounts` while no account has a usable password, and bootstrap 404s in that mode — an instance locked out of itself). An invite's role comes from the **grant**, never the request body.
- **`mail.ts`**: header injection is the risk the module is shaped around. Every header-bound value is **rejected, not sanitised** — the `resumeId.ts` rule — and the control-character scan covers C0, DEL, the C1 block (U+0085 NEL breaks lines for some parsers) and U+2028/9. `buildMessage` returns **null** rather than a partially-cleaned message, and a null must never be sent. `sendmail` is `execFile` argv-only with the message on stdin; the SMTP client is hand-rolled and must keep dot-stuffing the body (a line of `.` otherwise ends DATA and leaves the rest to be read as commands). No CV content ever reaches this module, and no message names the account it is for.
- **`routes/resume.ts`** (multi-resume `/api/resumes`): every handler passes `viewerOf(res)` into the db layer and decides nothing itself; a row the viewer may not see answers **404, not 403**. Validate body shape; `version` optimistic-concurrency (409 on stale `base_version`); errors must not leak SQL/internal detail. SQL is parameterised in `db.ts` — keep it parameterised (never string-build SQL).
- **`routes/registry.ts` + `registryDb.ts`** (instance registry `/api/registry`, cross-resume registries): same rules as resume — auth-gated + rate-limited (`apiLimiter`, `authMiddleware`), body validated (`kind` enum, `isLocalized(name)`), optimistic `version` (409 on stale `base_version`), generic errors. **Deliberately NOT scoped per user**: it holds skill/role/industry *names*, and one shared vocabulary is the entire point of it. DELETE is the exception and is **owner-only** — it rewrites references across resumes the deleter may not be able to see, so its blast radius is not bounded by what they can read. A registry name is visible to everyone on the instance (PRIVACY.md says so, because a skill can be named after a client). SQL parameterised (named-param prepared statements in `registryDb.ts`); the dedup `key` is computed server-side (`server/skillKey.ts`, a guarded mirror of the client — `tests/server/skillKey.test.ts` cross-checks). `promoteFromResumes` is read-only w.r.t. resume data. The stored `extra` JSON is echoed back to the same authed user only (not a render surface — the client sanitises at render), so a crafted `extra` is a data-integrity concern, not XSS.
- **`translate.ts`** (provider proxy): upstream URLs/keys stay server-side; errors **never echo upstream detail** (could leak an internal URL/key); timeout via `AbortSignal.timeout`; the Google key AND the Azure locale codes are `encodeURIComponent`'d in the query (locale codes are request input validated only for length). The upstream URL is operator-configured (env / desktop settings), not attacker-supplied per request. Provider enums validate against the **exported canonical lists** (`TRANSLATE_PROVIDERS` / `LLM_PROVIDERS`) — an inline copy is how the `llm` provider shipped unsaveable.
- **`llm.ts` + `routes/llm.ts` + `routes/summarize.ts`** (the LLM proxy): same rules as translate — endpoint/key/model are server config, never request input; all `LlmError` messages are static strings (no upstream echo); `AbortSignal.timeout`. `/api/llm/complete` is a **general prompt proxy by design** (the prompt builders live in `src/lib/`, each caller has its own reply validator) — acceptable because it's behind the same auth as full CV read/write and can only choose the prompt, never the destination; it is NOT an open relay. Prompt and reply are capped, at two tiers: 60 k chars / 4096 tokens normally, 240 k / 16 k for an `advanced: true` request — which is **403'd unless the operator declared the model high-end** (`LLM_HIGH_END`), so the bigger budget and the whole-CV advisors can't be reached by an ordinary caller. `GET /api/llm/models` fetches from the **server's** configured Ollama URL only — accepting a client-supplied URL would be SSRF. All three routers mount with `apiLimiter` + `translateLimiter` (success-counting — LLM calls are billable) + `authMiddleware`.
- **`glossary.ts`** (C3 terminology pinning): the DeepL path uploads a glossary resource; the **Google v2 path builds HTML** — terms wrapped in `<span class="notranslate">`, everything `escapeHtml`'d, sent as `format=html`, then unwrapped. Two rules there: the term is `escapeRe`'d before it becomes a `RegExp` (a crafted registry name would otherwise be a regex), and **`unescapeHtml` must decode `&amp;` LAST**. Decoding it first makes the escape/unescape pair non-inverse, so text containing a literal entity double-decodes: `A &lt; B` came back `A < B`, and `&lt;script&gt;` came back as real `<script>` — inert text promoted to markup *inside* the store. Escape-at-render (§2) meant it was never XSS, but it corrupted content and ate defence in depth. Regression-tested with entity-bearing strings in `tests/server/glossary.test.ts` (the older raw-`<` round-trip case passes under either ordering, so it could not catch this).
- **`ollamaDocker.ts`**: like `translateDocker.ts` — `spawn` with explicit argv, fixed compose service/container names, and the one non-fixed value (the model tag for `ollama pull`) is charset-validated (`isValidModelName`) before it reaches a command line. Never throws into the request path.
- **AI assist client honesty** (`src/lib/llmAssist.ts` + `components/ui/AssistRun.tsx`): "nothing leaves this computer" is only said when the SERVER derived `local` from the endpoint host (`isLocalEndpoint` — fails closed: unparseable = remote); remote whole-CV sends confirm once per session, and the consent resets when settings change. Don't add an AI affordance that bypasses `AssistRun`, and don't soften the wording.
- **`settings.ts` / `routes/settings.ts`**: API keys and SMTP credentials are **write-only over the API** — `toView()` returns `*_set` booleans, never the value. `settings.json` is written `0600`. Don't add a route or log line that echoes a secret. PUT validates types + the provider enum. The write gate is two-tier: the desktop build owns the whole surface (`managed: true`), while on a server an **owner** may write only `OWNER_EDITABLE` (the mail fields, the app base URL, the local identity) and everyone else nothing. Ports, the local hostname and the sync folder stay env-managed on a server — letting a web request move them is how an instance talks itself off the network. Adding a key to `OWNER_EDITABLE` is a privilege decision, not a convenience one.
- **`translateDocker.ts`**: shells out with `spawn` + **explicit argv** (never a shell string) and a fixed service name. No user input reaches the command line. Keep it that way — no `exec`, no template-string commands.
- **`routes/backup.ts` + `backupFiles.ts` + `backupZip.ts`**: the backup dir comes from `RESUME_BACKUP_DIR` (operator env), never from the request body — the client can't choose a filesystem path. Don't add a body-supplied path. **Filenames are DERIVED, never taken from input**: `resumeFileName` builds `<slug>__<id>.json` from an ASCII-only slug, and `readBackupZip` reduces every zip entry to its basename and *never writes it to disk* (entries are parsed in memory), so an archive carrying `../../etc/passwd` has nowhere to go — keep it that way if the import ever starts writing files. **The `<id>` half is input too, and that is the half that bit**: an id arrives inside the file, `restoreResumes` stores it verbatim, and the next write pass joins the derived name onto the sync dir — so `x/../../../../tmp/pwn` escaped it, on every machine sharing the folder (the watcher merges, the scheduler republishes, no user action). Both readers now charset-check it against `server/resumeId.ts → isValidResumeId` (`isResumeEntry` for the per-resume files, `parseStoreBackup` for the legacy monolith) and `resumeFileName` throws as a second lock. **A new id-bearing inbound format must validate the id, and any new data-derived path must justify itself** — `writeJsonAtomic`'s `path.join` is the only one in `server/` that takes a name from data. Regression: `tests/server/backupFiles.test.ts` "resume id validation (path traversal)", which asserts on the FILESYSTEM (nothing above `dir`), not just on the throw. Registry entries ride in both `resume-studio-registry.json` and each resume file; `parseRegistryEntries` is lenient (drops malformed rows) and `db.mergeRegistry` unions by key + skips empty id/key rows, so a tampered/garbage registry can't corrupt the merge or delete anything. **`POST /import` is merge-only** — it can insert and update, never delete (erasure comes from tombstones, which only apply when the LOCAL row is older); don't add a `replace` mode to the upload path. Zip inflation is bounded on both ends: the route caps the request body (`express.raw` `64mb`) and `readBackupZip` rejects an entry by its declared `originalSize` **inside `unzipSync`'s filter, before inflating** — a cap applied after decompression would already have paid the cost it exists to avoid. These files are the operator's own synced data, not remote-attacker input, but the caps and derived names are what keep that assumption from being load-bearing.
- **Desktop launcher** (`server/desktop/launcher.ts`, `app.ts`, `db.ts`): must not use `import.meta`/`__dirname` (esbuild bundles to CJS and emits `""`). DB file + data dir are chmod'd `0600`/`0700` (best-effort, no-op on Windows).
- **Auto-updater** (`server/desktop/updater.ts` + `updateRuntime.ts`, `routes/update.ts`): downloads + extracts + swaps app files, so it's high-risk by nature. Invariants to preserve: every URL passes `isAllowedHost` (https + GitHub suffixes) on the API call, the asset, the checksum sidecar, and **each redirect hop** (`fetchFollowing` is the one place that follows redirects — don't hand-roll a second); the release **tag is charset-validated** (`/^[A-Za-z0-9][A-Za-z0-9.+-]*$/`) before it becomes a path segment / is embedded in the swap script; every download is **SHA-256-verified against its `.sha256` sidecar before `tar` sees it**, and staging **fails closed** (no sidecar / no entry / mismatch → `ChecksumError`, staging dir discarded); `installBlocker` is the single predicate deciding what's offerable, so the tray/status/install path can't disagree; `extractArchive` is argv-only `tar`; `buildSwapScript` uses OS-derived paths + a numeric pid + single-quote escaping (POSIX) — keep all interpolated values non-attacker-controlled; `/api/update` mutations are gated by `isUpdateSupported()` (403 on the VPS — a server must never rewrite its own files). Trust boundary = the configured GitHub repo over HTTPS (the digest doesn't change that — see §7). Keep `assetNameFor` **and `checksumNameFor`** in sync with the copies in `scripts/build-desktop.mjs`, and never drop the sidecar upload from `release.yml` — the field would stop updating.

### The authorization pass — run this whenever you touch `db.ts` or a route

The failure mode is silent: a query that forgot its viewer hands back somebody else's CV and nothing goes red. There is no exception thrown, no test that fails by accident, and the person harmed never finds out. So this is a checklist, not a judgement call.

1. **Every `ResumeDb` method takes a required `Viewer`.** That is the design: the compiler flags every call site that has not thought about scoping, the same trick as `mutate()` in the store and `lib/lookup.ts` for map reads — put the safe path where the unsafe one used to be so forgetting is a type error. A new method that reads or writes resume rows takes one too. Don't add an ambient/"current user" global, and don't add a default parameter — a default is how the requirement quietly stops being one. `SYSTEM_VIEWER` is the deliberate unscoped escape hatch and every current use is a **desktop-only path with no request behind it** (`backupScheduler`, `backupWatcher`, `desktop/launcher`) plus tests. A new `SYSTEM_VIEWER` on anything reachable from an HTTP request is the finding.
2. **The rule lives only in `server/access.ts`.** `canRead` / `canWrite` / `canReshare` / `readableWhere` / `writableWhere` are the whole model. A route or query that reimplements one — even correctly — is a second copy that will drift. If a new question needs answering ("may they see the snapshot list?"), add the predicate there and unit-test it in `tests/server/access.test.ts`.
3. **Not-visible answers as not-found, never 403.** A distinct refusal turns the API into an oracle for which ids exist, and "there is a CV here you may not read" is itself the disclosure. `saveResume` returns `not-found` for an unwritable row for exactly this reason. New routes follow it.
4. **Check the indirect readers, not just the obvious ones.** The leak is likelier in a route nobody thinks of as returning a resume: `storageStats` (names and byte counts), `listSnapshots` / `getSnapshot` (the CV as it was), `dumpResumes` (backup export), the aggregate/registry views. Each of those is scoped; anything new that derives from resume rows must be too.
5. **`owner_id IS NULL` is owner-visible, not everyone-visible.** Rows predating accounts have no owner. Bootstrap claims them, so it is a narrow window — but the default has to fail safe, and "unowned" must never read as "shared".
6. **Owner-only routes go through `requireOwner(res)`**, not a hand-rolled role check.
7. **The role is read from the user row on every request**, never carried in the session — which is why `setRole` does not delete sessions while `setPassword` and `setDisabled` do. If a session ever starts caching the role, a demotion stops taking effect and that omission becomes a bug.
8. **Extend `tests/server/scoping.test.ts`.** It is the route × role matrix over the real `createApp()` + supertest stack, and it carries the two negative controls a status-code assertion would miss: a hidden resume and a nonexistent one must return the **identical** status, and a refused write must leave the row, its `version` and its snapshot history untouched (a 404 that wrote first and refused after would otherwise pass).

## 4. File imports (CVpartner / backup / snapshot JSON)

`src/lib/importer.ts`, `src/lib/backup.ts`, and snapshot restore accept untrusted JSON.

- Imported text becomes resume fields and view config, which the render pipeline re-emits. **§2 is what protects you** — escaping/validation at render, not at import. Don't move escaping into the importer (it would break editing) and don't assume the importer cleaned anything.
- **No prototype pollution today**: importers assign string values onto fresh `{}`. Keep it that way — never `Object.assign(target, untrustedJson)`, never spread an untrusted object as a *key source* into a privileged object.
- `isBackupFormat` is deliberately lenient (it ROUTES — "backup, not CVpartner"); `validateBackup` is the strict GATE, run inside `importFromBackup` before a store is built: it confirms structural invariants (collections are arrays of id-bearing objects, profile is object-or-null) and throws `InvalidBackupError` with field paths. `migrateBackup` then handles version differences on the now-trusted shape (throws `UnsupportedBackupVersionError` for unknown versions). Both `validateBackup` (backup/snapshot JSON) and `validateAIImport`/`validateBulkImport` (AI paths) are hand-written issue-collecting validators — same idiom, **no schema library**; the validation is deliberately STRUCTURAL, not per-leaf, because §2 (escape-at-render) already covers malformed *strings* — the boundary's job is to reject a broken *shape* that would crash the store.
- View config from a backup/snapshot is the sharpest edge — it reaches `<style>`/attribute contexts (§2 rule 2). Note `validateBackup` checks shape, NOT `<style>`-safety — the render-boundary sanitisers (§2) remain the defence for view-config *values*.
- **Backup re-interning** (`lib/registryReintern.ts`, cross-resume registries): a backup carries `canonical_registry` snapshots + `canonical_id` links that name entries in the SOURCE instance's registry. On import, `reinternBackupLinks` re-maps them against THIS instance by `key` (reuse or create) and **clears any link whose snapshot is missing** — so a foreign/dangling `canonical_id` never survives into the store, and import can only ADD canonical entries (via the normal authed `POST /api/registry`), never adopt an attacker-chosen id. The pure `planReintern`/`remapCanonicalIds` are the trust logic; keep the "clear-when-unresolved" default.

## 5. Credential & cache handling

- **No credential is in JS-readable storage.** A password (accounts mode) or the
  token (token mode) is POSTed once to `POST /api/auth/login`
  (`server/routes/auth.ts`), which sets an **HttpOnly, SameSite=Strict** cookie;
  in accounts mode its value is an **opaque session id**, so even the cookie no
  longer holds a reusable secret. The auth middleware accepts that cookie or an
  `Authorization: Bearer` header for non-browser clients
  (`server/auth.ts → presentedToken`). Keep it that way: don't reintroduce
  `sessionStorage`/`localStorage` credential storage, don't drop
  `HttpOnly`/`SameSite=Strict`, and don't make the cookie readable as a token
  again.
- The **`rs_csrf` cookie is the deliberate exception** — readable, not a
  credential, and useless without the session cookie (§3). Don't "harden" it to
  HttpOnly; that breaks the mechanism.
- `localStorage` holds the full resume per-resume in plaintext as the offline outbound queue. A mid-session 401 clears the plaintext caches **only when nothing is unsynced** (so a wrong credential doesn't destroy queued edits); signing out goes through `components/ui/signOut.ts`, which warns about unsynced work and then calls `api.logout()` + `clearAllCaches()`. **That wipe is load-bearing on a shared machine** — a logout that leaves the cache behind hands the next person at the keyboard somebody else's resume. Don't move secrets into `localStorage`; don't add cache keys without thinking through their lifecycle (and the `beforeunload`/dirty-queue guards); don't add a sign-out path that skips `signOut()`.

## 6. Pre-commit checklist

1. Grep the diff for the §2 patterns. Every `${…}` in HTML/`style=`/`class=` is escaped, sanitised, or a sanitised token.
2. New `ViewStyle`/`ViewHeaderConfig`/`ViewFooterConfig` field, or new style/class interpolation → boundary validator extended + breakout regression test added (`tests/viewFilter.test.ts` "HTML escaping (XSS)", `tests/viewStyle.test.ts`, `tests/viewHeader.test.ts`).
3. New server route → under `apiLimiter, authMiddleware`; body validated; no secret/SQL/upstream detail in errors or logs. If it is public, it belongs on the short justified list — and if it also changes state, on `csrf.ts`'s `EXEMPT` list, which means it must carry its own proof.
4. Touched `db.ts` or a route that reads resume rows → run §3's **authorization pass** and extend `tests/server/scoping.test.ts`. A missing scope filter is the one bug class here that fails silently and harms somebody who will never know.
5. New value that reaches a mail header or an SMTP verb → rejected on the control-character scan, never stripped; add it to the injection table in `tests/server/mail.test.ts`.
6. New file-import field → trace where it flows; if it reaches the render pipeline, confirm the escape/validate chain.
7. New dependency → `npm audit`; a moderate+ advisory in a **prod** dep is a stop (dev deps like vite/esbuild/vitest don't ship — lower priority).
8. Never expose store/state on `window`.
9. Run `npm run typecheck` + `npm test` + `npm run build`. The XSS/breakout and scoping suites are the canary for this whole class.

## 7. Known residual risks (don't re-flag — do prioritise fixing)

**Accepted residuals from the multi-user review (August 2026):**

- **`POST /api/backup/import` counts tell you whether a resume id exists.** An
  unknown id inserts, a known-but-unwritable one skips, so the response
  distinguishes them — and probing an unknown id leaves a junk resume owned by
  the prober. Accepted because ids are UUIDv4: you must already know the id to
  ask. Closing it properly means refusing legitimate imports of new resumes,
  which is a worse trade. Do not re-add the claim that the skip hides existence;
  the skip is what creates the distinction.
- **`storageStats.db_bytes` reaches every member.** The per-resume rows are
  scoped; the database file size is not, so a member learns roughly how much CV
  data the instance holds. One unscoped number in an otherwise scoped payload.
- **`/forgot` does its lookup and grant insert before responding**, so a
  verified-email account costs one extra write. Below network noise and not
  measurable through supertest, but indistinguishability is that route's entire
  contract, so the work ideally moves behind the response.
- **`/accept` redeems the invitation before creating the account**, so a
  duplicate email hits the UNIQUE constraint, 500s, and burns the invite —
  contradicting the route's own comment. Two concurrent accepts claiming one
  username have the same shape (checked before the `hashPassword` yield). Both
  are low-impact versions of the bootstrap race, and both want the same
  treatment: validate, hash, then check-and-insert atomically.

Closed: rate limiting, SPA-shell CSP, DB/settings file ACLs, clean-401 cache
clearing, the render-pipeline XSS class (§2), the `/api/settings/translate/test`
+ `/summarize/test` SSRF (pending overrides ignored on non-desktop builds), SVG
data URLs (`isDataImage` is raster-only), the **cross-site CSRF brake**
(`Sec-Fetch-Site` guard in §3 — closes the auth-less desktop build's exposure),
and three spelled out below because the reasoning matters when the same
question comes round again:

- ~~**Schema validation at the import boundary**~~ — CLOSED (structural, hand-written). `validateBackup` gates `importFromBackup`; the AI/bulk paths already had `validateAIImport`/`validateBulkImport`; ImportScreen guards the CVpartner fall-through against non-objects. Validation is structural, not a full data-model schema (deliberate — §4). A deeper per-field schema remains possible but is low-value now that §2 holds and the shape is gated.
- ~~**Session cookie carries the token value**~~ — CLOSED. The cookie is an
  opaque `randomBytes(32)` session id and the `sessions` table stores only its
  SHA-256, so no long-lived secret is in the cookie and a leaked database yields
  no live session. This also bought real revocation, which an env-var token
  never had: logout, a password change or reset, and account-disable all delete
  sessions. `token` mode still puts the token in the cookie — there is no
  session table to key on there — which is one more reason it is a transitional
  mode rather than a supported end state.
- ~~**No anti-CSRF token**~~ — CLOSED. `csrf.ts` adds the double-submit token
  (§3) on top of `SameSite=Strict` and the `Sec-Fetch-Site` guard. It is the
  layer that does not depend on a signal the browser volunteers, which is what
  the old entry asked for. The auth-less desktop build is still covered by the
  cross-site guard alone (no session cookie ⇒ nothing to double-submit); that
  remains acceptable for the same bounded-impact reason as before.

Remaining:

- **`POST /api/users/forgot` is effectively unthrottled.** It sits behind
  `apiLimiter`, which sets `skipSuccessfulRequests` — and `/forgot` answers 200
  in every case, by design, so it never spends the budget. Bounded but real: an
  attacker who knows one confirmed address can pump reset mail at a third-party
  mailbox and at the operator's relay reputation. The grant TTL and single-use
  redemption limit the credential exposure, not the volume. The fix is a
  success-counting limiter on that one route keyed by both IP and address, in
  the shape `translateLimiter` already has.
- **`needsRehash` is implemented but never called.** `passwords.ts` exports it
  and `passwords.test.ts` pins it, but no login path invokes it, so raising `N`
  upgrades new passwords only and every existing hash stays at the cost it was
  minted with — indefinitely, since nothing else rewrites it. The self-describing
  format means the fix is small and safe: after a successful `verifyPassword` in
  `routes/auth.ts`'s login handler, `if (needsRehash(user.pw_hash))` re-hash and
  store. Note it cannot go through `accounts.setPassword`, which deletes the
  user's sessions — including the one being created.
- **A member's `visibility: 'instance'` read is all-or-nothing.** Sharing a CV
  shares every field in it, including the ones the anonymisation controls exist
  to hide on export. There is no per-field or per-section share. Deliberate (a
  per-field ACL is a different product), but worth knowing before treating
  "share with the team" as a privacy control rather than a convenience.
- **No update *signature*** — downloads ARE now verified against a `<asset>.sha256` sidecar published in the release (`stageUpdate` → `fetchChecksum` + `sha256File`, fail-closed, `ChecksumError`; the digest comes from api.github.com while the blob comes from the CDN, so a tampered blob alone is caught). That does **not** make the release trustworthy: an attacker who can write to the repo/release replaces the sidecar alongside the asset. **The configured GitHub repo is still the trust boundary**, and `tar` still trusts the archive. Closing it needs a signature over the digest from a key GitHub doesn't hold (or Sigstore/artifact attestations); `stageUpdate`'s verification step is where that plugs in. Still "no code signing" for the binaries themselves.

## 8. What is *not* a finding here

- `localStorage`/`sessionStorage` existing — load-bearing for offline-first; the fix is closing XSS, not removing storage.
- `docx` output — it XML-escapes; the DOCX path is safe.
- pdfmake rendering local content — the PDF is built from the user's own (escaped/validated) view data and downloaded; there's no untrusted-PDF *parsing* surface. Track pdfmake advisories like any prod dep, but "app renders a PDF" is not itself a finding.
- `alert()` for error UX — renders text, not HTML.
- **The `owner` role reading every resume** — the documented model (PRIVACY.md §2), not a scoping failure. Same for the registry being instance-wide and readable by every member.
- **Recovery mode** (`scripts/recover.mjs`) minting a reset link with no credential — running it already requires the ability to execute a command on the machine holding `resume.db`, which is strictly more than it grants. Documented in SECURITY.md as out of scope.
- **`open` mode passing every request** — that is what makes the desktop build and local dev usable. In scope is bypassing a mode that is *active*.
- Operator-configured upstreams (LibreTranslate URL, backup dir, compose file) — these are the operator's own server, not remote-attacker input.
- `uuid < 11.1.1` advisory — only the `buf` parameter path; we call `uuidv4()` with no args. `esbuild`/`vite` advisories — dev-only, don't ship.

## 9. Reference commits

- `d6d7c25` — *Close stored-XSS in Resume View export and harden the server.* The original escape-at-render + CSP + server-hardening work; read it (and `tests/viewFilter.test.ts` "HTML escaping (XSS)") before touching `viewFilter.ts`/`exporter.ts`/`server/`.
- The `viewStyle.ts`/`viewHeader.ts` boundary validators (`sanitizeHexColor`, `safe*` coercers) — the second-round fix for CSS-injection / attribute breakout via crafted view config. The pattern to copy when adding view-config fields.
- The `routes/auth.ts` + `auth.ts` cookie-session work — token moved out of `sessionStorage` into an HttpOnly cookie; the `/api/settings/translate/test` SSRF gate; and `isDataImage` raster-only. See `tests/server/authRoutes.test.ts` and the `/translate/test` SSRF-guard test in `settingsRoutes.test.ts`.
- The multi-user work (`server/accounts.ts`, `passwords.ts`, `access.ts`, `csrf.ts`, `mail.ts`, `bootstrap.ts`, `routes/users.ts`, and the `Viewer` parameter threaded through `db.ts`). Read `tests/server/scoping.test.ts` before touching any route that reads resume rows — it is the route × role matrix and states in its own header why a hidden resume must answer as a missing one. `access.test.ts` pins the rules, `mail.test.ts` the injection table, `csrf.test.ts` the double-submit, `passwords.test.ts` the hash format, `userRoutes.test.ts` the reset triggers and enumeration.
- The auto-updater (`server/desktop/updater.ts`, `updateRuntime.ts`, `routes/update.ts`) — host-allowlisted GitHub fetches, charset-validated release tags, argv-only `tar`, escaped swap script, `isUpdateSupported()` route gating. Tests: `tests/server/updater.test.ts` (incl. the malicious-tag case), `updateRuntime.test.ts` (swap script), `updateRoutes.test.ts`. The `Sec-Fetch-Site` cross-site guard + `tests/server/csrfGuard.test.ts` landed alongside it.
