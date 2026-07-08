/**
 * Clients dedupe script contract — source-level guard.
 *
 * scripts/dedupe-clients.sql (2026-07-08) is a one-shot follow-up to
 * the PR #2 backfill that collapses duplicate-name clients into one
 * per (user_id, lower(trim(name))). Same semantics as the interactive
 * merge route (server.js POST /clients/:id/merge).
 *
 * This suite pins the invariants the operator relies on before
 * pointing the script at production:
 *   - transactional (BEGIN/COMMIT)
 *   - never DROPs anything
 *   - never touches the moat tables
 *   - soft-delete only (tombstone pattern — no hard DELETE)
 *   - filters out backfill placeholders ("Draft — YYYY-MM-DD")
 *   - idempotent (deleted_at IS NULL filter)
 *   - writes a persistent history table for the undo path
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const dedupePath = join(repoRoot, 'scripts/dedupe-clients.sql');
const undoPath = join(repoRoot, 'scripts/undo-dedupe-clients.sql');

const dedupeSrc = existsSync(dedupePath) ? readFileSync(dedupePath, 'utf8') : '';
const undoSrc = existsSync(undoPath) ? readFileSync(undoPath, 'utf8') : '';

/**
 * Strip SQL comments so contract checks that scan for banned strings
 * don't false-positive on documentation. Handles `--` line comments
 * and `/* … *\/` block comments.
 */
function stripSqlComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
}

const dedupeCode = stripSqlComments(dedupeSrc);
const undoCode = stripSqlComments(undoSrc);

describe('dedupe scripts — exist at the canonical paths', () => {
  test('scripts/dedupe-clients.sql exists', () => {
    expect(existsSync(dedupePath)).toBe(true);
  });

  test('scripts/undo-dedupe-clients.sql exists (best-effort undo)', () => {
    expect(existsSync(undoPath)).toBe(true);
  });
});

describe('dedupe script — transactional + safe', () => {
  test('wraps every write in BEGIN/COMMIT', () => {
    expect(dedupeSrc).toMatch(/^BEGIN;/m);
    expect(dedupeSrc).toMatch(/^COMMIT;/m);
  });

  test('NEVER runs DROP against a persistent table/index/schema', () => {
    // The one legal use of the word "DROP" is `ON COMMIT DROP` on the
    // TEMP table. Any `DROP TABLE`, `DROP INDEX`, `DROP DATABASE`,
    // `DROP FUNCTION` etc. against a persistent object is a red flag.
    expect(dedupeCode).not.toMatch(/DROP\s+(?:TABLE|INDEX|DATABASE|SCHEMA|FUNCTION|VIEW|SEQUENCE|TYPE)\b/i);
  });

  test('NEVER hard-DELETEs any client (soft-delete via deleted_at only)', () => {
    // The dedupe route pattern is "UPDATE clients SET deleted_at = NOW()"
    // — the same tombstone the interactive merge route uses.
    expect(dedupeSrc).not.toMatch(/DELETE\s+FROM\s+clients/i);
    expect(dedupeSrc).toMatch(/UPDATE\s+clients[\s\S]*?SET\s+deleted_at\s*=\s*NOW\(\)/i);
  });

  test('NEVER touches the moat learning tables', () => {
    // Any query mentioning these tables would be a schema-integrity red
    // flag — the dedupe operates on clients + sites only. Header
    // comments naming the tables (for the "moat safety" callout) are
    // fine; we scan comment-stripped source.
    expect(dedupeCode).not.toMatch(/\bquote_diffs\b/);
    expect(dedupeCode).not.toMatch(/\bagent_runs\b/);
    expect(dedupeCode).not.toMatch(/\bcalibration_notes\b/);
  });
});

