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

_TBD (list verified routes from `apps/api/src/index.js` and `routes/auth.js`)_

## 5. Configuration

_TBD (env vars: see `apps/api/.env.example`, `apps/web/.env.example`)_

## 6. Testing strategy

_TBD (no tests exist yet)_

## 7. Non-functional requirements

_TBD_

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
