# Restore runbook (TRQ-148 + disaster recovery)

Two procedures live here:

1. **Restore-test** — routine verification that the latest R2 backup
   is restorable. Runs against a throwaway scratch DB. Safe to run
   anytime. This is what unblocks the EU migration (TRQ-149).
2. **Disaster recovery** — Harry-only procedure for restoring into a
   real production-shaped database. Documented at the bottom.

The two procedures share the same dump format but DIFFER in target
and verification depth. Don't mix them up.

---

## 1. Restore-test (routine — agent-safe)

There are two ways to run this. The Docker-based script
(`scripts/restore-test.js`) is the intended automation; the
manual brew/`initdb` path below is the no-Docker fallback and
is what was actually executed for the first TRQ-148 drill on
2026-06-17.

### 1A. Automated path — `scripts/restore-test.js`

What it does:

1. Picks the latest `.sql.gz` from R2 (or accepts `--file` /
   `--r2-key` for a specific dump).
2. Downloads it into the host `/tmp`.
3. Spins up a throwaway `postgres:18` container on a random
   ephemeral port (Docker default). With `--no-docker`, runs
   brew's `postgresql@18` cluster in `/tmp` via `initdb` +
   `pg_ctl` — same outcome, no Docker required.
4. Streams `gunzip -c | psql -v ON_ERROR_STOP=1` — fails fast
   on the first SQL error rather than leaving a half-restored DB.
5. Runs `scripts/check-moat.js --fresh` against the restored DB.
6. Tears it down (unless `--keep`).

**Hard rule, mechanically enforced:** the `DATABASE_URL` this script
uses is always `postgres://restore-test:restore-test@localhost:<port>/postgres`
(Docker) or `postgres://restore-test@localhost:<port>/postgres`
(no-Docker — trust auth on Unix socket, no password needed).
If the URL ever resolves to a non-localhost host, the script refuses
to run. There is no path through this script that can touch
production.

### Prerequisites for 1A

Either Docker OR brew's postgresql@18. The script auto-detects which
one is in play based on `--no-docker`:

- **Docker path** (default): Docker Desktop running locally.
- **No-Docker path**: `brew install postgresql@18` (one-time).
  Override `PG_BIN` if your install lives elsewhere.

R2 env vars (only if reading directly from R2 — `--file` skips these):
```bash
export R2_ENDPOINT=https://<acct>.eu.r2.cloudflarestorage.com   # note the .eu. infix
export R2_BUCKET=fastquote-backups
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
```

No DB env needed — the script picks its own ephemeral port.

### 1B. Manual path — brew + `initdb` (no Docker needed)

The path actually used for the first TRQ-148 drill. Works on Harry's
M3 Mac end-to-end in ~6 minutes including the one-time brew install.

```bash
# One-time setup — installs Postgres 18 binaries (psql, initdb,
# pg_ctl, pg_dump). Matches the production major.
brew install postgresql@18

# Throwaway working dir — /tmp so the OS reaps it even if cleanup
# is forgotten.
mkdir -p /tmp/fastquote-restore
cd /tmp/fastquote-restore

# Download the newest dump from R2. Easiest is the Cloudflare R2
# dashboard → fastquote-backups → sort by Last Modified → Download.
# Save as /tmp/fastquote-restore/latest.sql.gz.

# Spin up an ephemeral cluster on port 55432. Unix socket lives in
# the working dir so authentication is local-only (no TCP open).
PG_BIN=/opt/homebrew/opt/postgresql@18/bin
SOCK=/tmp/fastquote-restore

$PG_BIN/initdb -D $SOCK/pgdata -E UTF-8 --locale=en_US.UTF-8 \
  -U restore_user --auth=trust
$PG_BIN/pg_ctl -D $SOCK/pgdata -l $SOCK/pg.log \
  -o "-p 55432 -k $SOCK" start
$PG_BIN/createdb -h $SOCK -p 55432 -U restore_user restore_scratch

# Restore. Plain SQL dump → psql, NOT pg_restore. ON_ERROR_STOP=0
# tolerates a few set_config warnings during the prelude; check
# stderr afterwards for actual ERROR: lines.
gunzip -c latest.sql.gz | $PG_BIN/psql -h $SOCK -p 55432 \
  -U restore_user -d restore_scratch -v ON_ERROR_STOP=0 -X --quiet \
  2> psql.err
grep -i '^ERROR:' psql.err || echo "clean restore"

# Verify with the same script CI uses on prod.
cd ~/Documents/Cloud\ Drive/FastQuote
DATABASE_URL="postgres://restore_user@localhost:55432/restore_scratch" \
  node scripts/check-moat.js

# Sanity: row-count parity with prod (see step 2 of the runbook
# below for the prod side via railway run).

# Tear down.
$PG_BIN/pg_ctl -D /tmp/fastquote-restore/pgdata stop
rm -rf /tmp/fastquote-restore
```

