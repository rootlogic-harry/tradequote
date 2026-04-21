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
| Voice-to-text | OpenAI Whisper (`openai` SDK), `multer` for upload |
| Video processing | ffmpeg (apt), fluent-ffmpeg (frame extraction, audio extraction) |
| Testing | Jest 29 (ESM), TDD |
| Hosting | Railway (auto-deploy on push to `main`) |
| Fonts | Barlow Condensed (headings), Inter (body), JetBrains Mono (money) |

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
- **Dictation**: `POST /api/dictate` — multipart audio upload → OpenAI Whisper → transcript. Rate limited (30/5min), session-derived user, in-memory audio only (no disk)
- **Video**: `POST /api/users/:id/jobs/:jobId/video` — multer disk storage (100MB), ffmpeg frame extraction + audio extraction, Whisper transcription, Claude analysis. Rate limited (5/hour). Cleans up temp files. Server-side AI normalisation via aiParser pipeline. Client uploads via XHR with real progress tracking and automatic retry (3 attempts, exponential backoff).
- **Video Progress**: `GET /api/users/:id/jobs/:jobId/video/progress` — SSE endpoint for real-time progress. Emits stages: processing (10%), analysing (50%), reviewing (80%), complete (100%). Client connects before upload, falls back to time-based estimation if SSE unavailable.
- **Admin**: Learning dashboard, agent runs, calibration notes (all behind `requireAdminPlan` middleware)
- **Client Portal (TRQ-124 onwards)**: `POST /api/users/:id/jobs/:jobId/client-token` generates a UUID v4 token and freezes both the current `quote_snapshot` and the tradesman's profile into `jobs.client_snapshot` + `jobs.client_snapshot_profile`. `GET /api/users/:id/jobs/:jobId/client-status` returns portal state for the trader UI.
- **Public Client Portal routes (TRQ-125)**: no-auth, rate-limited `clientPortalRateLimit` (20/hr/IP) mounted on all `/q/*`. Routes: `GET /q/:token` (validates token + expiry, sets noindex/no-store/DENY/CSP headers, renders portal), `POST /q/:token/viewed` (bot-safe beacon using `COALESCE(client_viewed_at, NOW())` so the first view wins), `POST /q/:token/respond` (single-submission guard via `AND client_response IS NULL`, writes both new `client_*` columns and legacy `status`/`accepted_at`/`declined_at`).
- **Portal renderer (TRQ-126)** — `portalRenderer.js` at repo root. Reads ONLY from `client_snapshot` + `client_snapshot_profile` (frozen-at-send contract). Emits mobile-first HTML using the `.cp-*` namespace defined in `public/client-portal.css`. The root element is `<div class="cp" data-accent="{amber|rust|moss|slate}">` — unknown accents are rejected and fall back to amber. Every interpolated field is HTML-escaped. The inline view beacon fires only after 3s dwell OR scroll-past-cost-breakdown, and only once. Confirmation states replace the response block when `client_response IS NOT NULL` — no resubmission path.

### Frontend

Single-page React app. All state in one `useReducer` in `App.jsx`. Layout: 240px side rail (desktop ≥900px) + 64px bottom nav (mobile <900px). Five-step workflow:

1. **Profile Setup** — company details, day rate, VAT
2. **Job Details** — client info, capture mode choice (video walkthrough or photos), 5 photo slots or video upload with optional extra photos, brief notes (optional voice dictation via `VoiceRecorder`). Video upload: mobile-optimised (OS file picker so users can choose Camera or Photo Library — most record on-site then upload later — 44px targets, 3-min client-side check), full playback preview with native controls, XHR upload with real progress % and automatic retry.
3. **AI Analysis** — loading screen with SSE-driven staged progress for video mode (falls back to time-based estimation) or rotating messages for photo mode (auto-advances)
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
| `jobs` | JSONB quote_snapshot + rams_snapshot, status lifecycle, total_amount, prompt_version |
| `drafts` | Auto-saved work-in-progress (one per user) |
| `user_photos` | Slot-based photo storage (context: draft or job ID) |
| `quote_diffs` | Per-field AI vs confirmed value diffs (learning engine) |
| `agent_runs` | Agent execution log (type, status, tokens, duration) |
| `calibration_notes` | Proposed/approved system prompt adjustments |
| `agent_retry_queue` | Exponential-backoff retry for failed agent runs |
| `dictation_runs` | Voice-to-text telemetry (user, success, latency, audio size, transcript chars) |
| `session` | Express session store (connect-pg-simple) |
| `jobs.client_*` (TRQ-124) | Client Portal columns — token, expiry, frozen `client_snapshot` + `client_snapshot_profile`, viewed/response audit trail. Accessed by `/q/:token` routes; the snapshot columns are immutable after write (Do-Not-Touch). |

