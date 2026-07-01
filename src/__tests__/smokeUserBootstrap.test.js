/**
 * Smoke-user bootstrap — source-level contract guard (2026-07-01).
 *
 * On server startup, if AGENT_SMOKE_SECRET is set, the initDB tail
 * seeds the `tq_agent_smoke` user + profile via idempotent INSERTs.
 * This removes the "manual SQL run" step from the Phase 2 setup:
 * setting the Railway env var + redeploying is enough.
 *
 * The bootstrap MUST be:
 *   1. Gated on the env var — no unconditional writes
 *   2. Idempotent — ON CONFLICT DO NOTHING on both INSERTs
 *   3. Wrapped in a transaction so a partial state can't ship
 *   4. Fail-quiet — errors log a warning, never throw + block startup
 *   5. Skipped in test env so Jest never writes to whatever DB it hits
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

const BOOTSTRAP_ANCHOR = 'Playwright smoke — auto-seed';
const block = (() => {
  const start = serverSrc.indexOf(BOOTSTRAP_ANCHOR);
  if (start === -1) return '';
  const rest = serverSrc.slice(start);
  // Bound by the closing brace of the .then() callback.
  return rest.slice(0, 4000);
})();

describe('Smoke-user bootstrap on initDB', () => {
  test('anchor comment is present', () => {
    expect(block).toContain(BOOTSTRAP_ANCHOR);
  });

  test('gated on process.env.AGENT_SMOKE_SECRET AND NODE_ENV !== "test"', () => {
    expect(block).toMatch(
      /if \(process\.env\.AGENT_SMOKE_SECRET\s*&&\s*process\.env\.NODE_ENV !== ['"]test['"]\)/
    );
  });

  test('wraps the two INSERTs in BEGIN/COMMIT with ROLLBACK on failure', () => {
    expect(block).toMatch(/pool\.query\(['"]BEGIN['"]\)/);
    expect(block).toMatch(/pool\.query\(['"]COMMIT['"]\)/);
    expect(block).toMatch(/pool\.query\(['"]ROLLBACK['"]\)/);
  });

  test('users INSERT is idempotent (ON CONFLICT DO NOTHING)', () => {
    expect(block).toMatch(/INSERT INTO users[\s\S]{0,1000}ON CONFLICT \(id\) DO NOTHING/);
  });

  test('profiles INSERT is idempotent (ON CONFLICT DO NOTHING)', () => {
    expect(block).toMatch(/INSERT INTO profiles[\s\S]{0,600}ON CONFLICT \(user_id\) DO NOTHING/);
  });

  test('seeded user id matches the /test/agent-login endpoint (tq_agent_smoke)', () => {
    expect(block).toMatch(/'tq_agent_smoke'/);
  });

  test('seeded user has plan=basic (no admin escalation via smoke)', () => {
    expect(block).toMatch(/['"]basic['"]/);
    expect(block).not.toMatch(/['"]admin['"]/);
  });

  test('fail-quiet — a caught error logs a warning but does not rethrow', () => {
    expect(block).toMatch(/console\.warn\(['"]\[Smoke\] bootstrap failed/);
    // Negative: no re-throw of the caught error.
    expect(block).not.toMatch(/throw err/);
  });

  test('success log line so Railway logs can confirm the bootstrap ran', () => {
    expect(block).toMatch(/\[Smoke\] tq_agent_smoke user \+ profile ensured/);
  });
});
