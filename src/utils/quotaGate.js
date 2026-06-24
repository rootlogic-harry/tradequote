/**
 * Quota-based free tier (2026-06-22) + pay-as-you-go pack (2026-06-24).
 *
 * FastQuote used to ship a 1-month no-card trial: signup set
 * `users.trial_ends_at = NOW() + 30 days` and the analyse endpoint
 * was wide open until that timestamp passed. The problem with that
 * model: tradesmen value FastQuote per-quote, not per-month. A
 * customer who only does two jobs in a month feels they're paying
 * for time they didn't use. Switching to "3 free quotes, then pay"
 * aligns the free tier with the unit of value.
 *
 * This file is the single source of truth for the gate decision.
 * Three callers depend on it:
 *
 *   1. The /api/users/:id/analyse middleware (the 402 lockout).
 *   2. The /auth/me billing payload (so the SPA renders the right
 *      banner without a second round trip).
 *   3. Any future admin "is this user eligible?" query.
 *
 * Order of evaluation is load-bearing — change it and you change
 * who pays. Test coverage is in src/__tests__/quotaGate.test.js.
 *
 *   1. Active Stripe subscription → ALLOW (paid customer; never read
 *      the comp clock or the free-quote counter).
 *   2. Active comp (comp_until > now) → ALLOW (trusted users — Paul
 *      and any future comped account).
 *   3. free_quotes_used < FREE_QUOTES_LIMIT + bonus_free_quotes → ALLOW
 *      with reason='free-remaining'.
 *      Bonus quotes come from referrals (Phase 1, 2026-06-23):
 *      referees get +2 at signup, referrers get +2 per referral whose
 *      referee completes their first analysis.
 *   4. purchased_quotes > 0 → ALLOW with reason='purchased-remaining'
 *      (pay-as-you-go pack, 2026-06-24). The pack costs £9.99 for 5
 *      quotes; one-time payment, no expiry. Free quotes burn FIRST so
 *      a user who buys a pack but still has a free quote left spends
 *      the free one first — friendly AND correct.
 *   5. Otherwise → DENY with reason='quota_exhausted'.
 */

export const FREE_QUOTES_LIMIT = 3;

/**
 * Decide whether a user is allowed to consume an AI analysis right
 * now. Pure function — no I/O, no Date.now() unless `now` is omitted.
 *
 * @param {{ free_quotes_used?: number, bonus_free_quotes?: number, purchased_quotes?: number, comp_until?: string|Date|null }|null|undefined} user
 *        The user row (raw DB shape — snake_case from the `users`
 *        table). Null / undefined → denied (defensive — better to
 *        block a stranger than silently allow one).
 *        `bonus_free_quotes` (referrals Phase 1, 2026-06-23) is added
 *        on top of FREE_QUOTES_LIMIT for the effective allowance.
 *        `purchased_quotes` (pay-as-you-go pack, 2026-06-24) is a
 *        separate bucket spent only after free quotes are exhausted —
 *        never burn a paid quote while a free one is still available.
 *        Subscribed > comped > counter gating order means bonus quotes
 *        are invisible during a comp — they accumulate and become
 *        spendable when the comp ends. Same for purchased.
 * @param {{ hasActiveSubscription: boolean, now?: Date }} ctx
 *        - `hasActiveSubscription` — caller has already decided this
 *          from Stripe state. We accept it as a boolean so the gate
 *          doesn't itself import billing.js (keeps the dep graph
 *          one-way and makes the helper trivially mockable).
 *        - `now` — injectable clock for tests. Defaults to new Date().
 *
 * @returns {{ allowed: boolean, reason: string }}
 *          `reason` is one of:
 *            - 'subscribed'           — active Stripe subscription
 *            - 'comped'               — comp_until > now
 *            - 'free-remaining'       — within the effective free-quote allowance
 *            - 'purchased-remaining'  — free exhausted but pack quotes available
 *            - 'quota_exhausted'      — denied; UI shows hard subscribe CTA
 */
