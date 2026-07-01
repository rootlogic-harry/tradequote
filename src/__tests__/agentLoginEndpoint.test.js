/**
 * /test/agent-login — source-level contract guard (Phase 2 smoke, 2026-07-01).
 *
 * The Playwright smoke suite (tests/e2e/*) validates end-to-end
 * behaviour but only when AGENT_SMOKE_SECRET is configured. This
 * source-level test locks the security contract of the auth-bypass
 * endpoint irrespective of environment: the code SHAPE must be
 * safe even before anyone flips it on.
 *
 * Invariants pinned here:
 *   - Endpoint returns 404 when AGENT_SMOKE_SECRET is unset (fail-closed).
 *   - Constant-time comparison via crypto.timingSafeEqual.
 *   - billingRateLimit is mounted (10/min/IP).
 *   - Hardcoded user id — no path parameter for who to log in as.
 *   - Session is regenerated on login (sec-audit L-4).
 *   - Only mounts when the smoke user actually exists in the DB.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

const ROUTE_ANCHOR = "app.post('/test/agent-login'";

const routeBlock = (() => {
  const start = serverSrc.indexOf(ROUTE_ANCHOR);
  if (start === -1) return '';
  const rest = serverSrc.slice(start);
  const next = rest.search(/\napp\.(?:get|post|put|patch|delete|use)\(/);
  return rest.slice(0, next > 0 ? next : 4000);
})();

describe('/test/agent-login — endpoint registration', () => {
  test('mounted with billingRateLimit (10/min/IP shared with money-adjacent endpoints)', () => {
    expect(serverSrc).toMatch(
      /app\.post\(\s*['"]\/test\/agent-login['"]\s*,\s*billingRateLimit\s*,/
    );
  });

  test('imports timingSafeEqual from node:crypto', () => {
    expect(serverSrc).toMatch(/import\s+\{\s*timingSafeEqual\s*\}\s+from\s+['"]node:crypto['"]/);
  });
});

describe('/test/agent-login — fail-closed defaults', () => {
  test('returns 404 when process.env.AGENT_SMOKE_SECRET is unset', () => {
    expect(routeBlock).toMatch(
      /if \(!configured\) return res\.status\(404\)\.json\(\{ error:/
    );
  });

  test('reads the secret from process.env, not a hardcoded string', () => {
    expect(routeBlock).toMatch(/process\.env\.AGENT_SMOKE_SECRET/);
  });

  test('returns 401 when the X-Agent-Secret header is missing or wrong', () => {
    expect(routeBlock).toMatch(/if \(!secretOk\) return res\.status\(401\)/);
  });

  test('constant-time compare via timingSafeEqual', () => {
    expect(routeBlock).toMatch(/timingSafeEqual\(configuredBuf, suppliedBuf\)/);
  });

  test('length-guarded before timingSafeEqual (length mismatch is a hard reject)', () => {
    expect(routeBlock).toMatch(/supplied\.length === configured\.length/);
  });
});

describe('/test/agent-login — user targeting', () => {
  test('hardcoded user id — no path parameter or body-driven user lookup', () => {
    expect(routeBlock).toMatch(/WHERE id = 'tq_agent_smoke'/);
    // Negative: no bind-parameter user lookup, no plan escalation.
    expect(routeBlock).not.toMatch(/WHERE id = \$1/);
    expect(routeBlock).not.toMatch(/plan = 'admin'/);
  });

  test('returns 404 with a clear "smoke user not seeded" message when the row is missing', () => {
    expect(routeBlock).toMatch(/Smoke user not seeded/);
  });
});

describe('/test/agent-login — session hygiene', () => {
  test('regenerates the session on login (sec-audit L-4 fixation defence)', () => {
    expect(routeBlock).toMatch(/req\.session\.regenerate/);
  });

  test('uses passport req.login inside the regenerate callback', () => {
    expect(routeBlock).toMatch(/req\.login\(user,/);
  });

  test('emits a server-side audit line naming the user + plan', () => {
    expect(routeBlock).toMatch(/\[Smoke\] agent-login/);
  });
});

describe('/test/agent-login — response shape', () => {
  test('success response includes user id + plan (not raw row leak)', () => {
    expect(routeBlock).toMatch(
      /res\.json\(\s*\{[\s\S]{0,120}ok:\s*true[\s\S]{0,200}user:\s*\{\s*id:[\s\S]{0,80}plan:/
    );
    // Negative: must not spread the whole user row.
    expect(routeBlock).not.toMatch(/res\.json\(\s*\{[\s\S]{0,120}\.\.\.user/);
  });
});
