# EU migration runbook (TRQ-149)

> **Status:** prepared, not executed. The agent prepares; Harry executes
> the irreversible cutover. The constitution requires explicit human
> go-ahead for any region change because it touches the moat tables.

## What this is

Move FastQuote's production data + application from `us-west2` (US West,
California) to `europe-west4` (EU West, Amsterdam). The driver is UK GDPR:
processing UK residents' and their end-clients' personal data + property
photos in the US creates an international-transfer problem that's clean to
avoid by living in the EU.

This document is the **prepared cutover plan**. It is partner to:

- `docs/BACKUP.md` — daily R2 dump that the cutover relies on
- `docs/RESTORE.md` — restore-test that proved the backup is recoverable
- `docs/ROLLBACK.md` — rollback decision criteria during/after the move
- `scripts/eu-migration-dryrun.js` — proves the dump → restore → verify
  pipeline works end-to-end before any production move

## Current state (verified via Railway GraphQL on 2026-06-17)

| Field | Value |
|---|---|
| Project | `tradequote` (id `dd8ab54b-…`) |
| Environment | `production` |
| Plan | **Hobby** |
| Web service | `tradequote` — region inherited from project |
| DB service | `Postgres-8Dej` — `multiRegionConfig: { us-west2: { numReplicas: 1 } }` |
| DB image | `ghcr.io/railwayapp-templates/postgres-ssl:18` |
| Volume mount | `/var/lib/postgresql/data` (Postgres data dir) |
| Backup service | `fastquote-backup-service` — reads `DATABASE_URL` reference |
| EU regions available | `europe-west4` (Amsterdam), incl. `europe-west4-drams3a` and `europe-west4-drams11a` |

## The two cutover paths

Railway's region change for a service with a volume *can* migrate the volume
in place — **but** (a) requires Pro plan, (b) causes downtime during the
move, and (c) on some older DBs the dropdown refuses to relocate. The
dump-and-restore path side-steps all three.

### Path A — Region dropdown (in-place volume migration)

**Requires Pro plan upgrade first.** Then in the Railway dashboard:
Service → Settings → Region → pick `europe-west4`. Railway snapshots the
volume, attaches it to a new node in the target region, and resumes. The
service is offline for the duration of the volume copy.

Pros:
- One-button operation; less mechanical room for error
- Same Postgres service, same internal URL, no DATABASE_URL repointing
- No risk of "I forgot to repoint X" loose ends

Cons:
- Requires Pro upgrade just to start
- Downtime is unknowable in advance (volume-size-dependent)
- Reportedly fails on older DB services with a confusing error — no obvious
  retry path
- Reversibility is unclear; once initiated, the rollback story is
  "dropdown back to us-west2 and re-migrate"

### Path B — Dump + restore into a fresh EU Postgres (recommended)

Create a brand-new Postgres service in `europe-west4`. Dump the current US
DB. Restore into the new EU DB. Repoint `DATABASE_URL` references. Leave the
old US DB stopped (not deleted) for 7 days as the rollback target. Then
delete it.

Pros:
- **Plan-agnostic** — works on Hobby, no upgrade prerequisite
- Backup-tested mechanism — same `pg_dump | psql` shape as the verified
  TRQ-148 restore drill
- **Reversible until the DATABASE_URL is swapped.** If anything looks wrong,
  the old US DB is still live and serving — just don't switch the env var
- The old DB stays in place for 7 days as a rollback target, in addition to
  the R2 backups
- Lets us verify the new DB independently before committing

Cons:
- Two services instead of one until the old one is deleted (small extra
  cost for 7 days)
- DATABASE_URL repointing has to happen on **two** services: `tradequote`
  (main app) and `fastquote-backup-service`
- A small write-loss window exists if any request writes to the old DB
  between "fresh dump taken" and "DATABASE_URL repointed". Mitigation:
  put the app in maintenance mode during the cutover (steps below)

**Recommended path: B.** Reversibility wins. The Hobby-plan-friendliness is
a side benefit.

## Path B — Cutover runbook

