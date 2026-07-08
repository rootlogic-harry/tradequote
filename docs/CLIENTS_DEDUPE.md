# Clients dedupe runbook

**When to run:** Once, after the backfill (PR #2) has landed and you
want to collapse duplicate-name clients server-side instead of forcing
each user through the interactive merge banner.

**Written for:** Harry-only. Uses the same PG credentials as the
existing backfill run in `docs/CLIENTS_ROLLBACK.md`.

## What it does

Runs `scripts/dedupe-clients.sql` against production. For every group
of clients with the same `(user_id, lower(trim(name)))` (excluding
backfill placeholders `Draft — YYYY-MM-DD`):

1. Picks the earliest-created row as the WINNER (ties broken by id lex-min).
2. Reparents every non-deleted site from each loser to its winner.
3. COALESCEs the winner's null phone/email/notes from losers (never
   overwrites user-entered data).
4. Soft-deletes each loser (`deleted_at = NOW()`).
5. Writes a persistent `clients_dedupe_history` row per loser so undo
   can be run later.

**Idempotent.** Filter is `deleted_at IS NULL`, so a soft-deleted row
never re-appears on a subsequent run.

**Moat-safe.** Never reads or writes `quote_diffs`, `agent_runs`, or
`calibration_notes`.

## Before you run

1. **Confirm today's R2 backup landed.** Same guarantee as the
   original backfill — the daily dump is the last-resort restore.
   See `docs/BACKUP.md` for the R2 bucket path.
2. **Take a note of current counts.** Runbook expects them at step 3.

```sql
SELECT COUNT(*) FROM clients WHERE deleted_at IS NULL;
SELECT COUNT(*) FROM sites   WHERE deleted_at IS NULL;
SELECT COUNT(*) FROM jobs    WHERE site_id IS NOT NULL;
-- Moat baseline (must not change during dedupe):
SELECT COUNT(*) FROM quote_diffs;
```

## Run it

```bash
railway run --service <postgres-service> \
  psql "$DATABASE_URL" -f scripts/dedupe-clients.sql
```

The script emits a verification row at the end:

```
 active_clients_after | soft_deleted_clients_after | active_sites_after | jobs_with_site_after | merges_this_run | winners_this_run
---------------------+----------------------------+--------------------+----------------------+-----------------+------------------
                 45  |                        30  |                75  |                  75  |             30  |               15
```

- `merges_this_run` = number of losers soft-deleted.
- `winners_this_run` = number of surviving clients that absorbed losers.
- `active_clients_after` + `soft_deleted_clients_after` = pre-run count.

Confirm the moat baseline is unchanged:

```sql
SELECT COUNT(*) FROM quote_diffs;
```

If the number moved by any amount, **stop and escalate to Harry**. The
script should not touch that table; a delta means something else is
wrong.

## Undo (best-effort, same day)

If the results look wrong before writing new client data, run:

```bash
railway run --service <postgres-service> \
  psql "$DATABASE_URL" -f scripts/undo-dedupe-clients.sql
```

The undo un-tombstones every loser from the LATEST run. **Sites already
reparented STAY on the winner** — the undo does not move them back.

If the undo is insufficient (e.g. a user has already accepted new
quotes onto a re-parented site), the correct path is a PG dump replay
from R2 per `docs/BACKUP.md`.

## Aftermath

- Users still see the merge banner if any duplicates remain (e.g. new
  quotes accidentally created a new "Yorkshire Estates" post-dedupe).
  That's expected — this script is a one-shot cleanup of the backfill,
  not an ongoing enforcement.
- The `clients_dedupe_history` table persists for future undo attempts
  and light audit. Do not truncate it without approval.