The brew install of `postgresql@18` stays — it's the tool, not data.

### Prerequisites for 1B

- `brew install postgresql@18` (one-time, ~2 min).
- An R2 dashboard tab open (or the credentials handy) to grab the
  latest dump. The dump is ~300 MB compressed.
- ~600 MB free in `/tmp`.

### Run the automated path (1A)

```bash
# Most common — newest R2 backup, Docker
node scripts/restore-test.js

# A specific R2 backup
node scripts/restore-test.js --r2-key daily/fastquote-2026-06-14T0300Z-sat.sql.gz

# A local file (e.g. after manual download)
node scripts/restore-test.js --file ~/Downloads/dump.sql.gz

# Keep the scratch DB after success (useful for ad-hoc inspection)
node scripts/restore-test.js --keep

# Skip Docker, use brew postgresql@18 instead
node scripts/restore-test.js --no-docker --file ~/Downloads/dump.sql.gz
```

### Expected output (happy path)

```
R2: downloading daily/fastquote-2026-06-15T0300Z-sun.sql.gz…
R2: downloaded 7.84 MB → /tmp/fq-restore-XXX/backup.sql.gz
docker: starting postgres:15 on port 51234 (name restore-test-ab12cd34)…
docker: restore-test-ab12cd34 ready on :51234
restore: streaming /tmp/fq-restore-XXX/backup.sql.gz into restore-test-ab12cd34…
check-moat: running --fresh against the restored DB…
check-moat (fresh DB)
────────────────────────────────────────────────────────────
  ✓ quote_diffs          12,034 rows (floor 0)
  ✓ calibration_notes    9 rows (floor 0)
  ✓ agent_runs           3,128 rows (floor 0)
────────────────────────────────────────────────────────────
All moat checks passed.
docker: stopping restore-test-ab12cd34…

✓ restore-test passed: backup restored cleanly, moat tables present.
```

### Sign-off gate (TRQ-148 acceptance criterion)

Harry must personally watch this run succeed end-to-end at least
once before the EU migration (TRQ-149) is allowed to proceed. The
output above is what "succeeded" looks like.

#### First drill — 2026-06-17

Path 1B (manual brew + `initdb`) against
`daily/fastquote-2026-06-17T0725Z-wed.sql.gz` (304 MB gzipped).

```
✓ quote_diffs          642 rows (floor 100)
✓ calibration_notes    16 rows (floor 1)
✓ agent_runs           154 rows (floor 100)
All moat checks passed.
```

Row counts matched production exactly across `quote_diffs` (642),
`calibration_notes` (16), `agent_runs` (154), `users` (10), `jobs`
(58), `profiles` (8), `drafts` (5). FK orphan check returned six
zeroes across the parent/child relationships
(`jobs→users`, `quote_diffs→jobs`, `agent_runs→users`,
`agent_runs→jobs`, `profiles→users`, `drafts→users`). 14 FK
constraints + 37 indexes restored. End-to-end wall time on Harry's
M3 Mac was under 6 minutes including the brew install.

Next scheduled drill: **2026-09-17** (quarterly cadence).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Backup restored + moat check passed |
| `1` | Restore failed OR moat check failed against the restored DB |
| `2` | Setup error (Docker missing, R2 env missing, etc.) |

### Tree-order restore

This codebase's foreign keys form a **tree rooted at `users`**, not a
cycle. The dump is a plain `pg_dump --format=plain` so its statement
order already respects this: `CREATE TABLE` / `INSERT` for `users`
happens before any table that references them. The restore-test
script just streams the dump through `psql` — no manual ordering
needed.

This is worth knowing for two reasons:

1. The EU migration (TRQ-149) restores into a brand-new EU database
   using the exact same `pg_dump | psql` shape — no extra steps.