### Pre-cutover (Harry's prep, no irreversible steps)

- [ ] Confirm the daily backup ran successfully overnight. Latest object in
      `s3://fastquote-backups/daily/` should be from today's 03:00 UTC
      tick.
- [ ] Run a fresh restore drill so the restore-test stays warm:
      ```bash
      node scripts/restore-test.js --no-docker
      ```
      Expected output: `✓ restore-test passed: backup restored cleanly,
      moat tables present.` Anything else = stop, investigate.
- [ ] Pick a low-traffic cutover window. Suggested: a UK weekend
      mid-morning (no overnight EU traffic to lose either). Notify
      Mark + Paul so they don't try to use the app.
- [ ] Stripe is in test mode → no live billing risk during the move.
- [ ] React 18→19 (TRQ-117) is shipped and stable → safe to migrate
      on top of it.

### Cutover (Harry — in order, irreversible step is clearly marked)

The agent has done everything possible up to the irreversible step. From
here Harry follows the runbook.

#### 1. Create the EU Postgres service (15 min, reversible)

- Railway dashboard → tradequote project → New Service → Database →
  Postgres.
- Settings → Region → `europe-west4` (Amsterdam).
- Wait for the service to come up. Capture its public + private URLs from
  the Variables tab.
- Verify by connecting from local:
  ```bash
  PG_BIN=/opt/homebrew/opt/postgresql@18/bin
  $PG_BIN/psql "<EU_DATABASE_PUBLIC_URL>" -c "SELECT version();"
  ```
- Expected output: PostgreSQL 18.x running.

This step is fully reversible — if anything looks off, delete the new
service and try again. Nothing in production has changed yet.

#### 2. Take a final pre-cutover dump (5 min, reversible)

The daily backup at 03:00 UTC is good; this fresh one is belt-and-braces.

- Trigger a manual backup-service run via the Railway dashboard
  (Service `fastquote-backup-service` → Redeploy). It'll pick up the new
  cron tick or you can edit the cron schedule to fire in 2 min and revert
  after.
- Wait for the run to land in R2. Object key will be
  `daily/fastquote-<today>T<HH><MM>Z-<dow>.sql.gz`.
- Note the object key. **This is the rollback dump if anything goes wrong
  in step 3 or later.**

#### 3. App into maintenance mode (2 min, reversible)

Stop the main app from writing to the old DB so the new DB can be loaded
from a stable snapshot.

- Easiest: set `MAINTENANCE_MODE=1` env var on the `tradequote` service.
  The server already returns a 503 with a maintenance banner when this is
  set (see `server.js` startup section).
- Alternative if that doesn't exist: temporarily scale `tradequote` to 0
  replicas via the dashboard.

Verify by hitting `https://fastquote.uk/health` — should return 503 or
the maintenance banner.

#### 4. Restore the dump into the EU DB (10–15 min, reversible)

Stream from R2 into the new EU service. Same shape as the restore drill.

```bash
# Download the fresh dump locally
KEY=daily/fastquote-<today>T<HHMM>Z-<dow>.sql.gz
mkdir -p /tmp/fq-eu-cutover
cd /tmp/fq-eu-cutover
# Use the same approach as scripts/restore-test.js downloadFromR2,
# or the Cloudflare R2 dashboard Download button.

# Restore into EU
gunzip -c dump.sql.gz \
  | $PG_BIN/psql "<EU_DATABASE_PUBLIC_URL>" \
      -v ON_ERROR_STOP=1 --quiet

# Verify row counts against the OLD US DB (read-only, no writes)
$PG_BIN/psql "<US_DATABASE_PUBLIC_URL>" \
  -c "SELECT 'users', COUNT(*) FROM users UNION ALL
      SELECT 'jobs', COUNT(*) FROM jobs UNION ALL
      SELECT 'quote_diffs', COUNT(*) FROM quote_diffs UNION ALL
      SELECT 'calibration_notes', COUNT(*) FROM calibration_notes UNION ALL
      SELECT 'agent_runs', COUNT(*) FROM agent_runs ORDER BY 1;"

$PG_BIN/psql "<EU_DATABASE_PUBLIC_URL>" \
  -c "SELECT 'users', COUNT(*) FROM users UNION ALL
      SELECT 'jobs', COUNT(*) FROM jobs UNION ALL
      SELECT 'quote_diffs', COUNT(*) FROM quote_diffs UNION ALL
      SELECT 'calibration_notes', COUNT(*) FROM calibration_notes UNION ALL
      SELECT 'agent_runs', COUNT(*) FROM agent_runs ORDER BY 1;"

# Run moat-check against the EU DB
DATABASE_URL="<EU_DATABASE_PUBLIC_URL>" node scripts/check-moat.js
```

