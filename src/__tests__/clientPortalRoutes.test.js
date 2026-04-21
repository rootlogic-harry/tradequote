/**
 * Source-level contract tests for the public Client Portal routes.
 *
 * These assert the security-sensitive wiring of `/q/:token`, the view
 * beacon, and the respond endpoint. They're cheaper to run than booting
 * Express — and they catch the regressions that matter (someone removes
 * a security header, someone swaps the bot-safe beacon for a side-effect
 * in the GET handler, someone forgets the single-submission guard).
 *
 * Runtime-level assertions (actual HTTP, SQL roundtrips) live in the
 * separately-gated `api.test.js` suites, which need DATABASE_URL.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, '../../server.js'), 'utf8');

const routeBody = (pattern) => {
  const match = serverSource.match(pattern);
  if (!match) throw new Error(`Route not found: ${pattern}`);
  return match[0];
};

describe('Client Portal — rate limit on the public surface', () => {
  test('defines a clientPortalRateLimit with a 1-hour window and max of 20', () => {
    // 20 per IP per hour — the spec's number. It's low enough that a
    // curious scanner can't enumerate tokens, high enough that a real
    // client who pokes the page doesn't get locked out.
    expect(serverSource).toMatch(
      /const\s+clientPortalRateLimit\s*=\s*rateLimit\(\{[\s\S]*?windowMs:\s*60\s*\*\s*60\s*\*\s*1000[\s\S]*?max:\s*20[\s\S]*?\}\)/
    );
  });

  test('mounts the rate limit on all /q/ routes', () => {
    expect(serverSource).toMatch(
      /app\.use\(\s*['"`]\/q\/['"`]\s*,\s*clientPortalRateLimit\s*\)/
    );
  });
});

describe('Client Portal — GET /q/:token', () => {
  let body;
  beforeAll(() => {
    body = routeBody(/app\.get\(\s*['"`]\/q\/:token['"`][\s\S]*?\n\}\)/);
  });

  test('is registered before the SPA fallback so it is not swallowed', () => {
    const portalIdx = serverSource.indexOf("app.get('/q/:token'");
    const fallbackIdx = serverSource.indexOf("app.get('/{*path}'");
    expect(portalIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(-1);
    expect(portalIdx).toBeLessThan(fallbackIdx);
  });

  test('sets anti-indexing, no-store, and clickjacking-protection headers via setClientPortalSecurityHeaders', () => {
    // The route body delegates to a shared helper so errors + happy path
    // use the same header set. Assert both the delegation and the
    // helper's contents.
    expect(body).toMatch(/setClientPortalSecurityHeaders\s*\(\s*res\s*\)/);
    const helper = serverSource.match(
      /function\s+setClientPortalSecurityHeaders\s*\([\s\S]*?\n\}/
    );
    expect(helper).not.toBeNull();
    const helperBody = helper[0];
    // Cache-Control: no-store — keeps intermediaries (Railway CDN,
    // corporate proxies, browser disk cache) from storing the quote.
    // X-Robots-Tag — prevents search engines from indexing the URL
    // even if someone accidentally posts it publicly.
    // X-Frame-Options: DENY — prevents a phishing site embedding the
    // portal in an iframe to forward clicks / clickjack the Accept button.
    expect(helperBody).toMatch(/X-Robots-Tag[\s\S]*noindex/i);
    expect(helperBody).toMatch(/Cache-Control[\s\S]*no-store/i);
    expect(helperBody).toMatch(/X-Frame-Options[\s\S]*DENY/i);
  });

  test('sets a Content-Security-Policy that locks script execution to self', () => {
    // The portal page is fully server-rendered; no inline user content
    // should ever execute. Scripts we add live in a file served from the
    // same origin (or as inline modules with explicit CSP allowance).
    const helper = serverSource.match(
      /function\s+setClientPortalSecurityHeaders\s*\([\s\S]*?\n\}/
    );
    expect(helper).not.toBeNull();
    const helperBody = helper[0];
    expect(helperBody).toMatch(/Content-Security-Policy/i);
    expect(helperBody).toMatch(/default-src\s+['"]?self/i);
    // frame-ancestors 'none' belt-and-braces on top of X-Frame-Options.
    expect(helperBody).toMatch(/frame-ancestors\s+['"]?none/i);
  });

  test('does NOT set client_viewed_at (bot safety — beacon only)', () => {
    // Email prefetchers and link-scanning bots will trigger the GET but
    // never execute JavaScript. If this handler ever starts writing
    // client_viewed_at, every token will appear "viewed" the moment the
    // tradesman sends the link, which breaks the whole dashboard signal.
    expect(body).not.toMatch(/UPDATE\s+jobs[\s\S]*client_viewed_at\s*=/i);
  });

  test('returns 404 for an unknown token', () => {
    expect(body).toMatch(/status\(404\)/);
  });

  test('returns 410 for an expired token (Gone, not Not Found)', () => {
    // 410 is deliberate — tells browsers and any honest crawler the
    // resource is permanently gone and they should drop it.
    expect(body).toMatch(/status\(410\)/);
  });
});

describe('Client Portal — POST /q/:token/viewed (bot-safe beacon)', () => {
  let body;
  beforeAll(() => {
    body = routeBody(/app\.post\(\s*['"`]\/q\/:token\/viewed['"`][\s\S]*?\n\}\)/);
  });

  test('uses COALESCE so the first-view timestamp is preserved', () => {
    // Subsequent beacon firings (e.g. user re-opens the link a week
    // later) must not overwrite the original viewed_at — the dashboard
    // reads "viewed 5 days ago" and it should keep meaning that.
    expect(body).toMatch(/client_viewed_at\s*=\s*COALESCE\s*\(\s*client_viewed_at\s*,\s*NOW\(\)\s*\)/i);
  });

  test('rejects expired tokens', () => {
    // The beacon must be a no-op on expired tokens so a stale bookmark
    // can't resurrect the dashboard signal.
    expect(body).toMatch(/client_token_expires_at\s*>\s*NOW\(\)/i);
  });

  test('records IP and user-agent for audit', () => {
    expect(body).toMatch(/client_ip/);
    expect(body).toMatch(/client_user_agent/);
    expect(body).toMatch(/req\.ip/);
    expect(body).toMatch(/user-agent/i);
  });

  test('truncates user-agent to 500 chars (defensive)', () => {
    // Some crawlers send absurd UA strings — don't let them bloat the
    // row. Defensive cap is fine; we don't care about the tail.
    expect(body).toMatch(/slice\s*\(\s*0\s*,\s*500\s*\)/);
  });
});

describe('Client Portal — POST /q/:token/respond', () => {
  let body;
  beforeAll(() => {
    body = routeBody(/app\.post\(\s*['"`]\/q\/:token\/respond['"`][\s\S]*?\n\}\)/);
  });

  test('validates response is exactly "accepted" or "declined"', () => {
    // Whitelist only — anything else returns 400. No "maybe", no
    // callback, no accidental ENUM pollution.
    expect(body).toMatch(/\[['"]accepted['"]\s*,\s*['"]declined['"]\]\.includes\s*\(/);
    expect(body).toMatch(/status\(400\)/);
  });

  test('enforces single-submission (AND client_response IS NULL)', () => {
    // Once a client has made a decision, it's locked. If they change
    // their mind they pick up the phone. This guard is non-negotiable —
    // without it a bored click-farm could flip the row.
    expect(body).toMatch(/AND\s+client_response\s+IS\s+NULL/i);
  });

  test('rejects an expired token', () => {
    expect(body).toMatch(/client_token_expires_at\s*>\s*NOW\(\)/i);
  });

  test('returns 409 when the guard fails (already responded / expired)', () => {
    // 409 Conflict, not 400 — the request itself is well-formed; it
    // just conflicts with the current state of the resource.
    expect(body).toMatch(/status\(409\)/);
  });

  test('truncates decline reason to 300 characters', () => {
    // Spec cap. Prevents someone pasting a novel into the audit trail.
    expect(body).toMatch(/declineReason[\s\S]*slice\s*\(\s*0\s*,\s*300\s*\)/);
  });

  test('also writes legacy status fields so the dashboard reflects the result', () => {
    // TRQ-124 added new client_* columns, but the dashboard is wired to
    // `status = 'accepted'/'declined'`. A single UPDATE writes both so
    // the existing Dashboard.jsx keeps working without a second round-trip.
    expect(body).toMatch(/status\s*=\s*CASE\s+WHEN\s+\$1\s*=\s*['"]accepted['"]/i);
    expect(body).toMatch(/accepted_at\s*=\s*CASE/i);
    expect(body).toMatch(/declined_at\s*=\s*CASE/i);
  });

  test('records the responder IP and truncated user-agent on the UPDATE', () => {
    expect(body).toMatch(/client_ip\s*=\s*COALESCE\s*\(\s*client_ip\s*,/i);
    expect(body).toMatch(/client_user_agent\s*=\s*COALESCE\s*\(\s*client_user_agent\s*,/i);
  });

  test('uses only parameterised queries (no string interpolation of req input)', () => {
    // If this ever starts looking like `${req.body.response}` in a SQL
    // string, we have a real problem. Assert we're using positional
    // placeholders.
    expect(body).toMatch(/\$1[\s\S]*\$2[\s\S]*\$3/);
    expect(body).not.toMatch(/\$\{req\.body[^}]*\}[^`]*['"`]\s*\+/);
  });
});

describe('Client Portal — error-page helpers escape user-supplied data', () => {
  test('server has tokenNotFoundHtml and tokenExpiredHtml functions', () => {
    expect(serverSource).toMatch(/function\s+tokenNotFoundHtml\s*\(/);
    expect(serverSource).toMatch(/function\s+tokenExpiredHtml\s*\(/);
  });

  test('error pages use escapeHtml on any dynamic field', () => {
    // If the expired page shows "Mark's quote for {site address}" and
    // the site address contains `<script>`, we have XSS. The helpers
    // must run every dynamic string through escapeHtml.
    const notFound = serverSource.match(/function\s+tokenNotFoundHtml\s*\([\s\S]*?\n\}/);
    const expired = serverSource.match(/function\s+tokenExpiredHtml\s*\([\s\S]*?\n\}/);
    expect(notFound).not.toBeNull();
    expect(expired).not.toBeNull();
    // Expired page receives the job row and must escape any field it
    // interpolates. If it doesn't interpolate at all (a fully static
    // message), that's also safe — no assertion needed.
    if (/\$\{.*\}/.test(expired[0])) {
      expect(expired[0]).toMatch(/escapeHtml\s*\(/);
    }
  });
});
