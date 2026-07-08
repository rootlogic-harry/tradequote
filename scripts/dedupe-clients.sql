-- Clients dedupe (2026-07-08, follow-up to PR #2's backfill).
--
-- The initial backfill (scripts/backfill-clients.sql, 2026-07-07)
-- created one clients row per historical job — no dedupe by design
-- ("Paul consolidates via the merge banner"). Mark's UAT surfaced the
-- resulting UX problem: "Artemis is classed as multiple clients one
-- for each quote". Merging N groups of duplicates one banner-review at
-- a time was going to be tedious for every existing user.
--
-- This script performs the batch dedupe server-side. Same semantics as
-- the interactive merge route (server.js POST /clients/:id/merge):
--   1. Group clients by (user_id, lower(trim(name))).
--   2. Pick the earliest-created row per group as the WINNER (ties
--      broken by id lex-min for determinism across re-runs).
--   3. Reparent every non-deleted site from each loser to its winner.
--   4. COALESCE the winner's null phone/email/notes from losers
--      (never overwrite user-entered data on the winner).
--   5. Soft-delete every loser (deleted_at = NOW()). Same tombstone
--      pattern as the interactive merge — never a hard DELETE.
--
-- Placeholders ("Draft — YYYY-MM-DD" clients from the backfill) are
-- deliberately EXCLUDED. Merging two placeholders with the same date
-- string would fold data from unrelated jobs into one client. They
-- stay separate until an operator renames them.
--
-- Idempotent — filter is `deleted_at IS NULL`, so a soft-deleted row
-- never re-appears in a subsequent run.
--
-- Moat safety: never reads or writes quote_diffs, agent_runs, or
-- calibration_notes.
--
-- Rollback: scripts/undo-dedupe-clients.sql un-tombstones the losers
-- from the most recent run. Sites already reparented STAY on the
-- winner (the undo is best-effort — full restore is a PG dump replay
-- from R2 per docs/BACKUP.md).

BEGIN;

-- History table so this run's decisions are inspectable after commit
-- (and by the undo script). NOT a temp table — persists across
-- transactions so a later undo can find the tombstones to reverse.
CREATE TABLE IF NOT EXISTS clients_dedupe_history (
  id                  SERIAL PRIMARY KEY,
  run_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id             TEXT NOT NULL,
  loser_client_id     TEXT NOT NULL,
  winner_client_id    TEXT NOT NULL,
  site_ids_reparented TEXT[]
);
CREATE INDEX IF NOT EXISTS clients_dedupe_history_run_idx
  ON clients_dedupe_history (run_at DESC);

-- Materialise the dedupe plan. `dedupe_plan` holds one row per LOSER;
-- each row also carries the winner_id + the loser's contact fields so
-- the follow-up UPDATE can COALESCE without re-scanning `clients`.
CREATE TEMP TABLE dedupe_plan ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    c.id,
    c.user_id,
    c.name,
    c.phone,
    c.email,
    c.notes,
    c.status,
    c.created_at,
    lower(trim(c.name)) AS name_key,
    -- Winner: earliest created_at per (user_id, name_key). Tie-break
    -- by id lex-min so the choice is deterministic across re-runs.
    ROW_NUMBER() OVER (
      PARTITION BY c.user_id, lower(trim(c.name))
      ORDER BY c.created_at ASC, c.id ASC
    ) AS rn,
    COUNT(*) OVER (
      PARTITION BY c.user_id, lower(trim(c.name))
    ) AS group_size
  FROM clients c
  WHERE c.deleted_at IS NULL
    AND c.name IS NOT NULL
    AND trim(c.name) <> ''
    -- Backfill placeholders live as `Draft — YYYY-MM-DD`. Two
    -- placeholders sharing the same date string would collapse data
    -- from unrelated jobs — safer to leave placeholders alone until
    -- an operator renames them.
    AND c.name NOT LIKE 'Draft — %'
),
groups AS (
  SELECT * FROM ranked WHERE group_size >= 2
)
SELECT
  loser.id       AS loser_id,
  loser.user_id  AS user_id,
  loser.phone    AS loser_phone,
  loser.email    AS loser_email,
  loser.notes    AS loser_notes,
  winner.id      AS winner_id
FROM groups AS loser
JOIN groups AS winner
  ON winner.user_id = loser.user_id
 AND winner.name_key = loser.name_key
 AND winner.rn = 1
WHERE loser.rn > 1;

-- Capture the pre-reparent site membership per loser so undo can be
-- run later against the persistent history table.
INSERT INTO clients_dedupe_history
  (user_id, loser_client_id, winner_client_id, site_ids_reparented)
SELECT
  p.user_id,
  p.loser_id,
  p.winner_id,
  ARRAY(
    SELECT s.id
      FROM sites s
     WHERE s.client_id = p.loser_id
       AND s.deleted_at IS NULL
  )
FROM dedupe_plan p;

-- Step 1 — Reparent every non-deleted site from loser to winner.
UPDATE sites
   SET client_id = p.winner_id,
       updated_at = NOW()
  FROM dedupe_plan p
 WHERE sites.client_id = p.loser_id
   AND sites.deleted_at IS NULL;

-- Step 2 — COALESCE the winner's null phone/email/notes from losers.
-- MIN(...) FILTER (WHERE ... IS NOT NULL) picks the lex-smallest non-
-- null value across all losers in the group — deterministic across
-- re-runs and avoids overwriting user-entered values on the winner
-- (COALESCE keeps the winner's existing non-null values).
UPDATE clients c
   SET phone = COALESCE(c.phone, agg.phone),
       email = COALESCE(c.email, agg.email),
       notes = COALESCE(c.notes, agg.notes),
       updated_at = NOW()
  FROM (
    SELECT
      p.winner_id,
      MIN(p.loser_phone) FILTER (WHERE p.loser_phone IS NOT NULL) AS phone,
      MIN(p.loser_email) FILTER (WHERE p.loser_email IS NOT NULL) AS email,
      MIN(p.loser_notes) FILTER (WHERE p.loser_notes IS NOT NULL) AS notes
    FROM dedupe_plan p
    GROUP BY p.winner_id
  ) AS agg
 WHERE c.id = agg.winner_id;

-- Step 3 — Soft-delete every loser. Same tombstone pattern as the
-- interactive merge route (server.js) — NEVER a hard DELETE.
UPDATE clients
   SET deleted_at = NOW(),
       updated_at = NOW()
  FROM dedupe_plan p
 WHERE clients.id = p.loser_id
   AND clients.deleted_at IS NULL;

-- Verification — counts the operator eyeballs.
SELECT
  (SELECT COUNT(*) FROM clients WHERE deleted_at IS NULL)                   AS active_clients_after,
  (SELECT COUNT(*) FROM clients WHERE deleted_at IS NOT NULL)               AS soft_deleted_clients_after,
  (SELECT COUNT(*) FROM sites WHERE deleted_at IS NULL)                     AS active_sites_after,
  (SELECT COUNT(*) FROM jobs WHERE site_id IS NOT NULL)                     AS jobs_with_site_after,
  (SELECT COUNT(*) FROM dedupe_plan)                                        AS merges_this_run,
  (SELECT COUNT(DISTINCT winner_id) FROM dedupe_plan)                       AS winners_this_run;

COMMIT;
