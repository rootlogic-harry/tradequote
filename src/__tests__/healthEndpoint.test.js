/**
 * TRQ-155 — /health is DB-aware.
 *
 * The previous endpoint was `(_req, res) => res.json({ status: 'ok' })`
 * which lied: it returned 200 even when Postgres was unreachable. An
 * uptime monitor pointed at it would have said "up" during a real
 * outage.
 *
 * These guards lock in the new behaviour at the source level:
 *   - the handler actually runs pool.query('SELECT 1')
 *   - it bounds the probe with a 2-second timeout
 *   - it returns 503 on failure (not 200, not 500)
 *   - failure payload distinguishes 'timeout' vs 'unreachable'
 *   - the route remains mounted BEFORE express.json so a failing body
 *     parser cannot mask a healthcheck signal
 *   - the route doesn't leak DB error messages to the client
 *   - the route never calls any AI or heavy query
 *   - docs/UPTIME.md exists and matches the contract
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const uptimeDoc = readFileSync(join(repoRoot, 'docs/UPTIME.md'), 'utf8');

describe('TRQ-155 — /health route', () => {
  // Slice the /health handler block so per-assertion matches don't
  // accidentally hit some other route's behaviour.
  const start = serverSrc.indexOf("app.get('/health'");
  const end = serverSrc.indexOf('app.use(express.json', start);
  const block = serverSrc.slice(start, end);

  test('the route exists and is mounted before express.json middleware', () => {
    expect(start).toBeGreaterThan(-1);
    // The route handler is registered BEFORE express.json so a
    // bad-JSON body in a POST elsewhere can't make /health 4xx.
    expect(end).toBeGreaterThan(start);
  });

  test('handler is async (previous version was a synchronous stub)', () => {
    expect(block).toMatch(/app\.get\('\/health',\s*async/);
  });

  test('runs pool.query("SELECT 1") — actually probes the DB', () => {
    expect(block).toMatch(/pool\.query\(['"]SELECT 1['"]\)/);
  });

  test('bounds the probe with a 2-second timeout via Promise.race', () => {
    expect(block).toMatch(/Promise\.race/);
    // The timeout literal must be exactly 2000ms — slower probes risk
    // tripping Railway's healthcheckTimeout (60s) only in pathological
    // cases, but UptimeRobot's default request timeout is ~30s, and
    // we want the user signal long before that.
    expect(block).toMatch(/setTimeout[\s\S]{0,80}2000/);
  });

  test('uses a SENTINEL error for the timeout path so 503 can categorise it', () => {
    expect(block).toMatch(/db-timeout/);
  });

  test('healthy response: 200 with status=ok + db=ok + latency_ms', () => {
    // res.json with the three fields. We don't anchor the order so a
    // future cosmetic rearrange doesn't trip the test.
    expect(block).toMatch(/res\.json\(\{[\s\S]*?status:\s*['"]ok['"]/);
    expect(block).toMatch(/db:\s*['"]ok['"]/);
    expect(block).toMatch(/latency_ms/);
  });

  test('degraded response: 503 with status=degraded and db category', () => {
    expect(block).toMatch(/res\.status\(503\)/);
    expect(block).toMatch(/status:\s*['"]degraded['"]/);
    // The `db` field must be either 'timeout' or 'unreachable'.
    expect(block).toMatch(/db:\s*[^\n]*['"]timeout['"][\s\S]{0,80}['"]unreachable['"]/);
  });

  test('catch block logs server-side but never returns the raw error message', () => {
    expect(block).toMatch(/console\.warn\(['"]\[\/health\]/);
    // The 503 payload must not leak err.message. The category string
    // is computed from err.message === 'db-timeout', not interpolated.
    expect(block).not.toMatch(/error:\s*err\.message/);
    expect(block).not.toMatch(/stack:\s*err\.stack/);
  });

  test('handler never calls AI or hits agent_runs / a heavy table', () => {
    // The whole point is cheap. Anthropic/OpenAI calls would burn
    // money on every healthcheck (every 5 min from UptimeRobot).
    expect(block).not.toMatch(/anthropic|openai|claude|aiRateLimit/i);
    expect(block).not.toMatch(/FROM\s+(agent_runs|quote_diffs|jobs|users|pageviews)/i);
  });
});

describe('TRQ-155 — railway.toml still points at /health', () => {
  const railwayToml = readFileSync(join(repoRoot, 'railway.toml'), 'utf8');

  test('healthcheckPath unchanged (TRQ-141+145 set this — must stay)', () => {
    expect(railwayToml).toMatch(/healthcheckPath\s*=\s*"\/health"/);
  });

  test('healthcheckTimeout of 60s exceeds the endpoint\'s 2s probe budget', () => {
    expect(railwayToml).toMatch(/healthcheckTimeout\s*=\s*60/);
  });
});

describe('TRQ-155 — docs/UPTIME.md runbook', () => {
  test('documents the healthy response shape', () => {
    expect(uptimeDoc).toMatch(/HTTP 200/);
    expect(uptimeDoc).toMatch(/"status":\s*"ok"/);
    expect(uptimeDoc).toMatch(/"db":\s*"ok"/);
  });

  test('documents the degraded response shape with both db categories', () => {
    expect(uptimeDoc).toMatch(/HTTP 503/);
    expect(uptimeDoc).toMatch(/"status":\s*"degraded"/);
    expect(uptimeDoc).toMatch(/timeout/);
    expect(uptimeDoc).toMatch(/unreachable/);
  });

  test('UptimeRobot setup is documented (Harry-only step)', () => {
    expect(uptimeDoc).toMatch(/UptimeRobot/);
    expect(uptimeDoc).toMatch(/5 minutes?/);
    // The "test the alert" step matters more than any other —
    // unverified alerts are worse than no alerts.
    expect(uptimeDoc).toMatch(/Test the alert/i);
  });

  test('triage table covers the main failure modes', () => {
    expect(uptimeDoc).toMatch(/db: unreachable/);
    expect(uptimeDoc).toMatch(/db: timeout/);
  });

  test('explicitly names what /health does NOT check (AI, R2, etc.)', () => {
    expect(uptimeDoc).toMatch(/does \*\*not\*\* test|doesn't catch/i);
    expect(uptimeDoc).toMatch(/Anthropic/);
  });
});
