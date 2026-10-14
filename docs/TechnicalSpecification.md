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

_TBD (models: User, Candidate, Conversation, Message)_

## 4. APIs

Public: `GET /api`, `/api/health`, `/api/modules`; `/api/auth/*` (signup, signin, verify, request-reset, reset, reset-password, profile, change-password, me, logout). Everything else under `/api` requires a signed-in user (cookie `auth_token` or Bearer token): dashboard, candidates (CRUD), conversations and messages, `POST /api/chat`, analytics, `POST /api/seed` (disabled in production).

`POST /api/chat`: data-changing commands (status, notes, interviews) are parsed by rules in `@acmp/shared`. Free-form questions go to the LLM when `LLM_PROVIDER=ollama` (`apps/api/src/services/llm.js`, OpenAI-compatible `/v1/chat/completions`), falling back to the rule-based reply on any failure. Response includes `source: "llm" | "rules"`. The prompt carries only name, role, status, score, experience and skills.

## 5. Configuration

Shared repo-root `.env` (template: `.env.example`). API-only secrets: `JWT_SECRET`, AI provider keys. Browser-visible: `VITE_*` only. LLM: `LLM_PROVIDER` (`rules` or `ollama`), `OLLAMA_HOST`, `OLLAMA_MODEL`, `LLM_MODEL`, `OLLAMA_API_KEY`, `LLM_TIMEOUT_MS`.

## 6. Testing strategy

`yarn test` runs Node's built-in test runner over `apps/api/test/` (LLM service, JWT, auth middleware; 12 tests). No web component or end-to-end tests yet.

## 7. Non-functional requirements

_TBD_

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
