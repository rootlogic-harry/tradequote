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
  test('uses the official postgres:18 image for the scratch container', () => {
    // Image lock matters: a custom image with weird extensions could
    // fail the restore for reasons unrelated to the backup itself.
    // Bumped to 18 in TRQ-162 to match the production major (was 15,
    // which would fail with the same pg_dump version-mismatch the
    // backup hit before TRQ-147 sub-issue #2).
    expect(scriptSrc).toMatch(/const PG_IMAGE = 'postgres:18'/);
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
    // Both branches handled — Docker via tearDown(handle.name),
    // no-Docker via tearDownNoDocker(handle).
    expect(scriptSrc).toMatch(/if \(!args\.keep && handle\)/);
    expect(scriptSrc).toMatch(/handle\.noDocker\s*\)\s*tearDownNoDocker\(handle\)/);
    expect(scriptSrc).toMatch(/else tearDown\(handle\.name\)/);
  });

  test('tearDown is a no-op when container name is null (early failures)', () => {
    expect(scriptSrc).toMatch(/function tearDown\(name\)\s*\{[\s\S]{0,150}if \(!name\) return/);
  });

  test('exit code 2 for setup errors (Docker missing, env missing, brew missing)', () => {
    // Distinguishes "this run failed" (1) from "we couldn't even try" (2).
    // Setup errors: Docker-missing from spawnScratchPostgres(),
    // env-missing from downloadFromR2(), postgresql@18-missing from
    // spawnScratchPostgresNoDocker(). All three caught by the outer
    // try and routed to exit 2 via the setupErr predicate.
    expect(scriptSrc).toMatch(/Docker is not available/);
    expect(scriptSrc).toMatch(/Missing R2 env/);
    expect(scriptSrc).toMatch(/postgresql@18 binaries not found/);
    expect(scriptSrc).toMatch(/const setupErr =[\s\S]{0,400}process\.exit\(setupErr \? 2 : 1\)/);
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

describe('TRQ-162 — no-Docker fallback path', () => {
  test('--no-docker is parseable as an arg', () => {
    expect(scriptSrc).toMatch(/a === '--no-docker'/);
  });

  test('parseArgs default is Docker (noDocker: false)', () => {
    expect(scriptSrc).toMatch(/noDocker:\s*false/);
  });

  test('PG_BIN env can override the default brew path', () => {
    expect(scriptSrc).toMatch(/process\.env\.PG_BIN\s*\|\|\s*DEFAULT_PG_BIN/);
    expect(scriptSrc).toMatch(/DEFAULT_PG_BIN\s*=\s*'\/opt\/homebrew\/opt\/postgresql@18\/bin'/);
  });

  test('no-Docker spawner is named spawnScratchPostgresNoDocker', () => {
    expect(scriptSrc).toMatch(/async function spawnScratchPostgresNoDocker/);
  });

  test('no-Docker path uses initdb + pg_ctl (not docker run)', () => {
    const fn = scriptSrc.split('async function spawnScratchPostgresNoDocker')[1] || '';
    expect(fn).toMatch(/initdb/);
    expect(fn).toMatch(/pg_ctl/);
  });

  test('no-Docker path uses trust auth (no password in the URL)', () => {
    // initdb --auth=trust → no password needed. The DATABASE_URL for
    // this path therefore omits the password.
    expect(scriptSrc).toMatch(/--auth=trust/);
    // The URL pattern in runMoatCheck is conditional on handle.noDocker
    // and uses the userless form when true.
    expect(scriptSrc).toMatch(/handle\.noDocker\s*\?[\s\S]{0,200}postgres:\/\/\$\{SCRATCH_USER\}@localhost/);
  });

  test('hard rule (localhost-only) still applies on the no-Docker path', () => {
    // Same guard string — both branches feed into runMoatCheck.
    // If a future edit splits the function, this test catches the
    // split's safety-rail regression.
    expect(scriptSrc).toMatch(/!databaseUrl\.includes\('@localhost:'\)/);
  });

  test('no-Docker tearDown removes the data dir', () => {
    expect(scriptSrc).toMatch(/function tearDownNoDocker/);
    expect(scriptSrc).toMatch(/rmSync\(handle\.dataDir/);
  });

  test('setup error: missing postgresql@18 binaries is exit code 2', () => {
    // Parallel to the Docker-missing path. The outer try/catch routes
    // setup errors to exit 2.
    expect(scriptSrc).toMatch(/postgresql@18 binaries not found/);
    expect(scriptSrc).toMatch(/err\.message\.includes\('postgresql@18 binaries not found'\)/);
  });

  test('--keep on no-Docker prints the manual teardown commands', () => {
    expect(scriptSrc).toMatch(/cluster left running at \$\{handle\.dataDir\}:\$\{handle\.port\}/);
    expect(scriptSrc).toMatch(/pg_ctl[\s\S]{0,80}-m immediate stop/);
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
