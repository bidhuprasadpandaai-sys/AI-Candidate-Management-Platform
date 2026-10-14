# Functional Specification

What the system does, as built (2026-10-15). Product name in the UI: **TalentOS** (sign-in pages show "NEXORA").

## 1. Purpose and scope

An AI-assisted recruiting workspace. A recruiter signs in, reviews a candidate pipeline, manages candidate records, chats with candidates, gets analytics, and asks an AI assistant questions about the pipeline.

In scope: authentication and profile, candidate pipeline management, candidate conversations, analytics, AI assistant. Out of scope today: candidate-facing emails, calendar integration, role-based permissions, resume upload and parsing, multi-tenant organisations.

## 2. Users and roles

| User | Description |
|------|-------------|
| Recruiter | The only user type. Signs up with a name, email, password and optional role label and phone. All signed-in users see the same shared pipeline (no per-user or per-role data separation yet). |
| Anonymous visitor | Can only reach sign-up, sign-in and password-reset pages; every other page redirects to sign-in. |

## 3. Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| FR-1 | Sign up with name, valid email and a password of 8+ characters containing an uppercase letter and a number | Done |
| FR-2 | Sign in and out; session lasts 8 hours (configurable) in an HttpOnly cookie | Done |
| FR-3 | Password reset by emailed link (single-use token, 1 hour); change password while signed in; the response never reveals whether an address has an account | Done; real delivery needs `EMAIL_PROVIDER=smtp` and a provider account |
| FR-4 | Optional email verification before sign-in (`REQUIRE_EMAIL_VERIFICATION=true`) | Done |
| FR-5 | Edit own profile: name, phone, role, avatar, social links | Done |
| FR-6 | Dashboard metrics: total candidates, shortlisted, hired, average score | Done |
| FR-7 | Candidate list with search, status filter, sorting, pagination | Done |
| FR-8 | Add, edit and delete candidates (name, email, role, location, status, stage, experience, skills, summary); input is validated (required name, email and role, valid email, status from the fixed list, score 0-100) and duplicate emails are rejected | Done |
| FR-9 | Candidate detail panel: skills, AI insight, interviews (schedule, list) and recruiter notes | Done |
| FR-10 | Conversations with one or several candidates (individual or group), messages and attachments | Done |
| FR-11 | Analytics: pipeline funnel, stage distribution, experience spread, top skills, top candidates, average score | Done |
| FR-12 | AI assistant answers pipeline questions in natural language | Done (rule-based, or Ollama model when enabled) |
| FR-13 | AI assistant executes simple commands: change status, hire/reject, add note, schedule interview | Done (rule-based only; the model never changes data) |
| FR-14 | Works without MongoDB using in-memory demo data; seed endpoint resets demo data | Done |
| FR-15 | Customizable table columns (show/hide, reorder, custom columns) | Partial: column visibility, order and custom columns are stored in the browser; a redesigned drag-and-drop "Customize Columns" dialog exists only in a local git stash ("candidate overlay old changes") and is not shipped |

## 4. User flows

1. **Sign up and in:** Sign-up form validates fields, creates the account, then redirects to sign-in with a success message. Sign-in sets the session cookie and opens the Overview. Wrong credentials show the server error and stay on the page. Repeated attempts are throttled (20 per 15 minutes per IP).
2. **Review the pipeline:** Overview shows platform status and metrics. Candidates lists the pipeline; searching, filtering by status, sorting and paging update the list. Clicking a row opens the detail panel.
3. **Manage a candidate:** Add Candidate opens a form (name, email, role required). In the detail panel the recruiter changes status, schedules interview rounds (title, date, time, interviewer, type), logs notes, or deletes the candidate.
4. **Chat:** Start an individual or group conversation from the Chat module, send text and attachments, delete conversations.
5. **Ask the AI assistant:** Type a question. Commands like "Move Ava Thompson to offer", "Hire Noah Patel", "Note for Ava: strong coder" or "Schedule Technical interview for Noah Patel on Monday at 2 PM with Dave" change data and the lists refresh. Any other question is answered by the model (if enabled) or the rule-based summary and top-candidate replies. If the model is unreachable the rule-based reply is used.
6. **Profile:** Edit profile details, avatar and social links, or change the password.

## 5. Acceptance criteria

- An anonymous request to any data endpoint returns 401; the UI redirects to sign-in.
- A weak password or invalid email is rejected at sign-up with a clear message.
- Status changes made through the assistant appear in the candidate list and dashboard without a manual reload.
- The assistant never changes data from a free-form model answer.
- With no database configured the app is fully usable with six demo candidates.
- Invalid candidate data (missing fields, bad email or status, out-of-range score) is rejected with a clear message and nothing is saved; a duplicate email is rejected.
- Contact details (email, phone) and notes are never sent to the AI model.

Automated coverage of these criteria: see `docs/TechnicalSpecification.md` section 6.

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
| 2026-10-15 | 1 | Filled in from the implemented code |
