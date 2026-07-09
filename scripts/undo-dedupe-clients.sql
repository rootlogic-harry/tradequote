-- Undo the most recent clients dedupe run.
--
-- Best-effort reversal of scripts/dedupe-clients.sql. Un-tombstones
-- every loser client whose row exists in the LATEST run of
-- clients_dedupe_history (most recent run_at). Sites that were
-- reparented STAY on the winner — this script does NOT move them
-- back, because the winner may already have new sites the operator
-- has added post-merge that would collide.
--
-- If the operator needs a full restore (sites move back to their
-- original clients), the correct path is a PG dump replay from R2 per
-- docs/BACKUP.md, not this script.
--
-- Idempotent — running twice against the same latest run is a no-op
-- because the second pass finds no clients where deleted_at IS NOT
-- NULL that match the tombstone timestamps.
--
-- Moat safety: never reads or writes quote_diffs, agent_runs, or
-- calibration_notes.

BEGIN;

-- Guard: this script only runs if history exists.
DO $$
DECLARE
  latest_run TIMESTAMPTZ;
BEGIN
  SELECT MAX(run_at) INTO latest_run FROM clients_dedupe_history;
  IF latest_run IS NULL THEN
    RAISE EXCEPTION 'clients_dedupe_history is empty — nothing to undo';
  END IF;
END $$;

-- Un-tombstone every loser from the most recent run.
UPDATE clients
   SET deleted_at = NULL,
       updated_at = NOW()
 WHERE id IN (
   SELECT loser_client_id
     FROM clients_dedupe_history
    WHERE run_at = (SELECT MAX(run_at) FROM clients_dedupe_history)
 );

-- Verification.
SELECT
  (SELECT COUNT(*) FROM clients WHERE deleted_at IS NULL)
    AS active_clients_after_undo,
  (SELECT COUNT(*) FROM clients WHERE deleted_at IS NOT NULL)
    AS soft_deleted_clients_after_undo,
  (SELECT run_at FROM clients_dedupe_history ORDER BY run_at DESC LIMIT 1)
    AS run_undone_at,
  (SELECT COUNT(*)
     FROM clients_dedupe_history
    WHERE run_at = (SELECT MAX(run_at) FROM clients_dedupe_history))
    AS clients_untombstoned;

COMMIT;
