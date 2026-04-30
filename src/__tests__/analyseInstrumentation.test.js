/**
 * /api/users/:id/analyse instrumentation guards (TRQ-173).
 *
 * Source-level assertions that the Analytics dashboard's per-user / per-
 * quote spend tracking can't quietly regress. The route is the biggest
 * single token spender; if its agent_runs INSERT/UPDATE pair stops
 * firing, the dashboard silently shows £0 for the analysis call (which
 * is most of the bill).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('analyse route logs to agent_runs', () => {
  // Find the analyse route body once — the assertions below all live
  // inside it and would otherwise risk false-positive matches against
  // unrelated routes that happen to write to agent_runs.
  const start = serverSrc.indexOf("app.post('/api/users/:id/analyse'");
  const end = serverSrc.indexOf("// ─", start + 1);
  const block = serverSrc.slice(start, end);

  test('inserts an agent_runs row at start with agent_type=analyse', () => {
    expect(block).toMatch(/INSERT INTO agent_runs[\s\S]*'analyse'/);
    expect(block).toMatch(/RETURNING id/);
  });

  test('updates agent_runs with token usage on success', () => {
    expect(block).toMatch(/UPDATE agent_runs SET status = 'ok'[\s\S]*prompt_tokens/);
    expect(block).toMatch(/usage\.input_tokens/);
    expect(block).toMatch(/usage\.output_tokens/);
  });

  test('updates agent_runs with status=failed + error on exception', () => {
    expect(block).toMatch(/UPDATE agent_runs SET status = 'failed'[\s\S]*error/);
  });

  test('logging is best-effort — never re-throws to break user response', () => {
    // Both update queries chain .catch() so a DB failure can't cascade.
    expect(block).toMatch(/\.catch\(\(?err?\)?\s*=>/);
  });
});
