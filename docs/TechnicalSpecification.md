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

- **User:** email (unique, lowercase), passwordHash (`scrypt:salt:hash`), name, role, phone, profilePic, socialLinks {facebook, twitter}, isVerified, verification and reset tokens with expiry, timestamps.
- **Candidate:** name, email (unique), role, status (`screening|interview|offer|hired|rejected`), score 0-100, stage, location, experienceYears, skills[], summary, notes[{author, text, createdAt}], interviews[{title, date, time, interviewer, type}], timestamps.
- **Conversation:** type (`individual|group`), candidateIds[], title, timestamps.
- **Message:** conversationId (indexed), sender (`recruiter|candidate`), senderName, text, attachments[{name, type, size, content}], createdAt.

## 4. APIs

Public: `GET /api`, `/api/health`, `/api/modules`; `/api/auth/*` (signup, signin, verify, request-reset, reset, reset-password, profile, change-password, me, logout). Everything else under `/api` requires a signed-in user (cookie `auth_token` or Bearer token): dashboard, candidates (CRUD), conversations and messages, `POST /api/chat`, analytics, `POST /api/seed` (disabled in production).

Candidate `POST`/`PUT` bodies are validated and whitelisted by `utils/candidateValidation.js` (400 `{message, errors}` on invalid input, 409 on duplicate email); unknown fields are dropped.

`POST /api/chat`: data-changing commands (status, notes, interviews) are parsed by rules in `@acmp/shared`. Free-form questions go to the LLM when `LLM_PROVIDER=ollama` (`apps/api/src/services/llm.js`, OpenAI-compatible `/v1/chat/completions`), falling back to the rule-based reply on any failure. Response includes `source: "llm" | "rules"`. The prompt carries only name, role, status, score, experience and skills.

## 5. Configuration

Shared repo-root `.env` (template: `.env.example`). API-only secrets: `JWT_SECRET`, AI provider keys. Browser-visible: `VITE_*` only. Email: `EMAIL_PROVIDER` (`console` default or `smtp`), `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_DEBUG_LOG` (dev only, prints full bodies); the API refuses to start if `smtp` is selected without host and from. LLM: `LLM_PROVIDER` (`rules` or `ollama`), `OLLAMA_HOST`, `OLLAMA_MODEL`, `LLM_MODEL`, `OLLAMA_API_KEY`, `LLM_TIMEOUT_MS`.

## 6. Testing strategy

| Layer | Tool | Command | What it covers |
|-------|------|---------|----------------|
| API unit | Node `node --test` | `yarn workspace api test` | LLM service (config, prompt privacy, fallback, logging), JWT, auth middleware, candidate input validation, email provider and logging (fake SMTP server) |
| API end-to-end | Node `node --test` | `yarn workspace api test` (`apps/api/test/e2e.test.js`) | Real server in in-memory mode plus a fake Ollama: public/protected routes, sign-up/sign-in/me/logout, password reset by email through a fake SMTP server, candidate CRUD and input validation (400/409), assistant LLM and rule paths, security headers, rate limit |
| Web component | Vitest + Vue Test Utils + jsdom | `yarn workspace web test` | Pinia candidates store, DashboardCards, AppHeader, AIAssistantPanel, SignIn view |
| UI end-to-end | Playwright (system Chrome) | `yarn test:e2e` | Redirect to sign-in, wrong password, full recruiter flow (sign in, overview, candidates, assistant), add-candidate form with valid and invalid input, HttpOnly session cookie. Starts its own servers on ports 4311/4411 |

`yarn test` runs the API (42 tests) and web (16 tests) suites; `yarn test:e2e` runs 6 UI tests. `yarn test:e2e` is separate because it launches Chrome. Not yet covered: SignUp/ResetPassword views, CandidateList and detail sidebar, chat module, analytics, MongoDB mode, accessibility.

## 7. Non-functional requirements

_TBD_

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
