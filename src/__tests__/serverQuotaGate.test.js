/**
 * Server-side quota gate wiring (2026-06-22).
 *
 * Source-level guards on server.js for the new quota model. Follows
 * the same pattern as analyseInstrumentation.test.js — Jest's
 * `transform: {}` config can't spin up the full Express app inside
 * a unit suite, so we lock the contract by asserting the relevant
 * pieces of source actually exist. The live behaviour is exercised
 * in `src/__tests__/api.test.js` against a real DB (run separately
 * via `npm run test:api`).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

// Find the analyse route body once — assertions below all live
// inside it. Without this scope the regexes would risk matching
// against unrelated routes that happen to mention "quota" / 402.
const analyseStart = serverSrc.indexOf("app.post('/api/users/:id/analyse'");
const analyseEnd = serverSrc.indexOf("// ─", analyseStart + 1);
const analyseBlock = serverSrc.slice(analyseStart, analyseEnd);

describe('schema migration (additive, IF NOT EXISTS)', () => {
  test('adds users.free_quotes_used with default 0', () => {
    expect(serverSrc).toMatch(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS free_quotes_used INTEGER NOT NULL DEFAULT 0/
    );
  });

  test('adds users.comp_until TIMESTAMPTZ (nullable)', () => {
    expect(serverSrc).toMatch(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS comp_until TIMESTAMPTZ/
    );
  });

  test('creates free_quote_grants tracking table (NOT a moat table)', () => {
    // Dedicated table so we don't pollute agent_runs (which IS on the
    // do-not-touch list). The PK on (user_id, quote_token) is what
    // makes the INSERT ... ON CONFLICT DO NOTHING dedupe work.
    expect(serverSrc).toMatch(/CREATE TABLE IF NOT EXISTS free_quote_grants/);
    expect(serverSrc).toMatch(/PRIMARY KEY \(user_id, quote_token\)/);
    expect(serverSrc).toMatch(
      /user_id\s+TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/
    );
  });
});

describe('/analyse route — gate before doing any Anthropic work', () => {
  test('imports quotaGate / FREE_QUOTES_LIMIT from the shared utility', () => {
    expect(serverSrc).toMatch(
      /import\s*\{[\s\S]*?quotaGate[\s\S]*?FREE_QUOTES_LIMIT[\s\S]*?\}\s*from\s*['"]\.\/src\/utils\/quotaGate\.js['"]/
    );
  });

  test('loads the user row before the gate decision', () => {
    expect(analyseBlock).toMatch(
      /SELECT[\s\S]*?free_quotes_used[\s\S]*?comp_until[\s\S]*?subscription_status[\s\S]*?FROM users WHERE id = \$1/
    );
  });

  test('determines hasActiveSubscription from subscription_status', () => {
    expect(analyseBlock).toMatch(/subscription_status === ['"]active['"]/);
  });

  test('calls quotaGate before kicking off Anthropic', () => {
    // Order matters — gate decision MUST happen before callAnthropicRaw
    // or augmentedPrompt assembly. Cheapest way to pin: gate appears
    // before the augmented-prompt block in the source.
    const gateIdx = analyseBlock.indexOf('quotaGate(');
    const augmentedIdx = analyseBlock.indexOf('augmentedPrompt');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(augmentedIdx).toBeGreaterThan(gateIdx);
  });

  test('returns 402 with quota_exhausted body on denial', () => {
    expect(analyseBlock).toMatch(/res\.status\(402\)/);
    expect(analyseBlock).toMatch(/error:\s*['"]quota_exhausted['"]/);
    expect(analyseBlock).toMatch(/freeQuotesUsed/);
    expect(analyseBlock).toMatch(/freeQuotesLimit/);
  });

  test('402 body uses the effective limit (referrals Phase 1 — dynamic, not hardcoded)', () => {
    // Referrals Phase 1 (2026-06-23) made the lockout copy dynamic.
    // The template is `You've used your ${effectiveLimit} free quotes`
    // where effectiveLimit = FREE_QUOTES_LIMIT + bonus_free_quotes.
    // Referred users see "5", cold signups see "3". Pin the template +
    // the source of the interpolated value.
    expect(analyseBlock).toMatch(
      /You've used your \$\{effectiveLimit\} free quotes\. Subscribe to continue\./
    );
    expect(analyseBlock).toMatch(/const effectiveLimit = FREE_QUOTES_LIMIT \+ bonus/);
  });
});

describe('/analyse route — quota accounting on success', () => {
  test('increments free_quotes_used only on successful analysis', () => {
    // The INSERT happens inside the success try-block AFTER res.json
    // — not in the parse-failure early return, not in the catch
    // block. Pin by checking the increment SQL appears between
    // `res.json(` and the agent_runs success update.
    const successJsonIdx = analyseBlock.indexOf('res.json({');
    const incrementIdx = analyseBlock.indexOf('free_quotes_used = free_quotes_used + 1');
    expect(successJsonIdx).toBeGreaterThan(-1);
    expect(incrementIdx).toBeGreaterThan(successJsonIdx);
  });

  test('uses ON CONFLICT DO NOTHING for per-quote-token dedupe', () => {
    expect(analyseBlock).toMatch(
      /INSERT INTO free_quote_grants[\s\S]*?ON CONFLICT \(user_id, quote_token\) DO NOTHING/
    );
  });

  test('skips increment for subscribed users', () => {
    expect(analyseBlock).toMatch(/if \(!hasActiveSubscription\)/);
  });

  test('increment is best-effort — catches DB errors so they can\'t break the user response', () => {
    expect(analyseBlock).toMatch(
      /free_quotes_used = free_quotes_used \+ 1[\s\S]*?\.catch\(/
    );
  });

  test('accepts a quoteToken from the client request body', () => {
    expect(analyseBlock).toMatch(/req\.body\.quoteToken/);
  });

  test('falls back to a synthesised token when client doesn\'t send one (back-compat)', () => {
    // Older client builds (pre-2026-06-22) don't know about
    // quoteToken. Server still accepts them — they just count one
    // free quote per analyse call.
    expect(analyseBlock).toMatch(/legacy-\$\{crypto\.randomUUID\(\)\}/);
  });

  test('increment does NOT fire on error path (failed analyses do not count)', () => {
    // After the analyseBlock's OUTER `} catch (err) {` (the route-
    // wide one — last in the source — that handles Anthropic
    // failures and DB write errors), the only quota-related code
    // is... nothing. The failure handler updates agent_runs but
    // never touches free_quotes_used.
    const outerCatchIdx = analyseBlock.lastIndexOf('} catch (err) {');
    const tail = analyseBlock.slice(outerCatchIdx);
    expect(tail).not.toMatch(/free_quotes_used = free_quotes_used \+ 1/);
  });
});

describe('/auth/me extension', () => {
  // Scope to the /auth/me route block.
  const meStart = serverSrc.indexOf("app.get('/auth/me'");
  const meEnd = serverSrc.indexOf('app.post(', meStart);
  const meBlock = serverSrc.slice(meStart, meEnd);

  test('includes a billing field in the Google-OAuth response', () => {
    expect(meBlock).toMatch(/billing,/);
  });

  test('calls resolveQuotaState to build the billing block', () => {
    expect(meBlock).toMatch(/resolveQuotaState\(/);
  });

  test('legacy switcher session also returns a billing field', () => {
    // The legacy session branch must NOT silently drop billing —
    // Mark (admin) and Harry connect via that path in dev.
    const legacyChunk = meBlock.slice(meBlock.indexOf('legacyUserId'));
    expect(legacyChunk).toMatch(/billing/);
  });
});

describe('/api/billing/status — quota fields', () => {
  const statusStart = serverSrc.indexOf("app.get('/api/billing/status'");
  const statusEnd = serverSrc.indexOf("app.post('/api/billing/checkout'", statusStart);
  const statusBlock = serverSrc.slice(statusStart, statusEnd);

  test('selects free_quotes_used + comp_until from users', () => {
    expect(statusBlock).toMatch(/free_quotes_used/);
    expect(statusBlock).toMatch(/comp_until/);
  });

  test('emits quotaState in the response body', () => {
    expect(statusBlock).toMatch(/quotaState/);
    expect(statusBlock).toMatch(/freeQuotesUsed/);
    expect(statusBlock).toMatch(/freeQuotesLimit/);
  });
});

describe('Video route also gates on quota (consistent with photo path)', () => {
  const videoStart = serverSrc.indexOf("app.post('/api/users/:id/jobs/:jobId/video'");
  const videoEnd = serverSrc.indexOf("// ─", videoStart + 1);
  const videoBlock = serverSrc.slice(videoStart, videoEnd > videoStart ? videoEnd : videoStart + 50000);

  test('calls quotaGate before any ffmpeg / Whisper work', () => {
    expect(videoBlock).toMatch(/quotaGate\(/);
  });

  test('returns 402 quota_exhausted on denial', () => {
    expect(videoBlock).toMatch(/res\.status\(402\)/);
    expect(videoBlock).toMatch(/quota_exhausted/);
  });

  test('cleans up uploaded files on quota denial (no temp-disk leak)', () => {
    // We've already taken the upload to disk by the time we get the
    // quota lookup back. Verify the unlink fires on the denial path.
    const quotaSection = videoBlock.slice(
      videoBlock.indexOf('quotaGate(')
    );
    expect(quotaSection).toMatch(/fs\.unlinkSync\(videoFile\.path\)/);
  });

  test('increments free_quotes_used using job:${jobId} as the stable token', () => {
    expect(videoBlock).toMatch(/`job:\$\{jobId\}`/);
    expect(videoBlock).toMatch(/free_quotes_used = free_quotes_used \+ 1/);
  });
});
