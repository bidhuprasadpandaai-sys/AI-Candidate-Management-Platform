# Roadmap

Phased plan for the next features. Drafted 2026-10-15 for review; scope, order and sizes are proposals until the open decisions in section 5 are answered.

Every phase ends with the full gate run (Reviewer, Architecture, Product, QA, Security), the docs updated, and a push audit before anything is pushed.

## 1. AI efficiency principles

These apply to every AI feature in every phase.

1. **Deterministic first, model second.** Use code, SQL-style filters, regex and math when they can do the job (scoring arithmetic, duplicate detection, status commands, metrics). Call a model only for language understanding or generation.
2. **Compute once, reuse many times.** Run AI work when data is written (resume uploaded, job saved), store the result with a content hash and prompt version, and serve it from the database. Never re-run it on every page view.
3. **Smallest model that passes the eval.** Default to the small local Ollama model; escalate to a larger model only for tasks that fail their eval. Record the chosen tier per task.
4. **Send the least context.** Retrieve only the relevant candidates, fields and chunks (filters, then embeddings) instead of sending the whole pipeline. Cap prompt size per task. Redact PII before every model call (see section 4).
5. **Structured, short outputs.** Ask for JSON that matches a schema, validate it, retry once on failure, otherwise fall back to the rule-based path. Limit `max_tokens` per task.
6. **One AI gateway.** All calls go through a single server-side service that handles provider choice, caching, timeouts, budgets, retries, logging of metadata (never content) and fallbacks. No feature calls a model directly.
7. **Async for heavy work.** Resume parsing, batch scoring and report summaries run in a background job queue, with progress shown in the UI. Chat and short interactions stream.
8. **Budgets and limits.** Per-user and per-day request and token limits, a global kill switch, and graceful fallback to rules when a limit or the model is unavailable.
9. **Measure it.** Track latency, tokens, cache hit rate, fallback rate and cost per feature. Keep a small evaluation set per AI task and run it in CI before changing a prompt or model.
10. **Human in the loop.** The model suggests; people confirm anything that changes data, sends a message or affects a hiring decision. Show why (explanations and sources), and keep an audit trail.

Proposed efficiency targets (to be validated in Phase 2): at least 60% of AI requests served from cache or rules, p95 chat latency under 5 seconds on the small model, zero PII in prompts, and a per-feature cost report.

## 2. Phase overview

| Phase | Theme | Size | AI focus | Depends on |
|-------|-------|------|----------|------------|
| 1 | Baseline (done) | - | Rule commands plus Ollama Q&A | - |
| 2 | Platform foundations and AI gateway | M | Gateway, cache, redaction, evals, budgets | Phase 1 |
| 3 | Jobs and pipeline | M | None needed (deterministic); optional JD drafting | Phase 2 |
| 4 | Resume intake and AI screening | L | Extraction, embeddings, hybrid match score, explanations | Phases 2 and 3 |
| 5 | Interviews and collaboration | M | Interview questions, feedback summaries, email drafts | Phase 3 |
| 6 | Search, assistant 2.0 and analytics | M | Embedding search, tool use with confirmation, report summaries | Phases 4 and 5 |
| 7 | Sourcing, integrations and scale | L | Optional: enrichment, outreach drafts | Phase 6 |

Sizes: S about 1 week, M about 2-3 weeks, L about 4-6 weeks for one developer. They are rough and will be re-estimated at the start of each phase.

## 3. Phases in detail

### Phase 1: Baseline (complete)
Auth, candidate CRUD with validation, dashboard, analytics, chat module, assistant (rules plus Ollama), shared `.env`, security hardening, tests, specs. See `HANDOFF.md`.

### Phase 2: Platform foundations and AI gateway
Goal: make the app safe to use with a team and make every later AI feature cheap, safe and measurable.

