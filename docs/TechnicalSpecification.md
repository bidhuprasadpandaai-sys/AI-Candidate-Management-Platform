# Technical Specification

## 1. Stack

- Frontend: Vue 3, Vite, Pinia, PrimeVue 3, vue-router, axios
- Backend: Node.js, Express 4, Mongoose 8 (MongoDB, in-memory fallback)
- Package manager: Yarn workspaces (`apps/*`, `packages/*`)

## 2. Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| api | `apps/api` | REST API, auth, MongoDB integration |
| web | `apps/web` | Vue dashboard and AI assistant UI |
| @acmp/shared | `packages/shared` | Shared constants, dashboard metrics, AI reply helpers |
| @acmp/chat | `packages/chat` | Reusable chat UI and `useChat` composable |

## 3. Data model

Mongoose models in `apps/api/src/models/` (the in-memory store mirrors the Candidate shape):

- **User:** email (unique, lowercase), passwordHash (`scrypt:salt:hash`), name, role (job-title label), `accessRole` (`admin|recruiter|hiring_manager|viewer`; missing = recruiter for legacy accounts), `companyId` (one company per user), `isActive`, one-time code fields (`otpHash`, `otpExpires`, `otpAttempts`, `otpSentAt`), phone, profilePic, socialLinks {facebook, twitter}, isVerified, verification and reset tokens with expiry, timestamps.
- **Application:** `companyId`, `candidateId`, `jobId`, `status` (pipeline stage), `stage` label, createdBy, timestamps; unique per (candidate, job).
- **Candidate:** `companyId`, `ownerId` (optional), `resumeId` (optional), `score` (best job fit, derived), `status` (furthest stage, derived once they have applications), `phone`, name, email (unique within a company), role, status (`screening|interview|offer|hired|rejected`), score 0-100, stage, location, experienceYears, skills[], summary, notes[{author, text, createdAt}], interviews[{title, date, time, interviewer, type}], timestamps.
- **Job:** `companyId`, title, department, location, status (`draft|open|on_hold|closed`), `hiringManagerId`, description, `employmentType` (`full_time|part_time`), `currency`, `rateUnit` (`hour|day|week|month|year`), `payRateMin/Max`, `billRateMin/Max`, `facilityId`, `expiresAt` (`YYYY-MM-DD`), `maxApplications`, createdBy, timestamps.
- **Resume:** `companyId`, uploadedBy, filename (display only), type (`pdf|docx`), size, `sha256`, storedName (random), `parsed` draft, `confidence`, `source` (`rules|rules+ai`), warnings, `candidateId`; the extracted text is not stored.
- **Conversation:** type (`individual|group`), candidateIds[], `ownerId`, `companyId`, title, timestamps.
- **CandidateDocument:** `companyId`, `candidateId`, title, category (`id_proof|certificate|license|contract|reference|medical|other`), filename, type (`pdf|docx|png|jpg`), size, storedName, `expiresAt` (`YYYY-MM-DD`, optional), uploadedBy, timestamps.
- **Company:** name (unique, case-insensitive), description, `currencies[]` (codes from the fixed list of 20; empty means USD), `facilities[]` (`{id, name, location, address, pinCode}`, unique names), `branding` (displayName, tagline, website, supportEmail, phone, address, primaryColor, accentColor), `logo` (data URL, not selected by default), createdBy, timestamps.
- **AuditLog:** actorId, actorEmail, actorRole, `companyId`, `source` (`user|ai|system`), action, entityType, entityId, summary, meta, createdAt. Append-only.
- **Message:** conversationId (indexed), sender (`recruiter|candidate`), senderName, text, attachments[{name, type, size, content}], createdAt.

## 4. APIs

Public: `GET /api`, `/api/health`, `/api/modules`; `/api/auth/*` (signup, signin, `otp/request`, `otp/verify`, verify, request-reset, reset, reset-password, profile, change-password, me, logout). Everything else under `/api` needs a signed-in user (cookie `auth_token` or Bearer token) and is checked against the role:

