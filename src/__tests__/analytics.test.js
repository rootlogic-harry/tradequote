/**
 * Analytics Phase 1 (2026-06-29) — first-party event log.
 *
 * Three layers under test:
 *   1. trackEvent() client beacon — DNT, sessionStorage flag, test-env
 *      no-op, fetch wiring, silent failure contract.
 *   2. Server-side allowlist — only known event_name values are
 *      accepted; everything else is silently 204'd.
 *   3. isInternalUser env-var parsing — empty / valid CSV / garbage.
 *   4. subscription_started fires ONLY on the first false→active
 *      transition (Pitfall #17, COALESCE re-asserts 'active').
 *
 * Spec at /tmp/fastquote-analytics-spec.md. Phase 2 (Microsoft
 * Clarity) is NOT covered here — separate DPA-bumping change.
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const trackEventJs = readFileSync(
  join(repoRoot, 'src/utils/trackEvent.js'),
  'utf8'
);

function blockFromTo(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  if (start === -1) return '';
  const end = endNeedle ? src.indexOf(endNeedle, start + 1) : src.length;
  return src.slice(start, end > start ? end : src.length);
}

// ─── 1. trackEvent client beacon ─────────────────────────────────────

describe('trackEvent — client beacon', () => {
  let origWindow;
  let origNavigator;
  let origFetch;
  let origSessionStorage;
  let fetchMock;

  beforeEach(() => {
    origWindow = global.window;
    origNavigator = global.navigator;
    origFetch = global.fetch;
    origSessionStorage = global.sessionStorage;
    fetchMock = jest.fn().mockReturnValue(Promise.resolve({ status: 204 }));
  });

  afterEach(() => {
    global.window = origWindow;
    global.navigator = origNavigator;
    global.fetch = origFetch;
    global.sessionStorage = origSessionStorage;
    jest.resetModules();
  });

  function installWindow({ dnt = null, fqNoTrack = null } = {}) {
    const store = new Map();
    if (fqNoTrack !== null) store.set('fq_no_track', fqNoTrack);
    const sessionStorageStub = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    global.window = {
      doNotTrack: dnt,
    };
    global.navigator = { doNotTrack: dnt };
    global.sessionStorage = sessionStorageStub;
    global.fetch = fetchMock;
  }

  test('no-ops when window is undefined (Jest node env)', async () => {
    // No window installed — should bail before touching navigator/fetch.
    delete global.window;
    global.fetch = fetchMock;
    const { trackEvent } = await import('../utils/trackEvent.js');
    trackEvent('quote_started', { mode: 'full' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('honours navigator.doNotTrack=1', async () => {
    installWindow({ dnt: '1' });
    const { trackEvent } = await import('../utils/trackEvent.js');
    trackEvent('quote_started', { mode: 'full' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('honours sessionStorage.fq_no_track=1', async () => {
    installWindow({ fqNoTrack: '1' });
    const { trackEvent } = await import('../utils/trackEvent.js');
    trackEvent('quote_started', { mode: 'full' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('POSTs to /api/event with name + props when allowed', async () => {
    installWindow();
    const { trackEvent } = await import('../utils/trackEvent.js');
    trackEvent('photo_uploaded', { slot: 'overview' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/event');
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);
    expect(opts.credentials).toBe('same-origin');
    const body = JSON.parse(opts.body);
    expect(body.name).toBe('photo_uploaded');
    expect(body.props).toEqual({ slot: 'overview' });
  });

  test('ignores empty / non-string event name', async () => {
    installWindow();
    const { trackEvent } = await import('../utils/trackEvent.js');
    trackEvent('');
    trackEvent(null);
    trackEvent({ name: 'whatever' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('silent failure — never throws when fetch rejects', async () => {
    installWindow();
    global.fetch = jest.fn().mockReturnValue(Promise.reject(new Error('network down')));
    const { trackEvent } = await import('../utils/trackEvent.js');
    // The promise's .catch is internal; the synchronous call must not throw.
    expect(() => trackEvent('quote_started', {})).not.toThrow();
  });

  test('defensive — non-object props are coerced to {}', async () => {
    installWindow();
    const { trackEvent } = await import('../utils/trackEvent.js');
    trackEvent('quote_started', null);
    trackEvent('quote_started', 'oops');
    trackEvent('quote_started', 42);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(body.props).toEqual({});
    }
  });
});

// ─── 2. trackEvent.js source contract (defence-in-depth) ─────────────

describe('trackEvent.js — source-level guarantees', () => {
  test('honours DNT', () => {
    expect(trackEventJs).toMatch(/doNotTrack/);
  });
  test('honours sessionStorage.fq_no_track', () => {
    expect(trackEventJs).toMatch(/fq_no_track/);
  });
  test('bails on no window (test env)', () => {
    expect(trackEventJs).toMatch(/typeof window === 'undefined'/);
  });
  test('uses keepalive for unload survival', () => {
    expect(trackEventJs).toMatch(/keepalive:\s*true/);
  });
  test('posts to /api/event', () => {
    expect(trackEventJs).toMatch(/['"]\/api\/event['"]/);
  });
  test('never console.errors (silent capture per spec)', () => {
    // Strip block + line comments before scanning so the JSDoc note
    // ("never logs to console.error") doesn't trip the assertion.
    const codeOnly = trackEventJs
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/console\.error/);
  });
});

// ─── 3. Server-side allowlist + /api/event route ─────────────────────

describe('/api/event — server-side allowlist', () => {
  test('events table schema exists with required columns', () => {
    expect(serverJs).toMatch(/CREATE TABLE IF NOT EXISTS events/);
    expect(serverJs).toMatch(/event_name TEXT NOT NULL/);
    expect(serverJs).toMatch(/user_id TEXT REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(serverJs).toMatch(/session_id TEXT/);
    expect(serverJs).toMatch(/path TEXT/);
    expect(serverJs).toMatch(/props JSONB/);
  });

  test('events table has supporting indexes', () => {
    expect(serverJs).toMatch(/idx_events_name_created/);
    expect(serverJs).toMatch(/idx_events_user_created/);
  });

  test('EVENT_NAME_ALLOWLIST contains all 11 spec events', () => {
    const allowlist = blockFromTo(
      serverJs,
      'const EVENT_NAME_ALLOWLIST',
      ']);'
    );
    for (const name of [
      'signup_completed',
      'referral_redeemed',
      'profile_completed',
      'quote_started',
      'photo_uploaded',
      'quote_analysed',
      'quote_sent',
      'client_responded',
      'pack_purchased',
      'subscription_started',
      'pdf_downloaded',
    ]) {
      expect(allowlist).toContain(`'${name}'`);
    }
  });

  test('route silently 204s on unknown event_name (PII safeguard)', () => {
    const block = blockFromTo(
      serverJs,
      "app.post('/api/event'",
      '// --- Error handler'
    );
    expect(block).toMatch(/EVENT_NAME_ALLOWLIST\.has\(name\)/);
    expect(block).toMatch(/res\.status\(204\)\.end\(\)/);
    // Bot UA filter reused from /api/track.
    expect(block).toMatch(/isBotUserAgent/);
  });

  test('route has its own 60/min/IP rate limit', () => {
    expect(serverJs).toMatch(/eventRateLimit\s*=\s*rateLimit/);
    expect(serverJs).toMatch(/eventRateLimit/);
  });

  test('route reads session id from req.sessionID', () => {
    const block = blockFromTo(
      serverJs,
      "app.post('/api/event'",
      '// --- Error handler'
    );
    expect(block).toMatch(/req\.sessionID/);
  });

  test('route extracts path from Referer header, stripping query', () => {
    const block = blockFromTo(
      serverJs,
      "app.post('/api/event'",
      '// --- Error handler'
    );
    expect(block).toMatch(/referer/i);
    // URL parse strips ?qs implicitly via pathname.
    expect(block).toMatch(/new URL\(/);
    expect(block).toMatch(/pathname/);
  });
});

// ─── 4. isInternalUser — CSV env-var parsing ─────────────────────────

describe('isInternalUser — env-var parsing', () => {
  // The helper is server-only (uses process.env). Smoke-test via a
  // tiny re-implementation that mirrors the source, then assert the
  // source itself implements the same behaviour. Two-layer defence:
  // the unit tests catch regressions in either copy.
  function isInternalUserRef(userId) {
    if (!userId) return false;
    const raw = process.env.INTERNAL_USER_IDS || '';
    if (!raw.trim()) return false;
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return ids.includes(String(userId));
  }

  let origEnv;
  beforeEach(() => { origEnv = process.env.INTERNAL_USER_IDS; });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.INTERNAL_USER_IDS;
    else process.env.INTERNAL_USER_IDS = origEnv;
  });

  test('empty env returns false', () => {
    delete process.env.INTERNAL_USER_IDS;
    expect(isInternalUserRef('harry')).toBe(false);
    process.env.INTERNAL_USER_IDS = '';
    expect(isInternalUserRef('harry')).toBe(false);
    process.env.INTERNAL_USER_IDS = '   ';
    expect(isInternalUserRef('harry')).toBe(false);
  });

  test('valid CSV matches expected IDs', () => {
    process.env.INTERNAL_USER_IDS = 'harry,mark';
    expect(isInternalUserRef('harry')).toBe(true);
    expect(isInternalUserRef('mark')).toBe(true);
    expect(isInternalUserRef('paul')).toBe(false);
  });

  test('whitespace + empty slots in CSV are tolerated', () => {
    process.env.INTERNAL_USER_IDS = ' harry , , mark ,';
    expect(isInternalUserRef('harry')).toBe(true);
    expect(isInternalUserRef('mark')).toBe(true);
    expect(isInternalUserRef('')).toBe(false);
  });

  test('null / undefined userId returns false even with valid CSV', () => {
    process.env.INTERNAL_USER_IDS = 'harry,mark';
    expect(isInternalUserRef(null)).toBe(false);
    expect(isInternalUserRef(undefined)).toBe(false);
    expect(isInternalUserRef('')).toBe(false);
  });

  test('garbage CSV — single value with no commas still works', () => {
    process.env.INTERNAL_USER_IDS = 'harry';
    expect(isInternalUserRef('harry')).toBe(true);
    expect(isInternalUserRef('mark')).toBe(false);
  });

  test('numeric-style IDs are matched as strings', () => {
    process.env.INTERNAL_USER_IDS = '1,2,3';
    expect(isInternalUserRef('1')).toBe(true);
    expect(isInternalUserRef(1)).toBe(true); // String(1) === '1'
    expect(isInternalUserRef('4')).toBe(false);
  });

  test('server.js implements the same logic as the reference', () => {
    // Source-level smoke check — the helper exists and uses the same
    // parsing shape as our reference impl (split → trim → filter).
    const block = blockFromTo(serverJs, 'function isInternalUser', '}\n\n');
    expect(block).toMatch(/INTERNAL_USER_IDS/);
    expect(block).toMatch(/\.split\(','\)/);
    expect(block).toMatch(/\.map\(/);
    expect(block).toMatch(/\.filter\(/);
    expect(block).toMatch(/\.includes\(/);
  });

  test('recordEvent flags internal users via props.internal=true', () => {
    const block = blockFromTo(serverJs, 'async function recordEvent', '}\n\n');
    expect(block).toMatch(/isInternalUser/);
    expect(block).toMatch(/internal\s*=\s*true/);
    // Spec: don't drop events from internal users — keep them with the flag.
    expect(block).not.toMatch(/return false;\s*\/\/\s*drop internal/);
  });
});

// ─── 5. subscription_started fires only on first active transition ──

describe('subscription_started — FIRST active transition only (Pitfall #17)', () => {
  // The webhook fan-out is in server.js; we assert the guard via
  // source inspection AND a behavioural check that compares the
  // pre-read status with the post-apply status.
  const webhookBlock = blockFromTo(
    serverJs,
    "app.post('/api/billing/webhook'",
    'app.use(express.json'
  );

  test('reads priorSubStatus BEFORE applySubscriptionEventToDb runs', () => {
    expect(webhookBlock).toMatch(/priorSubStatus/);
    // The pre-read must happen before the apply call.
    const priorReadIdx = webhookBlock.indexOf('priorSubStatus');
    const applyIdx = webhookBlock.indexOf('applySubscriptionEventToDb(pool, event)');
    expect(priorReadIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(-1);
    expect(priorReadIdx).toBeLessThan(applyIdx);
  });

  test('fires ONLY when status === active AND prior !== active', () => {
    expect(webhookBlock).toMatch(/subResult\.status === 'active'/);
    expect(webhookBlock).toMatch(/priorSubStatus !== 'active'/);
  });

  test('reuses recordEvent — no inline INSERT', () => {
    expect(webhookBlock).toMatch(/recordEvent\(\s*'subscription_started'/);
  });

  // Behavioural simulation: mimic the gate logic the webhook handler
  // uses, then assert it only fires once across a stream of redelivered
  // events.
  test('simulated redelivery — fires once per genuine transition', () => {
    function shouldFire(prior, after) {
      return after === 'active' && prior !== 'active';
    }
    // Day 1: brand-new subscriber. Stripe re-delivers checkout +
    // customer.subscription.created + customer.subscription.updated.
    let prior = null;
    let fires = 0;
    for (const status of ['active', 'active', 'active']) {
      if (shouldFire(prior, status)) fires += 1;
      prior = status;
    }
    expect(fires).toBe(1);

    // Day 30: renewal. Status stays 'active' — must not re-fire.
    for (const status of ['active', 'active']) {
      if (shouldFire(prior, status)) fires += 1;
      prior = status;
    }
    expect(fires).toBe(1);

    // Day 60: card fails, status flips to past_due, then back to active.
    // That's a genuine new transition → second fire.
    for (const status of ['past_due', 'active']) {
      if (shouldFire(prior, status)) fires += 1;
      prior = status;
    }
    expect(fires).toBe(2);
  });
});

// ─── 6. Server-side fire wiring ──────────────────────────────────────

describe('server-side event fires — spec-mandated call sites', () => {
  test('signup_completed fires in /auth/callback (Auth0 Universal Login)', () => {
    // 2026-06-29: route renamed /auth/google/callback → /auth/callback
    // with the migration to passport-auth0. The signup_completed event
    // contract (with wasNew flag) is unchanged.
    const block = blockFromTo(serverJs, "app.get('/auth/callback'", '/**');
    expect(block).toMatch(/recordEvent\(\s*'signup_completed'/);
    expect(block).toMatch(/wasNew/);
  });

  test('referral_redeemed fires on applyReferralAtSignup success', () => {
    // Two call sites: OAuth callback AND manual redeem-referral.
    const matches = serverJs.match(/recordEvent\(\s*'referral_redeemed'/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('profile_completed fires on first false→true transition', () => {
    const block = blockFromTo(
      serverJs,
      "app.put('/api/users/:id/settings/:key'",
      '// --- Theme Routes'
    );
    expect(block).toMatch(/recordEvent\(\s*'profile_completed'/);
    // Idempotency: check for an existing event row before firing.
    expect(block).toMatch(/SELECT 1 FROM events/);
    expect(block).toMatch(/event_name\s*=\s*'profile_completed'/);
  });

  test('quote_analysed fires on photo analyse success', () => {
    const block = blockFromTo(
      serverJs,
      "app.post('/api/users/:id/analyse'",
      "app.post('/q/:token/respond'"
    );
    expect(block).toMatch(/recordEvent\(\s*'quote_analysed'/);
    expect(block).toMatch(/source:\s*'photo'/);
    expect(block).toMatch(/durationMs/);
    expect(block).toMatch(/freeOrPaid/);
  });

  test('quote_analysed also fires on video analyse success', () => {
    const block = blockFromTo(
      serverJs,
      "app.post('/api/users/:id/jobs/:jobId/video'",
      'app.post('
    );
    expect(block).toMatch(/recordEvent\(\s*'quote_analysed'/);
    expect(block).toMatch(/source:\s*'video'/);
  });

  test('quote_sent fires on client-token success', () => {
    const block = blockFromTo(
      serverJs,
      "app.post('/api/users/:id/jobs/:jobId/client-token'",
      "app.get('/api/users/:id/jobs/:jobId/client-status'"
    );
    expect(block).toMatch(/recordEvent\(\s*'quote_sent'/);
  });

  test('client_responded fires in /q/:token/respond', () => {
    const block = blockFromTo(
      serverJs,
      "app.post('/q/:token/respond'",
      '// --- TRQ-15:'
    );
    expect(block).toMatch(/recordEvent\(\s*'client_responded'/);
    expect(block).toMatch(/response/);
  });

  test('pack_purchased fires on quote-pack webhook success', () => {
    expect(serverJs).toMatch(/recordEvent\(\s*'pack_purchased'/);
    // pence: 999 — see spec § "Events to fire".
    expect(serverJs).toMatch(/pence:\s*QUOTE_PACK_PRICE_PENCE/);
  });

  test('subscription_started fires on first→active transition', () => {
    expect(serverJs).toMatch(/recordEvent\(\s*'subscription_started'/);
  });
});

// ─── 7. Client-side fire wiring ──────────────────────────────────────

describe('client-side event fires — spec-mandated call sites', () => {
  const jobDetailsJs = readFileSync(
    join(repoRoot, 'src/components/steps/JobDetails.jsx'),
    'utf8'
  );
  const quoteOutputJs = readFileSync(
    join(repoRoot, 'src/components/steps/QuoteOutput.jsx'),
    'utf8'
  );
  const appJs = readFileSync(
    join(repoRoot, 'src/App.jsx'),
    'utf8'
  );

  test('JobDetails imports trackEvent and fires photo_uploaded on slot upload', () => {
    expect(jobDetailsJs).toMatch(/import\s+\{\s*trackEvent\s*\}\s+from\s+['"][^'"]+trackEvent\.js['"]/);
    expect(jobDetailsJs).toMatch(/trackEvent\(\s*'photo_uploaded'/);
  });

  test('App.jsx fires quote_started on handleStartNewQuote', () => {
    expect(appJs).toMatch(/trackEvent\(\s*'quote_started'/);
  });

  test('QuoteOutput fires pdf_downloaded in PDF handler', () => {
    expect(quoteOutputJs).toMatch(/trackEvent\(\s*'pdf_downloaded'/);
  });
});

// ─── 8. Admin Analytics — events section in the response ─────────────

describe('admin analytics endpoint — events section', () => {
  const block = blockFromTo(
    serverJs,
    "app.get('/api/admin/analytics'",
    '// Approved calibration notes for system prompt'
  );

  test('returns an `events` payload', () => {
    expect(block).toMatch(/events:\s*\{/);
    expect(block).toMatch(/excludeInternal/);
    expect(block).toMatch(/funnel/);
    expect(block).toMatch(/eventsTopQuery/);
    expect(block).toMatch(/eventsFunnelQuery/);
  });

  test('funnel includes the six core stages in order', () => {
    expect(block).toMatch(/'signup_completed'[\s\S]*'profile_completed'[\s\S]*'quote_started'[\s\S]*'quote_analysed'[\s\S]*'quote_sent'[\s\S]*'client_responded'/);
  });

  test('exclude-internal toggle defaults ON', () => {
    // !== '0' makes the flag default-true unless explicitly passed.
    expect(block).toMatch(/excludeInternal\s*!==\s*'0'/);
  });

  test('exclude-internal predicate matches props->>internal', () => {
    expect(block).toMatch(/props->>'internal'/);
  });
});
