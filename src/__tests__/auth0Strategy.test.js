/**
 * Auth0 Universal Login wiring (2026-06-29).
 *
 * Replaces passport-google-oauth20 with passport-auth0. Auth0 hosts both
 * Google social and Email Passwordless (magic link) behind a single
 * Universal Login screen. The full setup runbook lives at
 * docs/AUTH0_SETUP.md.
 *
 * Same source-level pattern as serverReferrals.test.js / authMeBilling
 * — Jest with no JSX transform can't spin the full Express app, so
 * we lock the contract by reading server.js and asserting the expected
 * pieces exist + are wired correctly. Live route behaviour is exercised
 * in api.test.js with a real DB.
 *
 * What this suite covers:
 *   1. passport-auth0 strategy is registered with the right env vars.
 *   2. /auth/login → Auth0 (302), /auth/callback handles return trip.
 *   3. /auth/google → /auth/login 301 redirect (back-compat).
 *   4. /auth/logout destroys FastQuote session + redirects to
 *      Auth0 /v2/logout.
 *   5. /login page redirects to /auth/login (no Google-only UI).
 *   6. /auth/callback matches existing users by lower(email).
 *   7. /auth/callback creates new users when no email match.
 *   8. "Remember this device" extends cookie.maxAge to 30 days.
 *   9. EVENT_NAME_ALLOWLIST + recordEvent wiring unchanged.
 *  10. LEGAL_VERSIONS.dpa bumped + Auth0 listed in /privacy + /dpa.
 *  11. Stripe client_reference_id flow uses users.id (unchanged).
 *  12. /auth/me payload shape unchanged.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

// ─── 1. Strategy registration ────────────────────────────────────────────
describe('passport-auth0 strategy registers with env vars', () => {
  test('imports passport-auth0 (not passport-google-oauth20)', () => {
    expect(serverSrc).toMatch(/import\s+Auth0Strategy\s+from\s+['"]passport-auth0['"]/);
    expect(serverSrc).not.toMatch(/passport-google-oauth20/);
  });

  test('strategy is constructed with the four locked env var names', () => {
    expect(serverSrc).toMatch(/passport\.use\(new Auth0Strategy\(/);
    expect(serverSrc).toMatch(/domain:\s*process\.env\.AUTH0_DOMAIN/);
    expect(serverSrc).toMatch(/clientID:\s*process\.env\.AUTH0_CLIENT_ID/);
    expect(serverSrc).toMatch(/clientSecret:\s*process\.env\.AUTH0_CLIENT_SECRET/);
    expect(serverSrc).toMatch(/callbackURL:\s*process\.env\.AUTH0_CALLBACK_URL/);
  });

  test('REQUIRED_PROD_ENV gates the four Auth0 vars (fail-closed at boot)', () => {
    expect(serverSrc).toMatch(/'AUTH0_DOMAIN'/);
    expect(serverSrc).toMatch(/'AUTH0_CLIENT_ID'/);
    expect(serverSrc).toMatch(/'AUTH0_CLIENT_SECRET'/);
    expect(serverSrc).toMatch(/'AUTH0_CALLBACK_URL'/);
  });

  test('the four GOOGLE_* env vars are no longer required at boot', () => {
    // The strategy migration removed Google OAuth credentials from the
    // FastQuote server — they live inside Auth0 now. The boot-time
    // fail-closed list MUST NOT still require GOOGLE_CLIENT_ID /
    // GOOGLE_CLIENT_SECRET, or production deploys without those legacy
    // vars will refuse to start.
    const requiredBlock = serverSrc.match(/REQUIRED_PROD_ENV\s*=\s*\[[\s\S]*?\]/);
    expect(requiredBlock).not.toBeNull();
    expect(requiredBlock[0]).not.toMatch(/GOOGLE_CLIENT_ID/);
    expect(requiredBlock[0]).not.toMatch(/GOOGLE_CLIENT_SECRET/);
  });

  test('strategy verify callback never persists raw accessToken / idToken', () => {
    // Security: extract claims into req.user, never store the raw Auth0
    // tokens server-side. The Strategy callback signature is
    // (accessToken, refreshToken, extraParams, profile, done) — the
    // first two args must NOT flow into INSERT/UPDATE on the users row.
    const strategyStart = serverSrc.indexOf('passport.use(new Auth0Strategy(');
    const strategyEnd = serverSrc.indexOf('}));', strategyStart);
    expect(strategyStart).toBeGreaterThan(-1);
    const block = serverSrc.slice(strategyStart, strategyEnd);
    // We accept either underscore-prefix (unused convention) or unused-
    // identifier patterns. The hard contract is: no SQL containing
    // 'accessToken' or 'id_token' or 'idToken'.
    expect(block).not.toMatch(/INSERT[\s\S]*?accessToken/);
    expect(block).not.toMatch(/UPDATE[\s\S]*?accessToken/);
    expect(block).not.toMatch(/INSERT[\s\S]*?id_?[Tt]oken/);
    expect(block).not.toMatch(/UPDATE[\s\S]*?id_?[Tt]oken/);
  });
});

// ─── 2. Routes: /auth/login, /auth/callback ──────────────────────────────
describe('/auth/login and /auth/callback are wired', () => {
  test('GET /auth/login route exists and calls passport.authenticate("auth0")', () => {
    const start = serverSrc.indexOf("app.get('/auth/login'");
    expect(start).toBeGreaterThan(-1);
    const next = serverSrc.indexOf('\napp.get(', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/passport\.authenticate\(\s*['"]auth0['"]/);
    expect(block).toMatch(/scope:\s*['"]openid email profile['"]/);
  });

  test('GET /auth/callback route exists with auth0 strategy + failureRedirect', () => {
    const start = serverSrc.indexOf("app.get('/auth/callback'");
    expect(start).toBeGreaterThan(-1);
    const next = serverSrc.indexOf('\napp.get(', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/passport\.authenticate\(\s*['"]auth0['"][\s\S]*?failureRedirect:\s*['"]\/login\?error=auth_failed['"]/);
  });

  test('/auth/callback regenerates session, calls req.login, then redirects to /', () => {
    const start = serverSrc.indexOf("app.get('/auth/callback'");
    const next = serverSrc.indexOf('\napp.get(', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/req\.session\.regenerate/);
    expect(block).toMatch(/req\.login\(user/);
    expect(block).toMatch(/res\.redirect\(['"]\/['"]?\)/);
  });

  test('/auth/callback fires the signup_completed analytics event', () => {
    const start = serverSrc.indexOf("app.get('/auth/callback'");
    const next = serverSrc.indexOf('\napp.get(', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/recordEvent\(\s*['"]signup_completed['"]/);
  });
});

// ─── 3. /auth/google + /auth/google/callback back-compat ─────────────────
describe('/auth/google → /auth/login 301 redirect (back-compat)', () => {
  test('/auth/google is mounted as a 301 redirect, NOT a passport.authenticate', () => {
    const start = serverSrc.indexOf("app.get('/auth/google'");
    expect(start).toBeGreaterThan(-1);
    const next = serverSrc.indexOf("app.get('/auth/google/callback'", start);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/res\.redirect\(\s*301\s*,\s*[`'"]\/auth\/login/);
    // The OLD /auth/google was a passport.authenticate('google', ...)
    // call. After the migration the new handler must NOT contain that.
    expect(block).not.toMatch(/passport\.authenticate\(['"]google['"]/);
  });

  test('/auth/google preserves the query string (so ?ref= still works)', () => {
    const start = serverSrc.indexOf("app.get('/auth/google'");
    const next = serverSrc.indexOf("app.get('/auth/google/callback'", start);
    const block = serverSrc.slice(start, next);
    // The redirect URL must include req.url's query suffix so a cached
    // bookmark like /auth/google?ref=PAULJULY still lands on
    // /auth/login?ref=PAULJULY.
    expect(block).toMatch(/req\.url/);
  });

  test('/auth/google/callback also redirects (legacy callback URL safety)', () => {
    const start = serverSrc.indexOf("app.get('/auth/google/callback'");
    expect(start).toBeGreaterThan(-1);
    const next = serverSrc.indexOf('\napp.', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/res\.redirect\(\s*301\s*,\s*[`'"]\/auth\/callback/);
  });
});

// ─── 4. /auth/logout ─────────────────────────────────────────────────────
describe('/auth/logout destroys FastQuote session AND redirects to Auth0', () => {
  test('POST /auth/logout exists', () => {
    expect(serverSrc).toMatch(/app\.post\(\s*['"]\/auth\/logout['"]/);
  });

  test('GET /auth/logout exists for legacy <a href> compatibility', () => {
    expect(serverSrc).toMatch(/app\.get\(\s*['"]\/auth\/logout['"]/);
  });

  test('logout handler calls req.logout AND session.destroy AND clearCookie', () => {
    const start = serverSrc.indexOf('function destroyAndRedirectToAuth0Logout');
    expect(start).toBeGreaterThan(-1);
    const next = serverSrc.indexOf('\napp.', start);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/req\.logout/);
    expect(block).toMatch(/req\.session\.destroy/);
    expect(block).toMatch(/clearCookie\(['"]tq_session['"]\)/);
  });

  test('logout redirects to Auth0 /v2/logout (not just /login)', () => {
    const start = serverSrc.indexOf('function destroyAndRedirectToAuth0Logout');
    const next = serverSrc.indexOf('\napp.', start);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/\/v2\/logout/);
    expect(block).toMatch(/AUTH0_DOMAIN/);
    expect(block).toMatch(/returnTo/);
  });

  test('logout uses client_id query param on the Auth0 logout URL', () => {
    const start = serverSrc.indexOf('function destroyAndRedirectToAuth0Logout');
    const next = serverSrc.indexOf('\napp.', start);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/client_id=/);
    expect(block).toMatch(/AUTH0_CLIENT_ID/);
  });
});

// ─── 5. /login page redirects to /auth/login ─────────────────────────────
describe('/login redirects to /auth/login (Universal Login is the login page)', () => {
  test('/login (no error) is a 302 redirect to /auth/login', () => {
    const start = serverSrc.indexOf("app.get('/login'");
    const next = serverSrc.indexOf('\napp.', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/res\.redirect\(\s*302\s*,\s*authLoginHref\s*\)/);
  });

  test('/login (with ?error=) still renders the fallback HTML with Try Again', () => {
    const start = serverSrc.indexOf("app.get('/login'");
    const next = serverSrc.indexOf('\napp.', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/req\.query\.error/);
    expect(block).toMatch(/res\.send\(html\)/);
  });

  test('LOGIN_PAGE_HTML carries the Try again button + footer DPA link', () => {
    const htmlStart = serverSrc.indexOf("LOGIN_PAGE_HTML = `");
    const htmlEnd = serverSrc.indexOf("`;\n\napp.get('/login'", htmlStart);
    const html = serverSrc.slice(htmlStart, htmlEnd);
    expect(html).toMatch(/Try again/);
    expect(html).toMatch(/\/dpa/);
  });

  test('LOGIN_PAGE_HTML has no "Sign in with Google" button (Universal Login owns it)', () => {
    const htmlStart = serverSrc.indexOf("LOGIN_PAGE_HTML = `");
    const htmlEnd = serverSrc.indexOf("`;\n\napp.get('/login'", htmlStart);
    const html = serverSrc.slice(htmlStart, htmlEnd);
    expect(html).not.toMatch(/Sign in with Google/);
  });
});

// ─── 6 & 7. Verify callback — match by lower(email), create new ─────────
describe('verify callback — account linking by lower(email)', () => {
  // Scope the test to the body of the Auth0Strategy verify callback.
  const start = serverSrc.indexOf('passport.use(new Auth0Strategy(');
  const next = serverSrc.indexOf('}));', start);
  const block = serverSrc.slice(start, next);

  test('matches existing users by lower(email) FIRST (account linking)', () => {
    expect(block).toMatch(/SELECT \* FROM users WHERE lower\(email\) = lower\(\$1\)/);
  });

  test('updates auth_provider="auth0" + auth_provider_id=sub on first Auth0 login', () => {
    expect(block).toMatch(/SET[\s\S]*?auth_provider\s*=\s*'auth0'/);
    expect(block).toMatch(/auth_provider_id\s*=\s*\$\d+/);
  });

  test('falls back to (auth_provider, auth_provider_id) lookup when no email match', () => {
    expect(block).toMatch(/WHERE auth_provider = \$1 AND auth_provider_id = \$2/);
  });

  test('new users are INSERTED with auth_provider="auth0" + legal acceptance pinned', () => {
    expect(block).toMatch(/INSERT INTO users[\s\S]*?'auth0'/);
    expect(block).toMatch(/LEGAL_VERSIONS\.terms,\s*LEGAL_VERSIONS\.privacy,\s*LEGAL_VERSIONS\.dpa/);
  });

  test('new users get the _isNewUser=true marker (referral path)', () => {
    expect(block).toMatch(/_isNewUser\s*=\s*true/);
  });

  test('existing users get _isNewUser=false (no double referral credit)', () => {
    expect(block).toMatch(/_isNewUser\s*=\s*false/);
  });
});

// ─── 8. Remember-this-device → 30-day cookie ─────────────────────────────
describe('"Remember this device" extends cookie maxAge to 30 days', () => {
  test('/auth/login stashes rememberDevice on the session when ?remember=1', () => {
    const start = serverSrc.indexOf("app.get('/auth/login'");
    const next = serverSrc.indexOf('\napp.get(', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/rememberDevice/);
    expect(block).toMatch(/remember/);
  });

  test('/auth/callback reads rememberDevice + sets cookie.maxAge to 30 days', () => {
    const start = serverSrc.indexOf("app.get('/auth/callback'");
    const next = serverSrc.indexOf('\napp.get(', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/rememberDevice/);
    // 30 days in ms = 30 * 24 * 60 * 60 * 1000 = 2592000000
    expect(block).toMatch(/30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(block).toMatch(/cookie\.maxAge\s*=\s*30/);
  });

  test('default cookie.maxAge stays 7 days when ?remember is absent', () => {
    // The session cookie config is set ONCE at server startup; that's
    // the baseline (7 days). Only the post-callback handler bumps it
    // to 30 days. So the session() block must still have 7-day default.
    const sessionStart = serverSrc.indexOf('app.use(session({');
    const sessionEnd = serverSrc.indexOf('}));', sessionStart);
    const block = serverSrc.slice(sessionStart, sessionEnd);
    expect(block).toMatch(/maxAge:\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  test('/login forwards ?remember=1 to /auth/login', () => {
    const start = serverSrc.indexOf("app.get('/login'");
    const next = serverSrc.indexOf('\napp.', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/req\.query\.remember/);
    expect(block).toMatch(/remember=1/);
  });
});

// ─── 9. Analytics — signup_completed continues to fire ───────────────────
describe('EVENT_NAME_ALLOWLIST + recordEvent shape unchanged', () => {
  test('signup_completed is still in EVENT_NAME_ALLOWLIST', () => {
    expect(serverSrc).toMatch(/['"]signup_completed['"]/);
  });

  test('signup_completed comment mentions Auth0 (not Google)', () => {
    expect(serverSrc).toMatch(/['"]signup_completed['"][^,]*,\s*\/\/[^\n]*Auth0/);
  });

  test('referral_redeemed still fires on the new-user signup branch', () => {
    const start = serverSrc.indexOf("app.get('/auth/callback'");
    const next = serverSrc.indexOf('\napp.get(', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/recordEvent\(\s*['"]referral_redeemed['"]/);
  });
});

// ─── 10. LEGAL_VERSIONS.dpa bump + Auth0 in legal pages ─────────────────
describe('Legal docs (DPA bumped, Auth0 listed as sub-processor)', () => {
  test('LEGAL_VERSIONS.dpa version bumped to 2026-06-29', () => {
    expect(serverSrc).toMatch(/dpa:\s*['"]2026-06-29['"]/);
  });

  test('Privacy Policy adds Auth0 sub-processor entry', () => {
    const start = serverSrc.indexOf("app.get('/privacy'");
    const end = serverSrc.indexOf("app.get('/dpa'", start);
    const block = serverSrc.slice(start, end);
    expect(block).toMatch(/Auth0\s+by\s+Okta/i);
  });

  test('Privacy Policy adds the carve-out wording (Auth0 receives email + login events)', () => {
    const start = serverSrc.indexOf("app.get('/privacy'");
    const end = serverSrc.indexOf("app.get('/dpa'", start);
    const block = serverSrc.slice(start, end);
    // The locked sentence from the spec: "We use Auth0 (Okta Inc.) to
    // handle sign-in. Auth0 receives your email and login event
    // records when you authenticate."
    expect(block).toMatch(/We use Auth0/i);
    expect(block).toMatch(/Auth0 receives your email and login event/i);
  });

  test('DPA adds Auth0 sub-processor entry', () => {
    const start = serverSrc.indexOf("app.get('/dpa'");
    const end = serverSrc.indexOf("app.get('/terms'", start);
    const block = serverSrc.slice(start, end);
    expect(block).toMatch(/Auth0\s+by\s+Okta/i);
  });
});

// ─── 11. Stripe client_reference_id lineage unchanged ───────────────────
describe('Stripe lineage — users.id is still the stable PK', () => {
  test('billing.js (Stripe surface) is not touched by the auth swap', () => {
    const billingSrc = readFileSync(join(repoRoot, 'billing.js'), 'utf8');
    // The Auth0 migration must NOT introduce auth_provider checks into
    // the billing flow — Stripe maps to users.id only.
    expect(billingSrc).not.toMatch(/auth_provider/);
  });

  test('client_reference_id usage stays on users.id (no auth provider leak)', () => {
    // Any place server.js builds a Stripe Checkout session must use
    // users.id as the client_reference_id, never auth_provider_id.
    const matches = serverSrc.match(/client_reference_id[\s\S]{0,200}/g) || [];
    for (const m of matches) {
      expect(m).not.toMatch(/auth_provider_id/);
    }
  });
});

// ─── 12. /auth/me payload shape unchanged ───────────────────────────────
describe('/auth/me payload — same keys as before the migration', () => {
  test('returns user.{id,name,email,avatarUrl,plan,profileComplete}', () => {
    const start = serverSrc.indexOf("app.get('/auth/me'");
    const next = serverSrc.indexOf('\napp.', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/id:\s*req\.user\.id/);
    expect(block).toMatch(/name:\s*req\.user\.name/);
    expect(block).toMatch(/email:\s*req\.user\.email/);
    expect(block).toMatch(/avatarUrl:\s*req\.user\.avatar_url/);
    expect(block).toMatch(/plan:\s*req\.user\.plan/);
    expect(block).toMatch(/profileComplete:\s*!!req\.user\.profile_complete/);
  });

  test('returns features + billing blocks (unchanged)', () => {
    const start = serverSrc.indexOf("app.get('/auth/me'");
    const next = serverSrc.indexOf('\napp.', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/features/);
    expect(block).toMatch(/billing/);
  });
});

// ─── 13. Schema — idx_users_email_unique guarantees account linking ─────
describe('idx_users_email_unique guarantees no dupe-row risk on linking', () => {
  test('partial unique index on lower(email) WHERE email IS NOT NULL exists', () => {
    expect(serverSrc).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique[\s\S]*?ON users \(lower\(email\)\)[\s\S]*?WHERE email IS NOT NULL/
    );
  });

  test('auth_provider + auth_provider_id columns exist (additive only, no rename)', () => {
    expect(serverSrc).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT/);
    expect(serverSrc).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider_id TEXT/);
  });
});
