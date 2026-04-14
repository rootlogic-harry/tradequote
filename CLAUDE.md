# CLAUDE.md — FastQuote

## What FastQuote Is

FastQuote is a production AI-powered quote generator for dry stone walling professionals. A tradesman photographs a damaged wall, enters a job address, and receives a professionally formatted, print-ready quote in under 5 minutes. Currently one active user (Mark, admin) with a second user (Paul, basic plan) being onboarded.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, Tailwind CSS (CDN) |
| Backend | Express 5.2, Node 18+, raw `pg` (no ORM) |
| Database | PostgreSQL 15+ (Railway managed), JSONB snapshots |
| AI | Anthropic Claude Sonnet 4 (server-side proxy) |
| AI Agents | Claude Haiku 4.5 (self-critique, feedback, calibration) |
| PDF | html2canvas + jsPDF (client-side, CDN) |
| DOCX | `docx` library (v9.6.1) |
| Auth | Google OAuth 2.0 + legacy session switcher |
| Sessions | connect-pg-simple (PostgreSQL-backed) |
| Testing | Jest 29 (ESM), TDD |
| Hosting | Railway (auto-deploy on push to `main`) |
| Fonts | Barlow Condensed (headings), IBM Plex Sans (body), IBM Plex Mono (money) |

---

## Architecture

### Backend (server.js)

Single Express server with PostgreSQL. Schema is self-initialising (CREATE TABLE IF NOT EXISTS). Routes are grouped:

- **Auth**: Google OAuth via Passport, legacy session switcher, `/auth/me` for current user
- **Users**: CRUD, profile (JSONB), settings (key-value), theme
- **Jobs**: CRUD with JSONB `quote_snapshot` and `rams_snapshot`, status lifecycle (draft → sent → accepted/declined → completed)
- **Diffs**: Learning data stored in `quote_diffs` per job
- **Photos**: Slot-based upload (overview, closeup, sideProfile, referenceCard, access) stored as TEXT in `user_photos`
- **Drafts**: Auto-save/restore via `drafts` table
- **AI Proxy**: `/api/anthropic/messages` and `/api/users/:id/analyse` with rate limiting
- **Admin**: Learning dashboard, agent runs, calibration notes (all behind `requireAdminPlan` middleware)

### Frontend

Single-page React app. All state in one `useReducer` in `App.jsx`. Five-step workflow:

1. **Profile Setup** — company details, day rate, VAT
2. **Job Details** — client info, 5 photo slots, brief notes
3. **AI Analysis** — loading screen (auto-advances)
4. **Review & Edit** — three-column desktop, accordion mobile. Measurements must all be confirmed
5. **Quote Output** — document preview, PDF/DOCX export, email

Quick Quote mode skips Step 4: auto-confirms all measurements and lands on Step 5.

### Vite Build

`vite build` produces `dist/`. Express serves static files from `dist/` in production. Dev mode uses Vite proxy for `/api` routes.

---

## Data Model

### Tables

| Table | Purpose |
|-------|---------|
| `users` | id, name, email, plan (admin\|basic), profile_complete |
| `profiles` | user_id → JSONB data (company, rates, accreditations) |
| `settings` | user_id + key → JSONB value (theme, etc.) |
| `jobs` | JSONB quote_snapshot + rams_snapshot, status lifecycle, total_amount |
| `drafts` | Auto-saved work-in-progress (one per user) |
| `user_photos` | Slot-based photo storage (context: draft or job ID) |
| `quote_diffs` | Per-field AI vs confirmed value diffs (learning engine) |
| `agent_runs` | Agent execution log (type, status, tokens, duration) |
| `calibration_notes` | Proposed/approved system prompt adjustments |
| `session` | Express session store (connect-pg-simple) |

### JSONB Snapshot Contract

Jobs store a `quote_snapshot` containing only keys from `SAVE_ALLOWLIST` (defined in `src/utils/stripBlobs.js`):

```
profile, jobDetails, reviewData, quotePayload, quoteSequence, quoteMode, diffs
```

New state fields must be added to `SAVE_ALLOWLIST` consciously to be persisted. Photos are stored separately in `user_photos`, not in the snapshot.

### Immutable `aiValue` Contract

**This is the most important rule in the codebase.**

Every AI-suggested numeric value has two properties:
```javascript
{ aiValue: "4500", value: "4500" }
```

`aiValue` is set once when the AI response arrives and is NEVER overwritten. Only `value` is editable. The diff is always `(value - aiValue)`. If `aiValue` gets overwritten, all learning data is corrupted.

This is enforced structurally in `aiParser.js` (normalisation) and the reducer (only `value` updates on confirm/edit).

---

## Design Law: Two Layers, Never Mixed

FastQuote has one customer-facing product and one admin operating layer. They must never be mixed.

**Customer-facing product (basic users):**
A quoting workflow. The user uploads photos, reviews the analysis, confirms figures, generates a quote, saves it, reopens it later, exports to PDF. That is the entire product surface. The system may run intelligence behind the scenes — self-critique, calibration, learning — but the user never sees it, never knows about it, and never encounters language that implies it.

**Admin operating layer (admin users):**
The same quoting workflow, plus the system that makes it smarter over time: learning dashboard, agent activity, calibration manager, completion feedback, RAMS editor, diff analysis, bias tracking. Admins understand that FastQuote is also a learning system. Basic users do not.

This separation is a design law, not a preference. Every future change must respect it.

---

## Visibility Rules — Enforced Everywhere

Basic users must never encounter any of the following in any UI surface — labels, headings, tooltips, banners, status messages, loading text, empty states, error messages, or settings:

