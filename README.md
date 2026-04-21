# TradeQuote (FastQuote)

AI-powered quote generator for dry stone walling professionals. A tradesman photographs or videos a damaged wall, enters a job address, and receives a professionally formatted, print-ready quote in under 5 minutes.

Production: [fastquote.uk](https://fastquote.uk) · Team: [Trade Quote on Linear](https://linear.app/rootfolio)

---

## Features

### Core quoting
- **AI analysis** — upload photos or a 3-min video walkthrough; Claude Sonnet identifies stone type, damage extent, measurements, and schedule of works.
- **Measurement methodology v2** — scale-anchor tiering (reference card → user-provided scale → standard objects), plausibility bounds (wall height 600-2500mm etc.), and confidence floors that prevent over-optimistic measurement grades. See [`docs/MEASUREMENT_ACCURACY_PLAN.md`](docs/MEASUREMENT_ACCURACY_PLAN.md).
- **Scale references** — optional free-text field where the tradesman names known-size objects ("the gate is 1.2m wide") when no reference card is used.
- **Calibrated pricing** — prompt tuned on verified professional waller rates (West Yorkshire / Cumbria).
- **Editable review** — every AI suggestion is editable; the original `aiValue` is immutable and drives the learning loop.
- **Inline editing in the Live Preview** — click damage-description, schedule titles/descriptions, or notes directly on the rendered preview and they update live.

### Capture & notes
- **Video walkthrough** — up to 3 minutes, up to 50 frames extracted uniformly, audio auto-transcribed by Whisper and fed to the analyser as context. Real-time SSE progress, automatic retry, XHR upload.
- **Voice dictation** — record spoken brief notes via the `VoiceRecorder` component; transcribed by Whisper and inserted into the notes field. Audio is in-memory only, never persisted.
- **Photo slots** — 5 structured slots (overview, closeup, side profile, reference card, access) plus up to 10 extra labelled photos.

### Document output
- **PDF** via `html2canvas` + `jsPDF` (CDN).
- **DOCX** via the `docx` library — fixed-layout cost-breakdown table with right-positioned totals and brand-accent TOTAL.
- **Photo appendix** — 2 per page, page-break-safe.
- **RAMS generator** — Risk Assessment & Method Statement, linked to the originating quote.

### Admin-only intelligence layer
- **Self-critique agent** (Haiku) — runs after every analysis, cross-checks tonnage, labour and materials consistency.
- **Feedback agent** (Haiku) — mines completed job feedback into calibration notes.
- **Calibration agent** (Haiku) — proposes tuning notes from aggregate diff data; admin approves before they augment the prompt.
- **Learning dashboard** — diff analytics, reference-card impact, agent run history.

### Platform
- **Multi-user** with per-user data isolation.
- **Google OAuth** + legacy session switcher for dev.
- **Saved quotes** persisted in Postgres with cross-device access.
- **Mobile-ready** — single `fq:900px` breakpoint; field-optimised layouts with 44px minimum touch targets.

---

## Architecture

```
Browser (React 18 + Vite)                 Railway Server
─────────────────────────               ─────────────────
userDB.js ──fetch──→          Express server.js (91KB, single file)
analyseJob.js ──fetch──→          │       │           │
VideoUpload ──XHR──→ multer ──→   │       │           │
                                  │       │           ↓
                                  │       │        Anthropic API
                                  │       │           │
                                  │       │           ↓
                                  │       │        OpenAI Whisper (audio only)
                                  │       │
                                  │       ↓
                                  │    ffmpeg (frames + audio extraction)
                                  │
                                  ↓
                              Postgres (Railway)  ← connect-pg-simple sessions
                              ├── users / profiles / settings / theme
                              ├── jobs / quote_diffs / drafts
                              ├── user_photos (slot-based)
                              ├── agent_runs / calibration_notes / agent_retry_queue
                              ├── dictation_runs (telemetry)
                              └── session
```

- **Express** (`server.js`) — REST API + serves the Vite `dist/` build.
- **No ORM** — raw `pg` with JSONB snapshots. Schema is self-initialising via `initDB()` on startup.
- **Anthropic + OpenAI API keys** — server-side only, never in the client bundle.
- **Photo / logo handling** — photos and `profile.logo` are stripped from JSONB snapshots (`[photo-stripped]` marker) and rehydrated on load from the `user_photos` / `profiles` tables.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite 5, Tailwind CSS (CDN) |
| Backend | Express 5.2, Node 20+, raw `pg` |
| Database | Postgres 15+ (Railway), JSONB |
| AI (primary) | Anthropic Claude Sonnet 4 (server-proxied) |
| AI (agents) | Anthropic Claude Haiku 4.5 |
| Audio | OpenAI Whisper |
| Video | ffmpeg (via `fluent-ffmpeg`) |
| PDF | html2canvas + jsPDF (CDN) |
| DOCX | `docx` (bundled) |
| Auth | Google OAuth 2.0 (`passport`) + `connect-pg-simple` sessions |
| Uploads | `multer` |
| Rate limiting | `express-rate-limit` |
| Testing | Jest 29, ESM |
| Hosting | Railway (auto-deploy on push to `main`) |
| Fonts | Barlow Condensed, Inter, JetBrains Mono |

---

## Getting started

```bash
npm install
npm run dev        # Vite on :5173, proxies /api to :3000
npm test           # 1154 tests across 56 suites
npm run build      # production build to dist/
```

### Running the API server locally

Requires Postgres. Set `DATABASE_URL`, and optionally `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`:

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/tradequote
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...                  # voice dictation + video transcription
node server.js                                # Express on :3000, auto-creates schema
```

Two-terminal dev:
- Terminal 1: `node server.js` (API on :3000)
- Terminal 2: `npm run dev` (Vite on :5173, proxies `/api` to :3000)

### Test scripts
```bash
npm test                # unit suite (56 suites, 1154 tests) — excludes api/security
npm run test:api        # API integration tests (requires DATABASE_URL)
npm run test:security   # security audit suite (requires DATABASE_URL)
npm run test:watch      # watch mode
npm run test:coverage   # coverage report
```

---

## Deployment

Railway via `git push main`. Build uses Nixpacks which installs `ffmpeg` (declared in `nixpacks.toml`).

Required env:
- `DATABASE_URL` — auto-injected by Railway's Postgres plugin
- `ANTHROPIC_API_KEY` — analysis + agents
- `OPENAI_API_KEY` — Whisper (dictation + video transcription)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth (optional; legacy switcher falls back)
- `SESSION_SECRET` — express-session

```bash
git push origin main   # triggers Railway deploy
```

---

## Project structure

```
server.js                            # Express API (~91KB, single file)
prompts/systemPrompt.js              # single-source AI system prompt + prompt-version hash
agents/                              # self-critique, feedback, calibration + orchestration utils
public/                              # static assets (favicon, manifest)
index.html                           # Tailwind CDN + theme CSS + tailwind.config
nixpacks.toml                        # Railway build config (installs ffmpeg)
railway.toml                         # Railway deploy config

src/
├─ App.jsx                           # useReducer orchestrator
├─ reducer.js                        # central state machine
├─ main.jsx                          # Vite entrypoint + ErrorBoundary
├─ constants.js                      # PHOTO_SLOTS, confidence enum, etc.
├─ components/
│   ├─ steps/                        # the 5-step workflow
│   │   ├─ ProfileSetup.jsx
│   │   ├─ JobDetails.jsx            # client info + capture (photos or video) + scaleReferences
│   │   ├─ AIAnalysis.jsx            # loading screen (SSE for video, rotating msgs for photo)
│   │   ├─ ReviewEdit.jsx            # 2-col layout: measurements/schedule/damage | materials/costs/notes + live preview
│   │   └─ QuoteOutput.jsx           # document preview + PDF/DOCX export
│   ├─ review/                       # MaterialsTable, LabourSection, ScheduleList, LivePreview, MeasurementRow
│   ├─ rams/                         # 10 RAMS sub-components (editor + document + risk tables)
│   ├─ common/AutoGrowTextarea.jsx   # shared text-area that grows to fit content
│   ├─ QuoteDocument.jsx             # printed-quote layout (used by preview, PDF, saved viewer)
│   ├─ VideoUpload.jsx               # drag/drop + native picker + progress UI
│   ├─ VoiceRecorder.jsx             # dictation (Whisper)
│   ├─ CaptureChoice.jsx             # video vs photos selection
│   ├─ SavedQuoteViewer.jsx          # read-only re-render of a past quote
│   ├─ Dashboard.jsx                 # saved quotes landing page
│   ├─ LearningDashboard.jsx         # admin analytics
│   ├─ AgentActivity.jsx             # admin agent run history
│   ├─ CalibrationManager.jsx        # admin prompt tuning
│   └─ …(Sidebar, BottomNav, Toast, StatusModal, OfflineBanner, etc.)
├─ utils/
│   ├─ aiParser.js                   # parse + validate + normalise AI JSON, plausibility bounds
│   ├─ analyseJob.js                 # photo analysis pipeline (client-side)
│   ├─ videoProcessor.js             # server-side orchestration of frame+audio extraction
│   ├─ frameExtractor.js             # ffmpeg frame sampling
│   ├─ audioExtractor.js             # ffmpeg audio extraction
│   ├─ whisperClient.js              # OpenAI Whisper wrapper
│   ├─ videoProgress.js              # SSE progress emitter
│   ├─ uploadWithProgress.js         # XHR upload with retry + progress
│   ├─ userDB.js                     # per-user fetch helpers (profiles / jobs / photos / drafts)
│   ├─ userRegistry.js               # cross-user operations
│   ├─ stripBlobs.js                 # SAVE_ALLOWLIST + buildSaveSnapshot
│   ├─ isAdminPlan.js                # sole admin-branching primitive
│   ├─ calculations.js               # pure financial functions
│   ├─ diffTracking.js               # aiValue → value diff construction for learning
│   ├─ quoteBuilder.js               # quote ref, currency, payload assembly
│   ├─ ramsBuilder.js                # RAMS document assembly
│   ├─ validators.js                 # form + schema validation
│   └─ defaultNotes.js               # boilerplate Notes & Conditions
└─ __tests__/                        # 56 suites, 1154 tests (excludes api + securityAudit)
```

Docs at the repo root:
- [`CLAUDE.md`](CLAUDE.md) — architecture, design law, agent operating protocol, do-not-touch list, pitfalls.
- [`docs/MEASUREMENT_ACCURACY_PLAN.md`](docs/MEASUREMENT_ACCURACY_PLAN.md) — measurement v2 rationale and scope.

---

## API routes

All under `/api` (auth under `/auth`). Detailed contracts in `server.js`.

| Area | Routes |
|------|--------|
| Auth | `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/logout`, `GET /auth/me`, `POST /api/session/legacy` |
| Users | `GET /api/users`, `POST /api/users`, `GET/DELETE /api/users/:id` |
| Profiles | `GET/PUT /api/users/:id/profile` |
| Settings | `GET/PUT /api/users/:id/settings/:key` |
| Theme | `GET/PUT /api/users/:id/theme` |
| Quote sequence | `GET /api/users/:id/quote-sequence`, `POST /api/users/:id/quote-sequence/increment` |
| Jobs | `GET/POST /api/users/:id/jobs`, `GET/PUT/DELETE /api/users/:id/jobs/:jobId` |
| Job status | `PUT /api/users/:id/jobs/:jobId/status` |
| RAMS | `PUT /api/users/:id/jobs/:jobId/rams`, `PUT /api/users/:id/jobs/:jobId/rams-not-required` |
| Diffs | `POST /api/users/:id/jobs/:jobId/diffs` |
| Photos | `PUT/GET/DELETE /api/users/:id/photos/:context/:slot`, `POST /api/users/:id/photos/copy` |
| Video | `POST /api/users/:id/jobs/:jobId/video`, `GET /api/users/:id/jobs/:jobId/video/progress` (SSE) |
| Dictation | `POST /api/dictate` |
| Drafts | `GET/PUT/DELETE /api/users/:id/drafts` |
| GDPR | `DELETE /api/users/:id/data`, `GET /api/users/:id/export` |
| Analysis | `POST /api/users/:id/analyse`, `POST /api/anthropic/messages` |
| Calibration notes (basic) | `GET /api/calibration-notes/approved` |
| Admin learning | `GET /api/admin/learning`, `GET /api/admin/users` |
| Admin users | `POST /api/admin/users/:id/set-plan` |
| Admin agents | `GET /api/admin/agent-runs`, `GET /api/admin/agent-runs/:runId` |
| Admin calibration | `GET/PUT /api/admin/calibration-notes`, `POST /api/admin/calibration/run` |
| Migration (admin) | `POST /api/admin/migrate-data` |

---

## Linear

Tracked under the **Trade Quote** team: [linear.app/rootfolio](https://linear.app/rootfolio). Every commit is prefixed with its TRQ ticket.

## License

Private — all rights reserved.
