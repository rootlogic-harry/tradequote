-- Clients + Sites backfill (2026-07-07).
--
-- Runs ONCE, manually, against production after PR #2 ships (schema)
-- and before PR #5 flips CLIENTS_ENABLED=true. Backup-gated —
-- do NOT run without confirming the daily R2 backup landed today.
--
-- Runbook: docs/CLIENTS_SPEC_v3.md § 5 (placeholder-on-save rule)
-- and docs/CLIENTS_ROLLBACK.md § "Lever 3" (undo script).
--
-- Contract:
--   * One clients row + one sites row per existing jobs row that does
--     not already have a site_id set.
--   * No dedupe at backfill — Paul consolidates via the merge banner.
--   * Placeholder clients (blank name) named "Draft — YYYY-MM-DD",
--     status='needs_visit', so they surface in the client list under
--     the "needs a name" chip.
--   * jobs.site_id set once the site exists.
--   * Idempotent — re-running is a no-op because we filter to jobs
--     where site_id IS NULL. A job that already got backfilled is
--     already attached and gets skipped.
--   * The moat learning table is never touched.
--   * jobs.quote_snapshot inline copies are never blanked — they
--     remain HISTORICAL truth per the spec.
--
-- Failure recovery: single transaction rolls back cleanly on any
-- error. Undo (if outcome is wrong): scripts/undo-clients-backfill.sql.

BEGIN;

-- We use a temporary table to hold (job_id, new_client_id, new_site_id)
-- triples so all three writes (client insert, site insert, jobs
-- attach) share the same generated UUIDs without needing a sentinel
-- column on clients/sites. The temp table is dropped at COMMIT.
CREATE TEMP TABLE backfill_plan ON COMMIT DROP AS
SELECT
  j.id                          AS job_id,
  j.user_id                     AS user_id,
  j.saved_at                    AS saved_at,
  gen_random_uuid()::text       AS new_client_id,
  gen_random_uuid()::text       AS new_site_id,
  COALESCE(
    NULLIF(TRIM(j.client_name), ''),
    NULLIF(TRIM(j.quote_snapshot->'jobDetails'->>'clientName'), '')
  )                             AS resolved_client_name,
  NULLIF(TRIM(j.quote_snapshot->'jobDetails'->>'clientPhone'), '') AS resolved_phone,
  COALESCE(
    NULLIF(TRIM(j.site_address), ''),
    NULLIF(TRIM(j.quote_snapshot->'jobDetails'->>'siteAddress'), ''),
    'Address not set'
  )                             AS resolved_address
FROM jobs j
WHERE j.site_id IS NULL;

-- Step 1 — Insert one clients row per plan entry. Placeholder naming
-- kicks in when both denormalised and JSONB client names are blank.
-- ON CONFLICT DO NOTHING is defence-in-depth — the plan filter above
-- already excludes jobs that have site_id set, but if the operator
-- somehow re-runs while a partial state exists, PK collisions on the
-- freshly generated UUIDs (astronomically unlikely) fail quietly.
INSERT INTO clients (id, user_id, name, phone, status)
SELECT
  p.new_client_id,
  p.user_id,
  COALESCE(p.resolved_client_name, 'Draft — ' || TO_CHAR(p.saved_at, 'YYYY-MM-DD')),
  p.resolved_phone,
  CASE WHEN p.resolved_client_name IS NULL THEN 'needs_visit' ELSE 'active' END
FROM backfill_plan p
ON CONFLICT (id) DO NOTHING;

-- Step 2 — Insert one sites row per plan entry.
INSERT INTO sites (id, user_id, client_id, address)
SELECT
  p.new_site_id,
  p.user_id,
  p.new_client_id,
  p.resolved_address
FROM backfill_plan p
ON CONFLICT (id) DO NOTHING;

-- Step 3 — Attach each job to its new site.
UPDATE jobs SET site_id = p.new_site_id
FROM backfill_plan p
WHERE jobs.id = p.job_id;

-- Verification: emit the four counts operator eyeballs. The moat is
-- verified separately by the operator against the pre-run count
-- (SELECT COUNT(*) FROM the moat table) — this SQL deliberately does
-- not read the moat table so its write surface stays byte-clean.
SELECT
  (SELECT COUNT(*) FROM clients)                        AS clients_total,
  (SELECT COUNT(*) FROM sites)                          AS sites_total,
  (SELECT COUNT(*) FROM jobs WHERE site_id IS NOT NULL) AS jobs_with_site,
  (SELECT COUNT(*) FROM backfill_plan)                  AS backfilled_this_run;

COMMIT;
