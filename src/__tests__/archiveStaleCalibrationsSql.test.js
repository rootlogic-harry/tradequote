/**
 * Guard the shape of scripts/archive-stale-calibrations-2026-07-15.sql
 * so a future edit can't quietly widen its blast radius.
 *
 * The archive is a targeted, id-scoped UPDATE. It must not:
 *   - use a broad WHERE (e.g. `status = 'approved'` alone),
 *   - hard-DELETE anything,
 *   - touch quote_diffs / agent_runs / calibration_notes columns other
 *     than `status`.
 *
 * Idempotent — the run against production is a no-op if repeated,
 * because `status='approved'` won't match the already-archived rows.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const scriptPath = join(repoRoot, 'scripts/archive-stale-calibrations-2026-07-15.sql');

const scriptSrc = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '';

function stripSqlComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}
const scriptCode = stripSqlComments(scriptSrc);

describe('archive-stale-calibrations-2026-07-15.sql — exists + safe', () => {
  test('script exists at the canonical path', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  test('wraps every write in BEGIN/COMMIT', () => {
    expect(scriptCode).toMatch(/^BEGIN;/m);
    expect(scriptCode).toMatch(/^COMMIT;/m);
  });

  test('scopes the UPDATE by explicit id list (no bare status=approved)', () => {
    // Widening this to `WHERE status='approved'` alone would archive
    // every approved calibration note in the system.
    const updates = scriptCode.match(/UPDATE\s+calibration_notes[\s\S]*?;/gi) || [];
    expect(updates.length).toBeGreaterThan(0);
    for (const stmt of updates) {
      expect(stmt).toMatch(/AND\s+id\s+IN\s*\(/i);
    }
  });

  test('archives exactly the 5 notes identified in the 2026-07-15 investigation', () => {
    const expectedIds = [
      'e5559158-7390-41ee-ba4f-56d8cf1ab1fe', // Chapter 8 £380–450
      'f2d2bb61-94c7-43ff-b1b1-bbff48ca0f9d', // Chapter 8 follow-up
      'e3e20064-b150-4b05-88e3-1506f4b894cb', // Labour days 0.85 factor
      'ef4adf20-2bf6-402a-9e0b-0d4f9dd62d90', // Sandstone quantity 0.96
      'b6c57118-e497-477a-9bbb-1c966303f678', // Sandstone unit_cost
    ];
    for (const id of expectedIds) {
      expect(scriptCode).toContain(id);
    }
  });

  test('only mutates the status column (nothing else)', () => {
    // Belt-and-braces — if the SET clause ever gains an extra column,
    // this test forces the change to surface in review.
    const setClauses = scriptCode.match(/SET\s+[\s\S]*?WHERE/gi) || [];
    expect(setClauses.length).toBeGreaterThan(0);
    for (const clause of setClauses) {
      const columns = clause
        .replace(/^SET\s+/i, '')
        .replace(/WHERE.*$/i, '')
        .split(',')
        .map((s) => s.trim().split(/\s*=/)[0].trim());
      expect(columns).toEqual(['status']);
    }
  });

  test('sets the archived status literal (not any other value)', () => {
    expect(scriptCode).toMatch(/SET\s+status\s*=\s*'archived'/i);
  });

  test('NEVER hard-DELETEs any calibration_notes row', () => {
    expect(scriptCode).not.toMatch(/DELETE\s+FROM\s+calibration_notes/i);
  });

  test('NEVER runs DROP against a persistent object', () => {
    expect(scriptCode).not.toMatch(/DROP\s+(?:TABLE|INDEX|DATABASE|SCHEMA|FUNCTION|VIEW|SEQUENCE|TYPE)\b/i);
  });

  test('does not write to the moat tables', () => {
    // Reads (SELECT COUNT(*) FROM quote_diffs) for the moat-baseline
    // guard are fine — writes are not.
    expect(scriptCode).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM)\s+quote_diffs/i);
    expect(scriptCode).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM)\s+agent_runs/i);
  });

  test('emits a moat-baseline count for operator verification', () => {
    expect(scriptCode).toMatch(/SELECT[\s\S]*?FROM\s+quote_diffs/i);
  });

  test('idempotent — WHERE status=approved means re-run archives nothing', () => {
    // The intended semantics: the same UPDATE running twice archives
    // 5 rows the first time, 0 the second. Encoded as a source-level
    // assertion because we don't have a live-DB Jest harness here.
    expect(scriptCode).toMatch(/WHERE\s+status\s*=\s*'approved'/i);
  });
});
