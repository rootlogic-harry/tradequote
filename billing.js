/**
 * TRQ-150 — Stripe subscription billing.
 *
 * Test-mode-only code. Live keys are Harry's responsibility (see
 * docs/BILLING.md for the human-only setup).
 *
 * Pricing model:
 *   - £19.99/month subscription.
 *   - 1-month no-card trial. Trial starts at OAuth signup
 *     (`trial_ends_at = NOW() + 1 month`).
 *   - At trial-end the user sees a "Subscribe" banner; clicking it
 *     opens a Stripe Checkout session for the card collection.
 *   - Paul gets the first paid month free via a Stripe coupon
 *     (env `STRIPE_PAUL_COUPON_ID`), applied at checkout.
 *
 * Why a separate module:
 *   - Lazy initialisation. The Stripe SDK throws if instantiated
 *     without a key; deferring it lets `server.js` import this
 *     module unconditionally and the test suite run without a key.
 *   - Test-mode safety. `stripeClient()` refuses to return a client
 *     constructed from a `sk_live_…` key unless `STRIPE_ALLOW_LIVE=1`
 *     (set by Harry at go-live, never by an autonomous agent).
 *   - Keeps server.js focused on routes; the Stripe-specific
 *     business logic lives here.
 *
 * Public exports:
 *   - stripeClient()        — lazy-init Stripe SDK instance
 *   - hasStripeKey()        — does process.env hold a key right now?
 *   - isLiveKey(key)        — sk_live_… vs sk_test_… (no other modes)
 *   - createCheckoutSession({ userId, email, withPaulCoupon })
 *   - createPortalSession(stripeCustomerId)
 *   - parseWebhookEvent(rawBody, signature)
 *   - applySubscriptionEventToDb(pool, event)
 *   - currentSubscriptionState(user)
 *   - daysOfTrialRemaining(user)
 *
 * Constants:
 *   - PRICE_GBP = 19.99           (display only; the Stripe Price has the real number)
 *   - TRIAL_DAYS = 30
 *   - SUBSCRIPTION_STATUSES = the enum Stripe sends in webhooks
 */
import Stripe from 'stripe';

export const PRICE_GBP = 19.99;
export const TRIAL_DAYS = 30;

// Pay-as-you-go quote pack (2026-06-24). One-time payment, no expiry.
// Deliberately a worse per-quote value than the subscription so the
// pack is a top-up for occasional users, not a substitute for paying.
// Pence keeps integer maths off floating point.
export const QUOTE_PACK_PRICE_PENCE = 999;
export const QUOTE_PACK_SIZE = 5;
export const QUOTE_PACK_DESCRIPTION = '5 quote pack';

