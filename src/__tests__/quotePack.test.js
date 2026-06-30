/**
 * Pay-as-you-go quote pack (2026-06-24).
 *
 * Three layers:
 *   1. billing.js — applyQuotePackEventToDb (mock pool, asserts the
 *      transactional CTE-style write + idempotency on UNIQUE
 *      stripe_payment_id).
 *   2. server.js wiring — schema additions, webhook fan-out,
 *      buy-quote-pack route, consume-on-success branches for paid
 *      quotes, dedupe key reuse, /auth/me + /api/billing/status
 *      surface purchased_quotes.
 *   3. QuotaCounter / JobDetails wiring for the video path's
 *      onAnalysisSuccess callback (closes the PR #58 gap).
 *
 * Live Stripe Checkout creation is NOT exercised here (no live key in
 * the test runner). The Harry pre-launch dry-run covers that.
 */
import { jest, describe, test, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  QUOTE_PACK_PRICE_PENCE,
  QUOTE_PACK_SIZE,
  QUOTE_PACK_DESCRIPTION,
  applyQuotePackEventToDb,
  applySubscriptionEventToDb,
} from '../../billing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const billingJs = readFileSync(join(repoRoot, 'billing.js'), 'utf8');
const jobDetailsJs = readFileSync(
  join(repoRoot, 'src/components/steps/JobDetails.jsx'),
  'utf8'
);

// Scope helper — for source-level assertions inside specific routes.
function blockFromTo(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  if (start === -1) return '';
  const end = endNeedle ? src.indexOf(endNeedle, start + 1) : src.length;
  return src.slice(start, end > start ? end : src.length);
}

describe('quote pack — pricing constants (load-bearing)', () => {
  test('£9.99 in pence — integer maths', () => {
    expect(QUOTE_PACK_PRICE_PENCE).toBe(999);
  });
  test('pack size is 5 (locked spec)', () => {
    expect(QUOTE_PACK_SIZE).toBe(5);
  });
  test('description string used in Checkout receipt', () => {
    expect(QUOTE_PACK_DESCRIPTION).toBe('5 quote pack');
  });
});

