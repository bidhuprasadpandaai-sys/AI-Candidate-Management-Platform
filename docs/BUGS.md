# Bug Log

Running log of known bugs. Log a bug as soon as it is found. Status flow: **Open → Fixed → Verified**, or **Won't fix**.
Severity: Critical / High / Medium / Low.

| ID | Title | Severity | Status | Phase found | Repro steps | Fix notes |
|----|-------|----------|--------|-------------|-------------|-----------|
| BUG-001 | `routes/auth.js` reads `REQUIRE_EMAIL_VERIFICATION` and `CLIENT_URL` from `process.env` at import time, before `dotenv.config()` runs in `index.js`, so values from `apps/api/.env` are ignored | Low | Fixed | Baseline | Set either var only in `.env`, start API, observe default used | Fixed 2026-10-15: dotenv now loads in `apps/api/src/config/env.js`, imported first by `index.js` and `seed.js`; verified root-only variables load and API starts |
| BUG-002 | In-memory store accepts arbitrary, unvalidated candidate fields: `POST /api/candidates` and `PUT /api/candidates/:id` spread the request body into the record (no required-field or type checks, unknown fields kept) | Low | Fixed | Phase 1 (test authoring) | Run without MongoDB; `POST /api/candidates` with `{}` returns 201; MongoDB mode enforces the schema | Fixed 2026-10-15: `apps/api/src/utils/candidateValidation.js` validates and whitelists fields (types, lengths, enum status, score 0-100, email format, notes and interviews shape; unknown fields and `_id`/`id` dropped) for both create and update in both stores; duplicate email returns 409; errors return 400 `{message, errors}` which the Add Candidate form already displays. Verified: 14 validator tests, API end-to-end test, Playwright UI tests, and a live check against MongoDB |
| BUG-003 | Notes and interviews are updated by replacing the whole array, so a hiring manager (who may add notes) could also remove or rewrite others' notes by sending a shorter array | Low | Open | Phase 2 (RBAC) | `PUT /api/candidates/:id` with `{notes: []}` as a hiring manager on a team candidate | Add append-only endpoints (`POST /candidates/:id/notes`, `/interviews`) and reject shrinking arrays for non-edit roles. The change is audited (`candidate.updated`, field `notes`), so it is detectable |
| BUG-004 | Pipeline board: a slow, older board response could overwrite a card the user had just moved, so the card jumped back | Medium | Fixed | Phase 3 (found by the browser test) | Move a card right after switching job on a slow connection | Fixed 2026-10-15: only the newest board request may update the board, a move invalidates in-flight loads, and the board refreshes from the server after a move. Covered by two store tests and the browser test |
| BUG-005 | Resume download saved the file as "resume.pdf" instead of its real name (the browser could not read the Content-Disposition header across origins) | Low | Fixed | Phase 3 (found by the browser test) | Download a resume from the candidate panel | Fixed 2026-10-15: the API exposes `Content-Disposition` through CORS. Verified by the browser test |

## Change log

| Date | Change |
|------|--------|
| 2026-10-14 | Skeleton created |
| 2026-10-15 | BUG-001 and BUG-002 fixed and verified |
| 2026-10-15 | BUG-004 and BUG-005 found and fixed while testing jobs and resumes |
| 2026-10-15 | BUG-003 logged. Also fixed while testing: in-memory candidates lacked the MongoDB defaults (status, stage, score, ...); search text was used unescaped in a MongoDB regex (regex injection / ReDoS) |