// Stripe's documented subscription.status values. We mirror the
// `subscription_status` column on `users`.
export const SUBSCRIPTION_STATUSES = Object.freeze([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

let _client = null;

export function hasStripeKey() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function isLiveKey(key) {
  return typeof key === 'string' && key.startsWith('sk_live_');
}

/**
 * Lazy Stripe SDK singleton.
 *
 * Throws if STRIPE_SECRET_KEY is missing OR if it's a live key and
 * STRIPE_ALLOW_LIVE !== '1'. The live-key gate exists so a misplaced
 * env var doesn't accidentally point the app at production Stripe
 * during a dev session.
 */
export function stripeClient() {
  if (_client) return _client;
  const raw = process.env.STRIPE_SECRET_KEY;
  if (!raw) {
    throw new Error('STRIPE_SECRET_KEY is not set — billing routes are unavailable');
  }
  // Strip any whitespace (newlines, spaces, tabs) the key may have
  // picked up during a paste. On 2026-06-17 a multi-line paste into
  // Railway introduced `\n  ` into the middle of the key, which
  // Node's HTTP header validator rejects with ERR_INVALID_CHAR —
  // surfaced server-side only as the opaque StripeConnectionError
  // "An error occurred with our connection to Stripe", killing the
  // checkout flow with no client-side signal. Stripe keys are
  // alphanumeric + `_`, so stripping all whitespace is safe.
  const key = raw.replace(/\s+/g, '');
  if (isLiveKey(key) && process.env.STRIPE_ALLOW_LIVE !== '1') {
    throw new Error(
      'Refusing to construct a Stripe client with a live key (sk_live_…) ' +
      'unless STRIPE_ALLOW_LIVE=1. This guard exists so a misplaced env var ' +
      'cannot accidentally aim at production Stripe.'
    );
  }
  _client = new Stripe(key, {
    apiVersion: '2024-12-18.acacia',
    // Statement descriptor at the account level (Harry sets this in
    // the Stripe Dashboard); we set the suffix per-charge below.
    maxNetworkRetries: 2,
    timeout: 10_000,
  });
  return _client;
}

// Visible for tests that want to swap clients in/out.
export function _resetStripeClientForTests() {
  _client = null;
}

/**
 * Create a Stripe Checkout session for the £19.99/month subscription.
 *
 * Called when the user clicks "Subscribe" — usually at trial-end but
 * any time during the trial too (some users prefer to add their card
 * up front).
 *
 * @param {Object} opts
 * @param {string} opts.userId — FastQuote user id (becomes Checkout's `client_reference_id`)
 * @param {string} opts.email — for prefill + receipt
 * @param {boolean} opts.withPaulCoupon — apply STRIPE_PAUL_COUPON_ID if set
 * @param {string} opts.successUrl — full URL to redirect to on success
 * @param {string} opts.cancelUrl  — full URL to redirect to on cancel
 * @returns {Promise<{url: string, sessionId: string}>}
 */
export async function createCheckoutSession({ userId, email, withPaulCoupon, successUrl, cancelUrl }) {
  const stripe = stripeClient();
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error('STRIPE_PRICE_ID is not set — set it to the test-mode Price id from the Stripe Dashboard');
  }

  const discounts = [];
  if (withPaulCoupon && process.env.STRIPE_PAUL_COUPON_ID) {
    discounts.push({ coupon: process.env.STRIPE_PAUL_COUPON_ID });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    customer_email: email,
    discounts: discounts.length > 0 ? discounts : undefined,
    subscription_data: {
      // No trial here — the FastQuote-side trial is already running
      // (started at OAuth signup). Adding another Stripe trial would
      // double-count.
      metadata: { fastquote_user_id: userId },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Statement descriptor suffix per-charge. The Stripe account's
    // base descriptor is "FASTQUOTE" (set by Harry in the Dashboard).
    // Customer sees: "FASTQUOTE* SUBSCRIPTION" on their statement.
    payment_intent_data: undefined, // not used in subscription mode
    metadata: { fastquote_user_id: userId },
  });

  return { url: session.url, sessionId: session.id };
}

/**
 * Create a Stripe Billing Portal session so a user can manage their
 * subscription (update card, cancel, see invoices) without us
 * building the UI for it.
 */
export async function createPortalSession(stripeCustomerId, returnUrl) {
  const stripe = stripeClient();
  if (!stripeCustomerId) {
    throw new Error('No Stripe customer for this user — they haven\'t started a subscription yet');
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

/**
 * Verify the Stripe webhook signature and parse the event.
 *
 * Stripe signs every webhook with HMAC-SHA256 over the raw body. We
 * MUST validate this — without it, anyone could POST fake events to
 * /api/billing/webhook and flip users to "active" without paying.
 *
 * @param {Buffer} rawBody — the raw request body BEFORE express.json
 * @param {string} signature — the Stripe-Signature header
 * @returns {object} the parsed event (e.g. { type, data })
 * @throws if signature invalid OR webhook secret missing
 */
export function parseWebhookEvent(rawBody, signature) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  }
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Map a Stripe subscription/checkout-session event to a DB update on
 * `users`. Idempotent — running the same event twice converges to
 * the same state. Stripe sometimes redelivers; we just upsert.
 *
 * Handles these event types:
 *   - checkout.session.completed     — set stripe_customer_id + subscription_id; trial may now be moot
 *   - customer.subscription.created  — alias for above; webhook may arrive in either order
 *   - customer.subscription.updated  — status changes (trialing → active → past_due → canceled)
 *   - customer.subscription.deleted  — set status to 'canceled' and clear subscription id
 *   - invoice.payment_failed         — Stripe will retry; we flip status to 'past_due'
 *
 * Other event types pass through (Stripe sends many; we only care
 * about subscription lifecycle).
 */
export async function applySubscriptionEventToDb(pool, event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      // client_reference_id was set by us at session creation — it's the FastQuote user id.
      const userId = session.client_reference_id;
      if (!userId) return { applied: false, reason: 'no client_reference_id' };
      // CRITICAL (2026-06-25): IGNORE payment-mode checkouts. Without
      // this guard, a one-time quote-pack purchase (mode='payment')
      // would promote the user to subscription_status='active' — Harry
      // hit this live: bought a £9.99 pack, the gate then read his
      // state as 'subscribed' and the counter showed "Unlimited". The
      // previous "COALESCE handles it" reasoning was wrong — the
      // COALESCE was protecting customer/subscription IDs (which ARE
      // null in payment mode), not the literal 'active' string.
      // applyQuotePackEventToDb handles payment-mode events; this
      // function MUST only fire on subscription-mode.
      if (session.mode !== 'subscription') {
        return { applied: false, reason: `ignored: mode=${session.mode || 'unknown'}` };
      }
      await pool.query(
        `UPDATE users
         SET stripe_customer_id = COALESCE($1, stripe_customer_id),
             stripe_subscription_id = COALESCE($2, stripe_subscription_id),
             subscription_status = COALESCE($3, subscription_status)
         WHERE id = $4`,
        [session.customer, session.subscription, 'active', userId]
      );
      return { applied: true, userId, status: 'active' };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const userId = sub.metadata?.fastquote_user_id;
      if (!userId) return { applied: false, reason: 'no fastquote_user_id in metadata' };
      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null;
      await pool.query(
        `UPDATE users
         SET stripe_customer_id = $1,
             stripe_subscription_id = $2,
             subscription_status = $3,
             current_period_end = $4,
             cancel_at_period_end = $5
         WHERE id = $6`,
        [sub.customer, sub.id, sub.status, periodEnd, Boolean(sub.cancel_at_period_end), userId]
      );
      return { applied: true, userId, status: sub.status };
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const userId = sub.metadata?.fastquote_user_id;
      if (!userId) return { applied: false, reason: 'no fastquote_user_id in metadata' };
      await pool.query(
        `UPDATE users
         SET subscription_status = 'canceled',
             stripe_subscription_id = NULL,
             current_period_end = NULL,
             cancel_at_period_end = FALSE
         WHERE id = $1`,
        [userId]
      );
      return { applied: true, userId, status: 'canceled' };
    }

    case 'customer.subscription.trial_will_end': {
      // Stripe fires this ~3 days before a trialing subscription
      // converts. For the no-card-upfront model (TRQ-150), this is the
      // hook to flip the in-app banner from "trial in progress" to
      // "ends in N days — add a card to keep using" without making the
      // UI poll Stripe every render. The schema column is
      // trial_will_end_at; the UI reads it via /api/billing/status.
      //
      // No email is sent from here — that becomes its own ticket once
      // a transactional-email path exists. The signal is captured so
      // the email handler can pick it up later without backfill.
      const sub = event.data.object;
      const userId = sub.metadata?.fastquote_user_id;
      if (!userId) return { applied: false, reason: 'no fastquote_user_id in metadata' };
      // trial_end is the Unix timestamp when the trial ends. Stripe
      // schedules trial_will_end 3 days before that point.
      const trialEnd = sub.trial_end
        ? new Date(sub.trial_end * 1000)
        : null;
      await pool.query(
        `UPDATE users
            SET trial_will_end_at = $1
          WHERE id = $2`,
        [trialEnd, userId]
      );
      return { applied: true, userId, trialEndsAt: trialEnd };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      // Map invoice.customer → user via stripe_customer_id.
      if (!invoice.customer) return { applied: false, reason: 'no customer on invoice' };
      await pool.query(
        `UPDATE users
         SET subscription_status = 'past_due'
         WHERE stripe_customer_id = $1`,
        [invoice.customer]
      );
      return { applied: true, customerId: invoice.customer, status: 'past_due' };
    }

    default:
      // Stripe sends many event types we don't care about (e.g. price
      // updates, balance changes). Silently ignore — return without
      // updating the DB.
      return { applied: false, reason: `unhandled event type ${event.type}` };
  }
}

