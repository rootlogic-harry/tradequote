/**
 * TRQ-146 — guards for the moat-integrity tripwire.
 *
 * The script itself can't be unit-tested against a real DB in CI
 * (no live Postgres in the deterministic suite), so this file asserts
 * the structural promises the script makes:
 *   - it covers all three moat tables
 *   - it exits 1 (not 0) when any check fails
 *   - it exits 2 (not 1) on configuration errors
 *   - it accepts --json and --fresh flags
 *   - the npm script is wired
 *
 * If someone refactors the script and drops a table from the check
 * list, the alarm stops being an alarm. This test stops that
 * silently happening.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const scriptSrc = readFileSync(join(repoRoot, 'scripts/check-moat.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const ciYml = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const moatDoc = readFileSync(join(repoRoot, 'docs/MOAT_CHECK.md'), 'utf8');

describe('TRQ-146 — check-moat.js covers all three moat tables', () => {
  test('quote_diffs is checked', () => {
    expect(scriptSrc).toMatch(/table:\s*'quote_diffs'/);
  });
  test('calibration_notes is checked', () => {
    expect(scriptSrc).toMatch(/table:\s*'calibration_notes'/);
  });
  test('agent_runs is checked', () => {
    expect(scriptSrc).toMatch(/table:\s*'agent_runs'/);
  });

  test('CHECKS array has exactly these three entries (no silent dropouts)', () => {
    // Count `table: '...'` occurrences inside the CHECKS array literal.
    const checksBlock = scriptSrc.match(/const CHECKS\s*=\s*\[[\s\S]*?\];/);
    expect(checksBlock).not.toBeNull();
    const entries = checksBlock[0].match(/table:\s*'[a-z_]+'/g) || [];
    expect(entries).toHaveLength(3);
  });
});

describe('TRQ-146 — check-moat.js exit semantics', () => {
  test('uses exit code 1 when a moat check fails', () => {
    // The script's main path: process.exit(allPassed ? 0 : 1).
    expect(scriptSrc).toMatch(/process\.exit\(allPassed\s*\?\s*0\s*:\s*1\)/);
  });

  test('uses exit code 2 for configuration errors (no DATABASE_URL / connection failed)', () => {
    expect(scriptSrc).toMatch(/DATABASE_URL is not set[\s\S]*?process\.exit\(2\)/);
    // The query-failed catch must also exit 2 (not 1) so callers can
    // distinguish "data is gone" (1) from "can't reach the DB" (2).
    expect(scriptSrc).toMatch(/query failed[\s\S]*?process\.exit\(2\)/);
  });

  test('hard timeout so the script can never hang a deploy', () => {
    expect(scriptSrc).toMatch(/connectionTimeoutMillis:\s*5000/);
    expect(scriptSrc).toMatch(/statement_timeout:\s*5000/);
  });

  test('read-only (no INSERT/UPDATE/DELETE statements anywhere)', () => {
    // Defensive guard: a moat CHECK that secretly writes would be a
    // catastrophe. Allow comment mentions but not actual SQL.
    const sql = scriptSrc.match(/`[^`]*(INSERT|UPDATE|DELETE)\s+(INTO|FROM|[a-z_]+)[^`]*`/gi) || [];
    expect(sql).toHaveLength(0);
  });
});

describe('TRQ-146 — CLI flags', () => {
  test('--json emits machine-readable output', () => {
    expect(scriptSrc).toMatch(/'--json'/);
    expect(scriptSrc).toMatch(/JSON\.stringify\(/);
  });

  test('--fresh relaxes floors to zero for restore-test scratch DBs', () => {
    expect(scriptSrc).toMatch(/'--fresh'/);
    expect(scriptSrc).toMatch(/freshFloor/);
  });

  test('--help is implemented', () => {
    expect(scriptSrc).toMatch(/'--help'/);
  });
});

describe('TRQ-146 — wiring + docs', () => {
  test('npm script check:moat is registered', () => {
    expect(pkg.scripts['check:moat']).toBe('node scripts/check-moat.js');
  });

  test('docs/MOAT_CHECK.md exists and references the three tables', () => {
    expect(moatDoc).toMatch(/quote_diffs/);
    expect(moatDoc).toMatch(/calibration_notes/);
    expect(moatDoc).toMatch(/agent_runs/);
    expect(moatDoc).toMatch(/exit code/i);
  });

  test('docs explain exit codes 0 / 1 / 2', () => {
    expect(moatDoc).toMatch(/`0`[\s\S]{0,200}passed/);
    expect(moatDoc).toMatch(/`1`[\s\S]{0,200}fail/);
    expect(moatDoc).toMatch(/`2`[\s\S]{0,200}[Cc]onfig/);
  });
});

describe('TRQ-146 — CI workflow (.github/workflows/ci.yml)', () => {
  test('triggers on every pull_request to main', () => {
    expect(ciYml).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
  });

  test('also runs on push to main (so the merge-to-main commit is verified)', () => {
    expect(ciYml).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
  });

  test('runs npm test (the deterministic suite, no live DB)', () => {
    expect(ciYml).toMatch(/run:\s*npm test/);
  });

  test('runs the Vite build so React/Vite breakage is caught before deploy', () => {
    expect(ciYml).toMatch(/run:\s*npm run build/);
  });

  test('uses Node 20 (matches package.json engines.node)', () => {
    expect(ciYml).toMatch(/node-version:\s*['"]20['"]/);
  });

  test('cancels in-flight runs on new push to the same PR (saves Actions minutes)', () => {
    expect(ciYml).toMatch(/cancel-in-progress:\s*true/);
  });
});
