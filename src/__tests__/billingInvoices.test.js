/**
 * Per-purchase invoices for accounting (Harry's launch checklist 2026-06-30).
 *
 * Three layers — same pattern as stripeBilling.test.js + quotePack.test.js:
 *   1. Pure helpers (formatPurchaseDescription).
 *   2. Webhook handler (applyQuotePackEventToDb stores hosted_invoice_url).
 *   3. Source-level guards on server.js wiring (schema add,
 *      /api/billing/purchases route, BillingSection in ProfileSetup nav).
 *
 * No live Stripe key required — the helper that fetches the hosted URL
 * is exercised via the helper's own try/catch in test environments.
 */
import { jest, describe, test, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  formatPurchaseDescription,
  applyQuotePackEventToDb,
  QUOTE_PACK_PRICE_PENCE,
} from '../../billing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const billingJs = readFileSync(join(repoRoot, 'billing.js'), 'utf8');
const profileSetupJsx = readFileSync(
  join(repoRoot, 'src/components/steps/ProfileSetup.jsx'),
  'utf8'
);
const billingSectionJsx = readFileSync(
  join(repoRoot, 'src/components/BillingSection.jsx'),
  'utf8'
);

function blockFromTo(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  if (start === -1) return '';
  const end = endNeedle ? src.indexOf(endNeedle, start + 1) : src.length;
  return src.slice(start, end > start ? end : src.length);
}

// ─────────────────────────────────────────────────────────────────────
// 1. Pure helpers
// ─────────────────────────────────────────────────────────────────────

