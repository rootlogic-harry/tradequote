/**
 * Server-side referrals wiring (Referrals Phase 1, 2026-06-23).
 *
 * Same pattern as serverQuotaGate.test.js — Jest with no JSX transform
 * can't spin the full Express app, so we lock the contract by reading
 * server.js and asserting the expected pieces exist + are positioned
 * correctly. Live route behaviour is exercised in api.test.js with a
 * real DB (run via `npm run test:api`).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

describe('schema migration', () => {
  test('adds users.bonus_free_quotes with NOT NULL DEFAULT 0', () => {
    expect(serverSrc).toMatch(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_free_quotes INTEGER NOT NULL DEFAULT 0/
    );
  });

  test('creates referral_codes table with UNIQUE on user_id (one code per user)', () => {
    expect(serverSrc).toMatch(/CREATE TABLE IF NOT EXISTS referral_codes/);
    expect(serverSrc).toMatch(/code\s+TEXT PRIMARY KEY/);
    expect(serverSrc).toMatch(/UNIQUE \(user_id\)/);
  });

  test('creates referrals table with UNIQUE on referee_user_id (no double-redemption)', () => {
    expect(serverSrc).toMatch(/CREATE TABLE IF NOT EXISTS referrals/);
    expect(serverSrc).toMatch(/referee_user_id\s+TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE UNIQUE/);
  });

  test('referrals table tracks first_analysis_at + reward_credited_at', () => {
    expect(serverSrc).toMatch(/first_analysis_at\s+TIMESTAMPTZ/);
    expect(serverSrc).toMatch(/reward_credited_at\s+TIMESTAMPTZ/);
  });

  test('indexes both sides of the referrals graph', () => {
    expect(serverSrc).toMatch(/CREATE INDEX IF NOT EXISTS idx_referrals_referrer/);
    expect(serverSrc).toMatch(/CREATE INDEX IF NOT EXISTS idx_referrals_referee/);
  });
});

describe('OAuth — ?ref= capture survives the round-trip', () => {
  test('/auth/google stashes the incoming ref on the session BEFORE Google redirect', () => {
    const start = serverSrc.indexOf("app.get('/auth/google'");
    const next = serverSrc.indexOf("app.get('/auth/google/callback'", start);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/pendingReferralCode/);
    expect(block).toMatch(/req\.query\??\.\??ref/);
  });

  test('/auth/google/callback applies the referral after req.login', () => {
    const start = serverSrc.indexOf("app.get('/auth/google/callback'");
    const next = serverSrc.indexOf('\nasync function', start);
    const block = serverSrc.slice(start, next);
    // The applier must run AFTER req.login (so user.id is stable).
    const loginIdx = block.indexOf('req.login(user');
    const applyIdx = block.indexOf('applyReferralAtSignup');
    expect(loginIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(loginIdx);
  });

  test('callback only applies the referral for genuinely new users', () => {
    const start = serverSrc.indexOf("app.get('/auth/google/callback'");
    const next = serverSrc.indexOf('\nasync function', start);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/user\?\._isNewUser/);
  });
});

describe('applyReferralAtSignup — self-referral + idempotency', () => {
  // Scope to the helper function.
  const start = serverSrc.indexOf('async function applyReferralAtSignup');
  const next = serverSrc.indexOf('\nasync function', start + 1);
  const block = serverSrc.slice(start, next);

  test('uses a transaction (BEGIN / COMMIT / ROLLBACK)', () => {
    expect(block).toMatch(/client\.query\('BEGIN'\)/);
    expect(block).toMatch(/client\.query\('COMMIT'\)/);
    expect(block).toMatch(/client\.query\('ROLLBACK'\)/);
  });

  test('rejects self-referral via validateRedemption (returns reason=self)', () => {
    expect(block).toMatch(/validateRedemption/);
  });

  test('INSERT into referrals uses ON CONFLICT (referee_user_id) DO NOTHING', () => {
    expect(block).toMatch(/INSERT INTO referrals[\s\S]*?ON CONFLICT \(referee_user_id\) DO NOTHING/);
  });

  test('sets bonus_free_quotes to GREATEST(current, REFERRAL_REFEREE_BONUS)', () => {
    expect(block).toMatch(/bonus_free_quotes = GREATEST\(bonus_free_quotes/);
    expect(block).toMatch(/REFERRAL_REFEREE_BONUS/);
  });

  test('client.release() in finally', () => {
    expect(block).toMatch(/finally\s*\{[\s\S]*?client\.release\(\)/);
  });
});

describe('maybeCreditReferrerOnFirstAnalysis — FOR UPDATE + first-only idempotency', () => {
  const start = serverSrc.indexOf('async function maybeCreditReferrerOnFirstAnalysis');
  const next = serverSrc.indexOf('\nasync function', start + 1);
  const block = serverSrc.slice(start, next);

  test('locks the referee row with FOR UPDATE + AND first_analysis_at IS NULL', () => {
    expect(block).toMatch(/FOR UPDATE/);
    expect(block).toMatch(/first_analysis_at IS NULL/);
  });

  test('stamps first_analysis_at + reward_credited_at on the matching referral', () => {
    expect(block).toMatch(/SET first_analysis_at = NOW\(\)/);
    expect(block).toMatch(/reward_credited_at = NOW\(\)/);
  });

  test('increments the referrer\'s bonus_free_quotes (not the referee)', () => {
    expect(block).toMatch(/UPDATE users[\s\S]*?SET bonus_free_quotes = bonus_free_quotes \+/);
    expect(block).toMatch(/REFERRAL_REFERRER_REWARD/);
  });

  test('swallows errors — never throws into the analyse response path', () => {
    // The catch block must log and return, not re-throw.
    expect(block).toMatch(/console\.warn\(['"`]\[Referrals\] credit failed/);
    expect(block).not.toMatch(/throw err/);
  });
});

describe('First-analysis trigger is wired into BOTH analyse routes', () => {
  test('photo /analyse calls maybeCreditReferrerOnFirstAnalysis on success', () => {
    const analyseStart = serverSrc.indexOf("app.post('/api/users/:id/analyse'");
    const analyseEnd = serverSrc.indexOf("// ─", analyseStart + 1);
    const block = serverSrc.slice(analyseStart, analyseEnd);
    expect(block).toMatch(/maybeCreditReferrerOnFirstAnalysis/);
  });

  test('video route calls maybeCreditReferrerOnFirstAnalysis on success', () => {
    const videoStart = serverSrc.indexOf("app.post('/api/users/:id/jobs/:jobId/video'");
    const videoEnd = serverSrc.indexOf("// ─", videoStart + 1);
    const block = serverSrc.slice(videoStart, videoEnd > videoStart ? videoEnd : videoStart + 50000);
    expect(block).toMatch(/maybeCreditReferrerOnFirstAnalysis/);
  });
});

describe('API endpoints', () => {
  test('GET /api/users/:id/referrals exists and returns the user\'s code + balance', () => {
    expect(serverSrc).toMatch(/app\.get\(['"`]\/api\/users\/:id\/referrals['"`]/);
  });

  test('POST /auth/redeem-referral exists and is gated by requireAuth', () => {
    expect(serverSrc).toMatch(
      /app\.post\(['"`]\/auth\/redeem-referral['"`]\s*,\s*requireAuth/
    );
  });

  test('redeem-referral returns the updated billing block', () => {
    const start = serverSrc.indexOf("app.post('/auth/redeem-referral'");
    const next = serverSrc.indexOf("\napp.", start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/billing/);
    expect(block).toMatch(/resolveQuotaState/);
  });
});

describe('Login page — referral field', () => {
  test('login HTML has placeholders for sign-in URL + referral block', () => {
    expect(serverSrc).toMatch(/SIGNIN_HREF/);
    expect(serverSrc).toMatch(/REF_BLOCK_HTML/);
  });

  test('locked-when-URL-has-ref path uses disabled input', () => {
    // The route renders the locked variant when refFromUrl is truthy
    // → input is disabled to prevent the "first-code-vs-last-code" conflict.
    const start = serverSrc.indexOf("app.get('/login'");
    const next = serverSrc.indexOf('\napp.', start + 1);
    const block = serverSrc.slice(start, next);
    expect(block).toMatch(/disabled/);
    expect(block).toMatch(/normaliseReferralCode\(req\.query\.ref\)/);
  });
});

describe('Sanity: no banned vocabulary in user-facing referral copy', () => {
  // Phase 1 banned-vocab list (CLAUDE.md):
  // AI, model, LLM, Claude, prompt, confidence, calibration, accuracy,
  // bias, drift, agent
  //
  // Locked-spec safe vocab for referrals: referral, code, invite,
  // share, earn, bonus, free quote, credit.
  //
  // Scan the user-facing strings in the login route, the GET /referrals
  // payload structure, and the LOGIN_PAGE_HTML for banned tokens. The
  // SQL comments / function names can mention "agent" (e.g. agent_runs)
  // — that's not user-facing — but copy emitted into HTML or JSON
  // responses must stay clean.
  const start = serverSrc.indexOf("LOGIN_PAGE_HTML = `");
  const end = serverSrc.indexOf("`;\n\napp.get('/login'", start);
  const html = serverSrc.slice(start, end);

  test.each([
    /\bAI\b/i, /\bLLM\b/, /\bClaude\b/, /\bSonnet\b/,
    /\bcalibration\b/i, /\baccuracy\b/i, /\bdrift\b/i,
  ])('login HTML does not contain %s', (rx) => {
    expect(html).not.toMatch(rx);
  });
});