describe('dedupe script — semantics', () => {
  test('groups by (user_id, lower(trim(name))) — case- and whitespace-insensitive', () => {
    expect(dedupeSrc).toMatch(/lower\(\s*trim\(\s*c\.name\s*\)\s*\)/i);
    expect(dedupeSrc).toMatch(/PARTITION BY\s+c\.user_id/i);
  });

  test('picks the earliest-created client per group as WINNER (deterministic tie-break)', () => {
    // Deterministic winner selection so re-runs pick the same target.
    expect(dedupeSrc).toMatch(/ROW_NUMBER\(\)\s+OVER/i);
    expect(dedupeSrc).toMatch(/ORDER BY[\s\S]{0,80}?created_at\s+ASC/i);
    // Tie-break by id lex-min.
    expect(dedupeSrc).toMatch(/created_at\s+ASC,\s*c\.id\s+ASC/i);
  });

  test('excludes backfill placeholders (Draft — YYYY-MM-DD)', () => {
    // Two placeholders with the same date string could accidentally
    // collapse data from unrelated jobs.
    expect(dedupeSrc).toMatch(/NOT LIKE\s+['"]Draft — %['"]/);
  });

  test('excludes null / blank names', () => {
    expect(dedupeSrc).toMatch(/c\.name\s+IS NOT NULL/i);
    expect(dedupeSrc).toMatch(/trim\(c\.name\)\s*<>\s*['"]{2}/);
  });

  test('only touches non-deleted clients (idempotent across re-runs)', () => {
    expect(dedupeSrc).toMatch(/c\.deleted_at\s+IS NULL/i);
  });

  test('reparents non-deleted sites from loser to winner', () => {
    // Never reparent a soft-deleted site — the tombstone is meaningful.
    expect(dedupeSrc).toMatch(
      /UPDATE\s+sites[\s\S]*?SET\s+client_id\s*=\s*p\.winner_id[\s\S]*?deleted_at\s+IS NULL/i,
    );
  });

  test('COALESCEs winner contact fields from losers (never overwrites)', () => {
    // Same "never overwrite user-entered data" guarantee as the
    // interactive merge route.
    expect(dedupeSrc).toMatch(/COALESCE\(c\.phone,\s*agg\.phone\)/);
    expect(dedupeSrc).toMatch(/COALESCE\(c\.email,\s*agg\.email\)/);
    expect(dedupeSrc).toMatch(/COALESCE\(c\.notes,\s*agg\.notes\)/);
  });
});

describe('dedupe script — history + undo', () => {
  test('creates the persistent clients_dedupe_history table', () => {
    // Persistent (not TEMP) so a later undo can consult it.
    expect(dedupeSrc).toMatch(/CREATE TABLE IF NOT EXISTS clients_dedupe_history/i);
    // NOT declared TEMP.
    const historyDecl = dedupeSrc.match(
      /CREATE TABLE IF NOT EXISTS clients_dedupe_history[\s\S]*?\);/,
    );
    expect(historyDecl).not.toBeNull();
    expect(historyDecl[0]).not.toMatch(/\bTEMP\b/i);
  });

  test('captures pre-reparent site membership per loser', () => {
    // Undo relies on this to know which sites belonged where. The
    // INSERT runs BEFORE the sites UPDATE.
    expect(dedupeSrc).toMatch(
      /INSERT INTO clients_dedupe_history[\s\S]*?site_ids_reparented/i,
    );
    const insertIdx = dedupeSrc.search(/INSERT INTO clients_dedupe_history/i);
    const reparentIdx = dedupeSrc.search(/UPDATE\s+sites[\s\S]*?client_id\s*=\s*p\.winner_id/i);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(reparentIdx).toBeGreaterThan(insertIdx);
  });
});

describe('undo script — safety + shape', () => {
  test('wraps in BEGIN/COMMIT', () => {
    expect(undoSrc).toMatch(/^BEGIN;/m);
    expect(undoSrc).toMatch(/^COMMIT;/m);
  });

  test('reads from clients_dedupe_history (the persistent trail)', () => {
    expect(undoSrc).toMatch(/FROM\s+clients_dedupe_history/i);
  });

  test('un-tombstones losers by setting deleted_at = NULL', () => {
    expect(undoSrc).toMatch(
      /UPDATE\s+clients[\s\S]*?SET\s+deleted_at\s*=\s*NULL/i,
    );
  });

  test('scoped to the LATEST run only (idempotent)', () => {
    // Running twice against the same run must be a no-op. Scoping to
    // MAX(run_at) gives that guarantee.
    expect(undoSrc).toMatch(/MAX\(run_at\)/i);
  });

  test('errors out if there is no history to undo', () => {
    expect(undoSrc).toMatch(/RAISE EXCEPTION[\s\S]*?nothing to undo/i);
  });

  test('never touches sites (undo is best-effort — see the header)', () => {
    // Sites stay on the winner. The undo comment must call this out.
    // If a future edit adds a sites UPDATE, this test flags it so the
    // header comment can be updated to match.
    expect(undoSrc).not.toMatch(/UPDATE\s+sites/i);
  });

  test('NEVER touches the moat learning tables', () => {
    // Comment-stripped so the header's "moat safety" callout doesn't
    // count.
    expect(undoCode).not.toMatch(/\bquote_diffs\b/);
    expect(undoCode).not.toMatch(/\bagent_runs\b/);
    expect(undoCode).not.toMatch(/\bcalibration_notes\b/);
  });
});
