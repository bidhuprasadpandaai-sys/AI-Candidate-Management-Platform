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
| API | `apps/api` | Express app: `config/env.js` (env loading), `middleware/requireAuth.js`, `routes/auth.js`, route handlers in `index.js`, `services/llm.js`, `utils/candidateValidation.js`, Mongoose `models/` (User, Candidate, Conversation, Message), `utils/jwt.js`, `utils/email.js`, `seed.js` |
| Web | `apps/web` | Vue shell (`App.vue`) with router and Pinia stores (`auth`, `candidates`); module components lazy-loaded through `microfrontends/registry.js` (Overview, Candidates, Chat, AI Assistant, Analytics, Profile); `services/api.js` axios client |
| `@acmp/shared` | `packages/shared` | Pure logic used by API and web: status constants, dashboard metrics, candidate name lookup, `parseAiMessage` (command parser) and `generateAiReply` (rule-based answers) |
| `@acmp/chat` | `packages/chat` | Reusable chat UI (`ChatPanel`, `MessageThread`, conversation list/modal) and `useChat` composable |

Module manifest: the API serves `/api/modules`; the web shell merges it with defaults, so new modules are registered in three places (component, registry, manifest).

## 3. Data flow

- **Sign-in:** web posts credentials, API verifies the scrypt hash, signs an HS256 token (8h) and sets the `auth_token` HttpOnly cookie. Every `/api` route after `/api/modules` runs `requireAuth`, which accepts the cookie or a Bearer token.
- **Pipeline data:** Pinia store calls `/dashboard` and `/candidates` (search, status, page, sort); the API reads MongoDB or the in-memory array and returns JSON.
- **Assistant:** `POST /api/chat`. `parseAiMessage` recognises commands, which are executed by the API against the store. Otherwise `services/llm.js` sends a contact-free candidate summary to the model and returns its text; any error falls back to `generateAiReply`. The response includes `source`.
- **Env:** one repo-root `.env`. The API loads `apps/api/.env` then root `.env`; Vite reads the root file and exposes only `VITE_*` to the browser. AI keys never reach the web bundle.

## 4. Integrations

| Integration | Direction | Notes |
|-------------|-----------|-------|
| MongoDB | API → DB | Optional; Mongoose models; in-memory fallback |
| Ollama (`nemotron-3-nano:4b`) | API → LLM host | Plain HTTP in the current setup (SEC-008); no key required |
| Email | API → SMTP server | `utils/email.js` via `nodemailer`. `EMAIL_PROVIDER=smtp` sends through any SMTP service (Brevo, Resend, Mailgun, SES SMTP, Mailpit locally); default `console` sends nothing and logs a masked line. Bodies and recipients are never logged; remote servers require TLS |
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
| ADR-7 | Module shell with lazy-loaded modules as a stepping stone to microfrontends | Accepted | 2026-10-14 |

Known architectural gaps: no per-user data ownership or roles; shared pipeline for all users; no deployment or CI pipeline; stateless tokens cannot be revoked.

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
| 2026-10-15 | 1 | Filled in from the implemented code |
