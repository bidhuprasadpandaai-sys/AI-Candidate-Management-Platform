# AI Candidate Management Platform

A monorepo starter for an AI-assisted recruitment application with a candidate dashboard, searchable pipeline, and chat-based recruiting assistant.

## Tech stack

- **Frontend:** Vue 3, Vite, Pinia, PrimeVue
- **Backend:** Node.js, Express.js
- **Database:** MongoDB with Mongoose
- **Package manager:** Yarn workspaces

## Monorepo structure

```text
.
├── apps
│   ├── api      # Express API + MongoDB integration
│   └── web      # Vue 3 dashboard + AI assistant UI
└── packages
    └── shared   # Shared candidate constants and AI helper logic
```

## Features included

- Candidate dashboard cards for hiring metrics
- Searchable and filterable candidate list
- AI assistant chat panel for quick recruiting insights
- MongoDB-ready candidate model and seed script
- In-memory demo fallback when MongoDB is not configured

## Getting started

### 1) Install dependencies

```bash
yarn install
```

### 2) Optional: configure environment files

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

If you have MongoDB running locally, keep or adjust:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/ai-candidate-management
```

### 3) Start the monorepo apps

```bash
yarn dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000/api`

## Useful scripts

```bash
yarn dev        # run frontend + backend together
yarn dev:web    # run only the Vue app
yarn dev:api    # run only the Express API
yarn build      # verify/build all workspaces
yarn seed       # seed MongoDB when MONGODB_URI is configured
```

## Suggested next enhancements

- Add recruiter login and role-based access
- Connect a real LLM provider for richer AI summaries
- Add interview scheduling and candidate notes
- Introduce tests, CI, and deployment configuration