describe('applyQuotePackEventToDb — webhook handler', () => {
  function mockPool({ rows = [{ id: 'updated_user' }] } = {}) {
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        if (/^BEGIN|^COMMIT|^ROLLBACK/.test(sql)) return { rows: [] };
        return { rows };
      }),
      release: jest.fn(),
    };
    return {
      calls,
      client,
      connect: jest.fn(async () => client),
    };
  }

  test('checkout.session.completed (mode=payment, quote_pack) credits pack', async () => {
    const pool = mockPool();
    const result = await applyQuotePackEventToDb(pool, {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          client_reference_id: 'user_abc',
          payment_intent: 'pi_123',
          amount_total: 999,
          metadata: { fastquote_user_id: 'user_abc', fastquote_product: 'quote_pack' },
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(result.userId).toBe('user_abc');
    expect(result.credited).toBe(5);
    expect(result.stripePaymentId).toBe('pi_123');
    // Transaction shape: BEGIN, CTE write, COMMIT, release.
    expect(pool.client.query.mock.calls[0][0]).toMatch(/BEGIN/);
    expect(pool.client.query.mock.calls[1][0]).toMatch(/INSERT INTO quote_purchases/);
    expect(pool.client.query.mock.calls[1][0]).toMatch(/ON CONFLICT \(stripe_payment_id\) DO NOTHING/);
    expect(pool.client.query.mock.calls[1][0]).toMatch(/UPDATE users[\s\S]*purchased_quotes = purchased_quotes \+ \$3/);
    expect(pool.client.query.mock.calls[2][0]).toMatch(/COMMIT/);
    expect(pool.client.release).toHaveBeenCalled();
    // Params: [userId, stripePaymentId, QUOTE_PACK_SIZE, amount, hostedInvoiceUrl]
    // The 5th param (hostedInvoiceUrl) was added 2026-06-30 (launch
    // checklist: per-purchase invoices). It's null in tests because no
    // Stripe key is configured; the helper is best-effort.
    expect(pool.client.query.mock.calls[1][1]).toEqual(['user_abc', 'pi_123', 5, 999, null]);
  });

  test('payment_intent.succeeded (quote_pack) credits pack', async () => {
    const pool = mockPool();
    const result = await applyQuotePackEventToDb(pool, {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_456',
          amount_received: 999,
          metadata: { fastquote_user_id: 'user_xyz', fastquote_product: 'quote_pack' },
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(result.userId).toBe('user_xyz');
    expect(result.credited).toBe(5);
    expect(result.stripePaymentId).toBe('pi_456');
  });

  test('idempotent on double-fire: ON CONFLICT DO NOTHING returns 0 credited the second time', async () => {
    // Second call returns empty rows (UPDATE matched no row because the
    // CTE's `inserted` was empty due to ON CONFLICT).
    const pool = mockPool({ rows: [] });
    const result = await applyQuotePackEventToDb(pool, {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_dup',
          amount_received: 999,
          metadata: { fastquote_user_id: 'user_xyz', fastquote_product: 'quote_pack' },
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(result.credited).toBe(0);
  });

  test('subscription-mode checkout.session.completed is ignored (no quote_pack credit)', async () => {
    const pool = mockPool();
    const result = await applyQuotePackEventToDb(pool, {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          client_reference_id: 'user_abc',
          subscription: 'sub_xyz',
          metadata: {},
        },
      },
    });
    expect(result.applied).toBe(false);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('payment_intent.succeeded without quote_pack metadata is ignored', async () => {
    const pool = mockPool();
    const result = await applyQuotePackEventToDb(pool, {
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_other', metadata: {} } },
    });
    expect(result.applied).toBe(false);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('missing fastquote_user_id → skipped (no 500, no write)', async () => {
    const pool = mockPool();
    const result = await applyQuotePackEventToDb(pool, {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_orphan',
          metadata: { fastquote_product: 'quote_pack' },
        },
      },
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/no fastquote_user_id/);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('missing stripe payment id → skipped', async () => {
    const pool = mockPool();
    const result = await applyQuotePackEventToDb(pool, {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          metadata: { fastquote_user_id: 'u', fastquote_product: 'quote_pack' },
        },
      },
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/no stripe payment id/);
  });

  test('unhandled event type passes through silently', async () => {
    const pool = mockPool();
    const result = await applyQuotePackEventToDb(pool, {
      type: 'customer.subscription.updated',
      data: { object: {} },
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/unhandled event type/);
  });
});

// CRITICAL bug surfaced 2026-06-25: Harry bought a £9.99 quote pack
// live and his subscription_status got flipped to 'active' (counter
// showed "Unlimited" instead of "5 quotes left"). Root cause:
// applySubscriptionEventToDb on a checkout.session.completed event
// unconditionally wrote 'active' via `COALESCE($3, ...)` where $3 was
// the literal string 'active' — the COALESCE was protecting customer/
// subscription IDs (null in payment mode) but NOT the status itself.
// These tests pin the fix: payment-mode sessions are SKIPPED entirely
// by the subscription handler.
describe('applySubscriptionEventToDb — payment-mode safety guard', () => {
  function mockPool() {
    return { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
  }

  test('payment-mode checkout.session.completed does NOT write subscription_status', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          client_reference_id: 'harrydoyle_lhoe',
          customer: 'cus_xxx',
          subscription: null,  // payment-mode sessions have no subscription
          metadata: { fastquote_product: 'quote_pack' },
        },
      },
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/mode=payment/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('subscription-mode checkout.session.completed DOES write subscription_status', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          client_reference_id: 'user_real_sub',
          customer: 'cus_yyy',
          subscription: 'sub_yyy',
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(result.status).toBe('active');
    expect(pool.query).toHaveBeenCalledTimes(1);
    // The actual UPDATE includes the 'active' literal — verify it's in the call
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/UPDATE users[\s\S]*subscription_status/);
    expect(params).toContain('active');
  });

  test('missing session.mode (defensive) is treated as not-subscription and skipped', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'checkout.session.completed',
      data: {
        object: {
          // mode field missing — should be skipped, not promoted
          client_reference_id: 'user_xxx',
          customer: 'cus_xxx',
          subscription: null,
        },
      },
    });
    expect(result.applied).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('billing.js — Checkout session shape', () => {
  test('createQuotePackCheckoutSession uses mode=payment (NOT subscription)', () => {
    expect(billingJs).toMatch(
      /async function createQuotePackCheckoutSession[\s\S]+?mode:\s*['"]payment['"]/
    );
  });

  test('automatic_tax: false (Harry is NOT VAT-registered)', () => {
    expect(billingJs).toMatch(
      /async function createQuotePackCheckoutSession[\s\S]+?automatic_tax:\s*\{\s*enabled:\s*false/
    );
  });

  test('line item is the £9.99 pack (price_data, GBP)', () => {
    const block = blockFromTo(
      billingJs,
      'async function createQuotePackCheckoutSession',
      'async function applyQuotePackEventToDb'
    );
    expect(block).toMatch(/currency:\s*['"]gbp['"]/);
    expect(block).toMatch(/unit_amount:\s*QUOTE_PACK_PRICE_PENCE/);
    expect(block).toMatch(/name:\s*QUOTE_PACK_DESCRIPTION/);
  });

  test('metadata tags fastquote_product=quote_pack on BOTH the session AND the payment_intent', () => {
    const block = blockFromTo(
      billingJs,
      'async function createQuotePackCheckoutSession',
      'async function applyQuotePackEventToDb'
    );
    // Two metadata blocks — one at session level, one nested in payment_intent_data.
    const matches = block.match(/fastquote_product:\s*['"]quote_pack['"]/g) || [];
    expect(matches.length).toBe(2);
  });
});

describe('server.js — schema additions for the pack', () => {
  test('users.purchased_quotes column (additive, IF NOT EXISTS, NOT NULL DEFAULT 0)', () => {
    expect(serverJs).toMatch(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS purchased_quotes INTEGER NOT NULL DEFAULT 0/
    );
  });

  test('quote_purchases table (IF NOT EXISTS)', () => {
    expect(serverJs).toMatch(/CREATE TABLE IF NOT EXISTS quote_purchases/);
  });

  test('quote_purchases.stripe_payment_id has UNIQUE constraint (webhook idempotency)', () => {
    const block = blockFromTo(
      serverJs,
      'CREATE TABLE IF NOT EXISTS quote_purchases',
      'CREATE INDEX IF NOT EXISTS idx_quote_purchases_user'
    );
    expect(block).toMatch(/stripe_payment_id\s+TEXT NOT NULL UNIQUE/);
  });

  test('quote_purchases.user_id CASCADEs on user delete (GDPR — erasure)', () => {
    const block = blockFromTo(
      serverJs,
      'CREATE TABLE IF NOT EXISTS quote_purchases',
      'CREATE INDEX IF NOT EXISTS idx_quote_purchases_user'
    );
    expect(block).toMatch(/user_id\s+TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  });

  test('idx_quote_purchases_user index for the user-history lookup', () => {
    expect(serverJs).toMatch(/CREATE INDEX IF NOT EXISTS idx_quote_purchases_user ON quote_purchases\(user_id\)/);
  });
});

describe('server.js — webhook fan-out routes BOTH subscription and pack events', () => {
  const webhookBlock = blockFromTo(
    serverJs,
    "app.post('/api/billing/webhook'",
    'app.use(express.json('
  );

  test('calls applySubscriptionEventToDb (TRQ-150 path)', () => {
    expect(webhookBlock).toMatch(/applySubscriptionEventToDb\(pool,\s*event\)/);
  });

  test('calls applyQuotePackEventToDb (2026-06-24 pack)', () => {
    expect(webhookBlock).toMatch(/applyQuotePackEventToDb\(pool,\s*event\)/);
  });

  test('a pack-apply error returns 500 so Stripe retries', () => {
    expect(webhookBlock).toMatch(/quote pack apply failed/);
    expect(webhookBlock).toMatch(/res\.status\(500\)\.json/);
  });

  test('200 ACK includes applied = sub OR pack', () => {
    expect(webhookBlock).toMatch(/applied:\s*subResult\.applied\s*\|\|\s*packResult\.applied/);
  });
});

describe('server.js — POST /api/billing/buy-quote-pack', () => {
  const routeBlock = blockFromTo(
    serverJs,
    "app.post(\n  '/api/billing/buy-quote-pack'",
    '// ───── End pay-as-you-go quote pack routes ─────'
  );

  test('exists and is auth-gated', () => {
    expect(routeBlock).toMatch(/requireAuth/);
  });

  test('rate-limited via billingRateLimit (reuse TRQ-150 limiter)', () => {
    expect(routeBlock).toMatch(/billingRateLimit/);
  });

  test('requires Stripe to be configured (503 not 500 in staging)', () => {
    expect(routeBlock).toMatch(/requireStripe/);
  });

  test('returns 409 if the user is already subscribed (no useless top-up)', () => {
    expect(routeBlock).toMatch(/subscription_status === 'active'/);
    expect(routeBlock).toMatch(/res\.status\(409\)/);
  });

  test('calls createQuotePackCheckoutSession with the correct redirect URLs', () => {
    expect(routeBlock).toMatch(/createQuotePackCheckoutSession\(\{/);
    expect(routeBlock).toMatch(/pack_purchased=1/);
  });
});

describe('server.js — consume-on-success extends to purchased_quotes', () => {
  // Photo analyse block.
  const analyseBlock = blockFromTo(
    serverJs,
    "app.post('/api/users/:id/analyse'",
    '// ─'
  );

  test('photo route loads purchased_quotes in the gate-time SELECT', () => {
    expect(analyseBlock).toMatch(/SELECT[\s\S]*?purchased_quotes[\s\S]*?FROM users WHERE id = \$1/);
  });

  test('photo route decrements purchased_quotes when gate reason was purchased-remaining', () => {
    // Locked spec: same dedupe table (free_quote_grants) — re-analysing
    // a draft never burns a second quote, even from the paid bucket.
    expect(analyseBlock).toMatch(/consumeReason\s*===\s*['"]purchased-remaining['"]/);
    expect(analyseBlock).toMatch(/purchased_quotes = GREATEST\(0,\s*purchased_quotes - 1\)/);
    expect(analyseBlock).toMatch(
      /WITH inserted AS \([\s\S]*?INSERT INTO free_quote_grants[\s\S]*?ON CONFLICT \(user_id, quote_token\) DO NOTHING[\s\S]*?\)[\s\S]*?UPDATE users[\s\S]*?purchased_quotes/
    );
  });

  test('photo route increments free_quotes_used only when gate reason was free-remaining', () => {
    expect(analyseBlock).toMatch(/consumeReason\s*===\s*['"]free-remaining['"]/);
  });

  test('photo route — neither bucket changes on the failure path (consume-on-success rule)', () => {
    // After the outer catch, nothing should touch free_quotes_used or purchased_quotes.
    const outerCatchIdx = analyseBlock.lastIndexOf('} catch (err) {');
    const tail = analyseBlock.slice(outerCatchIdx);
    expect(tail).not.toMatch(/free_quotes_used = free_quotes_used \+ 1/);
    expect(tail).not.toMatch(/purchased_quotes = GREATEST/);
  });

  // Video route block.
  const videoBlock = blockFromTo(
    serverJs,
    "app.post('/api/users/:id/jobs/:jobId/video'",
    '// ─'
  );

  test('video route loads purchased_quotes in the gate-time SELECT', () => {
    expect(videoBlock).toMatch(/SELECT[\s\S]*?purchased_quotes[\s\S]*?FROM users WHERE id = \$1/);
  });

  test('video route captures gate reason for the consume branch', () => {
    expect(videoBlock).toMatch(/videoGateReason/);
  });

  test('video route decrements purchased_quotes when reason was purchased-remaining', () => {
    expect(videoBlock).toMatch(/videoGateReason\s*===\s*['"]purchased-remaining['"]/);
    expect(videoBlock).toMatch(/purchased_quotes = GREATEST\(0,\s*purchased_quotes - 1\)/);
  });

  test('video route reuses the same dedupe key (job:${jobId}) for the paid bucket', () => {
    // The same INSERT INTO free_quote_grants pattern as the free bucket.
    // Per-spec: "re-analysing one draft burns ONE quote maximum (free OR paid)".
    const purchasedBranchIdx = videoBlock.indexOf("videoGateReason === 'purchased-remaining'");
    const purchasedBranch = videoBlock.slice(purchasedBranchIdx, purchasedBranchIdx + 800);
    expect(purchasedBranch).toMatch(/INSERT INTO free_quote_grants/);
    expect(purchasedBranch).toMatch(/`job:\$\{jobId\}`/);
    expect(purchasedBranch).toMatch(/ON CONFLICT \(user_id, quote_token\) DO NOTHING/);
  });
});

describe('server.js — /auth/me + /api/billing/status expose purchasedQuotesRemaining', () => {
  test('loadBilling SELECT pulls purchased_quotes', () => {
    const meStart = serverJs.indexOf("app.get('/auth/me'");
    const meEnd = serverJs.indexOf('app.post(', meStart);
    const meBlock = serverJs.slice(meStart, meEnd);
    expect(meBlock).toMatch(/SELECT[\s\S]*?purchased_quotes[\s\S]*?FROM users WHERE id = \$1/);
  });

  test('/api/billing/status SELECT pulls purchased_quotes', () => {
    const statusBlock = blockFromTo(
      serverJs,
      "app.get('/api/billing/status'",
      "app.post('/api/billing/checkout'"
    );
    expect(statusBlock).toMatch(/purchased_quotes/);
    expect(statusBlock).toMatch(/purchasedQuotesRemaining/);
  });

  test('/api/billing/status emits quotePack pricing block (so client can render the button label)', () => {
    const statusBlock = blockFromTo(
      serverJs,
      "app.get('/api/billing/status'",
      "app.post('/api/billing/checkout'"
    );
    expect(statusBlock).toMatch(/quotePack:/);
    expect(statusBlock).toMatch(/QUOTE_PACK_SIZE/);
    expect(statusBlock).toMatch(/QUOTE_PACK_PRICE_PENCE/);
  });
});

describe('JobDetails video path now calls onAnalysisSuccess (closes PR #58 gap)', () => {
  test('handleVideoAnalyse calls onAnalysisSuccess on success ONLY', () => {
    // Locate the video handler — the callback fires AFTER the success
    // dispatch, BEFORE the catch.
    const start = jobDetailsJs.indexOf('handleVideoAnalyse');
    const block = jobDetailsJs.slice(start, start + 5000);
    expect(block).toMatch(
      /type: 'ANALYSIS_SUCCESS'[\s\S]+?onAnalysisSuccess\?\.\(\)[\s\S]+?\} catch \(err\)/
    );
  });

  test('handleVideoAnalyse does NOT call onAnalysisSuccess from the catch block', () => {
    const start = jobDetailsJs.indexOf('handleVideoAnalyse');
    const block = jobDetailsJs.slice(start, start + 5000);
    const catchIdx = block.indexOf('} catch (err) {');
    expect(catchIdx).toBeGreaterThan(-1);
    // Cut at the next handler def so we don't accidentally pick up
    // the photo path's onAnalysisSuccess.
    const catchTail = block.slice(catchIdx, block.indexOf('const hasAnyPhoto'));
    expect(catchTail).not.toMatch(/onAnalysisSuccess/);
  });
});
