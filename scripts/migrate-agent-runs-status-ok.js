#!/usr/bin/env node
/**
 * TRQ-140 — one-shot migration converting legacy `agent_runs.status='ok'`
 * rows to the canonical `'completed'` value.
 *
 * Why this is needed: the `/api/users/:id/analyse` success path used to
 * write 'ok'. Every other writer used 'completed'. Filters keyed on
 * 'completed' (the calibration agent's reads + the auto-calibration
 * trigger) silently excluded the analyse rows — i.e. the bulk of
 * Anthropic spend. The code fix (server.js) makes all NEW rows write
 * 'completed'; this script retrofits the EXISTING rows so the
 * calibration / analytics queries start seeing them too.
 *
 * Safety properties:
 *   - Dry-run by default: prints the row count it WOULD touch, then exits.
 *     Add `--apply` to actually run the UPDATE.
 *   - Idempotent: running --apply twice is a no-op on the second run.
 *   - Scoped: only touches rows where status='ok' AND agent_type='analyse'
 *     (the only writer that ever used 'ok'). Won't accidentally relabel
 *     anything else.
 *   - Hard 10s statement timeout — cannot run away on a giant table.
 *   - Transaction-wrapped — partial success is impossible.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate-agent-runs-status-ok.js              # dry-run
 *   DATABASE_URL=postgres://... node scripts/migrate-agent-runs-status-ok.js --apply     # write
 *
 * Before running --apply:
 *   1. Confirm a fresh backup exists (TRQ-147 / TRQ-148).
 *   2. Run the moat check first to capture pre-migration counts:
 *        DATABASE_URL=... node scripts/check-moat.js
 *   3. Then run THIS with --apply.
 *   4. Run check-moat again to confirm row counts are unchanged.
 *
 * Per the agent constitution: this is the kind of UPDATE that is
 * usually a hard prohibition, so it carries an explicit WHERE clause
 * AND a dry-run-by-default safeguard. The script will refuse to run
 * UPDATEs without --apply, regardless of how it was invoked.
 */
import pg from 'pg';

const APPLY_FLAG = '--apply';

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (!process.env.DATABASE_URL) {
    console.error('migrate-agent-runs-status-ok: DATABASE_URL is not set.');
    process.exit(2);
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    ssl: process.env.DATABASE_URL.includes('railway')
      ? { rejectUnauthorized: false }
      : false,
  });

  const client = await pool.connect();
  try {
    // 1) Always count first. If zero, we're done.
    const countRes = await client.query(
      `SELECT COUNT(*)::bigint AS legacy_count
       FROM agent_runs
       WHERE status = 'ok' AND agent_type = 'analyse'`
    );
    const legacyCount = Number(countRes.rows[0].legacy_count);

    if (legacyCount === 0) {
      console.log('No legacy agent_runs.status=\'ok\' rows found. Nothing to do.');
      console.log('(This is the expected steady-state after the first --apply run.)');
      return 0;
    }

    console.log(`Found ${legacyCount.toLocaleString()} legacy agent_runs rows with status='ok' AND agent_type='analyse'.`);

    if (!apply) {
      console.log('');
      console.log('Dry-run only. To actually convert these to status=\'completed\', re-run with --apply.');
      console.log('Before --apply: confirm a fresh backup exists and check-moat.js passes.');
      return 0;
    }

    // 2) Write the migration in a transaction. Constrained WHERE so even
    //    if the table grew unexpectedly we can't relabel rows we didn't
    //    mean to touch.
    console.log('Applying migration...');
    await client.query('BEGIN');
    try {
      const updateRes = await client.query(
        `UPDATE agent_runs
         SET status = 'completed'
         WHERE status = 'ok' AND agent_type = 'analyse'`
      );
      // Sanity check: the UPDATE row count must exactly match the
      // pre-flight SELECT count. If it doesn't, something is racing —
      // roll back and let the operator decide.
      if (updateRes.rowCount !== legacyCount) {
        throw new Error(
          `Row-count mismatch: SELECT counted ${legacyCount}, UPDATE touched ${updateRes.rowCount}. Aborting (no changes committed).`
        );
      }
      await client.query('COMMIT');
      console.log(`Migration complete: ${updateRes.rowCount.toLocaleString()} rows updated.`);
      console.log('Next: run scripts/check-moat.js to confirm row counts are unchanged.');
      return 0;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    console.error('migrate-agent-runs-status-ok: failed —', err.message);
    process.exit(1);
  });
