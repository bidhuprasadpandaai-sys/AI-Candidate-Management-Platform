# Functional Specification

What the system does, as built (2026-10-15). Product name in the UI: **TalentOS** (sign-in pages show "NEXORA").

## 1. Purpose and scope

An AI-assisted recruiting workspace. A recruiter signs in, reviews a candidate pipeline, manages candidate records, chats with candidates, gets analytics, and asks an AI assistant questions about the pipeline.

In scope: authentication and profile, candidate pipeline management, candidate conversations, analytics, AI assistant. Out of scope today: candidate-facing emails, calendar integration, role-based permissions, resume upload and parsing, multi-tenant organisations.

## 2. Users and roles

| User | Description |
|------|-------------|
| Admin | Platform-level. Creates and manages companies, lists all users, assigns each user to one company and sets their role, reads the audit log, and sees every company's data. The first account created, and any email in `ADMIN_EMAILS`, is an admin. |
| Recruiter | Belongs to one company. Sees all of that company's candidates; creates and edits them, deletes the ones they own, chats with candidates and uses the assistant commands. |
| Hiring manager | Belongs to one company. Reads the company's candidates and adds notes and interview rounds; cannot change status or other fields. |
| Read-only | Belongs to one company. Reads the company's candidates and analytics; cannot change anything. New sign-ups start here, with no company, until an admin assigns both. |

Companies are separate: a user never sees another company's candidates, conversations, analytics or assistant answers. Every user also has a free-text job title (for example "Senior Recruiter") that is only a label.
| Anonymous visitor | Can only reach sign-up, sign-in (password or email code) and password-reset pages; every other page redirects to sign-in. |

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
| FR-16 | Four roles (Admin, Recruiter, Hiring manager, Read-only) with fixed permissions; an admin changes a user's role and the change applies immediately | Done |
| FR-17 | Ownership: the creator owns a candidate (a label for who is responsible); admins can reassign to any user of the candidate's company; recruiters can assign unowned candidates to themselves | Done |
| FR-18 | Companies: admins create, rename and delete companies (only when empty) and assign each non-admin user to exactly one company; a user without a company sees nothing | Done |
| FR-19 | Isolation: users see only their own company's candidates (admins see all); dashboard, analytics, search, chat, conversations and the assistant use the same scope; candidate emails are unique within a company, not across companies | Done |
| FR-20 | Email-code sign-in: request a 6-digit code by email (valid 10 minutes, single use) as an alternative to the password | Done |
| FR-21 | Audit log: every sign-in, role or company change, candidate create/update/assign/delete and assistant action is recorded; admins browse and filter it; each candidate shows its own activity | Done |
| FR-22 | Admins can disable and re-enable accounts; at least one active admin must remain | Done |
| FR-23 | Job openings: title, department, location, status (draft, open, on hold, closed), hiring manager (an active user of the company) and description; recruiters and admins create, edit, close and delete (only when no candidates are linked); everyone in the company can read | Done |
| FR-24 | A candidate can apply to several jobs of their own company; each application has its own pipeline stage and its own fit score; the candidate's overall status is the furthest stage reached and is no longer edited directly once they have applications | Done |
| FR-25 | Pipeline board per job: one column per stage with a card per application (candidate, the fit score for this job, profile completion); recruiters and admins move cards by drag and drop or the stage menu, which changes only that job's application; hiring managers and read-only users view only | Done |
| FR-26 | Resume autofill in the Add Candidate popup (PDF or Word, up to 5 MB): the app reads the file and fills in the form (name, email, phone, role, location, years of experience, skills, summary) with warnings and "please check" marks, the user corrects it, and saving creates the candidate with the resume attached | Done |
| FR-27 | Resume handling: duplicate uploads of the same file are detected, an existing candidate with the same email is flagged, the original file can be downloaded by the company's users, the resume is uploaded inside the Add Candidate popup (autofill) or attached later in the candidate's panel, and deleting a candidate deletes its resume | Done |
| FR-29 | Profile completion: a 0-100 score for each candidate from nine items (name, email, phone, role, location, years of experience, three or more skills, a summary of at least 40 characters, a resume), shown on cards, in the table and in the panel with the missing items | Done |
| FR-30 | Match score per job: for each application, a 0-100 fit score from the candidate's profile, parsed resume and that job's description (skills 45%, experience 25%, role match 15%, location 5%, profile completeness 10%) with explanation, breakdown, matched and missing skills and warnings; the candidate's stored score is their best fit; the manual match score field is removed | Done |
| FR-31 | Job details: employment type (full time or part time), a facility chosen from the company's own list, pay rate minimum and maximum and bill rate minimum and maximum (one currency chosen from the company's preset list, per hour, day, week, month or year), an expiry date and a maximum number of applications | Done |
| FR-32 | Company settings (admins): each company has its own preset list of currencies (from a fixed list of 20) and its own list of facilities; a currency or facility that jobs still use cannot be removed, and renaming a facility keeps its jobs | Done |
| FR-33 | Application limits: no candidate can be added to a job that is closed, on hold, a draft, past its expiry date (the expiry day itself is still open), or already has its maximum number of applications; the jobs table shows "applications used / maximum" with Expired and Full tags and those jobs are not offered when adding a candidate to a job | Done |
| FR-34 | Bill rates are commercially sensitive: only admins and recruiters (people who manage jobs) see them; hiring managers and read-only users see pay rates only | Done |
| FR-35 | White-label branding: each company has its own display name, tagline, logo (PNG, JPEG or WebP up to 256 KB), primary and accent colours, website, support email, phone and address, set by an admin in Admin → Companies → Branding; the company's users see its name, logo and colours across the app (sidebar, page header, buttons, browser tab title), and users without a company, and the sign-in pages, see the platform default (TalentOS) | Done |
| FR-36 | A resume attached from an existing candidate's screen is stored but never changes the profile by itself; the user is then asked which differing details (phone, location, role, years, skills, summary) to update, and the name and email are never offered; "Keep current profile" changes nothing | Done |
| FR-37 | A resume whose email already belongs to a candidate does not fill the Add Candidate form, is not kept, and the user is offered the existing profile | Done |
| FR-38 | Other documents per candidate (certificate, licence, ID proof, contract, reference, medical, other; PDF, Word, PNG or JPEG up to 5 MB, 20 per candidate) with an optional expiry date; after that date the document is marked Expired (the expiry day itself is still valid; within 30 days it shows "Expires in N days"); recruiters and admins add, edit and delete, others can view and download | Done |
| FR-39 | The candidate overlay is split into tabs: Overview, Jobs, Documents, Notes and Activity, with counts and a red alert on Documents when something has expired | Done |
| FR-40 | A facility has a name, location, address and pin code (only the name is required) and belongs to one company; it is never visible to or usable by another company. Admins manage the full list (add, edit, remove, search by name, location, address or pin code) in Admin → Companies → Settings; anyone who manages jobs can add a new facility for their company straight from the job form ("Add new facility"), and it is selected for the job | Done |
| FR-28 | Candidates have an optional phone number | Done |
| FR-15 | Customizable table columns (show/hide, reorder, custom columns) | Partial: column visibility, order and custom columns are stored in the browser; a redesigned drag-and-drop "Customize Columns" dialog exists only in a local git stash ("candidate overlay old changes") and is not shipped |

