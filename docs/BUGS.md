# Bug Log

Running log of known bugs. Log a bug as soon as it is found. Status flow: **Open → Fixed → Verified**, or **Won't fix**.
Severity: Critical / High / Medium / Low.

| ID | Title | Severity | Status | Phase found | Repro steps | Fix notes |
|----|-------|----------|--------|-------------|-------------|-----------|
| BUG-001 | `routes/auth.js` reads `REQUIRE_EMAIL_VERIFICATION` and `CLIENT_URL` from `process.env` at import time, before `dotenv.config()` runs in `index.js`, so values from `apps/api/.env` are ignored | Low | Fixed | Baseline | Set either var only in `.env`, start API, observe default used | Fixed 2026-10-15: dotenv now loads in `apps/api/src/config/env.js`, imported first by `index.js` and `seed.js`; verified root-only variables load and API starts |

## Change log

| Date | Change |
|------|--------|
| 2026-10-14 | Skeleton created |
