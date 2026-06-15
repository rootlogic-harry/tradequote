/**
 * TRQ-148 — guards for the restore-test script + runbook.
 *
 * The restore-test is the sign-off gate that unblocks the EU
 * migration. Its mechanical promises matter:
 *   1. It can ONLY restore into a throwaway localhost container.
 *   2. It always runs check-moat after restoring.
 *   3. It tears down on failure unless --keep.
 *   4. The runbook distinguishes restore-test from disaster recovery.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const scriptSrc = readFileSync(join(repoRoot, 'scripts/restore-test.js'), 'utf8');
const runbook = readFileSync(join(repoRoot, 'docs/RESTORE.md'), 'utf8');

describe('TRQ-148 — restore-test script safety rails', () => {
  test('uses the official postgres:15 image for the scratch container', () => {
    // Image lock matters: a custom image with weird extensions could
    // fail the restore for reasons unrelated to the backup itself.
    expect(scriptSrc).toMatch(/const PG_IMAGE = 'postgres:15'/);
  });

  test('container name is randomised (no collision across concurrent runs)', () => {
    expect(scriptSrc).toMatch(/restore-test-\$\{randomBytes\(4\)\.toString\('hex'\)\}/);
  });

  test('container uses --rm so a crash never leaves debris', () => {
    expect(scriptSrc).toMatch(/'docker',\s*\[[\s\S]{0,200}'--rm'/);
  });

  test('hard rule: DATABASE_URL is always localhost-only', () => {
    // The mechanical refuse-to-run check. If a future edit removes
    // this guard, the test fails.
    expect(scriptSrc).toMatch(
      /!databaseUrl\.includes\('@localhost:'\)[\s\S]{0,200}refused to run/
    );
  });

  test('check-moat runs in --fresh mode (no production floors)', () => {
    expect(scriptSrc).toMatch(/'scripts\/check-moat\.js',\s*'--fresh'/);
  });

  test('check-moat always runs against the restored DB', () => {
    // The runMoatCheck call must be reached from the happy path.
    expect(scriptSrc).toMatch(/await runMoatCheck\(/);
  });
});

describe('TRQ-148 — failure handling', () => {
  test('tears down the container on failure unless --keep', () => {
    expect(scriptSrc).toMatch(/if \(!args\.keep\) tearDown\(containerName\)/);
  });

  test('tearDown is a no-op when container name is null (early failures)', () => {
    expect(scriptSrc).toMatch(/function tearDown\(name\)\s*\{[\s\S]{0,150}if \(!name\) return/);
  });

  test('exit code 2 for setup errors (Docker missing, env missing)', () => {
    // Distinguishes "this run failed" (1) from "we couldn't even try" (2).
    // The Docker-missing message is thrown from spawnScratchPostgres()
    // and the env-missing message from downloadFromR2(); both are
    // caught by the outer try and routed to exit 2.
    expect(scriptSrc).toMatch(/Docker is not available/);
    expect(scriptSrc).toMatch(/Missing R2 env/);
    expect(scriptSrc).toMatch(/err\.message\.includes\('Missing'\)[\s\S]{0,150}'Docker is not'[\s\S]{0,80}\?\s*2\s*:\s*1/);
  });

  test('psql runs with -v ON_ERROR_STOP=1 (fail fast, no half-restore)', () => {
    expect(scriptSrc).toMatch(/'-v',\s*'ON_ERROR_STOP=1'/);
  });

  test('30-second readiness loop has a hard upper bound', () => {
    expect(scriptSrc).toMatch(/for \(let i = 0; i < 30; i\+\+\)/);
    expect(scriptSrc).toMatch(/never became ready \(30s\)/);
  });
});

describe('TRQ-148 — backup source selection', () => {
  test('--file accepts a local path', () => {
    expect(scriptSrc).toMatch(/case '--file':|a === '--file'/);
  });

  test('--r2-key accepts a specific R2 object', () => {
    expect(scriptSrc).toMatch(/a === '--r2-key'/);
  });

  test('default mode picks the NEWEST R2 backup (newest-first sort)', () => {
    expect(scriptSrc).toMatch(/function pickNewestR2Backup/);
    expect(scriptSrc).toMatch(/sort\(\(a, b\) => \(b\.Key < a\.Key \? -1 : 1\)\)/);
  });

  test('R2 download path requires the four R2 env vars', () => {
    expect(scriptSrc).toMatch(/R2_ENDPOINT/);
    expect(scriptSrc).toMatch(/R2_BUCKET/);
    expect(scriptSrc).toMatch(/R2_ACCESS_KEY_ID/);
    expect(scriptSrc).toMatch(/R2_SECRET_ACCESS_KEY/);
  });
});

describe('TRQ-148 — runbook (docs/RESTORE.md)', () => {
  test('clearly separates restore-test (routine) from disaster recovery (Harry-only)', () => {
    expect(runbook).toMatch(/Restore-test/);
    expect(runbook).toMatch(/Disaster recovery/);
    expect(runbook).toMatch(/Harry-only/);
  });

  test('disaster recovery is gated on an explicit Harry decision', () => {
    expect(runbook).toMatch(/Do not run this without Harry's explicit decision/);
  });

  test('disaster recovery procedure starts with a fresh backup of the current state', () => {
    // The "step's prep" before overwriting prod with the chosen backup.
    expect(runbook).toMatch(/Take a fresh backup of the current state RIGHT NOW/i);
  });

  test('tree-order restore is documented (jobs/users/quote_diffs etc.)', () => {
    // CLAUDE.md and the constitution describe the FK graph as a tree,
    // not circular. The runbook must match.
    expect(runbook).toMatch(/tree rooted at `users`/i);
    // Suggested manual restore order.
    expect(runbook).toMatch(/users → jobs/);
  });

  test('Sign-off gate is named (TRQ-148 acceptance criterion)', () => {
    expect(runbook).toMatch(/Sign-off gate/);
    expect(runbook).toMatch(/personally watch this run succeed/);
  });

  test('warns explicitly against confusing restore-test with disaster recovery', () => {
    expect(runbook).toMatch(/assuming restore-test == disaster recovery/);
    expect(runbook).toMatch(/will refuse|refuse to run/i);
  });
});
