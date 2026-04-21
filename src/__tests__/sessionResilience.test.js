/**
 * Session + bfcache resilience (TRQ-128).
 *
 * Paul saved a quote, then saw "Nothing in My Quotes" immediately after —
 * because `listJobs()` flattened any non-2xx response (including 401) into
 * a silent empty array. Then he hit Safari's forward arrow, got a phantom
 * "logged in" page from bfcache, and ended up at a Google OAuth 400.
 *
 * These tests lock the three fixes:
 *   A. listJobs throws a typed SessionExpiredError on 401, and a generic
 *      Error on other failures. Empty-list responses are only returned
 *      when the server actually returned 200.
 *   B. The app mounts a `pageshow` handler that reloads the window when
 *      the page is restored from bfcache (event.persisted === true). This
 *      kills the phantom-session-after-forward-arrow class of bugs.
 *   C. Server-side catches Passport OAuth errors and bounces the user to
 *      /login?error=oauth_failed instead of stranding them on Google's
 *      400 page. Login page shows a "Try again" button under that query.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

// ─────────────────────────────────────────────────────────────────────────
// A.  listJobs throws on error (no more silent empty-list on 401)
// ─────────────────────────────────────────────────────────────────────────
describe('listJobs — errors surface instead of flattening to []', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.resetModules();
  });

  async function importListJobs() {
    const mod = await import('../utils/userDB.js');
    return mod;
  }

  test('throws SessionExpiredError on 401', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Not authenticated' }),
    }));
    const { listJobs, SessionExpiredError } = await importListJobs();
    await expect(listJobs('paul')).rejects.toBeInstanceOf(SessionExpiredError);
  });

  test('throws a generic Error on 5xx', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    }));
    const { listJobs, SessionExpiredError } = await importListJobs();
    await expect(listJobs('paul')).rejects.toThrow();
    await expect(listJobs('paul')).rejects.not.toBeInstanceOf(SessionExpiredError);
  });

  test('returns the list on 200', async () => {
    const jobs = [{ id: '1', clientName: 'X' }];
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => jobs,
    }));
    const { listJobs } = await importListJobs();
    await expect(listJobs('paul')).resolves.toEqual(jobs);
  });

  test('throws on a network failure (fetch rejection)', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('network down');
    });
    const { listJobs } = await importListJobs();
    await expect(listJobs('paul')).rejects.toThrow();
  });
});

describe('App.jsx — fetchIncompleteJobs handles SessionExpiredError', () => {
  const appSrc = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');

  test('imports SessionExpiredError from userDB', () => {
    expect(appSrc).toMatch(/SessionExpiredError/);
  });

  test('has an explicit branch for session expiry that redirects to /login', () => {
    // If the server says 401, we stop swallowing it as "empty list" and send
    // the user to login with a reason, so they know their session died (they
    // weren't just a fresh user with zero quotes).
    expect(appSrc).toMatch(/SessionExpiredError|session_expired|session[-_]expired/);
    expect(appSrc).toMatch(/\/login\?error=session[-_]expired|\/login\?error=session_expired/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// B.  bfcache reload — no more phantom logged-in state after back/forward
// ─────────────────────────────────────────────────────────────────────────
describe('App.jsx — reloads when restored from bfcache', () => {
  const appSrc = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');

  test('registers a pageshow listener', () => {
    // Safari (and Firefox) fire `pageshow` with `event.persisted === true`
    // when the page is restored from the back-forward cache — meaning the
    // JS state is the same but the network / cookie world is potentially
    // entirely different (session evicted, token rotated, etc).
    expect(appSrc).toMatch(/addEventListener\s*\(\s*['"]pageshow['"]/);
  });

  test('reloads on event.persisted === true', () => {
    expect(appSrc).toMatch(/\.persisted[^A-Za-z0-9]/);
    expect(appSrc).toMatch(/window\.location\.reload\s*\(\s*\)/);
  });

  test('the listener is strict about persisted — does NOT reload on every pageshow', () => {
    // A bug in the first cut of this fix would be reloading on every
    // navigation, which would break same-tab routing. Guard: the reload
    // must be conditional on event.persisted, and the conditional must
    // appear next to the reload call (not half a file away).
    const reloadMatch = appSrc.match(/[\s\S]{0,400}window\.location\.reload\s*\(\s*\)/);
    expect(reloadMatch).not.toBeNull();
    expect(reloadMatch[0]).toMatch(/\.persisted/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// C.  OAuth error handling — Google's 400 never becomes Paul's problem
// ─────────────────────────────────────────────────────────────────────────
describe('OAuth callback — failureRedirect + recovery', () => {
  const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

  test('/auth/google/callback has a failureRedirect to a clean login URL', () => {
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"]\/auth\/google\/callback['"][\s\S]*?failureRedirect:\s*['"]\/login\?error=/
    );
  });

  test('/auth/google/callback has an Express error handler that catches Passport crashes', () => {
    // If Passport throws (e.g., state mismatch, invalid token), the default
    // handler renders a 500 page that leaks internal details and strands
    // the user. We need a 4-arg error middleware so Express recognises it
    // as an error handler and we can redirect to /login?error=oauth_failed.
    const callbackBlock = serverSrc.match(
      /app\.get\(\s*['"]\/auth\/google\/callback['"][\s\S]*?\n\);/
    );
    expect(callbackBlock).not.toBeNull();
    // Either an inline error handler in the route chain, or a
    // dedicated 4-arg middleware.
    const hasInlineErr = /function\s*\([^)]*err[^)]*req[^)]*res[^)]*next[^)]*\)/.test(
      callbackBlock[0]
    );
    const hasNamedHandler = /handleOauthFailure|oauthErrorHandler/.test(callbackBlock[0]);
    expect(hasInlineErr || hasNamedHandler).toBe(true);
  });

  test('login page shows a "try again" CTA when error=oauth_failed or session_expired', () => {
    // Users who land on /login?error=... need to understand what happened
    // and get a one-click path back into the app — not a silent redirect.
    const loginPage = serverSrc.match(/app\.get\(\s*['"]\/login['"][\s\S]*?\n\}\)/);
    expect(loginPage).not.toBeNull();
    expect(loginPage[0]).toMatch(/error/);
    // The page either hard-codes copy for these error kinds or delegates
    // to a helper that does.
    expect(loginPage[0]).toMatch(/oauth_failed|session_expired|Try again/i);
  });
});