| Feature | AI usage | Acceptance criteria |
|---------|----------|---------------------|
| AI gateway (`services/ai/`) replacing the ad-hoc `services/llm.js` | Central place for providers (Ollama first, others behind one interface), timeouts, retries, fallbacks | All AI calls go through it; provider swap is a config change; unit tests with a fake provider |
| Response cache (content hash + prompt version + model) | Avoids repeat calls | Cache hit rate reported; identical request is served without a model call |
| PII redaction layer | Strips emails, phones, addresses, IDs before any model call | Tests prove contact data never reaches the provider; configurable per provider (stricter for remote) |
| Budgets, rate limits, kill switch | Cost and abuse control | Per-user and daily limits enforced; over-limit falls back to rules with a clear message |
| AI usage log (metadata only) and a small admin usage page | Observability | Tokens, latency, cache hit, fallback per feature; no prompt content stored |
| Evaluation harness (`yarn eval`) with a seed set | Prevents prompt/model regressions | Runs in CI; fails on score drop |
| HTTPS for the LLM host (closes SEC-008) | Secure transport | `OLLAMA_HOST` is https; HTTP blocked outside development |
| Real email provider | None | **Done early (2026-10-15):** generic SMTP via `EMAIL_PROVIDER=smtp` (free options: Brevo, Resend, Mailgun, or Mailpit locally). Remaining: provider account and verified sender domain (SPF/DKIM/DMARC), HTML templates |
| Roles (Admin, Recruiter, Hiring manager, Viewer) and candidate ownership | None | Route-level permission checks; "my candidates" filter; tests per role |
| Audit log (who, what, when, including AI-triggered changes) | Marks AI-made changes | Visible per candidate; immutable entries |
| CI pipeline (GitHub Actions: build, tests, e2e, audit, leak scan) | Runs the eval set | Required check on pull requests |

Exit: Security gate has no open findings other than accepted risks; eval and cost dashboards exist.

### Phase 3: Jobs and pipeline
Goal: organise candidates around real job openings.

| Feature | AI usage | Acceptance criteria |
|---------|----------|---------------------|
| Job openings (title, department, location, requirements, hiring manager, status) | Optional "draft job description" using the gateway (small model, cached by inputs) | CRUD with validation; candidates link to a job |
| Per-job Kanban board with drag between stages and configurable stages | None | Moves persist, are audited, and respect permissions |
| CSV/Excel import and export with preview and error report | None | Bad rows reported, no partial corruption |
| Tags, saved filters and saved searches | None | Per-user, shareable within a team |
| Duplicate detection and merge | Deterministic (normalised email, phone, fuzzy name); no model | Suggested duplicates reviewed by a human before merge |
| Finish the Customize Columns dialog (from the stash) and accessibility pass | None | Keyboard accessible; tests added |

### Phase 4: Resume intake and AI screening
Goal: turn resumes into structured, searchable candidates quickly and cheaply. This is where most AI spend happens, so it is designed around efficiency.

| Feature | AI usage and efficiency design | Acceptance criteria |
|---------|-------------------------------|---------------------|
| Resume upload (PDF/DOCX), virus-scan hook, size limits, retention settings | None | Files stored outside the web root; limits enforced |
| Text extraction | Non-AI (library such as pdfplumber/docling or Node equivalent, decision in section 5); OCR only for scanned files | Extraction quality checked on a sample set |
| Structured extraction (skills, experience, education, titles) | Rules and dictionaries first (emails, phones, dates, known skills); small model only for the leftover fields; JSON schema output; content-hash cache so re-uploads are free; runs in the background queue | Eval set accuracy meets the agreed threshold; failures fall back to partial rule-based profile |
| PII redaction before any model call | Names, contacts and addresses replaced with placeholders, restored after | Tests prove nothing identifying leaves the server |
| Embeddings for resumes and jobs | One embedding per document, stored once, recomputed only when content changes | Vector search works locally; no embedding call on read |
| Hybrid match score | Deterministic score (skill overlap, years, location, must-haves) plus embedding similarity; the model is used only to write a short explanation for the top N, lazily, on first view | Score reproducible and explainable; explanation cached |
| Consent and retention (GDPR basics): consent flag, data export, delete candidate, retention timer | None | Delete removes files, embeddings and cached AI results |
| Bias safeguards | Exclude protected attributes from scoring inputs; periodic fairness report on score distributions | Documented and tested |

