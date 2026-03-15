# TradeQuote

AI-powered quote generator for dry stone walling professionals. A tradesman photographs a damaged wall, enters a job address, and receives a professionally formatted, print-ready quote in under 5 minutes.

## Features

- **AI Analysis** - Upload photos of damaged walls; Claude analyses stone type, damage extent, and measurements using an optional reference card for calibrated dimensions
- **Calibrated Pricing** - AI prompt trained on verified professional waller rates (West Yorkshire / Cumbria, March 2026) for accurate cost estimation
- **Unit-aware Materials** - Materials table supports m&sup2;, tonnes, linear metres, items, and number units with per-unit rate pricing
- **Editable Review** - Every AI suggestion is editable. All measurements must be confirmed before quote generation. Immutable `aiValue` tracking powers the learning loop
- **Notes & Conditions** - Standard professional terms auto-included (lime mortar, Listed Building Consent, payment terms)
- **Multi-format Export** - Download as Word (.docx) or PDF with photo appendix
- **RAMS Generator** - Risk Assessment & Method Statement linked to saved quotes
- **Multi-user** - Per-user data isolation with server-side Postgres persistence
- **Saved Quotes** - Quotes persisted in Railway Postgres with cross-browser/cross-device access
- **Mobile-ready** - Field-optimised responsive layout for on-site use

## Architecture

```
Browser (React + Vite)           Railway Server
─────────────────────           ──────────────
userDB.js ──fetch()──→    Express server.js ──→ Postgres
userRegistry.js ──fetch()──→         │
JobDetails.jsx ──fetch()──→   /api/anthropic ──→ Anthropic API
                              serves dist/ static files
```

- **Express server** (`server.js`) — serves REST API routes and the Vite `dist/` build
- **Postgres** — Railway Postgres plugin, auto-injects `DATABASE_URL`
- **No ORM** — uses `pg` directly, JSONB for snapshots
- **Anthropic API key** — server-side only (`ANTHROPIC_API_KEY` env var on Railway, never in client bundle)

## Tech Stack

- React 18 + Vite
- Express + pg (server)
- Railway Postgres (persistence)
- Tailwind CSS (CDN)
- `docx` for Word export, `html2canvas` + `jsPDF` for PDF (CDN)
- Server-side Anthropic API proxy (key never exposed to client)
- Jest for unit tests (228 tests across 7 test suites)

## Getting Started

```bash
npm install
npm run dev        # Vite dev server on :5173, proxies /api to :3000
npm test           # run all unit tests (228 tests)
npm run build      # production build to dist/
```

### Running the API server locally

Requires a Postgres database. Set `DATABASE_URL` and optionally `ANTHROPIC_API_KEY`:

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/tradequote
export ANTHROPIC_API_KEY=sk-ant-...
node server.js     # Express on :3000, auto-creates schema
```

For development, run both:
- Terminal 1: `node server.js` (API on :3000)
- Terminal 2: `npm run dev` (Vite on :5173, proxies /api to :3000)

## Deployment

Deployed on [Railway](https://railway.app) via git push to `main`.

Railway setup:
1. Add PostgreSQL plugin (auto-injects `DATABASE_URL`)
2. Set `ANTHROPIC_API_KEY` environment variable
3. Push to `main` — Railway builds with Nixpacks, runs `npm run build && node server.js`
4. Schema auto-created on first start via `initDB()`

```bash
git push origin main   # triggers Railway auto-deploy
```

## Project Structure

```
server.js                           # Express API server + Postgres schema
src/
  App.jsx                           # useReducer orchestrator
  reducer.js                        # central state management
  components/
    QuoteDocument.jsx               # print-ready quote layout
    SavedQuotes.jsx                 # saved quotes list
    SavedQuoteViewer.jsx            # read-only quote viewer with re-edit
    UserSelector.jsx                # initial user selection
    UserSwitcher.jsx                # switch user from nav
    StepIndicator.jsx               # 5-step progress bar
    steps/
      ProfileSetup.jsx              # company profile
      JobDetails.jsx                # client details + photo upload + AI call
      AIAnalysis.jsx                # loading screen during API call
      ReviewEdit.jsx                # 3-column review: measurements, schedule, costs
      QuoteOutput.jsx               # document preview + Word/PDF export
    review/
      MaterialsTable.jsx            # editable materials with unit dropdown
      LabourSection.jsx             # days x workers x rate
      ScheduleList.jsx              # numbered schedule of works
      LivePreview.jsx               # real-time quote preview
    rams/                           # RAMS components
  utils/
    userDB.js                       # fetch-based user data persistence (Postgres)
    userRegistry.js                 # fetch-based user registry (Postgres)
    aiParser.js                     # parse, validate, normalise AI JSON
    calculations.js                 # pure financial functions
    diffTracking.js                 # AI vs confirmed value diffs (learning loop)
    quoteBuilder.js                 # quote ref, formatting, payload assembly
    ramsBuilder.js                  # RAMS document builder
    validators.js                   # profile, job, photo validation gates
  __tests__/                        # Jest test suites (7 suites, 228 tests)
```

## API Routes

All routes under `/api`. See `server.js` for full implementation.

| Area | Routes |
|------|--------|
| Users | `GET/POST /api/users`, `GET/DELETE /api/users/:id` |
| Profiles | `GET/PUT /api/users/:id/profile` |
| Settings | `GET/PUT /api/users/:id/settings/:key` |
| Theme | `GET/PUT /api/users/:id/theme` |
| Jobs | `GET/POST /api/users/:id/jobs`, `GET/DELETE /api/users/:id/jobs/:jobId` |
| RAMS | `PUT /api/users/:id/jobs/:jobId/rams` |
| Drafts | `GET/PUT/DELETE /api/users/:id/drafts` |
| GDPR | `DELETE /api/users/:id/data`, `GET /api/users/:id/export` |
| AI Proxy | `POST /api/anthropic/messages` |

## Linear

Tracked under the **Trade Quote** team in [Linear](https://linear.app/rootfolio).

## License

Private - all rights reserved.
