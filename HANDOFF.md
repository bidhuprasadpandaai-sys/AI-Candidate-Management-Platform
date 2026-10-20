# HANDOFF

Pick-up-cold status for the AI Candidate Management Platform. Update at every phase close and on significant decisions.

## Status

- **Current phase:** Phase 1 (not formally started)
- **Branch:** `feature/candidate-management-setup`
- **Open bugs:** 1 (BUG-003 hiring managers can replace notes as a whole array; see `docs/BUGS.md`)
- **Open security findings:** SEC-008, SEC-013, SEC-014 (Medium, mitigated), SEC-010 (Low, mitigated); SEC-012 Accepted by design; SEC-007 `braces` Accepted (see `docs/SECURITY.md`)

## Phases

| Phase | Scope | Status | QA | Product | Architecture | Review | Security |
|-------|-------|--------|----|---------|--------------|--------|----------|
| 1 | Baseline: auth, candidates, assistant, security, tests, specs | Complete (PR not yet opened) |
| 2a | Foundations: roles, multi-company tenancy, email-code sign-in, audit log (plus email provider) | Built and tested; not yet pushed |
| 3 | Core recruiting: job openings, per-job pipeline board, resume upload and parsing | Built and tested; not yet pushed | - | - | - | - | Re-run: pass, no open findings (see `docs/SECURITY.md`) |

## Build / run / test

| Action | Command |
|--------|---------|
| Install | `yarn install` |
| Run (web + api) | `yarn dev` (web `http://localhost:4410`, API `http://localhost:4310/api`) |
| Build | `yarn build` |
| Seed MongoDB | `yarn seed` |
| Make someone admin | `yarn set-role you@example.com admin` (needs MongoDB; or add the email to `ADMIN_EMAILS` before they sign up) |
| Test | `yarn test` (181 API tests incl. end-to-end, resume parsing, fit scoring, applications and job fields, 152 web component tests); `yarn test:e2e` (16 Playwright UI tests, system Chrome, ports 4311/4411) |

Env: one shared repo-root `.env` (copy `.env.example`) feeds the API and, for `VITE_*` only, the web app; AI keys are server-side only. `JWT_SECRET` (32+ chars) is now required (tokens last 8h by default, `JWT_EXPIRES_SECONDS` to change; in production set `NODE_ENV=production` and `CLIENT_URL`); the API exits at startup without it. Copy `apps/api/.env.example` and `apps/web/.env.example` to `.env`. API uses an in-memory fallback if MongoDB is not configured.

## Git workflow

- Branch: `<JIRA-KEY>-<short-kebab-description>`; JIRA key _TBD_; base branch `main` (confirm).
- Ticket number in commits and PR titles. Commit/push/PR only when asked.

## Decisions