| Area | Routes | Permission |
|------|--------|------------|
| Candidates | `GET /candidates`, `GET /dashboard`, `GET /analytics` | read (scoped to visible candidates) |
| | `POST /candidates` | `candidate:create`; belongs to the creator's company and the creator owns it (admins must send `companyId`) |
| | `PUT /candidates/:id` | edit rights for profile fields; notes/interviews only need annotate rights |
| | `PUT /candidates/:id/assignment` | owner: admin, or the owner/any recruiter for unowned candidates (only to themselves); company: admin only |
| | `DELETE /candidates/:id` | admin or the owning recruiter |
| | `GET /candidates/:id/audit` | anyone who can see the candidate (actor emails admin-only) |
| Chat | `/conversations*`, `POST /chat` | `chat:use` for conversations (company-scoped; never mixing companies); `POST /chat` needs read, and commands need the matching edit/annotate right |
| Jobs | `GET /jobs`, `GET /jobs/:id` | `job:read` (own company; admins all, `?companyId=`) |
| | `GET /jobs/hiring-managers` | `job:manage`: active non-read-only users of the company |
| | `POST/PATCH/DELETE /jobs` | `job:manage` (admins send `companyId`); currency and facility must belong to the job's company; min ≤ max; expiry not in the past; delete refused while applications exist; responses hide bill rates from roles without `job:manage`; adding a candidate is refused for closed, draft, on-hold, expired or full jobs |
| | `GET /candidates?jobId=<id or none>` | read; candidates who applied to a job (or to none); each candidate carries `applications` [{job, stage, fit}]. `POST /candidates` accepts `jobId` as "apply to this job" and `resumeId`; `PUT` rejects `status` while the candidate has applications |
| | `GET /jobs/:id/applications` | `job:read`: the board data: each application with its stage, the candidate card and the fit for this job |
| | `GET /candidates/:id/applications` | read: all of a candidate's applications with the full fit breakdown per job |
| | `POST /candidates/:id/applications`, `PATCH /applications/:id`, `DELETE /applications/:id` | edit rights: apply to a job of the same company (once per job, not closed), move to a stage, remove |
| Resumes | `POST /resumes` | `resume:upload`: body is the raw file (`X-Filename` header, admins add `?companyId=`); returns the draft profile, confidence, warnings, duplicate info |
| | `GET /resumes/:id`, `GET /resumes/:id/file` | read, own company: metadata and draft; the file as an attachment (audited) |
| | `DELETE /resumes/:id` | `resume:upload`, only while not linked to a candidate |
| Admin | `GET/PATCH /users` (role, `companyId`, active), `POST/PATCH/DELETE /companies` (PATCH also sets `currencies` and `facilities`; used ones cannot be removed), `POST /companies/:id/adopt-unassigned`, `GET/POST /candidates/:id/documents` (raw body; query `title`, `category`, `expiresAt`), `PATCH/DELETE /documents/:id`, `GET /documents/:id/file`, `POST /companies/:id/facilities` (`job:manage`), `GET /branding`, `PUT/DELETE /companies/:id/logo` (PATCH also sets `branding`), `GET /audit` (filters incl. `companyId`), `POST /seed` (Demo Company only) | admin only (`GET /companies` returns only the caller's own company for non-admins, and all companies with counts for admins) |

Candidate `POST`/`PUT` bodies are validated and whitelisted by `utils/candidateValidation.js` (400 `{message, errors}` on invalid input, 409 on duplicate email); unknown fields are dropped.

`POST /api/chat`: data-changing commands (status, notes, interviews) are parsed by rules in `@acmp/shared`. Free-form questions go to the LLM when `LLM_PROVIDER=ollama` (`apps/api/src/services/llm.js`, OpenAI-compatible `/v1/chat/completions`), falling back to the rule-based reply on any failure. Response includes `source: "llm" | "rules"`. The prompt carries only name, role, status, score, experience and skills.

## 5. Configuration

Shared repo-root `.env` (template: `.env.example`). API-only secrets: `JWT_SECRET`, AI provider keys. Browser-visible: `VITE_*` only. Resumes: `RESUME_STORAGE_DIR` (default `apps/api/storage/resumes`, git-ignored), `UPLOAD_RATE_LIMIT` (30 per 15 minutes per IP). Resume AI uses the same `LLM_*`/`OLLAMA_*` settings as the assistant. Access: `ADMIN_EMAILS`, `DEFAULT_ROLE` (viewer by default), `API_RATE_LIMIT`, `AUTH_RATE_LIMIT`. Email: `EMAIL_PROVIDER` (`console` default, `smtp`, or `brevo` for Brevo's transactional HTTP API), `EMAIL_FROM`, `BREVO_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_DEBUG_LOG` (dev only, prints full bodies); the API refuses to start if `smtp` lacks host and from, or `brevo` lacks the key and a valid from. `yarn email:test you@example.com` sends one test message. LLM: `LLM_PROVIDER` (`rules` or `ollama`), `OLLAMA_HOST`, `OLLAMA_MODEL`, `LLM_MODEL`, `OLLAMA_API_KEY`, `LLM_TIMEOUT_MS`.

## 6. Testing strategy

| Layer | Tool | Command | What it covers |
|-------|------|---------|----------------|
| API unit | Node `node --test` | `yarn workspace api test` | Profile completion rule, fit score (per job) (weights, skills aliases, years, synonyms, location, warnings, AI wording and its cache), resume parser (real generated PDF and DOCX files: extraction, rules, redaction, AI gap-filling and fallbacks, zip-bomb refusal), LLM service (config, prompt privacy, fallback, logging), JWT, auth middleware, candidate input validation, email provider and logging (fake SMTP server), the permission table and visibility rules, auth middleware |
| API end-to-end | Node `node --test` | `yarn workspace api test` (`apps/api/test/e2e.test.js`) | Real server in in-memory mode plus a fake Ollama: public/protected routes, sign-up/sign-in/me/logout, password reset by email through a fake SMTP server, candidate CRUD and input validation (400/409), assistant LLM and rule paths, security headers, rate limit |
| Web component | Vitest + Vue Test Utils + jsdom | `yarn workspace web test` | Pinia stores (candidates, auth role and company helpers), DashboardCards, AppHeader, AIAssistantPanel, SignIn view (password and email code), Admin module, Jobs module (openings and the pipeline board incl. drag and drop, stale-response protection), Add Candidate popup with resume autofill, profile meter, candidate detail sidebar (role gating, job and resume controls, profile completion, job fit) |
| UI end-to-end | Playwright (system Chrome) | `yarn test:e2e` | Redirect to sign-in, wrong password, full recruiter flow (sign in, overview, candidates, assistant), job creation, resume upload into a job, drag-and-drop pipeline moves and resume download, add-candidate form with valid and invalid input, HttpOnly session cookie. Starts its own servers on ports 4311/4411 |

`yarn test` runs the API (181 tests, 2 MongoDB-only skipped) and web (152 tests) suites; `yarn test:e2e` runs 16 UI tests. The company/role/ownership/audit/OTP scenarios (`rbac.e2e.test.js`), the jobs/pipeline/resume scenarios (`jobs-resumes.e2e.test.js`), the job fields and company lists (`job-fields.e2e.test.js`) and the team-to-company migration test (`migrations.test.js`) also run against MongoDB; run **one file per command**, each with its own throwaway database, because files run in parallel: `E2E_MONGODB_URI=mongodb://127.0.0.1:27017/some-throwaway-db node --test apps/api/test/rbac.e2e.test.js apps/api/test/migrations.test.js` (the migration test appends `-migration` to the database name and drops both). `yarn test:e2e` is separate because it launches Chrome. Not yet covered: SignUp/ResetPassword views, CandidateList and detail sidebar, chat module, analytics, MongoDB mode, accessibility.

## 6b. Dependencies added for resumes

`unpdf` (PDF text) and `jszip` (DOCX text and tests). `mammoth` was evaluated and rejected: it pulled in `sprintf-js` with an advisory that has no fixed release.

## 6c. Data migration

At startup (MongoDB only) `services/migrations.js` runs once and is safe to repeat: it drops the old global unique index on candidate email, and converts any `teams` from the earlier version into companies with the same ids (users move to the first team they were in, candidates shared with a team move to it) then renames the old collection to `teams_migrated_to_companies`. Candidates and users that had no team stay without a company: an admin assigns them (Admin → Companies → "Move unassigned here", and Users → Company).

## 7. Non-functional requirements

_TBD_

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
