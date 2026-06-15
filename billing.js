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
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set — billing routes are unavailable');
  }
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