Exit: batch of 100 resumes processed in the background with a visible progress bar and a measured cost per resume.

### Phase 5: Interviews and collaboration
Goal: structured, comparable hiring decisions and fewer manual steps.

| Feature | AI usage | Acceptance criteria |
|---------|----------|---------------------|
| Interview scheduling with Google/Outlook calendar sync and availability links | None | Invites sent, changes synced |
| Scorecards and structured feedback per interviewer | Optional: summarise all feedback for a candidate (on demand, cached until feedback changes) | Hiring manager sees one consolidated view |
| Interview question suggestions from role and resume | Small model, generated once per candidate-job pair and cached | Recruiter can edit and save |
| Email templates and sequences (nudge, reject, offer) | AI drafts a first version; recruiter edits and approves; nothing is sent automatically | Sent mail is logged on the candidate timeline |
| Notifications (in-app and email) | None | Configurable per user; no duplicate sends |
| Candidate timeline | None | Single feed of changes, notes, emails, interviews |
| Offer management (draft, approve, send, track) | Optional drafting help | Approval flow with audit trail |

### Phase 6: Search, assistant 2.0 and analytics
| Feature | AI usage and efficiency design | Acceptance criteria |
|---------|-------------------------------|---------------------|
| Natural-language search ("React devs in Austin, 5+ years") | Model converts the query to structured filters once (cached), then plain database and vector search run the query; no model per result | Results match the equivalent manual filters in tests |
| Assistant with tools (update status, add note, schedule, move stage, draft email) | Model chooses a tool; the server validates arguments with the same validators as the UI; any change needs one-click confirmation; read-only questions use retrieved context only | No tool runs without confirmation; all actions audited |
| Conversation memory kept small | Rolling summary instead of full history | Token use per turn stays flat |
| Analytics: time-to-hire, stage conversion, source quality, recruiter productivity | Weekly narrative summary generated once and cached | Numbers computed by code, never by the model |
| Scheduled and exportable reports | Optional summary text | PDF/CSV by email on a schedule |
| Provider and model settings page (admin) | Choose provider and tier per task within budget | Changes audited; secrets never shown |

### Phase 7: Sourcing, integrations and scale
Public careers page and application form; job board posting; LinkedIn/profile import; Slack/Teams notifications; webhooks and a public API with scoped keys; ATS/HRIS sync; e-signature; multi-tenant organisations; backups, monitoring and error tracking; i18n and dark mode. AI use stays optional (enrichment, outreach drafts) and goes through the gateway.

## 4. Security and compliance rules that apply to every phase

- AI keys stay server-side; browser code only sees `VITE_*` values.
- Prompts contain the minimum fields and no contact data; remote providers get stricter redaction than local ones.
- Candidate text is untrusted input to a model: system prompts say so, outputs are validated, and models never get write access without confirmation.
- Hiring decisions are never automated; scores and summaries are advisory and explained.
- New dependencies are audited; new endpoints are authenticated, validated and rate limited; findings go in `docs/SECURITY.md`.

## 5. Open decisions (need an answer before Phase 2 starts)

1. Who is the main user: a single recruiter, an agency, or an in-house team with hiring managers?
2. Resume parsing runtime: Node only, or a separate Python service (pdfplumber/docling, as the `.env` template suggests)?
3. Where may AI run: own Ollama only, or cloud providers (Anthropic, OpenAI, Gemini) allowed for some tasks?
4. Which email and calendar providers (SendGrid, SES, SMTP; Google, Outlook)?
5. Hosting target (Docker on a VM, Railway, AWS, other) and a vector store choice (MongoDB Atlas vector search, pgvector, or a local library).
6. Will real candidate data be used soon? If yes, the GDPR items move into Phase 2.
7. JIRA project key and base branch (still unconfirmed).

## Change log

| Date | Change |
|------|--------|
| 2026-10-15 | Created (draft for review) |
