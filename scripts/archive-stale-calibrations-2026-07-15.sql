-- Archive stale approved calibration notes that the base prompt now
-- supersedes (2026-07-15).
--
-- Context: 5 months of tradesman-correction data (quote_diffs table)
-- showed persistent over/under-estimation on four fields, each with
-- multiple rounds of feedback-agent calibration that failed to
-- converge. Root cause: the calibration mechanism adds contradictory
-- text (e.g. "£380–450" for Chapter 8) alongside the base prompt's
-- correct guidance, and the LLM anchors on the wrong one.
--
-- The base prompt (prompts/systemPrompt.js) is updated in the same PR
-- with direct rate changes:
--   - Chapter 8: MANDATORY per-day line-item shape (was: ambiguous)
--   - Sandstone walling stone: £120–£170/t (was: £170–£200/t)
--   - Labour benchmarks: 7 m²/day dismantle, 3.3 m²/day rebuild-for-2
--     (was: 6 / 3)
--
-- Archiving these notes stops them from being injected into future
-- augmented prompts (the injection query filters `status='approved'`).
-- The rows are preserved so we can inspect the calibration-drift
-- pattern later.
--
-- Idempotent: WHERE status='approved' means a re-run is a no-op.
--
-- Moat safety: never touches quote_diffs, agent_runs — only mutates
-- calibration_notes status.

BEGIN;

-- Archive by row id, captured from a live diagnostic query on
-- 2026-07-15. Explicit ids prevent this script accidentally archiving
-- future notes that happen to match a broader WHERE clause.
UPDATE calibration_notes
   SET status = 'archived'
 WHERE status = 'approved'
   AND id IN (
     -- Chapter 8 — the £380–450 anchor that broke the base prompt
     'e5559158-7390-41ee-ba4f-56d8cf1ab1fe',
     -- Chapter 8 — the follow-up note doubling down on the same range
     'f2d2bb61-94c7-43ff-b1b1-bbff48ca0f9d',
     -- Labour days — the 0.85 reduction factor that never converged
     'e3e20064-b150-4b05-88e3-1506f4b894cb',
     -- Sandstone quantity — 0.96 reduction factor, similar drift
     'ef4adf20-2bf6-402a-9e0b-0d4f9dd62d90',
     -- Sandstone unit_cost — persistent over-estimation
     'b6c57118-e497-477a-9bbb-1c966303f678'
   );

-- Verify: expect 5 rows updated (or 0 on a re-run).
SELECT COUNT(*) AS archived_this_run
  FROM calibration_notes
 WHERE status = 'archived'
   AND id IN (
     'e5559158-7390-41ee-ba4f-56d8cf1ab1fe',
     'f2d2bb61-94c7-43ff-b1b1-bbff48ca0f9d',
     'e3e20064-b150-4b05-88e3-1506f4b894cb',
     'ef4adf20-2bf6-402a-9e0b-0d4f9dd62d90',
     'b6c57118-e497-477a-9bbb-1c966303f678'
   );

-- Moat baseline: quote_diffs must not have moved.
SELECT (SELECT COUNT(*) FROM quote_diffs) AS quote_diffs_after;

COMMIT;
