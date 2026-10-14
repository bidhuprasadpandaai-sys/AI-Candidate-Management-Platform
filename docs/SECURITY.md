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
| SEC-006 | Auth-session hardening gaps: stateless 7-day JWT with no revocation, cookie `secure` only in production, `CORS` allowlist includes dev origins in every environment | Low | Fixed | Security gate re-run 2026-10-15 | `apps/api/src/utils/jwt.js`, `routes/auth.js`, `index.js` | Stolen token stays valid until expiry | Fixed 2026-10-15: token lifetime default 8h (`JWT_EXPIRES_SECONDS`, clamped 5 min to 24h) and cookie `Max-Age` matches; dev CORS origins only outside production, and production refuses to start without `CLIENT_URL`; `secure` cookie already enforced in production. Verified: sign-in cookie `Max-Age=28800`; production allows only `CLIENT_URL` origin; `/api/seed` disabled. Residual: tokens still cannot be revoked before expiry (mitigated by the short lifetime) |

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
