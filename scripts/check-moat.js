#!/usr/bin/env node
/**
 * TRQ-146 — Moat-integrity tripwire.
 *
 * Asserts the three irreplaceable learning tables exist and look plausible.
 * If any of these regress, the autonomous run that caused it should fail
 * loudly rather than continue and silently degrade the moat.
 *
 * The three tables hold:
 *   - quote_diffs       — every AI suggestion vs confirmed value
 *   - calibration_notes — approved system-prompt adjustments
 *   - agent_runs        — every agentic AI loop execution
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/check-moat.js
 *   DATABASE_URL=postgres://... node scripts/check-moat.js --json
 *
 * Exit codes:
 *   0 — every check passed
 *   1 — at least one check failed (table missing / row count below floor)
 *   2 — configuration error (no DATABASE_URL, connection refused, etc.)
 *
 * Designed to be CHEAP — a handful of COUNT queries with a hard 5s
 * timeout. Safe to run as a smoke check after any DB-touching ticket
 * or post-deploy.
 */
import pg from 'pg';

// Floors are deliberately generous. They don't try to predict growth —
// they catch the catastrophic case (table gone, table truncated to
// empty, or schema drifted away). The post-launch shape will easily
// clear these.
//
// `floor: 0` means "exists, can be empty" — used for tables that are
// allowed to be empty in a fresh DB (e.g. an EU-restore scratch box).
// Other floors apply to production-shape databases. Both modes are
// surfaced by the CLI flag below.
const CHECKS = [
  { table: 'quote_diffs',       prodFloor: 100, freshFloor: 0,
    why: 'Per-field AI vs confirmed-value diffs — the core learning signal.' },
  { table: 'calibration_notes', prodFloor: 1,   freshFloor: 0,
    why: 'Approved system-prompt adjustments. Always seeded with the hardcoded migration row.' },
  { table: 'agent_runs',        prodFloor: 100, freshFloor: 0,
    why: 'Every analyse/self-critique/feedback/calibration execution. Drives spend + reliability dashboards.' },
];

function parseArgs(argv) {
  const out = { json: false, fresh: false };
  for (const a of argv.slice(2)) {
    if (a === '--json') out.json = true;
    else if (a === '--fresh') out.fresh = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/check-moat.js [--json] [--fresh]');
      console.log('  --json    Emit machine-readable JSON (one object) instead of human output.');
      console.log('  --fresh   Treat zero-row tables as OK (use for restore-test scratch DBs).');
      process.exit(0);
    }
  }
  return out;
}

async function tableExists(client, name) {
  // information_schema is the portable way to ask Postgres "does this
  // table exist". Faster than `SELECT 1 FROM <table> LIMIT 0` which
  // would throw and force exception handling.
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return r.rowCount > 0;
}

async function rowCount(client, name) {
  // Cheap exact count on these tables. They're not huge — quote_diffs
  // is the biggest and still in the tens of thousands at most. If we
  // ever cross a million rows we'll switch to reltuples sampling.
  const r = await client.query(`SELECT COUNT(*)::bigint AS c FROM ${name}`);
  return Number(r.rows[0].c);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) {
    console.error('check-moat: DATABASE_URL is not set.');
    process.exit(2);
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Hard timeout — this script should never hang a deploy.
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    ssl: process.env.DATABASE_URL.includes('railway')
      ? { rejectUnauthorized: false } : false,
  });

  const results = [];
  let client;
  try {
    client = await pool.connect();
    for (const check of CHECKS) {
      const exists = await tableExists(client, check.table);
      if (!exists) {
        results.push({
          table: check.table, status: 'fail',
          reason: 'table missing from public schema',
          count: null, floor: args.fresh ? check.freshFloor : check.prodFloor,
        });
        continue;
      }
      const count = await rowCount(client, check.table);
      const floor = args.fresh ? check.freshFloor : check.prodFloor;
      const passed = count >= floor;
      results.push({
        table: check.table, status: passed ? 'pass' : 'fail',
        reason: passed ? null : `row count ${count} below floor ${floor}`,
        count, floor,
      });
    }

  } catch (err) {
    console.error('check-moat: query failed —', err.message);
    process.exit(2);
  } finally {
    if (client) client.release();
    await pool.end();
  }

  // Billing integrity audit (2026-06-25, post Pitfall #17 fix in CLAUDE.md).
  // Canary for the bug class: any user with subscription_status='active'
  // but no stripe_subscription_id is a victim of (or symptom of) a webhook
  // misroute that wrongly promotes payment-mode (quote pack) purchases
  // to a subscriber state. Should always return 0 rows post-fix.
  // Tracked here so a moat-integrity run doubles as a billing-integrity run.
  const billingAudit = await (async () => {
    if (!client) return { status: 'skipped', orphans: 0, reason: 'no DB client' };
    try {
      const { rows } = await pool.query(
        `SELECT id FROM users
          WHERE subscription_status = 'active'
            AND stripe_subscription_id IS NULL`
      );
      const orphans = rows.length;
      return {
        status: orphans === 0 ? 'pass' : 'fail',
        orphans,
        sampleIds: rows.slice(0, 5).map((r) => r.id),
      };
    } catch (err) {
      return { status: 'error', orphans: null, reason: err.message };
    }
  })();

  const allPassed = results.every((r) => r.status === 'pass')
    && billingAudit.status === 'pass';

  if (args.json) {
    console.log(JSON.stringify({
      ok: allPassed,
      mode: args.fresh ? 'fresh' : 'prod',
      results,
      billingIntegrity: billingAudit,
    }, null, 2));
  } else {
    const mode = args.fresh ? 'fresh DB' : 'production DB';
    console.log(`check-moat (${mode})`);
    console.log('─'.repeat(60));
    for (const r of results) {
      const stamp = r.status === 'pass' ? '✓' : '✗';
      const tail = r.count !== null ? `${r.count.toLocaleString()} rows (floor ${r.floor})` : r.reason;
      console.log(`  ${stamp} ${r.table.padEnd(20)} ${tail}`);
      if (r.status === 'fail') {
        const why = CHECKS.find((c) => c.table === r.table)?.why;
        if (why) console.log(`    why it matters: ${why}`);
        if (r.reason && r.count !== null) console.log(`    detail: ${r.reason}`);
      }
    }
    // Billing integrity — different shape (must be exactly 0 orphans).
    const billingStamp = billingAudit.status === 'pass' ? '✓' : '✗';
    const billingLabel = 'billing_integrity'.padEnd(20);
    if (billingAudit.status === 'pass') {
      console.log(`  ${billingStamp} ${billingLabel}0 orphan subscriptions (must be 0)`);
    } else if (billingAudit.status === 'fail') {
      console.log(`  ${billingStamp} ${billingLabel}${billingAudit.orphans} orphan(s): users with subscription_status='active' but NO stripe_subscription_id`);
      console.log(`    why it matters: see CLAUDE.md Pitfall #17 — quote-pack purchases wrongly promoting to subscribed`);
      if (billingAudit.sampleIds?.length) {
        console.log(`    sample ids: ${billingAudit.sampleIds.join(', ')}`);
      }
    } else {
      console.log(`  ${billingStamp} ${billingLabel}audit error: ${billingAudit.reason}`);
    }
    console.log('─'.repeat(60));
    console.log(allPassed ? 'All moat + billing checks passed.' : 'MOAT INTEGRITY FAILED. See above.');
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('check-moat: unexpected error —', err.message);
  process.exit(2);
});
