-- Clients + Sites — undo the backfill (2026-07-07).
--
-- Last-resort revert. Only run if:
--   1. Fresh backup landed in R2 today (see docs/BACKUP.md).
--   2. Harry has explicitly said "yes, wipe".
--   3. Feature flag CLIENTS_ENABLED has been flipped OFF via Railway
--      variables (docs/CLIENTS_ROLLBACK.md § "Lever 1").
--
-- Preserves quote_diffs (the moat), users, and every jobs row
-- (including the inline client_name / site_address / quote_snapshot
-- copies — the historical audit trail is untouched).
--
-- Runbook: docs/CLIENTS_ROLLBACK.md § "Lever 3".

BEGIN;

-- Step 1 — Break the FK from jobs to sites. No data loss; jobs
-- retain their inline client info in client_name / site_address /
-- quote_snapshot.jobDetails.
UPDATE jobs SET site_id = NULL WHERE site_id IS NOT NULL;

-- Step 2 — Drop every row. FK order matters: sites reference clients,
-- so sites first. Both include soft-deleted rows (deleted_at set) —
-- we're wiping everything.
DELETE FROM sites;
DELETE FROM clients;

-- Step 3 — Verify the moat + users survived. Operator eyeballs
-- these counts against the pre-op values. Any drop = ABORT and
-- restore from backup.
SELECT
  (SELECT COUNT(*) FROM quote_diffs) AS quote_diffs_after,
  (SELECT COUNT(*) FROM users)       AS users_after,
  (SELECT COUNT(*) FROM jobs)        AS jobs_after,
  -- These MUST be zero.
  (SELECT COUNT(*) FROM clients)     AS clients_after_zero,
  (SELECT COUNT(*) FROM sites)       AS sites_after_zero;

COMMIT;