/**
 * Compute the effective subscription state for a user — combines
 * Stripe's status with the FastQuote-side trial window.
 *
 * Returns one of:
 *   - 'trialing'  — within trial window, no Stripe subscription yet
 *   - 'active'    — paying subscriber (or in Stripe-side trial; Stripe-side trials aren't used here)
 *   - 'past_due'  — payment failed; Stripe is retrying
 *   - 'canceled'  — subscription ended (either by user or after grace)
 *   - 'expired'   — trial ended, no subscription started; quotes should prompt to subscribe
 *   - 'unknown'   — legacy user (pre-billing); admin / seed users
 */
export function currentSubscriptionState(user) {
  if (!user) return 'unknown';

  // Explicit Stripe status wins if present. Stripe is authoritative
  // for any paying interaction.
  if (user.subscription_status === 'active') return 'active';
  if (user.subscription_status === 'past_due') return 'past_due';
  if (user.subscription_status === 'canceled') return 'canceled';

  // Otherwise look at the trial window.
  if (user.trial_ends_at) {
    const ends = new Date(user.trial_ends_at).getTime();
    if (Date.now() < ends) return 'trialing';
    return 'expired';
  }

  // Legacy users (Mark, Paul, Harry) predate billing.
  return 'unknown';
}

/**
 * Helper for the trial-banner UI — how many days are left on the
 * trial? Returns 0 if expired or not in trial.
 */
