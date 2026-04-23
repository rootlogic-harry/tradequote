/**
 * Security hardening — source-level audit asserts.
 *
 * Mirrors the codebase convention (no JSX/ESM transform in tests; we
 * grep server.js for the gates). Each test corresponds to a finding
 * from the security audit. If any of these assertions ever break,
 * a regression has likely re-opened a documented vulnerability.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

describe('sec-audit C-1 — /api/session/legacy is gated in production', () => {
  test('endpoint refuses to set a session in production', () => {
    const route = serverSrc.match(
      /app\.post\(\s*['"`]\/api\/session\/legacy['"`][\s\S]*?\n\}\)\s*;/
    );
    expect(route).not.toBeNull();
    const body = route[0];
    // Must check NODE_ENV before anything else and return 404 with no
    // session mutation. Distance can be ~1KB once the security log is
    // included; what matters is the gate runs first.
    expect(body).toMatch(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
    expect(body).toMatch(/return\s+res\.status\(404\)/);
    // The 404 must precede any session mutation.
    const gateIdx = body.search(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
    const sessionMutationIdx = body.indexOf('req.session.legacyUserId');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(sessionMutationIdx).toBeGreaterThan(gateIdx);
  });

  test('exploitation attempts in prod are logged at WARN with ip + ua', () => {
    // We want a signal in our logs the moment someone probes this
    // endpoint after the gate ships, not silent 404s.
    const route = serverSrc.match(
      /app\.post\(\s*['"`]\/api\/session\/legacy['"`][\s\S]*?\n\}\)\s*;/
    )[0];
    expect(route).toMatch(/console\.warn[\s\S]{0,400}\[SECURITY\]/);
    expect(route).toMatch(/req\.ip/);
  });
});

describe('sec-audit H-2 — test auth bypass is double-gated', () => {
  test('TEST_AUTH_ENABLED requires both NODE_ENV !== production AND ENABLE_TEST_AUTH=1', () => {
    expect(serverSrc).toMatch(/const\s+TEST_AUTH_ENABLED\s*=/);
    expect(serverSrc).toMatch(
      /process\.env\.NODE_ENV\s*!==\s*['"]production['"]\s*&&[\s\S]{0,200}ENABLE_TEST_AUTH\s*===\s*['"]1['"]/
    );
  });

  test('requireAuth uses TEST_AUTH_ENABLED, not a raw NODE_ENV check', () => {
    // Regression guard: the previous code only checked NODE_ENV, so a
    // misconfigured prod deploy with NODE_ENV=test enabled the bypass.
    const fn = serverSrc.match(/function requireAuth[\s\S]*?^\}/m)?.[0] || '';
    expect(fn).toMatch(/TEST_AUTH_ENABLED/);
    expect(fn).not.toMatch(/process\.env\.NODE_ENV\s*===\s*['"]test['"]/);
  });
});

describe('sec-audit H-3 — required production secrets are checked at boot', () => {
  test('lists the secrets that must be present in production', () => {
    expect(serverSrc).toMatch(/REQUIRED_PROD_ENV/);
    for (const k of ['SESSION_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DATABASE_URL']) {
      expect(serverSrc).toMatch(new RegExp(`['"]${k}['"]`));
    }
  });

  test('throws (process refuses to start) when any are missing in production', () => {
    expect(serverSrc).toMatch(
      /NODE_ENV\s*===\s*['"]production['"][\s\S]{0,400}throw new Error\([\s\S]*?missing secrets/
    );
  });
});

describe('sec-audit L-3 — legacy session reads plan from DB (no synthesised admin)', () => {
  test('requireAuth no longer synthesises plan: "admin" for legacy sessions', () => {
    const fn = serverSrc.match(/function requireAuth[\s\S]*?^\}/m)?.[0] || '';
    // The vulnerable line was literally `plan: 'admin'`.
    expect(fn).not.toMatch(/req\.user\s*=\s*\{[^}]*plan:\s*['"]admin['"]/);
  });

  test('requireAuth queries users.plan for the legacy user id', () => {
    const fn = serverSrc.match(/function requireAuth[\s\S]*?^\}/m)?.[0] || '';
    expect(fn).toMatch(/SELECT\s+plan\s+FROM\s+users/i);
    expect(fn).toMatch(/legacyUserId/);
  });

  test('legacy plan lookup failure fails closed (401)', () => {
    const fn = serverSrc.match(/function requireAuth[\s\S]*?^\}/m)?.[0] || '';
    expect(fn).toMatch(/\.catch\(/);
    expect(fn).toMatch(/Not authenticated/);
  });
});