**Banned vocabulary for basic users:**
- AI, artificial intelligence, model, LLM, Claude, Sonnet, prompt
- confidence, calibration, calibration notes
- smart estimate, optimised result, intelligent
- learnings, learning dashboard, learning quality
- accuracy, bias, drift
- agent, agent activity, agent run, self-critique, critique notes
- diff, diff tracking, edit magnitude
- system prompt, prompt mechanics
- debug, observability, instrumentation

This list is broader than string suppression. The test `aiTextRemoval.test.js` catches literal "AI" references but cannot catch vocabulary that leaks the wrong abstraction without containing those letters. The rule is: if a label would make a basic user think "this is some kind of AI system," it is wrong.

**Admin users may see all of the above.** The admin operating layer exists specifically to expose these internals.

**Hidden intelligence is permitted.** The server can run self-critique automatically for all users. The learning data can be captured for all users. But the surface of the app for basic users must present this as "the quote loads, and it looks sensible."

---

## Plan Model

Two plans only: `admin` and `basic`. No `standard` plan (legacy references were migrated).

- **`isAdminPlan()`** in `src/utils/isAdminPlan.js` is the sole admin-branching primitive on the frontend. Accepts a string or user object. Returns boolean.
- **`requireAdminPlan`** middleware in `server.js` gates admin API routes.
- Component prop defaults are `isAdminPlan = false` (fail-safe: new components default to basic user view).
- No raw `plan === 'admin'` checks outside these two locations.

---

## Save Snapshot Contract

`SAVE_ALLOWLIST` in `src/utils/stripBlobs.js` defines exactly which state keys are persisted:

```javascript
['profile', 'jobDetails', 'reviewData', 'quotePayload', 'quoteSequence', 'quoteMode', 'diffs']
```

`buildSaveSnapshot(state)` picks only these keys, then strips base64 blobs. Adding a new field to saved state requires adding it to the allowlist — this is intentionally a conscious decision.

Excluded: `aiRawResponse`, `photos`, `extraPhotos`, `step`, `isAnalysing`, `rams`, and any future transient state.

---

## AI Agents

Three async agents, all Haiku 4.5, all logged to `agent_runs` table:

| Agent | File | Purpose | Trigger |
|-------|------|---------|---------|
| Self-critique | `agents/selfCritique.js` | Reviews analysis for internal consistency (tonnage, labour, materials) | After AI analysis, before Step 4 |
| Feedback | `agents/feedbackAgent.js` | Learns from completed jobs + tradesman feedback | Job marked complete with feedback |
| Calibration | `agents/calibrationAgent.js` | Proposes system prompt calibration notes from aggregate diff data | Manual admin trigger |

Agent orchestration lives in `agents/agentUtils.js`: creates run records, calls Anthropic API, parses JSON responses, logs results.

---

## RAMS

Risk Assessment & Method Statement editor. 9-section accordion:

1. Job Details
2. Work Types
3. Method Statement (work stages)
4. Risk Assessments (editable table with likelihood/consequence matrix)
5. Risk Matrix (visual reference)
6. PPE Requirements
7. Site Details
8. Personnel
9. Contact Details

Completion tracking bar at top. Sticky pill bar for quick-jump navigation. Export to PDF and DOCX. RAMS data stored as `rams_snapshot` JSONB in the jobs table.

---

## Testing

**Framework:** Jest 29 with ESM support.

**Command:** `npm test`

**Current count:** 463 tests across 15 suites (includes 3 plan regression tests).

**TDD approach:** Write tests first, confirm failure, implement, confirm green.

Test files live in `src/__tests__/`. Key test suites:
- `calculations.test.js` — pure financial functions
- `validators.test.js` — input validation
- `aiParser.test.js` — AI response parsing/normalisation
- `diffTracking.test.js` — learning diff construction
- `quoteBuilder.test.js` — quote reference, formatting, payload assembly
- `reducer.test.js` — state management actions
- `saveFlow.test.js` — save snapshot, SAVE_ALLOWLIST, error state
- `planNormalisation.test.js` — isAdminPlan utility, source-level scan
- `selfCritique.test.js`, `feedbackAgent.test.js`, `calibrationAgent.test.js` — agent tests
- `aiTextRemoval.test.js` — banned vocabulary enforcement

---

## Auth

**Primary:** Google OAuth 2.0 via Passport. Session stored in PostgreSQL via connect-pg-simple. Cookie: `tq_session`.

**Legacy:** Session-based user switcher for development (Mark/Harry). Uses `req.session.legacyUserId`.

**Flow:** `/auth/google` → Google consent → `/auth/google/callback` → redirect to `/` (or `/?onboarding=true` for new users). New Google users land on profile setup before accessing the dashboard.

---

## Mobile

- Accordion layout below `md` breakpoint for Review & Edit (measurements, costs, schedule, damage description)
- 44px minimum touch targets on all interactive elements
- Single-column photo grid
- Required photo slots: solid primary border. Recommended: dashed grey border
- RAMS: horizontal scrolling pill bar for section navigation

---

## Known Limitations

- PDF page break issues on long quotes (html2canvas limitation)
- RAMS mobile navigation relies on scroll-to with pill bar — no native anchor support
- Game state is in-memory for session data; server redeploy clears active sessions
- Self-critique agent runs synchronously after analysis — adds ~2s to Step 3 load time

---

## What to Update When

Same-commit update policy: if a change affects any of the following, update this file in the same commit.

- New state field → add to SAVE_ALLOWLIST if it should persist
- New plan type → update isAdminPlan utility
- New agent → add to agents table above
- New table → add to data model
- New API route → mention in architecture section
- Test count changes significantly → update count
- New component with `isAdminPlan` prop → default to `false`