### JSONB Snapshot Contract

Jobs store a `quote_snapshot` containing only keys from `SAVE_ALLOWLIST` (defined in `src/utils/stripBlobs.js`):

```
profile, jobDetails, reviewData, quotePayload, quoteSequence, quoteMode, captureMode, diffs, transcript
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
['profile', 'jobDetails', 'reviewData', 'quotePayload', 'quoteSequence', 'quoteMode', 'captureMode', 'diffs', 'transcript']
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
| Calibration | `agents/calibrationAgent.js` | Proposes system prompt calibration notes from aggregate diff data | Manual admin trigger + auto after 5 completed jobs |

Agent orchestration lives in `agents/agentUtils.js`: creates run records, calls Anthropic API, parses JSON responses, logs results.

**Auto-calibration:** After the feedback agent completes, `shouldAutoCalibrate()` (from `autoCalibration.js`) checks if >= 5 jobs have been completed since the last calibration run. If so, `runCalibrationAgent` fires async — the approval step stays manual.

**Retry queue:** Failed feedback agent runs are enqueued to `agent_retry_queue` with exponential backoff (2^n * 60s, max 3 attempts). Queue is swept on server startup via `processRetryQueue()` from `agents/retryQueue.js`.

**System prompt:** Single source of truth in `prompts/systemPrompt.js` (server-side). The client no longer sends a system prompt. `computePromptVersion()` produces an 8-char MD5 hash for tracking which prompt version generated each quote.

**Error sanitisation:** `safeError.js` wraps all 500 catch blocks — logs full error server-side, returns generic "Something went wrong" to the client. 400/404 specific messages are preserved.

**Server-side save allowlist:** `serverSaveAllowlist.js` enforces `pickAllowedKeys()` on job save routes, preventing photos/blobs from being stored in `quote_snapshot`.

---

## Client Portal (TRQ-124 → TRQ-133)

A secure, account-less way for clients to view their quote and respond accept/decline from a unique link.

**URL shape.** `https://fastquote.uk/q/{uuid-v4}`. The UUID is the entire credential (128 bits of entropy → brute-force infeasible). No account, no password, no email link verification.