export function quotaGate(user, ctx) {
  const hasActiveSubscription = Boolean(ctx?.hasActiveSubscription);
  const now = ctx?.now ?? new Date();

  if (hasActiveSubscription) {
    return { allowed: true, reason: 'subscribed' };
  }

  if (!user) {
    return { allowed: false, reason: 'quota_exhausted' };
  }

  // Comp window — strict greater-than so a comp expiring "right now"
  // doesn't grant one final analysis at the boundary.
  if (user.comp_until) {
    const compUntil = new Date(user.comp_until).getTime();
    if (Number.isFinite(compUntil) && compUntil > now.getTime()) {
      return { allowed: true, reason: 'comped' };
    }
  }

  const used = Number(user.free_quotes_used) || 0;
  const bonus = Number(user.bonus_free_quotes) || 0;
  const effectiveLimit = FREE_QUOTES_LIMIT + Math.max(0, bonus);
  if (used < effectiveLimit) {
    return { allowed: true, reason: 'free-remaining' };
  }

  // Pay-as-you-go pack (2026-06-24). Free quotes burn first — if we're
  // here the user has used all FREE_QUOTES_LIMIT + bonus. Now check the
  // separate `purchased_quotes` bucket. Negative values are clamped to 0
  // (defensive — a buggy refund couldn't accidentally grant negative-
  // billed quotes).
  const purchased = Math.max(0, Number(user.purchased_quotes) || 0);
  if (purchased > 0) {
    return { allowed: true, reason: 'purchased-remaining' };
  }

  return { allowed: false, reason: 'quota_exhausted' };
}

/**
 * Build the `billing` block we attach to /auth/me. Mirrors the
 * quotaGate decision but in the shape the SPA wants. Centralised so
 * the server route stays a thin pass-through and the client banner
 * doesn't have to re-derive `quotaState` from raw fields.
 *
 * `freeQuotesUsed` is clamped at FREE_QUOTES_LIMIT for display — a
 * defensive measure in case the DB value got past the limit (e.g.
 * a comp expired mid-flight). The UI never shows "4 of 3 used".
 */
export function resolveQuotaState(user, ctx) {
  const decision = quotaGate(user, ctx);
  const hasActiveSubscription = Boolean(ctx?.hasActiveSubscription);
  const compUntil = user?.comp_until ? new Date(user.comp_until).getTime() : null;
  const now = (ctx?.now ?? new Date()).getTime();
  const isComped = Boolean(
    !hasActiveSubscription
      && compUntil !== null
      && Number.isFinite(compUntil)
      && compUntil > now
  );

  // The gate's reason already tells us which bucket the user is in.
  // Map it 1:1 except for 'quota_exhausted' (which downstream banner
  // code expects as the legacy 'exhausted' string).
  let quotaState;
  if (hasActiveSubscription) quotaState = 'subscribed';
  else if (isComped) quotaState = 'comped';
  else if (decision.reason === 'free-remaining') quotaState = 'free-remaining';
  else if (decision.reason === 'purchased-remaining') quotaState = 'purchased-remaining';
  else quotaState = 'exhausted';

  // Referrals Phase 1 (2026-06-23): the effective limit is the baseline
  // 3 free quotes plus any bonus quotes earned via referrals. The banner
  // reads `freeQuotesLimit` to render "X of N used", so it must reflect
  // the bonus or a referred user would see "5 of 3" on a fresh signup.
  const bonus = Math.max(0, Number(user?.bonus_free_quotes) || 0);
  const effectiveLimit = FREE_QUOTES_LIMIT + bonus;
  const rawUsed = Number(user?.free_quotes_used) || 0;
  const freeQuotesUsed = Math.min(Math.max(0, rawUsed), effectiveLimit);

  // Pay-as-you-go pack (2026-06-24). Surface the raw pack balance so
  // the persistent counter can render mixed-state copy ("{free} free +
  // {purchased} paid"). Negative values clamped — defensive.
  const purchasedQuotesRemaining = Math.max(0, Number(user?.purchased_quotes) || 0);

  return {
    quotaState,
    hasActiveSubscription,
    isComped,
    freeQuotesUsed,
    freeQuotesLimit: effectiveLimit,
    bonusFreeQuotes: bonus,
    purchasedQuotesRemaining,
  };
}
