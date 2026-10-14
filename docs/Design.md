# Design

As built, 2026-10-15.

## 1. Design principles

- **Zero-setup first:** the app runs with demo data and no database, keys or email.
- **Safe by default:** server-side secrets, least-privilege data sent to the model, protected routes, throttled auth.
- **Assistant assists, never decides:** the model drafts answers; only explicit rule-parsed commands change data.
- **Consistent, calm UI:** a glass-card dashboard look with one accent gradient; status colours carry meaning.

## 2. UI / UX

- **Layout:** left "Platform shell" navigation (Overview, Candidates, Chat, AI Assistant, Analytics, Profile Settings) with the signed-in user at the bottom; a header with the module name; content area per module. Responsive breakpoints at 1150px and 768px.
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

- Accessibility audit (keyboard navigation of the table and drag-and-drop column dialog, contrast, focus management).
- The redesigned "Customize Columns" dialog (drag-and-drop reorder, Select All, Save/Cancel draft) lives only in a local git stash and is not part of the shipped design; the shipped UI uses the column popup.
- No dark mode.

## Change log

| Date | Phase | Change |
|------|-------|--------|
| 2026-10-14 | - | Skeleton created |
| 2026-10-15 | 1 | Filled in from the implemented code |
