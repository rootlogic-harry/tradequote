/**
 * Source-level guards for the admin analytics endpoint (TRQ-174).
 *
 * The endpoint is the single feed for the Analytics dashboard. These
 * assertions catch regressions that would silently break a section of
 * the UI (e.g. a future refactor that drops the per-quote roll-up or
 * forgets requireAdminPlan).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('admin analytics endpoint guards', () => {
  // Locate the route block once.
  const start = serverSrc.indexOf("app.get('/api/admin/analytics'");
  const end = serverSrc.indexOf("// Approved calibration notes for system prompt", start);
  const block = serverSrc.slice(start, end);

  test('endpoint exists and is admin-gated', () => {
    expect(start).toBeGreaterThan(-1);
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"]\/api\/admin\/analytics['"][\s\S]*requireAuth[\s\S]*requireAdminPlan/
    );
  });

  test('range param is validated against an allowlist', () => {
    expect(block).toMatch(/\['24h',\s*'7d',\s*'30d',\s*'all'\]\.includes/);
  });

  test('response cached server-side to avoid hammering DB on refresh', () => {
    expect(block).toMatch(/analyticsCache/);
    expect(block).toMatch(/ANALYTICS_CACHE_MS/);
  });

  test('returns required top-level sections', () => {
    expect(block).toMatch(/users:/);
    expect(block).toMatch(/quotes:/);
    expect(block).toMatch(/perUser/);
    expect(block).toMatch(/perQuote/);
    expect(block).toMatch(/spend:/);
    expect(block).toMatch(/reliability:/);
    expect(block).toMatch(/portal:/);
  });

  test('runs the per-section queries in parallel via Promise.all', () => {
    expect(block).toMatch(/Promise\.all\(\[/);
  });

  test('joins agent_runs with jobs for per-quote spend', () => {
    expect(block).toMatch(/agent_runs[\s\S]*LEFT JOIN jobs/);
  });

  test('estimated cost in GBP uses tokensToGbp helper (not inlined)', () => {
    expect(block).toMatch(/tokensToGbp\(/);
    expect(block).toMatch(/whisperBytesToGbp\(/);
  });

  test('exposes pricing assumptions to the dashboard so admins know freshness', () => {
    expect(block).toMatch(/getPriceMap\(\)/);
  });

  test('NEVER interpolates user input into the SQL interval expression', () => {
    // The interval comes from a hard-coded map (24h/7d/30d/all). Any
    // future refactor that interpolates req.query directly would be
    // SQL injection. This assertion documents the invariant.
    expect(block).toMatch(/rangeToInterval/);
    expect(block).not.toMatch(/req\.query\.range[^a-zA-Z]+\s*\+|`\$\{req\.query\.range\}`/);
  });

  test('dormant-user count uses 14-day cutoff', () => {
    expect(block).toMatch(/14/);
    expect(block).toMatch(/dormant/);
  });

  // TRQ-176: pre-TRQ-173 agent_runs rows have model IS NULL.
  // jsonb_object_agg throws on NULL keys → entire endpoint 500'd.
  // Regression guard: the by_model aggregation must coalesce the
  // model column to a placeholder before aggregating.
  test('jsonb_object_agg coerces NULL model to a placeholder key', () => {
    expect(block).toMatch(/jsonb_object_agg\(COALESCE\(model,\s*['"]unknown['"]\)/);
  });

  test('analyse_calls counts only agent_type=analyse rows (not all agents)', () => {
    expect(block).toMatch(/COUNT\(\*\)\s*FILTER\s*\(WHERE\s+agent_type\s*=\s*['"]analyse['"]\)/);
  });

  test('catch block logs the SQL error code so Railway is grep-able', () => {
    expect(block).toMatch(/console\.error\(`?\[Analytics\]/);
  });
});
