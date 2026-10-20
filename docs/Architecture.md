# Architecture

As built, 2026-10-15.

## 1. System context

```
 Recruiter's browser
        │  HTTPS/HTTP, cookie auth_token (HttpOnly)
        ▼
 Web app (Vue 3 + Vite, :4410) ──/api──►  API (Express, :4310) ──► MongoDB (optional)
                                              │
                                              └──► Ollama host (OpenAI-compatible /v1/chat/completions, server-side only)
```

Actors and systems: recruiter (browser), web app, API, MongoDB (falls back to in-memory demo data when `MONGODB_URI` is unset or unreachable), Ollama LLM host (optional, `LLM_PROVIDER=ollama`).

## 2. Components

Monorepo (Yarn 4 workspaces, ESM everywhere):

| Component | Path | Responsibility |
|-----------|------|----------------|
| API | `apps/api` | Express app: `config/env.js` (env loading), `routes/jobs.js`, `routes/resumes.js`, `services/resumeParser.js`, `fileStorage`, `jobStore`, `resumeStore`, `middleware/requireAuth.js`, `routes/auth.js`, route handlers in `index.js`, `services/` (`userStore`, `companyStore`, `audit`, `migrations`, `llm`), `routes/admin.js` (users, teams, audit), `utils/candidateValidation.js`, Mongoose `models/` (User, Candidate, Conversation, Message, Company, Job, Resume, AuditLog), `utils/jwt.js`, `utils/email.js`, `seed.js` |
| Web | `apps/web` | Vue shell (`App.vue`) with router and Pinia stores (`auth`, `candidates`); module components lazy-loaded through `microfrontends/registry.js` (Overview, Candidates, Chat, AI Assistant, Analytics, Profile); `services/api.js` axios client |
| `@acmp/shared` | `packages/shared` | Pure logic used by API and web: status constants, dashboard metrics, candidate name lookup, `parseAiMessage` (command parser) and `generateAiReply` (rule-based answers) |
| `@acmp/chat` | `packages/chat` | Reusable chat UI (`ChatPanel`, `MessageThread`, conversation list/modal) and `useChat` composable |

Module manifest: the API serves `/api/modules`; the web shell merges it with defaults, so new modules are registered in three places (component, registry, manifest).

## 3. Data flow

- **Sign-in:** web posts credentials, API verifies the scrypt hash, signs an HS256 token (8h) and sets the `auth_token` HttpOnly cookie. Every `/api` route after `/api/modules` runs `requireAuth`, which accepts the cookie or a Bearer token.
- **Pipeline data:** Pinia store calls `/dashboard` and `/candidates` (search, status, page, sort); the API reads MongoDB or the in-memory array and returns JSON.
- **Assistant:** `POST /api/chat`. `parseAiMessage` recognises commands, which are executed by the API against the store. Otherwise `services/llm.js` sends a contact-free candidate summary to the model and returns its text; any error falls back to `generateAiReply`. The response includes `source`.
- **Env:** one repo-root `.env`. The API loads `apps/api/.env` then root `.env`; Vite reads the root file and exposes only `VITE_*` to the browser. AI keys never reach the web bundle.

### Jobs and resumes

- **Jobs** belong to a company (`routes/jobs.js`, `jobStore`). A candidate applies to jobs through **applications** (`models/Application.js`, `applicationStore`, `routes/applications.js`): one record per (candidate, job) with its own `status`/`stage`. The pipeline board is a job's applications grouped by status, so moving a card changes only that application (`PATCH /api/applications/:id`) with the candidate-update permission and an audit entry. Job counts come from the candidate store through a callback, so the router owns no candidate storage.
- **Resume intake** (`routes/resumes.js`, `services/resumeParser.js`): the browser sends the raw file (`POST /api/resumes`, body = bytes, name in `X-Filename`). The type is decided from the bytes (`%PDF-` or a zip containing `word/document.xml`), never from the name or `Content-Type`. Text is extracted (PDF via `unpdf`, DOCX by reading `word/document.xml` with `jszip`, with page and size limits and a zip-bomb guard), then **rules** extract contact details, name, title, location, skills (dictionary plus a Skills section), years of experience (stated, or merged date ranges) and summary. If `LLM_PROVIDER` is enabled, the model is asked **only for fields the rules missed**, from a **redacted** copy (no name, email, phone, links or long numbers), with validated JSON output and a rules fallback. The raw text is never stored; the parsed draft and the file are.
- **Storage:** files are written to `RESUME_STORAGE_DIR` under random names with owner-only permissions; metadata and the parsed draft are in the `resumes` collection with the company id and a SHA-256 of the file (the same file uploaded again by the same company reuses the earlier result). Downloads are always attachments with a fixed content type. A resume is linked to at most one candidate; deleting the candidate deletes the file and record.
- **Efficiency:** rules first, AI only for gaps, nothing re-parsed for an identical file, one small model call at most per new upload, redacted input, validated output (see `docs/Roadmap.md` section 1).

### Profile completion and job fit

