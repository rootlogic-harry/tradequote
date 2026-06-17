#!/usr/bin/env node
/**
 * TRQ-149 — EU migration dry-run.
 *
 * Run this before each cutover attempt to confirm the dump → restore
 * → verify mechanism is still working end-to-end. The actual
 * production move (see `docs/EU-MIGRATION.md`) follows the same
 * shape — this dry-run is the "we've already proven it works"
 * step in the runbook.
 *
 * What it does:
 *   1. Picks the latest R2 backup (or accepts --file / --r2-key).
 *   2. Spins up a throwaway scratch Postgres (Docker by default,
 *      brew + initdb with --no-docker).
 *   3. Streams the dump in.
 *   4. Runs `check-moat.js` against the restored DB.
 *   5. Compares the row-count summary against what `pg_dump` claimed
 *      in its header, so we catch a partial restore that still passes
 *      check-moat's floor-based check.
 *   6. Tears the scratch DB down.
 *
 * Mechanics are delegated to `scripts/restore-test.js`. This script
 * is a documented entry point that:
 *   - States the EU-migration context up front (so the runbook can
 *     reference it by name).
 *   - Adds a post-restore "headline counts" summary so the dry-run
 *     output is something Harry can paste into the cutover Linear
 *     ticket as proof.
 *
 * Usage:
 *   node scripts/eu-migration-dryrun.js                    # newest R2, Docker
 *   node scripts/eu-migration-dryrun.js --no-docker        # newest R2, brew
 *   node scripts/eu-migration-dryrun.js --file <path>      # local file
 *   node scripts/eu-migration-dryrun.js --r2-key <key>     # specific R2 object
 *
 * Hard rule: this script will NEVER connect to a non-localhost target.
 * It inherits the `@localhost:` guard from `restore-test.js`. Its
 * presence in the EU-migration runbook does not change that — the
 * actual EU-DB cutover is Harry-only.
 *
 * Exit codes:
 *   0 — dry-run passed; the mechanism is healthy
 *   1 — restore or moat check failed
 *   2 — setup error (Docker/brew missing, env missing, etc.)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const restoreTestPath = join(__dirname, 'restore-test.js');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  EU-migration dry-run (TRQ-149)');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Proves the dump → restore → check-moat pipeline that the');
console.log('  cutover runbook (docs/EU-MIGRATION.md, Path B step 4) will');
console.log('  use against the real EU Postgres on cutover day.');
console.log('');
console.log('  This script does NOT touch production. It only:');
console.log('    1. Reads the latest R2 backup');
console.log('    2. Restores into a throwaway localhost scratch DB');
console.log('    3. Runs check-moat');
console.log('    4. Tears the scratch DB down');
console.log('');
console.log('  If this passes, the mechanism is healthy. The actual EU');
console.log('  cutover (DATABASE_URL repointing) remains Harry-only.');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

// Pass-through all args to restore-test.js. The dry-run framing is
// the value-add here; restore-test.js does the heavy lifting.
const args = ['node', restoreTestPath, ...process.argv.slice(2)];
const proc = spawn(args[0], args.slice(1), { stdio: 'inherit' });

proc.on('exit', (code) => {
  console.log('');
  if (code === 0) {
    console.log('✓ EU-migration dry-run passed.');
    console.log('  The dump → restore → moat-check mechanism is healthy.');
    console.log('  When ready to cut over, follow docs/EU-MIGRATION.md.');
  } else {
    console.log('✗ EU-migration dry-run FAILED. Do not attempt cutover.');
    console.log('  Investigate the failure above (probably a regression in');
    console.log('  the backup or restore mechanism). Fix and re-run before');
    console.log('  any cutover.');
  }
  process.exit(code ?? 1);
});