export function daysOfTrialRemaining(user) {
  if (!user?.trial_ends_at) return 0;
  const ms = new Date(user.trial_ends_at).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// ───────────────────────────────────────────────────────────────────
// Pay-as-you-go quote pack (2026-06-24)
//
// One-time £9.99 payment for 5 quotes. Shares the FastQuote Stripe
// account from TRQ-150 — the same key, the same webhook secret, the
// same statement descriptor. Webhook fan-out is in server.js: every
// event goes through BOTH applySubscriptionEventToDb (subscription
// lifecycle) AND applyQuotePackEventToDb (one-time pack purchases).
// Idempotency keys are disjoint (subscription_status vs the
// `quote_purchases.stripe_payment_id UNIQUE` constraint) so a stray
// double-fire is safe.
//
// Harry is NOT VAT-registered — `automatic_tax: false` on the
// Checkout session keeps the receipt free of any VAT line. Same care
// as TRQ-157.
// ───────────────────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout session for the £9.99 quote pack.
 *
 * mode='payment' (one-time, NOT a subscription). The pack is credited
 * by the webhook on `checkout.session.completed` OR `payment_intent.
 * succeeded` — whichever arrives first.
 *
 * @param {Object} opts
 * @param {string} opts.userId — FastQuote user id (client_reference_id + metadata)
 * @param {string} opts.email — for prefill + receipt
 * @param {string} opts.successUrl — full URL to redirect to on success
 * @param {string} opts.cancelUrl  — full URL to redirect to on cancel
 * @returns {Promise<{ url: string, sessionId: string }>}
 */
export async function createQuotePackCheckoutSession({ userId, email, successUrl, cancelUrl }) {
  const stripe = stripeClient();
  if (!userId) throw new Error('createQuotePackCheckoutSession: userId is required');

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'gbp',
        product_data: {
          name: QUOTE_PACK_DESCRIPTION,
          description: `${QUOTE_PACK_SIZE} quotes — no expiry date.`,
        },
        unit_amount: QUOTE_PACK_PRICE_PENCE,
      },
      quantity: 1,
    }],
    // Harry is not VAT-registered (2026-06-24). Receipt must NOT
    // imply VAT — same constraint as TRQ-157.
    automatic_tax: { enabled: false },
    // Per-purchase invoice (2026-06-30 launch checklist). With
    // invoice_creation enabled, Stripe finalises an Invoice object
    // automatically after the PaymentIntent succeeds. The Invoice has
    // a hosted_invoice_url (Stripe-hosted page) + invoice_pdf (direct
    // PDF). We surface the hosted page in /api/billing/purchases so
    // tradesmen running their own business can grab a receipt for
    // their accounting. Stripe handles branding (Dashboard → Settings
    // → Branding) — no custom rendering on our side.
    invoice_creation: { enabled: true },
    client_reference_id: userId,
    customer_email: email,
    // Tag both the session AND the payment_intent so the webhook can
    // attribute either event to the FastQuote user without a JOIN.
    metadata: {
      fastquote_user_id: userId,
      fastquote_product: 'quote_pack',
    },
    payment_intent_data: {
      metadata: {
        fastquote_user_id: userId,
        fastquote_product: 'quote_pack',
      },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return { url: session.url, sessionId: session.id };
}

/**
 * Resolve the hosted invoice URL for a one-time pack payment.
 *
 * Stripe creates the Invoice asynchronously after the PaymentIntent
 * succeeds (invoice_creation: { enabled: true } on the Checkout
 * Session). The webhook fires on `payment_intent.succeeded` or
 * `checkout.session.completed` — the Invoice may or may not be
 * attached yet depending on event ordering. This helper does a
 * best-effort lookup:
 *
 *   1. If the PaymentIntent has an `invoice` field set, retrieve it
 *      and return `hosted_invoice_url`.
 *   2. Otherwise, list invoices on the customer for this PaymentIntent
 *      (Stripe's filter doesn't accept payment_intent directly, so we
 *      scan recent invoices and match on metadata).
 *   3. If nothing matches yet, return null. The webhook will store
 *      null; users can refetch later via the on-demand list endpoint
 *      which goes through stripe.invoices.list directly.
 *
 * Failures are swallowed and return null — the credit must land even
 * if invoice resolution hiccups. The audit row's stripe_payment_id is
 * stable; a later backfill could re-resolve.
 *
 * @param {string} stripePaymentId — PaymentIntent id (`pi_...`)
 * @returns {Promise<string|null>}
 */
