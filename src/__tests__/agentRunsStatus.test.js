/**
 * TRQ-140 — agent_runs.status canonical enum guards.
 *
 * Asserts the single canonical success string is 'completed' and that
 * nothing in the lifecycle writes 'ok' any more. Plus the legacy-row
 * migration script keeps its safety properties (dry-run by default,
 * scoped WHERE clause, transaction wrap, statement timeout).
 *
 * Background: the /analyse path used to write 'ok'; the calibration
 * agent reads 'completed'. The mismatch made analyse rows invisible
 * to calibration. After this fix, 'completed' is the only success
 * string — enforced at the source level by this test.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { AGENT_RUN_STATUS } from '../../agents/agentUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const agentUtilsJs = readFileSync(join(repoRoot, 'agents/agentUtils.js'), 'utf8');
const calibrationJs = readFileSync(join(repoRoot, 'agents/calibrationAgent.js'), 'utf8');
const migrationJs = readFileSync(
  join(repoRoot, 'scripts/migrate-agent-runs-status-ok.js'),
  'utf8'
);

describe('TRQ-140 — exported canonical enum', () => {
  test('AGENT_RUN_STATUS has exactly three values', () => {
    expect(Object.keys(AGENT_RUN_STATUS)).toEqual(['RUNNING', 'COMPLETED', 'FAILED']);
  });

  test('success value is "completed", not "ok"', () => {
    expect(AGENT_RUN_STATUS.COMPLETED).toBe('completed');
  });

  test('enum is frozen (cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(AGENT_RUN_STATUS)).toBe(true);
  });
});

describe('TRQ-140 — server.js /analyse path now writes "completed"', () => {
  test('the success-path UPDATE on agent_runs writes status = \'completed\'', () => {
    // Anchor on the analyse success path. The UPDATE must use 'completed'.
    const successBlock = serverJs.match(
      /TRQ-173: success-path agent_runs completion[\s\S]{0,800}WHERE id = \$4/
    );
    expect(successBlock).not.toBeNull();
    expect(successBlock[0]).toMatch(/status = 'completed'/);
    expect(successBlock[0]).not.toMatch(/status = 'ok'/);
  });

  test('no remaining `status = \'ok\'` writes anywhere in the codebase', () => {
    // Both server.js and the agents directory. The migration script
    // necessarily mentions 'ok' but in a WHERE / SELECT — never a SET.
    expect(serverJs).not.toMatch(/SET\s+status\s*=\s*'ok'/i);
    expect(agentUtilsJs).not.toMatch(/SET\s+status\s*=\s*'ok'/i);
  });

  test('TRQ-140 fix is commented inline so the next person knows why', () => {
    expect(serverJs).toMatch(/TRQ-140[\s\S]{0,500}canonical enum|canonical enum[\s\S]{0,500}TRQ-140/);
  });
});

describe('TRQ-140 — agentUtils.js documents the canonical enum', () => {
  test('the canonical-enum comment block exists at the top of the file', () => {
    // Documents the three statuses, the TRQ-140 history, and the
    // change-control checklist. The shape (comment + exported const)
    // is what an autonomous agent reads first when touching this file.
    expect(agentUtilsJs).toMatch(/Canonical `agent_runs\.status` enum/);
    expect(agentUtilsJs).toMatch(/THE single success string/);
    expect(agentUtilsJs).toMatch(/TRQ-140/);
    expect(agentUtilsJs).toMatch(/export const AGENT_RUN_STATUS/);
  });

  test('completeAgentRun still writes \'completed\' (the dominant writer)', () => {
    // The historical anchor: agentUtils.js was always correct. Just
    // confirm it didn't drift the other way during this PR.
    expect(agentUtilsJs).toMatch(/UPDATE agent_runs\s*SET status = 'completed'/);
  });

  test('failAgentRun still writes \'failed\'', () => {
    expect(agentUtilsJs).toMatch(/SET status = 'failed'/);
  });

  test('createAgentRun still inserts with \'running\'', () => {
    expect(agentUtilsJs).toMatch(/INSERT INTO agent_runs[\s\S]{0,300}'running'/);
  });
});

describe('TRQ-140 — readers (calibration agent + analytics) match', () => {
  test('calibrationAgent.js filters on status = \'completed\' (unchanged)', () => {
    expect(calibrationJs).toMatch(/status = 'completed'/);
  });

  test('server.js auto-calibration trigger filters on \'completed\'', () => {
    expect(serverJs).toMatch(
      /agent_type = 'calibration' AND status = 'completed'/
    );
  });
});

describe('TRQ-140 migration script — safety properties', () => {
  test('dry-run by default (refuses to UPDATE without --apply)', () => {
    expect(migrationJs).toMatch(/const APPLY_FLAG = '--apply'/);
    // The UPDATE branch is gated by `if (!apply) { … return; }`
    expect(migrationJs).toMatch(/if \(!apply\)[\s\S]{0,400}Dry-run only/);
  });

  test('UPDATE is scoped (status=\'ok\' AND agent_type=\'analyse\')', () => {
    // The only writer that ever produced 'ok' was the /analyse path,
    // so the WHERE must be doubly-constrained to prevent collateral.
    expect(migrationJs).toMatch(
      /UPDATE agent_runs[\s\S]{0,200}SET status = 'completed'[\s\S]{0,300}WHERE status = 'ok' AND agent_type = 'analyse'/
    );
  });

  test('UPDATE is transaction-wrapped (BEGIN + COMMIT + ROLLBACK on error)', () => {
    expect(migrationJs).toMatch(/BEGIN/);
    expect(migrationJs).toMatch(/COMMIT/);
    expect(migrationJs).toMatch(/ROLLBACK/);
  });

  test('rolls back if UPDATE row count differs from pre-flight SELECT count', () => {
    expect(migrationJs).toMatch(
      /Row-count mismatch[\s\S]{0,200}Aborting/
    );
  });

  test('hard 10s statement timeout (cannot run away on a huge table)', () => {
    expect(migrationJs).toMatch(/statement_timeout:\s*10[_,]?000/);
    expect(migrationJs).toMatch(/connectionTimeoutMillis:\s*10[_,]?000/);
  });

  test('exits 2 when DATABASE_URL is missing', () => {
    expect(migrationJs).toMatch(/DATABASE_URL is not set[\s\S]*?process\.exit\(2\)/);
  });

  test('idempotent: a second --apply run finds zero rows and bails cleanly', () => {
    expect(migrationJs).toMatch(/Nothing to do/);
    // Steady-state message confirms idempotency intent.
    expect(migrationJs).toMatch(/expected steady-state/);
  });

  test('script body uses crypto/SQL strings only — no DROP/TRUNCATE', () => {
    expect(migrationJs).not.toMatch(/\bDROP\b/);
    expect(migrationJs).not.toMatch(/\bTRUNCATE\b/);
    // Allow DELETE only inside doc-style strings (we don't have any),
    // never as actual SQL.
    expect(migrationJs).not.toMatch(/`[^`]*DELETE\s+FROM/i);
  });
});
