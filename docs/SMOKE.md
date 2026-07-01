# Playwright smoke suite

End-to-end behavioural coverage of FastQuote's user-visible surfaces.
Every PR runs the suite in CI against production; failures block merge.

## Why this exists

Harry, 2026-06-30: *"Selecting completed still does nothing — why didn't you catch this in testing?"*

The honest answer was that source-level shape tests can't see whether
the SPA actually behaves the way a user expects. This suite closes
that gap by putting a real browser between "the code compiles" and
"ready to merge".

## Running locally

```bash
# One-time — installs Chromium under ~/.cache/ms-playwright (~90 MiB)
npm run smoke:install

# Fast headless run against production
npm run smoke

# Interactive debugger + step-through mode
npm run smoke:ui

# Run against a different host (staging preview, localhost, etc.)
SMOKE_URL=http://localhost:3000 npm run smoke

# Run a single spec
npx playwright test tests/e2e/public-surfaces.spec.js
```

## Running in CI

Automatic on every PR + push to main via `.github/workflows/smoke.yml`.
Failures upload the Playwright HTML report + traces as a 7-day artifact
so you can see exactly what the browser saw at the moment things broke.

Also runs daily at 06:00 UTC to catch production drift that isn't tied
to a PR (Railway env change, Auth0 tenant edit, DNS blip).

## Phase 1 — public surfaces (this PR, 2026-06-30)

`tests/e2e/public-surfaces.spec.js` — 16 tests, ~6 seconds. Covers:

- Landing page renders + OG meta + JSON-LD parses
- `landing.js` cache-buster is at v3+ (bug-hunt #6 protection)
- `/signup?ref=` and `/login?ref=` preserve the referral code
- `robots.txt` named-bot blocks all carry Disallow rules (bug-hunt #4)
- `sitemap.xml` contains all 13 documented URLs (including the 8 guide slugs)
- `llms.txt` uses "free quote" not "free credit"
- `/guides/` hub renders + doesn't dupe to `/guides/index`
- `/guides/index` 301s to `/guides/`
- All 8 cluster guides return 200
- Per-guide JSON-LD contains BlogPosting + Person + BreadcrumbList
- Unknown slug returns 404 (slug whitelist intact)
- Unknown client-portal token returns 404
- POST to unknown `/q/:token/respond` returns 409 with the lifecycle-aware message

Every one of these tests would have caught a regression Harry actually
reported in the last week.

## Phase 2 — auth-gated journeys (next PR)

Adds a controlled auth bypass so we can drive Dashboard / Edit details /
Redeem flows. Requires two pieces of Railway config:

### 1. Environment variable

Set `AGENT_SMOKE_SECRET` on the Railway service — a 32+ byte
high-entropy value. When set, the `/test/agent-login` endpoint is
mounted. When unset, the endpoint returns 404 (fail-closed).

### 2. Smoke user row

One-off SQL against the production DB:

```sql
INSERT INTO users (id, email, name, plan, profile_complete, created_at, auth_provider)
VALUES (
  'tq_agent_smoke',
  'smoke+agent@fastquote.uk',
  'Agent Smoke',
  'basic',
  TRUE,
  NOW(),
  'agent-smoke'
)
ON CONFLICT (id) DO NOTHING;

-- Seed a profile so the SPA renders past step 1 without prompts
INSERT INTO profiles (user_id, data)
VALUES (
  'tq_agent_smoke',
  '{"companyName":"Smoke Co","fullName":"Agent Smoke","phone":"01234 567890","email":"smoke+agent@fastquote.uk","address":"Smoke Test, YO1 1AA","dayRate":300,"vatRegistered":false,"accreditations":"","showNotesOnQuote":true,"hideLabourDays":false,"region":"West Yorkshire","preferredStoneTypes":[],"mortarUsage":null,"accent":"amber","documentType":"quote"}'::jsonb
)
ON CONFLICT (user_id) DO NOTHING;
```

The smoke user has `plan: 'basic'` so it can only exercise the
customer-facing product — never the admin dashboard.

### 3. Server endpoint (shipped with Phase 2 PR)

```
POST /test/agent-login
  Headers: X-Agent-Secret: <matches AGENT_SMOKE_SECRET>
  Body:    (empty)

  → Signs the smoke user in via req.login(), returns 200 with the
    session cookie. Rate-limited to 10/min/IP.
  → Returns 404 if AGENT_SMOKE_SECRET is unset (production default
    when the feature is disabled).
  → Returns 401 if the secret header is missing or wrong.
```

### 4. GitHub Actions secret

Add `AGENT_SMOKE_SECRET` to the repo Actions secrets so CI can read it.

## Phase 2 journeys (planned)

- **Dashboard tabs** — click Active → Completed → Archived, verify
  visible row count changes. **This is the SET_VIEW_MODE killer.**
- **Edit details** — open a saved smoke quote, click Edit details,
  change the site address, save, verify the address text updated.
  **This is the "did Paul's ask actually ship correctly?" killer.**
- **Redeem self-message** — paste the smoke user's own referral code,
  verify the "That's your own code" message renders and bonus stays 0.
- **Re-analyse and edit quote** — click the destructive button, verify
  it lands on Step 2 rather than nowhere.

## Adding a new journey

1. Add a spec file under `tests/e2e/` — split by user surface, not by
   feature. E.g. `dashboard.spec.js`, `saved-quote.spec.js`.
2. Prefer `request.get()` for status-code assertions (fast) and
   `page.goto()` when you need to run JS + inspect the DOM (slower).
3. **No side-effects on production data without cleanup.** If a test
   writes rows, tag them with `tq_agent_smoke` user_id so a nightly
   cleanup job can prune them. (Cleanup job ships with Phase 2.)
4. Every journey should assert at least one thing that WOULD have
   caught a real regression from the last week — otherwise it's noise.
5. Update this doc's "Phase X" list when the new journey lands.

## When smoke fails on a PR

1. Open the PR's "Details" link next to the `smoke` check
2. Download the `playwright-report-<run_id>` artifact
3. Extract, open `index.html` — it shows the failing test, the
   Playwright trace (network + DOM + screenshots), and the exact
   assertion that broke

If the failure is a genuine regression in your PR, fix it. If the
failure is a production issue unrelated to the PR (Auth0 outage,
Railway hiccup), re-run the workflow — the suite retries twice in CI
before failing, so persistent failure usually means real.
