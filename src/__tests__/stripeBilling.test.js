/**
 * TRQ-150 — Stripe billing (test-mode code).
 *
 * Two layers:
 *   1. Behavioural tests on the pure helpers in billing.js
 *      (subscription-state machine, trial-days, live-key gate,
 *      subscription event → DB mapping).
 *   2. Source-level guards on server.js wiring: webhook mounted
 *      before express.json, routes auth-gated, env validation,
 *      schema columns present.
 *
 * NOT covered (would need a live test Stripe key): actual Checkout
 * session creation, actual Portal session creation, actual webhook
 * signature verification against a fake event. Those happen in
 * docs/BILLING.md's local-development section + TRQ-157's live
 * dry-run.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  PRICE_GBP,
  TRIAL_DAYS,
  SUBSCRIPTION_STATUSES,
  hasStripeKey,
  isLiveKey,
  currentSubscriptionState,
  daysOfTrialRemaining,
  applySubscriptionEventToDb,
} from '../../billing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const billingJs = readFileSync(join(repoRoot, 'billing.js'), 'utf8');
const billingDoc = readFileSync(join(repoRoot, 'docs/BILLING.md'), 'utf8');

describe('TRQ-150 — pricing constants', () => {
  test('PRICE_GBP is £19.99', () => {
    expect(PRICE_GBP).toBe(19.99);
  });
  test('TRIAL_DAYS is 30', () => {
    expect(TRIAL_DAYS).toBe(30);
  });
});

describe('TRQ-150 — subscription status enum mirrors Stripe', () => {
  // Stripe's documented values. If Stripe adds a new one we'll get
  // an unhandled state in `applySubscriptionEventToDb` — the test
  // here flags drift.
  const expected = [
    'trialing', 'active', 'past_due', 'canceled',
    'unpaid', 'incomplete', 'incomplete_expired', 'paused',
  ];

  test('SUBSCRIPTION_STATUSES is frozen', () => {
    expect(Object.isFrozen(SUBSCRIPTION_STATUSES)).toBe(true);
  });

  test('SUBSCRIPTION_STATUSES covers every Stripe-documented value', () => {
    expect(SUBSCRIPTION_STATUSES).toEqual(expected);
  });
});

describe('TRQ-150 — live-key gate', () => {
  test('isLiveKey distinguishes sk_live_ from sk_test_', () => {
    expect(isLiveKey('sk_live_abc')).toBe(true);
    expect(isLiveKey('sk_test_abc')).toBe(false);
    expect(isLiveKey('')).toBe(false);
    expect(isLiveKey(null)).toBe(false);
    expect(isLiveKey(undefined)).toBe(false);
  });

  test('hasStripeKey reflects current env', () => {
    const before = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = '';
    expect(hasStripeKey()).toBe(false);
    process.env.STRIPE_SECRET_KEY = 'sk_test_xyz';
    expect(hasStripeKey()).toBe(true);
    process.env.STRIPE_SECRET_KEY = before;
  });
});

describe('TRQ-150 — currentSubscriptionState', () => {
  test('Stripe status wins when set', () => {
    expect(currentSubscriptionState({ subscription_status: 'active', trial_ends_at: null })).toBe('active');
    expect(currentSubscriptionState({ subscription_status: 'past_due' })).toBe('past_due');
    expect(currentSubscriptionState({ subscription_status: 'canceled' })).toBe('canceled');
  });

  test('returns "trialing" when trial_ends_at is in the future and no Stripe status', () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect(currentSubscriptionState({ trial_ends_at: future })).toBe('trialing');
  });

  test('returns "expired" when trial_ends_at is in the past and no Stripe status', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(currentSubscriptionState({ trial_ends_at: past })).toBe('expired');
  });

  test('returns "unknown" for legacy users (no trial, no status)', () => {
    expect(currentSubscriptionState({ id: 'mark' })).toBe('unknown');
    expect(currentSubscriptionState(null)).toBe('unknown');
  });
});

describe('TRQ-150 — daysOfTrialRemaining', () => {
  test('returns the right integer for a 5-day-out trial', () => {
    const future = new Date(Date.now() + 5 * 86_400_000);
    const days = daysOfTrialRemaining({ trial_ends_at: future.toISOString() });
    // Math.ceil — could be 5 or 6 depending on second-level rounding.
    expect(days).toBeGreaterThanOrEqual(4);
    expect(days).toBeLessThanOrEqual(6);
  });

  test('returns 0 when trial is in the past', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(daysOfTrialRemaining({ trial_ends_at: past })).toBe(0);
  });

  test('returns 0 when user has no trial', () => {
    expect(daysOfTrialRemaining({})).toBe(0);
    expect(daysOfTrialRemaining(null)).toBe(0);
  });
});

describe('TRQ-150 — applySubscriptionEventToDb', () => {
  // Mock pool — captures queries so we can assert WHAT was written.
  function mockPool() {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }),
    };
  }

  test('checkout.session.completed → sets customer + subscription + active', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user_abc',
          customer: 'cus_xyz',
          subscription: 'sub_xyz',
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(result.userId).toBe('user_abc');
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].sql).toMatch(/UPDATE users[\s\S]*stripe_customer_id/);
    expect(pool.calls[0].params).toEqual(['cus_xyz', 'sub_xyz', 'active', 'user_abc']);
  });

  test('checkout.session.completed without client_reference_id is skipped (not 500)', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'checkout.session.completed',
      data: { object: { customer: 'cus_xyz' } },
    });
    expect(result.applied).toBe(false);
    expect(pool.calls).toHaveLength(0);
  });

  test('customer.subscription.updated → updates status + period_end + cancel_at_period_end', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_xyz',
          customer: 'cus_xyz',
          status: 'past_due',
          current_period_end: 1735689600, // 2025-01-01 in seconds
          cancel_at_period_end: true,
          metadata: { fastquote_user_id: 'user_abc' },
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(pool.calls[0].params).toEqual([
      'cus_xyz', 'sub_xyz', 'past_due',
      new Date(1735689600 * 1000), true, 'user_abc',
    ]);
  });

  test('customer.subscription.deleted → clears subscription id, status=canceled', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_xyz',
          metadata: { fastquote_user_id: 'user_abc' },
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(result.status).toBe('canceled');
    expect(pool.calls[0].sql).toMatch(/stripe_subscription_id = NULL/);
    expect(pool.calls[0].params).toEqual(['user_abc']);
  });

  test('invoice.payment_failed → flips status to past_due, scoped by customer id', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_xyz' } },
    });
    expect(result.applied).toBe(true);
    expect(pool.calls[0].sql).toMatch(/SET subscription_status = 'past_due'/);
    expect(pool.calls[0].params).toEqual(['cus_xyz']);
  });

  test('customer.subscription.trial_will_end → captures trial_end timestamp', async () => {
    // Stripe fires this ~3 days before the trial converts. The UI uses
    // it to switch the banner from "trial in progress" to "ends in N
    // days — add a card". We just store the timestamp; no email is
    // sent yet (own follow-up ticket once email infra exists).
    const pool = mockPool();
    const trialEndUnix = 1735689600; // 2025-01-01T00:00:00Z (arbitrary)
    const result = await applySubscriptionEventToDb(pool, {
      type: 'customer.subscription.trial_will_end',
      data: {
        object: {
          id: 'sub_xyz',
          trial_end: trialEndUnix,
          metadata: { fastquote_user_id: 'user_abc' },
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(result.userId).toBe('user_abc');
    expect(pool.calls[0].sql).toMatch(/SET trial_will_end_at = \$1/);
    // Param order: [trial_will_end_at, userId]
    expect(pool.calls[0].params[0]).toBeInstanceOf(Date);
    expect(pool.calls[0].params[0].getTime()).toBe(trialEndUnix * 1000);
    expect(pool.calls[0].params[1]).toBe('user_abc');
  });

  test('trial_will_end without fastquote_user_id metadata is skipped (not 500)', async () => {
    // Same pattern as the other subscription handlers — if our metadata
    // marker is missing, we can't safely attribute the event.
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'customer.subscription.trial_will_end',
      data: { object: { id: 'sub_xyz', trial_end: 1735689600 } },
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/no fastquote_user_id/);
    expect(pool.calls).toHaveLength(0);
  });

  test('trial_will_end without trial_end timestamp writes NULL (best-effort capture)', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'customer.subscription.trial_will_end',
      data: {
        object: {
          id: 'sub_xyz',
          metadata: { fastquote_user_id: 'user_abc' },
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(pool.calls[0].params[0]).toBeNull();
  });

  test('unhandled event types pass through (no DB write, no throw)', async () => {
    const pool = mockPool();
    const result = await applySubscriptionEventToDb(pool, {
      type: 'price.created',
      data: { object: {} },
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/unhandled event type/);
    expect(pool.calls).toHaveLength(0);
  });
});

describe('TRQ-150 — server.js wiring', () => {
  test('schema gains the seven subscription columns (all nullable)', () => {
    for (const col of [
      'stripe_customer_id',
      'stripe_subscription_id',
      'subscription_status',
      'trial_ends_at',
      'current_period_end',
      'cancel_at_period_end',
      'trial_will_end_at',
    ]) {
      expect(serverJs).toMatch(new RegExp(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}`));
    }
  });

  test('/api/billing/status returns trialWillEndAt in the payload', () => {
    // The new field has to reach the client or the UI banner can't
    // switch from "in trial" to "ends soon". The SELECT must include
    // the column and the response JSON must surface it.
    expect(serverJs).toMatch(/SELECT[\s\S]{0,300}trial_will_end_at[\s\S]{0,300}FROM users WHERE id = \$1/);
    expect(serverJs).toMatch(/trialWillEndAt: user\.trial_will_end_at/);
  });

  test('stripe_customer_id has a UNIQUE constraint (one customer per user)', () => {
    expect(serverJs).toMatch(/ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE/);
  });

  test('OAuth signup sets trial_ends_at to NOW() + 30 days', () => {
    const idx = serverJs.indexOf('INSERT INTO users (id, name, email, avatar_url, auth_provider');
    expect(idx).toBeGreaterThan(-1);
    const block = serverJs.slice(idx, idx + 1500);
    expect(block).toMatch(/trial_ends_at[\s\S]{0,400}NOW\(\)\s*\+\s*INTERVAL\s*'30 days'/);
    expect(block).toMatch(/'trialing'/);
  });

  test('webhook is mounted BEFORE express.json (raw body required for HMAC)', () => {
    const webhookIdx = serverJs.indexOf("app.post('/api/billing/webhook'");
    const jsonIdx = serverJs.indexOf("app.use(express.json(");
    expect(webhookIdx).toBeGreaterThan(-1);
    expect(jsonIdx).toBeGreaterThan(-1);
    expect(webhookIdx).toBeLessThan(jsonIdx);
  });

  test('webhook uses express.raw, not express.json', () => {
    const start = serverJs.indexOf("app.post('/api/billing/webhook'");
    const end = serverJs.indexOf(');', start) + 2;
    const block = serverJs.slice(start, end);
    expect(block).toMatch(/express\.raw/);
    expect(block).not.toMatch(/express\.json/);
  });

  test('webhook returns 200 on apply errors that are NOT signature problems', () => {
    // ACK semantics: 4xx on bad signature (Stripe stops), 5xx on
    // genuine apply errors (Stripe retries), 200 on success or
    // unhandled-but-acknowledged.
    const start = serverJs.indexOf("app.post('/api/billing/webhook'");
    const end = serverJs.indexOf("app.use(express.json", start);
    const block = serverJs.slice(start, end);
    expect(block).toMatch(/res\.status\(400\)\.json\(\{ error: 'missing signature/);
    expect(block).toMatch(/res\.status\(400\)\.json\(\{ error: 'invalid signature/);
    expect(block).toMatch(/res\.status\(500\)\.json\(\{ error: 'apply failed/);
    expect(block).toMatch(/res\.json\(\{ received: true/);
  });

  test('billing routes are auth-gated', () => {
    for (const route of [
      "app.get('/api/billing/status'",
      "app.post('/api/billing/checkout'",
      "app.post('/api/billing/portal'",
    ]) {
      const idx = serverJs.indexOf(route);
      expect(idx).toBeGreaterThan(-1);
      const block = serverJs.slice(idx, idx + 300);
      expect(block).toMatch(/requireAuth/);
    }
  });

  test('checkout + portal routes are rate-limited (10/min/IP)', () => {
    expect(serverJs).toMatch(/billingRateLimit\s*=\s*rateLimit\(\{[\s\S]*?max:\s*10/);
    for (const route of ["app.post('/api/billing/checkout'", "app.post('/api/billing/portal'"]) {
      const idx = serverJs.indexOf(route);
      const block = serverJs.slice(idx, idx + 200);
      expect(block).toMatch(/billingRateLimit/);
    }
  });

  test('checkout + portal routes refuse to run without STRIPE_SECRET_KEY (503, not 500)', () => {
    expect(serverJs).toMatch(/function requireStripe[\s\S]{0,300}hasStripeKey\(\)[\s\S]{0,200}res\.status\(503\)/);
  });

  test('billing/status route NEVER errors out when STRIPE_SECRET_KEY is missing', () => {
    // /status is for the UI trial banner — must work without Stripe
    // (staging may run without keys; users still need to see their
    // trial countdown).
    const idx = serverJs.indexOf("app.get('/api/billing/status'");
    const end = serverJs.indexOf("app.post('/api/billing/checkout'", idx);
    const block = serverJs.slice(idx, end);
    expect(block).not.toMatch(/requireStripe/);
    expect(block).toMatch(/currentSubscriptionState/);
    expect(block).toMatch(/daysOfTrialRemaining/);
  });

  test('checkout returns 409 if user already subscribed (no double-charge)', () => {
    const idx = serverJs.indexOf("app.post('/api/billing/checkout'");
    const end = serverJs.indexOf("app.post('/api/billing/portal'", idx);
    const block = serverJs.slice(idx, end);
    expect(block).toMatch(/subscription_status === 'active'/);
    expect(block).toMatch(/res\.status\(409\)\.json\(\{\s*error:\s*'already subscribed'/);
  });

  test('portal returns 409 if no Stripe customer yet (must check out first)', () => {
    const idx = serverJs.indexOf("app.post('/api/billing/portal'");
    const end = serverJs.indexOf("// ───── End TRQ-150", idx);
    const block = serverJs.slice(idx, end);
    expect(block).toMatch(/No subscription on file/);
    expect(block).toMatch(/res\.status\(409\)/);
  });

  test('Paul coupon is keyed by env (STRIPE_PAUL_COUPON_USER_ID), not hardcoded', () => {
    expect(serverJs).toMatch(/STRIPE_PAUL_COUPON_USER_ID/);
    expect(serverJs).not.toMatch(/userId === ['"]paul['"]/);
  });
});

describe('TRQ-150 — billing.js safety properties', () => {
  test('stripeClient is lazy (does not construct on import)', () => {
    expect(billingJs).toMatch(/let _client = null/);
    expect(billingJs).toMatch(/if \(_client\) return _client/);
  });

  test('refuses to construct from sk_live_ unless STRIPE_ALLOW_LIVE=1', () => {
    expect(billingJs).toMatch(/isLiveKey\(key\)[\s\S]{0,200}STRIPE_ALLOW_LIVE[\s\S]{0,80}!==\s*['"]1['"]/);
    expect(billingJs).toMatch(/Refusing to construct a Stripe client/);
  });

  test('strips whitespace from STRIPE_SECRET_KEY before constructing the SDK (2026-06-17 paste bug)', () => {
    // A multi-line paste introduced \n and spaces into the middle of
    // the key, which Node's HTTP header validator rejected with
    // ERR_INVALID_CHAR — surfaced only as StripeConnectionError "An
    // error occurred with our connection to Stripe", killing the
    // checkout flow with no client-side signal. Defensive trim
    // prevents the whole class of issue.
    expect(billingJs).toMatch(/raw\.replace\(\/\\s\+\/g,\s*['"]{2}\)/);
  });

  test('parseWebhookEvent requires STRIPE_WEBHOOK_SECRET (no bypass)', () => {
    expect(billingJs).toMatch(/STRIPE_WEBHOOK_SECRET[\s\S]{0,200}is not set/);
  });

  test('no live key, no DATABASE_URL, no real keys committed', () => {
    expect(billingJs).not.toMatch(/sk_live_[A-Za-z0-9]/);
    expect(billingJs).not.toMatch(/whsec_[A-Za-z0-9]/);
    expect(billingJs).not.toMatch(/process\.env\.DATABASE_URL/);
  });

  test('createCheckoutSession passes client_reference_id (so webhook can attribute)', () => {
    expect(billingJs).toMatch(/client_reference_id:\s*userId/);
  });

  test('createCheckoutSession does NOT add a Stripe-side trial (FastQuote-side trial already running)', () => {
    // The block must NOT include `trial_period_days` — that would
    // double-count by giving the user another N days on top of
    // the FastQuote-side trial.
    const start = billingJs.indexOf('async function createCheckoutSession');
    const end = billingJs.indexOf('async function createPortalSession');
    const block = billingJs.slice(start, end);
    expect(block).not.toMatch(/trial_period_days/);
  });

  test('Paul coupon only applies when both env var AND withPaulCoupon are set', () => {
    const start = billingJs.indexOf('async function createCheckoutSession');
    const end = billingJs.indexOf('async function createPortalSession');
    const block = billingJs.slice(start, end);
    expect(block).toMatch(
      /if \(withPaulCoupon && process\.env\.STRIPE_PAUL_COUPON_ID\)/
    );
  });
});

describe('TRQ-150 — docs/BILLING.md', () => {
  test('documents required env vars (all six)', () => {
    for (const v of [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_ID',
      'STRIPE_PAUL_COUPON_ID',
      'STRIPE_PAUL_COUPON_USER_ID',
      'STRIPE_ALLOW_LIVE',
    ]) {
      expect(billingDoc).toMatch(new RegExp(v));
    }
  });

  test('documents the exact webhook events FastQuote consumes', () => {
    for (const ev of [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_failed',
    ]) {
      expect(billingDoc).toMatch(new RegExp(ev.replace('.', '\\.')));
    }
  });

  test('Harry-only setup steps named (Stripe account, identity, bank, statement descriptor)', () => {
    expect(billingDoc).toMatch(/Harry-only setup/i);
    expect(billingDoc).toMatch(/Identity verification/i);
    expect(billingDoc).toMatch(/Statement descriptor[\s\S]{0,100}FASTQUOTE/);
    expect(billingDoc).toMatch(/Connect bank account/i);
  });

  test('subscription-state map documents all six states', () => {
    for (const s of ['trialing', 'active', 'past_due', 'canceled', 'expired', 'unknown']) {
      expect(billingDoc).toMatch(new RegExp(`\`${s}\``));
    }
  });

  test('flags what this PR does NOT do (UI, billing gates, VAT)', () => {
    expect(billingDoc).toMatch(/Does not enforce billing gates/i);
    // Markdown emphasis (**Does not collect VAT**) puts asterisks
    // between VAT and "separately"; bridge with [\s\S].
    expect(billingDoc).toMatch(/Does not collect VAT[\s\S]{0,10}separately/i);
    expect(billingDoc).toMatch(/Does not display a billing UI/i);
  });
});