2. If anyone hand-builds a partial restore (e.g. recovering just
   `quote_diffs` for an audit), the order is:
   `users → jobs → quote_diffs / agent_runs / calibration_notes / admin_audit
   → session / settings / profiles / drafts / user_photos / dictation_runs
   / agent_retry_queue / system_errors / pageviews`.

---

## 2. Disaster recovery (Harry-only — production restore)

Use this when production data needs to be replaced from a backup —
e.g. a destructive migration went wrong, or the live DB is lost.

**Do not run this without Harry's explicit decision.** Restoring
production over itself loses every write since the backup
timestamp. The restore-test (procedure 1 above) does NOT mutate
production; this one does.

### Before you start

- [ ] Confirm WHICH backup you want to restore from. Newest is not
      always right — if the issue happened 6 hours ago, the latest
      backup is still pre-incident; if it happened 30 hours ago, you
      need yesterday's.
- [ ] Confirm Mark + Paul know the app will be down. Estimate
      15-30 minutes.
- [ ] Take a fresh backup of the current state RIGHT NOW even if
      you don't expect to want it — the live DB is about to be
      overwritten.

### Procedure

```bash
# 1. Download the chosen backup (use the restore-test machinery to
#    fetch it without restoring)
node scripts/restore-test.js --r2-key daily/<chosen>.sql.gz --keep
# ^ this restores into a SCRATCH instance — verify it looks right first
docker exec restore-test-<hash> psql -U restore-test -d postgres \
  -c "SELECT COUNT(*) FROM users, quote_diffs;"

# 2. Tear down the scratch
docker stop restore-test-<hash>

# 3. Get the prod DATABASE_URL from Railway (Variables tab). Treat
#    it as sensitive — don't paste it into chat.

# 4. Pause the Railway service so the running app stops writing.
#    Railway dashboard → main service → Settings → Disable.

# 5. Restore. THE COMMAND BELOW WRITES TO PRODUCTION.
#    Note the WHERE clause is on the TABLE — pg_dump already
#    starts with TRUNCATE/CREATE statements that purge the
#    existing tables. There is no partial-restore mode here.
gunzip -c /path/to/<chosen>.sql.gz | psql "$PROD_DATABASE_URL"

# 6. Run moat check against PROD. Use the actual prod floors
#    (no --fresh).
DATABASE_URL="$PROD_DATABASE_URL" npm run check:moat

# 7. Re-enable the Railway service.
#    Railway dashboard → main service → Settings → Enable.

# 8. Verify the app is up:
curl -s https://fastquote.uk/health | jq .
```

### Rollback if step 5 goes wrong

The fresh backup from step's prep ("take a fresh backup right now")
is your rollback target. Replay the same procedure with that file as
the source. Yes — this means restoring a broken DB BACK over a fresh
restore is the recovery path. That's why step 5's prep matters.

### Post-recovery

- [ ] Email Mark + Paul: incident summary, what was lost (writes
      since the backup timestamp), what was recovered.
- [ ] Open a Linear ticket with the timeline + root cause.
- [ ] If a moat table count dropped, the loss is real and unrecoverable
      from THIS backup. Consider whether an earlier backup is closer
      to truth (rare — pre-incident usually means a few hours back, not
      days).

---

## Common pitfalls

### Pitfall: `ON_ERROR_STOP=1` fails mid-restore on extension errors

`pg_dump` includes `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at the
top. Some Postgres images ship without pgcrypto installed. The
restore-test script uses the official `postgres:15` image which
includes it. If you swap the image (don't), check for this first.

### Pitfall: ephemeral port collision

`scripts/restore-test.js` picks a random port in 49152–65535. On a
laptop with many docker containers this can collide. The error from
`docker run` is clear; just re-run.

### Pitfall: dump older than the schema

If a TRQ has added a column since the dump was taken, the restored
DB will be MISSING that column. The next `initDB()` (server startup
against a restored DB) will silently add it via `ALTER TABLE IF NOT
EXISTS`. No action needed for forward-compat columns; the moat tables
themselves are append-only and don't drop columns.

### Pitfall: assuming restore-test == disaster recovery

They share a script (the download path) and a verification (the moat
check). They DO NOT share a target. The restore-test target is always
localhost-only and short-lived; the disaster recovery target is
production. If you find yourself feeding `$PROD_DATABASE_URL` into
`scripts/restore-test.js`, stop — that script will refuse, and you
should be following procedure 2 above instead.