## 4. User flows

1. **Sign up and in:** Sign-up form validates fields, creates the account, then redirects to sign-in with a success message. Sign-in sets the session cookie and opens the Overview. Wrong credentials show the server error and stay on the page. Repeated attempts are throttled (20 per 15 minutes per IP).
1b. **Sign in with an email code:** On the sign-in page choose **Email code**, enter the address, click **Send code**, type the 6-digit code from the email and click **Verify and sign in**. The code works once and expires after 10 minutes; a new one can be requested after a minute. The same message is shown whether or not the address has an account.
1c. **Company settings (admins):** In **Admin → Companies**, **Settings** sets the company's currencies (pick from the list) and its facilities (add, rename, remove).
2. **Review the pipeline:** Overview shows platform status and metrics. Candidates lists the pipeline; searching, filtering by status, sorting and paging update the list. Clicking a row opens the detail panel.
3. **Manage a candidate:** Add Candidate opens a form (name, email, role required). In the detail panel the recruiter changes status, schedules interview rounds (title, date, time, interviewer, type), logs notes, or deletes the candidate.
4. **Chat:** Start an individual or group conversation from the Chat module, send text and attachments, delete conversations.
5. **Ask the AI assistant:** Type a question. Commands like "Move Ava Thompson to offer", "Hire Noah Patel", "Note for Ava: strong coder" or "Schedule Technical interview for Noah Patel on Monday at 2 PM with Dave" change data and the lists refresh. Any other question is answered by the model (if enabled) or the rule-based summary and top-candidate replies. If the model is unreachable the rule-based reply is used.
6. **Admin:** Admins open **Admin** in the navigation. **Users** lists everyone with a role selector, a company selector and Disable/Enable; **Companies** creates and deletes companies (showing user and candidate counts) and can move candidates that have no company into a company; **Audit log** lists activity with filters by action, person and company. Admins cannot change their own role or disable themselves.
7. **Ownership and activity:** In a candidate's detail panel the **Ownership** section shows the company and owner. Admins can change the company (the owner is cleared if they do not belong to the new company) and set the owner from that company's users; a recruiter can **Assign to me** on unowned candidates. The **Activity** section lists what happened to that candidate.
8. **Jobs and the pipeline board:** Open **Jobs**. **Openings** lists the company's jobs; recruiters and admins use **Add job** (admins also choose the company; the job form also has employment type, facility, currency, pay and bill rate ranges, expiry date and maximum applications; the company's currency and facility lists decide the choices), **Edit**, **Close/Reopen** and **Delete**. **Pipeline board** shows the chosen job's candidates in five stage columns. Drag a card to another column or use the stage menu on the card; click a name to open the candidate. A candidate can be linked to a job when it is created or from the candidate's panel.
9. **Add a candidate from a resume:** In **Candidates**, click **Add Candidate**. At the top of the popup, **Autofill from a resume** takes a PDF or Word file (up to 5 MB; admins choose the company first). The app reads it and fills in the empty fields (name, email, phone, role, location, years of experience, skills, summary); fields the reader was unsure about, or the AI suggested, are marked "please check". Edit anything, optionally choose a job, and click **Save Profile**: the candidate is created with the resume attached. Remove or close without saving discards the uploaded file. In a candidate's panel, **Download resume** gets the original file and **Attach/Replace resume** adds or swaps it.
9b. **Profile completion and match score per job:** Every candidate card, table row and the candidate panel shows a **Profile** percentage. In the panel, **Jobs and fit** lists every job the candidate applied to with its own fit score badge, stage menu and an expandable explanation (breakdown, skills they have and lack, warnings); **Add to a job** applies them to another open job and the x removes an application. The overall status is read-only while they have applications ("set per job"). The candidate table's **Match** column shows the fit for up to two jobs; each board card shows the fit for that board's job. Scores update as soon as the profile, resume or a job description changes.
10. **Profile:** Edit profile details, avatar and social links, or change the password.