| Date | Decision |
|------|----------|
| 2026-10-15 | Roles: Admin, Recruiter, Hiring manager, Read-only. New sign-ups are read-only; the first account and `ADMIN_EMAILS` are admins. Accounts that existed before roles keep recruiter access. `bidhuprasadpanda.ai@gmail.com` was promoted to admin with `yarn set-role` |
| 2026-10-15 | Job dialog redesigned into cards; facilities now have name, location, address and pin code, belong to one company, can be searched in settings and added from the job form |
| 2026-10-15 | Candidate documents with expiry (Documents tab), resume attach no longer changes the profile unless the user ticks fields (name/email never offered), resumes of existing candidates do not autofill Add Candidate, overlay split into 5 tabs |
| 2026-10-15 | UI redesigned (dark sidebar, tokens, brand-driven colours) and white-label branding added: per-company name, tagline, logo, colours and details (Admin → Companies → Branding, `GET /branding`); style rules in `docs/UIStyleGuide.md`. Central code: `apps/web/src/config/brand.js`, `stores/branding.js`, `apps/api/src/services/branding.js` |
| 2026-10-15 | Job form: employment type, facility and currency from per-company lists (admin: Companies → Settings), pay and bill rate ranges (bill rates visible to job managers only), expiry date, maximum applications; expired, full, draft, on-hold and closed jobs take no applications. Rates are per hour by default with a unit selector |
| 2026-10-15 | Match score is per job: candidates apply to several jobs (applications with their own stage and fit score); the manual Match Score field is removed; the candidate's status and score are derived (furthest stage, best fit); one Add job button; the single-job link was migrated to applications at startup |
| 2026-10-15 | Resume upload moved into the Add Candidate popup (autofill); "Add job" button; profile completion (9 weighted items) on cards, rows and panel; job fit score (skills 45, experience 25, role 15, location 5, profile 10) from profile + resume + job description, explainable, no stored score |
| 2026-10-15 | Jobs, pipeline board and resumes: jobs belong to a company; the board is a view over candidate status (drag = status update); resumes are PDF/DOCX up to 5 MB, read by rules first with AI only for gaps on redacted text, stored on local disk under random names, deleted with the candidate. Node only (no Python parsing service); no OCR |
| 2026-10-15 | Tenancy: companies replace teams. Each Recruiter, Hiring manager and Read-only user belongs to one company and sees only its candidates; admins are platform-level and manage all companies, users and roles (no per-company admin). Other companies' data returns 404 |
| 2026-10-15 | Email-code sign-in added next to password sign-in; audit log is append-only and admin-readable |
| 2026-10-15 | `docs/Roadmap.md` drafted: 7 phases plus AI efficiency principles |
| 2026-10-15 | Email via SMTP (`nodemailer`, free providers supported); reset flow tested end to end | 
| 2026-10-15 | Job fields, company currency/facility lists and application limits added; 161 API, 113 web and 13 UI tests |
| 2026-10-15 | Per-job applications and match scores added (board cards, Match column, Jobs and fit panel); 140 API, 98 web and 12 UI tests |
| 2026-10-15 | Job openings, per-job pipeline board and resume upload/parsing built (API, Jobs module, upload dialog, candidate panel); 117 API, 76 web and 12 UI tests; jobs/resume scenarios also verified on MongoDB; BUG-004/005 fixed; SEC-013/014 logged |
| 2026-10-15 | Roles, multi-company tenancy, email-code sign-in and audit log built (API, Admin module, sign-in tab, ownership panel); 78 API, 47 web and 10 UI tests; MongoDB-mode scenarios and migration verified |
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

- Resume files hold personal data on local disk, unencrypted (SEC-013) and are parsed inside the API process (SEC-014): fine for pilots with consent, not for production scale. Back up `apps/api/storage/` with the database; it is git-ignored.
- Existing data: accounts without a role act as recruiters; candidates and users without a company are invisible to non-admins until an admin assigns them (Admin → Companies → "Move unassigned here", Users → Company). The earlier Teams feature was migrated into companies at startup.
- Rate limits are per IP; set `trust proxy` before deploying behind a reverse proxy.
- Test gaps: SignUp/ResetPassword views, candidate table and sidebar, chat module, analytics, MongoDB mode; `api`, `shared` and `chat` builds are placeholder checks.
- LLM host is plain HTTP (SEC-008).
- Emails are delivered only after you set `EMAIL_PROVIDER=smtp` (SMTP login and key) or `EMAIL_PROVIDER=brevo` (`BREVO_API_KEY`) plus `EMAIL_FROM` (a verified Brevo sender) in the root `.env`; until then they are not sent.
- `README.md` ports (3000/5173) differ from real dev ports (4310/4410).
- JIRA key and base branch unconfirmed.

## Next steps

Plan for the next phases: `docs/Roadmap.md` (7 phases, AI efficiency principles, open decisions). Answer its section 5 questions to start Phase 2.

0. Review and push the roles, companies, OTP, audit, jobs, board and resume work (push audit first); then Phase 2 remainder: CI pipeline, AI gateway, invite-only sign-up (SEC-010), append-only notes (BUG-003).
1. Confirm JIRA key and base branch; update `CLAUDE.md` Project settings.
2. Define Phase 1 scope (spec docs are now filled in from the code; review them with the product owner).
3. Extend tests to the remaining gaps above; create a free email provider account (Brevo or Resend), verify a sender domain, and put the SMTP settings in `.env`.

## Change log

| Date | Change |
|------|--------|
| 2026-10-14 | Created |
