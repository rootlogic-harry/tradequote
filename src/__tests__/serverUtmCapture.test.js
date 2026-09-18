/**
 * Ad-attribution — server.js wiring guards (2026-08-04).
 *
 * Pure source-level checks: no live server, no DB, no Auth0. Same
 * pattern as serverReferrals.test.js — read the file, assert the
 * load-bearing strings exist in the load-bearing places. This is
 * how the codebase catches:
 *
 *   - a future refactor that drops one of the four capture points
 *   - a rename of pendingUtm that stops the lift working
 *   - the UTM apply escaping its _isNewUser guard
 *   - the ALTER dropping a column
 *   - the coexistence contract with ?ref= silently breaking
 *
 * The behavioural side (a live Auth0 round-trip + DB assertions)
 * lives in the API integration tier (`npm run test:api`) — this
 * file protects the shape at unit-test speed.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('Schema — three UTM columns on users, all nullable', () => {
  test('adds signup_source (TEXT, nullable — no NOT NULL, no DEFAULT)', () => {
    // First-write-wins requires NULL as the sentinel for
    // "no attribution yet". A NOT NULL / DEFAULT '' would collide
    // with the coalesce logic in the admin dashboard's Source
    // summary (PR 2) which treats NULL as "direct/organic".
    expect(src).toMatch(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT;/,
    );
    const line = src.match(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT[^;]*;/,
    );
    expect(line).not.toBeNull();
    expect(line[0]).not.toMatch(/NOT NULL/);
    expect(line[0]).not.toMatch(/DEFAULT/);
  });

  test('adds signup_campaign + signup_medium with the same shape', () => {
    expect(src).toMatch(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_campaign TEXT;/,
    );
    expect(src).toMatch(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_medium TEXT;/,
    );
  });
});

describe('Import + helper functions', () => {
  test('imports pickUtms from the pure helper', () => {
    expect(src).toMatch(
      /import\s*\{\s*pickUtms\s*\}\s*from\s*['"]\.\/src\/utils\/utmCapture\.js['"]/,
    );
  });

  test('defines stashPendingUtm — first-write-wins session stash', () => {
    // First-write-wins is load-bearing. A landing capture MUST NOT be
    // overwritten by a downstream page view that lacks the UTMs (or
    // carries different ones — e.g. user opens landing from ad, then
    // navigates via a Reddit link to /signup). The guard is
    // `if (req.session.pendingUtm) return;`.
    expect(src).toMatch(/function stashPendingUtm\(req\)/);
    const start = src.indexOf('function stashPendingUtm(req)');
    const end = src.indexOf('\n}', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/req\.session\.pendingUtm/);
    expect(body).toMatch(/if\s*\([^)]*pendingUtm\s*\)\s*return/);
    expect(body).toMatch(/pickUtms\(req\.query/);
  });

  test('defines applyUtmAtSignup — analytics-only UPDATE on users', () => {
    expect(src).toMatch(/async function applyUtmAtSignup\(userId, utm\)/);
    const start = src.indexOf('async function applyUtmAtSignup(userId, utm)');
    const end = src.indexOf('\n}', start + 1);
    const body = src.slice(start, end);
    // Writes ONLY the three UTM columns. Any other column here would
    // break the analytics-only contract and could stomp on billing /
    // quota / referral state.
    expect(body).toMatch(/UPDATE users/);
    expect(body).toMatch(/SET signup_source\s*=\s*\$2/);
    expect(body).toMatch(/signup_campaign\s*=\s*\$3/);
    expect(body).toMatch(/signup_medium\s*=\s*\$4/);
    expect(body).toMatch(/WHERE id\s*=\s*\$1/);
    // No touching of bonus_free_quotes / purchased_quotes / plan /
    // subscription_status / free_quotes_used — anything from the
    // quota + billing surface must never appear here.
    for (const forbidden of [
      'bonus_free_quotes', 'purchased_quotes', 'plan',
      'subscription_status', 'free_quotes_used', 'trial_ends_at',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe('Capture points — four entry points call stashPendingUtm', () => {
  test('GET / (landing) stashes before rendering', () => {
    // Landing → /signup → /login → /auth/login is the primary ad flow.
    // The landing MUST capture because /signup is a static <a href>
    // click on the HTML — the ad's query string is dropped there
    // unless landing captured it into the session first.
    const landing = src.match(
      /app\.get\('\/',\s*\(req, res, next\)[\s\S]*?res\.send\(LANDING_PAGE_HTML\)/,
    );
    expect(landing).not.toBeNull();
    expect(landing[0]).toMatch(/stashPendingUtm\(req\)/);
  });

  test('GET /signup stashes before redirecting to /login', () => {
    // Direct-to-signup ads (fastquote.uk/signup?utm_source=meta) land
    // here. The /login redirect drops the query string so we MUST
    // stash before the redirect fires.
    const signup = src.match(
      /app\.get\('\/signup',[\s\S]*?res\.redirect\(302,\s*`\/login/,
    );
    expect(signup).not.toBeNull();
    expect(signup[0]).toMatch(/stashPendingUtm\(req\)/);
  });

  test('GET /login stashes before redirecting to /auth/login', () => {
    const login = src.match(
      /app\.get\('\/login',[\s\S]*?const refFromUrl = normaliseReferralCode/,
    );
    expect(login).not.toBeNull();
    expect(login[0]).toMatch(/stashPendingUtm\(req\)/);
  });

  test('GET /auth/login stashes as the final backstop', () => {
    // Direct-to-Universal-Login ads
    // (fastquote.uk/auth/login?utm_source=meta) land here. Also the
    // canonical last-chance capture: even if all upstream stashes
    // dropped the value, this one puts it on the session immediately
    // before Auth0's redirect kicks in.
    const auth = src.match(
      /app\.get\('\/auth\/login',[\s\S]*?passport\.authenticate\('auth0'/,
    );
    expect(auth).not.toBeNull();
    expect(auth[0]).toMatch(/stashPendingUtm\(req\)/);
  });
});

describe('Callback — lift pendingUtm BEFORE regenerate, apply AFTER login', () => {
  // The load-bearing detail — session.regenerate() blows the pre-login
  // session away, so we MUST read pendingUtm into a local var before
  // calling regenerate. Exactly the same lift-before-regenerate
  // pattern as pendingReferralCode / rememberDevice (see the same
  // handler for the sibling lifts).
  //
  // Anchor on the callback body — it starts right after the passport
  // authenticate call and runs until the redirect handler.
  const callbackBody = src.match(
    /app\.get\('\/auth\/callback',[\s\S]*?res\.redirect\('\/'\);\s*\}/,
  );

  test('anchor exists', () => {
    expect(callbackBody).not.toBeNull();
  });

  test('lifts req.session.pendingUtm into a local var', () => {
    expect(callbackBody[0]).toMatch(
      /const pendingUtm\s*=\s*req\.session\?\.pendingUtm\s*\|\|\s*null/,
    );
  });

  test('lift happens BEFORE req.session.regenerate()', () => {
    const liftIdx = callbackBody[0].indexOf('const pendingUtm');
    const regenIdx = callbackBody[0].indexOf('req.session.regenerate');
    expect(liftIdx).toBeGreaterThan(-1);
    expect(regenIdx).toBeGreaterThan(-1);
    expect(liftIdx).toBeLessThan(regenIdx);
  });

  test('applies UTMs ONLY when user is new (never overwrites returning users)', () => {
    // Returning users must NEVER have their signup_source overwritten
    // by a later ad click — the whole point of the metric is
    // "attribution at first signup". The `_isNewUser` guard mirrors
    // the same guard used for the referral write on the line above.
    expect(callbackBody[0]).toMatch(
      /if\s*\(pendingUtm\s*&&\s*user\?\._isNewUser\)\s*\{[\s\S]*?applyUtmAtSignup\(user\.id,\s*pendingUtm\)/,
    );
  });

  test('applyUtmAtSignup failure never blocks the login', () => {
    // The referral write does the same — analytics-adjacent writes
    // must not throw or reject their way into a 500 that costs the
    // user the signup they just paid attention to.
    expect(callbackBody[0]).toMatch(
      /applyUtmAtSignup\(user\.id,\s*pendingUtm\)\.catch\(\(\)\s*=>\s*\{\}\)/,
    );
  });

  test('referral write is UNCHANGED (coexistence contract)', () => {
    // Ref governs the bonus-quote reward; UTM governs analytics.
    // A Meta ad viewer who ALSO carries a friend's ?ref= gets both
    // applied. Guarding against a future refactor that accidentally
    // gates one on the other.
    expect(callbackBody[0]).toMatch(
      /if\s*\(pendingRef\s*&&\s*user\?\._isNewUser\)\s*\{[\s\S]*?applyReferralAtSignup\(user\.id,\s*pendingRef\)/,
    );
  });
});

describe('Quota / rewards are untouched (spec constraint)', () => {
  // The spec is emphatic: UTM capture MUST NOT change quota,
  // rewards, or any product behaviour. Confirm the helper's body
  // never touches the quota / referral / billing tables.
  test('applyUtmAtSignup body writes only to users', () => {
    const start = src.indexOf('async function applyUtmAtSignup(userId, utm)');
    const end = src.indexOf('\n}', start + 1);
    const body = src.slice(start, end);
    // Only one UPDATE, on users only.
    const updates = body.match(/UPDATE\s+\w+/gi) || [];
    expect(updates).toEqual(['UPDATE users']);
    // No INSERTs, no DELETEs, no touches on quote-adjacent tables.
    expect(body).not.toMatch(/INSERT INTO/i);
    expect(body).not.toMatch(/DELETE FROM/i);
    for (const tbl of [
      'referrals', 'referral_codes', 'quote_purchases',
      'free_quote_grants', 'events', 'agent_runs',
    ]) {
      expect(body).not.toContain(tbl);
    }
  });
});