- **Profile completion** is a pure rule in `packages/shared/src/profile.js` (nine weighted items), used by the web app for cards, rows and the panel and by the fit score.
- **Job fit** (`services/fitScore.js`, `GET /api/candidates/:id/fit`) is computed on read from the candidate, the parsed draft of their resume (skills, years, role: the resume enriches but never overrides the reviewed profile) and the job (title, description, location). Required skills and years are extracted from the description with the same skill dictionary used for resumes. Factors and weights: skills 45, experience 25, role match 15, location 5, profile 10. The result is deterministic and explained. If `LLM_PROVIDER` is enabled the model only rewords the explanation from the facts (skill names, years, titles; no names or contact details), cached per distinct input, and never changes the score. Nothing is stored; the score is recomputed, so it always reflects the current profile, resume and job description.

### Facilities

A facility (`id`, name, location, address, pin code) lives inside its company record, so it can only be used by that company's jobs; `checkCompanyRules` refuses another company's facility id. `services/facilities.js` validates one facility for both the admin settings route (whole list) and `POST /companies/:id/facilities` (one new site, `job:manage`, own company only, admins any). Location suggestions in the UI come from the company's own existing facilities; no external address lookup is used.

### Candidate documents

`routes/documents.js` (with `services/documentStore.js`, `documentRules.js`, model `CandidateDocument`) keeps extra files per candidate in the same disk storage as resumes (random names, git-ignored). Access follows the candidate: visible means company-scoped, change needs `resume:upload` plus edit rights. The file type comes from its bytes (PDF, Word verified by opening the zip, PNG, JPEG). The expiry date is a stored calendar day; the Expired state is computed on every read in UTC, so nothing needs a scheduled job. Documents are deleted with their candidate.

### White-label branding

Company-specific presentation data lives on the company record (`branding` object and a validated logo data URL, never listed with companies). `GET /api/branding` returns the signed-in user's company branding (platform default when there is none); `services/branding.js` validates it. The web app has one source for defaults and colour maths (`config/brand.js`) and one store (`stores/branding.js`) that applies the colours as CSS variables, so components never hardcode brand colours. The logo type is decided from its bytes (SVG refused), size-limited and admin-only.

### Job rules that depend on the company

Jobs carry employment type, a currency (one of the company's preset list), a rate unit, pay and bill rate ranges, a facility id (one of the company's own facilities), an expiry date (`YYYY-MM-DD`, UTC) and a maximum application count. `routes/jobs.js` checks those against the company on create and update (`checkCompanyRules`); `services/jobRules.js` holds the expiry and capacity rules (`applyBlockReason`) used by every way of adding a candidate to a job. Facilities have stable ids so a rename never breaks jobs; admin edits that would remove a used currency or facility are refused. Bill rates are removed from responses for roles without `job:manage`.

### Applications, scores and the candidate's own status

`refreshCandidate()` (index.js) keeps two denormalised candidate fields in step with the applications: `status` (the furthest non-rejected stage, or rejected if rejected everywhere) and `score` (the best fit over all applications). It runs after an application is added, moved or removed, after the candidate's profile or resume changes, and after a job's title, description or location changes, so dashboards, analytics, sorting and the assistant keep working. Per-job fit itself is never stored: it is computed on read. The table's `applications` summary (job, stage, fit) is added to each page of candidates. Startup migration `migrateJobLinksToApplications` converts the earlier single `candidate.jobId` into applications.

### Access control