**Server surface (public, no auth):**
- `GET /q/:token` — renders the mobile-first portal page via `portalRenderer.js`. Sets strict security headers (`X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, `X-Frame-Options: DENY`, CSP `default-src 'self'`, `frame-ancestors 'none'`). 404 on unknown, 410 on expired. Does NOT set `client_viewed_at` — email prefetchers and link scanners hit this without executing JS.
- `POST /q/:token/viewed` — bot-safe beacon fired after 3s dwell or scroll past the cost breakdown (whichever first). `client_viewed_at = COALESCE(…, NOW())` so first-view wins. Rejects expired tokens. Records IP + truncated UA.
- `POST /q/:token/respond` — validates `response ∈ {accepted, declined}`, truncates decline reason to 300 chars, enforces single-submission via `AND client_response IS NULL`. 409 on conflict. Writes both new `client_*` columns AND legacy `status`/`accepted_at`/`declined_at` so the dashboard reflects the decision.
- `clientPortalRateLimit`: 20/hr/IP shared across `/q/*`.

**Trader surface (requireOwner):**
- `POST /api/users/:id/jobs/:jobId/client-token` — generates UUID via `crypto.randomUUID`, freezes `quote_snapshot` → `client_snapshot` and `profiles.data` → `client_snapshot_profile` (TRQ-124). Regenerating overwrites the token and resets response fields to NULL.
- `GET /api/users/:id/jobs/:jobId/client-status` — returns trader-UI state (hasToken, url, expired, viewed, response, responseAt, declineReason).

**Frozen-snapshot contract.** `portalRenderer.js` reads ONLY from `client_snapshot` + `client_snapshot_profile`. Never from live `quote_snapshot` / `profiles.data`. That's what guarantees the client sees the version that was sent, even if the tradesman edits their quote or swaps their logo afterwards.

**Accent branding (TRQ-130).** Tradesman picks one of `amber | rust | moss | slate` in ProfileSetup. Stored as `profile.accent` (existing JSONB, no schema change). Whitelisted at both the server-side save (rejects unknown with 400) and the render-time `safeAccent()` (falls back to amber for unknown values) so no attribute injection is possible.

**Trader UI (TRQ-131/132/133).**
- Step 5 `ClientLinkBlock`: generates + copies + monitors the link. Five states — pre-generate, awaiting-view, viewed, accepted, declined.
- Dashboard `PortalBadge`: adds `AWAITING VIEW` / `VIEWED` / `LINK EXPIRED` alongside the existing `StatusBadge`. Once the client responds, `StatusBadge`'s `ACCEPTED` / `DECLINED` stamp takes over to avoid double-stamping.
- `StatusModal` admin section: viewed timestamp + IP + response audit + Copy/Regenerate. Admin-only — basic users never see the IP/UA fields (detail route strips them for non-admins).

**CSS.** `public/client-portal.css` serves the customer-facing `/q/:token` page (140 `.cp-*` classes, mobile-first, includes `@media print`). `public/trader-portal.css` is an extracted subset of `.link-block-*` + `.portal-badge-*` rules loaded into the main app via `index.html` — keeps the trader bundle lean.

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

**Current count:** 1154 tests across 56 suites (unit + video processing + measurement plausibility + review layout + dictation robustness + quote document layout). API integration (85) and security (59) suites run separately.

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
- `analyseJob.test.js` — client-side analysis function (endpoint, dispatch, errors)
- `autoCalibration.test.js` — auto-calibration threshold logic
- `agentRetryQueue.test.js` — retry queue entry building and backoff
- `safeError.test.js` — error sanitisation utility
- `saveAllowlistServer.test.js` — server-side save allowlist enforcement
- `dbIndexes.test.js` — database index presence assertions
- `promptVersion.test.js` — prompt version hashing
- `serverPrompt.test.js` — server-side system prompt validation
- `promptRemoval.test.js` — confirms prompt removed from client
- `savedQuoteViewer.test.js` — null-safe snapshot and photos crash resilience
- `quoteSave.test.js` — quote duplication prevention (no POST retry, dedup, save-vs-update)
- `dashboard.test.js` — site address in Needs Attention cards
- `bugfixBehavioral.test.js` — behavioral tests for bug fix round-trips
- `serverResilience.test.js` — server race conditions, transactions, validation, auth coverage
- `reducerResilience.test.js` — null guard safety, reset completeness, draft isolation, aiValue immutability
- `dataIntegrity.test.js` — save/load pipeline, allowlist consistency, GDPR, type coercion
- `componentCrashSafety.test.js` — null-safety across all 42 components
- `securityAudit.test.js` — auth bypass, IDOR, privilege escalation, headers (requires DATABASE_URL)
- `whisperClient.test.js` — Whisper API wrapper (model, prompt bias, error propagation)
- `dictation.test.js` — dictation route contract (auth, validation, MIME, telemetry shape)
- `voiceRecorder.test.js` — VoiceRecorder helpers (insertion, removal, segment edit detection, design-law compliance)
- `videoValidator.test.js` — video duration validation (pure + ffprobe)
- `frameExtractor.test.js` — ffmpeg frame extraction (requires ffmpeg)
- `audioExtractor.test.js` — audio track extraction (requires ffmpeg)
- `videoProcessor.test.js` — video processing orchestrator (mocked pipeline)
- `videoRoute.test.js` — video upload route contract validation
- `captureChoice.test.js` — capture mode selection component
- `videoUpload.test.js` — video upload component with drag-and-drop
- `videoIntegration.test.js` — JobDetails + reducer integration for video mode
- `videoLoading.test.js` — staged loading screen for video processing
- `videoUploadMobile.test.js` — mobile optimisations (capture, touch targets, duration check)
- `videoProgress.test.js` — SSE progress emitter unit tests + server route validation
- `videoProgressClient.test.js` — client-side SSE wiring (reducer, JobDetails, AIAnalysis)
- `uploadResilience.test.js` — error handling contract tests across video pipeline
- `uploadWithProgress.test.js` — XHR upload utility with progress tracking
- `uploadProgressUI.test.js` — upload progress wiring (reducer, JobDetails, AIAnalysis)
- `uploadRetry.test.js` — retry logic with exponential backoff
- `videoPreview.test.js` — video playback preview with native controls

---

## Auth

**Primary:** Google OAuth 2.0 via Passport. Session stored in PostgreSQL via connect-pg-simple. Cookie: `tq_session`.

**Legacy:** Session-based user switcher for development (Mark/Harry). Uses `req.session.legacyUserId`.

**Flow:** `/auth/google` → Google consent → `/auth/google/callback` → redirect to `/` (or `/?onboarding=true` for new users). New Google users land on profile setup before accessing the dashboard.

---

## Mobile

- Single breakpoint: `fq: 900px` (desktop ≥900px side rail, mobile <900px bottom nav)
- Accordion layout below `fq` breakpoint for Review & Edit (measurements, costs, schedule, damage description)
- 44px minimum touch targets on all interactive elements
- Single-column photo grid
- Required photo slots: solid primary border. Recommended: dashed grey border
- RAMS: horizontal scrolling pill bar for section navigation

---

## Known Limitations

- PDF page break issues on long quotes (html2canvas limitation)
- RAMS mobile navigation relies on scroll-to with pill bar — no native anchor support
- Draft auto-save is per-user in PostgreSQL, but active in-tab reducer state is lost on page refresh if not saved
- Self-critique agent runs synchronously after analysis — adds ~2s to Step 3 load time
- Voice dictation requires `OPENAI_API_KEY` env var on Railway; enabled for all users by default (opt-out via `voice_dictation = false` in settings). Audio is in-memory only — never persisted to disk or DB
- Video walkthrough requires ffmpeg on the server (installed via `nixpacks.toml` aptPkgs). Max 3 minutes, 100MB. Mobile-optimised with native camera capture, SSE real-time progress, XHR upload with real % tracking, automatic retry (3 attempts), and full playback preview. Video files stored temporarily in `/tmp` during processing, cleaned up after. No chunked/resumable upload yet (single XHR).
- Video processing pipeline: validate duration → extract frames (max 50) → extract audio → transcribe via Whisper → analyse via Claude. All server-side.

---

## Agent Operating Protocol

### Permission Tiers

**Autonomous (no confirmation needed):**
- Edit any file in `src/` (components, utils, tests)
- Create new files in `src/utils/`, `src/components/`, `src/__tests__/`
- Run `npm test`, `npx vite build`, `git status`, `git diff`, `git log`
- Read any file in the repo
- Create and run test files
- Fix lint/build errors in code you just wrote

**Verify-then-proceed (run tests + build, check results, continue if green):**
- Modify `server.js` routes or middleware
- Change `reducer.js` action handling
- Edit `src/utils/stripBlobs.js` or `src/utils/isAdminPlan.js`
- Add new reducer actions
- Modify component prop interfaces

**Ask before proceeding:**
- DB schema changes (new columns, altered tables, migrations)
- Deleting files or removing public exports
- Changing `SAVE_ALLOWLIST` contents
- Modifying auth flow, session handling, or OAuth config
- Any change to the AI system prompt or agent prompts
- Modifying `aiParser.js` normalisation logic
- Changes that affect billing, user data, or privacy
- Force-pushing, rebasing, or amending published commits

### Standing Orders

These apply to every task, every time:

1. **Read before you edit.** Never modify a file you haven't read in this session.
2. **Test before you commit.** `npm test` must be green. No exceptions.
3. **Build before you push.** `npx vite build` must succeed.
4. **One concern per commit.** Atomic commits with Linear ticket prefix.
5. **Update this file.** If your change affects documented architecture, update CLAUDE.md in the same commit.

---

## Do-Not-Touch List

These files/systems have hard invariants. Modifying them risks corrupting production data or breaking the learning engine. Do not change without explicit approval and a clear reason.

| Protected Item | Why | Risk if Violated |
|----------------|-----|------------------|
| `aiValue` assignment in `aiParser.js` | Set once, never overwritten | All learning data corrupted — diffs become meaningless |
| `diffTracking.js` core logic | Constructs per-field diffs for learning | Historical learning data invalidated |
| `quote_diffs` table schema | Stores immutable learning records | Breaks diff queries, agent analysis, calibration |
| `calibration_notes` table schema | System prompt tuning records | Loses approved calibration history |
| AI system prompt content | Tuned through calibration agents | Uncontrolled prompt changes bypass the calibration loop |
| `SAVE_ALLOWLIST` in `stripBlobs.js` | Controls what persists to JSONB | Adding junk bloats snapshots; removing keys loses data |
| `requireAdminPlan` middleware | Gates all admin routes | Basic users see admin internals (violates design law) |
| `isAdminPlan.js` contract | Sole admin-branching primitive | Raw checks proliferate, defaults flip, basic users see admin UI |
| `jobs.client_snapshot` + `jobs.client_snapshot_profile` (TRQ-124) | Frozen at token-generation time. Read-only after write. | Client portal begins to show post-send edits to the tradesman's quote or profile — violates the "frozen at send time" design principle and breaks the audit story. |
| `src/utils/clientToken.js` — `generateClientToken()` | Must stay `crypto.randomUUID()`. 128-bit entropy is what makes `/q/:token` guess-resistant. | Replacing with `Math.random`, timestamps, or sequential IDs makes the portal URL brute-forceable — any passerby could enumerate active quotes. |

**If you need to change a protected item:** explain what you want to change, why, and what the blast radius is. Then wait for approval.

---

## Agentic Loops

### TDD Loop (default for all code changes)

```
1. WRITE TEST (red)
   → Create or extend test file
   → Run npm test → confirm new tests FAIL
   → If tests pass already, your test isn't testing the right thing — fix the assertion

2. IMPLEMENT (green)
   → Write the minimum code to make tests pass
   → Run npm test → confirm ALL tests pass (new + existing)
   → If existing tests broke, you introduced a regression — fix before continuing

3. REFACTOR (optional)
   → Clean up only if the code is unclear
   → Run npm test → confirm still green
   → Do not refactor code you didn't write unless asked

4. COMMIT
   → git add specific files (never git add -A)
   → Commit with Linear ticket prefix
   → Continue to next change
```

### Explore-Before-Edit Loop

Use this before touching unfamiliar code:

```
1. READ the target file
2. GREP for all call sites (who uses this function/component?)
3. READ 2-3 key call sites to understand the contract
4. CHECK for tests that cover the target
5. PLAN the change (what needs to move, what breaks?)
6. Only THEN start the TDD loop
```

### Multi-File Change Loop

When a change spans 3+ files:

```
1. LIST all files that need changing
2. WRITE tests that cover the full change (may span multiple test files)
3. CONFIRM red (tests fail)
4. IMPLEMENT across all files
5. RUN npm test → must be fully green
6. RUN npx vite build → must succeed
7. COMMIT atomically (all related files in one commit)
```

### Bug Investigation Loop

When something is broken and you don't know why:

```
1. REPRODUCE — read the error, find the exact failure point
2. TRACE — follow the data flow backwards from the failure
3. NARROW — form a hypothesis, grep for evidence
4. TEST — write a failing test that captures the bug
5. FIX — minimum change to make the test pass
6. VERIFY — run full suite, confirm no regressions
```

---

## Verification & Self-Healing

### After Every Code Change

```bash
npm test
```

- **Green:** Continue.
- **Red:** Read the failure output. Fix the issue. Re-run. Max 3 fix attempts.
- **Still red after 3 attempts:** Stop. Describe what's failing and why your fixes didn't work. Ask for guidance.

### After Every Commit

Run these checks (automate in your head — do them every time):

```bash
# 1. No raw admin checks leaked
grep -r "plan\s*[!=]==\?\s*['\"]admin['\"]" src/ --include="*.js" --include="*.jsx" | grep -v isAdminPlan.js | grep -v __tests__

# 2. No banned vocabulary in basic-user components
npm test -- --testPathPattern=aiTextRemoval

# 3. Build still works
npx vite build

# 4. SAVE_ALLOWLIST unchanged (unless intentional)
git diff src/utils/stripBlobs.js
```

### After Every Push

```bash
# Check Railway deploy started
git log --oneline -1  # Confirm pushed commit

# If you have railway CLI access:
railway logs --tail 50  # Check for startup errors
```

### Self-Healing Patterns

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| `npm test` fails on unrelated test | Your change has a side effect | Read the failing test, trace the dependency, undo the side effect |
| `vite build` fails: import error | Missing `.jsx` extension or bad ESM import | Check file extension matches, ensure `export` exists |
| `vite build` fails: module not found | New dependency not installed | `npm install <package>` — but ask before adding new deps |
| Test passes locally but logic is wrong | Test doesn't cover the actual scenario | Write a more specific assertion, reproduce the real user flow |
| Reducer action has no effect | Action string typo or missing `case` | Check `dispatch({ type: 'X' })` matches exactly in `reducer.js` |
| Component renders but looks wrong | CSS class doesn't exist or Tailwind CDN issue | Grep for the class in the codebase — ensure it's defined |
| Save works but data missing on reload | Field not in `SAVE_ALLOWLIST` | Add to allowlist (requires approval — see Do-Not-Touch List) |
| Basic user sees admin content | Missing `isAdminPlan` gate | Add `{isAdminPlan && ...}` conditional or check component defaults |
| Railway healthcheck fails on deploy | `express-rate-limit` validation rejects custom `keyGenerator` | Set `validate: false` on rate limiters that key by user ID, not IP |

---

## Common Pitfalls

These are mistakes that have actually happened in this codebase. Check for them proactively.

### 1. Dangerous Defaults

Components receive `isAdminPlan` as a prop. If a parent forgets to pass it, the default kicks in. **All defaults must be `false`** so basic users never accidentally see admin UI.

```javascript
// CORRECT
function MyComponent({ isAdminPlan = false }) { ... }

// WRONG — leaks admin UI if prop is forgotten
function MyComponent({ isAdminPlan = true }) { ... }
```

**Self-check:** After creating any component that accepts `isAdminPlan`, grep for its usage and confirm every call site passes the prop explicitly.

### 2. aiValue Corruption

The reducer handles `CONFIRM_MEASUREMENT` and `EDIT_MEASUREMENT`. These must update `value` only, never `aiValue`.

**Self-check:** After any reducer change touching `reviewData` or measurements, verify that `aiValue` is never on the left side of an assignment.

### 3. Snapshot Bloat

`buildSaveSnapshot` only persists keys in `SAVE_ALLOWLIST`. If you add new state to the reducer and it should persist, it will silently be dropped unless added to the allowlist.

**Self-check:** When adding new state fields, ask: "Should this survive a page reload?" If yes, it needs to be in `SAVE_ALLOWLIST`.

### 4. Visibility Leaks

Even if `isAdminPlan` gates are correct, a careless string in a tooltip, placeholder, or error message can leak the AI abstraction to basic users.

**Self-check:** After writing any user-facing text, scan it against the banned vocabulary list in the Visibility Rules section above. The test `aiTextRemoval.test.js` catches some but not all — use judgement.

### 5. CSS Cache Busting

Browser-cached CSS will make deployed changes invisible. After modifying any CSS (including Tailwind classes that depend on build output):

**Self-check:** If your change alters visual appearance, bump the `?v=` cache-buster parameter in `index.html` link tags.

### 6. Photo Slot Names

The 5 photo slots (`overview`, `closeup`, `sideProfile`, `referenceCard`, `access`) are stored in the database. Renaming them requires a data migration.

**Self-check:** Never rename slot strings. If you need a new slot, add it — don't rename an existing one.

### 7. External dictation tools bypass React `onChange` (TRQ-100)

Tools like Wispr Flow, password managers, and some iOS keyboard extensions set `input.value` directly via platform APIs without dispatching a native `input` event. React's synthetic `onChange` never fires, so the controlled-component state stays empty even though text is visually present. The disabled Continue button then refuses to advance — user sees typed text but the form thinks the field is blank.

**Self-check:** On any text input that gates navigation (siteAddress, briefNotes, measurement values, profile fields), mirror `onChange` with an `onBlur` handler that re-reads `e.target.value` and calls the same update function. Asserted in `dictationRobustness.test.js`.

### 8. `[photo-stripped]` marker must be rehydrated on view (TRQ-106 / TRQ-107)

`buildSaveSnapshot` replaces `profile.logo` and photo data URLs with the literal string `"[photo-stripped]"` to keep JSONB snapshots small. Viewers must:
1. Detect the marker and fetch the live logo via `getProfile()` before rendering `<img src>`.
2. Remount downstream components when photos arrive async, because `useState(() => new Set(allPhotos.map(...)))` initialisers only run once and will capture an empty selection if photos haven't loaded yet.

**Self-check:** When reading `profile.logo` or `photos[slot]` from a saved snapshot, always treat `[photo-stripped]` as "missing, please fetch" rather than as a URL.

### 9. DOCX tables need three things to render cleanly in Pages + Word (TRQ-110)

`docx@9.x` requires **all three** for fixed column widths to stick:
1. `columnWidths: [...]` on the `Table` constructor.
2. `layout: TableLayoutType.FIXED`.
3. Total table width ≤ page usable width (A4 - margins = 9026 twips at 1-inch margins). Going over causes Pages to collapse columns to fit.

**Self-check:** When adding or resizing a DOCX table, compute the sum of column widths and verify it's at most 8800 twips on 1-inch-margin A4.

### 10. `html2canvas` captures everything inside the ref (TRQ-103)

If an on-screen element (like the inline footer) is also overlaid via `pdf.text()`, you get it twice on the page. Mark anything that's already handled by the overlay with `data-html2canvas-ignore="true"` so the capture skips it.

### 11. Auto-growing textareas need `useLayoutEffect`, not `ref` callbacks (TRQ-111 / TRQ-114)

React ref callbacks fire before the value is reliably measurable, and don't re-fire on prop changes. For textareas that should fit their content (schedule descriptions, damage description), use the shared `src/components/common/AutoGrowTextarea.jsx` — it uses `useLayoutEffect(..., [value, minHeight])` so the height is correct on the first frame the user sees.

### 12. `QuoteDocument` must stay byte-identical when not editable (TRQ-112)

`QuoteDocument` is used by three surfaces: the Live Preview (editable), the PDF capture (read-only), and `SavedQuoteViewer` (read-only). The editable path (`editable={true}` + `dispatch` prop) swaps `<p>` / `<span>` for `<textarea>` / `<input>`. When `editable` is false the markup must be identical to the previous render so PDF/DOCX/SavedQuote output doesn't drift.

**Self-check:** When touching `QuoteDocument`, guard new rendering behind `canEdit` so read-only surfaces see the same HTML they always have.

### 14. Client Portal rendering contract — never read live state (TRQ-126)

The portal at `GET /q/:token` must read `client_snapshot` + `client_snapshot_profile` ONLY. Never `quote_snapshot`, never `profiles.data`. That's the frozen-at-send-time contract the whole feature depends on — if the tradesman edits the quote or swaps their logo after sending, the client still sees the version that was originally shared.

If you add a new field to the portal page, freeze it at token generation time (TRQ-124's `POST /client-token` route writes both snapshots) and read it from the snapshot in `renderClientPortal`. Do NOT add a live database lookup in the renderer.

**Self-check:** When editing `portalRenderer.js`, every `job.` / `profile.` access must trace back to a snapshot field. Grep confirms: any use of `pool.query` inside the renderer or an import of live profile/job helpers is a bug.

### 13. Measurement methodology v2 — confidence floor is enforced in code (TRQ-109)

Claude sets per-measurement `confidence` itself, but tends to be optimistic. `applyMeasurementPlausibilityBounds(parsed, { scaleReferences })` in `aiParser.js` forces `confidence = 'low'` when:
- No reference card AND no user-supplied `scaleReferences`.
- `valueMm` is missing, `< 10mm`, or `> 100000mm`.

Both the photo (`analyseJob.js`) and video (`server.js` video route) paths call it after `normalizeAIResponse`. The function only touches `confidence` — `aiValue` remains immutable.

**Self-check:** If a new analysis path is added, it must call `applyMeasurementPlausibilityBounds` too.

---

## Code Conventions

Follow these patterns so new code is consistent with the existing codebase.

### Reducer Actions
```javascript
// Action types: UPPER_SNAKE_CASE
dispatch({ type: 'SET_JOB_DETAILS', payload: { ... } })

// Reducer: switch/case in src/reducer.js
case 'SET_JOB_DETAILS':
  return { ...state, jobDetails: { ...state.jobDetails, ...action.payload } };
```

### Component Props
```javascript
// Destructure with safe defaults
export default function QuoteOutput({
  state,
  dispatch,
  isAdminPlan = false,  // Always default false
  onNavigate,
}) { ... }
```

### Utility Functions
```javascript
// Pure functions in src/utils/
// Always exported, always tested
// File name matches primary export
export function calculateTotal(items) { ... }
```

### Server Routes
```javascript
// Grouped by domain, middleware chain
app.get('/api/jobs', requireAuth, async (req, res) => { ... });
app.get('/api/admin/agents', requireAuth, requireAdminPlan, async (req, res) => { ... });
```

### Test Files
```javascript
// Mirror source path: src/utils/foo.js → src/__tests__/foo.test.js
// Jest + ESM, import from source
import { calculateTotal } from '../utils/calculateTotal.js';

describe('calculateTotal', () => {
  it('sums line items correctly', () => {
    expect(calculateTotal([{ amount: 100 }, { amount: 200 }])).toBe(300);
  });
});
```

### Commit Messages
```
TRQ-81: Short description matching Linear ticket title

- Bullet point details if needed
- Another detail

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

## Escalation Rules

Stop working and ask the user when any of these conditions are true:

1. **Stuck in a loop.** Same test fails 3 times with different fix attempts. Describe what you've tried.
2. **Scope creep.** The change requires modifying more than 5 files not anticipated in the original task.
3. **Protected item.** You need to change something on the Do-Not-Touch List.
4. **Security boundary.** The change touches auth, sessions, API keys, or user data handling.
5. **Ambiguous requirement.** You can see two reasonable interpretations and the wrong choice would require rework.
6. **Design law conflict.** The task seems to require mixing admin and basic user layers.
7. **Data migration needed.** The change requires altering DB schema or backfilling existing data.
8. **External side effect.** The change would send emails, call external APIs, or affect other users' data.

**How to escalate:** State what you're trying to do, what's blocking you, what options you see, and which you'd recommend. Don't just say "I'm stuck" — give the user enough context to make a decision.

---

## What to Update When

Same-commit update policy: if a change affects any of the following, update this file in the same commit.

- New state field → add to SAVE_ALLOWLIST if it should persist
- New plan type → update isAdminPlan utility and Plan Model section
- New agent → add to AI Agents table
- New table → add to Data Model section
- New API route → mention in Architecture section
- Test count changes significantly → update Testing section count
- New component with `isAdminPlan` prop → default to `false`, note in Code Conventions if novel pattern
- New protected invariant discovered → add to Do-Not-Touch List
- New common mistake encountered → add to Common Pitfalls
- New self-healing pattern discovered → add to Verification & Self-Healing table