All counts must match (the dump was taken with the app in maintenance
mode, so there's nothing in flight). `check-moat` must pass.

If anything is off: do NOT proceed to step 5. Lift maintenance mode (step
3 reversal), keep using the US DB, investigate, retry from step 2.

#### 5. ⚠️ IRREVERSIBLE — repoint DATABASE_URL on both services

This is the only truly irreversible step. After this, writes go to the EU
DB. Any write that hits the EU DB and then has to be rolled back to the US
DB is lost (or has to be replayed by hand).

- `tradequote` service: Variables → `DATABASE_URL` → change the reference
  from the old US Postgres service to the new EU Postgres service. (If it
  was set as a plain string instead of a reference, paste the new EU URL.
  Plain strings are discouraged — fix this on the way through.)
- `fastquote-backup-service`: same change. The backup needs to dump from
  the EU DB going forward.
- Re-deploy both services so the new env propagates.

#### 6. Lift maintenance mode (2 min)

- `tradequote` service: unset `MAINTENANCE_MODE`. Re-deploy.
- Hit `https://fastquote.uk/health` — should return 200 with `db: 'ok'`.
- Run an end-to-end smoke: log in as Mark, open an existing quote, save
  a tiny edit. The edit must round-trip — that proves the EU DB is being
  written and read.

#### 7. Verify the next backup goes to R2 from the EU DB

- Manually trigger the backup service one more time (Service → Redeploy
  with cron set to fire in 2 min).
- Watch logs for `backup-to-r2: ok — uploaded daily/fastquote-…`. The
  file size should be roughly the same as recent dumps (~300 MB
  compressed).
- The dump now contains the EU-region snapshot.

#### 8. Keep the US DB for 7 days, then delete

Don't delete the old Postgres service immediately. Stop it (Settings →
Pause) so it doesn't accept connections, but leave the data around as a
rollback target on top of the R2 backups.

- 2026-06-24 (or +7 days from cutover): if no surprises have surfaced,
  delete the US Postgres service.
- Update `docs/EU-MIGRATION.md` with "completed on <date>; old service
  deleted on <date>".

### Rollback (if step 4 verification fails or step 5/6/7 surface a problem)

The window for clean rollback is **until step 5**. After step 5, partial
writes to the EU DB mean rollback loses those writes.

#### Before step 5 (no writes lost)
1. Lift maintenance mode on `tradequote` (revert step 3).
2. Leave the new EU service alone — investigate the discrepancy.
3. Delete the new EU service once root cause is understood.

#### After step 5 (writes since cutover are lost)
1. Repoint `DATABASE_URL` on both services back to the old US Postgres.
2. Re-deploy.
3. Surface to Mark + Paul: any quotes saved since cutover are gone; ask
   them to re-save anything they remember. Open an incident ticket.
4. Investigate the EU DB issue. Don't retry until root cause is clear.

## Path A — region dropdown (not recommended, captured for completeness)

If Path B turns out to be impractical, the dropdown path is the alternative.

1. Upgrade to the Pro plan (Railway dashboard → Account → Billing).
2. Take a fresh dump (as in Path B step 2) — pure belt-and-braces. The
   dropdown migration is supposed to preserve the volume, but a corrupt
   move would be unrecoverable without the dump.
3. Maintenance mode on the app (as Path B step 3) so nothing writes
   during the migration.