- **Rules** live in `packages/shared/src/permissions.js` (roles, permission table, visibility and edit/delete/assign predicates). The API enforces them; the web app imports the same functions only to hide or disable controls.
- **Request pipeline:** `requireAuth` verifies the token, loads the current user (role, company, active) and sets `req.user`; `requirePermission(permission)` guards routes; handlers scope data with `visibleCandidates` / `canViewCandidate` and answer 404 for candidates outside the user's scope, 403 for visible-but-not-allowed actions.
- **Tenancy model:** a company is the tenant. Every non-admin user has exactly one `companyId`; every candidate and conversation has a `companyId`. A user sees a candidate only if it belongs to their company; admins are platform-level and see all; candidates or users without a company are admin-only/invisible. `ownerId` on a candidate is a responsibility label inside the company. Company and owner change only through `PUT /api/candidates/:id/assignment` (company: admins only; owner must belong to the candidate's company). Candidate email uniqueness is per company (`{companyId, email}` index).
- **Audit:** `services/audit.js` writes append-only entries (field names, statuses, ids) for auth, user/company/candidate changes and assistant actions (`source: "ai"`); it never throws into the request.
- **One-time codes:** a code is created in `routes/auth.js`, stored on the user as an HMAC (`signValue`) with expiry, attempt counter and send time, and emailed through `utils/email.js`.
- **Limits of the current design:** visibility filtering happens in the API after loading candidates (fine at this scale; push `companyId` into the database query before large datasets); roles are global, not per company, and each user belongs to one company.

## 4. Integrations

| Integration | Direction | Notes |
|-------------|-----------|-------|
| MongoDB | API → DB | Optional; Mongoose models; in-memory fallback |
| Ollama (`nemotron-3-nano:4b`) | API → LLM host | Plain HTTP in the current setup (SEC-008); no key required |
| Email | API → SMTP server or Brevo API | `utils/email.js`. `EMAIL_PROVIDER=smtp` sends through any SMTP service via `nodemailer` (Brevo, Resend, Mailgun, SES SMTP, Mailpit locally); `EMAIL_PROVIDER=brevo` posts to Brevo's transactional endpoint `/v3/smtp/email` over HTTPS (no SMTP port needed); default `console` sends nothing and logs a masked line. Bodies and recipients are never logged; remote servers require TLS |
| Anthropic, OpenAI, Gemini | not implemented | Variables are reserved in `.env.example` |

## 5. Deployment

No deployment configuration exists yet (no Docker, CI or hosting files). For production: set `NODE_ENV=production`, `CLIENT_URL` (the only allowed CORS origin), a strong `JWT_SECRET`, `MONGODB_URI`, serve the built web app over HTTPS, set `trust proxy` if behind a proxy so rate limits are per client, and use an HTTPS LLM endpoint.

## 6. Architecture decision records

| ID | Decision | Status | Date |
|----|----------|--------|------|
| ADR-1 | Yarn workspaces monorepo with shared logic in `@acmp/shared` so API and web use one command parser | Accepted | 2026-10-14 |
| ADR-2 | In-memory demo store when MongoDB is absent, so the app runs with zero setup | Accepted | 2026-10-14 |
| ADR-3 | Stateless HS256 JWT in an HttpOnly cookie, 8h lifetime (no revocation) | Accepted | 2026-10-15 |
| ADR-4 | LLM only answers free-form questions; data-changing commands stay rule-based so a model can never modify records | Accepted | 2026-10-15 |
| ADR-5 | AI provider keys are server-side only; one root `.env`; Vite exposes `VITE_*` only | Accepted | 2026-10-15 |
| ADR-6 | LLM prompt carries only name, role, status, score, experience, skills (no contact data or notes) | Accepted | 2026-10-15 |
| ADR-8 | Four fixed roles with a shared permission table instead of configurable roles; least privilege by default (new accounts read-only) | Accepted | 2026-10-15 |
| ADR-9 | Authority comes from the user record on every request, not from the token, so changes and deactivation are immediate | Accepted | 2026-10-15 |
| ADR-10 | Hidden-by-404 for candidates outside a user's company; owner/company changes only via a dedicated assignment endpoint | Accepted | 2026-10-15 |
| ADR-13 | Multi-tenancy by company: one company per user, platform-level admin only (no per-company admin), whole company sees its candidates; replaces the earlier Teams feature. Existing teams are migrated to companies at startup | Accepted | 2026-10-15 |
| ADR-14 | A company with users or candidates cannot be deleted; seeding touches only the Demo Company | Accepted | 2026-10-15 |
| ADR-11 | Append-only audit log with metadata only; AI actions recorded under the requesting user with `source: ai` | Accepted | 2026-10-15 |
| ADR-12 | Email one-time codes as an alternative sign-in, stored as HMAC, single use, attempt-limited | Accepted | 2026-10-15 |
| ADR-15 | Jobs are company-owned; the pipeline board is a view over candidate status (no separate board data); a job with candidates can only be closed, not deleted | Accepted | 2026-10-15 |
| ADR-16 | Resumes: raw-bytes upload (no multipart library), type from magic bytes, local-disk storage under random names, parse once per distinct file, raw text never stored, AI limited to gaps on redacted text | Accepted | 2026-10-15 |
| ADR-17 | DOCX is read directly from `word/document.xml` with `jszip` instead of a converter library (smaller attack surface, no unfixed advisory) | Accepted | 2026-10-15 |
| ADR-19 | A candidate can apply to many jobs: applications carry the stage; the candidate's status and score are derived caches (furthest stage, best fit); fit is per job and computed on read | Accepted | 2026-10-15 |
| ADR-20 | Per-company currency and facility lists (admin-managed), jobs reference them by code/id; bill rates are visible only to job managers; expired or full jobs take no applications | Accepted | 2026-10-15 |
| ADR-18 | Fit score is rules-based, weighted and explainable, computed on read and never stored; AI may only reword the explanation (cached, no personal data) | Accepted | 2026-10-15 |
| ADR-7 | Module shell with lazy-loaded modules as a stepping stone to microfrontends | Accepted | 2026-10-14 |

Known architectural gaps: resume files are on local disk (one server; move to object storage with encryption before scaling out); PDF/DOCX parsing runs inside the API process (move to a worker with a timeout for untrusted traffic); roles are global and admins are platform-level (no per-company admin); notes are replaced as a whole array (BUG-003); no deployment or CI pipeline; stateless tokens cannot be revoked (but deactivation and role changes take effect immediately).

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
| 2026-10-15 | 1 | Filled in from the implemented code |
