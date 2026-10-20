# Security Log

Tracks security findings and vulnerabilities, and the Security gate results. Log a finding as soon as it is found; never put secret values in this file (reference file and line only).
Severity: Critical / High / Medium / Low. Status flow: **Open → Fixed → Verified**, or **Accepted risk** (needs a reason and the user's sign-off).

## Findings

| ID | Title | Severity | Status | Phase found | Location | Impact | Fix notes |
|----|-------|----------|--------|-------------|----------|--------|-----------|
| SEC-001 | JWT signing secret has a hardcoded fallback when `JWT_SECRET` is unset | High | Fixed | Baseline | `apps/api/src/utils/jwt.js:3` | Anyone with repo access can forge valid tokens on any deployment missing the env var | Fixed 2026-10-15: secret read lazily from env (not at import, since dotenv loads after imports), min 32 chars, API exits at startup if missing; placeholder added to `apps/api/.env.example`. Verified: startup fails with empty secret |
| SEC-002 | Candidate, conversation and message routes mount no auth middleware | High | Fixed | Baseline | `apps/api/src/index.js` (only `/api/auth` is mounted as a router; no token check on other routes) | Candidate PII readable and writable without signing in | Fixed 2026-10-15: `middleware/requireAuth.js` applied to all `/api` routes after `/api`, `/api/health`, `/api/modules` and `/api/auth`; `/api/seed` also disabled when `NODE_ENV=production`; web and chat clients now send cookies. Verified: 401 without or with a forged token on GET/POST/PUT/DELETE routes, 200 with a valid cookie |
| SEC-003 | No rate limiting or security headers on the API | Medium | Fixed | Baseline | `apps/api/src/index.js`, `apps/api/package.json` (no `helmet` or rate limiter) | Brute force on sign-in and reset; missing hardening headers | Fixed 2026-10-15: `helmet` (default headers, no `X-Powered-By`) and `express-rate-limit` in `apps/api/src/index.js`: 600 requests per 15 min per IP on `/api`, 20 per 15 min on signup, signin, request-reset, reset, reset-password and change-password. Verified: security headers present, CORS with credentials unchanged, 21st bad sign-in returned 429, `/auth/me` unaffected. Note: behind a reverse proxy set `app.set("trust proxy", ...)` or all clients share one IP |
| SEC-004 | Tooling data tracked in git: `.vibecheck/provenance/attestations.db`, `.vibecheck/isl-studio/audit.jsonl`, `.vibecheck/sync-queue.json` | Low | Fixed | Baseline | `.vibecheck/` | Binary and audit logs may contain prompts or paths; hard to review | Fixed 2026-10-15: contents inspected (audit log and sync queue empty, database holds one config path, no secrets); the three runtime files untracked with `git rm --cached` (staged, not committed) and `.vibecheck/provenance/`, `.vibecheck/isl-studio/`, `.vibecheck/sync-queue.json` added to `.gitignore`. Files remain on disk. `.vibecheck/flow/config.json` stays tracked (project config; contains a user name only) |
| SEC-005 | Vulnerable dependencies (`yarn npm audit --all --recursive`): 2 Critical, many High, plus Moderate/Low at baseline | Critical | Fixed (1 residual, see SEC-007) | Security gate re-run 2026-10-15 | `apps/api/package.json`, `apps/web/package.json`, root `package.json`, `yarn.lock` | Known advisories in direct and transitive deps | Fixed 2026-10-15: `axios` ^1.20.0, `vite` ^6.4.4, `vue` ^3.5.44, `mongoose` ^8.24.1, `express` ^4.22.3; transitives bumped within range (`proxy-addr`, `body-parser`, `qs`, `postcss`, `nanoid`, `brace-expansion`, `form-data`, etc.); root `resolutions` pins `shell-quote` ^1.12.0. Verified: audit shows only SEC-007; `yarn build` passes; authenticated and unauthenticated API smoke test unchanged |
| SEC-007 | `braces` 3.0.3 stack-exhaustion DoS (advisory `<=3.0.3`); 3.0.3 is the latest release, no patched version exists | High | Accepted | Security gate re-run 2026-10-15 | `yarn.lock` via `nodemon` → `chokidar@3.6.0` | Dev-only file watcher; only processes the developer's own glob patterns, not user input; not in the production runtime | Wait for upstream fix or a `chokidar` 4 / `nodemon` release; Accepted by the user 2026-10-15; revisit when `nodemon`/`chokidar` ship a release without `braces` <=3.0.3 |
| SEC-008 | LLM host `rancherdevin.workingllama.com` is reached over plain HTTP with no auth (HTTPS returned nothing) | Medium | Open (mitigated) | 2026-10-15 | `.env` (`OLLAMA_HOST`), `apps/api/src/services/llm.js` | Prompts, including candidate names, roles, skills and scores, cross the network unencrypted and unauthenticated | Mitigated: only a contact-free subset is sent (no email, phone, notes, ids); LLM only answers free-form questions and cannot change data; failures fall back to rules. Remaining: ask the host owner for HTTPS (and a key), then set `OLLAMA_HOST` to the https URL. Accept the risk only for non-production demo data |
| SEC-009 | Placeholder email sender prints full message bodies, including verification and password-reset links/tokens, to the API console | Low | Fixed | Phase 1 (docs pass) | `apps/api/src/utils/email.js` | Anyone with log access can take over an account via a reset link | Fixed 2026-10-15: `utils/email.js` now logs only a masked recipient and the subject, never the body or links; full bodies print only when `EMAIL_DEBUG_LOG=true` and `NODE_ENV` is not production. Verified by 3 unit tests. Residual closed 2026-10-15: SMTP delivery added (see Standing policy: email credentials) |
| SEC-010 | Open self-registration: anyone who can reach the sign-up page can create an account | Low | Open (mitigated) | Phase 2 (RBAC) | `POST /api/auth/signup` | Strangers can create accounts, but new accounts are read-only (`DEFAULT_ROLE=viewer`) and see no candidates unless an admin adds them to a team. Account-enumeration via the 409 on duplicate sign-up remains | Add invite-only or allowed-domain sign-up, email verification (`REQUIRE_EMAIL_VERIFICATION=true`) and CAPTCHA before public use |
| SEC-011 | Candidate search text was used unescaped in a MongoDB regular expression | Medium | Fixed | Phase 2 (review) | `apps/api/src/index.js` `fetchCandidates` | Regex injection and ReDoS (a crafted search could hang the query) | Fixed 2026-10-15: input is escaped and capped at 100 characters; query values must be strings. Verified by the end-to-end suite |
| SEC-012 | Platform admins can see every company's candidate data (by design: admins are platform-level) | Low | Accepted by design | Phase 2 (tenancy) | `canViewCandidate` in `packages/shared/src/permissions.js` | A compromised or careless admin account exposes all companies | Keep admins few, require sign-in codes/MFA for admins (Phase 2), review the audit log; add per-company admins and "support access" consent if customers need it |
| SEC-013 | Uploaded resumes (personal data) are stored unencrypted on the API server's local disk | Medium | Open (mitigated) | Phase 3 (resumes) | `apps/api/src/services/fileStorage.js`, `RESUME_STORAGE_DIR` | Anyone with server or backup access can read resumes | Mitigated: random file names, owner-only permissions (0600/0700), outside the web root, git-ignored, downloads audited and company-scoped, raw text not stored, files deleted with the candidate. Remaining: encrypt at rest (disk or app-level) and use object storage with retention rules before real candidate data; covered by Phase 4 (GDPR) |
| SEC-014 | Untrusted PDF and DOCX files are parsed inside the API process | Medium | Open (mitigated) | Phase 3 (resumes) | `apps/api/src/services/resumeParser.js` | A crafted file could burn CPU or memory, or exploit a parser flaw | Mitigated: type from magic bytes, 5 MB cap, page cap (30), inflated-size cap for DOCX (20 MB, zip-bomb test), text cap, upload rate limit (30 per 15 minutes per IP), only recruiters and admins of a company can upload, no macros or external content are executed. Remaining: run parsing in a worker with a timeout and memory limit, add malware scanning, keep `unpdf`/`jszip` updated |
| SEC-006 | Auth-session hardening gaps: stateless 7-day JWT with no revocation, cookie `secure` only in production, `CORS` allowlist includes dev origins in every environment | Low | Fixed | Security gate re-run 2026-10-15 | `apps/api/src/utils/jwt.js`, `routes/auth.js`, `index.js` | Stolen token stays valid until expiry | Fixed 2026-10-15: token lifetime default 8h (`JWT_EXPIRES_SECONDS`, clamped 5 min to 24h) and cookie `Max-Age` matches; dev CORS origins only outside production, and production refuses to start without `CLIENT_URL`; `secure` cookie already enforced in production. Verified: sign-in cookie `Max-Age=28800`; production allows only `CLIENT_URL` origin; `/api/seed` disabled. Residual: tokens still cannot be revoked before expiry (mitigated by the short lifetime) |

## Standing policy: AI provider keys

AI keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_API_KEY`, `OLLAMA_CLOUD_API_KEY`, `COMPAT_KEYS`) live only in the git-ignored repo-root `.env`, are read by the API only, and never carry the `VITE_` prefix. Vite is configured with `envPrefix: "VITE_"`. Verified 2026-10-15: a canary key set in the build environment did not appear in the web bundle. The Security gate re-checks this (no `VITE_*KEY*` variables, no key names in `apps/web` or `packages/chat`, no keys in API responses).

## Standing policy: email credentials

`BREVO_API_KEY`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` live only in the git-ignored root `.env`, are read by the API only, and never carry the `VITE_` prefix. Message bodies (reset and verification links are credentials) and recipient addresses are never logged: logs hold a masked recipient and the subject only. The Brevo API provider only calls `https://api.brevo.com` (the URL override exists for tests) and sends the key in the `api-key` header, never in the URL or logs. Remote SMTP servers must upgrade to TLS (STARTTLS or port 465); only localhost may be plain. `sendEmail` never throws, so a delivery failure cannot reveal through a 500 whether an address has an account, and invalid recipients and newlines in subjects are rejected (header injection).

## Standing policy: access control and audit

- Every API route except health, modules and the auth endpoints runs `requireAuth`, which loads the user's **current** role, company and active flag on each request (a token never carries authority, so role changes and deactivation apply immediately).
- Routes declare a permission (`requirePermission`) and scope data to the user's **company** (admins see all companies; a user without a company sees nothing). A candidate or conversation in another company returns **404**, not 403, so its existence is not revealed.
- The AI assistant sees only the candidates the signed-in user can see and cannot run a command the user's role does not allow.
- The UI hides controls by the same shared rules (`packages/shared/src/permissions.js`), but only the API enforces them.
- New accounts are read-only; the first account and `ADMIN_EMAILS` become admin; at least one active admin must always exist.
- The audit log is append-only (no update or delete routes), admin-readable, and records field names, statuses and ids, never passwords, codes, tokens or message text. Failed password and code attempts are recorded with a masked address. Candidate names appear in summaries, so erasure rules (Phase 4) must cover the log.
- One-time sign-in codes: 6 digits from a CSPRNG, stored only as an HMAC, valid 10 minutes, single use, 5 wrong guesses burn the code, one email per minute per account, same response for unknown addresses.

## Standing policy: resumes and uploads

- Only recruiters and admins of a company can upload; the file type is decided from its bytes; the client's file name is a display label only (cleaned of paths and control characters); stored files get random names.
- Resumes and jobs belong to a company: other companies get 404. Downloads are `attachment`, with a fixed content type, `nosniff` and `no-store`, and are recorded in the audit log (`resume.downloaded`).
- The AI step sees only a redacted copy (no names, emails, phones, links or long numbers) and only for fields the rules could not find; its output is validated and ignored if malformed. Prompt-injection text in a resume cannot change data: the model has no tools and its output is limited to four validated fields.
- The extracted text is never stored or logged; audit entries carry file type, size and ids only, never names, contact details or file contents.
- Deleting a candidate deletes its resume file and record.
- Application endpoints follow candidate and job visibility (other companies get 404; moving, adding and removing need edit rights and are audited as `application.*`); the fit data (other companies get 404). Its optional AI wording receives only skill names, years, job title and the score, never a name, email or phone, and cannot change the score.

## Standing policy: job commercial data

Bill rates (what the client pays) are removed from every API response unless the caller can manage jobs (admins and recruiters), so hiring managers and read-only users never receive them. Rate values are not copied into the audit log (field names only). Currency and facility choices are validated against the job's own company, and another company's lists are never accepted.

## Standing policy: facilities

New facilities can be added by roles that manage jobs, but only to their own company (another company gets 404, hiring managers and read-only users 403). Text fields are length-limited and the pin code is pattern-checked; values are rendered as text only. The audit log records that facilities changed, not their contents.

## Standing policy: candidate documents

Documents are personal data. Uploads need `resume:upload` and edit rights on the candidate, go through a size-limited raw route (5 MB, rate limited), are typed from their bytes (no SVG, scripts or archives other than a real Word file), stored under random names outside the web root and returned only as attachments with `nosniff`. Other companies get 404 for the candidate, list and file. Titles and file names are never written to the audit log (category, type, size and ids only), and the files are deleted with the candidate. Open: stored files are not encrypted at rest (same as resumes, SEC-013).

## Standing policy: company logos and branding

Logos are accepted only from admins, through a size-limited raw upload (256 KB); the type is decided from the bytes (PNG, JPEG or WebP) and SVG is refused, so no script can ride in an image. Logos are stored as data URLs inside the company record and shown only through `<img>`. Website must be http or https; colours must be hex values, so nothing from branding is rendered as markup. The audit log records that branding changed, never the image.

## Baseline scan (2026-10-15)

- Tracked env files: only `apps/api/.env.example` and `apps/web/.env.example`. Real `.env` files are git-ignored.
- Pattern scan for connection strings with credentials, cloud/API keys, private keys and hardcoded secret assignments found no matches in tracked files (excluding `yarn.lock`). This is a pattern check, not a guarantee.
- Re-run 2026-10-15: leak patterns clean across tracked and untracked files; `yarn npm audit` found many advisories (SEC-005).
- Git history scan (2026-10-15): all 4 commits on all refs checked for credentialed connection strings, cloud/API/Slack/GitHub keys, private keys and hardcoded secret assignments: 0 matches. Sensitive-looking filenames ever committed: only the two `.env.example` files and `.vibecheck/provenance/attestations.db` (inspected, no secrets; now untracked, see SEC-004). No real `.env` was ever committed. Pattern-based, not a guarantee; no dedicated scanner (gitleaks, trufflehog) is installed.
- Not yet checked: contents of `playground-1.mongodb.js` beyond connection-string patterns (untracked).

## Gate runs

| Date | Phase | Result | Notes |
|------|-------|--------|-------|
| 2026-10-15 | Baseline | Fail | 2 High, 1 Medium, 1 Low open |
| 2026-10-15 | Re-run after LLM service added | Pass with note | Leak scan clean; no key names or `VITE_` secrets in web code; audit shows only SEC-007 (Accepted). Open: SEC-008 Medium (HTTP LLM host, mitigated) |
| 2026-10-15 | Re-run after candidate documents, resume-update prompt and overlay tabs | Pass | Leak scan clean; audit shows only SEC-007 (Accepted); documents verified for access (404 across companies, 403 for read-only), bytes-based types, attachment downloads, cleanup on delete, audit without titles; 178 API (10 new, also on MongoDB), 146 web, 16 UI tests. Open findings unchanged |
| 2026-10-15 | Re-run after UI redesign and company branding (logo upload) | Pass | Leak scan clean; audit shows only SEC-007 (Accepted); logo upload admin-only, bytes-checked, SVG refused, 256 KB limit; 168 API (7 new branding), 125 web, 14 UI tests. Open findings unchanged |
| 2026-10-15 | Re-run after job pay/bill rates, facilities, expiry and application limits | Pass | Leak scan clean; audit shows only SEC-007 (Accepted); 161 API tests (job-fields, jobs, rbac scenarios also on MongoDB), 113 web tests, 13 UI tests. Bill-rate privacy, per-company lists and the apply limits verified. Open findings unchanged |
| 2026-10-15 | Re-run after per-job applications and match scores | Pass | Leak scan clean; audit shows only SEC-007 (Accepted); 140 API tests (rbac, jobs, resume, application and migration scenarios also on MongoDB), 98 web tests, 12 UI tests. Application endpoints verified for company isolation, role limits and audit entries. Open findings unchanged |
| 2026-10-15 | Re-run after resume autofill in the Add Candidate popup, profile completion and job fit | Pass | Leak scan clean; audit shows only SEC-007 (Accepted); 138 API tests (jobs, resume and fit scenarios also on MongoDB), 93 web tests, 12 UI tests. Fit endpoint isolation and no-PII prompts verified. Open findings unchanged: SEC-008, SEC-013, SEC-014 (Medium, mitigated), SEC-010 (Low) |
| 2026-10-15 | Re-run after jobs, pipeline board and resume upload | Pass with notes | Leak scan clean (stored resumes are git-ignored); audit shows only SEC-007 (Accepted) after dropping `mammoth` (unfixed `sprintf-js` advisory); 117 API tests (jobs/resume scenarios also on MongoDB), 76 web tests, 12 UI tests. Upload hardening verified: magic-byte type check, 415/422/413 handling, zip-bomb refusal, random file names with 0600 permissions, per-company isolation of jobs and resumes, rate limit, audited downloads, no PII in prompts or audit log. New: SEC-013 Medium (unencrypted resumes at rest, mitigated), SEC-014 Medium (in-process parsing, mitigated). Open: SEC-008, SEC-013, SEC-014 (all Medium, mitigated), SEC-010 Low, BUG-003 Low |
| 2026-10-15 | Re-run after companies (multi-tenancy) replaced teams | Pass | Leak scan clean; audit shows only SEC-007 (Accepted); 78 API tests incl. 21 company-isolation/role/audit/OTP scenarios and a migration test (both also run against MongoDB), 47 web tests, 10 UI tests. Tenant isolation verified for lists, counts, analytics, search, chat, assistant, conversations, audit feed, assignment and seeding. Open: SEC-008 Medium, SEC-010 Low (mitigated), BUG-003 Low |
| 2026-10-15 | Re-run after roles, teams, OTP sign-in and audit log | Pass | Leak scan clean; no secrets or OTP internals in web code; audit shows only SEC-007 (Accepted); 75 API tests (21 role/ownership/audit/OTP scenarios, also run against MongoDB), 41 web tests and 9 UI tests. New: SEC-010 Low (open sign-up, mitigated), SEC-011 fixed. Open: SEC-008 Medium (HTTP LLM host, mitigated), BUG-003 Low |
| 2026-10-15 | Re-run after Brevo API provider added | Pass | Leak scan clean (no `xkeysib-`/`xsmtpsib-` keys); no Brevo or SMTP names in web code; audit shows only SEC-007 (Accepted); 45 API tests incl. fake Brevo API. Open: SEC-008 Medium (HTTP LLM host, mitigated) |
| 2026-10-15 | Re-run after SMTP email provider added | Pass | Leak scan clean (no provider keys or SMTP values tracked); no `VITE_` or SMTP names in web code; audit shows only SEC-007 (Accepted); reset flow tested end to end through a fake SMTP server. Open: SEC-008 Medium (HTTP LLM host, mitigated) |
| 2026-10-15 | Re-run after BUG-002 and SEC-009 fixes | Pass | Leak scan clean; audit shows only SEC-007 (Accepted); no secrets or reset links in logs; candidate input validated. Open: SEC-008 Medium (HTTP LLM host, mitigated) |
| 2026-10-15 | Git history scan | Pass | 4 commits, 0 secret-pattern matches, no real `.env` ever committed |
| 2026-10-15 | Re-run after SEC-004 and SEC-006 fixes | Pass | Leak scan clean; audit shows only SEC-007 (Accepted); no open findings other than the Accepted risk |
| 2026-10-15 | Re-run after SEC-003 fix, SEC-007 accepted | Pass | Leak scan clean; audit shows only SEC-007 (Accepted); no open Critical or High. Open: SEC-004 Low, SEC-006 Low |
| 2026-10-15 | Re-run after SEC-005 fixes | Fail | Leak scan clean. Audit: only SEC-007 (`braces`, dev-only, no patch exists) remains. Open: SEC-007 High, SEC-003 Medium, SEC-004 Low, SEC-006 Low. Passes if SEC-007 is accepted |
| 2026-10-15 | Re-run after SEC-001/002 fixes | Fail | Leak scan clean (tracked and untracked files). SEC-001, SEC-002 fixed and verified. Open: SEC-005 Critical (dependencies), SEC-003 Medium, SEC-004 Low, SEC-006 Low |

## Change log

| Date | Change |
|------|--------|
| 2026-10-15 | Created with baseline scan and SEC-001 to SEC-004 |
| 2026-10-15 | SEC-001 and SEC-002 fixed and verified; SEC-005, SEC-006 added |
| 2026-10-15 | SEC-005 fixed and verified; SEC-007 added |
| 2026-10-15 | SEC-007 Accepted; SEC-003 fixed and verified |
| 2026-10-15 | SEC-004 and SEC-006 fixed and verified |
| 2026-10-15 | Git history scan logged |
| 2026-10-15 | AI key policy added; shared root `.env` set up |
| 2026-10-15 | SEC-008 added (HTTP LLM host, mitigated) |
| 2026-10-15 | SEC-009 added (email placeholder logs reset links) |
| 2026-10-15 | SEC-009 fixed and verified |
| 2026-10-15 | SMTP email provider added; email credential policy |
| 2026-10-15 | Brevo API email provider added |
| 2026-10-15 | Access control and audit policy; SEC-010, SEC-011 |
| 2026-10-15 | Teams replaced by companies (tenant isolation); policy updated |
| 2026-10-15 | Resume uploads: policy, SEC-013, SEC-014 |
