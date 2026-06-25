/**
 * Pure helpers for SubscriptionBanner (TRQ-164). Split out of the
 * JSX component so Jest can unit-test them — the Jest config has
 * `transform: {}` (no JSX compile step), so anything importable
 * from a test file has to live in a plain .js module.
 *
 * 2026-06-25 — quota-driven banner variants (`free-remaining`,
 * `exhausted`) moved into `QuotaCounter` per the unified-banner
 * locked spec. SubscriptionBanner is now restricted to Stripe-state
 * banners (`past-due`, `canceled`, `expired`, `trial`, `trial-ending`)
 * and quota-driven states resolve to `'none'` here so the two
 * components occupy disjoint state spaces and never render side-by-side.
 */

/**
 * Trial-ending-soon predicate. Two signal sources:
 *
 *   1. `trialWillEndAt` — the timestamp captured from Stripe's
 *      `customer.subscription.trial_will_end` webhook (TRQ-150
 *      PR #26). Authoritative when present.
 *   2. `daysOfTrialRemaining` — server-computed from the user's
 *      `trial_ends_at` column. The fallback for users whose trial
 *      is too short for Stripe to have fired the webhook yet
 *      (Stripe fires it ~3 days before conversion).
 *
 * Returns true if EITHER signal says we're inside the 3-day window.
 * Belt-and-braces — a UI banner that flips on too eagerly is a
 * minor annoyance; one that fails to warn the user before their
 * trial converts is a billing complaint.
 */
export function isTrialEndingSoon(status) {
  if (!status) return false;
  if (status.state !== 'trialing') return false;
  if (status.trialWillEndAt) {
    const target = new Date(status.trialWillEndAt).getTime();
    const now = Date.now();
    const diffDays = (target - now) / (1000 * 60 * 60 * 24);
    if (diffDays >= 0 && diffDays <= 3) return true;
  }
  if (
    typeof status.daysOfTrialRemaining === 'number'
    && status.daysOfTrialRemaining >= 0
    && status.daysOfTrialRemaining <= 3
  ) {
    return true;
  }
  return false;
}

/** Singular vs plural day-count copy. */
export function dayCopy(n) {
  if (n === 1) return '1 day';
  return `${n ?? 0} days`;
}

/**
 * "X of 3 free quotes used" copy helper (2026-06-22). Retained for
 * back-compat with any caller still reaching into the helper module
 * — the SubscriptionBanner no longer renders this string (the
 * unified QuotaCounter owns the free-quote copy as of 2026-06-25).
 */
export function freeQuotesCopy(used, limit) {
  const safeUsed = Number.isFinite(used) ? used : 0;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 3;
  return `${safeUsed} of ${safeLimit} free quotes used`;
}

/**
 * Pick which banner variant to render given the status payload.
 * Returns one of: 'none' | 'trial' | 'trial-ending' | 'expired'
 * | 'past-due' | 'canceled'.
 *
 * 2026-06-25 — the quota-driven variants (`free-remaining`,
 * `exhausted`) were removed from this helper. `QuotaCounter` is now
 * the sole surface for quota state (free / mixed / purchased /
 * exhausted). Disjoint state spaces — the two components are never
 * both visible for the same user state.
 *
 * Order of evaluation:
 *
 *   1. Not configured → none
 *   2. Stripe past_due / canceled → those banners (account recovery
 *      is more urgent than quota copy)
 *   3. quotaState === 'subscribed' | 'comped' | 'free-remaining' |
 *      'exhausted' | 'purchased-remaining' → none (QuotaCounter
 *      handles all of these now)
 *   4. Legacy state mapping (trialing/expired/active/unknown) for
 *      backwards-compat with older client builds before the quota
 *      model existed.
 */
export function pickBannerVariant(status) {
  if (!status) return 'none';
  if (!status.configured) return 'none';

  // Stripe-side problems beat quota state — paying customer with a
  // failed card must see Update Card, not free-quote copy.
  if (status.state === 'past_due') return 'past-due';
  if (status.state === 'canceled') return 'canceled';

  // Quota-driven states now live in QuotaCounter (2026-06-25). The
  // SubscriptionBanner stays out of the quota lane so the user
  // never sees two banners narrating the same state.
  if (status.quotaState === 'subscribed') return 'none';
  if (status.quotaState === 'comped') return 'none';
  if (status.quotaState === 'exhausted') return 'none';
  if (status.quotaState === 'free-remaining') return 'none';
  if (status.quotaState === 'purchased-remaining') return 'none';

  // Legacy fallback — older client builds without quotaState.
  if (status.state === 'active' || status.state === 'unknown') return 'none';
  if (status.state === 'expired') return 'expired';
  if (status.state === 'trialing') {
    return isTrialEndingSoon(status) ? 'trial-ending' : 'trial';
  }
  return 'none';
}
