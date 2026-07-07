# Staging environment (TRQ-153)

## Why staging exists

Phase 0 delegates whole tickets to autonomous Claude Code runs. Until
this lands, those runs had only production to act against. Staging
gives the agent a safe place to fail. Anything risky (EU migration,
Stripe live-mode, big schema changes, the autonomy loop itself) gets
validated on staging before prod.

**Decision in the brief:** staging is a Phase 0 prerequisite, not a
Phase 1 nice-to-have. Cost is ~£16–20/mo for the extra Railway
environment, folded into the running-cost model.

## Architecture

Two Railway environments, fully isolated:

| | Production | Staging |
|---|---|---|
| Domain | `fastquote.uk` | `fastquote-staging.up.railway.app` (auto) |
| Database | Real Postgres, real moat | Separate Postgres, sanitised seed |
| OpenAI / Anthropic keys | Real | Real (low-quota) OR fake (no AI calls) |
| Stripe keys | **Live** (post-TRQ-150) | **Test mode only** |
| Google OAuth client | Real | Separate test OAuth client |
| R2 backup target | `fastquote-backups` | `fastquote-backups-staging` (Harry decides; could skip) |
| `SESSION_SECRET` | Real | Separate |

**Hard rule: nothing in staging can reach the prod DB.** Different
`DATABASE_URL`s, different Railway projects (NOT just different envs in
the same project). A staging Railway run that somehow gained shell
access still cannot resolve the prod DB host.

## Harry-only setup (one-time)

This is the human gate for TRQ-153. The agent prepared the seeder
script; you create the Railway environment.

### 1. Create the staging Railway project (10 min)