4. Service `Postgres-8Dej` → Settings → Region → `europe-west4`.
   Confirm. Railway moves the volume. Watch the service logs.
5. When complete, smoke-test as Path B steps 6–7.

If the dropdown errors out with a "volume cannot be migrated" message,
abandon Path A and fall through to Path B.

## Dry-run script

`scripts/eu-migration-dryrun.js` proves the Path B mechanism works
without touching production. It:

1. Downloads the latest R2 backup.
2. Spins up a throwaway scratch Postgres locally (via
   `restore-test.js`-style brew/`initdb` or Docker).
3. Streams the dump into it.
4. Runs `check-moat.js` against it.
5. Confirms row counts match what `pg_dump` claims in its header.

This is the same machinery as `scripts/restore-test.js` — the dry-run
script is a thin wrapper that documents the script's role as the "we've
already proven the dump+restore works" step in the runbook.

Run before each cutover attempt:

```bash
node scripts/eu-migration-dryrun.js --no-docker
```

Expected output: `✓ EU-migration dry-run passed.`

### Latest dry-run result — 2026-06-19

| Step | Time |
|---|---|
| Local Postgres spin-up (initdb + pg_ctl) | ~2 s |
| Streaming gunzip → psql restore of 287 MB dump | ~3 s |
| check-moat against the restored DB | <1 s |
| Tear-down | <1 s |
| **Total wall-clock** | **6.5 s** |

Real-world cutover (Harry's laptop → Railway EU Postgres over the
internet) will add:

- R2 → local download (~30 s on a typical broadband connection)
- psql restore over network (~30-60 s vs ~3 s local)

So plan **~1-2 minutes** for the dump+restore step on cutover day,
not 6 seconds. Maintenance-mode window total is probably 5-10
minutes including verification.

## Readiness status — 2026-06-19

Every pre-cutover prerequisite is green:

- ✅ Backup runs nightly (TRQ-147) — latest at
  `daily/fastquote-2026-06-19T0302Z-thu.sql.gz`
- ✅ Restore proven on real-but-throwaway Postgres (TRQ-148)
- ✅ Dry-run passes against today's backup (this section)
- ✅ Rollback rehearsed on staging — 17 s recovery (TRQ-154)
- ✅ Staging env exists + seeded — `tradequote-staging.up.railway.app`
  is alive, useful as a dress-rehearsal target if you want one
- ✅ Sanitiser hardened against pg_dump v18 quirks (PR #30)

**The agent's prep is complete.** When ready, follow this runbook's
Path B steps 1-7 in order. Steps 1-4 are reversible (delete the new
EU service if anything looks wrong). Step 5 — the `DATABASE_URL`
repoint on `tradequote` + `fastquote-backup-service` — is the only
irreversible part, and it's deliberately Harry-only per the
constitution.

## Acceptance criteria (TRQ-149)

- [x] Migration path confirmed and documented (Path B recommended over A)
- [x] Migration script (dry-run) written and proven against scratch DB
- [x] Cutover runbook prepared, including rollback
- [ ] Fresh backup taken immediately before cutover (Harry, at execution time)
- [ ] **Harry**: Cutover executed; app serving from EU; `DATABASE_URL` updated
- [ ] Backup service re-pointed at EU DB; moat-integrity check passes
      post-move

## Constitution check

Per `CLAUDE.md` Safety Layer:
- Production DB is sacred (`quote_diffs`, `calibration_notes`, `agent_runs`
  cannot be regenerated) → cutover is gated on a confirmed-restorable
  backup (TRQ-148, done).
- No irreversible infra actions without explicit human go-ahead → step 5
  (the only irreversible step) is clearly marked as **Harry's only**.
- No live secrets in commits/logs → all DB URLs in this doc are
  placeholders.

## Source

TRQ-149 (Linear). Prior research: Railway region-migration mechanics
captured in the ticket body. Current state read via Railway GraphQL API
on 2026-06-17 (deployment meta confirmed `us-west2` region, Hobby plan,
Postgres 18).
