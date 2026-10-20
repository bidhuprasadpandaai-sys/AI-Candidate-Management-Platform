# Design

As built, 2026-10-15.

## 1. Design principles

- **Zero-setup first:** the app runs with demo data and no database, keys or email.
- **Safe by default:** server-side secrets, least-privilege data sent to the model, protected routes, throttled auth.
- **Assistant assists, never decides:** the model drafts answers; only explicit rule-parsed commands change data.
- **Consistent, calm UI:** a glass-card dashboard look with one accent gradient; status colours carry meaning.

## 2. UI / UX

- **Layout:** left "Platform shell" navigation (Overview, Candidates, Chat, AI Assistant, Analytics, Profile Settings) with the signed-in user at the bottom; a header with the module name; content area per module. Responsive breakpoints at 1150px and 768px.
- **Sign-in methods:** the sign-in card has a two-option switch, **Password** and **Email code**. Email code is two steps in the same card: enter the email and **Send code**, then enter the 6-digit code and **Verify and sign in**; a resend link counts down 60 seconds, and a link lets the user go back to change the email.
- **Role-aware UI:** controls the user may not use are hidden or disabled (Add Candidate, status selector, Delete, notes, Schedule Round, the Admin item), based on the same rules the API enforces. The footer shows the access level, job title and company (for example "Recruiter (title: Manager) · Acme Corp"). A user without a company sees a warning banner; a read-only user sees an info banner. When an admin adds a candidate, the form asks which company it belongs to.
- **Admin module:** three tabs, **Users** (role selector, company selector, Disable/Enable; the signed-in admin's own row is locked), **Companies** (create form, list with user and candidate counts, Delete, and a "Move unassigned here" action when candidates have no company) and **Audit log** (filters by action, person and company, source tag, load older entries). Messages confirm or explain each action.
- **Jobs table columns:** job, type, pay rate ("EUR 40 – 60.5 / hour"), bill rate (managers only), facility, expiry date with an Expired tag, hiring manager, applications ("3 / 5" with a Full tag), status and actions. Form errors appear once, inside the dialog.
- **Company settings (Admin → Companies → Settings):** a currency multi-select and an editable facility list (add, rename, remove).
- **Jobs module:** two tabs. **Openings** is a table (job and department/location, company for admins, status tag, hiring manager, candidate count) with Board, Edit, Close/Reopen and Delete; **Add job** (one button, in the header) opens a dialog: title, department, location, status, hiring manager, employment type, facility, currency, the unit the rates are in, pay rate minimum and maximum, bill rate minimum and maximum, expiry date, maximum applications and description (admins also choose the company first; the currency and facility lists change with the company). **Pipeline board** has a job selector (plus "Candidates without a job") and five stage columns (Screening, Interview, Offer, Hired, Rejected) with counts. Cards show name, role, the fit score for this board's job (a coloured badge), owner, a paperclip when a resume is on file and up to three skills; a card is dragged to another column, and every card also has a stage menu (keyboard and touch friendly). A column highlights while a card is over it. Read-only users and hiring managers see the board without drag handles or menus. Clicking a name opens the candidate panel.
- **Resume autofill (Add Candidate popup):** the **Add Candidate** popup has an **Autofill from a resume** box at the top (admins pick the company first). Choosing a PDF or Word file reads it at once and fills the empty fields; the file chip shows its name and how it was read, with Remove. Uncertain fields show "Please check" or "Suggested by AI: please check"; warning banners cover a missing or duplicate email and a file already used (saving is blocked then). The popup also has Phone and Job (optional) fields. Closing without saving, or Remove, discards the uploaded file.
- **Profile completion:** a small bar and percentage ("Profile 78%") on every pipeline card and table row (red under 35, amber under 60, blue under 85, green from 85), with the missing items in the tooltip; the candidate panel has a **Profile completion** section listing what to add.
- **Jobs and fit (candidate panel):** one entry per job the candidate applied to: a round fit badge (colour by level), the job title and label, a stage menu (editors) and a remove button; the best job is expanded to show the explanation (marked when the AI worded it), five factor bars with weights and reasons, green chips for required skills the candidate has, red chips for those missing, and amber warnings. **Add to a job** offers the company's other open jobs. The overall status dropdown is disabled with a note while the candidate has applications. Without any job it explains how to add one.
- **Match column (candidate table):** replaces the manual Score: up to two chips "82 Senior Engineer" coloured by level, "+N more", or a dash.
- **Candidate panel additions:** a **Job and resume** section (job selector for editors, Download resume, Attach/Replace resume) and the candidate's phone number.
- **Ownership and activity:** the candidate detail panel has an **Ownership** section (company, owner, and the controls the user is allowed: admins set company and owner; recruiters can Assign to me) and an **Activity** list with AI actions labelled.
- **Auth pages:** centred card on a soft gradient with decorative orbs; email and password fields with icons, a password reveal toggle, "Remember me", links to reset and sign-up, inline success and error messages.
- **Visual language:** CSS variables in `apps/web/src/styles.css` (Outfit / Inter font stack, blue-to-violet primary gradient, green success gradient, translucent glass cards with soft shadows). PrimeVue 3 (Lara Light Blue) supplies buttons, dialogs, inputs, tags and dropdowns.
- **Status colours:** screening = info, interview = warning, offer and hired = success, rejected = danger.
- **Candidates:** data table with sortable columns (Candidate, Role, Status, Score, Stage, Location, Skills, Experience, Email), search box, status dropdown, Add Candidate, Refresh, pagination, clickable rows that open the detail sidebar. Column choices persist in `localStorage`.
- **Candidate detail sidebar:** header with name, status selector, delete; core skills; "Recruiting AI Insight" profile fit; scheduled interviews with a "Schedule Round" form; recruiter notes log.
- **AI Assistant:** chat feed with "AI:" and "You:" labels, a multi-line input (Enter sends, Shift+Enter adds a line), Send button with loading state, friendly message when the API is down.
- **Analytics:** funnel, seniority experience spread, skill density, top candidates, average score.
- **Chat module:** conversation list with new-conversation modal (individual or group), message thread with attachments.
- **Profile:** avatar edit, personal, contact, social and account sections; separate change-password form.
- **Accessibility:** labelled form fields, icon buttons with aria-labels in places; not yet audited (see Open items).

## 3. Component design

| Component | Role |
|-----------|------|
| `App.vue` | Shell, auth gate (loads user, redirects to `/signin`), module switching |
| `views/SignIn|SignUp|ResetPassword.vue` | Auth forms (validate, call API with credentials) |
| `stores/auth.js`, `stores/candidates.js` | Pinia state and API actions (candidates, dashboard, chat history) |
| `components/modules/*Module.vue` | Lazy-loaded feature screens |
| `DashboardCards`, `AppHeader`, `AIAssistantPanel` | Small presentational/connected components with unit tests |
| `CandidateList`, `CandidateDetailSidebar`, `AddCandidateModal`, `CandidateChatSidebar` | Candidate management UI |
| `@acmp/chat` components | Reusable chat UI |
| API `requireAuth`, `services/llm.js`, `routes/auth.js` | Server building blocks |

## 4. Error handling

- **API:** JSON errors with `error` or `message`; 400 validation, 401 unauthenticated, 404 missing, 409 duplicate user, 429 throttled, 500 handled by a central error middleware (details are logged, not leaked beyond the message).
- **Web:** forms show the server message inline; stores catch failures, set `lastError` and `backendReady=false`; the assistant replies with "The API is currently unavailable..."; the API client retries alternate base URLs only on network or 5xx errors.
- **LLM:** timeouts (20s default) and errors fall back to rule-based replies and log only the error type, never message content or keys.

## 5. Open items

- Accessibility audit of the new tabs (the switch uses `role=tab`; the Admin tables and dropdowns need keyboard and screen-reader checks); also (keyboard navigation of the table and drag-and-drop column dialog, contrast, focus management).
- The redesigned "Customize Columns" dialog (drag-and-drop reorder, Select All, Save/Cancel draft) lives only in a local git stash and is not part of the shipped design; the shipped UI uses the column popup.
- No dark mode.

## Job dialog

The Add/Edit job dialog (48 rem) is a stack of cards with an icon, title and one line of help each: **Basics** (company for admins, title, department, location, employment type, facility with a searchable list and an inline "Add new facility" panel), **Hiring** (status, hiring manager), **Pay and billing** (currency, unit, pay range and bill range as "minimum to maximum" blocks, and a live "Pay EUR 40 – 60 / hour" chip), **Application limits** (expiry date, maximum applications) and **Description** (with a character count). Adding a facility is inline, not a second dialog, so lists never hide behind stacked overlays.

## Candidate overlay

The overlay is wider (46 rem) and shows one topic at a time through tabs: **Overview** (snapshot, stage, profile completion, skills, AI insight, ownership), **Jobs** (jobs and fit), **Documents** (resume, then other documents with expiry state), **Notes** (interviews and notes) and **Activity**. The header carries name, role, location and the best match score. Tabs show counts (Jobs, Notes) and a red badge on Documents when a document has expired. Each section is a white card. Attaching a resume opens a small dialog that lists only the differing fields with old and new values and ticked boxes.

## Visual design and branding

The full rules (tokens, colours, typography, spacing, components, checklist) are in `docs/UIStyleGuide.md`. In short: light grey page, white cards, one dark sidebar with icons, one brand colour. Brand colours are not fixed: they come from the signed-in company's branding and are applied as CSS variables (`--primary-*`, `--accent-color`), including to PrimeVue controls. The company's logo and display name appear in the sidebar and in the page header chip; **Admin → Companies → Branding** edits them with a live preview.

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
| 2026-10-15 | 1 | Filled in from the implemented code |