describe('formatPurchaseDescription — pure helper', () => {
  test('pack: shows "5 quotes — £9.99" for the canonical price', () => {
    expect(formatPurchaseDescription({ kind: 'pack', amountPence: 999 }))
      .toBe('5 quotes — £9.99');
  });

  test('pack: falls back to default pence when amount missing', () => {
    // QUOTE_PACK_PRICE_PENCE is 999 — fallback should still render £9.99.
    expect(formatPurchaseDescription({ kind: 'pack' }))
      .toBe(`5 quotes — £${(QUOTE_PACK_PRICE_PENCE / 100).toFixed(2)}`);
  });

  test('subscription: shows "Monthly subscription — £X.XX"', () => {
    expect(formatPurchaseDescription({ kind: 'subscription', amountPence: 1999 }))
      .toBe('Monthly subscription — £19.99');
  });

  test('unknown kind falls back to a safe label, never throws', () => {
    expect(formatPurchaseDescription({ kind: 'mystery', amountPence: 100 }))
      .toBe('Purchase');
    expect(formatPurchaseDescription({})).toBe('Purchase');
    expect(formatPurchaseDescription()).toBe('Purchase');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Webhook handler stores hosted_invoice_url
// ─────────────────────────────────────────────────────────────────────

describe('applyQuotePackEventToDb — captures hosted_invoice_url', () => {
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

  test('INSERT statement now includes hosted_invoice_url column + 5th param', async () => {
    const pool = mockPool();
    await applyQuotePackEventToDb(pool, {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_no_invoice',
          amount_received: 999,
          metadata: { fastquote_user_id: 'u', fastquote_product: 'quote_pack' },
        },
      },
    });
    // Find the INSERT call (skips BEGIN).
    const insertCall = pool.client.query.mock.calls.find(([sql]) =>
      /INSERT INTO quote_purchases/.test(sql)
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toMatch(/hosted_invoice_url/);
    // Params: [userId, stripePaymentId, QUOTE_PACK_SIZE, amount, hostedInvoiceUrl]
    // hostedInvoiceUrl will be null in this environment (no Stripe key).
    expect(insertCall[1]).toHaveLength(5);
    expect(insertCall[1][0]).toBe('u');
    expect(insertCall[1][1]).toBe('pi_no_invoice');
    expect(insertCall[1][2]).toBe(5);
    expect(insertCall[1][3]).toBe(999);
    // 5th param is the hosted_invoice_url; null in tests because no
    // Stripe client is configured (best-effort, swallowed in helper).
    expect(insertCall[1][4]).toBeNull();
  });

  test('result object surfaces hostedInvoiceUrl (null when unresolved)', async () => {
    const pool = mockPool();
    const result = await applyQuotePackEventToDb(pool, {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          client_reference_id: 'u',
          payment_intent: 'pi_x',
          amount_total: 999,
          metadata: { fastquote_user_id: 'u', fastquote_product: 'quote_pack' },
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(result).toHaveProperty('hostedInvoiceUrl');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. billing.js source — invoice_creation enabled on the Checkout
// ─────────────────────────────────────────────────────────────────────

describe('billing.js — invoice_creation on quote-pack Checkout', () => {
  test('createQuotePackCheckoutSession passes invoice_creation: { enabled: true }', () => {
    const block = blockFromTo(
      billingJs,
      'async function createQuotePackCheckoutSession',
      'async function applyQuotePackEventToDb'
    );
    expect(block).toMatch(/invoice_creation:\s*\{\s*enabled:\s*true\s*\}/);
  });

  test('getHostedInvoiceUrlForPayment helper exists and is exported', () => {
    expect(billingJs).toMatch(/export async function getHostedInvoiceUrlForPayment/);
  });

  test('listCustomerInvoices helper exists and is exported', () => {
    expect(billingJs).toMatch(/export async function listCustomerInvoices/);
  });

  test('formatPurchaseDescription helper exists and is exported', () => {
    expect(billingJs).toMatch(/export function formatPurchaseDescription/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. server.js — schema add for hosted_invoice_url
// ─────────────────────────────────────────────────────────────────────

describe('server.js — quote_purchases.hosted_invoice_url column', () => {
  test('additive ALTER TABLE … ADD COLUMN IF NOT EXISTS hosted_invoice_url', () => {
    expect(serverJs).toMatch(
      /ALTER TABLE quote_purchases ADD COLUMN IF NOT EXISTS hosted_invoice_url TEXT/
    );
  });

  test('column is nullable (no NOT NULL) so existing rows survive', () => {
    // Locate the ALTER and verify there's no NOT NULL on the same statement.
    const match = serverJs.match(
      /ALTER TABLE quote_purchases ADD COLUMN IF NOT EXISTS hosted_invoice_url TEXT[^;]*/
    );
    expect(match).not.toBeNull();
    expect(match[0]).not.toMatch(/NOT NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. server.js — /api/billing/purchases route
// ─────────────────────────────────────────────────────────────────────

describe('server.js — GET /api/billing/purchases', () => {
  const routeBlock = blockFromTo(
    serverJs,
    "app.get('/api/billing/purchases'",
    '// ───── End pay-as-you-go quote pack routes ─────'
  );

  test('route exists', () => {
    expect(routeBlock.length).toBeGreaterThan(0);
  });

  test('is auth-gated', () => {
    expect(routeBlock).toMatch(/requireAuth/);
  });

  test('is rate-limited via billingRateLimit (reuse TRQ-150 limiter)', () => {
    expect(routeBlock).toMatch(/billingRateLimit/);
  });

  test('selects pack purchases from quote_purchases (id, payment_id, amount, hosted_invoice_url, created_at)', () => {
    expect(routeBlock).toMatch(/SELECT[\s\S]*?hosted_invoice_url[\s\S]*?FROM quote_purchases[\s\S]*?WHERE user_id = \$1/);
    expect(routeBlock).toMatch(/ORDER BY created_at DESC/);
    expect(routeBlock).toMatch(/LIMIT 24/);
  });

  test('combines packs + subscription invoices via listCustomerInvoices', () => {
    expect(routeBlock).toMatch(/listCustomerInvoices/);
  });

  test('only includes Stripe invoices that belong to a subscription (no double-count of pack invoices)', () => {
    expect(routeBlock).toMatch(/\.filter\(\(inv\) => Boolean\(inv\.subscription\)\)/);
  });

  test('combined list is sorted by date DESC and capped at 24', () => {
    expect(routeBlock).toMatch(/\.sort\(/);
    expect(routeBlock).toMatch(/\.slice\(0, 24\)/);
  });

  test('returns { purchases: [...] } as the response shape', () => {
    expect(routeBlock).toMatch(/res\.json\(\{\s*purchases:/);
  });

  test('silently degrades when Stripe is not configured (no 503 on read)', () => {
    // The route checks hasStripeKey() before listing subscription
    // invoices. Pack purchases come from our local DB so they work
    // regardless of Stripe configuration.
    expect(routeBlock).toMatch(/hasStripeKey\(\)/);
    // No requireStripe middleware on the read route — staging users
    // without Stripe keys still see their (empty) purchase list.
    expect(routeBlock).not.toMatch(/requireStripe/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. ProfileSetup — Billing nav section
// ─────────────────────────────────────────────────────────────────────

describe('ProfileSetup — Billing section in the 6-section nav', () => {
  test('SECTIONS array now includes a billing entry', () => {
    expect(profileSetupJsx).toMatch(
      /\{\s*id:\s*['"]billing['"]\s*,\s*label:\s*['"]Billing['"]/
    );
  });

  test('renderActiveSection switches on the new id', () => {
    expect(profileSetupJsx).toMatch(/case\s+['"]billing['"]\s*:\s*return\s+renderBilling/);
  });

  test('BillingSection component is imported', () => {
    expect(profileSetupJsx).toMatch(/import\s+BillingSection\s+from\s+['"]\.\.\/BillingSection\.jsx['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. BillingSection component — surfaces + safe vocabulary
// ─────────────────────────────────────────────────────────────────────

describe('BillingSection component', () => {
  test('fetches /api/billing/purchases', () => {
    expect(billingSectionJsx).toMatch(/fetch\(['"]\/api\/billing\/purchases['"]\)/);
  });

  test('fetches /api/billing/status (for the subscription card)', () => {
    expect(billingSectionJsx).toMatch(/fetch\(['"]\/api\/billing\/status['"]\)/);
  });

  test('renders a "No purchases yet" empty state', () => {
    expect(billingSectionJsx).toMatch(/No purchases yet/);
  });

  test('renders "Download invoice" link only when hostedInvoiceUrl present', () => {
    expect(billingSectionJsx).toMatch(/Download invoice/);
    expect(billingSectionJsx).toMatch(/Not yet available/);
  });

  test('links open in a new tab with rel="noopener noreferrer"', () => {
    expect(billingSectionJsx).toMatch(/target=['"]_blank['"]/);
    expect(billingSectionJsx).toMatch(/rel=['"]noopener noreferrer['"]/);
  });

  test('Manage subscription button POSTs to /api/billing/portal', () => {
    expect(billingSectionJsx).toMatch(/fetch\(['"]\/api\/billing\/portal['"],\s*\{\s*method:\s*['"]POST['"]/);
    expect(billingSectionJsx).toMatch(/Manage subscription/);
  });

  test('subscription card hidden unless user has an active subscription', () => {
    // The `isSubscribed` gate keys off /api/billing/status response.
    expect(billingSectionJsx).toMatch(/isSubscribed/);
    expect(billingSectionJsx).toMatch(/state === ['"]active['"]/);
  });

  test('no banned AI vocabulary leaks into the user-facing copy', () => {
    // Quick lint against the most likely slips. The codebase-wide
    // aiTextRemoval.test.js catches these too, but a targeted check
    // here makes future drift in this file fail fast.
    for (const banned of ['Claude', 'Sonnet', 'AI ', 'model', 'agent', 'calibration']) {
      // Allow generic Tailwind class fragments like "model-" if any
      // appear; pin against word-boundary user-text use only.
      const re = new RegExp(`>\\s*[^<>]*\\b${banned}\\b`, 'i');
      expect(billingSectionJsx).not.toMatch(re);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. server.js — webhook integration smoke (hosted URL ends up persisted)
// ─────────────────────────────────────────────────────────────────────

describe('webhook fan-out unchanged (Pitfall #17 not regressed)', () => {
  const webhookBlock = blockFromTo(
    serverJs,
    "app.post('/api/billing/webhook'",
    'app.use(express.json('
  );

  test('still calls applyQuotePackEventToDb (the handler that captures hosted_invoice_url)', () => {
    expect(webhookBlock).toMatch(/applyQuotePackEventToDb\(pool,\s*event\)/);
  });

  test('still calls applySubscriptionEventToDb (TRQ-150 path stays disjoint)', () => {
    expect(webhookBlock).toMatch(/applySubscriptionEventToDb\(pool,\s*event\)/);
  });
});