- Railway dashboard → New project → name `fastquote-staging`.
- Add Postgres plugin (Railway Postgres free tier or hobby — staging
  doesn't need prod-tier resources).
- Add a service from the GitHub repo. Build path: same `Dockerfile`
  as prod.
- Settings → Environment Variables — set everything per the
  Architecture table above. Specifically:
  - `DATABASE_URL` — auto-injected by Railway PG plugin
  - `NODE_ENV=production` (yes, even for staging — the app behaves
    the same; staging-ness is signalled by domain, not by env)
  - `SESSION_SECRET` — generate a fresh value (e.g.
    `openssl rand -hex 32`); never reuse the prod one
  - `ANTHROPIC_API_KEY` — your call: real key with a low spend cap
    set in the Anthropic console, OR a fake string that makes AI
    calls fail cleanly (tests in staging may rely on either; document
    your choice)
  - `OPENAI_API_KEY` — same call
  - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — create a SEPARATE
    OAuth client in Google Cloud Console with `staging.fastquote.uk`
    or the Railway-assigned URL as the authorised redirect
  - `PUBLIC_BASE_URL` — the staging URL
  - `STRIPE_SECRET_KEY` — Stripe Dashboard → test mode → API keys.
    Test keys start with `sk_test_…`. NEVER paste a live key
    (`sk_live_…`) here. Per `docs/SECRETS.md`, this is the bright line.

### 2. Seed staging from sanitised prod (5 min, after step 1)

Run on YOUR LAPTOP, not in either Railway service. Needs Docker for
the scratch DB used in restore-test:

```bash
# Sanity-check the latest prod backup exists in R2:
node scripts/restore-test.js  # restores into scratch, runs check-moat

# Sanitise + load into staging:
export R2_ENDPOINT=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export SANITISER_SALT='pick-any-string-here-and-keep-it-consistent'
export STAGING_DATABASE_URL='postgres://<staging-creds-from-railway>'

# Stream: R2 → gunzip → sanitiser → psql staging.
node scripts/download-r2-backup.js --r2-key daily/<chosen>.sql.gz | \
  gunzip -c | \
  node scripts/sanitise-prod-dump.js | \
  psql "$STAGING_DATABASE_URL"

# Confirm moat tables landed with row counts:
DATABASE_URL="$STAGING_DATABASE_URL" npm run check:moat
```

`download-r2-backup.js` streams the chosen object to stdout (or
`--output <path>` for a file). Logs all go to stderr so the stdout
stream is clean .sql.gz bytes ready to pipe. Run with `--list` to
see what's in the bucket without downloading.

### 3. Verify isolation (2 min)

The staging app must NOT be able to reach the prod DB. Quickest test:

```bash
# From your laptop:
STAGING_URL=https://<staging-railway-url>

# Hit staging /health — should report db: ok (its own DB)
curl -s "$STAGING_URL/health" | jq .

# Then poke at any auth-needed endpoint and confirm you see staging
# data, not prod. E.g. log in as a sanitised "Demo Trader" user
# (their email is `demo-trader-N@staging.fastquote.invalid` — won't
# match Google OAuth, so you'll need legacy login mode, or use the
# fresh Google OAuth client to sign up afresh in staging).
```

If you ever see real names / real emails in the staging UI, the
sanitiser missed a field — open an urgent ticket; do not let staging
hold real PII for any length of time.

## What the sanitiser does (`scripts/sanitise-prod-dump.js`)

Reads a pg_dump plain-SQL stream on stdin, writes a sanitised version
to stdout. Stream-based; never holds the full dump in memory.

**Deterministic fakes via a salted hash.** The same real name maps to
the same fake across runs (with the same `SANITISER_SALT`), so
referential consistency is preserved between `users.name` and the
same name embedded in a `quote_snapshot` JSONB.

**Per-table rules:**

| Table | What's scrubbed |
|---|---|
| `users` | name + email → "Demo Trader N" / `demo-trader-N@staging.fastquote.invalid`; avatar_url → fake URL; auth_provider_id → irreversibly hashed |
| `jobs` | client_name → "Test Client X"; site_address → "Sample Address Lane N"; client_ip / client_user_agent → NULL; decline_reason → "[redacted in staging]"; all four JSONB snapshots scrubbed via regex on known PII keys |
| `profiles` | data JSONB scrubbed (companyName, phone, email, vatNumber, tradingAddress, logo) |
| `clients` | name → "Test Client X" (same pool as `jobs.client_name` for referential consistency); phone → fake number; email → `demo-trader-N@staging.fastquote.invalid`; notes NULLed |
| `sites` | address → "Sample Address Lane N" (same pool as `jobs.site_address`); site_contact_name → fake client-pool name; site_contact_phone → fake number; notes NULLed |
| `user_photos` | Real photo data replaced with a 1×1 placeholder PNG; labels / names replaced |
| `system_errors` | stack + user_agent NULLed; message truncated to 80 chars |
| `pageviews` | referrer NULLed; ua_hash already anonymous |
| `admin_audit` | details JSONB NULLed |
| `drafts` | data JSONB scrubbed |
| Other tables | Pass through unchanged — no PII (quote_diffs, agent_runs, calibration_notes, dictation_runs, agent_retry_queue, session, settings, free_quote_grants, referral_codes, referrals, quote_purchases, events) |

**Hard rule, mechanically enforced:** the script never connects to
any database. It only reads stdin and writes stdout. If you give it
a prod dump, it prints sanitised SQL to your terminal — it cannot
accidentally write to prod.

**`SANITISER_SALT` is required.** No default. This prevents
"I'll just use a default" mistakes that would produce predictable
fake-mappings across different staging refreshes.

## Promote-to-prod flow

The point of staging is that risky changes get validated there
BEFORE they reach prod. The flow:

1. Agent writes the change on a branch.
2. PR opens. CI runs (ci.yml from TRQ-146).
3. **Deploy to staging.** Either:
   - Railway watches a separate `staging` branch — push to it before
     opening the PR.
   - OR: Railway auto-deploys staging from the PR branch via Railway's
     "deployment triggers". Configure in the staging service's
     Settings → Triggers.
4. **Validate on staging.** Manual test of the affected flow.
   For schema migrations: run `npm run check:moat` against staging
   before AND after.
5. PR review (the existing pr-reviewer agent + your review).
6. Merge to `main` → Railway auto-deploys prod.
7. Post-deploy: verify prod via `/health` + a real-flow smoke test.

If anything goes wrong on staging, the PR doesn't merge. Production
stays clean.

### Risky changes that MUST go through staging first

Per the constitution, these get the full staging validation:

- Any schema migration (ALTER TABLE / new tables / new columns).
- Any change to `safeError.js`, the OAuth callback, or session
  middleware.
- Stripe billing changes (TRQ-150) — test-mode validation in
  staging before live-mode in prod.
- Anything that touches the moat tables.
- Any change to the analytics endpoint (high blast radius).

### Routine changes that can skip staging

- Pure documentation edits.
- Test-only additions.
- CSS / copy tweaks behind no functional code.

The agent's default disposition under the constitution is "if in
doubt, use staging." When the agent isn't sure whether a change is
risky, treating it as risky and going through staging is the safe
default — never the other way around.

## Refreshing staging

Run the sanitiser pipeline (step 2 above) again. Idempotent: the
sanitised dump's content replaces the staging DB.

Recommended cadence: monthly. More often than that and the
sanitised data starts to diverge meaningfully from production
shape; less often and staging gets stale and miss-tests new flows.

You can also refresh on demand after a big prod change (e.g. after
a TRQ-149 EU migration).

## Cost

- Extra Railway environment: ~£16–20/mo.
- Sanitiser script: free, runs on your laptop.
- Optional separate R2 bucket for staging backups: pennies if
  enabled; skip if you'd rather just re-seed when needed.

Per the Linear ticket's cost note, profit-at-60-customers moves
from ~£1,040 to ~£1,020/mo. Worth the safety.

## What's NOT in this PR

The initial sanitiser PR shipped the script + the runbook.
`scripts/download-r2-backup.js` shipped as a follow-up. Still NOT
shipped:

- Create the staging Railway environment (Harry-only — Railway
  console).
- Wire promote-to-prod automation (Railway's deployment-trigger
  config is in their dashboard, not in this repo).

These all become trivial follow-ups once the staging env exists.
The blocker right now is the human step in section "Harry-only
setup". When that lands, the rest is mechanical.
