# Backup runbook (TRQ-147)

## What this is

A daily off-platform PostgreSQL backup of the FastQuote production
database to Cloudflare R2. Required because Railway Hobby has no
managed backup and the moat tables (`quote_diffs`, `calibration_notes`,
`agent_runs`) cannot be regenerated.

This is the **single safety net** that makes autonomous production
work survivable.

## How it works

A separate Railway service runs `scripts/backup-to-r2.js` on a daily
cron schedule. Each run:

1. Streams `pg_dump --format=plain` of the production DB.
2. gzip-compresses the stream.
3. Uploads to R2 as `daily/fastquote-YYYY-MM-DDTHHMMZ-<dow>.sql.gz`.
4. Applies retention: keeps the last 7 dumps + 4 weekly (Sunday)
   anchors beyond that, deletes the rest.
5. On failure, POSTs an alert webhook (Slack/Discord-style) if
   configured, and exits with code 1 so Railway surfaces the failure.

Nothing is written to disk on the backup container.

## Initial setup (Harry — once)

1. **Create R2 bucket.** Cloudflare Dashboard → R2 → Create bucket.
   Name `fastquote-backups`. Default storage class. **Encryption at
   rest** is on by default for R2 buckets — confirm.
2. **Create API token.** R2 → Manage R2 API Tokens → Create token.
   Permissions: `Object Read & Write`. Scoped to the bucket above
   only (do not grant account-wide).
3. **Create Railway service.**
   - Project → New Service → Deploy from GitHub repo → select
     `tradequote` repo.
   - Settings → Build → Dockerfile Path: `Dockerfile.backup`.
   - Settings → Networking → no public networking (this is a cron,
     not a web service).
4. **Set env vars on the backup service** (NOT on the main app):
   - `DATABASE_URL` — reference the main app's `DATABASE_URL` via
     Railway variable references so a DB password rotation
     propagates automatically.
   - `R2_ENDPOINT` — `https://<account-id>.r2.cloudflarestorage.com`
   - `R2_BUCKET` — `fastquote-backups`
   - `R2_ACCESS_KEY_ID` — from step 2
   - `R2_SECRET_ACCESS_KEY` — from step 2
   - `BACKUP_ALERT_WEBHOOK` — optional; a Slack incoming webhook URL
     for failure alerts. If unset, failures are still visible in
     Railway's logs but won't push-notify Harry.
5. **Schedule the cron.** Service → Settings → Cron Schedule:
   `0 3 * * *` (03:00 UTC daily; quiet hour both UK and US).
6. **Verify the first run.** Deploy → Run Now. Check Railway logs
   for `backup-to-r2: ok — uploaded ...`. Verify the file in R2
   Dashboard → fastquote-backups.

## Where backups live

- Bucket: **`fastquote-backups`** on Cloudflare R2.
- Prefix: `daily/`
- Filename pattern: `daily/fastquote-2026-06-15T0300Z-sun.sql.gz`
- Format: gzip-compressed plain SQL (restorable with `psql`, not
  `pg_restore`).

Retention is enforced by the script itself, not by R2 lifecycle
rules. This keeps the policy version-controlled and testable.

| Slot | Default count | Why |
|---|---|---|
| `BACKUP_RETENTION_DAILY` | 7 | One week of daily granularity for "yesterday this broke". |
| `BACKUP_RETENTION_WEEKLY` | 4 | Four Sundays beyond the daily window for "this broke a month ago". |

A bad day caught up to ~5 weeks after the fact is still recoverable.

## How to restore (high-level — full procedure in `docs/RESTORE.md`)

```bash
# 1. Find the dump you want
aws --endpoint-url $R2_ENDPOINT s3 ls s3://fastquote-backups/daily/

# 2. Download
aws --endpoint-url $R2_ENDPOINT s3 cp s3://fastquote-backups/daily/<key>.sql.gz ./

# 3. Restore into a SCRATCH database (never prod)
gunzip -c <key>.sql.gz | psql "$SCRATCH_DATABASE_URL"

# 4. Run check-moat against the scratch
DATABASE_URL=$SCRATCH_DATABASE_URL npm run check:moat
```

**Production restore is a Harry-only operation.** TRQ-148 covers the
scratch-DB verification workflow; TRQ-149's EU-migration runbook
covers the prod-cutover variant.

## Monitoring + failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| No dump for today | Backup cron didn't fire | Railway → backup service → Deployments. Check the scheduled-run log. |
| Dump size is suddenly tiny | pg_dump errored mid-stream | Check Railway logs for the stderr capture. Usually a DB password rotation or schema break. |
| Webhook alert fired but Railway log says ok | Should not happen | Check the alert URL; the webhook config may have rotted. |
| All dumps say `-sun.sql.gz` | Clock drift inside the container | Confirm Railway's container timezone; the script uses UTC. |

## Why this isn't in the main app

- The main app runs Express + Vite build + Chromium. None of that is
  needed to call `pg_dump` + `s3 PutObject`. Separating the services
  keeps the image lean and the failure modes independent.
- A backup container crash never takes the app down.
- An app deploy never delays a backup.
- The backup service has its own (scoped) R2 credentials; the main
  app never holds them.

## What's NOT in this runbook

- Restore-test verification — see TRQ-148 and `docs/RESTORE.md` (in
  progress).
- The EU migration's pre-cutover backup procedure — see TRQ-149's
  ticket (forthcoming).
- Erasure / GDPR right-to-be-forgotten interaction with R2 — see
  TRQ-158. Note: erasing a user's data in production doesn't remove
  them from old R2 dumps; those age out by retention.

## Cost estimate

- Cloudflare R2 has no egress fees and ~$0.015/GB-month for storage.
- A FastQuote dump is currently ~5-10 MB gzipped; 30 dumps at most
  in retention = under 1 GB stored.
- Total monthly cost: **well under $0.10**. Effectively free.