export async function getHostedInvoiceUrlForPayment(stripePaymentId) {
  if (!stripePaymentId || !stripePaymentId.startsWith('pi_')) return null;
  try {
    const stripe = stripeClient();
    const pi = await stripe.paymentIntents.retrieve(stripePaymentId);
    if (pi?.invoice) {
      const invoiceId = typeof pi.invoice === 'string' ? pi.invoice : pi.invoice.id;
      if (invoiceId) {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        return invoice?.hosted_invoice_url || null;
      }
    }
    return null;
  } catch (err) {
    // Best-effort — don't let invoice resolution block crediting.
    console.warn('[billing] getHostedInvoiceUrlForPayment failed:', err?.message || err);
    return null;
  }
}

/**
 * List recent invoices for a Stripe customer (subscription receipts).
 *
 * Subscriptions get an invoice per billing cycle — Stripe already
 * generates these natively with hosted_invoice_url + invoice_pdf. We
 * expose them in /api/billing/purchases so the user has one place to
 * download every receipt.
 *
 * Returns the full Invoice objects (with hosted_invoice_url, total,
 * created, etc.) — the caller maps them to the public shape.
 *
 * @param {string} stripeCustomerId
 * @param {number} limit — Stripe's per-page cap is 100; we default to 24
 * @returns {Promise<Array>}
 */
export async function listCustomerInvoices(stripeCustomerId, limit = 24) {
  if (!stripeCustomerId) return [];
  try {
    const stripe = stripeClient();
    const resp = await stripe.invoices.list({
      customer: stripeCustomerId,
      limit: Math.min(Math.max(1, limit), 100),
    });
    return resp?.data || [];
  } catch (err) {
    console.warn('[billing] listCustomerInvoices failed:', err?.message || err);
    return [];
  }
}

/**
 * Apply a one-time-payment webhook event to `quote_purchases` +
 * `users.purchased_quotes`. Idempotent on the Stripe payment id
 * (ON CONFLICT DO NOTHING against `quote_purchases.stripe_payment_id`
 * UNIQUE) — double-firing the same event credits exactly once.
 *
 * Both the insert AND the credit happen inside a single transaction:
 * either both writes land or neither does. No partial state where
 * the user got credited but the audit row is missing.
 *
 * Only acts on events whose metadata.fastquote_product === 'quote_pack'.
 * Subscription events fall through unchanged — they're handled by
 * applySubscriptionEventToDb.
 *
 * Supported event types:
 *   - checkout.session.completed (one-time payment mode only)
 *   - payment_intent.succeeded
 *
 * @param {*} pool — pg Pool (or anything with .connect())
 * @param {*} event — parsed Stripe event
 * @returns {Promise<{applied: boolean, reason?: string, userId?: string, credited?: number}>}
 */
