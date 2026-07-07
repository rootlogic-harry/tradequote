/**
 * Backfill script contract — source-level guard.
 *
 * The backfill (scripts/backfill-clients.sql, shipped with PR #2)
 * MUST honour these invariants. Test file exists first so the script
 * can be reviewed against a locked contract before it ever runs on
 * production data.
 *
 * See docs/CLIENTS_SPEC_v3.md § 5 for the placeholder-on-save rule
 * (same logic applies to the backfill's dedupe choice) and
 * docs/CLIENTS_ROLLBACK.md for the accompanying undo script.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const backfillPath = join(repoRoot, 'scripts/backfill-clients.sql');
const undoPath = join(repoRoot, 'scripts/undo-clients-backfill.sql');

describe('backfill script — exists at the canonical path', () => {
  test('scripts/backfill-clients.sql exists', () => {
    expect(existsSync(backfillPath)).toBe(true);
  });

  test('scripts/undo-clients-backfill.sql exists (revert lever 3)', () => {
    expect(existsSync(undoPath)).toBe(true);
  });
});

describe('backfill script — transactional + safe', () => {
  const backfillSrc = existsSync(backfillPath) ? readFileSync(backfillPath, 'utf8') : '';

  test('wraps every insert in BEGIN/COMMIT', () => {
    expect(backfillSrc).toMatch(/BEGIN/);
    expect(backfillSrc).toMatch(/COMMIT/);
  });

  test('is idempotent — checks for existing Client + Site before inserting', () => {
    // Two acceptable idempotency patterns: WHERE NOT EXISTS (subquery)
    // OR ON CONFLICT DO NOTHING. Either works because we accept
    // multiple runs producing the same result.
    expect(backfillSrc).toMatch(/(WHERE NOT EXISTS|ON CONFLICT DO NOTHING)/);
  });

  test('inserts ONE client + ONE site per existing job with jobDetails.clientName', () => {
    // No dedupe attempted at backfill (spec § 0). Every eligible job
    // gets its own client + site — Paul consolidates via the merge
    // banner afterwards.
    expect(backfillSrc).toMatch(/INSERT INTO clients/);
    expect(backfillSrc).toMatch(/INSERT INTO sites/);
  });

  test('sets jobs.site_id after inserting Site (attach step)', () => {
    expect(backfillSrc).toMatch(/UPDATE jobs\s+SET site_id/);
  });

  test('reads client_name from denormalised column OR from quote_snapshot jobDetails', () => {
    // The backfill needs to look at whichever field is populated —
    // legacy jobs stored client_name inline on the row, newer ones
    // put it inside jobDetails only. Match either access pattern.
    expect(backfillSrc).toMatch(/(client_name|quote_snapshot['-]>['"]jobDetails|jobDetails['"]-?>['"]clientName)/i);
  });

  test('never inserts into quote_diffs (moat, absolutely untouched)', () => {
    expect(backfillSrc).not.toMatch(/quote_diffs/);
  });

  test('never DROPs, RENAMEs, or DELETEs anything (additive only)', () => {
    expect(backfillSrc).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(backfillSrc).not.toMatch(/RENAME/i);
    expect(backfillSrc).not.toMatch(/DELETE\s+FROM/i);
    expect(backfillSrc).not.toMatch(/TRUNCATE/i);
  });

  test('never blanks jobs.quote_snapshot inline copies (they remain HISTORICAL truth)', () => {
    // Historical audit: jobs keep the address they were saved with;
    // the Site row is CURRENT truth. Backfill only READS from
    // quote_snapshot, never writes.
    expect(backfillSrc).not.toMatch(/UPDATE jobs\s+SET quote_snapshot/i);
  });
});

describe('backfill script — placeholder client naming', () => {
  const backfillSrc = existsSync(backfillPath) ? readFileSync(backfillPath, 'utf8') : '';

  test('jobs with blank clientName get a placeholder Client named "Draft — YYYY-MM-DD"', () => {
    // We accept either the exact ISO-shape or a CASE WHEN blank
    // fallback that references the string 'Draft'. Placeholder
    // clients also default to status='needs_visit' so they surface
    // in the client list "needs a name" chip.
    expect(backfillSrc).toMatch(/Draft/);
    expect(backfillSrc).toMatch(/needs_visit/);
  });
});

describe('undo script — surgical + moat-safe', () => {
  const undoSrc = existsSync(undoPath) ? readFileSync(undoPath, 'utf8') : '';

  test('wraps in BEGIN/COMMIT', () => {
    expect(undoSrc).toMatch(/BEGIN/);
    expect(undoSrc).toMatch(/COMMIT/);
  });

  test('sets jobs.site_id = NULL before deleting Sites (FK safety)', () => {
    expect(undoSrc).toMatch(/UPDATE jobs SET site_id = NULL/);
  });

  test('DELETEs sites AND clients — no orphan rows left', () => {
    expect(undoSrc).toMatch(/DELETE FROM sites/);
    expect(undoSrc).toMatch(/DELETE FROM clients/);
  });

  test('quote_diffs, users, jobs (as rows) are UNTOUCHED', () => {
    expect(undoSrc).not.toMatch(/DELETE FROM quote_diffs/);
    expect(undoSrc).not.toMatch(/DELETE FROM users/);
    expect(undoSrc).not.toMatch(/DELETE FROM jobs\b/);
    // The only UPDATE on jobs is the site_id = NULL step above.
    const jobsUpdates = (undoSrc.match(/UPDATE jobs/g) || []).length;
    expect(jobsUpdates).toBe(1);
  });

  test('emits a post-op count query so operators can verify', () => {
    // Belt-and-braces: script prints counts of quote_diffs + users
    // AFTER the delete so we can eyeball that the moat survived.
    expect(undoSrc).toMatch(/COUNT\(\*\)[\s\S]{0,80}quote_diffs/);
    expect(undoSrc).toMatch(/COUNT\(\*\)[\s\S]{0,80}users/);
  });
});