## 5. Acceptance criteria

- An anonymous request to any data endpoint returns 401; the UI redirects to sign-in.
- A user from another company gets 404 for a candidate (it never appears in lists, counts, analytics, chat or assistant answers); a user without a company sees nothing and cannot add candidates.
- A user without the permission gets 403; a candidate outside the user's company returns 404.
- A role change, company change or account disabling takes effect on the user's next request without signing in again.
- The assistant cannot do anything the user's role does not allow, and its actions appear in the audit log marked as AI.
- A wrong, expired or reused email code is rejected; five wrong guesses make the code unusable.
- The audit log has no way to edit or delete entries and never contains passwords, codes or tokens.
- A weak password or invalid email is rejected at sign-up with a clear message.
- Status changes made through the assistant appear in the candidate list and dashboard without a manual reload.
- The assistant never changes data from a free-form model answer.
- With no database configured the app is fully usable with six demo candidates.
- Invalid candidate data (missing fields, bad email or status, out-of-range score) is rejected with a clear message and nothing is saved; a duplicate email is rejected.
- Contact details (email, phone), names and notes are never sent to the AI model, including during resume reading.
- A resume that is not a real PDF or Word file, is larger than 5 MB, or has no readable text is rejected with a clear message; the file's name and type claims are never trusted.
- A user from another company cannot see, download, link or delete a company's resumes or jobs, or read a candidate's job fit.
- The job fit score is reproducible: the same profile, resume and job description always give the same score; the AI (if enabled) can only reword the explanation and never changes the number.
- A job that still has applications cannot be deleted.
- A minimum rate above its maximum, a currency or facility from another company, an expiry date in the past, or a maximum application count below 1 is refused with a clear message.
- Bill rates never reach the browser of a hiring manager or read-only user.

Automated coverage of these criteria: see `docs/TechnicalSpecification.md` section 6.

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
| 2026-10-15 | 1 | Filled in from the implemented code |