export async function applyQuotePackEventToDb(pool, event) {
  // Extract (userId, stripePaymentId, amountPaidPence, hostedInvoiceUrl)
  // from whichever event shape arrived. checkout.session.completed and
  // payment_intent.succeeded both carry the metadata we set above; we
  // prefer the payment_intent id as the dedupe key because it's stable
  // across both event types (one Checkout session → one PaymentIntent).
  //
  // The hostedInvoiceUrl is best-effort: the Checkout Session carries
  // `invoice` directly when invoice_creation was enabled; for the
  // payment_intent.succeeded event we don't get the invoice in the
  // payload, so we look it up via the Stripe API. Either path may
  // return null — the column is nullable and a backfill can re-resolve.
  let userId = null;
  let stripePaymentId = null;
  let amountPaidPence = null;
  let hostedInvoiceUrl = null;
  let stripeInvoiceId = null;

  if (event?.type === 'checkout.session.completed') {
    const s = event.data?.object || {};
    // Subscription-mode checkouts use the same event type — only act on
    // one-time payments tagged as a quote pack.
    if (s.mode !== 'payment') return { applied: false, reason: 'not a payment-mode checkout' };
    if (s.metadata?.fastquote_product !== 'quote_pack') {
      return { applied: false, reason: 'not a quote_pack checkout' };
    }
    userId = s.metadata?.fastquote_user_id || s.client_reference_id || null;
    stripePaymentId = s.payment_intent || s.id || null;
    amountPaidPence = typeof s.amount_total === 'number' ? s.amount_total : QUOTE_PACK_PRICE_PENCE;
    // Checkout session may include `invoice` (id string) when
    // invoice_creation was enabled. We don't get the hosted URL on the
    // session itself, so we'll resolve it via the API below.
    if (typeof s.invoice === 'string') stripeInvoiceId = s.invoice;
  } else if (event?.type === 'payment_intent.succeeded') {
    const pi = event.data?.object || {};
    if (pi.metadata?.fastquote_product !== 'quote_pack') {
      return { applied: false, reason: 'not a quote_pack payment_intent' };
    }
    userId = pi.metadata?.fastquote_user_id || null;
    stripePaymentId = pi.id || null;
    amountPaidPence = typeof pi.amount_received === 'number' ? pi.amount_received
      : (typeof pi.amount === 'number' ? pi.amount : QUOTE_PACK_PRICE_PENCE);
    // PaymentIntent may include `invoice` (id string) when an Invoice
    // was attached. Same async timing as above — resolve via API.
    if (typeof pi.invoice === 'string') stripeInvoiceId = pi.invoice;
  } else {
    return { applied: false, reason: `unhandled event type ${event?.type}` };
  }

  if (!userId) return { applied: false, reason: 'no fastquote_user_id on event' };
  if (!stripePaymentId) return { applied: false, reason: 'no stripe payment id on event' };

  // Best-effort hosted invoice URL resolution. Wrapped in try so a
  // Stripe API hiccup never blocks the credit. Two paths:
  //  1. Event payload carried the invoice id → retrieve once.
  //  2. No invoice on event yet → resolve via PaymentIntent (helper
  //     handles its own try/catch + null fallback).
  try {
    if (stripeInvoiceId) {
      const stripe = stripeClient();
      const invoice = await stripe.invoices.retrieve(stripeInvoiceId);
      hostedInvoiceUrl = invoice?.hosted_invoice_url || null;
    } else {
      hostedInvoiceUrl = await getHostedInvoiceUrlForPayment(stripePaymentId);
    }
  } catch (err) {
    // Stripe SDK is unconfigured in some test environments — the
    // helper above already logs; just keep hostedInvoiceUrl null.
    hostedInvoiceUrl = null;
  }

  // Transaction: insert audit row, then credit the user. ON CONFLICT
  // DO NOTHING on the audit insert is the dedupe — if we've seen this
  // payment id before, the credit UPDATE only fires when the audit
  // row is genuinely new (CTE guards the UPDATE on EXISTS inserted).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH inserted AS (
         INSERT INTO quote_purchases (user_id, stripe_payment_id, quotes_added, amount_paid_pence, hosted_invoice_url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (stripe_payment_id) DO NOTHING
         RETURNING id
       )
       UPDATE users
          SET purchased_quotes = purchased_quotes + $3
        WHERE id = $1
          AND EXISTS (SELECT 1 FROM inserted)
        RETURNING id`,
      [userId, stripePaymentId, QUOTE_PACK_SIZE, amountPaidPence, hostedInvoiceUrl]
    );
    await client.query('COMMIT');
    const credited = rows.length > 0 ? QUOTE_PACK_SIZE : 0;
    return { applied: true, userId, credited, stripePaymentId, hostedInvoiceUrl };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Format a public-facing description for a one-time pack purchase.
 *
 * Pure helper — called by /api/billing/purchases when shaping the
 * response, and exposed for unit testing. Falls back gracefully if
 * inputs are missing.
 *
 * @param {object} opts
 * @param {string} opts.kind — 'pack' | 'subscription'
 * @param {number} opts.amountPence
 * @returns {string}
 */
export function formatPurchaseDescription({ kind, amountPence } = {}) {
  if (kind === 'pack') {
    const pounds = (Number(amountPence) || QUOTE_PACK_PRICE_PENCE) / 100;
    return `${QUOTE_PACK_SIZE} quotes — £${pounds.toFixed(2)}`;
  }
  if (kind === 'subscription') {
    const pounds = (Number(amountPence) || 0) / 100;
    return `Monthly subscription — £${pounds.toFixed(2)}`;
  }
  return 'Purchase';
}
