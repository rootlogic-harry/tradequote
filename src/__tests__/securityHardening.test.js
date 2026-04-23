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

describe('sec-audit H-1 — Anthropic proxy enforces model + token caps', () => {
  test('declares an explicit model allowlist (no wildcards)', () => {
    expect(serverSrc).toMatch(/ANTHROPIC_MODEL_ALLOWLIST\s*=\s*new\s+Set\(\[/);
    // The two models we actually use.
    expect(serverSrc).toMatch(/['"]claude-sonnet-4-20250514['"]/);
    expect(serverSrc).toMatch(/['"]claude-haiku-4-5-20251001['"]/);
  });

  test('caps max_tokens at a sane ceiling (cost DoS guard)', () => {
    expect(serverSrc).toMatch(/ANTHROPIC_MAX_TOKENS_CEILING\s*=\s*\d+/);
    // The literal ceiling value should be small (single-digit thousand range).
    const ceiling = serverSrc.match(/ANTHROPIC_MAX_TOKENS_CEILING\s*=\s*(\d+)/)?.[1];
    expect(Number(ceiling)).toBeGreaterThan(1000);
    expect(Number(ceiling)).toBeLessThanOrEqual(16384);
  });

  test('caps request body size (no 50MB context attacks)', () => {
    expect(serverSrc).toMatch(/ANTHROPIC_MAX_BODY_BYTES\s*=\s*\d+/);
  });

  test('caps message-array length', () => {
    expect(serverSrc).toMatch(/ANTHROPIC_MAX_MESSAGES\s*=\s*\d+/);
  });

  test('proxy rejects with 400 + logs WARN when validation fails', () => {
    const route = serverSrc.match(
      /app\.post\(\s*['"`]\/api\/anthropic\/messages['"`][\s\S]*?validateAnthropicProxyBody[\s\S]*?\n\}\)\s*;/
    );
    expect(route).not.toBeNull();
    expect(route[0]).toMatch(/return\s+res\.status\(400\)/);
    expect(route[0]).toMatch(/console\.warn[\s\S]{0,200}AI-proxy/);
  });

  test('proxy rejects with 413 when body exceeds size cap', () => {
    expect(serverSrc).toMatch(
      /body\.length\s*>\s*ANTHROPIC_MAX_BODY_BYTES[\s\S]{0,200}res\.status\(413\)/
    );
  });

  test('/api/users/:id/analyse uses the same allowlist', () => {
    // Catches the regression where an attacker bypasses the proxy by
    // hitting /analyse directly with their own model + max_tokens.
    const analyseRoute = serverSrc.match(
      /app\.post\(\s*['"`]\/api\/users\/:id\/analyse['"`][\s\S]*?\n\}\)\s*;/
    );
    expect(analyseRoute).not.toBeNull();
    expect(analyseRoute[0]).toMatch(/ANTHROPIC_MODEL_ALLOWLIST/);
    expect(analyseRoute[0]).toMatch(/ANTHROPIC_MAX_TOKENS_CEILING/);
  });
});

describe('sec-audit L-1 — session cookie Secure resolves via "auto"', () => {
  test('cookie config uses secure: "auto" (no NODE_ENV-dependent check)', () => {
    expect(serverSrc).toMatch(/secure:\s*['"]auto['"]/);
    // Regression guard against the previous conditional that could
    // silently disable Secure if NODE_ENV is anything but 'production'.
    expect(serverSrc).not.toMatch(/secure:\s*process\.env\.NODE_ENV/);
  });
});

describe('sec-audit L-2 — HSTS in production', () => {
  test('Strict-Transport-Security header set in production', () => {
    expect(serverSrc).toMatch(
      /NODE_ENV\s*===\s*['"]production['"][\s\S]{0,400}Strict-Transport-Security/
    );
    // includeSubDomains + preload for max protection against downgrade.
    expect(serverSrc).toMatch(/includeSubDomains/);
    expect(serverSrc).toMatch(/preload/);
  });
});

describe('sec-audit L-4 — session regeneration on login (fixation defence)', () => {
  test('OAuth callback regenerates session and re-logs the user in', () => {
    // The greedy regex on the route is brittle (nested parens),
    // so we slice from the route registration to the next top-level
    // `app.` call.
    const start = serverSrc.indexOf("app.get('/auth/google/callback'");
    expect(start).toBeGreaterThan(-1);
    const next = serverSrc.indexOf('\napp.', start + 1);
    const block = serverSrc.slice(start, next === -1 ? start + 2000 : next);
    expect(block).toMatch(/session\.regenerate/);
    expect(block).toMatch(/req\.login\(user/);
    // Order must be: regenerate first, then req.login. If the order
    // flips, fixation defence is voided.
    expect(block.indexOf('session.regenerate')).toBeLessThan(block.indexOf('req.login'));
  });
});

describe('sec-audit M-2 — magic-byte verification on uploads', () => {
  test('imports fileTypeFromFile (file-type magic-byte detector)', () => {
    expect(serverSrc).toMatch(/import\s*\{\s*fileTypeFromFile\s*\}\s*from\s*['"`]file-type['"`]/);
  });

  test('video upload checks the sniffed MIME starts with video/', () => {
    expect(serverSrc).toMatch(/fileTypeFromFile\s*\(\s*videoFile\.path\s*\)/);
    expect(serverSrc).toMatch(/sniffed\.mime\.startsWith\(\s*['"]video\/['"]\s*\)/);
  });

  test('extra photos are sniffed too (covers MIME-spoofed images in the loop)', () => {
    expect(serverSrc).toMatch(/sniffed\.mime\.startsWith\(\s*['"]image\/['"]\s*\)/);
  });

  test('rejected uploads are unlinked from /tmp (no DoS via tmp fill)', () => {
    // Catches the regression where we reject the request but leave
    // the file behind, allowing /tmp to fill up.
    expect(serverSrc).toMatch(/fs\.unlinkSync\(videoFile\.path\)/);
  });
});

describe('sec-audit M-3 — per-user photo storage cap', () => {
  test('declares a per-user ceiling constant', () => {
    expect(serverSrc).toMatch(/PER_USER_PHOTO_BYTES_CEILING\s*=\s*\d+/);
  });

  test('photo PUT runs a quota check before INSERT', () => {
    const route = serverSrc.match(
      /app\.put\(\s*['"`]\/api\/users\/:id\/photos\/:context\/:slot['"`][\s\S]*?\n\}\)\s*;/
    );
    expect(route).not.toBeNull();
    // Sums existing bytes for this user excluding the row being overwritten.
    expect(route[0]).toMatch(/SUM\(\s*octet_length\(data\)/i);
    // Returns 413 when over.
    expect(route[0]).toMatch(/res\.status\(413\)/);
  });
});

describe('sec-audit M-4 — IP-based rate limit on AI routes (multi-account bypass)', () => {
  test('declares aiRateLimitPerIp using the default IP keyGenerator', () => {
    expect(serverSrc).toMatch(/aiRateLimitPerIp\s*=\s*rateLimit\(/);
    // Crucially: NO custom keyGenerator on this one — it falls back
    // to req.ip, which (with trust proxy) is the real client IP.
    const block = serverSrc.match(/aiRateLimitPerIp\s*=\s*rateLimit\(\{[\s\S]*?\}\);/);
    expect(block).not.toBeNull();
    expect(block[0]).not.toMatch(/keyGenerator/);
  });

  test('both AI routes have aiRateLimitPerIp before the auth check', () => {
    expect(serverSrc).toMatch(/\/api\/anthropic\/messages['"`],\s*aiRateLimitPerIp/);
    expect(serverSrc).toMatch(/\/api\/users\/:id\/analyse['"`],\s*aiRateLimitPerIp/);
  });
});

describe('sec-audit I-2 — admin audit log', () => {
  test('admin_audit table created at boot', () => {
    expect(serverSrc).toMatch(/CREATE TABLE IF NOT EXISTS\s+admin_audit/);
    // Must store actor, action, target, ip, ua at minimum.
    expect(serverSrc).toMatch(/actor_id\s+TEXT/);
    expect(serverSrc).toMatch(/action\s+TEXT NOT NULL/);
    expect(serverSrc).toMatch(/target_id\s+TEXT/);
    expect(serverSrc).toMatch(/ip\s+TEXT/);
    expect(serverSrc).toMatch(/user_agent\s+TEXT/);
  });

  test('logAdminAction helper is fire-and-forget (never throws)', () => {
    const fn = serverSrc.match(/async function logAdminAction[\s\S]*?^\}/m)?.[0] || '';
    expect(fn).toMatch(/try\s*\{/);
    expect(fn).toMatch(/catch\s*\(/);
    expect(fn).not.toMatch(/throw\s/);
  });

  test('set-plan route writes an audit row', () => {
    const route = serverSrc.match(
      /app\.post\(\s*['"`]\/api\/admin\/users\/:id\/set-plan['"`][\s\S]*?\n\}\)\s*;/
    );
    expect(route).not.toBeNull();
    expect(route[0]).toMatch(/logAdminAction\([\s\S]*?['"]set-plan['"]/);
  });

  test('migrate-data route writes an audit row', () => {
    expect(serverSrc).toMatch(/logAdminAction\([\s\S]{0,200}?['"]migrate-data['"]/);
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
