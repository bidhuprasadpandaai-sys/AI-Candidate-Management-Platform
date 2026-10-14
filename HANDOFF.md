# HANDOFF

Pick-up-cold status for the AI Candidate Management Platform. Update at every phase close and on significant decisions.

## Status

- **Current phase:** Phase 1 (not formally started)
- **Branch:** `feature/candidate-management-setup`
- **Open bugs:** 0 (BUG-001 and BUG-002 fixed; see `docs/BUGS.md`)
- **Open security findings:** 1 (SEC-008 Medium, mitigated: HTTP LLM host); SEC-007 `braces` Accepted; SEC-001 to SEC-006 and SEC-009 fixed (see `docs/SECURITY.md`)

## Phases

| Phase | Scope | Status | QA | Product | Architecture | Review | Security |
|-------|-------|--------|----|---------|--------------|--------|----------|
| 1 | Baseline: auth, candidates, assistant, security, tests, specs | Complete (PR not yet opened) | - | - | - | - | Re-run: pass, no open findings (see `docs/SECURITY.md`) |

## Build / run / test

| Action | Command |
|--------|---------|
| Install | `yarn install` |
| Run (web + api) | `yarn dev` (web `http://localhost:4410`, API `http://localhost:4310/api`) |
| Build | `yarn build` |
| Seed MongoDB | `yarn seed` |
| Test | `yarn test` (45 API tests incl. end-to-end, 16 web component tests); `yarn test:e2e` (6 Playwright UI tests, system Chrome, ports 4311/4411) |

Env: one shared repo-root `.env` (copy `.env.example`) feeds the API and, for `VITE_*` only, the web app; AI keys are server-side only. `JWT_SECRET` (32+ chars) is now required (tokens last 8h by default, `JWT_EXPIRES_SECONDS` to change; in production set `NODE_ENV=production` and `CLIENT_URL`); the API exits at startup without it. Copy `apps/api/.env.example` and `apps/web/.env.example` to `.env`. API uses an in-memory fallback if MongoDB is not configured.

## Git workflow

- Branch: `<JIRA-KEY>-<short-kebab-description>`; JIRA key _TBD_; base branch `main` (confirm).
- Ticket number in commits and PR titles. Commit/push/PR only when asked.

## Decisions

| Date | Decision |
|------|----------|
| 2026-10-15 | `docs/Roadmap.md` drafted: 7 phases plus AI efficiency principles |
| 2026-10-15 | Email via SMTP (`nodemailer`, free providers supported); reset flow tested end to end | 
| 2026-10-15 | Brevo transactional API provider and `yarn email:test` added (uncommitted until push audit) |
| 2026-10-15 | Candidate input validation (BUG-002) and safe email logging (SEC-009) |
| 2026-10-15 | Added Vitest web tests, API end-to-end tests and Playwright UI end-to-end tests; Functional, Architecture and Design specs filled in from the code; BUG-002 and SEC-009 logged |
| 2026-10-15 | Free-form assistant questions now answered by the Ollama model (`nemotron-3-nano:4b`) via `services/llm.js`, rules fallback; data-changing commands stay rule-based; `yarn test` added |
| 2026-10-15 | Shared root `.env` (+ `.env.example`) with AI provider settings; loaded first by the API, `VITE_*`-only for the browser |
| 2026-10-15 | Tokens shortened to 8h, CORS dev origins limited to non-production, `.vibecheck/` runtime data untracked and git-ignored |
| 2026-10-15 | `helmet` and rate limiting added to the API; SEC-007 (`braces`, dev-only) accepted as known risk |
| 2026-10-15 | Dependencies upgraded within current majors (express 4, mongoose 8, vite 6, vue 3); `shell-quote` pinned via root `resolutions` |
| 2026-10-15 | All `/api` routes except health, modules and auth now require a signed-in user; JWT secret has no fallback |
| 2026-10-14 | Project rules recorded in `CLAUDE.md`; spec docs and bug log created as skeletons |

## Risks

- Rate limits are per IP; set `trust proxy` before deploying behind a reverse proxy.
- Test gaps: SignUp/ResetPassword views, candidate table and sidebar, chat module, analytics, MongoDB mode; `api`, `shared` and `chat` builds are placeholder checks.
- LLM host is plain HTTP (SEC-008).
- Emails are delivered only after you set `EMAIL_PROVIDER=smtp` (SMTP login and key) or `EMAIL_PROVIDER=brevo` (`BREVO_API_KEY`) plus `EMAIL_FROM` (a verified Brevo sender) in the root `.env`; until then they are not sent.
- `README.md` ports (3000/5173) differ from real dev ports (4310/4410).
- JIRA key and base branch unconfirmed.

## Next steps

Plan for the next phases: `docs/Roadmap.md` (7 phases, AI efficiency principles, open decisions). Answer its section 5 questions to start Phase 2.

0. Check git history for past secrets (not yet done); review staged `.vibecheck/` untracking before committing.
1. Confirm JIRA key and base branch; update `CLAUDE.md` Project settings.
2. Define Phase 1 scope (spec docs are now filled in from the code; review them with the product owner).
3. Extend tests to the remaining gaps above; create a free email provider account (Brevo or Resend), verify a sender domain, and put the SMTP settings in `.env`.

## Change log

| Date | Change |
|------|--------|
| 2026-10-14 | Created |
